/**
 * Data Relay Bridge - Streams a command's stdout from one SSH host into a file
 * on another SSH host, entirely inside the main process.
 *
 * Topology:
 *   source host  --(ssh exec stdout)-->  main process  --(sftp write stream)-->  destination host
 *
 * The payload never round-trips through the renderer: a single `pipe` carries
 * the bytes with natural backpressure so memory stays bounded regardless of how
 * much data the source keeps producing.
 */

"use strict";

require("./boringSslDhCompat.cjs").installBoringSslDhCompat();
const { Client: SSHClient } = require("ssh2");
const { NetcattyAgent } = require("./netcattyAgent.cjs");
const keyboardInteractiveHandler = require("./keyboardInteractiveHandler.cjs");
const { connectThroughChain, buildAlgorithms } = require("./sshBridge.cjs");
const { resolveSshConnectionTimeouts } = require("./sshBridge/startSession.cjs");
const hostKeyVerifier = require("./hostKeyVerifier.cjs");
const { createProxySocket, runWhenProxyConnectionReady } = require("./proxyUtils.cjs");
const { openBoundedSshExecStream, terminateSshExecStream } = require("./boundedSshExec.cjs");
const { openBoundedSftpChannel, closeSftpChannel } = require("./boundedSftpOpen.cjs");
const { resolveConnectionKeepalivePolicy } = require("./sshConnectionPool.cjs");
const { safeSend } = require("./ipcUtils.cjs");
const {
  buildAuthHandler,
  createKeyboardInteractiveHandler,
  applyAuthToConnOpts,
  shouldSkipKiPasswordAutoFill,
  findAllDefaultPrivateKeys: findAllDefaultPrivateKeysFromHelper,
  preparePrivateKeyForAuth,
  loadFirstIdentityFileForAuth,
  getAvailableAgentSocket,
  prepareSystemSshAgentForAuth,
} = require("./sshAuthHelper.cjs");

/** Active data relays keyed by relayId. */
const dataRelays = new Map();

// Process-scoped authority metadata for renderer projections.
const PROCESS_EPOCH = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
let runtimeRevision = 0;
/** @type {Map<number, { sender: any, onDestroyed?: () => void }>} */
const runtimeEventSubscribers = new Map();

function bumpRuntimeRevision() {
  runtimeRevision += 1;
  return runtimeRevision;
}

function resolveRelayPhase(state) {
  if (!state) return "inactive";
  if (state.cleanupInProgress) return "stopping";
  if (state.status === "connecting") return "connecting";
  if (state.status === "error") return "error";
  if (state.status === "active") return "active";
  if (state.status === "inactive") return "inactive";
  return state.status || "active";
}

function toRuntimeRecord(relayId, state, revision = runtimeRevision) {
  return {
    ruleId: state?.ruleId,
    relayId,
    phase: resolveRelayPhase(state),
    ...(state?.error ? { error: state.error } : {}),
    bytesTransferred: Number(state?.bytesTransferred) || 0,
    revision,
    updatedAt: state?.updatedAt || Date.now(),
  };
}

function getDataRelaySnapshot() {
  const records = [];
  for (const [relayId, state] of dataRelays) {
    records.push(toRuntimeRecord(relayId, state));
  }
  return {
    epoch: PROCESS_EPOCH,
    revision: runtimeRevision,
    records,
  };
}

function publishRuntimeEvent(event) {
  const payload = {
    epoch: PROCESS_EPOCH,
    revision: runtimeRevision,
    ...event,
  };
  for (const [subscriberId, entry] of runtimeEventSubscribers) {
    const sender = entry?.sender;
    if (sender?.isDestroyed?.()) {
      runtimeEventSubscribers.delete(subscriberId);
      continue;
    }
    safeSend(sender, "netcatty:datarelay:runtime", payload);
  }
  return payload;
}

function publishRuntimeUpsert(relayId, state) {
  const revision = bumpRuntimeRevision();
  if (state) state.updatedAt = Date.now();
  return publishRuntimeEvent({
    kind: "upsert",
    record: toRuntimeRecord(relayId, state, revision),
  });
}

function publishRuntimeRemove(relayId, ruleId) {
  bumpRuntimeRevision();
  return publishRuntimeEvent({
    kind: "remove",
    relayId,
    ruleId,
  });
}

