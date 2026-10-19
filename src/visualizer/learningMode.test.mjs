import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_MODE,
  LEARNING_MODES,
  MODE_BLURBS,
  MODE_LABELS,
  MODE_STORAGE_KEY,
  isLearningMode,
  loadMode,
  modeDetail,
  saveMode,
} from "./learningMode.js";

function storeWith(values = {}, { throws = false } = {}) {
  const data = { ...values };
  return {
    getItem: throws ? () => { throw new Error("blocked"); } : (k) => (k in data ? data[k] : null),
    setItem: throws ? () => { throw new Error("blocked"); } : (k, v) => { data[k] = v; },
    dump: () => ({ ...data }),
  };
}

test("the three modes exist with readable labels", () => {
  assert.deepEqual(LEARNING_MODES, ["beginner", "advanced", "textbook"]);
  assert.equal(DEFAULT_MODE, "beginner");
  for (const mode of LEARNING_MODES) {
    assert.equal(isLearningMode(mode), true);
    assert.equal(typeof MODE_LABELS[mode], "string");
    assert.ok(MODE_LABELS[mode].length > 0);
    assert.ok(MODE_BLURBS[mode].length > 0);
  }
  assert.equal(isLearningMode("expert"), false);
  assert.equal(isLearningMode(null), false);
  assert.equal(isLearningMode(undefined), false);
});

test("Beginner hides the technical vocabulary", () => {
  assert.deepEqual(modeDetail("beginner"), {
    showTypes: false,
    showScope: false,
    showMeta: false,
    structured: false,
  });
});

test("Advanced shows the technical details and metadata", () => {
  assert.deepEqual(modeDetail("advanced"), {
    showTypes: true,
    showScope: true,
    showMeta: true,
    structured: false,
  });
});

test("Textbook uses the structured control-flow framing", () => {
  const detail = modeDetail("textbook");
  assert.equal(detail.structured, true);
  assert.equal(detail.showMeta, false);
  assert.equal(detail.showTypes, true);
});

test("a mode may only change presentation, never whether a fact is shown", () => {
  // Four flags, all of them vocabulary or framing. A mode is not allowed to
  // add or remove an execution fact, so nothing here can switch the trace off.
  const keys = ["showTypes", "showScope", "showMeta", "structured"];
  for (const mode of LEARNING_MODES) {
    const detail = modeDetail(mode);
    assert.deepEqual(Object.keys(detail).sort(), [...keys].sort(), mode);
    for (const value of Object.values(detail)) assert.equal(typeof value, "boolean");
  }
});

test("an unknown mode falls back to the default detail", () => {
  assert.deepEqual(modeDetail("nope"), modeDetail(DEFAULT_MODE));
  assert.deepEqual(modeDetail(undefined), modeDetail(DEFAULT_MODE));
  assert.deepEqual(modeDetail(null), modeDetail(DEFAULT_MODE));
  assert.deepEqual(modeDetail("BEGINNER"), modeDetail(DEFAULT_MODE));
});

test("a learning mode decides wording, never which diagram is drawn", async () => {
  // The canvas belongs to the visualization mode (vizMode.js). Nothing a
  // learner sets for vocabulary may name a diagram any more, which is the
  // guarantee that Textbook can teach control-flow words without dragging the
  // learner back to one particular view every time they pick it.
  const mod = await import("./learningMode.js");
  assert.equal("graphKind" in mod, false, "learning mode no longer chooses a canvas");
  // The whole surface that remains is wording, flags and storage.
  assert.equal(typeof mod.modeDetail, "function");
  assert.equal(typeof mod.loadMode, "function");
  assert.equal(typeof mod.saveMode, "function");
});

test("a fresh session gets the default mode", () => {
  assert.equal(loadMode(storeWith({})), DEFAULT_MODE);
  assert.equal(loadMode(storeWith({ [MODE_STORAGE_KEY]: null })), DEFAULT_MODE);
  assert.equal(loadMode(null), DEFAULT_MODE);
  assert.equal(loadMode(storeWith({}, { throws: true })), DEFAULT_MODE);
  assert.equal(loadMode({}), DEFAULT_MODE);
});

test("a saved mode is restored, an invalid one is not", () => {
  for (const mode of LEARNING_MODES) {
    assert.equal(loadMode(storeWith({ [MODE_STORAGE_KEY]: mode })), mode);
  }
  for (const junk of ["expert", "", "BEGINNER", "novice"]) {
    assert.equal(loadMode(storeWith({ [MODE_STORAGE_KEY]: junk })), DEFAULT_MODE);
  }
});

test("saving round-trips and refuses invalid modes", () => {
  const store = storeWith();
  assert.equal(saveMode("textbook", store), true);
  assert.equal(store.dump()[MODE_STORAGE_KEY], "textbook");
  assert.equal(loadMode(store), "textbook");

  assert.equal(saveMode("expert", store), false);
  assert.equal(saveMode(null, store), false);
  assert.equal(saveMode("textbook", null), false);
  assert.equal(saveMode("textbook", storeWith({}, { throws: true })), false);
});
