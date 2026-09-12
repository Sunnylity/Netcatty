import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import type { Host } from "../../domain/models.ts";
import { STORAGE_KEY_DATA_RELAY } from "../../infrastructure/config/storageKeys.ts";
import { useDataRelayState, type UseDataRelayStateResult } from "./useDataRelayState.ts";

const hosts: Host[] = [
  { id: "win", label: "Windows", hostname: "win.local", username: "root", tags: [], os: "linux" },
  { id: "linux", label: "Linux", hostname: "linux.local", username: "root", tags: [], os: "linux" },
];

function installLocalStorage(): Map<string, string> {
  const store = new Map<string, string>();
  const target = globalThis as typeof globalThis & { localStorage?: unknown };
  target.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
  return store;
}

test("useDataRelayState creates, updates and deletes rules with persistence", async () => {
  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  const store = installLocalStorage();

  let state: UseDataRelayStateResult | undefined;
  let renderer: ReactTestRenderer | null = null;

  const Probe = () => {
    state = useDataRelayState({ hosts, keys: [], identities: [] });
    return null;
  };

  try {
    await act(async () => {
      renderer = create(React.createElement(Probe));
    });
    assert.equal(state?.rules.length, 0);

    await act(async () => {
      const result = state!.createRule({
        sourceHostId: "win",
        sourcePath: "/var/log/",
        destHostId: "linux",
        destPath: "/tmp/",
      });
      assert.equal(result.ok, true);
    });

    assert.equal(state?.rules.length, 1);
    const ruleId = state!.rules[0].id;
    assert.equal(state!.rules[0].status, "inactive");

    const persisted = JSON.parse(store.get(STORAGE_KEY_DATA_RELAY) ?? "[]") as Array<{
      status: string;
      sourcePath?: string;
      sourceCommand: string;
    }>;
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0].status, "inactive");
    assert.equal(persisted[0].sourcePath, "/var/log/");
    assert.equal(persisted[0].sourceCommand, "tail -n +1 -F -- '/var/log'/*");

    await act(async () => {
      const result = state!.updateRule(ruleId, { label: "Renamed" });
      assert.equal(result.ok, true);
    });
    assert.equal(state!.rules[0].label, "Renamed");

    await act(async () => {
      state!.deleteRule(ruleId);
    });
    assert.equal(state!.rules.length, 0);
    assert.deepEqual(JSON.parse(store.get(STORAGE_KEY_DATA_RELAY) ?? "[]"), []);
  } finally {
    await act(async () => {
      renderer?.unmount();
    });
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  }
});

test("useDataRelayState rejects invalid rules and fixes invalid write modes", async () => {
  const previousActEnvironment = (globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }).IS_REACT_ACT_ENVIRONMENT;
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  installLocalStorage();

  let state: UseDataRelayStateResult | undefined;
  let renderer: ReactTestRenderer | null = null;
  const Probe = () => {
    state = useDataRelayState({ hosts, keys: [], identities: [] });
    return null;
  };

  try {
    await act(async () => {
      renderer = create(React.createElement(Probe));
    });

    await act(async () => {
      const missingHost = state!.createRule({
        sourceCommand: "cat log",
        destHostId: "linux",
        destPath: "/tmp/out.log",
      });
      assert.equal(missingHost.ok, false);
      assert.equal(state!.rules.length, 0);
    });

    await act(async () => {
      const invalidMode = state!.createRule({
        sourceHostId: "win",
        sourceCommand: "cat log",
        destHostId: "linux",
        destPath: "/tmp/out.log",
        writeMode: "sideways",
      });
      assert.equal(invalidMode.ok, false);
      assert.equal(state!.rules.length, 0);
    });

    await act(async () => {
      const valid = state!.createRule({
        sourceHostId: "win",
        sourceCommand: "cat log",
        destHostId: "linux",
        destPath: "/tmp/out.log",
        writeMode: "append",
      });
      assert.equal(valid.ok, true);
    });
    assert.equal(state!.rules[0].writeMode, "append");
  } finally {
    await act(async () => {
      renderer?.unmount();
    });
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      previousActEnvironment;
  }
});
