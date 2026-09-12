import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const compareViewSource = readFileSync(new URL("./CompareView.tsx", import.meta.url), "utf8");
const tabViewSource = readFileSync(new URL("./DataRelayRuleTabView.tsx", import.meta.url), "utf8");
const dataRelayNewSource = readFileSync(new URL("../DataRelayNew.tsx", import.meta.url), "utf8");

test("data-relay compare view has no in-page back control", () => {
  assert.doesNotMatch(compareViewSource, /onBack/);
  assert.doesNotMatch(compareViewSource, /t\("common.back"\)/);
});

test("opening a data-relay rule creates a work tab instead of replacing the list", () => {
  assert.match(dataRelayNewSource, /dataRelayViewTabStore\.open\(rule\)/);
  assert.doesNotMatch(dataRelayNewSource, /setCompareRuleId/);
});

test("compare view commits selector folders before start and can save them explicitly", () => {
  assert.match(compareViewSource, /persistBrowsePaths\(\{ preserveRuntime: false \}\)/);
  assert.match(compareViewSource, /dataRelay\.compare\.savePaths/);
  assert.match(tabViewSource, /preserveRuntime: options\?\.preserveRuntime === true/);
});
