import { ArrowLeft, ArrowRight, ArrowLeftRight, Loader2 } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../application/i18n/I18nProvider";
import { formatFileSize } from "../../application/state/sftp/utils";
import {
  dataRelayCompareRowAppliesToDirection,
  isDataRelayCompareDirectory,
  type DataRelayCompareKind,
  type DataRelayCompareProgress,
  type DataRelayCompareRow,
  type DataRelayCompareSyncDirection,
} from "../../domain/dataRelayCompare";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { FixedSizeVirtualList } from "../ui/FixedSizeVirtualList";
import { Input } from "../ui/input";

const ROW_HEIGHT = 32;

export interface CompareSyncDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  comparing: boolean;
  copying: boolean;
  compareProgress: DataRelayCompareProgress | null;
  copyProgress: { done: number; total: number } | null;
  rows: DataRelayCompareRow[];
  summary: { same: number; leftOnly: number; rightOnly: number; different: number };
  onCancelCompare?: () => void;
  onSync: (direction: DataRelayCompareSyncDirection, paths: string[]) => void;
}

const kindLabelKey = (kind: DataRelayCompareKind): string => {
  switch (kind) {
    case "left-only":
      return "dataRelay.compare.summary.leftOnly";
    case "right-only":
      return "dataRelay.compare.summary.rightOnly";
    case "newer-left":
      return "dataRelay.compare.kind.newerLeft";
    case "newer-right":
      return "dataRelay.compare.kind.newerRight";
    case "size-diff":
      return "dataRelay.compare.kind.size";
    case "type-diff":
      return "dataRelay.compare.kind.type";
    case "content-diff":
      return "dataRelay.compare.kind.content";
    default:
      return "dataRelay.compare.summary.same";
  }
};

const kindClass = (kind: DataRelayCompareKind): string => {
  switch (kind) {
    case "left-only":
      return "text-sky-700 dark:text-sky-300";
    case "right-only":
      return "text-violet-700 dark:text-violet-300";
    default:
      return "text-amber-800 dark:text-amber-300";
  }
};

const rowSize = (row: DataRelayCompareRow): number =>
  row.left?.size ?? row.right?.size ?? 0;

