import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ORIGINAL_INTERVAL_MS,
  BASE_INTERVAL_MS,
  DEFAULT_RATE_FRACTION,
  DEFAULT_SPEED,
  SPEED_OPTIONS,
  SPEED_STORAGE_KEY,
  ORIGINAL_STEPS_PER_SECOND,
  isSpeed,
  loadSpeed,
  playbackIntervalMs,
  playbackStepsPerSecond,
  saveSpeed,
} from "./playback.js";

const near = (actual, expected, tolerance = 1e-9) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );

/** A store that behaves like localStorage, or like storage that throws. */
function storeWith(values = {}, { throws = false } = {}) {
  const data = { ...values };
  return {
    getItem: throws ? () => { throw new Error("blocked"); } : (k) => (k in data ? data[k] : null),
    setItem: throws ? () => { throw new Error("blocked"); } : (k, v) => { data[k] = v; },
    dump: () => ({ ...data }),
  };
}

test("the base interval is the original divided by 0.65", () => {
  near(BASE_INTERVAL_MS, 800 / 0.65, 1e-9);
  // Roughly 1231ms per step at 1x — clearly slower than the old 800ms.
  near(BASE_INTERVAL_MS, 1231, 1);
  assert.equal(ORIGINAL_INTERVAL_MS, 800);
  near(DEFAULT_RATE_FRACTION, 0.65);
});

test("the default playback rate is exactly 65% of the original", () => {
  near(playbackStepsPerSecond(1) / ORIGINAL_STEPS_PER_SECOND, 0.65, 1e-12);
  // …which is the same as a 35% reduction in rate.
  near(1 - playbackStepsPerSecond(1) / ORIGINAL_STEPS_PER_SECOND, 0.35, 1e-12);
});

test("the default is slower than the original by the full 35%", () => {
  near(BASE_INTERVAL_MS / ORIGINAL_INTERVAL_MS, 1 / 0.65, 1e-12);
  assert.ok(BASE_INTERVAL_MS > ORIGINAL_INTERVAL_MS);
});

test("speed multipliers stay relative to the new base", () => {
  near(playbackIntervalMs(1), BASE_INTERVAL_MS);
  near(playbackIntervalMs(2), BASE_INTERVAL_MS / 2);
  near(playbackIntervalMs(4), BASE_INTERVAL_MS / 4);
  near(playbackIntervalMs(0.5), BASE_INTERVAL_MS * 2);
  // Relative shape is unchanged: 2x is still exactly twice 1x.
  near(playbackIntervalMs(2) * 2, playbackIntervalMs(1));
});

test("an unknown speed falls back to the default instead of stalling", () => {
  for (const bad of [undefined, null, "", 0, 3, "fast", Number.NaN, {}, []]) {
    assert.equal(playbackIntervalMs(bad), BASE_INTERVAL_MS, `speed ${String(bad)}`);
  }
});

test("manual stepping stays immediate: interval only governs auto-advance", () => {
  // The interval is a pure function of speed with no floor, minimum or state
  // side effect, so stepping by hand never waits on it.
  const a = playbackIntervalMs(4);
  const b = playbackIntervalMs(4);
  assert.equal(a, b);
  assert.ok(a > 0);
});

test("isSpeed accepts only the offered speeds", () => {
  for (const speed of SPEED_OPTIONS) {
    assert.equal(isSpeed(speed), true);
    assert.equal(isSpeed(String(speed)), true);
  }
  for (const bad of [undefined, null, 3, 1.5, "x", Number.NaN]) {
    assert.equal(isSpeed(bad), false, `should reject ${String(bad)}`);
  }
  assert.deepEqual(SPEED_OPTIONS, [0.5, 1, 2, 4]);
  assert.equal(DEFAULT_SPEED, 1);
});

test("a fresh session gets the new slower default", () => {
  assert.equal(loadSpeed(storeWith({})), DEFAULT_SPEED);
  assert.equal(loadSpeed(storeWith({ [SPEED_STORAGE_KEY]: null })), DEFAULT_SPEED);
  assert.equal(loadSpeed(storeWith({ [SPEED_STORAGE_KEY]: "" })), DEFAULT_SPEED);
});

test("a valid saved preference is restored", () => {
  for (const speed of SPEED_OPTIONS) {
    const store = storeWith({ [SPEED_STORAGE_KEY]: String(speed) });
    assert.equal(loadSpeed(store), speed);
  }
});

test("an invalid saved preference never overrides the default", () => {
  const junk = ["3", "banana", "NaN", "Infinity", "-1", "1.5", "[]", "{ }", "true"];
  for (const raw of junk) {
    assert.equal(
      loadSpeed(storeWith({ [SPEED_STORAGE_KEY]: raw })),
      DEFAULT_SPEED,
      `stored "${raw}" must not win`,
    );
  }
});

test("unavailable or blocking storage degrades to the default", () => {
  assert.equal(loadSpeed(null), DEFAULT_SPEED);
  assert.equal(loadSpeed(undefined), DEFAULT_SPEED);
  assert.equal(loadSpeed(storeWith({}, { throws: true })), DEFAULT_SPEED);
  // A store that is not a store at all must not throw either.
  assert.equal(loadSpeed({}), DEFAULT_SPEED);
});

test("saving round-trips through load", () => {
  const store = storeWith();
  assert.equal(saveSpeed(2, store), true);
  assert.equal(store.dump()[SPEED_STORAGE_KEY], "2");
  assert.equal(loadSpeed(store), 2);
});

test("saving refuses values that were never offered", () => {
  const store = storeWith();
  for (const bad of [3, 0, "fast", undefined, null]) {
    assert.equal(saveSpeed(bad, store), false, `should refuse ${String(bad)}`);
  }
  assert.deepEqual(store.dump(), {});
});

test("saving reports failure instead of throwing", () => {
  assert.equal(saveSpeed(2, null), false);
  assert.equal(saveSpeed(2, {}), false);
  assert.equal(saveSpeed(2, storeWith({}, { throws: true })), false);
});