function subscribeDataRelayRuntime(event) {
  const sender = event?.sender;
  if (sender && Number.isSafeInteger(sender.id) && !sender.isDestroyed?.()) {
    const existing = runtimeEventSubscribers.get(sender.id);
    if (existing?.onDestroyed) {
      existing.sender.removeListener?.("destroyed", existing.onDestroyed);
    }
    const onDestroyed = () => {
      runtimeEventSubscribers.delete(sender.id);
    };
    runtimeEventSubscribers.set(sender.id, { sender, onDestroyed });
    sender.once("destroyed", onDestroyed);
  }
  return getDataRelaySnapshot();
}

function unsubscribeDataRelayRuntime(event) {
  const sender = event?.sender;
  const webContentsId = Number.isSafeInteger(sender?.id) ? sender.id : null;
  if (webContentsId !== null) {
    const entry = runtimeEventSubscribers.get(webContentsId);
    if (entry?.onDestroyed) {
      entry.sender.removeListener?.("destroyed", entry.onDestroyed);
    }
    runtimeEventSubscribers.delete(webContentsId);
  }
  return { ok: true };
}

function cleanupChainConnections(connections) {
  if (!Array.isArray(connections)) return;
  for (const chainConn of connections) {
    try { chainConn.end(); } catch { /* ignore */ }
  }
}

function isRelayCancelled(state) {
  return Boolean(state?.cancelled);
}

/**
 * Dial an SSH connection for one end of the relay. Mirrors the port forwarding
 * bridge connection path (auth helpers, proxy, jump chain, keepalive) without
 * touching the shared transport pool: a relay is a long-lived dedicated link.
 */
