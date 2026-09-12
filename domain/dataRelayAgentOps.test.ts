import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDataRelayRule,
  duplicateDataRelayRule,
  hasDataRelayConnectionChanged,
  updateDataRelayRule,
  validateDataRelayHost,
} from './dataRelayAgentOps';
import type { DataRelayRule, Host } from './models';

const host = (id: string, overrides: Partial<Host> = {}): Host => ({
  id,
  label: id,
  hostname: `${id}.local`,
  username: 'root',
  tags: [],
  os: 'linux',
  ...overrides,
});

const hosts = [host('win', { label: 'Windows' }), host('linux', { label: 'Linux' })];

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

test('createDataRelayRule builds a rule with defaults and vault order', () => {
  const result = createDataRelayRule([], hosts, {
    sourceHostId: 'win',
    sourceCommand: '  tail -f app.log  ',
    destHostId: 'linux',
    destPath: '  /tmp/out.log  ',
  }, { id: 'new-1', now: 100 });

  assert.equal('error' in result, false);
  if ('error' in result) return;
  assert.equal(result.value.rule.id, 'new-1');
  assert.equal(result.value.rule.sourceCommand, 'tail -f app.log');
  assert.equal(result.value.rule.destPath, '/tmp/out.log');
  assert.equal(result.value.rule.writeMode, 'overwrite');
  assert.equal(result.value.rule.autoStart, false);
  assert.equal(result.value.rule.status, 'inactive');
  assert.equal(result.value.rules.length, 1);
});

test('createDataRelayRule rejects missing command, path and unknown hosts', () => {
  const missingCommand = createDataRelayRule([], hosts, {
    sourceHostId: 'win',
    destHostId: 'linux',
    destPath: '/tmp/out.log',
  }, { id: 'x', now: 1 });
  assert.equal('error' in missingCommand, true);

  const missingPath = createDataRelayRule([], hosts, {
    sourceHostId: 'win',
    sourceCommand: 'cat log',
    destHostId: 'linux',
  }, { id: 'x', now: 1 });
  assert.equal('error' in missingPath, true);

  const unknown = createDataRelayRule([], hosts, {
    sourceHostId: 'nope',
    sourceCommand: 'cat log',
    destHostId: 'linux',
    destPath: '/tmp/out.log',
  }, { id: 'x', now: 1 });
  assert.equal('error' in unknown, true);
});

test('validateDataRelayHost only accepts ssh-capable hosts', () => {
  const ok = validateDataRelayHost(hosts, 'win', 'source');
  assert.equal('error' in ok, false);

  const telnet = validateDataRelayHost([host('t', { protocol: 'telnet' })], 't', 'source');
  assert.equal('error' in telnet, true);

  const missing = validateDataRelayHost(hosts, 'missing', 'destination');
  assert.equal('error' in missing, true);
});

test('updateDataRelayRule resets runtime state when the connection changed', () => {
  const existing = makeRule({ status: 'active', bytesTransferred: 2048, error: 'stale' });
  const result = updateDataRelayRule([existing], hosts, 'rule-1', {
    destPath: '/tmp/other.log',
  });

  assert.equal('error' in result, false);
  if ('error' in result) return;
  assert.equal(result.value.rule.destPath, '/tmp/other.log');
  assert.equal(result.value.rule.status, 'inactive');
  assert.equal(result.value.rule.error, undefined);
  assert.equal(result.value.rule.bytesTransferred, undefined);
});

test('updateDataRelayRule keeps runtime state when only the label changed', () => {
  const existing = makeRule({ status: 'active', bytesTransferred: 2048 });
  const result = updateDataRelayRule([existing], hosts, 'rule-1', { label: 'Renamed' });

  assert.equal('error' in result, false);
  if ('error' in result) return;
  assert.equal(result.value.rule.label, 'Renamed');
  assert.equal(result.value.rule.status, 'active');
  assert.equal(result.value.rule.bytesTransferred, 2048);
});

test('hasDataRelayConnectionChanged tracks all relay-defining fields', () => {
  const base = makeRule();
  assert.equal(hasDataRelayConnectionChanged(base, makeRule({ label: 'x' })), false);
  assert.equal(hasDataRelayConnectionChanged(base, makeRule({ sourceHostId: 'linux' })), true);
  assert.equal(hasDataRelayConnectionChanged(base, makeRule({ sourceCommand: 'cat x' })), true);
  assert.equal(hasDataRelayConnectionChanged(base, makeRule({ destHostId: 'win' })), true);
  assert.equal(hasDataRelayConnectionChanged(base, makeRule({ destPath: '/other' })), true);
  assert.equal(hasDataRelayConnectionChanged(base, makeRule({ writeMode: 'append' })), true);
});

test('duplicateDataRelayRule copies configuration without runtime state', () => {
  const existing = makeRule({ status: 'active', bytesTransferred: 10, error: 'boom' });
  const result = duplicateDataRelayRule([existing], hosts, 'rule-1', { id: 'copy-1', now: 50 });

  assert.equal('error' in result, false);
  if ('error' in result) return;
  assert.equal(result.value.rule.id, 'copy-1');
  assert.equal(result.value.rule.label, 'Relay (Copy)');
  assert.equal(result.value.rule.status, 'inactive');
  assert.equal(result.value.rule.bytesTransferred, undefined);
  assert.equal(result.value.rule.error, undefined);
  assert.equal(result.value.rules.length, 2);
});
