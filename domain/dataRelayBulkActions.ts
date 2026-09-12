import type { DataRelayRule, DataRelayStatus } from './models';

export type DataRelayRuntimeLike = {
  status?: DataRelayStatus | string;
};

export const isDataRelayRuntimeBusy = (
  connection?: DataRelayRuntimeLike | null,
): boolean =>
  connection?.status === 'active'
  || connection?.status === 'connecting'
  || connection?.status === 'error';

export const isDataRelayRuleStartable = (
  rule: Pick<DataRelayRule, 'status'>,
  runtimeBusy: boolean,
): boolean => !runtimeBusy && (rule.status === 'inactive' || rule.status === 'error');

export const isDataRelayRuleStoppable = (
  rule: Pick<DataRelayRule, 'status'>,
  runtimeBusy: boolean,
): boolean => runtimeBusy || rule.status === 'active' || rule.status === 'connecting';

export const selectStartableDataRelayRules = (
  rules: readonly DataRelayRule[],
  isRuntimeBusy: (ruleId: string) => boolean,
): DataRelayRule[] =>
  rules.filter((rule) => isDataRelayRuleStartable(rule, isRuntimeBusy(rule.id)));

export const selectStoppableDataRelayRules = (
  rules: readonly DataRelayRule[],
  isRuntimeBusy: (ruleId: string) => boolean,
): DataRelayRule[] =>
  rules.filter((rule) => isDataRelayRuleStoppable(rule, isRuntimeBusy(rule.id)));