async function dialHost({ event, params = {}, sessionId, logPrefix, state }) {
  const sender = event.sender;
  const {
    hostname,
    hostId,
    port = 22,
    username,
    authMethod,
    requiresMfa,
    password,
    privateKey,
    certificate,
    keyId,
    passphrase,
    knownHosts,
    verifyHostKeys,
    proxy,
    jumpHosts = [],
    identityFilePaths,
    useSshAgent,
    agentPublicKeys,
    identityAgent,
    identitiesOnly,
    addKeysToAgent,
    useKeychain,
    legacyAlgorithms,
    skipEcdsaHostKey,
    algorithmOverrides,
    keepaliveInterval: resolvedKeepaliveInterval,
    keepaliveCountMax: resolvedKeepaliveCountMax,
    sshTcpConnectTimeoutMs,
    sshAuthReadyTimeoutMs,
  } = params;

  if (!hostname) throw new Error("Data relay host is missing a hostname.");

  const connectionTimeouts = resolveSshConnectionTimeouts({
    sshTcpConnectTimeoutMs,
    sshAuthReadyTimeoutMs,
  });
  const passphraseAbortController = new AbortController();
  const chainConnections = [];

  const conn = new SSHClient();
  const keepalivePolicy = resolveConnectionKeepalivePolicy({
    keepaliveInterval: resolvedKeepaliveInterval,
    keepaliveCountMax: resolvedKeepaliveCountMax,
  });
  const connectOpts = {
    host: hostname,
    port,
    username: username || "root",
    timeout: connectionTimeouts.tcpConnectTimeoutMs,
    readyTimeout: 0,
    keepaliveInterval: keepalivePolicy.keepaliveIntervalMs,
    keepaliveCountMax: keepalivePolicy.keepaliveCountMax,
    tryKeyboard: true,
    algorithms: buildAlgorithms(legacyAlgorithms, { skipEcdsaHostKey, algorithmOverrides }),
  };
  connectOpts.hostVerifier = hostKeyVerifier.createHostVerifier({
    sender,
    sessionId,
    hostId,
    hostname,
    port,
    knownHosts,
    verifyHostKeys,
  });

  const hasCertificate = typeof certificate === "string" && certificate.trim().length > 0;
  const fallbackAgentSocket = useSshAgent === false
    ? null
    : useSshAgent === true
      ? undefined
      : await getAvailableAgentSocket(identityAgent, { hostname, port, username });
  const systemAuthAgent = hasCertificate
    ? null
    : await prepareSystemSshAgentForAuth({
      useSshAgent,
      agentPublicKeys,
      identityAgent,
      identityFilePaths,
      identitiesOnly,
      addKeysToAgent,
      useKeychain,
      hostname,
      port,
      username,
    }, logPrefix);
  const identityFile = !privateKey && !systemAuthAgent
    ? await loadFirstIdentityFileForAuth({
      sender,
      identityFilePaths,
      hostname,
      initialPassphrase: passphrase,
      passphraseSignal: passphraseAbortController.signal,
      logPrefix,
      onError: (err, keyPath) => {
        console.warn(`${logPrefix} Failed to read identity file ${keyPath}:`, err.message);
      },
    })
    : null;
  const inlineKey = privateKey && !systemAuthAgent
    ? await preparePrivateKeyForAuth({
      sender,
      privateKey,
      keyId,
      keyName: keyId || username,
      hostname,
      initialPassphrase: passphrase,
      passphraseSignal: passphraseAbortController.signal,
      logPrefix,
    })
    : null;
  const effectivePrivateKey = inlineKey?.privateKey || identityFile?.privateKey;
  const effectivePassphrase = inlineKey?.passphrase || identityFile?.passphrase;

  if (isRelayCancelled(state)) {
    throw Object.assign(new Error("Data relay cancelled"), { code: "DATA_RELAY_CANCELLED" });
  }

  if (systemAuthAgent) connectOpts.agent = systemAuthAgent;
  if (hasCertificate) {
    connectOpts.agent = new NetcattyAgent({
      mode: "certificate",
      webContents: sender,
      meta: {
        label: keyId || username || "",
        certificate,
        privateKey: effectivePrivateKey,
        passphrase: effectivePassphrase,
      },
    });
  } else if (effectivePrivateKey) {
    connectOpts.privateKey = effectivePrivateKey;
    if (effectivePassphrase) connectOpts.passphrase = effectivePassphrase;
  }
  if (password) connectOpts.password = password;

  const discoveredDefaultKeys = await findAllDefaultPrivateKeysFromHelper();
  const defaultKeys = systemAuthAgent && identitiesOnly ? [] : discoveredDefaultKeys;

  const authConfig = buildAuthHandler({
    authMethod,
    requiresMfa: !!requiresMfa,
    privateKey: connectOpts.privateKey,
    password,
    passphrase: connectOpts.passphrase,
    agent: connectOpts.agent,
    username: connectOpts.username,
    logPrefix,
    defaultKeys,
    sshAgentSocketOverride: fallbackAgentSocket,
    allowAgentFallback: useSshAgent !== false,
  });
  applyAuthToConnOpts(connectOpts, authConfig);

  const hasJumpHosts = Array.isArray(jumpHosts) && jumpHosts.length > 0;
  if (hasJumpHosts) {
    const chainResult = await connectThroughChain(
      event,
      {
        hostname,
        port,
        username,
        authMethod,
        password,
        privateKey,
        passphrase,
        useSshAgent,
        identityAgent,
        identityFilePaths,
        identitiesOnly,
        addKeysToAgent,
        useKeychain,
        proxy,
        knownHosts,
        verifyHostKeys,
        jumpHosts,
        legacyAlgorithms,
        skipEcdsaHostKey,
        algorithmOverrides,
        sshTcpConnectTimeoutMs: connectionTimeouts.tcpConnectTimeoutMs,
        sshAuthReadyTimeoutMs: connectionTimeouts.authReadyTimeoutMs,
        _defaultKeys: discoveredDefaultKeys,
        _connectionsRef: chainConnections,
        _tunnelRef: state,
        _passphraseSignal: passphraseAbortController.signal,
        _keyboardInteractiveScope: "external",
      },
      jumpHosts,
      hostname,
      port,
      sessionId,
    );
    chainConnections.push(...(chainResult.connections || []));
    connectOpts.sock = chainResult.socket;
    delete connectOpts.host;
    delete connectOpts.port;
  } else if (proxy) {
    const connectionSocket = await createProxySocket(proxy, hostname, port, {
      timeoutMs: connectionTimeouts.tcpConnectTimeoutMs,
      onSocket: (socket) => {
        state.pendingConn = socket;
      },
    });
    state.pendingConn = null;
    connectOpts.sock = connectionSocket;
    delete connectOpts.host;
    delete connectOpts.port;
  }

  let authBanner = "";
  conn.on("banner", (message) => {
    authBanner = String(message || "").trim();
  });
  conn.on("keyboard-interactive", createKeyboardInteractiveHandler({
    sender,
    sessionId,
    hostId,
    hostname,
    password,
    logPrefix,
    scope: "external",
    getAuthBanner: () => authBanner,
    shouldSkipAutoFill: () => shouldSkipKiPasswordAutoFill(authConfig.authPhase),
  }));

  await new Promise((resolve, reject) => {
    let settled = false;
    let authReadyTimer = null;
    const clearAuthReadyTimer = () => {
      if (authReadyTimer) {
        clearTimeout(authReadyTimer);
        authReadyTimer = null;
      }
    };
    conn.once("connect", () => {
      runWhenProxyConnectionReady(conn._sock, () => {
        try { conn._sock?.setTimeout?.(0); } catch { /* ignore */ }
        clearAuthReadyTimer();
        authReadyTimer = setTimeout(
          () => conn.emit("timeout"),
          connectionTimeouts.authReadyTimeoutMs,
        );
        authReadyTimer.unref?.();
      });
    });
    conn.once("ready", () => {
      clearAuthReadyTimer();
      settled = true;
      resolve();
    });
    conn.on("error", (err) => {
      clearAuthReadyTimer();
      if (settled) return;
      settled = true;
      reject(err);
    });
    conn.once("close", () => {
      clearAuthReadyTimer();
      keyboardInteractiveHandler.cancelRequestsForSession(sessionId, "connection-ended");
      if (settled) return;
      settled = true;
      reject(new Error(`SSH connection to ${hostname} closed before it was ready.`));
    });
    conn.once("timeout", () => {
      clearAuthReadyTimer();
      if (settled) return;
      settled = true;
      reject(new Error(`Connection timeout to ${hostname}`));
      try { conn.end(); } catch { /* ignore */ }
    });

    try {
      conn.connect(connectOpts);
    } catch (error) {
      clearAuthReadyTimer();
      if (!settled) {
        settled = true;
        reject(error);
      }
    }
  });

  return { conn, chainConnections };
}

