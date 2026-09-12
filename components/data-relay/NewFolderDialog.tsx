import {
  ClipboardCopy,
  ClipboardPaste,
  Copy,
  FilePlus,
  FolderPlus,
  Loader2,
  RefreshCw,
  Terminal,
} from "lucide-react";
import React from "react";
import { useI18n } from "../../application/i18n/I18nProvider";
import { useDataRelayPathClipboard } from "../../application/state/sftp/dataRelayPathClipboardStore";
import { isSafeNewFolderName } from "../../application/state/sftp/utils";
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
        <ContextMenuItem disabled={disabled || !canCopy} onSelect={() => onCopy?.()}>
          <Copy size={14} className="mr-2" />
          {t("action.copy")}
        </ContextMenuItem>
        <ContextMenuItem disabled={!canPaste} onSelect={onPaste}>
          <ClipboardPaste size={14} className="mr-2" />
          {t("dataRelay.context.paste")}
        </ContextMenuItem>
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
      <ContextMenuItem disabled={!canPaste} onSelect={onPaste}>
        <ClipboardPaste size={14} className="mr-2" />
        {t("dataRelay.context.paste")}
      </ContextMenuItem>
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

export type PathNameDialogKind = "folder" | "file";

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
