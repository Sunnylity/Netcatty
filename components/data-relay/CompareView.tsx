import {
  ArrowLeftRight,
  ArrowUp,
  Folder,
  File,
  GitCompare,
  Home,
  Loader2,
  Pencil,
  GripHorizontal,
  Play,
  RefreshCw,
  Save,
  Square,
} from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../application/i18n/I18nProvider";
import {
  useDataRelayCompareSession,
  type DataRelayComparePaneState,
  type DataRelayCompareSide,
} from "../../application/state/useDataRelayCompareSession";
import { useStoredNumber } from "../../application/state/useStoredNumber";
import { STORAGE_KEY_DATA_RELAY_COMPARE_LOG_HEIGHT } from "../../infrastructure/config/storageKeys";
import { resolveOpenTerminalPath } from "../../application/state/sftp/copyRemotePathEntries";
import {
  formatDate,
  formatFileSize,
  getNextUntitledName,
  getParentPath,
  isWindowsPath,
  isWindowsRoot,
  joinPath,
} from "../../application/state/sftp/utils";
import type { DataRelayCompareFile, DataRelayCompareKind } from "../../domain/dataRelayCompare";
import { buildDataRelayBrowsePathUpdate } from "../../domain/dataRelayPaths";
import type { DataRelayRule, Host, Identity, KnownHost, SSHKey, TerminalSettings } from "../../domain/models";
import { cn } from "../../lib/utils";
import { SftpBreadcrumb } from "../sftp/SftpBreadcrumb";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { toast } from "../ui/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import {
  formatRelayBytes,
  getRelayStatusLabelKey,
  getRelayStatusTone,
  isRelayRuleRunning,
} from "./utils";
import { CompareSyncDialog } from "./CompareSyncDialog";
import {
  NewFolderDialog,
  PathListDeleteConfirmDialog,
  PathListEntryContextMenu,
  PathListPaneContextMenu,
  type PathNameDialogKind,
} from "./NewFolderDialog";
import { ScanSettingsPopover } from "./ScanSettingsPopover";

export interface CompareViewProps {
  rule: DataRelayRule;
  hosts: Host[];
  keys: SSHKey[];
  identities: Identity[];
  knownHosts?: KnownHost[];
  terminalSettings?: Pick<
    TerminalSettings,
    "verifyHostKeys" | "keepaliveInterval" | "keepaliveCountMax"
  >;
  sourceHost?: Host;
  destHost?: Host;
  onEdit: () => void;
  onStart: () => void;
  onStop: () => void;
  onScanSettingsChange: (updates: Partial<DataRelayRule> & { scanCheckpoint?: DataRelayRule["scanCheckpoint"] | null }) => void;
  onOpenTerminalAtPath?: (host: Host, path: string) => void;
  onPersistBrowsePaths?: (
    paths: { sourcePath?: string; destPath?: string },
    options?: { preserveRuntime?: boolean },
  ) => boolean | void;
}

const COMPARE_LOG_HEIGHT_MIN = 80;
const COMPARE_LOG_HEIGHT_DEFAULT = 112;
const COMPARE_LOG_HEIGHT_MAX = 480;

const clampCompareLogHeight = (height: number): number =>
  Math.max(COMPARE_LOG_HEIGHT_MIN, Math.min(COMPARE_LOG_HEIGHT_MAX, height));

const hostLabel = (host?: Host): string => host?.label || host?.hostname || "—";

const kindClass = (kind: DataRelayCompareKind | undefined): string => {
  switch (kind) {
    case "left-only":
      return "bg-sky-500/10 text-sky-700 dark:text-sky-300";
    case "right-only":
      return "bg-violet-500/10 text-violet-700 dark:text-violet-300";
    case "newer-left":
    case "newer-right":
    case "size-diff":
    case "type-diff":
    case "content-diff":
      return "bg-amber-500/10 text-amber-800 dark:text-amber-300";
    default:
      return "";
  }
};

const isDir = (file: DataRelayCompareFile): boolean =>
  file.type === "directory" || file.linkTarget === "directory";

