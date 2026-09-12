import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const compareViewSource = readFileSync(new URL("./CompareView.tsx", import.meta.url), "utf8");
const tabViewSource = readFileSync(new URL("./DataRelayRuleTabView.tsx", import.meta.url), "utf8");
const dataRelayNewSource = readFileSync(new URL("../DataRelayNew.tsx", import.meta.url), "utf8");
const compareSessionSource = readFileSync(new URL("../../application/state/useDataRelayCompareSession.ts", import.meta.url), "utf8");

test("data-relay compare view has no in-page back control", () => {
  assert.doesNotMatch(compareViewSource, /onBack/);
  assert.doesNotMatch(compareViewSource, /t\("common.back"\)/);
});

test("opening a data-relay rule creates a work tab instead of replacing the list", () => {
  assert.match(dataRelayNewSource, /dataRelayViewTabStore\.open\(rule\)/);
  assert.doesNotMatch(dataRelayNewSource, /setCompareRuleId/);
});

test("browsing the compare panes never rewrites the rule sync paths", () => {
  // The selectors are viewers only: no commit-on-start, no save button, no
  // unmount write-back. Paths change exclusively through the edit form.
  assert.doesNotMatch(compareViewSource, /persistBrowsePaths/);
  assert.doesNotMatch(compareViewSource, /buildDataRelayBrowsePathUpdate/);
  assert.doesNotMatch(compareViewSource, /dataRelay\.compare\.savePaths/);
  assert.doesNotMatch(tabViewSource, /onPersistBrowsePaths/);
  assert.doesNotMatch(tabViewSource, /buildDataRelayBrowsePathUpdate/);
});

test("compare and sync are locked to the rule's configured roots", () => {
  assert.match(
    compareSessionSource,
    /const leftPath = resolveDataRelayViewerStart\(rule\.sourcePath/,
  );
  assert.match(
    compareSessionSource,
    /const rightPath = resolveDataRelayViewerStart\(rule\.destPath/,
  );
  assert.doesNotMatch(compareSessionSource, /leftRef\.current\.path;/);
  assert.doesNotMatch(compareSessionSource, /rightRef\.current\.path;/);
});

test("re-opening a rule tab re-anchors the panes to the configured paths", () => {
  assert.match(tabViewSource, /visible=\{isVisible\}/);
  assert.match(compareViewSource, /anchoredOpenRef/);
  assert.match(compareViewSource, /navigate\("left", resolveDataRelayViewerStart\(rule\.sourcePath/);
  assert.match(compareViewSource, /navigate\("right", resolveDataRelayViewerStart\(rule\.destPath/);
});

test("source-pane directories offer a one-shot overwrite upload to the destination", () => {
  // Menu item exists, bound to directories on the left pane only.
  assert.match(
    readFileSync(new URL("./NewFolderDialog.tsx", import.meta.url), "utf8"),
    /dataRelay\.context\.uploadDir/,
  );
  assert.match(compareViewSource, /onUploadDir=\{setUploadTarget\}/);
  assert.match(compareViewSource, /onUploadDir && isDir\(file\)/);
  // The upload walks the subtree and overwrites into the mirrored target.
  assert.match(compareSessionSource, /collectDataRelayCompareTree\(/);
  assert.match(compareSessionSource, /dataRelaySubdirUploadRelativeDir\(/);
  assert.match(compareSessionSource, /Uploading \$\{sourceDir\} -> \$\{targetDir\} \(overwrite\)/);
});
