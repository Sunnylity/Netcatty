import { Settings2 } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../application/i18n/I18nProvider";
import {
  dataRelayScanIntervalFromParts,
  dataRelayScanIntervalParts,
  normalizeDataRelayScanMode,
  type DataRelayScanIntervalUnit,
} from "../../domain/dataRelayScan";
import type { DataRelayRule, DataRelayScanMode } from "../../domain/models";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { cn } from "../../lib/utils";

export interface ScanSettingsPopoverProps {
  rule: DataRelayRule;
  onChange: (updates: Partial<DataRelayRule> & { scanCheckpoint?: DataRelayRule["scanCheckpoint"] | null }) => void;
}

export const ScanSettingsPopover: React.FC<ScanSettingsPopoverProps> = ({
  rule,
  onChange,
}) => {
  const { t } = useI18n();
  const parts = useMemo(
    () => dataRelayScanIntervalParts(rule.scanIntervalMs),
    [rule.scanIntervalMs],
  );
  const [valueText, setValueText] = useState(String(parts.value));
  useEffect(() => {
    setValueText(String(parts.value));
  }, [parts.value]);
  const mode = normalizeDataRelayScanMode(rule.scanMode);
  const hasCheckpoint = Boolean(rule.scanCheckpoint?.at);

  const commitInterval = (raw: string, unit: DataRelayScanIntervalUnit) => {
    const parsed = Number.parseFloat(raw);
    onChange({
      scanIntervalMs: dataRelayScanIntervalFromParts(
        Number.isFinite(parsed) ? parsed : parts.value,
        unit,
      ),
    });
  };

  return (
    <Popover
      onOpenChange={(open) => {
        if (open) {
          setValueText(String(dataRelayScanIntervalParts(rule.scanIntervalMs).value));
          return;
        }
        commitInterval(valueText, parts.unit);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          title={t("dataRelay.scan.settings")}
          onClick={(event) => event.stopPropagation()}
        >
          <Settings2 size={14} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[280px] space-y-3 p-3">
        <div className="text-sm font-medium">{t("dataRelay.scan.settings")}</div>
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">
            {t("dataRelay.scan.interval")}
          </Label>
          <div className="flex gap-2">
            <Input
              type="number"
              min={1}
              className="h-9"
              value={valueText}
              onChange={(event) => setValueText(event.target.value)}
              onBlur={() => commitInterval(valueText, parts.unit)}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitInterval(valueText, parts.unit);
              }}
            />
            <Select
              value={parts.unit}
              onValueChange={(unit) => {
                const nextUnit = unit as DataRelayScanIntervalUnit;
                commitInterval(valueText, nextUnit);
              }}
            >
              <SelectTrigger className="h-9 w-[108px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="seconds">{t("dataRelay.scan.seconds")}</SelectItem>
                <SelectItem value="minutes">{t("dataRelay.scan.minutes")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="text-[10px] text-muted-foreground">{t("dataRelay.scan.intervalHint")}</p>
        </div>

        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">
            {t("dataRelay.scan.mode")}
          </Label>
          <button
            type="button"
            className={cn(
              "w-full rounded-md border px-2.5 py-2 text-left",
              mode === "mtime" ? "border-border bg-accent/40" : "border-border/60 hover:bg-foreground/5",
            )}
            onClick={() => onChange({ scanMode: "mtime" satisfies DataRelayScanMode })}
          >
            <div className="text-xs font-medium">{t("dataRelay.scan.mode.mtime")}</div>
            <div className="text-[10px] text-muted-foreground">{t("dataRelay.scan.mode.mtimeHint")}</div>
          </button>
          <button
            type="button"
            className={cn(
              "w-full rounded-md border px-2.5 py-2 text-left",
              mode === "checkpoint" ? "border-border bg-accent/40" : "border-border/60 hover:bg-foreground/5",
            )}
            onClick={() => onChange({ scanMode: "checkpoint" })}
          >
            <div className="text-xs font-medium">{t("dataRelay.scan.mode.checkpoint")}</div>
            <div className="text-[10px] text-muted-foreground">{t("dataRelay.scan.mode.checkpointHint")}</div>
          </button>
        </div>

        {mode === "checkpoint" && hasCheckpoint && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 w-full"
            onClick={() => onChange({ scanCheckpoint: null })}
          >
            {t("dataRelay.scan.resetCheckpoint")}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
};

export default ScanSettingsPopover;
