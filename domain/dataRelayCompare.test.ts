import assert from "node:assert/strict";
import test from "node:test";
import {
  collectDataRelayCompareTree,
  compareDataRelayDirectoryListings,
  compareDataRelayTrees,
  compareDataRelayTreesPaired,
  dataRelayCompareCopyDirectionForRow,
  dataRelayCompareKindByFirstSegment,
  dataRelayCompareKindForCurrentName,
  listDataRelayCompareCopyItems,
  summarizeDataRelayCompare,
  type DataRelayCompareEntry,
  type DataRelayCompareFile,
} from "./dataRelayCompare";

const file = (
  name: string,
  overrides: Partial<DataRelayCompareFile> = {},
): DataRelayCompareFile => ({
  name,
  type: "file",
  size: 10,
  lastModified: 1_700_000_000_000,
  ...overrides,
});

const dir = (
  name: string,
  overrides: Partial<DataRelayCompareFile> = {},
): DataRelayCompareFile => ({
  name,
  type: "directory",
  size: 0,
  lastModified: 1,
  ...overrides,
});

const entry = (
  relativePath: string,
  overrides: Partial<DataRelayCompareFile> = {},
): DataRelayCompareEntry => {
  const relative = relativePath.replace(/\/$/, "");
  const name = relative.split("/").pop() || relative;
  const isDir = overrides.type === "directory" || relativePath.endsWith("/");
  return {
    name,
    type: isDir ? "directory" : "file",
    size: isDir ? 0 : 10,
    lastModified: 1_700_000_000_000,
    relativePath: relative,
    ...overrides,
  };
};

test("compareDataRelayDirectoryListings classifies left-only, right-only and same", () => {
  const rows = compareDataRelayDirectoryListings(
    [file("keep.log"), file("only-left.log"), dir("dir")],
    [file("keep.log"), file("only-right.log")],
  );
  const byName = Object.fromEntries(rows.map((row) => [row.name, row.kind]));
  assert.equal(byName["keep.log"], "same");
  assert.equal(byName["only-left.log"], "left-only");
  assert.equal(byName["only-right.log"], "right-only");
  assert.equal(byName.dir, "left-only");
});

test("compareDataRelayDirectoryListings treats close timestamps as equal", () => {
  const rows = compareDataRelayDirectoryListings(
    [file("app.log", { lastModified: 1_000 })],
    [file("app.log", { lastModified: 2_500 })],
  );
  assert.equal(rows[0].kind, "same");
});

test("compareDataRelayDirectoryListings flags size and newer sides", () => {
  const sizeRows = compareDataRelayDirectoryListings(
    [file("app.log", { size: 8 })],
    [file("app.log", { size: 12 })],
  );
  assert.equal(sizeRows[0].kind, "size-diff");

  const newerLeft = compareDataRelayDirectoryListings(
    [file("app.log", { lastModified: 10_000 })],
    [file("app.log", { lastModified: 1_000 })],
  );
  assert.equal(newerLeft[0].kind, "newer-left");
});

test("summarizeDataRelayCompare counts WinSCP buckets", () => {
  const summary = summarizeDataRelayCompare(
    compareDataRelayDirectoryListings(
      [file("a.log"), file("b.log", { size: 2 }), file("only-l.log")],
      [file("a.log"), file("b.log", { size: 9 }), file("only-r.log")],
    ),
  );
  assert.deepEqual(summary, { same: 1, leftOnly: 1, rightOnly: 1, different: 1 });
});

test("compareDataRelayTrees marks nested left-only files and rolls up the parent dir", () => {
  const rows = compareDataRelayTrees(
    [entry("logs/", { type: "directory" }), entry("logs/app.log"), entry("logs/only-left.log")],
    [entry("logs/", { type: "directory" }), entry("logs/app.log")],
  );
  const byPath = Object.fromEntries(rows.map((row) => [row.relativePath, row.kind]));
  assert.equal(byPath["logs/app.log"], "same");
  assert.equal(byPath["logs/only-left.log"], "left-only");
  assert.equal(byPath.logs, "content-diff");
  assert.equal(dataRelayCompareKindForCurrentName(rows, "logs"), "content-diff");
  assert.deepEqual(summarizeDataRelayCompare(rows), {
    same: 1,
    leftOnly: 1,
    rightOnly: 0,
    different: 0,
  });
});

test("compareDataRelayTrees keeps matching nested directories as same", () => {
  const rows = compareDataRelayTrees(
    [entry("a/", { type: "directory" }), entry("a/keep.log")],
    [entry("a/", { type: "directory" }), entry("a/keep.log")],
  );
  const byPath = Object.fromEntries(rows.map((row) => [row.relativePath, row.kind]));
  assert.equal(byPath.a, "same");
  assert.equal(byPath["a/keep.log"], "same");
  assert.equal(dataRelayCompareKindForCurrentName(rows, "a"), "same");
});

test("listDataRelayCompareCopyItems copies nested diffs left to right", () => {
  const rows = compareDataRelayTrees(
    [
      entry("keep.log"),
      entry("nested/", { type: "directory" }),
      entry("nested/new.log"),
      entry("nested/stale.log", { lastModified: 10_000 }),
    ],
    [
      entry("keep.log"),
      entry("nested/", { type: "directory" }),
      entry("nested/stale.log", { lastModified: 1_000 }),
      entry("nested/only-right.log"),
    ],
  );
  const items = listDataRelayCompareCopyItems(rows, "left-to-right");
  assert.deepEqual(
    items.map((item) => `${item.type}:${item.relativePath}`),
    ["file:nested/new.log", "file:nested/stale.log"],
  );
});

