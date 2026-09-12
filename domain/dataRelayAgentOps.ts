import { resolveHostOs } from './host';
import type {
  DataRelayRule,
  DataRelayScanCheckpoint,
  DataRelayScanMode,
  DataRelayWriteMode,
  Host,
} from './models';
import { buildDataRelayFollowCommand } from './dataRelayPaths';
import {
  normalizeDataRelayScanIntervalMs,
  normalizeDataRelayScanMode,
} from './dataRelayScan';
import { getNextVaultOrder } from './vaultOrder';

type Result<T> = { ok: true; value: T } | { ok: false; error: string };
type NewRuleValues = { id: string; now: number };

export const hasDataRelayConnectionChanged = (
  existing: DataRelayRule,
  updated: DataRelayRule,
): boolean => (
  existing.sourceHostId !== updated.sourceHostId
  || (existing.sourcePath ?? '') !== (updated.sourcePath ?? '')
  || existing.sourceCommand !== updated.sourceCommand
  || existing.destHostId !== updated.destHostId
  || existing.destPath !== updated.destPath
  || existing.writeMode !== updated.writeMode
);

/**
 * Both ends of a relay must be plain SSH hosts. Plugin / telnet / serial hosts
 * cannot provide a streamable exec channel plus SFTP write.
 */
export const validateDataRelayHost = (
  hosts: Host[],
  hostId: string | undefined,
  role: 'source' | 'destination',
): Result<Host> => {
  const host = hosts.find((candidate) => candidate.id === hostId);
  if (!hostId || !host) {
    return { ok: false, error: `Host "${hostId || ''}" was not found.` };
  }
  if (host.protocol && host.protocol !== 'ssh') {
    return {
      ok: false,
      error: `Host "${hostId}" cannot be used as the ${role} of a data relay; only SSH hosts are supported.`,
    };
  }
  return { ok: true, value: host };
};

const normalizeWriteMode = (
  value: unknown,
  fallback: DataRelayWriteMode,
): Result<DataRelayWriteMode> => {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: fallback };
  }
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'overwrite' || normalized === 'w' || normalized === 'truncate') {
    return { ok: true, value: 'overwrite' };
  }
  if (normalized === 'append' || normalized === 'a') {
    return { ok: true, value: 'append' };
  }
  return { ok: false, error: 'writeMode must be overwrite or append.' };
};

const normalizeAutoStart = (value: unknown, fallback: boolean): Result<boolean> => {
  if (value === undefined || value === null) return { ok: true, value: fallback };
  if (typeof value === 'boolean') return { ok: true, value };
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) return { ok: true, value: true };
  if (['false', '0', 'no'].includes(normalized)) return { ok: true, value: false };
  return { ok: false, error: 'autoStart must be true or false.' };
};

const normalizeScanCheckpoint = (
  value: unknown,
  fallback: DataRelayScanCheckpoint | undefined,
): DataRelayScanCheckpoint | undefined => {
  if (value === undefined) return fallback;
  if (value === null) return undefined;
  if (typeof value !== 'object') return fallback;
  const source = value as { at?: unknown; files?: unknown };
  const at = Number(source.at);
  if (!Number.isFinite(at) || !source.files || typeof source.files !== 'object') return fallback;
  const files: DataRelayScanCheckpoint['files'] = {};
  for (const [path, entry] of Object.entries(source.files as Record<string, unknown>)) {
    if (!path || !entry || typeof entry !== 'object') continue;
    const record = entry as { size?: unknown; lastModified?: unknown };
    const size = Number(record.size);
    const lastModified = Number(record.lastModified);
    if (!Number.isFinite(size) || !Number.isFinite(lastModified)) continue;
    files[path] = { size, lastModified };
  }
  return { at, files };
};

