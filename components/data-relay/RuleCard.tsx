import { ArrowRight, Loader2, Pencil, Play, Square, Terminal } from 'lucide-react';
import React from 'react';
import { useI18n } from '../../application/i18n/I18nProvider';
import { DataRelayRule, Host } from '../../domain/models';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { ScanSettingsPopover } from './ScanSettingsPopover';
import {
  formatRelayBytes,
  getRelayStatusLabelKey,
  getRelayStatusTone,
  getRelayWriteModeLabelKey,
  isRelayRuleRunning,
} from './utils';

export interface RuleCardProps {
  rule: DataRelayRule;
  sourceHost?: Host;
  destHost?: Host;
  onStart: () => void;
  onStop: () => void;
  onEdit: () => void;
  onOpen: () => void;
  onScanSettingsChange: (updates: Partial<DataRelayRule> & { scanCheckpoint?: DataRelayRule['scanCheckpoint'] | null }) => void;
}

const hostLabel = (host?: Host): string => host?.label || host?.hostname || '—';

export const RuleCard: React.FC<RuleCardProps> = ({
  rule,
  sourceHost,
  destHost,
  onStart,
  onStop,
  onEdit,
  onOpen,
  onScanSettingsChange,
}) => {
  const { t } = useI18n();
  const running = isRelayRuleRunning(rule);
  const connecting = rule.status === 'connecting';

  return (
    <div
      role="button"
      tabIndex={0}
      onDoubleClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onOpen();
      }}
      title={t('dataRelay.compare.openHint')}
      className={cn(
        'group w-full cursor-pointer rounded-xl border border-border/60 bg-card p-4 text-left transition-colors hover:border-border hover:bg-foreground/5',
        (rule.status === 'error' || Boolean(rule.error)) && 'border-destructive/40',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Terminal size={14} className="flex-shrink-0 text-muted-foreground" />
            <span className="truncate text-sm font-medium">{rule.label}</span>
            <span
              className={cn(
                'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium',
                getRelayStatusTone(rule.status),
              )}
            >
              {t(getRelayStatusLabelKey(rule.status))}
            </span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span className="truncate font-mono">{hostLabel(sourceHost)}</span>
            <ArrowRight size={12} className="shrink-0 opacity-60" />
            <span className="truncate font-mono">{hostLabel(destHost)}</span>
            <span className="rounded bg-muted px-1.5 py-0.5">
              {t(getRelayWriteModeLabelKey(rule.writeMode))}
            </span>
          </div>

          <div className="mt-1.5 truncate font-mono text-[11px] text-muted-foreground/80">
            {rule.sourcePath || rule.sourceCommand}
            <span className="mx-1 opacity-60">-&gt;</span>
            {rule.destPath}
          </div>

          {(rule.bytesTransferred ?? 0) > 0 && (
            <div className="mt-1 text-[11px] text-muted-foreground">
              {t('dataRelay.transferred')}: {formatRelayBytes(rule.bytesTransferred)}
            </div>
          )}

          {running && rule.lastUsedAt ? (
            <div className="mt-1 text-[11px] text-muted-foreground">
              {t('dataRelay.scan.lastPass', {
                time: new Date(rule.lastUsedAt).toLocaleTimeString(),
              })}
            </div>
          ) : null}

          {rule.error && (
            <div className="mt-1.5 line-clamp-2 text-[11px] text-destructive">{rule.error}</div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title={t('action.edit')}
            onClick={(event) => {
              event.stopPropagation();
              onEdit();
            }}
          >
            <Pencil size={14} />
          </Button>
          <ScanSettingsPopover rule={rule} onChange={onScanSettingsChange} />
          {running ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title={t('action.stop')}
              onClick={(event) => {
                event.stopPropagation();
                onStop();
              }}
            >
              {connecting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Square size={13} className="fill-current" />
              )}
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title={t('action.start')}
              onClick={(event) => {
                event.stopPropagation();
                onStart();
              }}
            >
              <Play size={14} />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
