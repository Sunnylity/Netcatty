import assert from "node:assert/strict";
import test from "node:test";
import { resolveRemotePathBrowserStart } from "./useRemotePathBrowser";

test("resolveRemotePathBrowserStart opens a directory path in place", () => {
  assert.deepEqual(
    resolveRemotePathBrowserStart("/var/log/app.log", "/home/user", { preferDirectory: true }),
    { startDir: "/var/log/app.log", requestedName: "" },
  );
  assert.deepEqual(
    resolveRemotePathBrowserStart("/var/log/", "/home/user", { preferDirectory: true }),
    { startDir: "/var/log", requestedName: "" },
  );
});

test("resolveRemotePathBrowserStart opens the parent of a file path", () => {
  assert.deepEqual(
    resolveRemotePathBrowserStart("/var/log/app.log", "/home/user"),
    { startDir: "/var/log", requestedName: "app.log" },
  );
});

test("resolveRemotePathBrowserStart keeps a directory hint", () => {
  assert.deepEqual(
    resolveRemotePathBrowserStart("/var/log/", "/home/user"),
    { startDir: "/var/log", requestedName: "" },
  );
});

test("resolveRemotePathBrowserStart falls back to home", () => {
  assert.deepEqual(
    resolveRemotePathBrowserStart("", "/home/user"),
    { startDir: "/home/user", requestedName: "" },
  );
});
