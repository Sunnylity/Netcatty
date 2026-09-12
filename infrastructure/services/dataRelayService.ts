/**
 * Data Relay Service
 * Bridges the renderer and the Electron backend for streaming a source
 * command's output into a file on a second host.
 *
 * Unlike port forwarding (which exposes a socket), a data relay runs entirely
 * in the main process: the source stdout is piped into an SFTP write stream.
 */

import {
  DataRelayRule,
  Host,
  Identity,
  KnownHost,
  SSHKey,
  TerminalSettings,
} from '../../domain/models';
import { resolveBridgeKeyAuth, resolveBridgeSshAgentAuth, resolveHostAuth } from '../../domain/sshAuth';
import { resolveHostKeepalive } from '../../domain/host';
import { resolveHostSshConnectionTimeouts } from '../../domain/sshConnectionTimeouts';
import {
  findIncompleteProxyIdentityId,
  findMissingProxyIdentityId,
  formatIncompleteProxyIdentityMessage,
  formatMissingProxyIdentityMessage,
  hasUnreadableProxyCredential,
  hasUsableProxyConfig,
  resolveProxyConfigAuth,
} from '../../domain/proxyProfiles';
import { isEncryptedCredentialPlaceholder, sanitizeCredentialValue } from '../../domain/credentials';
import { logger } from '../../lib/logger';
import { resolveDataRelayDestPath } from '../../domain/dataRelayPaths';
import { netcattyBridge } from './netcattyBridge';

const FALLBACK_TERMINAL_SETTINGS = {
  verifyHostKeys: true,
  keepaliveInterval: 30,
  keepaliveCountMax: 10,
};

export interface DataRelayConnection {
  ruleId: string;
  relayId: string;
  status: DataRelayRule['status'];
  error?: string;
  bytesTransferred?: number;
}

/** Tracked locally so the hook can project status without a backend round-trip. */
const activeRelays = new Map<string, DataRelayConnection>();

export const getActiveDataRelay = (ruleId: string): DataRelayConnection | undefined =>
  activeRelays.get(ruleId);

export const getActiveDataRelayRuleIds = (): string[] => [...activeRelays.keys()];

export const hasActiveDataRelayRuntime = (): boolean => activeRelays.size > 0;

export const isDataRelayBackendAvailable = (): boolean =>
  !!netcattyBridge.get()?.startDataRelay;

