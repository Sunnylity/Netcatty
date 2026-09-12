import assert from 'node:assert/strict';
import test from 'node:test';
import {
  migrateDataRelayRulesFromStorage,
  toPersistedDataRelayRule,
  toPersistedDataRelayRules,
} from './dataRelayPersistence';
import type { DataRelayRule } from './models';

const makeRule = (overrides: Partial<DataRelayRule> = {}): DataRelayRule => ({
  id: 'rule-1',
  label: 'Relay',
  sourceHostId: 'win',
  sourceCommand: 'tail -f app.log',
  destHostId: 'linux',
  destPath: '/tmp/out.log',
  writeMode: 'overwrite',
  status: 'inactive',
  createdAt: 1,
  ...overrides,
});

test('toPersistedDataRelayRule strips runtime fields', () => {
  const persisted = toPersistedDataRelayRule(
    makeRule({ status: 'active', error: 'boom', bytesTransferred: 4096 }),
  );

  assert.equal(persisted.status, 'inactive');
  assert.equal(persisted.error, undefined);
  assert.equal(persisted.bytesTransferred, undefined);
  assert.equal(persisted.sourceCommand, 'tail -f app.log');
  assert.equal(persisted.destPath, '/tmp/out.log');
});

test('toPersistedDataRelayRules maps every rule', () => {
  const persisted = toPersistedDataRelayRules([
    makeRule({ id: 'a', status: 'active' }),
    makeRule({ id: 'b', status: 'error', error: 'x' }),
  ]);

  assert.equal(persisted.length, 2);
  assert.deepEqual(persisted.map((rule) => rule.status), ['inactive', 'inactive']);
  assert.deepEqual(persisted.map((rule) => rule.error), [undefined, undefined]);
});

test('migrateDataRelayRulesFromStorage restores live phases to inactive', () => {
  const migrated = migrateDataRelayRulesFromStorage([
    makeRule({ id: 'active', status: 'active', bytesTransferred: 100 }),
    makeRule({ id: 'connecting', status: 'connecting' }),
    makeRule({ id: 'error', status: 'error', error: 'failed' }),
    makeRule({ id: 'inactive', status: 'inactive' }),
  ]);

  assert.equal(migrated[0].status, 'inactive');
  assert.equal(migrated[0].bytesTransferred, undefined);
  assert.equal(migrated[1].status, 'inactive');
  // Historical error stays available as a disposable diagnostic.
  assert.equal(migrated[2].status, 'error');
  assert.equal(migrated[2].error, 'failed');
  assert.equal(migrated[3].status, 'inactive');
});
