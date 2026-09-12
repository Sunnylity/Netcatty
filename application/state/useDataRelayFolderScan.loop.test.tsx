import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import type { Host, RemoteFile } from "../../domain/models.ts";
import { sftpTransferCenterStore } from "./sftpTransferCenterStore.ts";
import { useDataRelayState, type UseDataRelayStateResult } from "./useDataRelayState.ts";

const hosts: Host[] = [
  { id: "src-host", label: "Source", hostname: "src.local", username: "root", tags: [], os: "linux" },
  { id: "dst-host", label: "Dest", hostname: "dst.local", username: "root", tags: [], os: "linux" },
];

type FakeFile = { size: number; mtime: number };
type FakeFs = Map<string, FakeFile>;

const sourceFs: FakeFs = new Map();
const destFs: FakeFs = new Map();

const fsForSftp = (sftpId: string): FakeFs => (sftpId === "sftp-src" ? sourceFs : destFs);

const toRemoteFiles = (fs: FakeFs, dir: string): RemoteFile[] => {
  const prefix = dir.replace(/\/+$/, "") + "/";
  const files: RemoteFile[] = [];
  for (const [path, file] of fs) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    if (!rest || rest.includes("/")) continue;
    files.push({
      name: rest,
      type: "file",
      size: file.size,
      lastModified: new Date(file.mtime).toISOString(),
    } as RemoteFile);
  }
  return files;
};

function installFakeBridge() {
  const transfers: Array<{ sourcePath: string; targetPath: string; lastModified: number }> = [];
  const bridge = {
    openSftp: async (credentials: { hostId: string }) =>
      credentials.hostId === "src-host" ? "sftp-src" : "sftp-dst",
    closeSftp: async () => ({ success: true }),
    listSftp: async (sftpId: string, dir: string) => toRemoteFiles(fsForSftp(sftpId), dir),
    getSftpHomeDir: async () => ({ homeDir: "/root" }),
    mkdirSftp: async () => ({ success: true }),
    stopDataRelayByRuleId: async () => ({ success: true }),
    getDataRelaySnapshot: async () => ({ records: [] }),
    subscribeDataRelayRuntime: async () => ({ success: true }),
    startStreamTransfer: async (options: {
      sourceSftpId: string;
      targetSftpId: string;
      sourcePath: string;
      targetPath: string;
      sourceLastModified: number;
    }) => {
      const source = fsForSftp(options.sourceSftpId).get(options.sourcePath);
      if (!source) return { error: "source missing" };
      fsForSftp(options.targetSftpId).set(options.targetPath, {
        size: source.size,
        mtime: options.sourceLastModified,
      });
      transfers.push({
        sourcePath: options.sourcePath,
        targetPath: options.targetPath,
        lastModified: options.sourceLastModified,
      });
      return { success: true };
    },
  };
  const globalScope = globalThis as typeof globalThis & { window?: unknown };
  globalScope.window = { netcatty: bridge, ...(globalScope.window as object | undefined) };
  const store = new Map<string, string>();
  (globalScope as typeof globalThis & { localStorage?: unknown }).localStorage = {
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
  return { transfers, store };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("folder scan passes copy new and changed files on every interval", async () => {
  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  const { transfers } = installFakeBridge();

  const baseTime = Date.now() - 60_000;
  sourceFs.set("/root/src/a.txt", { size: 10, mtime: baseTime });
  sourceFs.set("/root/src/b.txt", { size: 20, mtime: baseTime });

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
      const result = state!.createRule({
        sourceHostId: "src-host",
        sourcePath: "/root/src/",
        destHostId: "dst-host",
        destPath: "/root/dst/",
        scanIntervalMs: 5_000,
      });
      assert.equal(result.ok, true);
    });
    const ruleId = state!.rules[0].id;

    await act(async () => {
      const result = await state!.startRule(ruleId);
      assert.equal(result.success, true, `startRule failed: ${result.error}`);
    });

    // First pass runs immediately after the SFTP connects.
    await act(async () => {
      await sleep(500);
    });
    assert.equal(destFs.get("/root/dst/a.txt")?.size, 10, "first pass copies a.txt");
    assert.equal(destFs.get("/root/dst/b.txt")?.size, 20, "first pass copies b.txt");
    assert.equal(transfers.length, 2);
    assert.ok((state!.rules[0].bytesTransferred ?? 0) > 0, "bytes are reported");

    const relayTasks = () => sftpTransferCenterStore.getSnapshot().tasks.filter(
      (task) => task.id.startsWith("relay-scan-"),
    );
    assert.equal(relayTasks().length, 2, "each copy is registered in the transfer center");
    for (const task of relayTasks()) {
      assert.equal(task.status, "completed", `${task.id} settles as completed`);
      assert.equal(task.direction, "remote-to-remote");
      assert.equal(task.targetHostId, "dst-host");
    }

    // Change the source between passes: one brand-new file, one modified file.
    sourceFs.set("/root/src/c.txt", { size: 30, mtime: Date.now() });
    sourceFs.set("/root/src/a.txt", { size: 11, mtime: Date.now() });

    await act(async () => {
      await sleep(6_000);
    });

    assert.equal(destFs.get("/root/dst/c.txt")?.size, 30, "next pass copies the new file");
    assert.equal(destFs.get("/root/dst/a.txt")?.size, 11, "next pass refreshes the changed file");
    assert.equal(transfers.length, 4, "second pass starts two more transfers");
  } finally {
    await act(async () => {
      renderer?.unmount();
    });
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    (globalThis as typeof globalThis & { window?: unknown }).window = undefined;
    delete (globalThis as typeof globalThis & { localStorage?: unknown }).localStorage;
  }
});
