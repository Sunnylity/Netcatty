import { useCallback, useEffect, useRef } from "react";
import type {
  DataRelayRule,
  DataRelayScanCheckpoint,
  Host,
  Identity,
  KnownHost,
  RemoteFile,
  SSHKey,
  TerminalSettings,
} from "../../domain/models";
import {
  compareDataRelayTreesPaired,
  collectDataRelayCompareTree,
  parentDataRelayRelativePath,
  type DataRelayCompareFile,
} from "../../domain/dataRelayCompare";
import { resolveDataRelayViewerStart, usesWindowsDataRelayPath, getDataRelayFileName } from "../../domain/dataRelayPaths";
import {
  isDataRelayFolderScanRule,
  listDataRelayScanCopyItemsFromCheckpoint,
  listDataRelayScanCopyItemsFromMtime,
  mergeDataRelayScanCheckpoint,
  normalizeDataRelayScanIntervalMs,
  normalizeDataRelayScanMode,
  remainingDataRelayScanDelayMs,
  shouldCompareDataRelayScanAgainstDest,
} from "../../domain/dataRelayScan";
import { isWindowsPath, isWindowsRoot, joinPath, joinTransferTargetPath } from "./sftp/utils";
import { sftpTransferCenterStore } from "./sftpTransferCenterStore";
import { buildSftpHostCredentials } from "./sftp/useSftpHostCredentials";
import { useSftpBackend } from "./useSftpBackend";
import { netcattyBridge } from "../../infrastructure/services/netcattyBridge";
import { resolveDataRelayEndpoint } from "../../domain/dataRelayLocal";

interface FolderScanSession {
  cancelled: boolean;
  sourceSftpId: string | null;
  destSftpId: string | null;
  waitTimer: ReturnType<typeof setTimeout> | null;
  waitResolve: (() => void) | null;
}

export interface UseDataRelayFolderScanParams {
  getRule: (ruleId: string) => DataRelayRule | undefined;
  hosts: Host[];
  keys: SSHKey[];
  identities: Identity[];
  knownHosts?: KnownHost[];
  terminalSettings?: Pick<
    TerminalSettings,
    "verifyHostKeys" | "keepaliveInterval" | "keepaliveCountMax"
  >;
  onStatus: (ruleId: string, status: DataRelayRule["status"], error?: string) => void;
  onBytes: (ruleId: string, bytesTransferred: number) => void;
  onCheckpoint: (ruleId: string, checkpoint: DataRelayScanCheckpoint) => void;
}

const toCompareFile = (file: RemoteFile): DataRelayCompareFile | null => {
  if (!file.name || file.name === "." || file.name === "..") return null;
  return {
    name: file.name,
    type: file.type,
    linkTarget: file.linkTarget,
    size: Number.parseInt(String(file.size), 10) || 0,
    lastModified: new Date(file.lastModified).getTime() || 0,
  };
};

const sleep = (session: FolderScanSession, ms: number): Promise<void> => {
  if (session.cancelled || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    session.waitResolve = resolve;
    session.waitTimer = setTimeout(() => {
      session.waitTimer = null;
      session.waitResolve = null;
      resolve();
    }, ms);
  });
};

const cancelWait = (session: FolderScanSession) => {
  if (session.waitTimer) clearTimeout(session.waitTimer);
  session.waitTimer = null;
  const resolve = session.waitResolve;
  session.waitResolve = null;
  resolve?.();
};

