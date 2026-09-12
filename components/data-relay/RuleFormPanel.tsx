import { Copy, Trash2 } from 'lucide-react';
import React from 'react';
import { useI18n } from '../../application/i18n/I18nProvider';
import { DataRelayRule, Host } from '../../domain/models';
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
import { Textarea } from '../ui/textarea';

export interface RuleFormPanelProps {
  mode: 'new' | 'edit';
  draft: Partial<DataRelayRule>;
  hosts: Host[];
  onChange: (updates: Partial<DataRelayRule>) => void;
  onSave: () => void;
  onClose: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  isValid: boolean;
}

const isRelayCapableHost = (host: Host): boolean => !host.protocol || host.protocol === 'ssh';

const hostName = (host: Host): string => host.label || host.hostname;

/**
 * Shared create/edit form for a data relay rule: source host + command,
 * destination host + file, write mode and auto-start.
 */
export const RuleFormPanel: React.FC<RuleFormPanelProps> = ({
  mode,
  draft,
  hosts,
  onChange,
  onSave,
  onClose,
  onDuplicate,
  onDelete,
  isValid,
}) => {
  const { t } = useI18n();
  const sshHosts = hosts.filter(isRelayCapableHost);

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
            {t('dataRelay.form.sourceCommand')}
          </Label>
          <Textarea
            className="min-h-[72px] font-mono text-xs"
            placeholder={t('dataRelay.form.sourceCommandPlaceholder')}
            value={draft.sourceCommand || ''}
            onChange={(event) => onChange({ sourceCommand: event.target.value })}
          />
          <p className="text-[10px] text-muted-foreground">
            {t('dataRelay.form.sourceCommandHint')}
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
          <Input
            className="h-10 font-mono text-xs"
            placeholder={t('dataRelay.form.destPathPlaceholder')}
            value={draft.destPath || ''}
            onChange={(event) => onChange({ destPath: event.target.value })}
          />
        </div>

        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">
            {t('dataRelay.form.writeMode')}
          </Label>
          <Select
            value={draft.writeMode || 'overwrite'}
            onValueChange={(value) => onChange({ writeMode: value as DataRelayRule['writeMode'] })}
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
    </AsidePanel>
  );
};

export default RuleFormPanel;