/** Release every resource owned by a relay and update its projected phase. */
function releaseRelayResources(state) {
  if (!state) return;
  try { terminateSshExecStream(state.execStream); } catch { /* ignore */ }
  state.execStream = null;
  try { state.writeStream?.end?.(); } catch { /* ignore */ }
  try { state.writeStream?.destroy?.(); } catch { /* ignore */ }
  state.writeStream = null;
  try { closeSftpChannel(state.sftp); } catch { /* ignore */ }
  state.sftp = null;
  cleanupChainConnections(state.chainConnections);
  state.chainConnections = [];
  try { state.sourceConn?.end?.(); } catch { /* ignore */ }
  try { state.destConn?.end?.(); } catch { /* ignore */ }
  state.sourceConn = null;
  state.destConn = null;
}

/** Terminal transition for a relay that ended or failed. */
function finalizeRelay(relayId, state, error) {
  if (!state || state.finalized) return;
  state.finalized = true;
  releaseRelayResources(state);
  if (error && !state.cancelled) {
    state.status = "error";
    state.error = error?.message || String(error);
  } else {
    state.status = "inactive";
    state.error = undefined;
  }
  publishRuntimeUpsert(relayId, state);
  // Keep the record discoverable so late subscribers can observe the final
  // phase, but drop the entry once nothing needs the sockets anymore.
  if (state.status === "inactive") {
    state.lastUsedAt = Date.now();
  }
}

/**
 * Start a relay: dial both hosts, stream the source command's stdout into the
 * destination file, then report `active`. The link keeps running until the
 * source command exits, the write fails, or the user stops it.
 */
