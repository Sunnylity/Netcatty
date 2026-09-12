import { ArrowUp, File, Folder, Home, Loader2, RefreshCw } from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";
import { useI18n } from "../../application/i18n/I18nProvider";
import { resolveOpenTerminalPath } from "../../application/state/sftp/copyRemotePathEntries";
import {
  isRemotePathBrowserDirectory,
  useRemotePathBrowser,
  type RemotePathBrowserEntry,
} from "../../application/state/sftp/useRemotePathBrowser";
import {
  getNextUntitledName,
  getParentPath,
  isWindowsPath,
  isWindowsRoot,
  joinPath,
} from "../../application/state/sftp/utils";
import type {
  Host,
  Identity,
  KnownHost,
  SSHKey,
  TerminalSettings,
} from "../../domain/models";
import { toDataRelayDirectoryHint } from "../../domain/dataRelayPaths";
import { cn } from "../../lib/utils";
import { SftpBreadcrumb } from "../sftp/SftpBreadcrumb";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { ScrollArea } from "../ui/scroll-area";
import { toast } from "../ui/toast";
import {
  NewFolderDialog,
  PathListEntryContextMenu,
  PathListPaneContextMenu,
  type PathNameDialogKind,
} from "./NewFolderDialog";

export interface RemotePathBrowserHostContext {
  hosts: Host[];
  keys: SSHKey[];
  identities: Identity[];
  knownHosts?: KnownHost[];
  terminalSettings?: Pick<
    TerminalSettings,
    "verifyHostKeys" | "keepaliveInterval" | "keepaliveCountMax"
  >;
}

export interface RemotePathBrowserDialogProps extends RemotePathBrowserHostContext {
  open: boolean;
  host: Host | undefined;
  initialPath?: string;
  title: string;
  onSelect: (path: string) => void;
  onOpenChange: (open: boolean) => void;
  onOpenTerminalAtPath?: (host: Host, path: string) => void;
}

