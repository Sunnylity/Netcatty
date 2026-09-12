import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowUp,
  Folder,
  File,
  GitCompare,
  Home,
  Loader2,
  Pencil,
  Play,
  RefreshCw,
  Square,
} from "lucide-react";
import React, { useCallback, useState } from "react";
import { useI18n } from "../../application/i18n/I18nProvider";
import {
  useDataRelayCompareSession,
  type DataRelayComparePaneState,
  type DataRelayCompareSide,
} from "../../application/state/useDataRelayCompareSession";
import {
  formatDate,
  formatFileSize,
  getParentPath,
  isWindowsPath,
  isWindowsRoot,
} from "../../application/state/sftp/utils";
import type { DataRelayCompareFile, DataRelayCompareKind } from "../../domain/dataRelayCompare";
import type { DataRelayRule, Host, Identity, KnownHost, SSHKey, TerminalSettings } from "../../domain/models";
import { cn } from "../../lib/utils";
import { SftpBreadcrumb } from "../sftp/SftpBreadcrumb";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import {
  formatRelayBytes,
  getRelayStatusLabelKey,
  getRelayStatusTone,
  isRelayRuleRunning,
} from "./utils";
import { CompareSyncDialog } from "./CompareSyncDialog";
import { NewFolderDialog, PathListNewFolderMenu } from "./NewFolderDialog";
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
  onBack: () => void;
  onEdit: () => void;
  onStart: () => void;
  onStop: () => void;
  onScanSettingsChange: (updates: Partial<DataRelayRule> & { scanCheckpoint?: DataRelayRule["scanCheckpoint"] | null }) => void;
}

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
}) => {
  const { t } = useI18n();
  const parentPath = getParentPath(pane.path);
  const atRoot = isWindowsPath(pane.path)
    ? isWindowsRoot(pane.path)
    : pane.path === "/" || parentPath === pane.path;
  const canCreateFolder = pane.ready && !pane.connecting && !busy;

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
        <PathListNewFolderMenu disabled={!canCreateFolder} onNewFolder={onNewFolder}>
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
                    <button
                      key={`${side}:${file.name}`}
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
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </PathListNewFolderMenu>
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
  onBack,
  onEdit,
  onStart,
  onStop,
  onScanSettingsChange,
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
    openEntry,
    runCompare,
    copySelection,
    cancelCompare,
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
  const [newFolderSide, setNewFolderSide] = useState<DataRelayCompareSide | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [createFolderError, setCreateFolderError] = useState<string | null>(null);
  const running = isRelayRuleRunning(rule);

  const openNewFolderDialog = useCallback((side: DataRelayCompareSide) => {
    setNewFolderSide(side);
    setNewFolderName("");
    setCreateFolderError(null);
  }, []);

  const handleCreateFolder = useCallback(async () => {
    if (!newFolderSide) return;
    setCreatingFolder(true);
    setCreateFolderError(null);
    try {
      await createFolder(newFolderSide, newFolderName);
      setNewFolderSide(null);
      setNewFolderName("");
    } catch (err) {
      setCreateFolderError(err instanceof Error ? err.message : t("sftp.error.createFolderFailed"));
    } finally {
      setCreatingFolder(false);
    }
  }, [createFolder, newFolderName, newFolderSide, t]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2">
        <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 px-2" onClick={onBack}>
          <ArrowLeft size={14} />
          {t("common.back")}
        </Button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{rule.label}</div>
          <div className="truncate font-mono text-[11px] text-muted-foreground">
            {hostLabel(sourceHost)} {rule.sourcePath || rule.sourceCommand}
            <span className="mx-1 opacity-60">-&gt;</span>
            {hostLabel(destHost)} {rule.destPath}
          </div>
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
        {running ? (
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={onStop} title={t("action.stop")}>
            <Square size={13} className="fill-current" />
          </Button>
        ) : (
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={onStart} title={t("action.start")}>
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
          busy={comparing || copying}
          selectedName={selectedName}
          kindByName={kindByName}
          compared={compared}
          onSelect={setSelectedName}
          onOpen={(file) => openEntry("left", file)}
          onNavigate={(path) => void navigate("left", path)}
          onParent={() => goParent("left")}
          onHome={() => void navigate("left", left.homeDir)}
          onRefresh={() => void navigate("left", left.path)}
          onNewFolder={() => openNewFolderDialog("left")}
        />
        <div className="hidden w-6 shrink-0 items-center justify-center md:flex">
          <ArrowLeftRight size={16} className="text-muted-foreground" />
        </div>
        <ComparePane
          side="right"
          title={t("dataRelay.form.destHost")}
          host={destHost}
          pane={right}
          busy={comparing || copying}
          selectedName={selectedName}
          kindByName={kindByName}
          compared={compared}
          onSelect={setSelectedName}
          onOpen={(file) => openEntry("right", file)}
          onNavigate={(path) => void navigate("right", path)}
          onParent={() => goParent("right")}
          onHome={() => void navigate("right", right.homeDir)}
          onRefresh={() => void navigate("right", right.path)}
          onNewFolder={() => openNewFolderDialog("right")}
        />
      </div>

      <div className="flex h-28 shrink-0 flex-col border-t border-border/60 bg-muted/20">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border/60 px-3 py-1.5 text-[11px]">
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
        open={newFolderSide !== null}
        name={newFolderName}
        creating={creatingFolder}
        error={createFolderError}
        onNameChange={(name) => {
          setNewFolderName(name);
          setCreateFolderError(null);
        }}
        onOpenChange={(open) => {
          if (!open) {
            setNewFolderSide(null);
            setNewFolderName("");
            setCreateFolderError(null);
          }
        }}
        onCreate={() => void handleCreateFolder()}
      />
    </div>
  );
};

export default CompareView;