function buildRule(
  source: Record<string, unknown>,
  hosts: Host[],
  existing?: DataRelayRule,
  newRule?: NewRuleValues,
): Result<DataRelayRule> {
  const sourceHostId = source.sourceHostId === undefined
    ? existing?.sourceHostId
    : String(source.sourceHostId).trim();
  const validatedSource = validateDataRelayHost(hosts, sourceHostId, 'source');
  if ('error' in validatedSource) return { ok: false, error: validatedSource.error };

  const destHostId = source.destHostId === undefined
    ? existing?.destHostId
    : String(source.destHostId).trim();
  const validatedDest = validateDataRelayHost(hosts, destHostId, 'destination');
  if ('error' in validatedDest) return { ok: false, error: validatedDest.error };

  const writeMode = normalizeWriteMode(
    source.writeMode,
    existing?.writeMode ?? 'overwrite',
  );
  if ('error' in writeMode) return { ok: false, error: writeMode.error };

  const sourcePath = String(source.sourcePath ?? existing?.sourcePath ?? '').trim();
  let sourceCommand = String(
    source.sourceCommand ?? existing?.sourceCommand ?? '',
  ).trim();
  if (sourcePath) {
    sourceCommand = buildDataRelayFollowCommand(sourcePath, {
      os: resolveHostOs(validatedSource.value),
      writeMode: writeMode.value,
    });
  }
  if (!sourceCommand) {
    return { ok: false, error: 'sourcePath is required.' };
  }

  const destPath = String(source.destPath ?? existing?.destPath ?? '').trim();
  if (!destPath) {
    return { ok: false, error: 'destPath is required.' };
  }

  const autoStart = normalizeAutoStart(
    source.autoStart,
    existing?.autoStart ?? false,
  );
  if ('error' in autoStart) return { ok: false, error: autoStart.error };

  const scanIntervalMs = normalizeDataRelayScanIntervalMs(
    source.scanIntervalMs === undefined ? existing?.scanIntervalMs : source.scanIntervalMs,
  );
  const scanMode: DataRelayScanMode = normalizeDataRelayScanMode(
    source.scanMode === undefined ? existing?.scanMode : source.scanMode,
  );
  const scanCheckpoint = normalizeScanCheckpoint(
    source.scanCheckpoint,
    existing?.scanCheckpoint,
  );

  if (!existing && !newRule) {
    return { ok: false, error: 'New rule id and timestamp are required.' };
  }

  const fallbackLabel = `${validatedSource.value.label} -> ${validatedDest.value.label}`;
  const label = String(source.label ?? existing?.label ?? fallbackLabel).trim() || fallbackLabel;

  return {
    ok: true,
    value: {
      id: existing?.id ?? newRule!.id,
      label,
      sourceHostId: sourceHostId!,
      ...(sourcePath ? { sourcePath } : {}),
      sourceCommand,
      destHostId: destHostId!,
      destPath,
      writeMode: writeMode.value,
      scanIntervalMs,
      scanMode,
      ...(scanCheckpoint ? { scanCheckpoint } : {}),
      autoStart: autoStart.value,
      status: existing?.status ?? 'inactive',
      error: existing?.error,
      bytesTransferred: existing?.bytesTransferred,
      createdAt: existing?.createdAt ?? newRule!.now,
      lastUsedAt: existing?.lastUsedAt,
      order: existing?.order,
    },
  };
}

export function createDataRelayRule(
  rules: DataRelayRule[],
  hosts: Host[],
  source: Record<string, unknown>,
  newRule: NewRuleValues,
): Result<{ rules: DataRelayRule[]; rule: DataRelayRule }> {
  const built = buildRule(source, hosts, undefined, newRule);
  if ('error' in built) return { ok: false, error: built.error };
  const rule = { ...built.value, order: getNextVaultOrder(rules) };
  return { ok: true, value: { rules: [...rules, rule], rule } };
}

export function updateDataRelayRule(
  rules: DataRelayRule[],
  hosts: Host[],
  ruleId: string,
  source: Record<string, unknown>,
): Result<{ rules: DataRelayRule[]; rule: DataRelayRule }> {
  const existing = rules.find((rule) => rule.id === ruleId);
  if (!existing) return { ok: false, error: `Data relay rule "${ruleId}" was not found.` };
  const built = buildRule(source, hosts, existing);
  if ('error' in built) return { ok: false, error: built.error };
  const connectionChanged = hasDataRelayConnectionChanged(existing, built.value);
  const updatedRule = connectionChanged
    ? {
      ...built.value,
      status: 'inactive' as const,
      error: undefined,
      bytesTransferred: undefined,
      scanCheckpoint: undefined,
    }
    : built.value;
  return {
    ok: true,
    value: {
      rules: rules.map((rule) => (rule.id === ruleId ? updatedRule : rule)),
      rule: updatedRule,
    },
  };
}

export function duplicateDataRelayRule(
  rules: DataRelayRule[],
  hosts: Host[],
  ruleId: string,
  newRule: NewRuleValues,
): Result<{ rules: DataRelayRule[]; rule: DataRelayRule }> {
  const existing = rules.find((rule) => rule.id === ruleId);
  if (!existing) return { ok: false, error: `Data relay rule "${ruleId}" was not found.` };
  const validated = buildRule({}, hosts, existing);
  if ('error' in validated) return { ok: false, error: validated.error };
  const rule: DataRelayRule = {
    ...validated.value,
    id: newRule.id,
    label: `${existing.label} (Copy)`,
    status: 'inactive',
    error: undefined,
    bytesTransferred: undefined,
    lastUsedAt: undefined,
    createdAt: newRule.now,
    order: getNextVaultOrder(rules),
    scanCheckpoint: undefined,
  };
  return { ok: true, value: { rules: [...rules, rule], rule } };
}