async function startDataRelay(event, payload = {}) {
  const {
    ruleId,
    relayId,
    source,
    destination,
    sourceCommand,
    destPath,
    writeMode = "overwrite",
    knownHosts,
    verifyHostKeys,
  } = payload;

  if (!relayId) {
    return { relayId, success: false, error: "relayId is required." };
  }
  if (!sourceCommand || !String(sourceCommand).trim()) {
    return { relayId, success: false, error: "sourceCommand is required." };
  }
  if (!destPath || !String(destPath).trim()) {
    return { relayId, success: false, error: "destPath is required." };
  }

  // Reuse a live relay for the same durable rule (multi-window safety).
  if (ruleId) {
    for (const [existingRelayId, existingState] of dataRelays) {
      if (existingState.ruleId !== ruleId) continue;
      if (existingState.cancelled) continue;
      if (existingState.status === "active" || existingState.status === "connecting") {
        return {
          relayId: existingRelayId,
          success: true,
          reused: true,
          status: existingState.status,
        };
      }
    }
  }

  const sender = event.sender;
  const state = {
    relayId,
    ruleId,
    status: "connecting",
    error: undefined,
    bytesTransferred: 0,
    sourceConn: null,
    destConn: null,
    execStream: null,
    sftp: null,
    writeStream: null,
    chainConnections: [],
    pendingConn: null,
    cancelled: false,
    finalized: false,
    cleanupInProgress: false,
    webContentsId: sender?.id,
    subscribers: new Map(),
    updatedAt: Date.now(),
  };
  if (sender && Number.isSafeInteger(sender.id)) {
    state.subscribers.set(sender.id, sender);
  }
  dataRelays.set(relayId, state);
  publishRuntimeUpsert(relayId, state);

  try {
    const sharedParams = {
      knownHosts,
      verifyHostKeys,
    };

    const sourceDial = await dialHost({
      event,
      params: { ...sharedParams, ...source },
      sessionId: `${relayId}:source`,
      logPrefix: "[DataRelay]",
      state,
    });
    state.sourceConn = sourceDial.conn;
    state.chainConnections.push(...sourceDial.chainConnections);
    if (isRelayCancelled(state)) {
      finalizeRelay(relayId, state, null);
      return { relayId, success: false, cancelled: true };
    }

    const destDial = await dialHost({
      event,
      params: { ...sharedParams, ...destination },
      sessionId: `${relayId}:dest`,
      logPrefix: "[DataRelay]",
      state,
    });
    state.destConn = destDial.conn;
    state.chainConnections.push(...destDial.chainConnections);
    if (isRelayCancelled(state)) {
      finalizeRelay(relayId, state, null);
      return { relayId, success: false, cancelled: true };
    }

    const execStream = await openBoundedSshExecStream(
      state.sourceConn,
      String(sourceCommand),
      {},
      {},
    );
    state.execStream = execStream;
    if (isRelayCancelled(state)) {
      finalizeRelay(relayId, state, null);
      return { relayId, success: false, cancelled: true };
    }

    const sftp = await openBoundedSftpChannel(state.destConn, {});
    if (!sftp) {
      throw new Error("The destination host did not provide an SFTP channel.");
    }
    state.sftp = sftp;
    const flags = String(writeMode).toLowerCase() === "append" ? "a" : "w";
    const writeStream = sftp.createWriteStream(String(destPath), { flags });
    state.writeStream = writeStream;

    // Track transfer progress without altering the byte stream.
    execStream.on("data", (chunk) => {
      state.bytesTransferred += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
    });

    // The source command ending closes the write stream so the remote file is
    // flushed and the SFTP channel is released.
    execStream.on("close", () => {
      try { state.writeStream?.end?.(); } catch { /* ignore */ }
    });
    const onStreamError = (error) => finalizeRelay(relayId, state, error);
    execStream.on("error", onStreamError);
    writeStream.on("error", onStreamError);
    writeStream.on("close", () => {
      if (!state.cancelled) finalizeRelay(relayId, state, null);
    });

    // `pipe` provides natural backpressure: a slow destination slows the read
    // from the source instead of buffering the whole stream in memory.
    execStream.pipe(writeStream);

    state.status = "active";
    publishRuntimeUpsert(relayId, state);
    return {
      relayId,
      success: true,
      status: "active",
      ruleId,
    };
  } catch (error) {
    if (isRelayCancelled(state)) {
      finalizeRelay(relayId, state, null);
      return { relayId, success: false, cancelled: true };
    }
    finalizeRelay(relayId, state, error);
    return {
      relayId,
      success: false,
      error: error?.message || String(error),
    };
  }
}

