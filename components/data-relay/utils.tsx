import type { DataRelayRule, DataRelayStatus } from '../../domain/models';

/** Human-readable byte count for the transferred-bytes indicator. */
export const formatRelayBytes = (bytes?: number): string => {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let scaled = value / 1024;
  let unitIndex = 0;
  while (scaled >= 1024 && unitIndex < units.length - 1) {
    scaled /= 1024;
    unitIndex += 1;
  }
  return `${scaled.toFixed(scaled >= 100 ? 0 : 1)} ${units[unitIndex]}`;
};

export const getRelayStatusTone = (status: DataRelayStatus): string => {
  switch (status) {
    case 'active':
      return 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30';
    case 'connecting':
      return 'bg-amber-500/15 text-amber-600 border-amber-500/30';
    case 'error':
      return 'bg-destructive/15 text-destructive border-destructive/30';
    default:
      return 'bg-muted text-muted-foreground border-border/60';
  }
};

export const getRelayStatusLabelKey = (status: DataRelayStatus): string =>
  `dataRelay.status.${status}`;

export const getRelayWriteModeLabelKey = (mode: DataRelayRule['writeMode']): string =>
  mode === 'append' ? 'dataRelay.writeMode.append' : 'dataRelay.writeMode.overwrite';

export const isRelayRuleRunning = (rule: Pick<DataRelayRule, 'status'>): boolean =>
  rule.status === 'active' || rule.status === 'connecting';
