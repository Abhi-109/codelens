// Unit tests for the visualization mode (src/visualizer/vizMode.js).
//
//   node --test src/visualizer/vizMode.test.mjs
//
// The mode is presentation only. The rule these tests exist to hold down is
// the one the whole redesign rests on: choosing a different drawing must carry
// the run through untouched — same step, same playing state, same speed.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_VIZ,
  VIZ_BLURBS,
  VIZ_LABELS,
  VIZ_MODES,
  VIZ_STORAGE_KEY,
  initialViz,
  isVizMode,
  loadViz,
  normalizeViz,
  saveViz,
  selectViz,
  stepViz,
} from "./vizMode.js";
import { LEARNING_MODES, modeDetail } from "./learningMode.js";

function storeWith(values = {}, { throws = false } = {}) {
  const data = { ...values };
  return {
    getItem: throws ? () => { throw new Error("blocked"); } : (k) => (k in data ? data[k] : null),
    setItem: throws ? () => { throw new Error("blocked"); } : (k, v) => { data[k] = v; },
    dump: () => ({ ...data }),
  };
}

test("every offered canvas has a name and a plain-English blurb", () => {
  assert.deepEqual(
    VIZ_MODES,
    ["scene", "tree", "flow", "combined", "timeline"],
    "Adaptive is the canvas a fresh run opens on",
  );
  assert.equal(DEFAULT_VIZ, "scene");
  for (const id of VIZ_MODES) {
    assert.equal(isVizMode(id), true);
    assert.equal(typeof VIZ_LABELS[id], "string");
    assert.ok(VIZ_LABELS[id].length > 0);
    assert.ok(VIZ_LABELS[id].length <= 12, `${id} fits the compact mobile strip`);
    assert.ok(VIZ_BLURBS[id].length > 0);
  }
  assert.deepEqual(Object.keys(VIZ_LABELS).sort(), [...VIZ_MODES].sort());
  assert.equal(
    new Set(VIZ_MODES.map((id) => VIZ_LABELS[id])).size,
    VIZ_MODES.length,
    "every mode is distinguishable by its visible label",
  );
  assert.equal(isVizMode("graph"), false);
  assert.equal(isVizMode(null), false);
  assert.equal(isVizMode(undefined), false);
});

test("an unusable choice falls back to Adaptive rather than blanking the pane", () => {
  assert.equal(normalizeViz("tree"), "tree");
  assert.equal(normalizeViz("nonsense"), DEFAULT_VIZ);
  assert.equal(normalizeViz(""), DEFAULT_VIZ);
  assert.equal(normalizeViz(null), DEFAULT_VIZ);
  assert.equal(normalizeViz(undefined), DEFAULT_VIZ);
  assert.equal(normalizeViz({}), DEFAULT_VIZ);
});

test("choosing a canvas carries every other part of the workspace through", () => {
  const workspace = {
    viz: "tree",
    index: 41,
    playing: true,
    speed: 2,
    mode: "beginner",
    selectedCall: 7,
    watched: "total",
  };
  const next = selectViz(workspace, VIZ_MODES[0]);
  assert.equal(next.index, 41, "the step did not move");
  assert.equal(next.playing, true, "playback kept running");
  assert.equal(next.speed, 2, "the speed was not touched");
  assert.equal(next.mode, "beginner", "the learning mode is a separate choice");
  assert.equal(next.selectedCall, 7, "the selected call was not cleared");
  assert.equal(next.watched, "total", "the watched variable survived");
});

test("an unknown canvas keeps the current one instead of blanking the pane", () => {
  const state = { viz: "tree", index: 3 };
  assert.equal(selectViz(state, "nope").viz, "tree");
  assert.equal(selectViz(state, null).viz, "tree");
  assert.deepEqual(
    selectViz(null, "nope"),
    { viz: DEFAULT_VIZ },
    "no state to update falls back exactly the way the inspector tab does",
  );
  assert.equal(initialViz().viz, DEFAULT_VIZ, "with nothing saved, a fresh session opens on Adaptive");
});

test("picking the canvas already showing changes nothing at all", () => {
  const state = { viz: "tree", index: 9 };
  assert.equal(selectViz(state, "tree"), state, "the same object, so nothing re-renders");
});

test("the learning mode and the canvas never answer for each other", () => {
  // Two independent choices: how much vocabulary on one side, which drawing on
  // the other. Nothing in the learning mode's own surface can name a canvas.
  for (const mode of LEARNING_MODES) {
    const detail = modeDetail(mode);
    for (const value of Object.values(detail)) assert.equal(typeof value, "boolean", mode);
    assert.equal(isVizMode(mode), false, `${mode} is a learning mode, not a canvas`);
  }
  for (const id of VIZ_MODES) {
    assert.equal(LEARNING_MODES.includes(id), false, `${id} is a canvas, not a learning mode`);
  }
});

test("stepping along the canvas strip wraps at both ends", () => {
  const first = VIZ_MODES[0];
  const last = VIZ_MODES[VIZ_MODES.length - 1];
  const oneOn = VIZ_MODES[1 % VIZ_MODES.length]; // one step past the first, or the first again
  assert.equal(stepViz(last, 1), first, "past the last canvas, round to the first");
  assert.equal(stepViz(first, -1), last, "before the first canvas, round to the last");
  if (VIZ_MODES.length > 1) {
    assert.equal(stepViz(first, 1), VIZ_MODES[1], "one step on walks to the next canvas");
    assert.equal(stepViz(last, -1), VIZ_MODES[VIZ_MODES.length - 2]);
  }
  assert.equal(stepViz(undefined, 1), oneOn, "nothing chosen: start at Adaptive, step on");
  assert.equal(stepViz("nonsense", 1), oneOn, "unusable choice: the same");
  assert.equal(stepViz(first, Number.NaN), first, "not a step at all: stay put");
});

test("the saved canvas is restored, and an invalid one is not", () => {
  assert.equal(loadViz(storeWith({})), DEFAULT_VIZ);
  assert.equal(loadViz(storeWith({ [VIZ_STORAGE_KEY]: null })), DEFAULT_VIZ);
  assert.equal(loadViz(null), DEFAULT_VIZ);
  assert.equal(loadViz(storeWith({}, { throws: true })), DEFAULT_VIZ);
  assert.equal(loadViz({}), DEFAULT_VIZ);
  for (const id of VIZ_MODES) {
    assert.equal(loadViz(storeWith({ [VIZ_STORAGE_KEY]: id })), id);
  }
  for (const junk of ["nonsense", "", "GRAPH", "exec"]) {
    assert.equal(loadViz(storeWith({ [VIZ_STORAGE_KEY]: junk })), DEFAULT_VIZ);
  }
});

test("saving a canvas round-trips and refuses invalid ids", () => {
  const store = storeWith();
  for (const id of VIZ_MODES) {
    assert.equal(saveViz(id, store), true);
    assert.equal(store.dump()[VIZ_STORAGE_KEY], id);
    assert.equal(loadViz(store), id);
  }
  assert.equal(saveViz("nonsense", store), false);
  assert.equal(saveViz(null, store), false);
  assert.equal(saveViz("tree", null), false);
  assert.equal(saveViz("tree", storeWith({}, { throws: true })), false);
});