/** Stop a relay (user action, rule update, or app shutdown cleanup). */
async function stopDataRelay(event, payload = {}) {
  const { relayId } = payload;
  const state = dataRelays.get(relayId);
  if (!state) {
    return { relayId, success: false, error: "Data relay not found" };
  }
  state.cancelled = true;
  state.cleanupInProgress = true;
  if (state.status !== "active" && state.status !== "connecting") {
    state.cleanupInProgress = false;
    return { relayId, success: true };
  }
  finalizeRelay(relayId, state, null);
  state.cleanupInProgress = false;
  dataRelays.delete(relayId);
  publishRuntimeRemove(relayId, state.ruleId);
  return { relayId, success: true };
}

async function stopDataRelayByRuleId(_event, payload = {}) {
  const { ruleId } = payload;
  if (!ruleId) return { stopped: 0, failed: 0 };
  let stopped = 0;
  let failed = 0;
  for (const [relayId, state] of [...dataRelays]) {
    if (state.ruleId !== ruleId) continue;
    try {
      state.cancelled = true;
      finalizeRelay(relayId, state, null);
      dataRelays.delete(relayId);
      publishRuntimeRemove(relayId, state.ruleId);
      stopped += 1;
    } catch {
      failed += 1;
    }
  }
  return { stopped, failed };
}

async function stopAllDataRelays() {
  let stopped = 0;
  let failed = 0;
  for (const [relayId, state] of [...dataRelays]) {
    try {
      state.cancelled = true;
      finalizeRelay(relayId, state, null);
      dataRelays.delete(relayId);
      publishRuntimeRemove(relayId, state.ruleId);
      stopped += 1;
    } catch {
      failed += 1;
    }
  }
  return { stopped, failed };
}

async function getDataRelayStatus(_event, payload = {}) {
  const { relayId } = payload;
  const state = dataRelays.get(relayId);
  if (!state) return { relayId, status: "inactive" };
  return {
    relayId,
    status: state.status || "active",
    ...(state.error ? { error: state.error } : {}),
    bytesTransferred: Number(state.bytesTransferred) || 0,
  };
}

/** Remove a destroyed renderer from all relay subscriptions in this process. */
async function unsubscribeDataRelaySender(event, payload = {}) {
  const webContentsId = payload.webContentsId ?? event?.sender?.id;
  if (!Number.isSafeInteger(webContentsId)) return { removed: 0 };
  let removed = 0;
  for (const state of dataRelays.values()) {
    if (state.subscribers instanceof Map && state.subscribers.delete(webContentsId)) {
      removed += 1;
    }
  }
  const runtimeEntry = runtimeEventSubscribers.get(webContentsId);
  if (runtimeEntry) {
    if (runtimeEntry.onDestroyed) {
      runtimeEntry.sender.removeListener?.("destroyed", runtimeEntry.onDestroyed);
    }
    runtimeEventSubscribers.delete(webContentsId);
    removed += 1;
  }
  return { removed };
}

/**
 * Register IPC handlers for data relay operations.
 */
function registerHandlers(ipcMain) {
  ipcMain.handle("netcatty:datarelay:start", startDataRelay);
  ipcMain.handle("netcatty:datarelay:stop", stopDataRelay);
  ipcMain.handle("netcatty:datarelay:status", getDataRelayStatus);
  ipcMain.handle("netcatty:datarelay:snapshot", () => getDataRelaySnapshot());
  ipcMain.handle("netcatty:datarelay:subscribeRuntime", subscribeDataRelayRuntime);
  ipcMain.handle("netcatty:datarelay:unsubscribeRuntime", unsubscribeDataRelayRuntime);
  ipcMain.handle("netcatty:datarelay:stopAll", () => stopAllDataRelays());
  ipcMain.handle("netcatty:datarelay:stopByRuleId", stopDataRelayByRuleId);
  ipcMain.handle("netcatty:datarelay:unsubscribeSender", unsubscribeDataRelaySender);
}

module.exports = {
  registerHandlers,
  startDataRelay,
  stopDataRelay,
  getDataRelayStatus,
  getDataRelaySnapshot,
  subscribeDataRelayRuntime,
  unsubscribeDataRelayRuntime,
  stopAllDataRelays,
  stopDataRelayByRuleId,
  unsubscribeDataRelaySender,
  _resetDataRelayRuntimeMetaForTests: () => {
    runtimeRevision = 0;
    runtimeEventSubscribers.clear();
    dataRelays.clear();
  },
};