test("listDataRelayCompareCopyItems copies a selected folder recursively", () => {
  const rows = compareDataRelayTrees(
    [entry("pkg/", { type: "directory" }), entry("pkg/a.txt"), entry("pkg/b.txt")],
    [entry("pkg/", { type: "directory" }), entry("pkg/a.txt")],
  );
  const items = listDataRelayCompareCopyItems(rows, "left-to-right", {
    name: "pkg",
    copyAllUnderPrefix: true,
  });
  assert.deepEqual(
    items.map((item) => `${item.type}:${item.relativePath}`),
    ["directory:pkg", "file:pkg/a.txt", "file:pkg/b.txt"],
  );
});

test("collectDataRelayCompareTree walks nested directories and skips symlink dirs", async () => {
  const tree: Record<string, DataRelayCompareFile[]> = {
    "/src": [dir("sub"), file("root.log"), { name: "link", type: "symlink", linkTarget: "directory", size: 0, lastModified: 1 }],
    "/src/sub": [file("nested.log")],
  };
  const listed: string[] = [];
  const result = await collectDataRelayCompareTree(
    "/src",
    async (path) => {
      listed.push(path);
      return tree[path] ?? [];
    },
    {
      joinAbsolute: (base, name) => `${base.replace(/\/+$/, "")}/${name}`,
      concurrency: 2,
    },
  );
  assert.deepEqual(listed.sort(), ["/src", "/src/sub"]);
  assert.deepEqual(
    result.entries.map((item) => item.relativePath).sort(),
    ["link", "root.log", "sub", "sub/nested.log"],
  );
  assert.equal(result.errors.length, 0);
});

test("compareDataRelayTreesPaired keeps only diffs and counts identical files", async () => {
  const left: Record<string, DataRelayCompareFile[]> = {
    "/src": [dir("logs"), file("keep.log"), file("only-left.log")],
    "/src/logs": [file("app.log"), file("new.log")],
  };
  const right: Record<string, DataRelayCompareFile[]> = {
    "/dst": [dir("logs"), file("keep.log"), file("only-right.log")],
    "/dst/logs": [file("app.log")],
  };
  const result = await compareDataRelayTreesPaired(
    "/src",
    "/dst",
    async (side, path) => (side === "left" ? left : right)[path] ?? [],
    { joinAbsolute: (base, name) => `${base.replace(/\/+$/, "")}/${name}` },
  );
  const byPath = Object.fromEntries(result.diffs.map((row) => [row.relativePath, row.kind]));
  assert.equal(byPath["keep.log"], undefined);
  assert.equal(byPath["logs/app.log"], undefined);
  assert.equal(byPath["only-left.log"], "left-only");
  assert.equal(byPath["only-right.log"], "right-only");
  assert.equal(byPath["logs/new.log"], "left-only");
  assert.equal(result.summary.same, 2);
  assert.equal(result.summary.leftOnly, 2);
  assert.equal(result.summary.rightOnly, 1);
  assert.equal(dataRelayCompareKindByFirstSegment(result.diffs).get("logs"), "content-diff");
  assert.equal(dataRelayCompareKindByFirstSegment(result.diffs).get("only-left.log"), "left-only");
});

test("compareDataRelayTreesPaired walks unique directories on one side only", async () => {
  const left: Record<string, DataRelayCompareFile[]> = {
    "/src": [dir("extra")],
    "/src/extra": [dir("nested"), file("a.txt")],
    "/src/extra/nested": [file("b.txt")],
  };
  const right: Record<string, DataRelayCompareFile[]> = {
    "/dst": [],
  };
  const result = await compareDataRelayTreesPaired(
    "/src",
    "/dst",
    async (side, path) => (side === "left" ? left : right)[path] ?? [],
    { joinAbsolute: (base, name) => `${base.replace(/\/+$/, "")}/${name}` },
  );
  assert.deepEqual(
    result.diffs.map((row) => row.relativePath).sort(),
    ["extra", "extra/a.txt", "extra/nested", "extra/nested/b.txt"],
  );
  assert.equal(result.summary.leftOnly, 4);
});

test("listDataRelayCompareCopyItems honors an explicit path set", () => {
  const rows = compareDataRelayTrees(
    [entry("a.log"), entry("b.log", { size: 2 }), entry("skip.log")],
    [entry("a.log"), entry("b.log", { size: 9 })],
  );
  const items = listDataRelayCompareCopyItems(rows, "left-to-right", {
    paths: new Set(["b.log"]),
  });
  assert.deepEqual(items.map((item) => item.relativePath), ["b.log"]);
});

test("dataRelayCompareCopyDirectionForRow sends both-way size diffs only to the source", () => {
  const rows = compareDataRelayTrees(
    [entry("newer.log", { lastModified: 10_000 }), entry("size.log", { size: 2 })],
    [entry("newer.log", { lastModified: 1_000 }), entry("size.log", { size: 9 }), entry("only-right.log")],
  );
  const byPath = Object.fromEntries(rows.map((row) => [row.relativePath, row]));
  assert.equal(byPath["only-right.log"]?.kind, "right-only");
  assert.equal(dataRelayCompareCopyDirectionForRow(byPath["newer.log"], "both"), "left-to-right");
  assert.equal(dataRelayCompareCopyDirectionForRow(byPath["size.log"], "both"), "left-to-right");
  assert.equal(dataRelayCompareCopyDirectionForRow(byPath["only-right.log"], "both"), "right-to-left");
});