/** Resolve one host into the bridge's connection payload (no listener fields). */
function buildEndpointPayload(
  host: Host,
  hosts: Host[],
  keys: SSHKey[],
  identities: Identity[],
  verifyHostKeys: boolean,
): DataRelayEndpointOptions {
  const hostLabel = host.label || host.hostname;

  if (host.proxyProfileId && !host.proxyConfig) {
    throw new Error(`Saved proxy for host "${hostLabel}" is missing. Open host settings and select a valid proxy.`);
  }
  if (findMissingProxyIdentityId(host.proxyConfig, identities)) {
    throw new Error(formatMissingProxyIdentityMessage(hostLabel));
  }
  if (findIncompleteProxyIdentityId(host.proxyConfig, identities)) {
    throw new Error(formatIncompleteProxyIdentityMessage(hostLabel));
  }

  const resolved = resolveHostAuth({ host, keys, identities });
  const key = resolved.key;
  const proxy = hasUsableProxyConfig(host.proxyConfig)
    ? resolveProxyConfigAuth(host.proxyConfig, identities)
    : undefined;
  if (proxy && hasUnreadableProxyCredential(host.proxyConfig, identities)) {
    throw new Error('Proxy credentials cannot be decrypted on this device. Open host settings and re-enter the proxy password.');
  }

  const keyAuth = resolveBridgeKeyAuth({
    key,
    fallbackIdentityFilePaths: resolved.authMethod === 'password' || resolved.keyId
      ? undefined
      : host.identityFilePaths,
    passphrase: resolved.passphrase,
  });
  const agentAuth = resolveBridgeSshAgentAuth(host, key, resolved.authMethod);
  const password = sanitizeCredentialValue(resolved.password);
  const hasKeyMaterial = Boolean(
    agentAuth.useSshAgent || keyAuth.privateKey || keyAuth.identityFilePaths?.length,
  );
  const hasUnreadableCredential =
    isEncryptedCredentialPlaceholder(resolved.password)
    || isEncryptedCredentialPlaceholder(key?.privateKey)
    || isEncryptedCredentialPlaceholder(resolved.passphrase);
  if (
    (resolved.authMethod === 'password' && isEncryptedCredentialPlaceholder(resolved.password) && !password)
    || (resolved.authMethod !== 'password' && resolved.authMethod !== 'auto' && hasUnreadableCredential && !password && !hasKeyMaterial)
  ) {
    throw new Error('Saved credentials cannot be decrypted on this device. Open host settings and re-enter them.');
  }

  // Optional jump host chain (bastion) in front of this endpoint.
  let jumpHosts: NetcattyJumpHost[] | undefined;
  if (host.hostChain?.hostIds?.length) {
    const resolvedJumpHosts = host.hostChain.hostIds.map((hostId) =>
      hosts.find((candidate) => candidate.id === hostId),
    );
    const missingJumpHostIds = host.hostChain.hostIds.filter((_, index) => !resolvedJumpHosts[index]);
    if (missingJumpHostIds.length > 0) {
      throw new Error(`Missing jump host configuration for host chain: ${missingJumpHostIds.join(', ')}`);
    }
    jumpHosts = resolvedJumpHosts
      .filter((jumpHost): jumpHost is Host => Boolean(jumpHost))
      .map((jumpHost, index) => {
        const jumpLabel = jumpHost.label || jumpHost.hostname;
        if (jumpHost.proxyProfileId && !jumpHost.proxyConfig) {
          throw new Error(`Saved proxy for jump host "${jumpLabel}" is missing. Open host settings and select a valid proxy.`);
        }
        const jumpResolved = resolveHostAuth({ host: jumpHost, keys, identities });
        const jumpKey = jumpResolved.key;
        const jumpKeyAuth = resolveBridgeKeyAuth({
          key: jumpKey,
          fallbackIdentityFilePaths: jumpResolved.authMethod === 'password' || jumpResolved.keyId
            ? undefined
            : jumpHost.identityFilePaths,
          passphrase: jumpResolved.passphrase,
        });
        const jumpAgentAuth = resolveBridgeSshAgentAuth(jumpHost, jumpKey, jumpResolved.authMethod);
        const hopKeepalive = resolveHostKeepalive(jumpHost, FALLBACK_TERMINAL_SETTINGS);
        const hopTimeouts = resolveHostSshConnectionTimeouts(jumpHost);
        const hasConfiguredJumpProxyEndpoint =
          index === 0 && hasUsableProxyConfig(jumpHost.proxyConfig);
        return {
          hostname: jumpHost.hostname,
          hostId: jumpHost.id,
          port: jumpHost.port || 22,
          username: jumpResolved.username || 'root',
          authMethod: jumpResolved.authMethod,
          requiresMfa: !!jumpHost.requiresMfa,
          password: sanitizeCredentialValue(jumpResolved.password),
          privateKey: jumpKeyAuth.privateKey,
          certificate: jumpKey?.certificate,
          passphrase: jumpKeyAuth.passphrase,
          publicKey: jumpKey?.publicKey,
          keyId: jumpResolved.keyId,
          keySource: jumpKey?.source,
          label: jumpHost.label,
          proxy: hasConfiguredJumpProxyEndpoint
            ? resolveProxyConfigAuth(jumpHost.proxyConfig!, identities)
            : undefined,
          identityFilePaths: jumpKeyAuth.identityFilePaths,
          ...jumpAgentAuth,
          keepaliveInterval: hopKeepalive.interval,
          keepaliveCountMax: hopKeepalive.countMax,
          sshTcpConnectTimeoutMs: hopTimeouts.tcpConnectTimeoutSeconds * 1000,
          sshAuthReadyTimeoutMs: hopTimeouts.authReadyTimeoutSeconds * 1000,
          verifyHostKeys,
          legacyAlgorithms: jumpHost.legacyAlgorithms,
          skipEcdsaHostKey: jumpHost.skipEcdsaHostKey,
          algorithmOverrides: jumpHost.algorithms,
        };
      });
  }

  const keepalive = resolveHostKeepalive(host, FALLBACK_TERMINAL_SETTINGS);
  const timeouts = resolveHostSshConnectionTimeouts(host);

  return {
    hostname: host.hostname,
    hostId: host.id,
    port: host.port,
    username: resolved.username,
    authMethod: resolved.authMethod,
    requiresMfa: !!host.requiresMfa,
    password,
    privateKey: keyAuth.privateKey,
    certificate: key?.certificate,
    keyId: resolved.keyId,
    passphrase: keyAuth.passphrase,
    verifyHostKeys,
    proxy,
    jumpHosts: jumpHosts && jumpHosts.length > 0 ? jumpHosts : undefined,
    identityFilePaths: keyAuth.identityFilePaths,
    ...agentAuth,
    legacyAlgorithms: host.legacyAlgorithms,
    skipEcdsaHostKey: host.skipEcdsaHostKey,
    algorithmOverrides: host.algorithms,
    keepaliveInterval: keepalive.interval,
    keepaliveCountMax: keepalive.countMax,
    sshTcpConnectTimeoutMs: timeouts.tcpConnectTimeoutSeconds * 1000,
    sshAuthReadyTimeoutMs: timeouts.authReadyTimeoutSeconds * 1000,
  };
}

