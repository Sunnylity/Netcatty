import assert from "node:assert/strict";
import test from "node:test";

import {
  DataRelayViewTabStore,
  fromDataRelayViewTabId,
  isDataRelayViewTabId,
  toDataRelayViewTabId,
} from "./dataRelayViewTabStore";

function fixture() {
  let activeTabId = "vault";
  const store = new DataRelayViewTabStore({
    getActiveTabId: () => activeTabId,
    setActiveTabId: (next) => { activeTabId = next; },
  });
  return { store, getActiveTabId: () => activeTabId };
}

test("data-relay view tab ids round-trip a rule id", () => {
  const tabId = toDataRelayViewTabId("rule-1");
  assert.equal(tabId, "data-relay:rule-1");
  assert.equal(isDataRelayViewTabId(tabId), true);
  assert.equal(fromDataRelayViewTabId(tabId), "rule-1");
  assert.equal(isDataRelayViewTabId("vault"), false);
});

test("opening a data-relay rule focuses an existing tab instead of duplicating", () => {
  const { store, getActiveTabId } = fixture();
  store.open({ id: "rule-1", label: "Logs" });
  store.open({ id: "rule-1", label: "Logs v2" });
  assert.equal(store.getTabs().length, 1);
  assert.equal(store.getTabs()[0]?.label, "Logs v2");
  assert.equal(getActiveTabId(), toDataRelayViewTabId("rule-1"));
});

test("syncRules drops deleted rules and updates labels", () => {
  const { store } = fixture();
  store.open({ id: "keep", label: "Keep" });
  store.open({ id: "gone", label: "Gone" });
  store.syncRules([{ id: "keep", label: "Keep renamed" }]);
  assert.deepEqual(
    store.getTabs().map((tab) => ({ ruleId: tab.ruleId, label: tab.label })),
    [{ ruleId: "keep", label: "Keep renamed" }],
  );
});
