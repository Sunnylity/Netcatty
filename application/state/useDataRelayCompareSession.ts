import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DataRelayRule,
  Host,
  Identity,
  KnownHost,
  RemoteFile,
  SSHKey,
  TerminalSettings,
} from "../../domain/models";
import {
  collectDataRelayCompareTree,
  compareDataRelayTreesPaired,
  dataRelayCompareCopyDirectionForRow,
  dataRelayCompareKindByFirstSegment,
  isDataRelayCompareDirectory,
  listDataRelayCompareCopyItems,
  parentDataRelayRelativePath,
  summarizeDataRelayCompare,
  type DataRelayCompareFile,
  type DataRelayCompareKind,
  type DataRelayCompareProgress,
  type DataRelayCompareRow,
  type DataRelayCompareSyncDirection,
} from "../../domain/dataRelayCompare";
import {
  dataRelaySubdirUploadRelativeDir,
  getDataRelayFileName,
  resolveDataRelayViewerStart,
  stripDataRelayTrailingSep,
  usesWindowsDataRelayPath,
} from "../../domain/dataRelayPaths";
import { copyRemotePathEntries } from "./sftp/copyRemotePathEntries";
import {
  getDataRelayPathClipboard,
  setDataRelayPathClipboard,
  type DataRelayPathClipboardEntry,
} from "./sftp/dataRelayPathClipboardStore";
import { getParentPath, isSafeNewFolderName, isWindowsPath, isWindowsRoot, joinPath, joinTransferTargetPath } from "./sftp/utils";
import { sftpTransferCenterStore } from "./sftpTransferCenterStore";
import { buildSftpHostCredentials } from "./sftp/useSftpHostCredentials";
import { useSftpBackend } from "./useSftpBackend";

export type DataRelayCompareSide = "left" | "right";

export interface DataRelayCompareLogEntry {
  at: number;
  message: string;
  tone: "info" | "success" | "error";
}

export interface DataRelayComparePaneState {
  connecting: boolean;
  listing: boolean;
  error: string | null;
  ready: boolean;
  path: string;
  homeDir: string;
  files: DataRelayCompareFile[];
}