export interface DataRelayStartResult {
  success: boolean;
  error?: string;
}

/** Start (or reuse) the relay for a saved rule. */
export const startDataRelay = async (
  rule: DataRelayRule,
  hosts: Host[],
  keys: SSHKey[],
  identities: Identity[],
  onStatusChange: (status: DataRelayRule['status'], error?: string) => void,
  terminalSettings?: Pick<TerminalSettings, 'verifyHostKeys' | 'keepaliveInterval' | 'keepaliveCountMax'>,
  knownHosts?: KnownHost[],
): Promise<DataRelayStartResult> => {
  const globalTerminalSettings = { ...FALLBACK_TERMINAL_SETTINGS, ...(terminalSettings ?? {}) };
  const bridge = netcattyBridge.get();
  if (!bridge?.startDataRelay) {
    logger.warn('[DataRelayService] Backend not available for data relay.');
    const error = 'Data relay backend is unavailable.';
    onStatusChange('error', error);
    return { success: false, error };
  }

  const existing = activeRelays.get(rule.id);
  if (existing && (existing.status === 'active' || existing.status === 'connecting')) {
    onStatusChange(existing.status, existing.error);
    return { success: true };
  }

  const sourceHost = hosts.find((host) => host.id === rule.sourceHostId);
  if (!sourceHost) {
    const error = `Source host "${rule.sourceHostId}" was not found.`;
    onStatusChange('error', error);
    return { success: false, error };
  }
  const destHost = hosts.find((host) => host.id === rule.destHostId);
  if (!destHost) {
    const error = `Destination host "${rule.destHostId}" was not found.`;
    onStatusChange('error', error);
    return { success: false, error };
  }

  try {
    const source = buildEndpointPayload(sourceHost, hosts, keys, identities, globalTerminalSettings.verifyHostKeys);
    const destination = buildEndpointPayload(destHost, hosts, keys, identities, globalTerminalSettings.verifyHostKeys);
    const relayId = `dr-${rule.id}-${Date.now()}`;

    onStatusChange('connecting');
    activeRelays.set(rule.id, { ruleId: rule.id, relayId, status: 'connecting' });

    const result = await bridge.startDataRelay({
      ruleId: rule.id,
      relayId,
      source,
      destination,
      sourceCommand: rule.sourceCommand,
      destPath: resolveDataRelayDestPath(rule.sourcePath ?? '', rule.destPath),
      writeMode: rule.writeMode,
      knownHosts,
      verifyHostKeys: globalTerminalSettings.verifyHostKeys,
    });

    if (!result?.success) {
      if (result?.cancelled) {
        activeRelays.delete(rule.id);
        onStatusChange('inactive');
        return { success: false, error: undefined };
      }
      activeRelays.delete(rule.id);
      onStatusChange('error', result?.error);
      return { success: false, error: result?.error };
    }

    const status: DataRelayRule['status'] = result.status === 'active' ? 'active' : 'connecting';
    activeRelays.set(rule.id, {
      ruleId: rule.id,
      relayId: result.relayId || relayId,
      status,
    });
    onStatusChange(status);
    return { success: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    activeRelays.delete(rule.id);
    onStatusChange('error', error);
    return { success: false, error };
  }
};

/** Stop the relay belonging to a rule (no-op when it is not running). */
export const stopDataRelay = async (
  ruleId: string,
  onStatusChange?: (status: DataRelayRule['status'], error?: string) => void,
): Promise<{ success: boolean; error?: string }> => {
  const bridge = netcattyBridge.get();
  activeRelays.delete(ruleId);
  onStatusChange?.('inactive');
  if (!bridge?.stopDataRelayByRuleId) return { success: true };
  try {
    await bridge.stopDataRelayByRuleId(ruleId);
    return { success: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.warn('[DataRelayService] Failed to stop relay:', error);
    return { success: false, error };
  }
};

/** Stop every running relay (bulk stop / shutdown). */
export const stopAllActiveDataRelays = async (): Promise<{
  stopped: number;
  failed: number;
  errors: string[];
}> => {
  const bridge = netcattyBridge.get();
  const pendingRules = [...activeRelays.keys()];
  activeRelays.clear();
  if (!bridge?.stopAllDataRelays) {
    return { stopped: 0, failed: 0, errors: [] };
  }
  try {
    const result = await bridge.stopAllDataRelays();
    return { stopped: result?.stopped ?? 0, failed: result?.failed ?? 0, errors: [] };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { stopped: 0, failed: pendingRules.length, errors: [error] };
  }
};

/** Authoritative runtime snapshot from the main process. */
export const fetchDataRelaySnapshot = async (): Promise<DataRelayRuntimeSnapshot> => {
  const bridge = netcattyBridge.get();
  if (!bridge?.getDataRelaySnapshot) {
    return { epoch: '', revision: 0, records: [] };
  }
  return bridge.getDataRelaySnapshot();
};

/**
 * Subscribe to runtime upsert/remove events. Returns an unsubscribe function.
 */
export const subscribeDataRelayRuntime = async (
  callback: DataRelayRuntimeEventCallback,
): Promise<() => void> => {
  const bridge = netcattyBridge.get();
  if (!bridge?.subscribeDataRelayRuntime || !bridge?.onDataRelayRuntime) {
    return () => undefined;
  }
  const unsubscribe = bridge.onDataRelayRuntime(callback);
  await bridge.subscribeDataRelayRuntime();
  return () => {
    unsubscribe?.();
    void bridge.unsubscribeDataRelayRuntime?.();
  };
};

export default {
  startDataRelay,
  stopDataRelay,
  stopAllActiveDataRelays,
  fetchDataRelaySnapshot,
  subscribeDataRelayRuntime,
  getActiveDataRelay,
  getActiveDataRelayRuleIds,
  hasActiveDataRelayRuntime,
  isDataRelayBackendAvailable,
};
