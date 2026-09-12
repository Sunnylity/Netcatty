import { LayoutGrid, List as ListIcon, Play, Plus, Square, Waypoints } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n } from '../application/i18n/I18nProvider';
import { usePublishDataRelayRuntime } from '../application/state/dataRelayRuntimeStore';
import { dataRelayViewTabStore } from '../application/state/dataRelayViewTabStore';
import {
  useDataRelayState,
  type UseDataRelayStateOptions,
} from '../application/state/useDataRelayState';
import { DataRelayRule, Host, Identity, KnownHost, SSHKey } from '../domain/models';
import { dataRelayLocalPseudoHost, isDataRelayLocalHostId } from '../domain/dataRelayLocal';
import { cn } from '../lib/utils';
import { RuleCard, RuleFormPanel } from './data-relay';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { toast } from './ui/toast';
import {
  VaultHeaderSearch,
  VaultPageHeader,
  vaultHeaderIconButtonClass,
  vaultHeaderSecondaryButtonClass,
  vaultSectionTitleClass,
} from './vault/VaultPageHeader';

export interface DataRelayNewProps {
  hosts: Host[];
  keys: SSHKey[];
  identities?: Identity[];
  knownHosts?: KnownHost[];
  terminalSettings?: UseDataRelayStateOptions['terminalSettings'];
  onOpenTerminalAtPath?: (host: Host, path: string) => void;
}

