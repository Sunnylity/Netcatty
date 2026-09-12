import assert from "node:assert/strict";
import test from "node:test";
import type { DataRelayCompareEntry, DataRelayCompareRow } from "./dataRelayCompare";
import {
  dataRelayScanIntervalFromParts,
  dataRelayScanIntervalParts,
  isDataRelayFolderScanRule,
  listDataRelayScanCopyItemsFromCheckpoint,
  listDataRelayScanCopyItemsFromMtime,
  mergeDataRelayScanCheckpoint,
  normalizeDataRelayScanIntervalMs,
  normalizeDataRelayScanMode,
} from "./dataRelayScan";

const entry = (
  relativePath: string,
  overrides: Partial<DataRelayCompareEntry> = {},
): DataRelayCompareEntry => {
  const name = relativePath.split("/").pop() || relativePath;
  return {
    name,
    relativePath,
    type: "file",
    size: 10,
    lastModified: 1_000,
    ...overrides,
  };
};

test("normalizeDataRelayScanIntervalMs clamps and defaults", () => {
  assert.equal(normalizeDataRelayScanIntervalMs(undefined), 30_000);
  assert.equal(normalizeDataRelayScanIntervalMs("not-a-number"), 30_000);
  assert.equal(normalizeDataRelayScanIntervalMs(1_000), 5_000);
  assert.equal(normalizeDataRelayScanIntervalMs(90_000), 90_000);
});

test("normalizeDataRelayScanMode accepts checkpoint aliases", () => {
  assert.equal(normalizeDataRelayScanMode("mtime"), "mtime");
  assert.equal(normalizeDataRelayScanMode("checkpoint"), "checkpoint");
  assert.equal(normalizeDataRelayScanMode("watermark"), "checkpoint");
  assert.equal(normalizeDataRelayScanMode(""), "mtime");
});

test("dataRelayScanIntervalParts round-trips minutes and seconds", () => {
  assert.deepEqual(dataRelayScanIntervalParts(120_000), { value: 2, unit: "minutes" });
  assert.deepEqual(dataRelayScanIntervalParts(15_000), { value: 15, unit: "seconds" });
  assert.equal(dataRelayScanIntervalFromParts(2, "minutes"), 120_000);
  assert.equal(dataRelayScanIntervalFromParts(1, "seconds"), 5_000);
});

test("isDataRelayFolderScanRule requires a source folder", () => {
  assert.equal(isDataRelayFolderScanRule({ sourcePath: "/var/log/" }), true);
  assert.equal(isDataRelayFolderScanRule({ sourcePath: "  " }), false);
  assert.equal(isDataRelayFolderScanRule({}), false);
});

test("mtime scan copies source-only and newer source files", () => {
  const diffs: DataRelayCompareRow[] = [
    { relativePath: "new.log", name: "new.log", kind: "left-only", left: entry("new.log") },
    {
      relativePath: "stale.log",
      name: "stale.log",
      kind: "newer-left",
      left: entry("stale.log", { lastModified: 9_000 }),
      right: entry("stale.log", { lastModified: 1_000 }),
    },
    {
      relativePath: "same.log",
      name: "same.log",
      kind: "same",
      left: entry("same.log"),
      right: entry("same.log"),
    },
  ];
  const items = listDataRelayScanCopyItemsFromMtime(diffs);
  assert.deepEqual(items.map((item) => item.relativePath), ["new.log", "stale.log"]);
});

test("checkpoint scan copies files missing from or newer than the last upload set", () => {
  const items = listDataRelayScanCopyItemsFromCheckpoint(
    [
      entry("keep.log", { size: 10, lastModified: 1_000 }),
      entry("changed.log", { size: 40, lastModified: 8_000 }),
      entry("added.log", { size: 3, lastModified: 4_000 }),
      { ...entry("logs"), type: "directory", size: 0, lastModified: 1 },
      entry("logs/nested.log", { size: 2, lastModified: 5_000 }),
    ],
    {
      at: 1,
      files: {
        "keep.log": { size: 10, lastModified: 1_000 },
        "changed.log": { size: 10, lastModified: 1_000 },
      },
    },
  );
  assert.deepEqual(
    items.map((item) => `${item.type}:${item.relativePath}`),
    ["directory:logs", "file:added.log", "file:changed.log", "file:logs/nested.log"],
  );
});

test("mergeDataRelayScanCheckpoint records copies and retries failures", () => {
  const source = [
    entry("ok.log", { size: 12, lastModified: 9 }),
    entry("fail.log", { size: 8, lastModified: 9 }),
    entry("skip.log", { size: 3, lastModified: 2 }),
  ];
  const merged = mergeDataRelayScanCheckpoint({
    previous: {
      at: 1,
      files: {
        "fail.log": { size: 1, lastModified: 1 },
        "skip.log": { size: 3, lastModified: 2 },
      },
    },
    sourceEntries: source,
    copiedPaths: new Set(["ok.log"]),
    failedPaths: new Set(["fail.log"]),
    now: 50,
  });
  assert.equal(merged.at, 50);
  assert.deepEqual(merged.files["ok.log"], { size: 12, lastModified: 9 });
  assert.deepEqual(merged.files["fail.log"], { size: 1, lastModified: 1 });
  assert.deepEqual(merged.files["skip.log"], { size: 3, lastModified: 2 });
});
