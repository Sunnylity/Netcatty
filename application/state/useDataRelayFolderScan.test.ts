import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const folderScanSource = readFileSync(new URL("./useDataRelayFolderScan.ts", import.meta.url), "utf8");

test("folder scans wait the remaining interval instead of sleeping after each pass", () => {
  assert.match(folderScanSource, /remainingDataRelayScanDelayMs\(interval, Date\.now\(\) - startedAt\)/);
  assert.doesNotMatch(folderScanSource, /await sleep\(session, interval\)/);
});

test("folder scan copies skip the shared transfer admission queue", () => {
  assert.match(folderScanSource, /skipAdmission:\s*true/);
});
