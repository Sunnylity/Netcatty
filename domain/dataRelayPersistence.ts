import type { DataRelayRule } from './models/dataRelay';

/**
 * Fields that describe a rule's configuration / user metadata.
 * Runtime phase (`status`, `error`, `bytesTransferred`) is owned by the
 * main-process registry and must not be treated as durable storage.
 */
export type PersistedDataRelayRule = Omit<
  DataRelayRule,
  'status' | 'error' | 'bytesTransferred'
> & {
  status: 'inactive';
  error?: undefined;
  bytesTransferred?: undefined;
};

/** Strip live runtime fields before writing localStorage / sync payloads. */
export function toPersistedDataRelayRule(
  rule: DataRelayRule,
): PersistedDataRelayRule {
  return {
    ...rule,
    status: 'inactive',
    error: undefined,
    bytesTransferred: undefined,
  };
}

export function toPersistedDataRelayRules(
  rules: readonly DataRelayRule[],
): PersistedDataRelayRule[] {
  return rules.map(toPersistedDataRelayRule);
}

/**
 * Migrate legacy stored rules that still carry active/connecting phases.
 * Historical `error` is kept as a disposable diagnostic until a successful
 * backend snapshot proves the rule inactive (or a live relay overlays it).
 */
export function migrateDataRelayRulesFromStorage(
  rules: readonly DataRelayRule[],
): DataRelayRule[] {
  return rules.map((rule) => {
    if (rule.status === 'active' || rule.status === 'connecting') {
      return {
        ...rule,
        status: 'inactive' as const,
        error: undefined,
        bytesTransferred: undefined,
      };
    }
    return rule;
  });
}
