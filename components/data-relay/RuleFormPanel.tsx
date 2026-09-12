import { Copy, FolderOpen, Trash2 } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { useI18n } from '../../application/i18n/I18nProvider';
import { resolveHostOs } from '../../domain/host';
import { DATA_RELAY_LOCAL_HOST_ID, isDataRelayLocalHostId } from '../../domain/dataRelayLocal';
import {
  buildDataRelayFollowCommand,
} from '../../domain/dataRelayPaths';
import {
  DataRelayRule,
  Host,
} from '../../domain/models';
import {
  AsideActionMenu,
  AsideActionMenuItem,
  AsidePanel,
  AsidePanelContent,
  AsidePanelFooter,
} from '../ui/aside-panel';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Switch } from '../ui/switch';
import {
  RemotePathBrowserDialog,
  type RemotePathBrowserHostContext,
} from './RemotePathBrowserDialog';

export interface RuleFormPanelProps extends RemotePathBrowserHostContext {
  mode: 'new' | 'edit';
  draft: Partial<DataRelayRule>;
  onChange: (updates: Partial<DataRelayRule>) => void;
  onSave: () => void;
  onClose: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  isValid: boolean;
  onOpenTerminalAtPath?: (host: Host, path: string) => void;
}

const isRelayCapableHost = (host: Host): boolean => !host.protocol || host.protocol === 'ssh';

const hostName = (host: Host): string => host.label || host.hostname;

/**
 * Shared create/edit form for a data relay rule: source host + path,
 * destination host + path, write mode and auto-start.
 */
