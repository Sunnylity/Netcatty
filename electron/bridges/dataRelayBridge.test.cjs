const assert = require("node:assert/strict");
const test = require("node:test");

const bridge = require("./dataRelayBridge.cjs");

function createSender(id = 1) {
  return {
    id,
    isDestroyed: () => false,
    send() {},
    once() {},
    removeListener() {},
  };
}

function createEvent(id = 1) {
  return { sender: createSender(id) };
}

test.beforeEach(() => {
  bridge._resetDataRelayRuntimeMetaForTests();
});

test("startDataRelay requires a relayId", async () => {
  const result = await bridge.startDataRelay(createEvent(), {});
  assert.equal(result.success, false);
  assert.match(result.error, /relayId/);
});

test("startDataRelay requires a source command", async () => {
  const result = await bridge.startDataRelay(createEvent(), {
    relayId: "relay-1",
    destPath: "/tmp/out.log",
  });
  assert.equal(result.success, false);
  assert.match(result.error, /sourceCommand/);
});

test("startDataRelay requires a destination path", async () => {
  const result = await bridge.startDataRelay(createEvent(), {
    relayId: "relay-2",
    sourceCommand: "tail -f app.log",
  });
  assert.equal(result.success, false);
  assert.match(result.error, /destPath/);
});

test("stopDataRelay reports an unknown relay", async () => {
  const result = await bridge.stopDataRelay(createEvent(), { relayId: "missing" });
  assert.equal(result.success, false);
  assert.match(result.error, /not found/);
});

test("snapshot starts empty and tracks the process epoch", () => {
  const snapshot = bridge.getDataRelaySnapshot();
  assert.equal(typeof snapshot.epoch, "string");
  assert.equal(snapshot.revision, 0);
  assert.deepEqual(snapshot.records, []);
});

test("subscribeDataRelayRuntime returns the current snapshot", () => {
  const snapshot = bridge.subscribeDataRelayRuntime(createEvent());
  assert.deepEqual(snapshot.records, []);
  assert.equal(typeof snapshot.epoch, "string");
});

test("getDataRelayStatus reports an unknown relay as inactive", async () => {
  const result = await bridge.getDataRelayStatus(createEvent(), { relayId: "missing" });
  assert.equal(result.status, "inactive");
});

test("stopAllDataRelays is a no-op when nothing is running", async () => {
  const result = await bridge.stopAllDataRelays();
  assert.deepEqual(result, { stopped: 0, failed: 0 });
});
