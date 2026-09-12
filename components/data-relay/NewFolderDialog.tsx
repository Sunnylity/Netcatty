import { FolderPlus, Loader2 } from "lucide-react";
import React from "react";
import { useI18n } from "../../application/i18n/I18nProvider";
import { isSafeNewFolderName } from "../../application/state/sftp/utils";
import { Button } from "../ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
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

export interface PathListNewFolderMenuProps {
  disabled?: boolean;
  onNewFolder: () => void;
  children: React.ReactNode;
}

export const PathListNewFolderMenu: React.FC<PathListNewFolderMenuProps> = ({
  disabled = false,
  onNewFolder,
  children,
}) => {
  const { t } = useI18n();
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="h-full">{children}</div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem disabled={disabled} onSelect={onNewFolder}>
          <FolderPlus size={14} className="mr-2" />
          {t("sftp.newFolder")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};

export interface NewFolderDialogProps {
  open: boolean;
  name: string;
  creating?: boolean;
  error?: string | null;
  onNameChange: (name: string) => void;
  onOpenChange: (open: boolean) => void;
  onCreate: () => void;
}

export const NewFolderDialog: React.FC<NewFolderDialogProps> = ({
  open,
  name,
  creating = false,
  error = null,
  onNameChange,
  onOpenChange,
  onCreate,
}) => {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("sftp.newFolder")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label>{t("sftp.folderName")}</Label>
          <Input
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder={t("sftp.folderName.placeholder")}
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