interface UseDataRelayCompareSessionParams {
  active: boolean;
  rule: DataRelayRule;
  sourceHost: Host | undefined;
  destHost: Host | undefined;
  hosts: Host[];
  keys: SSHKey[];
  identities: Identity[];
  knownHosts?: KnownHost[];
  terminalSettings?: Pick<
    TerminalSettings,
    "verifyHostKeys" | "keepaliveInterval" | "keepaliveCountMax"
  >;
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

const sortFiles = (files: DataRelayCompareFile[]): DataRelayCompareFile[] =>
  [...files].sort((a, b) => {
    const aDir = a.type === "directory" || a.linkTarget === "directory";
    const bDir = b.type === "directory" || b.linkTarget === "directory";
    if (aDir !== bDir) return aDir ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

const isDir = (file: DataRelayCompareFile): boolean =>
  file.type === "directory" || file.linkTarget === "directory";

export function useDataRelayCompareSession({
  active,
  rule,
  sourceHost,
  destHost,
  hosts,
  keys,
  identities,
  knownHosts,
  terminalSettings,
}: UseDataRelayCompareSessionParams) {
  const {
    openSftp,
    closeSftp,
    listSftp,
    getSftpHomeDir,
    mkdirSftp,
    writeSftp,
    writeSftpBinary,
    deleteSftp,
    startStreamTransfer,
  } = useSftpBackend();
  const [left, setLeft] = useState<DataRelayComparePaneState>({
    connecting: false,
    listing: false,
    error: null,
    ready: false,
    path: stripDataRelayTrailingSep(rule.sourcePath || "") || "/",
    homeDir: "/",
    files: [],
  });
  const [right, setRight] = useState<DataRelayComparePaneState>({
    connecting: false,
    listing: false,
    error: null,
    ready: false,
    path: stripDataRelayTrailingSep(rule.destPath || "") || "/",
    homeDir: "/",
    files: [],
  });
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [rows, setRows] = useState<DataRelayCompareRow[]>([]);
  const [compared, setCompared] = useState(false);
  const [copying, setCopying] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [compareProgress, setCompareProgress] = useState<DataRelayCompareProgress | null>(null);
  const [copyProgress, setCopyProgress] = useState<{ done: number; total: number } | null>(null);
  const [summary, setSummary] = useState({ same: 0, leftOnly: 0, rightOnly: 0, different: 0 });
  const [log, setLog] = useState<DataRelayCompareLogEntry[]>([]);
  const leftSftpRef = useRef<string | null>(null);
  const rightSftpRef = useRef<string | null>(null);
  const leftGenRef = useRef(0);
  const rightGenRef = useRef(0);
  const compareGenRef = useRef(0);
  const uploadGenRef = useRef(0);
  const compareProgressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestCompareProgressRef = useRef<DataRelayCompareProgress | null>(null);
  const leftRef = useRef(left);
  const rightRef = useRef(right);
  leftRef.current = left;
  rightRef.current = right;
  const credsRef = useRef({ hosts, keys, identities, knownHosts, terminalSettings, sourceHost, destHost });
  credsRef.current = { hosts, keys, identities, knownHosts, terminalSettings, sourceHost, destHost };

  const appendLog = useCallback((message: string, tone: DataRelayCompareLogEntry["tone"] = "info") => {
    setLog((current) => [...current.slice(-199), { at: Date.now(), message, tone }]);
  }, []);

  const releaseSftp = useCallback(async (sftpId: string | null) => {
    if (!sftpId) return;
    try {
      await closeSftp(sftpId);
    } catch {
      // Best-effort: the main process still owns session cleanup.
    }
  }, [closeSftp]);

  const listPane = useCallback(async (
    side: DataRelayCompareSide,
    sftpId: string,
    path: string,
  ): Promise<DataRelayCompareFile[] | null> => {
    const genRef = side === "left" ? leftGenRef : rightGenRef;
    const setPane = side === "left" ? setLeft : setRight;
    const gen = ++genRef.current;
    setPane((current) => ({ ...current, listing: true, error: null }));
    try {
      const raw = await listSftp(sftpId, path);
      if (gen !== genRef.current) return null;
      const files = sortFiles((raw ?? []).map(toCompareFile).filter((file): file is DataRelayCompareFile => Boolean(file)));
      setPane((current) => ({ ...current, listing: false, path, files, error: null }));
      return files;
    } catch (err) {
      if (gen !== genRef.current) return null;
      setPane((current) => ({
        ...current,
        listing: false,
        error: err instanceof Error ? err.message : String(err),
      }));
      return null;
    }
  }, [listSftp]);

  const connectPane = useCallback(async (
    side: DataRelayCompareSide,
    host: Host,
    initialPath: string | undefined,
  ) => {
    const setPane = side === "left" ? setLeft : setRight;
    const sftpRef = side === "left" ? leftSftpRef : rightSftpRef;
    const previewPath = stripDataRelayTrailingSep(initialPath || "") || "/";
    setPane((current) => ({
      ...current,
      connecting: true,
      ready: false,
      error: null,
      files: [],
      path: previewPath,
    }));
    try {
      const current = credsRef.current;
      const credentials = buildSftpHostCredentials({
        host,
        hosts: current.hosts,
        keys: current.keys,
        identities: current.identities,
        knownHosts: current.knownHosts,
        terminalSettings: current.terminalSettings,
      });
      const sftpId = await openSftp(credentials);
      sftpRef.current = sftpId;
      const homeResult = await getSftpHomeDir(sftpId);
      const homeDir = homeResult?.homeDir?.trim() || "/";
      const startPath = resolveDataRelayViewerStart(initialPath, homeDir).listPath;
      setPane((current) => ({ ...current, connecting: false, ready: true, homeDir, path: startPath }));
      await listPane(side, sftpId, startPath);
    } catch (err) {
      setPane((current) => ({
        ...current,
        connecting: false,
        ready: false,
        error: err instanceof Error ? err.message : String(err),
      }));
      throw err;
    }
  }, [getSftpHomeDir, listPane, openSftp]);

  const sourceHostId = sourceHost?.id;
  const destHostId = destHost?.id;

  useEffect(() => {
    if (!active || !sourceHostId || !destHostId) {
      setLeft((current) => ({ ...current, connecting: false, listing: false, ready: false, files: [], error: null }));
      setRight((current) => ({ ...current, connecting: false, listing: false, ready: false, files: [], error: null }));
      setRows([]);
      setCompared(false);
      setSelectedName(null);
      return;
    }

    let cancelled = false;
    setLog([]);
    void (async () => {
      const source = credsRef.current.sourceHost;
      const dest = credsRef.current.destHost;
      if (!source || !dest) return;
      try {
        await Promise.all([
          connectPane("left", source, rule.sourcePath),
          connectPane("right", dest, rule.destPath),
        ]);
      } catch (err) {
        if (!cancelled) {
          appendLog(err instanceof Error ? err.message : String(err), "error");
        }
      }
    })();

    return () => {
      cancelled = true;
      leftGenRef.current += 1;
      rightGenRef.current += 1;
      compareGenRef.current += 1;
      const leftId = leftSftpRef.current;
      const rightId = rightSftpRef.current;
      leftSftpRef.current = null;
      rightSftpRef.current = null;
      void releaseSftp(leftId);
      void releaseSftp(rightId);
    };
  }, [
    active,
    sourceHostId,
    destHostId,
    rule.id,
    rule.sourcePath,
    rule.destPath,
    appendLog,
    connectPane,
    releaseSftp,
  ]);

  const navigate = useCallback(async (side: DataRelayCompareSide, path: string) => {
    const sftpId = side === "left" ? leftSftpRef.current : rightSftpRef.current;
    if (!sftpId) return;
    compareGenRef.current += 1;
    setSelectedName(null);
    setCompared(false);
    setComparing(false);
    setCompareProgress(null);
    setRows([]);
    setSummary({ same: 0, leftOnly: 0, rightOnly: 0, different: 0 });
    await listPane(side, sftpId, path);
  }, [listPane]);

  const refreshBoth = useCallback(async (): Promise<{
    leftFiles: DataRelayCompareFile[];
    rightFiles: DataRelayCompareFile[];
  }> => {
    const leftId = leftSftpRef.current;
    const rightId = rightSftpRef.current;
    const [leftFiles, rightFiles] = await Promise.all([
      leftId ? listPane("left", leftId, left.path) : Promise.resolve(null),
      rightId ? listPane("right", rightId, right.path) : Promise.resolve(null),
    ]);
    return {
      leftFiles: leftFiles ?? left.files,
      rightFiles: rightFiles ?? right.files,
    };
  }, [left.files, left.path, listPane, right.files, right.path]);

  const listTreePath = useCallback(async (sftpId: string, path: string): Promise<DataRelayCompareFile[]> => {
    const raw = await listSftp(sftpId, path);
    const files: DataRelayCompareFile[] = [];
    for (const file of raw ?? []) {
      const mapped = toCompareFile(file);
      if (mapped) files.push(mapped);
    }
    return files;
  }, [listSftp]);

  const runCompare = useCallback(async (): Promise<DataRelayCompareRow[] | null> => {
    const leftId = leftSftpRef.current;
    const rightId = rightSftpRef.current;
    if (!leftId || !rightId) return null;
    const gen = ++compareGenRef.current;
    setComparing(true);
    setCompareProgress({ scanned: 0, diffs: 0, same: 0 });
    try {
      await refreshBoth();
      if (gen !== compareGenRef.current) return null;
      // The compare button is locked to the rule's configured roots, so the
      // sync scope never drifts with the panes' browsing position.
      const leftPath = resolveDataRelayViewerStart(rule.sourcePath, leftRef.current.homeDir || "/").listPath;
      const rightPath = resolveDataRelayViewerStart(rule.destPath, rightRef.current.homeDir || "/").listPath;
      appendLog(`Comparing recursively ${leftPath} <-> ${rightPath}`);
      const result = await compareDataRelayTreesPaired(
        leftPath,
        rightPath,
        (side, path) => listTreePath(side === "left" ? leftId : rightId, path),
        {
          joinAbsolute: joinPath,
          cancelled: () => gen !== compareGenRef.current,
          caseInsensitive: usesWindowsDataRelayPath(leftPath) || usesWindowsDataRelayPath(rightPath),
          onProgress: (progress) => {
            latestCompareProgressRef.current = progress;
            if (compareProgressTimerRef.current) return;
            compareProgressTimerRef.current = setTimeout(() => {
              compareProgressTimerRef.current = null;
              const latest = latestCompareProgressRef.current;
              if (gen === compareGenRef.current && latest) setCompareProgress(latest);
            }, 200);
          },
        },
      );
      if (gen !== compareGenRef.current) return null;
      if (compareProgressTimerRef.current) {
        clearTimeout(compareProgressTimerRef.current);
        compareProgressTimerRef.current = null;
      }
      for (const error of result.errors) {
        appendLog(`List ${error.path}: ${error.message}`, "error");
      }
      setRows(result.diffs);
      setSummary(result.summary);
      setCompared(true);
      setCompareProgress({
        scanned: result.summary.same + result.summary.leftOnly + result.summary.rightOnly + result.summary.different,
        diffs: result.diffs.length,
        same: result.summary.same,
      });
      appendLog(
        `Compared (${result.summary.same} same, ${result.summary.leftOnly} left only, ${result.summary.rightOnly} right only, ${result.summary.different} different)`,
      );
      return result.diffs;
    } catch (err) {
      if (gen !== compareGenRef.current) return null;
      appendLog(err instanceof Error ? err.message : String(err), "error");
      return null;
    } finally {
      if (gen === compareGenRef.current) setComparing(false);
    }
  }, [appendLog, listTreePath, refreshBoth, rule.destPath, rule.sourcePath]);

  const cancelCompare = useCallback(() => {
    compareGenRef.current += 1;
    if (compareProgressTimerRef.current) {
      clearTimeout(compareProgressTimerRef.current);
      compareProgressTimerRef.current = null;
    }
    setComparing(false);
  }, []);

  const caseInsensitive = usesWindowsDataRelayPath(left.path) || usesWindowsDataRelayPath(right.path);
  const kindByName = useMemo(() => {
    if (!compared) return new Map<string, DataRelayCompareKind>();
    return dataRelayCompareKindByFirstSegment(rows, { caseInsensitive });
  }, [caseInsensitive, compared, rows]);

  const copyOneDirection = useCallback(async (
    direction: "left-to-right" | "right-to-left",
    currentRows: DataRelayCompareRow[],
    paths: ReadonlySet<string> | undefined,
    progress: { done: number; total: number },
  ): Promise<string[]> => {
    const sourceSftpId = direction === "left-to-right" ? leftSftpRef.current : rightSftpRef.current;
    const targetSftpId = direction === "left-to-right" ? rightSftpRef.current : leftSftpRef.current;
    const sourceHostId = direction === "left-to-right" ? rule.sourceHostId : rule.destHostId;
    const targetHostId = direction === "left-to-right" ? rule.destHostId : rule.sourceHostId;
    const leftReady = leftRef.current.ready;
    const rightReady = rightRef.current.ready;
    if (!sourceSftpId || !targetSftpId || !leftReady || !rightReady) return [];
    // Sync scope is locked to the rule's configured roots — never to wherever
    // the panes happen to be browsed.
    const leftRoot = resolveDataRelayViewerStart(rule.sourcePath, leftRef.current.homeDir || "/").listPath;
    const rightRoot = resolveDataRelayViewerStart(rule.destPath, rightRef.current.homeDir || "/").listPath;
    const sourceBase = direction === "left-to-right" ? leftRoot : rightRoot;
    const targetBase = direction === "left-to-right" ? rightRoot : leftRoot;

    const items = listDataRelayCompareCopyItems(
      currentRows,
      direction,
      paths ? { paths } : null,
    );
    const copied: string[] = [];
    for (const item of items) {
      if (item.type === "directory") {
        await mkdirSftp(targetSftpId, joinTransferTargetPath(targetBase, item.relativePath));
        copied.push(item.relativePath);
        progress.done += 1;
        setCopyProgress({ ...progress });
        continue;
      }
      const parentRel = parentDataRelayRelativePath(item.relativePath);
      if (parentRel) {
        await mkdirSftp(targetSftpId, joinTransferTargetPath(targetBase, parentRel));
      }
      const sourcePath = joinTransferTargetPath(sourceBase, item.relativePath);
      const targetPath = joinTransferTargetPath(targetBase, item.relativePath);
      const result = await startStreamTransfer({
        transferId: `relay-compare-${Date.now()}-${item.relativePath}`,
        sourcePath,
        targetPath,
        sourceType: "sftp",
        targetType: "sftp",
        sourceSftpId,
        targetSftpId,
        sourceHostId,
        targetHostId,
        totalBytes: item.file.size,
        sourceLastModified: item.file.lastModified,
      });
      progress.done += 1;
      setCopyProgress({ done: progress.done, total: progress.total });
      if (result?.error) {
        appendLog(`${item.relativePath}: ${result.error}`, "error");
        continue;
      }
      copied.push(item.relativePath);
      if (copied.length === 1 || copied.length % 25 === 0) {
        appendLog(`Copied ${copied.length}/${items.length}`);
      }
    }
    return copied;
  }, [appendLog, mkdirSftp, rule.destHostId, rule.destPath, rule.sourceHostId, rule.sourcePath, startStreamTransfer]);

  const copySelection = useCallback(async (
    direction: DataRelayCompareSyncDirection,
    relativePaths?: readonly string[],
  ) => {
    const sourceReady = leftRef.current.ready && rightRef.current.ready;
    if (!sourceReady) return;

    let currentRows = compared ? rows : [];
    if (!compared) {
      const walked = await runCompare();
      if (!walked) return;
      currentRows = walked;
    }

    const pathSet = relativePaths ? new Set(relativePaths) : undefined;
    const leftPaths = new Set<string>();
    const rightPaths = new Set<string>();
    for (const row of currentRows) {
      if (pathSet && !pathSet.has(row.relativePath)) continue;
      const side = dataRelayCompareCopyDirectionForRow(row, direction);
      if (side === "left-to-right") leftPaths.add(row.relativePath);
      else if (side === "right-to-left") rightPaths.add(row.relativePath);
    }
    const leftItems = leftPaths.size === 0
      ? []
      : listDataRelayCompareCopyItems(currentRows, "left-to-right", { paths: leftPaths });
    const rightItems = rightPaths.size === 0
      ? []
      : listDataRelayCompareCopyItems(currentRows, "right-to-left", { paths: rightPaths });
    const total = leftItems.length + rightItems.length;
    if (total === 0) {
      appendLog("No files selected to copy.", "error");
      return;
    }

    setCopying(true);
    setCopyProgress({ done: 0, total });
    try {
      const progress = { done: 0, total };
      const copied: string[] = [];
      if (leftItems.length > 0) {
        copied.push(...await copyOneDirection("left-to-right", currentRows, leftPaths, progress));
      }
      if (rightItems.length > 0) {
        copied.push(...await copyOneDirection("right-to-left", currentRows, rightPaths, progress));
      }
      const copiedSet = new Set(copied);
      setRows((current) => current.filter((row) => !copiedSet.has(row.relativePath)));
      setSummary((current) => {
        const remaining = currentRows.filter((row) => !copiedSet.has(row.relativePath));
        const next = summarizeDataRelayCompare(remaining);
        return { ...next, same: current.same + copied.length };
      });
      await refreshBoth();
      appendLog(`Copied ${copied.length} item(s)`, "success");
    } catch (err) {
      appendLog(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setCopying(false);
      setCopyProgress(null);
    }
  }, [appendLog, compared, copyOneDirection, refreshBoth, rows, runCompare]);

  /** Resolve where a one-shot subdirectory upload would land, for confirm UI. */
  const resolveSubdirUploadTarget = useCallback((name: string): string | null => {
    if (!leftRef.current.ready || !rightRef.current.ready) return null;
    const leftRoot = resolveDataRelayViewerStart(rule.sourcePath, leftRef.current.homeDir || "/").listPath;
    const rightRoot = resolveDataRelayViewerStart(rule.destPath, rightRef.current.homeDir || "/").listPath;
    const relDir = dataRelaySubdirUploadRelativeDir(leftRoot, leftRef.current.path, name);
    return joinTransferTargetPath(rightRoot, relDir);
  }, [rule.destPath, rule.sourcePath]);

  /**
   * Push one source subdirectory to the destination, overwriting every file
   * and subdirectory under it. Scope mirrors the subdirectory's position under
   * the sync roots; each file lands in the transfer panel like scan copies.
   */
  const uploadSubdirectory = useCallback(async (
    name: string,
  ): Promise<{ copied: number; failed: number } | null> => {
    const leftSftpId = leftSftpRef.current;
    const rightSftpId = rightSftpRef.current;
    if (!leftSftpId || !rightSftpId || !leftRef.current.ready || !rightRef.current.ready) return null;
    const leftRoot = resolveDataRelayViewerStart(rule.sourcePath, leftRef.current.homeDir || "/").listPath;
    const rightRoot = resolveDataRelayViewerStart(rule.destPath, rightRef.current.homeDir || "/").listPath;
    const relDir = dataRelaySubdirUploadRelativeDir(leftRoot, leftRef.current.path, name);
    const sourceDir = joinTransferTargetPath(leftRoot, relDir);
    const targetDir = joinTransferTargetPath(rightRoot, relDir);

    const gen = ++uploadGenRef.current;
    const cancelled = () => uploadGenRef.current !== gen;
    setUploading(true);
    appendLog(`Uploading ${sourceDir} -> ${targetDir} (overwrite)`);
    try {
      const tree = await collectDataRelayCompareTree(
        sourceDir,
        (path) => listTreePath(leftSftpId, path),
        { joinAbsolute: joinPath, cancelled },
      );
      if (cancelled()) return null;
      const entries = [...tree.entries].sort((a, b) => {
        const aDepth = a.relativePath.split("/").length;
        const bDepth = b.relativePath.split("/").length;
        return aDepth !== bDepth ? aDepth - bDepth : a.relativePath.localeCompare(b.relativePath);
      });
      let copied = 0;
      let failed = 0;
      try { await mkdirSftp(rightSftpId, targetDir); } catch { /* may already exist */ }
      for (const entry of entries) {
        if (cancelled()) return null;
        if (isDataRelayCompareDirectory(entry)) {
          try { await mkdirSftp(rightSftpId, joinTransferTargetPath(targetDir, entry.relativePath)); } catch { /* may already exist */ }
          continue;
        }
        if (entry.type === "symlink" && entry.linkTarget !== "file") continue;
        const sourceAbs = joinTransferTargetPath(sourceDir, entry.relativePath);
        const targetAbs = joinTransferTargetPath(targetDir, entry.relativePath);
        const transferId = `relay-upload-${rule.id}-${Date.now()}-${entry.relativePath}`;
        sftpTransferCenterStore.upsertTasks([{
          id: transferId,
          fileName: getDataRelayFileName(entry.relativePath),
          sourcePath: sourceAbs,
          targetPath: targetAbs,
          sourceConnectionId: leftSftpId,
          targetConnectionId: rightSftpId,
          sourceHostId: rule.sourceHostId,
          targetHostId: rule.destHostId,
          sourceHostLabel: sourceHost?.label,
          targetHostLabel: destHost?.label,
          direction: "remote-to-remote",
          status: "queued",
          totalBytes: entry.size,
          transferredBytes: 0,
          speed: 0,
          startTime: Date.now(),
          isDirectory: false,
          sourceLastModified: entry.lastModified,
          retryable: false,
        }]);
        try {
          const result = await startStreamTransfer({
            transferId,
            sourcePath: sourceAbs,
            targetPath: targetAbs,
            sourceType: "sftp",
            targetType: "sftp",
            sourceSftpId: leftSftpId,
            targetSftpId: rightSftpId,
            sourceHostId: rule.sourceHostId,
            targetHostId: rule.destHostId,
            totalBytes: entry.size,
            sourceLastModified: entry.lastModified,
            skipAdmission: true,
          });
          if (result?.error || result?.cancelled) {
            sftpTransferCenterStore.patchTask(transferId, {
              status: result?.cancelled ? "cancelled" : "failed",
              error: result?.error || undefined,
              endTime: Date.now(),
              speed: 0,
            });
            failed += 1;
            continue;
          }
          sftpTransferCenterStore.patchTask(transferId, {
            status: "completed",
            transferredBytes: entry.size,
            endTime: Date.now(),
            speed: 0,
          });
          copied += 1;
        } catch {
          sftpTransferCenterStore.patchTask(transferId, {
            status: "failed",
            endTime: Date.now(),
            speed: 0,
          });
          failed += 1;
        }
      }
      if (cancelled()) return null;
      appendLog(
        `Uploaded ${copied} file(s)${failed > 0 ? `, ${failed} failed` : ""} -> ${targetDir}`,
        failed > 0 ? "error" : "success",
      );
      await refreshBoth();
      return { copied, failed };
    } catch (err) {
      appendLog(`Upload failed: ${err instanceof Error ? err.message : String(err)}`, "error");
      return { copied: 0, failed: 1 };
    } finally {
      if (uploadGenRef.current === gen) setUploading(false);
    }
  }, [
    appendLog,
    destHost,
    listTreePath,
    mkdirSftp,
    refreshBoth,
    rule.destHostId,
    rule.destPath,
    rule.id,
    rule.sourceHostId,
    rule.sourcePath,
    sourceHost,
    startStreamTransfer,
  ]);

  const openEntry = useCallback((side: DataRelayCompareSide, file: DataRelayCompareFile) => {
    if (!isDir(file)) {
      setSelectedName(file.name);
      return;
    }
    const pane = side === "left" ? left : right;
    void navigate(side, joinPath(pane.path, file.name));
  }, [left, navigate, right]);

  const goParent = useCallback((side: DataRelayCompareSide) => {
    const pane = side === "left" ? left : right;
    const parent = getParentPath(pane.path);
    if (parent === pane.path) return;
    if (isWindowsPath(pane.path) && isWindowsRoot(pane.path)) return;
    void navigate(side, parent);
  }, [left, navigate, right]);

  const createFolder = useCallback(async (side: DataRelayCompareSide, name: string) => {
    const trimmed = name.trim();
    if (!isSafeNewFolderName(trimmed)) {
      throw new Error("Invalid folder name");
    }
    const sftpId = side === "left" ? leftSftpRef.current : rightSftpRef.current;
    const pane = side === "left" ? leftRef.current : rightRef.current;
    if (!sftpId || !pane.ready) {
      throw new Error("SFTP session not ready");
    }
    const fullPath = joinPath(pane.path, trimmed);
    try {
      await mkdirSftp(sftpId, fullPath);
      await listPane(side, sftpId, pane.path);
      setSelectedName(trimmed);
      appendLog(`Created ${fullPath}`, "success");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      appendLog(message, "error");
      throw err;
    }
  }, [appendLog, listPane, mkdirSftp]);

  const createFile = useCallback(async (side: DataRelayCompareSide, name: string) => {
    const trimmed = name.trim();
    if (!isSafeNewFolderName(trimmed)) {
      throw new Error("Invalid file name");
    }
    const sftpId = side === "left" ? leftSftpRef.current : rightSftpRef.current;
    const pane = side === "left" ? leftRef.current : rightRef.current;
    if (!sftpId || !pane.ready) {
      throw new Error("SFTP session not ready");
    }
    const fullPath = joinPath(pane.path, trimmed);
    try {
      try {
        await writeSftpBinary(sftpId, fullPath, new ArrayBuffer(0));
      } catch {
        await writeSftp(sftpId, fullPath, "");
      }
      await listPane(side, sftpId, pane.path);
      setSelectedName(trimmed);
      appendLog(`Created ${fullPath}`, "success");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      appendLog(message, "error");
      throw err;
    }
  }, [appendLog, listPane, writeSftp, writeSftpBinary]);

  const copyEntries = useCallback((side: DataRelayCompareSide, files: DataRelayCompareFile[]) => {
    const pane = side === "left" ? leftRef.current : rightRef.current;
    const hostId = side === "left" ? rule.sourceHostId : rule.destHostId;
    const entries: DataRelayPathClipboardEntry[] = files
      .filter((file) => isSafeNewFolderName(file.name))
      .map((file) => ({
        name: file.name,
        isDirectory: isDir(file),
        size: file.size,
        lastModified: file.lastModified,
      }));
    if (entries.length === 0) return 0;
    setDataRelayPathClipboard({
      files: entries,
      sourcePath: pane.path,
      sourceHostId: hostId,
    });
    return entries.length;
  }, [rule.destHostId, rule.sourceHostId]);

  const pasteEntries = useCallback(async (side: DataRelayCompareSide) => {
    const clip = getDataRelayPathClipboard();
    if (!clip?.files.length) {
      throw new Error("empty");
    }
    const destPane = side === "left" ? leftRef.current : rightRef.current;
    const destSftpId = side === "left" ? leftSftpRef.current : rightSftpRef.current;
    const destHostId = side === "left" ? rule.sourceHostId : rule.destHostId;
    const sourceSftpId = clip.sourceHostId === rule.sourceHostId
      ? leftSftpRef.current
      : clip.sourceHostId === rule.destHostId
        ? rightSftpRef.current
        : null;
    if (!destSftpId || !destPane.ready) {
      throw new Error("SFTP session not ready");
    }
    if (!sourceSftpId) {
      throw new Error("source-gone");
    }

    setCopying(true);
    try {
      const result = await copyRemotePathEntries({
        sourceSftpId,
        destSftpId,
        sourceHostId: clip.sourceHostId,
        destHostId,
        sourcePath: clip.sourcePath,
        destPath: destPane.path,
        entries: clip.files,
        list: async (sftpId, path) => {
          const raw = await listSftp(sftpId, path);
          return (raw ?? []).map(toCompareFile).filter((file): file is DataRelayCompareFile => Boolean(file));
        },
        mkdir: mkdirSftp,
        transfer: startStreamTransfer,
      });
      await listPane(side, destSftpId, destPane.path);
      if (result.skipped.length > 0 && result.copied.length === 0 && result.failed.length === 0) {
        throw new Error("same-path");
      }
      if (result.failed.length > 0) {
        appendLog(`Paste failed: ${result.failed.join(", ")}`, "error");
      }
      if (result.copied.length > 0) {
        appendLog(`Pasted ${result.copied.length} item(s)`, "success");
      }
      return result;
    } catch (err) {
      if (err instanceof Error && (err.message === "same-path" || err.message === "empty" || err.message === "source-gone")) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      appendLog(message, "error");
      throw err;
    } finally {
      setCopying(false);
    }
  }, [appendLog, listPane, listSftp, mkdirSftp, rule.destHostId, rule.sourceHostId, startStreamTransfer]);

  const deleteEntries = useCallback(async (side: DataRelayCompareSide, files: DataRelayCompareFile[]) => {
    const names = files.map((file) => file.name).filter(isSafeNewFolderName);
    if (names.length === 0) return { deleted: [] as string[], failed: [] as string[] };
    const sftpId = side === "left" ? leftSftpRef.current : rightSftpRef.current;
    const pane = side === "left" ? leftRef.current : rightRef.current;
    if (!sftpId || !pane.ready) {
      throw new Error("SFTP session not ready");
    }

    const deleted: string[] = [];
    const failed: string[] = [];
    for (const name of names) {
      const fullPath = joinPath(pane.path, name);
      try {
        await deleteSftp(sftpId, fullPath);
        deleted.push(name);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failed.push(message || name);
        appendLog(`Delete failed: ${fullPath}: ${message}`, "error");
      }
    }
    await listPane(side, sftpId, pane.path);
    setSelectedName((current) => (current && names.includes(current) ? null : current));
    if (deleted.length > 0) {
      appendLog(`Deleted ${deleted.length} item(s)`, "success");
    }
    if (failed.length > 0 && deleted.length === 0) {
      throw new Error(failed[0] || "Delete failed");
    }
    return { deleted, failed };
  }, [appendLog, deleteSftp, listPane]);

  return {
    left,
    right,
    selectedName,
    setSelectedName,
    rows,
    kindByName,
    compared,
    comparing,
    compareProgress,
    summary,
    log,
    copying,
    copyProgress,
    navigate,
    goParent,
    createFolder,
    createFile,
    copyEntries,
    pasteEntries,
    deleteEntries,
    openEntry,
    runCompare,
    cancelCompare,
    copySelection,
    refreshBoth,
    uploading,
    uploadSubdirectory,
    resolveSubdirUploadTarget,
  };
}