export const CompareSyncDialog: React.FC<CompareSyncDialogProps> = ({
  open,
  onOpenChange,
  comparing,
  copying,
  compareProgress,
  copyProgress,
  rows,
  summary,
  onCancelCompare,
  onSync,
}) => {
  const { t } = useI18n();
  const [direction, setDirection] = useState<DataRelayCompareSyncDirection>("left-to-right");
  const [search, setSearch] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const applicable = useMemo(
    () => rows.filter((row) => dataRelayCompareRowAppliesToDirection(row, direction)),
    [direction, rows],
  );

  useEffect(() => {
    setChecked((current) => {
      if (applicable.length === 0) return new Set();
      const next = new Set<string>();
      for (const row of applicable) {
        if (current.has(row.relativePath)) next.add(row.relativePath);
      }
      if (next.size === 0) {
        return new Set(applicable.map((row) => row.relativePath));
      }
      return next;
    });
  }, [applicable]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return applicable;
    return applicable.filter((row) => row.relativePath.toLowerCase().includes(query));
  }, [applicable, search]);

  const checkedCount = checked.size;
  const busy = comparing || copying;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (copying) return;
        if (!next && comparing) onCancelCompare?.();
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="flex h-[min(640px,85vh)] w-[min(920px,94vw)] max-w-none flex-col gap-3 p-4"
        onPointerDownOutside={(event) => { if (copying) event.preventDefault(); }}
        onEscapeKeyDown={(event) => { if (copying) event.preventDefault(); }}
      >
        <DialogHeader className="shrink-0 space-y-1">
          <DialogTitle>{t("dataRelay.compare.dialogTitle")}</DialogTitle>
          <DialogDescription>
            {comparing
              ? t("dataRelay.compare.comparingProgress", {
                scanned: compareProgress?.scanned ?? 0,
                diffs: compareProgress?.diffs ?? 0,
              })
              : t("dataRelay.compare.dialogHint")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">{t("dataRelay.compare.direction")}</span>
          <Button
            type="button"
            size="sm"
            variant={direction === "left-to-right" ? "default" : "outline"}
            className="h-8 gap-1"
            disabled={busy}
            onClick={() => setDirection("left-to-right")}
          >
            <ArrowRight size={14} />
            {t("dataRelay.compare.direction.toDest")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={direction === "right-to-left" ? "default" : "outline"}
            className="h-8 gap-1"
            disabled={busy}
            onClick={() => setDirection("right-to-left")}
          >
            <ArrowLeft size={14} />
            {t("dataRelay.compare.direction.toSource")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={direction === "both" ? "default" : "outline"}
            className="h-8 gap-1"
            disabled={busy}
            onClick={() => setDirection("both")}
          >
            <ArrowLeftRight size={14} />
            {t("dataRelay.compare.direction.both")}
          </Button>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
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
          <span className="ml-auto">
            {t("dataRelay.compare.checkedCount", { checked: checkedCount, total: applicable.length })}
          </span>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border/60">
          <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-2 py-1.5">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("dataRelay.compare.search")}
              className="h-8 flex-1 text-xs"
              disabled={comparing}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8"
              disabled={busy || visible.length === 0}
              onClick={() => setChecked(new Set(visible.map((row) => row.relativePath)))}
            >
              {t("dataRelay.compare.selectAll")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8"
              disabled={busy || checkedCount === 0}
              onClick={() => setChecked(new Set())}
            >
              {t("dataRelay.compare.selectNone")}
            </Button>
          </div>
          <div className="relative min-h-0 flex-1">
            {comparing ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 size={20} className="animate-spin" />
                <div>{t("dataRelay.compare.comparing")}</div>
              </div>
            ) : visible.length === 0 ? (
              <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
                {rows.length === 0
                  ? t("dataRelay.compare.noDifferences")
                  : t("dataRelay.compare.noDirectionItems")}
              </div>
            ) : (
              <FixedSizeVirtualList
                items={visible}
                itemHeight={ROW_HEIGHT}
                getItemKey={(row) => row.relativePath}
                renderItem={(row) => {
                  const isDir = isDataRelayCompareDirectory(row.left) || isDataRelayCompareDirectory(row.right);
                  return (
                    <label className="flex h-full cursor-pointer items-center gap-2 px-2 text-xs hover:bg-foreground/5">
                      <input
                        type="checkbox"
                        className="shrink-0"
                        checked={checked.has(row.relativePath)}
                        disabled={busy}
                        onChange={() => {
                          setChecked((current) => {
                            const next = new Set(current);
                            if (next.has(row.relativePath)) next.delete(row.relativePath);
                            else next.add(row.relativePath);
                            return next;
                          });
                        }}
                      />
                      <span className="min-w-0 flex-1 truncate font-mono">{row.relativePath}</span>
                      <span className="w-16 shrink-0 text-right text-[10px] text-muted-foreground">
                        {isDir ? "" : formatFileSize(rowSize(row))}
                      </span>
                      <span className={cn("w-28 shrink-0 text-right text-[10px]", kindClass(row.kind))}>
                        {t(kindLabelKey(row.kind))}
                      </span>
                    </label>
                  );
                }}
              />
            )}
          </div>
        </div>

        <DialogFooter className="shrink-0 sm:justify-between">
          <div className="text-xs text-muted-foreground">
            {copying && copyProgress
              ? t("dataRelay.compare.copyingProgress", {
                done: copyProgress.done,
                total: copyProgress.total,
              })
              : null}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" disabled={copying} onClick={() => {
              if (comparing) onCancelCompare?.();
              onOpenChange(false);
            }}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              disabled={busy || checkedCount === 0}
              onClick={() => onSync(direction, [...checked])}
            >
              {copying ? <Loader2 size={14} className="animate-spin" /> : null}
              {t("dataRelay.compare.sync")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
