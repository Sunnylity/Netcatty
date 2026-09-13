import React, { useCallback, useState } from "react";
import { useI18n } from "../../application/i18n/I18nProvider";
import { useIsTabActive } from "../../application/state/activeTabStore";
import { useDataRelayRuntime } from "../../application/state/dataRelayRuntimeStore";
import type { DataRelayViewTab } from "../../application/state/dataRelayViewTabStore";
import { resolveDataRelayEndpoint } from "../../domain/dataRelayLocal";
import type { DataRelayRule, Host, Identity, KnownHost, SSHKey, TerminalSettings } from "../../domain/models";
import { toast } from "../ui/toast";
import { CompareView } from "./CompareView";
import { RuleFormPanel } from "./RuleFormPanel";

export interface DataRelayRuleTabViewProps {
  tab: DataRelayViewTab;
  hosts: Host[];
  keys: SSHKey[];
  identities: Identity[];
  knownHosts?: KnownHost[];
  terminalSettings?: Pick<
    TerminalSettings,
    "verifyHostKeys" | "keepaliveInterval" | "keepaliveCountMax"
  >;
  onOpenTerminalAtPath?: (host: Host, path: string) => void;
  /** Open a fresh local terminal tab and run one command in it. */
  onOpenLocalTerminalAndRun?: (command: string, cwd?: string) => void;
}

export function getDataRelayRuleTabShellStyle(isVisible: boolean): React.CSSProperties {
  return {
    zIndex: isVisible ? 20 : -1,
    ...(isVisible ? null : { pointerEvents: "none", visibility: "hidden" }),
  };
}

export const DataRelayRuleTabView: React.FC<DataRelayRuleTabViewProps> = ({
  tab,
  hosts,
  keys,
  identities = [],
  knownHosts,
  terminalSettings,
  onOpenTerminalAtPath,
  onOpenLocalTerminalAndRun,
}) => {
  const { t } = useI18n();
  const isVisible = useIsTabActive(tab.id);
  const relay = useDataRelayRuntime();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<DataRelayRule>>({});

  const rule = relay?.rules.find((item) => item.id === tab.ruleId);
  // The local endpoint resolves to a pseudo host so the compare session and
  // view treat it like any other host; connection code branches on the id.
  const sourceHost = rule
    ? resolveDataRelayEndpoint(rule.sourceHostId, hosts, t("dataRelay.localHost"))?.host
    : undefined;
  const destHost = rule
    ? resolveDataRelayEndpoint(rule.destHostId, hosts, t("dataRelay.localHost"))?.host
    : undefined;

  const persistScanSettings = useCallback((
    updates: Partial<DataRelayRule> & { scanCheckpoint?: DataRelayRule["scanCheckpoint"] | null },
  ) => {
    if (!relay || !rule) return;
    const result = relay.updateRule(rule.id, updates as Record<string, unknown>, { preserveRuntime: true });
    if (!result.ok && result.error) toast.error(result.error);
  }, [relay, rule]);

  const draftIsValid = Boolean(
    draft.sourceHostId
    && (draft.sourcePath?.trim() || draft.sourceCommand?.trim())
    && draft.destHostId
    && draft.destPath?.trim(),
  );

  if (!relay || !rule) return null;

  return (
    <div
      className="absolute inset-0 flex min-h-0 flex-col overflow-hidden bg-background"
      data-tab-id={tab.id}
      data-tab-type="data-relay"
      style={getDataRelayRuleTabShellStyle(isVisible)}
    >
      <CompareView
        rule={rule}
        hosts={hosts}
        keys={keys}
        identities={identities}
        knownHosts={knownHosts}
        terminalSettings={terminalSettings}
        sourceHost={sourceHost}
        destHost={destHost}
        onEdit={() => {
          setDraft({ ...rule });
          setEditing(true);
        }}
        onStart={() => {
          void relay.startRule(rule.id).then((result) => {
            if (!result.success && result.error) toast.error(result.error);
          });
        }}
        onStop={() => {
          void relay.stopRule(rule.id).then((result) => {
            if (!result.success && result.error) toast.error(result.error);
          });
        }}
        onScanSettingsChange={persistScanSettings}
        onOpenTerminalAtPath={onOpenTerminalAtPath}
        onOpenLocalTerminalAndRun={onOpenLocalTerminalAndRun}
        visible={isVisible}
      />
      {editing && (
        <RuleFormPanel
          mode="edit"
          draft={draft}
          hosts={hosts}
          keys={keys}
          identities={identities}
          knownHosts={knownHosts}
          terminalSettings={terminalSettings}
          onOpenTerminalAtPath={onOpenTerminalAtPath}
          onChange={(updates) => setDraft((current) => ({ ...current, ...updates }))}
          onSave={() => {
            const result = relay.updateRule(rule.id, draft as Record<string, unknown>);
            if (!result.ok) {
              toast.error(result.error);
              return;
            }
            toast.success(t("dataRelay.saved"));
            setEditing(false);
          }}
          onClose={() => setEditing(false)}
          onDuplicate={() => {
            const result = relay.duplicateRule(rule.id);
            if (!result.ok) toast.error(result.error);
            setEditing(false);
          }}
          onDelete={() => {
            relay.deleteRule(rule.id);
            setEditing(false);
          }}
          isValid={draftIsValid}
        />
      )}
    </div>
  );
};
