import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_INSPECTOR_TAB,
  INSPECTOR_TABS,
  INSPECTOR_TAB_IDS,
  clampStep,
  initialInspectorTab,
  selectInspectorTab,
  stepBy,
} from "./workspace.js";

test("the inspector offers the six agreed sections in order", () => {
  assert.deepEqual(INSPECTOR_TAB_IDS, [
    "explain",
    "variables",
    "stack",
    "memory",
    "output",
    "history",
  ]);
  assert.equal(DEFAULT_INSPECTOR_TAB, "explain");
  for (const tab of INSPECTOR_TABS) {
    assert.equal(typeof tab.label, "string");
    assert.ok(tab.label.length > 0);
  }
});

test("the workspace opens on the plain-English explanation", () => {
  assert.deepEqual(initialInspectorTab(), { tab: "explain" });
});

test("switching tabs never moves the execution step", () => {
  const state = { index: 42, tab: "explain", playing: true, speed: 2 };
  for (const id of INSPECTOR_TAB_IDS) {
    const next = selectInspectorTab(state, id);
    assert.equal(next.index, 42, `${id} must not touch index`);
    assert.equal(next.playing, true, `${id} must not touch playing`);
    assert.equal(next.speed, 2, `${id} must not touch speed`);
    assert.equal(next.tab, id);
  }
});

test("switching to the tab you are already on returns the same state", () => {
  const state = { index: 7, tab: "memory" };
  assert.equal(selectInspectorTab(state, "memory"), state);
});

test("an unknown tab keeps the current one and the current step", () => {
  const state = { index: 5, tab: "stack" };
  assert.equal(selectInspectorTab(state, "nope").tab, "stack");
  assert.equal(selectInspectorTab(state, "nope").index, 5);
  assert.equal(selectInspectorTab(state, undefined).tab, "stack");
  assert.equal(selectInspectorTab({ tab: "explain" }, null).tab, "explain");
});

test("the step is clamped to the trace at both ends", () => {
  assert.equal(clampStep(0, 10), 0);
  assert.equal(clampStep(5, 10), 5);
  assert.equal(clampStep(99, 10), 9);
  assert.equal(clampStep(-4, 10), 0);
  assert.equal(clampStep(3, 0), 0, "an empty trace is step 0 of 0");
  assert.equal(clampStep(-1, 0), 0);
});

test("stepBy walks the trace and stops at the ends", () => {
  assert.equal(stepBy(0, 5, 1), 1);
  assert.equal(stepBy(0, 5, -1), 0);
  assert.equal(stepBy(4, 5, 1), 4, "the last step does not run past the trace");
  assert.equal(stepBy(4, 5, -1), 3);
  assert.equal(stepBy(0, 5, -1), 0);
  assert.equal(stepBy(2, 0, 1), 0);
  assert.equal(stepBy(Number.NaN, 5, 1), 1, "a bad index recovers rather than corrupting");
});

test("back and forward are exact inverses in the middle of a trace", () => {
  for (let i = 1; i < 9; i += 1) {
    assert.equal(stepBy(stepBy(i, 10, 1), 10, -1), i);
    assert.equal(stepBy(stepBy(i, 10, -1), 10, 1), i);
  }
});