export function useDataRelayFolderScan({
  getRule,
  hosts,
  keys,
  identities,
  knownHosts,
  terminalSettings,
  onStatus,
  onBytes,
  onCheckpoint,
}: UseDataRelayFolderScanParams) {
  const {
    openSftp,
    closeSftp,
    listSftp,
    getSftpHomeDir,
    mkdirSftp,
    startStreamTransfer,
  } = useSftpBackend();
  const sessionsRef = useRef(new Map<string, FolderScanSession>());
  const getRuleRef = useRef(getRule);
  getRuleRef.current = getRule;
  const credsRef = useRef({ hosts, keys, identities, knownHosts, terminalSettings });
  credsRef.current = { hosts, keys, identities, knownHosts, terminalSettings };
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
  const onBytesRef = useRef(onBytes);
  onBytesRef.current = onBytes;
  const onCheckpointRef = useRef(onCheckpoint);
  onCheckpointRef.current = onCheckpoint;

  const releaseSftp = useCallback(async (sftpId: string | null) => {
    if (!sftpId) return;
    try {
      await closeSftp(sftpId);
    } catch {
      // Best-effort: the main process still owns session cleanup.
    }
  }, [closeSftp]);

  const stopScan = useCallback(async (ruleId: string) => {
    const session = sessionsRef.current.get(ruleId);
    if (!session) return;
    session.cancelled = true;
    cancelWait(session);
    sessionsRef.current.delete(ruleId);
    const sourceId = session.sourceSftpId;
    const destId = session.destSftpId;
    session.sourceSftpId = null;
    session.destSftpId = null;
    await Promise.all([releaseSftp(sourceId), releaseSftp(destId)]);
  }, [releaseSftp]);

  const stopAllScans = useCallback(async () => {
    const ruleIds = [...sessionsRef.current.keys()];
    await Promise.all(ruleIds.map((ruleId) => stopScan(ruleId)));
  }, [stopScan]);

  const listDirectory = useCallback(async (sftpId: string | null, path: string): Promise<DataRelayCompareFile[]> => {
    const raw = sftpId
      ? await listSftp(sftpId, path)
      : await (async () => {
        const bridge = netcattyBridge.get();
        if (!bridge?.listLocalDir) throw new Error("Local filesystem bridge unavailable");
        return bridge.listLocalDir(path);
      })();
    const files: DataRelayCompareFile[] = [];
    for (const file of raw ?? []) {
      const mapped = toCompareFile(file);
      if (mapped) files.push(mapped);
    }
    return files;
  }, [listSftp]);

  const getSideHomeDir = useCallback(async (sftpId: string | null): Promise<string> => {
    if (!sftpId) {
      const bridge = netcattyBridge.get();
      if (!bridge?.getHomeDir) throw new Error("Local filesystem bridge unavailable");
      return (await bridge.getHomeDir()) || "/";
    }
    return (await getSftpHomeDir(sftpId))?.homeDir?.trim() || "/";
  }, [getSftpHomeDir]);

  const mkdirOnSide = useCallback(async (sftpId: string | null, path: string): Promise<void> => {
    if (!sftpId) {
      const bridge = netcattyBridge.get();
      if (!bridge?.mkdirLocal) throw new Error("Local filesystem bridge unavailable");
      await bridge.mkdirLocal(path);
      return;
    }
    await mkdirSftp(sftpId, path);
  }, [mkdirSftp]);

  const runPass = useCallback(async (rule: DataRelayRule, session: FolderScanSession) => {
    // A null sftp id marks the local-machine endpoint of the relay.
    const sourceSftpId = session.sourceSftpId;
    const destSftpId = session.destSftpId;

    const creds = credsRef.current;
    const sourceEndpoint = resolveDataRelayEndpoint(rule.sourceHostId, creds.hosts);
    const destEndpoint = resolveDataRelayEndpoint(rule.destHostId, creds.hosts);
    if (!sourceEndpoint || !destEndpoint) throw new Error("Relay hosts were not found.");
    const transferDirection = sourceEndpoint.isLocal
      ? "upload"
      : destEndpoint.isLocal
        ? "download"
        : "remote-to-remote";

    const [sourceHome, destHome] = await Promise.all([
      getSideHomeDir(sourceSftpId),
      getSideHomeDir(destSftpId),
    ]);
    if (session.cancelled) return;
    const sourcePath = resolveDataRelayViewerStart(rule.sourcePath, sourceHome).listPath;
    const destPath = resolveDataRelayViewerStart(rule.destPath, destHome).listPath;
    const caseInsensitive = usesWindowsDataRelayPath(sourcePath) || usesWindowsDataRelayPath(destPath);
    const mode = normalizeDataRelayScanMode(rule.scanMode);
    const joinAbsolute = joinPath;
    const cancelled = () => session.cancelled;

    let copyItems;
    let sourceEntries;
    let pruneMissing = false;
    let seedAll = false;
    if (shouldCompareDataRelayScanAgainstDest(rule)) {
      const destIsRoot = destPath === "/" || (isWindowsPath(destPath) && isWindowsRoot(destPath));
      if (!destIsRoot) {
        try {
          await mkdirOnSide(destSftpId, destPath);
        } catch {
          // Destination folder may already exist.
        }
      }
      if (session.cancelled) return;
      const result = await compareDataRelayTreesPaired(
        sourcePath,
        destPath,
        (side, path) => listDirectory(side === "left" ? sourceSftpId : destSftpId, path),
        { joinAbsolute, cancelled, caseInsensitive },
      );
      if (session.cancelled) return;
      copyItems = listDataRelayScanCopyItemsFromMtime(result.diffs);
      if (mode === "checkpoint") {
        const tree = await collectDataRelayCompareTree(
          sourcePath,
          (path) => listDirectory(sourceSftpId, path),
          { joinAbsolute, cancelled },
        );
        if (session.cancelled) return;
        sourceEntries = tree.entries;
        pruneMissing = true;
        seedAll = true;
      } else {
        sourceEntries = copyItems.map((item) => (
          item.type === "directory"
            ? {
              name: item.relativePath.split("/").pop() || item.relativePath,
              relativePath: item.relativePath,
              type: "directory" as const,
              size: 0,
              lastModified: 0,
            }
            : { ...item.file, relativePath: item.relativePath }
        ));
      }
    } else {
      const tree = await collectDataRelayCompareTree(
        sourcePath,
        (path) => listDirectory(sourceSftpId, path),
        { joinAbsolute, cancelled },
      );
      if (session.cancelled) return;
      copyItems = listDataRelayScanCopyItemsFromCheckpoint(tree.entries, rule.scanCheckpoint);
      sourceEntries = tree.entries;
      pruneMissing = true;
    }
    const copiedPaths = new Set<string>();
    const failedPaths = new Set<string>();
    let bytesCopied = 0;

    for (const item of copyItems) {
      if (session.cancelled) return;
      try {
        if (item.type === "directory") {
          try {
            await mkdirOnSide(destSftpId, joinTransferTargetPath(destPath, item.relativePath));
          } catch {
            // Directory may already exist on the destination.
          }
          copiedPaths.add(item.relativePath);
          continue;
        }
        const parentRel = parentDataRelayRelativePath(item.relativePath);
        if (parentRel) {
          try {
            await mkdirOnSide(destSftpId, joinTransferTargetPath(destPath, parentRel));
          } catch {
            // Parent directory may already exist on the destination.
          }
        }
        const sourceAbsPath = joinTransferTargetPath(sourcePath, item.relativePath);
        const targetAbsPath = joinTransferTargetPath(destPath, item.relativePath);
        const transferId = `relay-scan-${rule.id}-${Date.now()}-${item.relativePath}`;
        // Register the copy as a transfer-center task before it starts so it
        // shows in the transfer panel while running: main-process lifecycle and
        // progress events are keyed on transferId and keep the row updated.
        // The post-await patches are a fallback for event loss.
        sftpTransferCenterStore.upsertTasks([{
          id: transferId,
          fileName: getDataRelayFileName(item.relativePath),
          sourcePath: sourceAbsPath,
          targetPath: targetAbsPath,
          sourceConnectionId: sourceSftpId ?? "local",
          targetConnectionId: destSftpId ?? "local",
          sourceHostId: rule.sourceHostId,
          targetHostId: rule.destHostId,
          sourceHostLabel: sourceEndpoint.isLocal ? "Local" : sourceEndpoint.host.label,
          targetHostLabel: destEndpoint.isLocal ? "Local" : destEndpoint.host.label,
          direction: transferDirection,
          status: "queued",
          totalBytes: item.file.size,
          transferredBytes: 0,
          speed: 0,
          startTime: Date.now(),
          isDirectory: false,
          sourceLastModified: item.file.lastModified,
          retryable: false,
        }]);
        const result = await startStreamTransfer({
          transferId,
          sourcePath: sourceAbsPath,
          targetPath: targetAbsPath,
          sourceType: sourceEndpoint.isLocal ? "local" : "sftp",
          targetType: destEndpoint.isLocal ? "local" : "sftp",
          ...(sourceSftpId ? { sourceSftpId } : {}),
          ...(destSftpId ? { targetSftpId: destSftpId } : {}),
          sourceHostId: rule.sourceHostId,
          targetHostId: rule.destHostId,
          totalBytes: item.file.size,
          sourceLastModified: item.file.lastModified,
          skipAdmission: true,
        });
        if (result?.error || result?.cancelled) {
          sftpTransferCenterStore.patchTask(transferId, {
            status: result?.cancelled ? "cancelled" : "failed",
            error: result?.error || undefined,
            endTime: Date.now(),
            speed: 0,
          });
          failedPaths.add(item.relativePath);
          continue;
        }
        sftpTransferCenterStore.patchTask(transferId, {
          status: "completed",
          transferredBytes: item.file.size,
          endTime: Date.now(),
          speed: 0,
        });
        copiedPaths.add(item.relativePath);
        bytesCopied += item.file.size;
      } catch {
        failedPaths.add(item.relativePath);
      }
    }

    if (session.cancelled) return;
    const latest = getRuleRef.current(rule.id) ?? rule;
    if (bytesCopied > 0) {
      onBytesRef.current(rule.id, (latest.bytesTransferred ?? 0) + bytesCopied);
    }
    onCheckpointRef.current(rule.id, mergeDataRelayScanCheckpoint({
      previous: latest.scanCheckpoint,
      sourceEntries,
      copiedPaths,
      failedPaths,
      now: Date.now(),
      pruneMissing,
      seedAll,
    }));
    return { copied: copiedPaths.size, failed: failedPaths.size };
  }, [getSideHomeDir, listDirectory, mkdirOnSide, startStreamTransfer]);

  const startScan = useCallback(async (ruleId: string): Promise<{ success: boolean; error?: string }> => {
    const existing = sessionsRef.current.get(ruleId);
    if (existing && !existing.cancelled) return { success: true };

    const rule = getRuleRef.current(ruleId);
    if (!rule) return { success: false, error: `Rule "${ruleId}" was not found.` };
    if (!isDataRelayFolderScanRule(rule)) {
      return { success: false, error: "Folder scan requires a source path." };
    }

    const creds = credsRef.current;
    const sourceEndpoint = resolveDataRelayEndpoint(rule.sourceHostId, creds.hosts);
    const destEndpoint = resolveDataRelayEndpoint(rule.destHostId, creds.hosts);
    if (!sourceEndpoint) return { success: false, error: `Source host "${rule.sourceHostId}" was not found.` };
    if (!destEndpoint) return { success: false, error: `Destination host "${rule.destHostId}" was not found.` };
    if (sourceEndpoint.isLocal && destEndpoint.isLocal) {
      return { success: false, error: "A data relay needs at least one remote host." };
    }

    const session: FolderScanSession = {
      cancelled: false,
      sourceSftpId: null,
      destSftpId: null,
      waitTimer: null,
      waitResolve: null,
    };
    sessionsRef.current.set(ruleId, session);
    onStatusRef.current(ruleId, "connecting");

    try {
      if (!sourceEndpoint.isLocal) {
        const sourceSftpId = await openSftp(buildSftpHostCredentials({
          host: sourceEndpoint.host,
          hosts: creds.hosts,
          keys: creds.keys,
          identities: creds.identities,
          knownHosts: creds.knownHosts,
          terminalSettings: creds.terminalSettings,
        }));
        session.sourceSftpId = sourceSftpId;
        if (session.cancelled) return { success: false };
      }
      if (!destEndpoint.isLocal) {
        const destSftpId = await openSftp(buildSftpHostCredentials({
          host: destEndpoint.host,
          hosts: creds.hosts,
          keys: creds.keys,
          identities: creds.identities,
          knownHosts: creds.knownHosts,
          terminalSettings: creds.terminalSettings,
        }));
        session.destSftpId = destSftpId;
        if (session.cancelled) return { success: false };
      }
      onStatusRef.current(ruleId, "active");
    } catch (err) {
      sessionsRef.current.delete(ruleId);
      const error = err instanceof Error ? err.message : String(err);
      onStatusRef.current(ruleId, "error", error);
      await Promise.all([releaseSftp(session.sourceSftpId), releaseSftp(session.destSftpId)]);
      return { success: false, error };
    }

    void (async () => {
      try {
        let missingRuleRetries = 0;
        while (!session.cancelled) {
          const current = getRuleRef.current(ruleId);
          if (!current) {
            // The rule can be momentarily absent while rule state transitions
            // settle (runtime store handoff, bulk rules reload). Give it a
            // short grace period instead of killing the scan: a dead session
            // left behind blocks restarts and leaks both SFTP channels.
            if (missingRuleRetries >= 5) break;
            missingRuleRetries += 1;
            await sleep(session, 1_000);
            continue;
          }
          missingRuleRetries = 0;
          const startedAt = Date.now();
          try {
            const result = await runPass(current, session);
            if (session.cancelled) break;
            onStatusRef.current(
              ruleId,
              "active",
              result && result.failed > 0
                ? `Failed to copy ${result.failed} file(s).`
                : undefined,
            );
          } catch (err) {
            if (session.cancelled) break;
            onStatusRef.current(
              ruleId,
              "active",
              err instanceof Error ? err.message : String(err),
            );
          }
          if (session.cancelled) break;
          const interval = normalizeDataRelayScanIntervalMs(getRuleRef.current(ruleId)?.scanIntervalMs);
          await sleep(session, remainingDataRelayScanDelayMs(interval, Date.now() - startedAt));
        }
      } finally {
        // A finished loop must always remove its session: startScan() treats
        // any non-cancelled entry as "already running" and would silently
        // refuse to restart the rule until the owning view unmounts.
        sessionsRef.current.delete(ruleId);
        const sourceId = session.sourceSftpId;
        const destId = session.destSftpId;
        session.sourceSftpId = null;
        session.destSftpId = null;
        if (!session.cancelled) {
          // stopScan() already released both channels when it cancelled us.
          await Promise.all([releaseSftp(sourceId), releaseSftp(destId)]);
        }
      }
    })();

    return { success: true };
  }, [openSftp, releaseSftp, runPass]);

  const isScanning = useCallback((ruleId: string) => {
    const session = sessionsRef.current.get(ruleId);
    return Boolean(session && !session.cancelled);
  }, []);

  useEffect(() => () => {
    void stopAllScans();
  }, [stopAllScans]);

  return {
    startScan,
    stopScan,
    stopAllScans,
    isScanning,
  };
}