export const RuleFormPanel: React.FC<RuleFormPanelProps> = ({
  mode,
  draft,
  hosts,
  keys,
  identities,
  knownHosts,
  terminalSettings,
  onChange,
  onSave,
  onClose,
  onDuplicate,
  onDelete,
  isValid,
  onOpenTerminalAtPath,
}) => {
  const { t } = useI18n();
  const sshHosts = hosts.filter(isRelayCapableHost);
  const [browser, setBrowser] = useState<'source' | 'dest' | null>(null);
  const sourceIsLocal = isDataRelayLocalHostId(draft.sourceHostId);
  const destIsLocal = isDataRelayLocalHostId(draft.destHostId);

  const sourceHost = useMemo(
    () => sshHosts.find((host) => host.id === draft.sourceHostId),
    [draft.sourceHostId, sshHosts],
  );
  const destHost = useMemo(
    () => sshHosts.find((host) => host.id === draft.destHostId),
    [draft.destHostId, sshHosts],
  );

  const applySourcePath = (sourcePath: string) => {
    const trimmed = sourcePath.trim();
    const updates: Partial<DataRelayRule> = { sourcePath };
    if (trimmed) {
      updates.sourceCommand = buildDataRelayFollowCommand(trimmed, {
        os: resolveHostOs(sourceHost),
        writeMode: draft.writeMode,
      });
    }
    onChange(updates);
  };

  return (
    <AsidePanel
      open={true}
      onClose={onClose}
      title={mode === 'new' ? t('dataRelay.form.newTitle') : t('dataRelay.form.editTitle')}
      width="w-[400px]"
      actions={
        mode === 'edit' && (onDuplicate || onDelete) ? (
          <AsideActionMenu>
            {onDuplicate && (
              <AsideActionMenuItem icon={<Copy size={14} />} onClick={onDuplicate}>
                {t('action.duplicate')}
              </AsideActionMenuItem>
            )}
            {onDelete && (
              <AsideActionMenuItem
                icon={<Trash2 size={14} />}
                variant="destructive"
                onClick={onDelete}
              >
                {t('action.delete')}
              </AsideActionMenuItem>
            )}
          </AsideActionMenu>
        ) : undefined
      }
    >
      <AsidePanelContent>
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">{t('field.label')}</Label>
          <Input
            className="h-10"
            placeholder={t('dataRelay.form.labelPlaceholder')}
            value={draft.label || ''}
            onChange={(event) => onChange({ label: event.target.value })}
          />
        </div>

        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">
            {t('dataRelay.form.sourceHost')}
          </Label>
          <Select
            value={draft.sourceHostId || ''}
            onValueChange={(value) => onChange({ sourceHostId: value })}
          >
            <SelectTrigger>
              <SelectValue placeholder={t('dataRelay.form.selectHost')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DATA_RELAY_LOCAL_HOST_ID}>
                {t('dataRelay.localHost')}
              </SelectItem>
              {sshHosts.map((host) => (
                <SelectItem key={host.id} value={host.id}>
                  {hostName(host)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">
            {t('dataRelay.form.sourcePath')}
          </Label>
          <div className="flex gap-2">
            <Input
              className="h-10 font-mono text-xs"
              placeholder={t('dataRelay.form.sourcePathPlaceholder')}
              value={draft.sourcePath || ''}
              onChange={(event) => applySourcePath(event.target.value)}
            />
            {sourceIsLocal ? null : (
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-10 w-10 shrink-0"
                disabled={!sourceHost}
                title={t('dataRelay.form.browse')}
                onClick={() => setBrowser('source')}
              >
                <FolderOpen size={16} />
              </Button>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground">
            {t('dataRelay.form.sourcePathHint')}
          </p>
        </div>

        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">
            {t('dataRelay.form.destHost')}
          </Label>
          <Select
            value={draft.destHostId || ''}
            onValueChange={(value) => onChange({ destHostId: value })}
          >
            <SelectTrigger>
              <SelectValue placeholder={t('dataRelay.form.selectHost')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DATA_RELAY_LOCAL_HOST_ID} disabled={sourceIsLocal}>
                {t('dataRelay.localHost')}
              </SelectItem>
              {sshHosts.map((host) => (
                <SelectItem key={host.id} value={host.id}>
                  {hostName(host)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">
            {t('dataRelay.form.destPath')}
          </Label>
          <div className="flex gap-2">
            <Input
              className="h-10 font-mono text-xs"
              placeholder={t('dataRelay.form.destPathPlaceholder')}
              value={draft.destPath || ''}
              onChange={(event) => onChange({ destPath: event.target.value })}
            />
            {destIsLocal ? null : (
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-10 w-10 shrink-0"
                disabled={!destHost}
                title={t('dataRelay.form.browse')}
                onClick={() => setBrowser('dest')}
              >
                <FolderOpen size={16} />
              </Button>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground">
            {t('dataRelay.form.destPathHint')}
          </p>
        </div>

        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">
            {t('dataRelay.form.writeMode')}
          </Label>
          <Select
            value={draft.writeMode || 'overwrite'}
            onValueChange={(value) => {
              const writeMode = value as DataRelayRule['writeMode'];
              const updates: Partial<DataRelayRule> = { writeMode };
              if (draft.sourcePath?.trim()) {
                updates.sourceCommand = buildDataRelayFollowCommand(draft.sourcePath.trim(), {
                  os: resolveHostOs(sourceHost),
                  writeMode,
                });
              }
              onChange(updates);
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="overwrite">{t('dataRelay.writeMode.overwrite')}</SelectItem>
              <SelectItem value="append">{t('dataRelay.writeMode.append')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
          <div className="min-w-0">
            <div className="text-xs font-medium">{t('dataRelay.form.autoStart')}</div>
            <div className="text-[10px] text-muted-foreground">
              {t('dataRelay.form.autoStartHint')}
            </div>
          </div>
          <Switch
            checked={draft.autoStart ?? false}
            onCheckedChange={(checked) => onChange({ autoStart: checked })}
          />
        </div>
      </AsidePanelContent>

      <AsidePanelFooter>
        <div className="flex w-full gap-2">
          <Button variant="ghost" className="flex-1" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button className="flex-1" disabled={!isValid} onClick={onSave}>
            {t('action.save')}
          </Button>
        </div>
      </AsidePanelFooter>

      <RemotePathBrowserDialog
        open={browser === 'source'}
        host={sourceHost}
        hosts={hosts}
        keys={keys}
        identities={identities}
        knownHosts={knownHosts}
        terminalSettings={terminalSettings}
        initialPath={draft.sourcePath}
        title={t('dataRelay.browser.sourceTitle')}
        onSelect={applySourcePath}
        onOpenChange={(open) => {
          if (!open) setBrowser(null);
        }}
        onOpenTerminalAtPath={onOpenTerminalAtPath}
      />
      <RemotePathBrowserDialog
        open={browser === 'dest'}
        host={destHost}
        hosts={hosts}
        keys={keys}
        identities={identities}
        knownHosts={knownHosts}
        terminalSettings={terminalSettings}
        initialPath={draft.destPath}
        title={t('dataRelay.browser.destTitle')}
        onSelect={(destPath) => onChange({ destPath })}
        onOpenChange={(open) => {
          if (!open) setBrowser(null);
        }}
        onOpenTerminalAtPath={onOpenTerminalAtPath}
      />
    </AsidePanel>
  );
};

export default RuleFormPanel;
