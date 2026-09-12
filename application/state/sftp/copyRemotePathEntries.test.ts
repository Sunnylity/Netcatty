import assert from "node:assert/strict";
import test from "node:test";
import type { DataRelayCompareFile } from "../../../domain/dataRelayCompare";
import {
  copyRemotePathEntries,
  resolveOpenTerminalPath,
  shouldSkipRemotePaste,
} from "./copyRemotePathEntries";

test("shouldSkipRemotePaste skips same-folder paste on the same host", () => {
  assert.equal(shouldSkipRemotePaste({
    sourceHostId: "a",
    destHostId: "a",
    sourcePath: "/var/log",
    destPath: "/var/log",
    entryName: "app.log",
  }), true);
  assert.equal(shouldSkipRemotePaste({
    sourceHostId: "a",
    destHostId: "b",
    sourcePath: "/var/log",
    destPath: "/var/log",
    entryName: "app.log",
  }), false);
  assert.equal(shouldSkipRemotePaste({
    sourceHostId: "a",
    destHostId: "a",
    sourcePath: "/var/log",
    destPath: "/tmp",
    entryName: "app.log",
  }), false);
});

test("shouldSkipRemotePaste skips pasting a folder into itself", () => {
  assert.equal(shouldSkipRemotePaste({
    sourceHostId: "a",
    destHostId: "a",
    sourcePath: "/var",
    destPath: "/var/log/archive",
    entryName: "log",
  }), true);
});

test("resolveOpenTerminalPath uses a directory entry and otherwise the current folder", () => {
  assert.equal(resolveOpenTerminalPath("/var/log", { name: "nginx", isDirectory: true }), "/var/log/nginx");
  assert.equal(resolveOpenTerminalPath("/var/log", { name: "app.log", isDirectory: false }), "/var/log");
  assert.equal(resolveOpenTerminalPath("/var/log", null), "/var/log");
});

test("copyRemotePathEntries copies files and nested folders", async () => {
  const listings: Record<string, DataRelayCompareFile[]> = {
    "/src/logs": [
      { name: "nested.txt", type: "file", size: 4, lastModified: 1 },
      { name: "keep", type: "directory", size: 0, lastModified: 1 },
    ],
    "/src/logs/keep": [
      { name: "inner.txt", type: "file", size: 2, lastModified: 1 },
    ],
  };
  const mkdirs: string[] = [];
  const transfers: Array<{ sourcePath: string; targetPath: string }> = [];

  const result = await copyRemotePathEntries({
    sourceSftpId: "src",
    destSftpId: "dst",
    sourceHostId: "left",
    destHostId: "right",
    sourcePath: "/src",
    destPath: "/dst",
    entries: [
      { name: "app.log", isDirectory: false, size: 10 },
      { name: "logs", isDirectory: true, size: 0 },
    ],
    list: async (_sftpId, path) => listings[path] ?? [],
    mkdir: async (_sftpId, path) => {
      mkdirs.push(path);
    },
    transfer: async (options) => {
      transfers.push({ sourcePath: options.sourcePath, targetPath: options.targetPath });
    },
  });

  assert.deepEqual(mkdirs, ["/dst/logs", "/dst/logs/keep"]);
  assert.deepEqual(transfers, [
    { sourcePath: "/src/app.log", targetPath: "/dst/app.log" },
    { sourcePath: "/src/logs/nested.txt", targetPath: "/dst/logs/nested.txt" },
    { sourcePath: "/src/logs/keep/inner.txt", targetPath: "/dst/logs/keep/inner.txt" },
  ]);
  assert.deepEqual(result.failed, []);
  assert.deepEqual(result.skipped, []);
  assert.ok(result.copied.includes("app.log"));
  assert.ok(result.copied.includes("logs"));
});

test("copyRemotePathEntries skips same-path paste without transferring", async () => {
  const result = await copyRemotePathEntries({
    sourceSftpId: "src",
    destSftpId: "src",
    sourceHostId: "host",
    destHostId: "host",
    sourcePath: "/var/log",
    destPath: "/var/log",
    entries: [{ name: "app.log", isDirectory: false, size: 1 }],
    list: async () => {
      throw new Error("list should not run");
    },
    mkdir: async () => {
      throw new Error("mkdir should not run");
    },
    transfer: async () => {
      throw new Error("transfer should not run");
    },
  });
  assert.deepEqual(result, { copied: [], failed: [], skipped: ["app.log"] });
});