const ComparePane: React.FC<{
  side: DataRelayCompareSide;
  title: string;
  host?: Host;
  pane: DataRelayComparePaneState;
  busy?: boolean;
  selectedName: string | null;
  kindByName: Map<string, DataRelayCompareKind>;
  compared: boolean;
  onSelect: (name: string) => void;
  onOpen: (file: DataRelayCompareFile) => void;
  onNavigate: (path: string) => void;
  onParent: () => void;
  onHome: () => void;
  onRefresh: () => void;
  onNewFolder: () => void;
  onNewFile: () => void;
  onCopyPath: (file?: DataRelayCompareFile) => void;
  onCopy: (file: DataRelayCompareFile) => void;
  onPaste: () => void;
  onDelete: (file: DataRelayCompareFile) => void;
  onOpenTerminal?: (file?: DataRelayCompareFile) => void;
}> = ({
  side,
  title,
  host,
  pane,
  busy = false,
  selectedName,
  kindByName,
  compared,
  onSelect,
  onOpen,
  onNavigate,
  onParent,
  onHome,
  onRefresh,
  onNewFolder,
  onNewFile,
  onCopyPath,
  onCopy,
  onPaste,
  onDelete,
  onOpenTerminal,
}) => {
  const { t } = useI18n();
  const parentPath = getParentPath(pane.path);
  const atRoot = isWindowsPath(pane.path)
    ? isWindowsRoot(pane.path)
    : pane.path === "/" || parentPath === pane.path;
  const canMutate = pane.ready && !pane.connecting && !busy;
  const canOpenTerminal = Boolean(onOpenTerminal && host);
  const paneActions = {
    disabled: !canMutate,
    canOpenTerminal,
    onCopyPath: () => onCopyPath(),
    onPaste,
    onNewFolder,
    onNewFile,
    onOpenTerminal: onOpenTerminal ? () => onOpenTerminal() : undefined,
    onRefresh,
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border/60 bg-card">
      <div className="shrink-0 border-b border-border/60 px-3 py-2">
        <div className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">{title}</div>
        <div className="truncate text-sm font-medium">{hostLabel(host)}</div>
      </div>
      <div className="flex items-center gap-1 border-b border-border/60 bg-muted/30 px-1 py-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          disabled={pane.connecting || atRoot}
          title={t("dataRelay.browser.parent")}
          onClick={onParent}
        >
          <ArrowUp size={14} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          disabled={pane.connecting}
          title={t("dataRelay.browser.home")}
          onClick={onHome}
        >
          <Home size={14} />
        </Button>
        <div className="min-w-0 flex-1 px-1">
          <SftpBreadcrumb
            path={pane.path}
            onNavigate={onNavigate}
            onHome={onHome}
            maxVisibleParts={4}
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          disabled={pane.connecting || !pane.ready}
          title={t("common.refresh")}
          onClick={onRefresh}
        >
          <RefreshCw size={14} className={pane.listing ? "animate-spin" : undefined} />
        </Button>
      </div>
      <div className="relative min-h-0 flex-1">
        {(pane.connecting || pane.listing || busy) && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/70">
            <Loader2 size={18} className="animate-spin text-muted-foreground" />
          </div>
        )}
        <PathListPaneContextMenu {...paneActions}>
          {pane.error ? (
            <div className="flex h-full items-center justify-center px-4 text-center text-xs text-destructive">
              {pane.error}
            </div>
          ) : pane.files.length === 0 && !pane.connecting && !pane.listing ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              {t("dataRelay.browser.empty")}
            </div>
          ) : (
            <ScrollArea className="h-full">
              <div className="p-1">
                {pane.files.map((file) => {
                  const kind = compared ? kindByName.get(file.name) : undefined;
                  const visibleKind = side === "left" && kind === "right-only"
                    ? undefined
                    : side === "right" && kind === "left-only"
                      ? undefined
                      : kind;
                  return (
                    <PathListEntryContextMenu
                      key={`${side}:${file.name}`}
                      disabled={!canMutate}
                      canOpenTerminal={canOpenTerminal}
                      onCopyPath={() => onCopyPath(file)}
                      onCopy={() => onCopy(file)}
                      onPaste={onPaste}
                      onNewFolder={onNewFolder}
                      onNewFile={onNewFile}
                      onDelete={() => onDelete(file)}
                      onOpenTerminal={onOpenTerminal ? () => onOpenTerminal(file) : undefined}
                    >
                      <button
                        type="button"
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-foreground/5",
                          selectedName === file.name && "bg-accent text-accent-foreground",
                          visibleKind && kindClass(visibleKind),
                        )}
                        onClick={() => onSelect(file.name)}
                        onDoubleClick={() => onOpen(file)}
                      >
                        {isDir(file)
                          ? <Folder size={14} className="shrink-0 text-amber-500" />
                          : <File size={14} className="shrink-0 text-muted-foreground" />}
                        <span className="min-w-0 flex-1 truncate font-mono">{file.name}</span>
                        <span className="w-20 shrink-0 text-right text-[10px] text-muted-foreground">
                          {isDir(file) ? "" : formatFileSize(file.size)}
                        </span>
                        <span className="w-[9.5rem] shrink-0 text-right text-[10px] text-muted-foreground">
                          {formatDate(file.lastModified)}
                        </span>
                      </button>
                    </PathListEntryContextMenu>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </PathListPaneContextMenu>
      </div>
    </div>
  );
};

export const CompareView: React.FC<CompareViewProps> = ({
  rule,
  hosts,
  keys,
  identities,
  knownHosts,
  terminalSettings,
  sourceHost,
  destHost,
  onEdit,
  onStart,
  onStop,
  onScanSettingsChange,
  onOpenTerminalAtPath,
  onPersistBrowsePaths,
}) => {
  const { t } = useI18n();
  const {
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
    copySelection,
    cancelCompare,
    refreshBoth,
  } = useDataRelayCompareSession({
    active: true,
    rule,
    sourceHost,
    destHost,
    hosts,
    keys,
    identities,
    knownHosts,
    terminalSettings,
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [nameDialog, setNameDialog] = useState<{
    side: DataRelayCompareSide;
    kind: PathNameDialogKind;
  } | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [createFolderError, setCreateFolderError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    side: DataRelayCompareSide;
    file: DataRelayCompareFile;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [logHeight, setLogHeight, persistLogHeight] = useStoredNumber(
    STORAGE_KEY_DATA_RELAY_COMPARE_LOG_HEIGHT,
    COMPARE_LOG_HEIGHT_DEFAULT,
    { min: COMPARE_LOG_HEIGHT_MIN, max: COMPARE_LOG_HEIGHT_MAX },
  );
  const logHeightRef = useRef(logHeight);
  const logDragRef = useRef<{ startY: number; startHeight: number } | null>(null);
  logHeightRef.current = logHeight;
  const running = isRelayRuleRunning(rule);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const drag = logDragRef.current;
      if (!drag) return;
      setLogHeight(clampCompareLogHeight(drag.startHeight + (drag.startY - event.clientY)));
    };
    const handleMouseUp = () => {
      if (!logDragRef.current) return;
      logDragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      persistLogHeight(logHeightRef.current);
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [persistLogHeight, setLogHeight]);

  const handleLogResizeStart = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    logDragRef.current = {
      startY: event.clientY,
      startHeight: logHeight,
    };
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  }, [logHeight]);

  const persistBrowsePaths = useCallback((options?: { preserveRuntime?: boolean }) => {
    if (!onPersistBrowsePaths) return true;
    if (!left.ready && !right.ready) return true;
    return onPersistBrowsePaths({
      sourcePath: left.ready ? left.path : undefined,
      destPath: right.ready ? right.path : undefined,
    }, options) !== false;
  }, [left.path, left.ready, onPersistBrowsePaths, right.path, right.ready]);
  const persistBrowsePathsRef = useRef(persistBrowsePaths);
  persistBrowsePathsRef.current = persistBrowsePaths;
  const runningRef = useRef(running);
  runningRef.current = running;

  // Folder scans copy in background SFTP sessions; without a re-list the
  // panes keep showing pre-transfer listings, which reads as "nothing was
  // transferred". Each completed pass bumps rule.lastUsedAt via the active
  // status patch, so follow it with a light pane refresh.
  const lastScanPassRef = useRef<number | null>(null);
  useEffect(() => {
    if (!running) {
      lastScanPassRef.current = null;
      return;
    }
    const signal = rule.lastUsedAt ?? null;
    if (signal === null || signal === lastScanPassRef.current) return;
    const firstObservation = lastScanPassRef.current === null;
    lastScanPassRef.current = signal;
    if (firstObservation || comparing || copying) return;
    void refreshBoth();
  }, [rule.lastUsedAt, running, comparing, copying, refreshBoth]);

  const browsePathUpdate = left.ready || right.ready
    ? buildDataRelayBrowsePathUpdate(rule, {
      sourcePath: left.ready ? left.path : undefined,
      destPath: right.ready ? right.path : undefined,
    })
    : null;
  const pathsDirty = Boolean(browsePathUpdate);

  useEffect(() => {
    return () => {
      if (runningRef.current) return;
      persistBrowsePathsRef.current({ preserveRuntime: true });
    };
  }, []);

  const handleSaveSyncPaths = useCallback(() => {
    if (!persistBrowsePaths({ preserveRuntime: false })) return;
    toast.success(t("dataRelay.compare.pathsSaved"));
  }, [persistBrowsePaths, t]);

  const handleStart = useCallback(() => {
    if (!persistBrowsePaths({ preserveRuntime: false })) return;
    onStart();
  }, [onStart, persistBrowsePaths]);

  const copyPathToClipboard = useCallback(async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      toast.success(t("sftp.copyCurrentPath.success"));
    } catch {
      toast.error(t("sftp.copyCurrentPath.error"));
    }
  }, [t]);

  const notifyPasteError = useCallback((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "empty") toast.error(t("dataRelay.context.pasteEmpty"));
    else if (message === "same-path") toast.info(t("dataRelay.context.pasteSamePath"));
    else if (message === "source-gone") toast.error(t("dataRelay.context.pasteSourceGone"));
    else toast.error(message || t("dataRelay.context.pasteFailed"));
  }, [t]);

  const openNameDialog = useCallback((side: DataRelayCompareSide, kind: PathNameDialogKind) => {
    const pane = side === "left" ? left : right;
    setNameDialog({ side, kind });
    setNewFolderName(kind === "file" ? getNextUntitledName(pane.files.map((file) => file.name)) : "");
    setCreateFolderError(null);
  }, [left, right]);

  const handleCreateNamedEntry = useCallback(async () => {
    if (!nameDialog) return;
    setCreatingFolder(true);
    setCreateFolderError(null);
    try {
      if (nameDialog.kind === "file") {
        await createFile(nameDialog.side, newFolderName);
      } else {
        await createFolder(nameDialog.side, newFolderName);
      }
      setNameDialog(null);
      setNewFolderName("");
    } catch (err) {
      setCreateFolderError(
        err instanceof Error
          ? err.message
          : t(nameDialog.kind === "file" ? "sftp.error.createFileFailed" : "sftp.error.createFolderFailed"),
      );
    } finally {
      setCreatingFolder(false);
    }
  }, [createFile, createFolder, nameDialog, newFolderName, t]);

  const handleCopyPath = useCallback((side: DataRelayCompareSide, file?: DataRelayCompareFile) => {
    const pane = side === "left" ? left : right;
    void copyPathToClipboard(file ? joinPath(pane.path, file.name) : pane.path);
  }, [copyPathToClipboard, left, right]);

  const handleCopy = useCallback((side: DataRelayCompareSide, file: DataRelayCompareFile) => {
    const count = copyEntries(side, [file]);
    if (count > 0) toast.success(t("dataRelay.context.copySuccess", { count }));
  }, [copyEntries, t]);

  const handlePaste = useCallback(async (side: DataRelayCompareSide) => {
    try {
      const result = await pasteEntries(side);
      if (result.copied.length > 0) {
        toast.success(t("dataRelay.context.pasteSuccess", { count: result.copied.length }));
      }
    } catch (err) {
      notifyPasteError(err);
    }
  }, [notifyPasteError, pasteEntries, t]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const result = await deleteEntries(deleteTarget.side, [deleteTarget.file]);
      if (result.deleted.length > 0) {
        toast.success(t("dataRelay.context.deleteSuccess", { count: result.deleted.length }));
      }
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("sftp.error.deleteFailed"));
    } finally {
      setDeleting(false);
    }
  }, [deleteEntries, deleteTarget, t]);

  const handleOpenTerminal = useCallback((side: DataRelayCompareSide, file?: DataRelayCompareFile) => {
    const host = side === "left" ? sourceHost : destHost;
    if (!host || !onOpenTerminalAtPath) return;
    const pane = side === "left" ? left : right;
    onOpenTerminalAtPath(
      host,
      resolveOpenTerminalPath(pane.path, file ? { name: file.name, isDirectory: isDir(file) } : null),
    );
  }, [destHost, left, onOpenTerminalAtPath, right, sourceHost]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{rule.label}</div>
          <div className="truncate font-mono text-[11px] text-muted-foreground">
            {hostLabel(sourceHost)} {left.ready ? left.path : (rule.sourcePath || rule.sourceCommand)}
            <span className="mx-1 opacity-60">-&gt;</span>
            {hostLabel(destHost)} {right.ready ? right.path : rule.destPath}
          </div>
          {rule.error ? (
            <div className="truncate text-[11px] text-destructive">{rule.error}</div>
          ) : null}
        </div>
        <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium", getRelayStatusTone(rule.status))}>
          {t(getRelayStatusLabelKey(rule.status))}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1"
          disabled={comparing || copying || !left.ready || !right.ready}
          onClick={() => {
            setDialogOpen(true);
            void runCompare();
          }}
        >
          {comparing ? <Loader2 size={14} className="animate-spin" /> : <GitCompare size={14} />}
          {t("dataRelay.compare.run")}
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={onEdit} title={t("action.edit")}>
          <Pencil size={14} />
        </Button>
        <ScanSettingsPopover rule={rule} onChange={onScanSettingsChange} />
        <Button
          type="button"
          variant={pathsDirty ? "outline" : "ghost"}
          size="icon"
          className="h-8 w-8"
          disabled={!pathsDirty || running || comparing || copying || (!left.ready && !right.ready)}
          onClick={handleSaveSyncPaths}
          title={t("dataRelay.compare.savePaths")}
        >
          <Save size={14} />
        </Button>
        {running ? (
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={onStop} title={t("action.stop")}>
            <Square size={13} className="fill-current" />
          </Button>
        ) : (
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={handleStart} title={t("action.start")}>
            <Play size={14} />
          </Button>
        )}
      </div>

      <div className="flex min-h-0 flex-1 gap-2 p-2">
        <ComparePane
          side="left"
          title={t("dataRelay.form.sourceHost")}
          host={sourceHost}
          pane={left}
          busy={comparing || copying || deleting}
          selectedName={selectedName}
          kindByName={kindByName}
          compared={compared}
          onSelect={setSelectedName}
          onOpen={(file) => openEntry("left", file)}
          onNavigate={(path) => void navigate("left", path)}
          onParent={() => goParent("left")}
          onHome={() => void navigate("left", left.homeDir)}
          onRefresh={() => void navigate("left", left.path)}
          onNewFolder={() => openNameDialog("left", "folder")}
          onNewFile={() => openNameDialog("left", "file")}
          onCopyPath={(file) => handleCopyPath("left", file)}
          onCopy={(file) => handleCopy("left", file)}
          onPaste={() => void handlePaste("left")}
          onDelete={(file) => setDeleteTarget({ side: "left", file })}
          onOpenTerminal={onOpenTerminalAtPath ? (file) => handleOpenTerminal("left", file) : undefined}
        />
        <div className="hidden w-6 shrink-0 items-center justify-center md:flex">
          <ArrowLeftRight size={16} className="text-muted-foreground" />
        </div>
        <ComparePane
          side="right"
          title={t("dataRelay.form.destHost")}
          host={destHost}
          pane={right}
          busy={comparing || copying || deleting}
          selectedName={selectedName}
          kindByName={kindByName}
          compared={compared}
          onSelect={setSelectedName}
          onOpen={(file) => openEntry("right", file)}
          onNavigate={(path) => void navigate("right", path)}
          onParent={() => goParent("right")}
          onHome={() => void navigate("right", right.homeDir)}
          onRefresh={() => void navigate("right", right.path)}
          onNewFolder={() => openNameDialog("right", "folder")}
          onNewFile={() => openNameDialog("right", "file")}
          onCopyPath={(file) => handleCopyPath("right", file)}
          onCopy={(file) => handleCopy("right", file)}
          onPaste={() => void handlePaste("right")}
          onDelete={(file) => setDeleteTarget({ side: "right", file })}
          onOpenTerminal={onOpenTerminalAtPath ? (file) => handleOpenTerminal("right", file) : undefined}
        />
      </div>

      <div
        className="flex shrink-0 flex-col border-t border-border/60 bg-muted/20"
        style={{ height: logHeight }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className="group flex h-3 shrink-0 cursor-row-resize items-center justify-center text-muted-foreground/70"
              onMouseDown={handleLogResizeStart}
            >
              <GripHorizontal size={14} className="transition-colors group-hover:text-foreground/80" />
            </div>
          </TooltipTrigger>
          <TooltipContent>{t("sftp.transfers.dragToResize")}</TooltipContent>
        </Tooltip>
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-border/60 px-3 py-1.5 text-[11px]">
          <span className="font-medium">{t("dataRelay.compare.syncInfo")}</span>
          <span>{t("dataRelay.compare.summary.same")}: {summary.same}</span>
          <span className="text-sky-700 dark:text-sky-300">
            {t("dataRelay.compare.summary.leftOnly")}: {summary.leftOnly}
          </span>
          <span className="text-violet-700 dark:text-violet-300">
            {t("dataRelay.compare.summary.rightOnly")}: {summary.rightOnly}
          </span>
          <span className="text-amber-700 dark:text-amber-300">
            {t("dataRelay.compare.summary.different")}: {summary.different}
          </span>
          {(rule.bytesTransferred ?? 0) > 0 && (
            <span>
              {t("dataRelay.transferred")}: {formatRelayBytes(rule.bytesTransferred)}
            </span>
          )}
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-0.5 px-3 py-2 font-mono text-[11px] text-muted-foreground">
            {log.length === 0 ? (
              <div>{t("dataRelay.compare.logHint")}</div>
            ) : (
              log.map((entry, index) => (
                <div
                  key={`${entry.at}-${index}`}
                  className={cn(
                    entry.tone === "error" && "text-destructive",
                    entry.tone === "success" && "text-emerald-600 dark:text-emerald-400",
                  )}
                >
                  {new Date(entry.at).toLocaleTimeString()} {entry.message}
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      <CompareSyncDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        comparing={comparing}
        copying={copying}
        compareProgress={compareProgress}
        copyProgress={copyProgress}
        rows={compared ? rows : []}
        summary={summary}
        onCancelCompare={cancelCompare}
        onSync={(direction, paths) => void copySelection(direction, paths)}
      />

      <NewFolderDialog
        open={nameDialog !== null}
        kind={nameDialog?.kind ?? "folder"}
        name={newFolderName}
        creating={creatingFolder}
        error={createFolderError}
        onNameChange={(name) => {
          setNewFolderName(name);
          setCreateFolderError(null);
        }}
        onOpenChange={(open) => {
          if (!open) {
            setNameDialog(null);
            setNewFolderName("");
            setCreateFolderError(null);
          }
        }}
        onCreate={() => void handleCreateNamedEntry()}
      />

      <PathListDeleteConfirmDialog
        open={deleteTarget !== null}
        hostLabel={hostLabel(deleteTarget?.side === "right" ? destHost : sourceHost)}
        path={deleteTarget
          ? joinPath(
            (deleteTarget.side === "left" ? left : right).path,
            deleteTarget.file.name,
          )
          : ""}
        deleting={deleting}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        onConfirm={() => void handleDeleteConfirm()}
      />
    </div>
  );
};

export default CompareView;
