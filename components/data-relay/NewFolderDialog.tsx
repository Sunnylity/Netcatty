import {
  ClipboardCopy,
  ClipboardPaste,
  Copy,
  FilePlus,
  FolderPlus,
  Loader2,
  RefreshCw,
  Terminal,
  Trash2,
  Upload,
} from "lucide-react";
import React from "react";
import { useI18n } from "../../application/i18n/I18nProvider";
import { useDataRelayPathClipboard } from "../../application/state/sftp/dataRelayPathClipboardStore";
import { getFileName, isSafeNewFolderName } from "../../application/state/sftp/utils";
import { Button } from "../ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

export interface PathListContextActions {
  disabled?: boolean;
  canCopy?: boolean;
  canOpenTerminal?: boolean;
  onCopyPath: () => void;
  onCopy?: () => void;
  onPaste: () => void;
  onNewFolder: () => void;
  onNewFile: () => void;
  onOpenTerminal?: () => void;
  onRefresh?: () => void;
  onDelete?: () => void;
  /** Push one source subdirectory to the destination, overwriting. */
  onUploadDir?: () => void;
}

const PathListContextMenuItems: React.FC<PathListContextActions & { variant: "row" | "empty" }> = ({
  variant,
  disabled = false,
  canCopy = false,
  canOpenTerminal = false,
  onCopyPath,
  onCopy,
  onPaste,
  onNewFolder,
  onNewFile,
  onOpenTerminal,
  onRefresh,
  onDelete,
  onUploadDir,
}) => {
  const { t } = useI18n();
  const clipboard = useDataRelayPathClipboard();
  const canPaste = Boolean(clipboard?.files.length) && !disabled;

  if (variant === "row") {
    return (
      <>
        <ContextMenuItem disabled={disabled} onSelect={onCopyPath}>
          <ClipboardCopy size={14} className="mr-2" />
          {t("sftp.context.copyPath")}
        </ContextMenuItem>
        {onCopy ? (
          <ContextMenuItem disabled={disabled || !canCopy} onSelect={() => onCopy()}>
            <Copy size={14} className="mr-2" />
            {t("action.copy")}
          </ContextMenuItem>
        ) : null}
        {onPaste ? (
          <ContextMenuItem disabled={!canPaste} onSelect={onPaste}>
            <ClipboardPaste size={14} className="mr-2" />
            {t("dataRelay.context.paste")}
          </ContextMenuItem>
        ) : null}
        {onUploadDir ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem disabled={disabled} onSelect={onUploadDir}>
              <Upload size={14} className="mr-2" />
              {t("dataRelay.context.uploadDir")}
            </ContextMenuItem>
          </>
        ) : null}
        <ContextMenuSeparator />
        <ContextMenuItem disabled={disabled} onSelect={onNewFolder}>
          <FolderPlus size={14} className="mr-2" />
          {t("sftp.newFolder")}
        </ContextMenuItem>
        <ContextMenuItem disabled={disabled} onSelect={onNewFile}>
          <FilePlus size={14} className="mr-2" />
          {t("sftp.newFile")}
        </ContextMenuItem>
        {onOpenTerminal ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem disabled={!canOpenTerminal} onSelect={onOpenTerminal}>
              <Terminal size={14} className="mr-2" />
              {t("dataRelay.context.openTerminal")}
            </ContextMenuItem>
          </>
        ) : null}
        {onDelete ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              className="text-destructive focus:text-destructive"
              disabled={disabled}
              onSelect={onDelete}
            >
              <Trash2 size={14} className="mr-2" />
              {t("sftp.context.delete")}
            </ContextMenuItem>
          </>
        ) : null}
      </>
    );
  }

  return (
    <>
      <ContextMenuItem disabled={disabled} onSelect={onNewFolder}>
        <FolderPlus size={14} className="mr-2" />
        {t("sftp.newFolder")}
      </ContextMenuItem>
      <ContextMenuItem disabled={disabled} onSelect={onNewFile}>
        <FilePlus size={14} className="mr-2" />
        {t("sftp.newFile")}
      </ContextMenuItem>
      {onPaste ? (
        <ContextMenuItem disabled={!canPaste} onSelect={onPaste}>
          <ClipboardPaste size={14} className="mr-2" />
          {t("dataRelay.context.paste")}
        </ContextMenuItem>
      ) : null}
      <ContextMenuSeparator />
      <ContextMenuItem disabled={disabled} onSelect={onCopyPath}>
        <ClipboardCopy size={14} className="mr-2" />
        {t("dataRelay.context.copyPath")}
      </ContextMenuItem>
      {onOpenTerminal ? (
        <ContextMenuItem disabled={!canOpenTerminal} onSelect={onOpenTerminal}>
          <Terminal size={14} className="mr-2" />
          {t("dataRelay.context.openTerminal")}
        </ContextMenuItem>
      ) : null}
      {onRefresh ? (
        <ContextMenuItem disabled={disabled} onSelect={onRefresh}>
          <RefreshCw size={14} className="mr-2" />
          {t("common.refresh")}
        </ContextMenuItem>
      ) : null}
    </>
  );
};