export const RemotePathBrowserDialog: React.FC<RemotePathBrowserDialogProps> = ({
  open,
  host,
  hosts,
  keys,
  identities,
  knownHosts,
  terminalSettings,
  initialPath,
  title,
  onSelect,
  onOpenChange,
  onOpenTerminalAtPath,
}) => {
  const { t } = useI18n();
  const [nameDialogKind, setNameDialogKind] = useState<PathNameDialogKind | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [createFolderError, setCreateFolderError] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);
  const {
    connecting,
    listing,
    error,
    homeDir,
    currentPath,
    entries,
    selectedName,
    setSelectedName,
    sftpReady,
    navigateTo,
    createFolder,
    createFile,
    copyEntries,
    pasteEntries,
  } = useRemotePathBrowser({
    open,
    host,
    hosts,
    keys,
    identities,
    knownHosts,
    terminalSettings,
    initialPath,
  });

  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.name === selectedName) ?? null,
    [entries, selectedName],
  );

  const parentPath = getParentPath(currentPath);
  const atRoot = isWindowsPath(currentPath)
    ? isWindowsRoot(currentPath)
    : currentPath === "/" || parentPath === currentPath;

  const confirmPath = useCallback((): string | null => {
    if (selectedEntry && isRemotePathBrowserDirectory(selectedEntry)) {
      return toDataRelayDirectoryHint(joinPath(currentPath, selectedEntry.name));
    }
    if (!currentPath) return null;
    return toDataRelayDirectoryHint(currentPath);
  }, [currentPath, selectedEntry]);

  const canConfirm = confirmPath() !== null;

  const handleConfirm = useCallback(() => {
    const path = confirmPath();
    if (!path) return;
    setNameDialogKind(null);
    setNewFolderName("");
    setCreateFolderError(null);
    onSelect(path);
    onOpenChange(false);
  }, [confirmPath, onSelect, onOpenChange]);

  const handleOpenEntry = useCallback((entry: RemotePathBrowserEntry) => {
    if (!isRemotePathBrowserDirectory(entry)) return;
    void navigateTo(joinPath(currentPath, entry.name));
  }, [currentPath, navigateTo]);

  const canMutate = sftpReady && !connecting && !pasting;
  const canOpenTerminal = Boolean(onOpenTerminalAtPath && host);

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

  const openNameDialog = useCallback((kind: PathNameDialogKind) => {
    setNameDialogKind(kind);
    setNewFolderName(kind === "file" ? getNextUntitledName(entries.map((entry) => entry.name)) : "");
    setCreateFolderError(null);
  }, [entries]);

  const handleCreateNamedEntry = useCallback(async () => {
    if (!nameDialogKind) return;
    setCreatingFolder(true);
    setCreateFolderError(null);
    try {
      if (nameDialogKind === "file") await createFile(newFolderName);
      else await createFolder(newFolderName);
      setNameDialogKind(null);
      setNewFolderName("");
    } catch (err) {
      setCreateFolderError(
        err instanceof Error
          ? err.message
          : t(nameDialogKind === "file" ? "sftp.error.createFileFailed" : "sftp.error.createFolderFailed"),
      );
    } finally {
      setCreatingFolder(false);
    }
  }, [createFile, createFolder, nameDialogKind, newFolderName, t]);

  const handleCopyPath = useCallback((entry?: RemotePathBrowserEntry) => {
    void copyPathToClipboard(entry ? joinPath(currentPath, entry.name) : currentPath);
  }, [copyPathToClipboard, currentPath]);

  const handleCopy = useCallback((entry: RemotePathBrowserEntry) => {
    const count = copyEntries([entry]);
    if (count > 0) toast.success(t("dataRelay.context.copySuccess", { count }));
  }, [copyEntries, t]);

  const handlePaste = useCallback(async () => {
    setPasting(true);
    try {
      const result = await pasteEntries();
      if (result.copied.length > 0) {
        toast.success(t("dataRelay.context.pasteSuccess", { count: result.copied.length }));
      }
    } catch (err) {
      notifyPasteError(err);
    } finally {
      setPasting(false);
    }
  }, [notifyPasteError, pasteEntries, t]);

  const handleOpenTerminal = useCallback((entry?: RemotePathBrowserEntry) => {
    if (!host || !onOpenTerminalAtPath) return;
    onOpenTerminalAtPath(
      host,
      resolveOpenTerminalPath(
        currentPath,
        entry
          ? { name: entry.name, isDirectory: isRemotePathBrowserDirectory(entry) }
          : null,
      ),
    );
  }, [currentPath, host, onOpenTerminalAtPath]);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) {
      setNameDialogKind(null);
      setNewFolderName("");
      setCreateFolderError(null);
    }
    onOpenChange(nextOpen);
  }, [onOpenChange]);

  const paneActions = {
    disabled: !canMutate,
    canOpenTerminal,
    onCopyPath: () => handleCopyPath(),
    onPaste: () => void handlePaste(),
    onNewFolder: () => openNameDialog("folder"),
    onNewFile: () => openNameDialog("file"),
    onOpenTerminal: onOpenTerminalAtPath ? () => handleOpenTerminal() : undefined,
    onRefresh: () => void navigateTo(currentPath),
  };

  return (
    <>
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[80vh] sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex items-center gap-1 rounded-md border border-border/60 bg-muted/30 px-1 py-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              disabled={connecting || atRoot}
              title={t("dataRelay.browser.parent")}
              onClick={() => void navigateTo(parentPath)}
            >
              <ArrowUp size={14} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              disabled={connecting}
              title={t("dataRelay.browser.home")}
              onClick={() => void navigateTo(homeDir)}
            >
              <Home size={14} />
            </Button>
            <div className="min-w-0 flex-1 px-1">
              <SftpBreadcrumb
                path={currentPath}
                onNavigate={(path) => void navigateTo(path)}
                onHome={() => void navigateTo(homeDir)}
                maxVisibleParts={4}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              disabled={connecting || !sftpReady}
              title={t("common.refresh")}
              onClick={() => void navigateTo(currentPath)}
            >
              <RefreshCw size={14} className={listing ? "animate-spin" : undefined} />
            </Button>
          </div>

          <div className="relative min-h-[280px] flex-1 overflow-hidden rounded-md border border-border/60">
            {(connecting || listing || pasting) && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/70">
                <Loader2 size={20} className="animate-spin text-muted-foreground" />
              </div>
            )}
            <PathListPaneContextMenu {...paneActions}>
              {error ? (
                <div className="flex h-full items-center justify-center px-4 text-center text-xs text-destructive">
                  {error}
                </div>
              ) : entries.length === 0 && !connecting && !listing ? (
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                  {t("dataRelay.browser.empty")}
                </div>
              ) : (
                <ScrollArea className="h-[280px]">
                  <div className="p-1">
                    {entries.map((entry) => {
                      const selected = entry.name === selectedName;
                      const isDir = isRemotePathBrowserDirectory(entry);
                      return (
                        <PathListEntryContextMenu
                          key={`${entry.type}:${entry.name}`}
                          disabled={!canMutate}
                          canOpenTerminal={canOpenTerminal}
                          onCopyPath={() => handleCopyPath(entry)}
                          onCopy={() => handleCopy(entry)}
                          onPaste={() => void handlePaste()}
                          onNewFolder={() => openNameDialog("folder")}
                          onNewFile={() => openNameDialog("file")}
                          onOpenTerminal={onOpenTerminalAtPath ? () => handleOpenTerminal(entry) : undefined}
                        >
                          <button
                            type="button"
                            className={cn(
                              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-foreground/5",
                              selected && "bg-accent text-accent-foreground",
                            )}
                            onClick={() => setSelectedName(entry.name)}
                            onDoubleClick={() => handleOpenEntry(entry)}
                          >
                            {isDir
                              ? <Folder size={14} className="shrink-0 text-amber-500" />
                              : <File size={14} className="shrink-0 text-muted-foreground" />}
                            <span className="truncate font-mono">{entry.name}</span>
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

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
            {t("action.cancel")}
          </Button>
          <Button type="button" disabled={!canConfirm || connecting || !!error || !sftpReady} onClick={handleConfirm}>
            {t("dataRelay.browser.selectFolder")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <NewFolderDialog
      open={nameDialogKind !== null}
      kind={nameDialogKind ?? "folder"}
      name={newFolderName}
      creating={creatingFolder}
      error={createFolderError}
      onNameChange={(name) => {
        setNewFolderName(name);
        setCreateFolderError(null);
      }}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setNameDialogKind(null);
          setNewFolderName("");
          setCreateFolderError(null);
        }
      }}
      onCreate={() => void handleCreateNamedEntry()}
    />
    </>
  );
};

export default RemotePathBrowserDialog;
