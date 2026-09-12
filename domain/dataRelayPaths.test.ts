import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDataRelayFollowCommand,
  getDataRelayFileName,
  joinDataRelayPath,
  resolveDataRelayDestPath,
  resolveDataRelayViewerStart,
} from "./dataRelayPaths";

test("joinDataRelayPath uses the destination path style", () => {
  assert.equal(joinDataRelayPath("/var/log/", "app.log"), "/var/log/app.log");
  assert.equal(joinDataRelayPath("/var/log", "app.log"), "/var/log/app.log");
  assert.equal(joinDataRelayPath("/", "app.log"), "/app.log");
  assert.equal(joinDataRelayPath("C:\\logs\\", "app.log"), "C:\\logs\\app.log");
});

test("resolveDataRelayDestPath only joins directory hints", () => {
  assert.equal(resolveDataRelayDestPath("/src/app.log", "/var/log/"), "/var/log/app.log");
  assert.equal(resolveDataRelayDestPath("/src/app.log", "/var/log/incoming.log"), "/var/log/incoming.log");
  assert.equal(resolveDataRelayDestPath("C:\\src\\app.log", "D:\\logs\\"), "D:\\logs\\app.log");
  assert.equal(getDataRelayFileName("/var/log/app.log"), "app.log");
});

test("buildDataRelayFollowCommand follows files inside a folder", () => {
  assert.equal(
    buildDataRelayFollowCommand("/var/log/"),
    "tail -n +1 -F -- '/var/log'/*",
  );
  assert.equal(
    buildDataRelayFollowCommand("C:\\logs\\", { os: "windows" }),
    "powershell -NoProfile -NonInteractive -Command \"Get-Content -Path 'C:\\logs\\*' -Wait\"",
  );
});

test("buildDataRelayFollowCommand quotes a concrete file path", () => {
  assert.equal(
    buildDataRelayFollowCommand("/var/log/app.log"),
    "tail -n +1 -F -- '/var/log/app.log'",
  );
  assert.equal(
    buildDataRelayFollowCommand("/tmp/it's.log", { writeMode: "append" }),
    "tail -n 0 -F -- '/tmp/it'\\''s.log'",
  );
  assert.equal(
    buildDataRelayFollowCommand("C:\\logs\\app.log", { os: "windows" }),
    "powershell -NoProfile -NonInteractive -Command \"Get-Content -LiteralPath 'C:\\logs\\app.log' -Wait\"",
  );
  assert.equal(
    buildDataRelayFollowCommand("C:\\logs\\app.log", { os: "windows", writeMode: "append" }),
    "powershell -NoProfile -NonInteractive -Command \"Get-Content -LiteralPath 'C:\\logs\\app.log' -Tail 0 -Wait\"",
  );
});

test("resolveDataRelayViewerStart lists the configured folder under remote home", () => {
  assert.deepEqual(resolveDataRelayViewerStart("/var/log/", "/home/user"), { listPath: "/var/log" });
  assert.deepEqual(resolveDataRelayViewerStart("~/app/logs/", "/home/user"), { listPath: "/home/user/app/logs" });
  assert.deepEqual(resolveDataRelayViewerStart("~", "/home/user"), { listPath: "/home/user" });
  assert.deepEqual(resolveDataRelayViewerStart("incoming", "/home/user"), { listPath: "/home/user/incoming" });
  assert.deepEqual(resolveDataRelayViewerStart("", "/home/user"), { listPath: "/home/user" });
  assert.deepEqual(
    resolveDataRelayViewerStart("C:\\data\\in\\", "C:\\Users\\admin"),
    { listPath: "C:\\data\\in" },
  );
});
