import { ArrowUp, Folder, Home, Loader2, RefreshCw } from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";
import { useI18n } from "../../application/i18n/I18nProvider";
import {
  useRemotePathBrowser,
  type RemotePathBrowserEntry,
} from "../../application/state/sftp/useRemotePathBrowser";
import {
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
import { NewFolderDialog, PathListNewFolderMenu } from "./NewFolderDialog";

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
}) => {
  const { t } = useI18n();
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [createFolderError, setCreateFolderError] = useState<string | null>(null);
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
    if (selectedEntry) {
      return toDataRelayDirectoryHint(joinPath(currentPath, selectedEntry.name));
    }
    if (!currentPath) return null;
    return toDataRelayDirectoryHint(currentPath);
  }, [currentPath, selectedEntry]);

  const canConfirm = confirmPath() !== null;

  const handleConfirm = useCallback(() => {
    const path = confirmPath();
    if (!path) return;
    setShowNewFolder(false);
    setNewFolderName("");
    setCreateFolderError(null);
    onSelect(path);
    onOpenChange(false);
  }, [confirmPath, onSelect, onOpenChange]);

  const handleOpenEntry = useCallback((entry: RemotePathBrowserEntry) => {
    void navigateTo(joinPath(currentPath, entry.name));
  }, [currentPath, navigateTo]);

  const canCreateFolder = sftpReady && !connecting;

  const openNewFolderDialog = useCallback(() => {
    setNewFolderName("");
    setCreateFolderError(null);
    setShowNewFolder(true);
  }, []);

  const handleCreateFolder = useCallback(async () => {
    setCreatingFolder(true);
    setCreateFolderError(null);
    try {
      await createFolder(newFolderName);
      setShowNewFolder(false);
      setNewFolderName("");
    } catch (err) {
      setCreateFolderError(err instanceof Error ? err.message : t("sftp.error.createFolderFailed"));
    } finally {
      setCreatingFolder(false);
    }
  }, [createFolder, newFolderName, t]);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) {
      setShowNewFolder(false);
      setNewFolderName("");
      setCreateFolderError(null);
    }
    onOpenChange(nextOpen);
  }, [onOpenChange]);

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
            {(connecting || listing) && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/70">
                <Loader2 size={20} className="animate-spin text-muted-foreground" />
              </div>
            )}
            <PathListNewFolderMenu disabled={!canCreateFolder} onNewFolder={openNewFolderDialog}>
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
                      return (
                        <button
                          key={`${entry.type}:${entry.name}`}
                          type="button"
                          className={cn(
                            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-foreground/5",
                            selected && "bg-accent text-accent-foreground",
                          )}
                          onClick={() => setSelectedName(entry.name)}
                          onDoubleClick={() => handleOpenEntry(entry)}
                        >
                          <Folder size={14} className="shrink-0 text-amber-500" />
                          <span className="truncate font-mono">{entry.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
            </PathListNewFolderMenu>
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
      open={showNewFolder}
      name={newFolderName}
      creating={creatingFolder}
      error={createFolderError}
      onNameChange={(name) => {
        setNewFolderName(name);
        setCreateFolderError(null);
      }}
      onOpenChange={(nextOpen) => {
        setShowNewFolder(nextOpen);
        if (!nextOpen) {
          setNewFolderName("");
          setCreateFolderError(null);
        }
      }}
      onCreate={() => void handleCreateFolder()}
    />
    </>
  );
};

export default RemotePathBrowserDialog;