export interface PathListPaneContextMenuProps extends PathListContextActions {
  children: React.ReactNode;
}

export const PathListPaneContextMenu: React.FC<PathListPaneContextMenuProps> = ({
  children,
  ...actions
}) => (
  <ContextMenu>
    <ContextMenuTrigger asChild>
      <div className="h-full">{children}</div>
    </ContextMenuTrigger>
    <ContextMenuContent>
      <PathListContextMenuItems variant="empty" {...actions} />
    </ContextMenuContent>
  </ContextMenu>
);

export interface PathListEntryContextMenuProps extends PathListContextActions {
  children: React.ReactNode;
}

export const PathListEntryContextMenu: React.FC<PathListEntryContextMenuProps> = ({
  children,
  ...actions
}) => (
  <ContextMenu>
    <ContextMenuTrigger asChild>
      {children}
    </ContextMenuTrigger>
    <ContextMenuContent>
      <PathListContextMenuItems variant="row" {...actions} canCopy />
    </ContextMenuContent>
  </ContextMenu>
);

/** @deprecated Use PathListPaneContextMenu */
export const PathListNewFolderMenu = PathListPaneContextMenu;

export interface PathListDeleteConfirmDialogProps {
  open: boolean;
  hostLabel?: string;
  path: string;
  deleting?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export const PathListDeleteConfirmDialog: React.FC<PathListDeleteConfirmDialogProps> = ({
  open,
  hostLabel,
  path,
  deleting = false,
  onOpenChange,
  onConfirm,
}) => {
  const { t } = useI18n();
  const confirmButtonRef = React.useRef<HTMLButtonElement>(null);
  const name = getFileName(path) || path;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (deleting) return;
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        className="max-w-[calc(100vw-2rem)] overflow-hidden sm:max-w-sm"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          confirmButtonRef.current?.focus();
        }}
      >
        <DialogHeader className="min-w-0 pr-6">
          <DialogTitle className="truncate">
            {t("sftp.deleteConfirm.single", { name })}
          </DialogTitle>
          <DialogDescription className="break-words [overflow-wrap:anywhere]">
            {t("sftp.deleteConfirm.descSingle")}
          </DialogDescription>
        </DialogHeader>
        <div className="min-w-0 space-y-1.5 text-xs text-muted-foreground">
          {hostLabel ? (
            <div className="flex min-w-0 items-start gap-2">
              <span className="shrink-0 font-medium text-foreground/80">{t("sftp.deleteConfirm.host")}:</span>
              <span className="min-w-0 break-words [overflow-wrap:anywhere]">{hostLabel}</span>
            </div>
          ) : null}
          <div className="flex min-w-0 items-start gap-2">
            <span className="shrink-0 font-medium text-foreground/80">{t("sftp.deleteConfirm.path")}:</span>
            <span className="min-w-0 break-all font-mono [overflow-wrap:anywhere]">{path}</span>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={deleting} onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            ref={confirmButtonRef}
            type="button"
            variant="destructive"
            disabled={deleting}
            onClick={onConfirm}
          >
            {deleting ? <Loader2 size={14} className="mr-2 animate-spin" /> : null}
            {t("action.delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export type PathNameDialogKind = "folder" | "file";

export interface PathListUploadConfirmDialogProps {
  open: boolean;
  hostLabel?: string;
  path: string;
  targetPath?: string;
  uploading?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export const PathListUploadConfirmDialog: React.FC<PathListUploadConfirmDialogProps> = ({
  open,
  hostLabel,
  path,
  targetPath,
  uploading = false,
  onOpenChange,
  onConfirm,
}) => {
  const { t } = useI18n();
  const confirmButtonRef = React.useRef<HTMLButtonElement>(null);
  const name = getFileName(path) || path;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (uploading) return;
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        className="max-w-[calc(100vw-2rem)] overflow-hidden sm:max-w-sm"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          confirmButtonRef.current?.focus();
        }}
      >
        <DialogHeader className="min-w-0 pr-6">
          <DialogTitle className="truncate">
            {t("dataRelay.context.uploadDirConfirmTitle", { name })}
          </DialogTitle>
          <DialogDescription className="break-words [overflow-wrap:anywhere]">
            {t("dataRelay.context.uploadDirConfirmDesc")}
          </DialogDescription>
        </DialogHeader>
        <div className="min-w-0 space-y-1.5 text-xs text-muted-foreground">
          {hostLabel ? (
            <div className="flex min-w-0 items-start gap-2">
              <span className="shrink-0 font-medium text-foreground/80">{t("sftp.deleteConfirm.host")}:</span>
              <span className="min-w-0 break-words [overflow-wrap:anywhere]">{hostLabel}</span>
            </div>
          ) : null}
          <div className="flex min-w-0 items-start gap-2">
            <span className="shrink-0 font-medium text-foreground/80">{t("dataRelay.context.uploadDirSource")}:</span>
            <span className="min-w-0 break-all font-mono [overflow-wrap:anywhere]">{path}</span>
          </div>
          {targetPath ? (
            <div className="flex min-w-0 items-start gap-2">
              <span className="shrink-0 font-medium text-foreground/80">{t("dataRelay.context.uploadDirTarget")}:</span>
              <span className="min-w-0 break-all font-mono [overflow-wrap:anywhere]">{targetPath}</span>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={uploading} onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            ref={confirmButtonRef}
            type="button"
            disabled={uploading}
            onClick={onConfirm}
          >
            {uploading ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Upload size={14} className="mr-2" />}
            {t("dataRelay.context.uploadDirConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export interface NewFolderDialogProps {
  open: boolean;
  name: string;
  kind?: PathNameDialogKind;
  creating?: boolean;
  error?: string | null;
  onNameChange: (name: string) => void;
  onOpenChange: (open: boolean) => void;
  onCreate: () => void;
}

export const NewFolderDialog: React.FC<NewFolderDialogProps> = ({
  open,
  name,
  kind = "folder",
  creating = false,
  error = null,
  onNameChange,
  onOpenChange,
  onCreate,
}) => {
  const { t } = useI18n();
  const isFile = kind === "file";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{isFile ? t("sftp.newFile") : t("sftp.newFolder")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label>{isFile ? t("sftp.fileName") : t("sftp.folderName")}</Label>
          <Input
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder={isFile ? t("sftp.fileName.placeholder") : t("sftp.folderName.placeholder")}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || creating || !isSafeNewFolderName(name)) return;
              onCreate();
            }}
            autoFocus
          />
          {error ? <div className="text-xs text-destructive">{error}</div> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            onClick={onCreate}
            disabled={!isSafeNewFolderName(name) || creating}
          >
            {creating ? <Loader2 size={14} className="mr-2 animate-spin" /> : null}
            {t("common.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