const DataRelayNew: React.FC<DataRelayNewProps> = ({
  hosts,
  keys,
  identities = [],
  knownHosts = [],
  terminalSettings,
  onOpenTerminalAtPath,
}) => {
  const { t } = useI18n();
  const relayState = useDataRelayState({ hosts, keys, identities, knownHosts, terminalSettings });
  const {
    rules,
    viewMode,
    setViewMode,
    createRule,
    updateRule,
    duplicateRule,
    deleteRule,
    startRule,
    stopRule,
    startAllRules,
    stopAllRules,
  } = relayState;
  usePublishDataRelayRuntime(relayState);

  const [search, setSearch] = useState('');
  const [panelMode, setPanelMode] = useState<'new' | 'edit' | null>(null);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<DataRelayRule>>({});

  useEffect(() => {
    dataRelayViewTabStore.syncRules(rules.map((rule) => ({ id: rule.id, label: rule.label })));
  }, [rules]);

  const hostsById = useMemo(() => {
    const map = new Map<string, Host>();
    for (const host of hosts) map.set(host.id, host);
    return map;
  }, [hosts]);
  const localHost = useMemo(
    () => dataRelayLocalPseudoHost(t('dataRelay.localHost')),
    [t],
  );
  const hostById = useCallback((hostId: string | undefined): Host | undefined => {
    if (isDataRelayLocalHostId(hostId)) return localHost;
    return hostId ? hostsById.get(hostId) : undefined;
  }, [hostsById, localHost]);

  const filteredRules = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return rules;
    return rules.filter((rule) => {
      const source = hostById(rule.sourceHostId);
      const dest = hostById(rule.destHostId);
      return [
        rule.label,
        rule.sourcePath,
        rule.sourceCommand,
        rule.destPath,
        source?.label,
        source?.hostname,
        dest?.label,
        dest?.hostname,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword));
    });
  }, [hostById, rules, search]);

  const openNewPanel = useCallback(() => {
    setDraft({ writeMode: 'overwrite', autoStart: false });
    setEditingRuleId(null);
    setPanelMode('new');
  }, []);

  const openEditPanel = useCallback((rule: DataRelayRule) => {
    setDraft({ ...rule });
    setEditingRuleId(rule.id);
    setPanelMode('edit');
  }, []);

  const closePanel = useCallback(() => {
    setPanelMode(null);
    setEditingRuleId(null);
    setDraft({});
  }, []);

  const draftIsValid = Boolean(
    draft.sourceHostId
    && (draft.sourcePath?.trim() || draft.sourceCommand?.trim())
    && draft.destHostId
    && draft.destPath?.trim(),
  );

  const handleSave = useCallback(() => {
    if (panelMode === 'new') {
      const result = createRule(draft as Record<string, unknown>);
      if (!result.ok) {
        toast.error(result.error || t('dataRelay.error.saveFailed'));
        return;
      }
      toast.success(t('dataRelay.saved'));
      closePanel();
      return;
    }
    if (panelMode === 'edit' && editingRuleId) {
      const result = updateRule(editingRuleId, draft as Record<string, unknown>);
      if (!result.ok) {
        toast.error(result.error || t('dataRelay.error.saveFailed'));
        return;
      }
      toast.success(t('dataRelay.saved'));
      closePanel();
    }
  }, [panelMode, draft, createRule, updateRule, editingRuleId, closePanel, t]);

  const handleStart = useCallback(
    async (ruleId: string) => {
      const result = await startRule(ruleId);
      if (!result.success && result.error) toast.error(result.error);
    },
    [startRule],
  );

  const handleStop = useCallback(
    async (ruleId: string) => {
      const result = await stopRule(ruleId);
      if (!result.success && result.error) toast.error(result.error);
    },
    [stopRule],
  );

  const persistScanSettings = useCallback((
    ruleId: string,
    updates: Partial<DataRelayRule> & { scanCheckpoint?: DataRelayRule["scanCheckpoint"] | null },
  ) => {
    const result = updateRule(ruleId, updates as Record<string, unknown>, { preserveRuntime: true });
    if (!result.ok && result.error) toast.error(result.error);
  }, [updateRule]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <VaultPageHeader dataSection="vault-data-relay">
        <span className={cn(vaultSectionTitleClass, 'hidden md:inline')}>
          {t('vault.nav.dataRelay')}
        </span>
        <VaultHeaderSearch
          className="min-w-[140px] flex-1 md:max-w-[280px]"
          placeholder={t('dataRelay.searchPlaceholder')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="flex-1" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              className={vaultHeaderSecondaryButtonClass}
              onClick={() => void startAllRules()}
            >
              <Play size={14} />
              <span className="hidden lg:inline">{t('dataRelay.startAll')}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('dataRelay.startAll')}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              className={vaultHeaderSecondaryButtonClass}
              onClick={() => void stopAllRules()}
            >
              <Square size={14} />
              <span className="hidden lg:inline">{t('dataRelay.stopAll')}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('dataRelay.stopAll')}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              className={vaultHeaderIconButtonClass}
              onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
            >
              {viewMode === 'grid' ? <ListIcon size={16} /> : <LayoutGrid size={16} />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {viewMode === 'grid' ? t('dataRelay.viewList') : t('dataRelay.viewGrid')}
          </TooltipContent>
        </Tooltip>
        <Button className="h-10 gap-2 px-3" onClick={openNewPanel}>
          <Plus size={16} />
          <span className="hidden sm:inline">{t('dataRelay.new')}</span>
        </Button>
      </VaultPageHeader>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {filteredRules.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
            <Waypoints size={32} className="opacity-40" />
            <div className="text-sm font-medium">{t('dataRelay.empty.title')}</div>
            <div className="max-w-md text-xs">{t('dataRelay.empty.description')}</div>
            <Button className="mt-1 gap-2" onClick={openNewPanel}>
              <Plus size={16} />
              {t('dataRelay.new')}
            </Button>
          </div>
        ) : (
          <div
            className={cn(
              viewMode === 'grid'
                ? 'grid gap-3 md:grid-cols-2 xl:grid-cols-3'
                : 'flex flex-col gap-2',
            )}
          >
            {filteredRules.map((rule) => (
              <RuleCard
                key={rule.id}
                rule={rule}
                sourceHost={hostById(rule.sourceHostId)}
                destHost={hostById(rule.destHostId)}
                onStart={() => void handleStart(rule.id)}
                onStop={() => void handleStop(rule.id)}
                onEdit={() => openEditPanel(rule)}
                onOpen={() => dataRelayViewTabStore.open(rule)}
                onScanSettingsChange={(updates) => persistScanSettings(rule.id, updates)}
              />
            ))}
          </div>
        )}
      </div>

      {panelMode && (
        <RuleFormPanel
          mode={panelMode}
          draft={draft}
          hosts={hosts}
          keys={keys}
          identities={identities}
          knownHosts={knownHosts}
          terminalSettings={terminalSettings}
          onOpenTerminalAtPath={onOpenTerminalAtPath}
          onChange={(updates) => setDraft((current) => ({ ...current, ...updates }))}
          onSave={handleSave}
          onClose={closePanel}
          onDuplicate={
            panelMode === 'edit' && editingRuleId
              ? () => {
                  const result = duplicateRule(editingRuleId);
                  if (!result.ok) {
                    toast.error(result.error || t('dataRelay.error.saveFailed'));
                    return;
                  }
                  closePanel();
                }
              : undefined
          }
          onDelete={
            panelMode === 'edit' && editingRuleId
              ? () => {
                  deleteRule(editingRuleId);
                  closePanel();
                }
              : undefined
          }
          isValid={draftIsValid}
        />
      )}
    </div>
  );
};

export default DataRelayNew;
