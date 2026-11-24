import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_FOCUS_LEFT,
  DEFAULT_SURFACE,
  FOCUS_COLUMNS_KEY,
  MAX_FOCUS_LEFT,
  MIN_FOCUS_LEFT,
  SURFACE_STORAGE_KEY,
  clampFocusLeft,
  isSurface,
  loadFocusLeft,
  loadSurface,
  saveFocusLeft,
  saveSurface,
  splitLeft,
} from "./focusLayout.js";

function memoryStore(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    dump: () => Object.fromEntries(map),
  };
}

function throwingStore() {
  return {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  };
}

test("focus is the default and studio is the other surface", () => {
  assert.equal(DEFAULT_SURFACE, "focus");
  assert.ok(isSurface("focus"));
  assert.ok(isSurface("studio"));
  assert.ok(!isSurface("other"));
});

test("surface persists, and unknown or blocked storage falls back to focus", () => {
  const store = memoryStore();
  assert.equal(loadSurface(store), "focus");
  assert.equal(saveSurface("studio", store), true);
  assert.equal(store.dump()[SURFACE_STORAGE_KEY], "studio");
  assert.equal(loadSurface(store), "studio");
  assert.equal(loadSurface(memoryStore({ [SURFACE_STORAGE_KEY]: "nonsense" })), "focus");
  assert.equal(loadSurface(throwingStore()), "focus");
  assert.equal(saveSurface("studio", throwingStore()), false);
  assert.equal(saveSurface("nonsense", memoryStore()), false);
});

test("the split clamps to a usable range", () => {
  assert.equal(clampFocusLeft(10), MIN_FOCUS_LEFT);
  assert.equal(clampFocusLeft(90), MAX_FOCUS_LEFT);
  assert.equal(clampFocusLeft("42"), 42);
  assert.equal(clampFocusLeft("nope"), DEFAULT_FOCUS_LEFT);
});

test("a drag maps to percentage points and clamps at both ends", () => {
  // 1000px wide, starting at 40%, dragging 200px right adds 20 points.
  assert.equal(splitLeft(40, 700, 500, 1000), 58);
  assert.equal(splitLeft(40, 500, 500, 1000), 40);
  assert.equal(splitLeft(40, 100, 500, 1000), MIN_FOCUS_LEFT);
  assert.equal(splitLeft(40, 900, 500, 1000), MAX_FOCUS_LEFT);
  // A zero or missing width cannot divide by zero.
  assert.equal(splitLeft(40, 700, 500, 0), 40);
});

test("the split persists and a blocked store keeps the default", () => {
  const store = memoryStore();
  assert.equal(loadFocusLeft(store), DEFAULT_FOCUS_LEFT);
  assert.equal(saveFocusLeft(47.6, store), true);
  assert.equal(loadFocusLeft(store), 47.6);
  assert.equal(loadFocusLeft(memoryStore({ [FOCUS_COLUMNS_KEY]: "{bad json" })), DEFAULT_FOCUS_LEFT);
  assert.equal(loadFocusLeft(throwingStore()), DEFAULT_FOCUS_LEFT);
  assert.equal(saveFocusLeft(40, throwingStore()), false);
});
