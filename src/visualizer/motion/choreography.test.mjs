// The motion canvas moves cells with transform-only Web Animations. These tests
// pin the pure decisions behind that: where a path starts, where it ends, how it
// bows, and which roles share a curve. No DOM and no clock are involved.
//
//   node --test src/visualizer/motion/choreography.test.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";

import { snapshotAt, stateOf } from "../../animation/diff.js";
import { MOTION_ARC, MOTION_EASING, moveKeyframes, offsetOf } from "./choreography.js";
import { MOTION_OPERATION, motionDuration, planMotion } from "./plan.js";

const read = (path) =>
  JSON.parse(gunzipSync(readFileSync(new URL(path, import.meta.url))).toString());

const CORPUS = read("../../tracer/__fixtures__/corpus.json.gz");
const RECOGNITION = read("../../tracer/__fixtures__/recognition.json.gz");

const eventsOf = (trace) => (Array.isArray(trace) ? trace : Object.values(trace));

function program(name) {
  const entry = CORPUS[name] ?? RECOGNITION.programs[name];
  assert.ok(entry, `${name} is in a fixture`);
  return { name, source: entry.source, trace: eventsOf(entry.trace) };
}

function planAt(p, index, previousIndex = index === 0 ? null : index - 1, extra = {}) {
  return planMotion(p.trace, index, { source: p.source, previousIndex, ...extra });
}

/** `translate(-120px, 3.5px)` -> { x: -120, y: 3.5 } */
function translation(frame) {
  const match = /^translate\((-?[\d.]+)(?:px)?, (-?[\d.]+)(?:px)?\)$/.exec(frame.transform);
  assert.ok(match, `unreadable keyframe: ${frame.transform}`);
  return { x: Number(match[1]), y: Number(match[2]) };
}

/** A row of equal cells, one slot 70px apart, so a swap is +/-70px of travel. */
const SLOT = 70;
const rectAt = (index) => ({ left: index * SLOT, top: 0, width: SLOT - 6, height: 48 });

test("a move starts exactly where the element is and ends on its layout slot", () => {
  const frames = moveKeyframes(-140, 0);
  assert.equal(frames.length, 2);
  assert.deepEqual(translation(frames[0]), { x: -140, y: 0 });
  assert.deepEqual(translation(frames.at(-1)), { x: 0, y: 0 });

  const diagonal = moveKeyframes(12, -30);
  assert.deepEqual(translation(diagonal[0]), { x: 12, y: -30 });
  assert.deepEqual(translation(diagonal.at(-1)), { x: 0, y: 0 });
});

test("a move too small to see is not animated at all", () => {
  assert.equal(moveKeyframes(0, 0), null);
  assert.equal(moveKeyframes(0.2, -0.2), null, "sub-pixel layout noise stays still");
  assert.equal(moveKeyframes(Number.NaN, 0), null, "an unmeasurable element is not moved");
  assert.ok(moveKeyframes(0.6, 0), "a real one-pixel move still animates");
});

test("the two cells of a swap bow to opposite sides with the same magnitude", () => {
  // A verified swap moves cell i right and cell j left, one slot each.
  const rightward = offsetOf(rectAt(3), rectAt(4));
  const leftward = offsetOf(rectAt(5), rectAt(4));
  const out = moveKeyframes(rightward.dx, rightward.dy, { arc: MOTION_ARC.swap });
  const back = moveKeyframes(leftward.dx, leftward.dy, { arc: MOTION_ARC.swap });

  assert.equal(out.length, 3, "a swap is a curved path");
  assert.equal(back.length, 3);
  const outMid = translation(out[1]);
  const backMid = translation(back[1]);
  assert.ok(outMid.y < 0, "the cell moving right passes above the row");
  assert.ok(backMid.y > 0, "the cell moving left passes below it");
  assert.equal(Math.abs(outMid.y), Math.abs(backMid.y), "the two arcs are mirror images");
  assert.equal(outMid.y + backMid.y, 0);
  assert.deepEqual(translation(out[0]), { x: -SLOT, y: 0 });
  assert.deepEqual(translation(back[0]), { x: SLOT, y: 0 });
  assert.deepEqual(translation(out.at(-1)), translation(back.at(-1)));
});

test("a bow stays subtle: capped by the distance and zero when unrequested", () => {
  const long = moveKeyframes(-400, 0, { arc: MOTION_ARC.swap });
  assert.equal(Math.abs(translation(long[1]).y), MOTION_ARC.swap, "a long move keeps the arc");

  const short = moveKeyframes(-8, 0, { arc: MOTION_ARC.swap });
  assert.equal(Math.abs(translation(short[1]).y), 4, "a short move bows at most half its length");

  const straight = moveKeyframes(-140, 0, { arc: 0 });
  assert.equal(straight.length, 2, "a plain FLIP adds no overshoot");
});

test("each role has one curve, and movement is not the fade", () => {
  for (const [role, easing] of Object.entries(MOTION_EASING)) {
    assert.match(easing, /^cubic-bezier\(0(\.\d+)?, [\d.]+, [\d.]+, 1\)$/, `${role} is an ease-out`);
    assert.ok(!/^ease(-in-out)?$/.test(easing), `${role} is a tuned curve, not a keyword`);
  }
  assert.notEqual(MOTION_EASING.move, MOTION_EASING.fade);
  assert.equal(new Set(Object.values(MOTION_EASING)).size, 3, "the roles stay distinguishable");
});

test("both swap cells share one duration, however fast playback runs", () => {
  const p = program("bubble-sort");
  let checked = 0;
  for (let index = 1; index < p.trace.length; index += 1) {
    const plan = planAt(p, index);
    if (!plan) continue;
    const swap = plan.operations.find(
      (operation) =>
        operation.op === MOTION_OPERATION.move && operation.motion === "swap",
    );
    if (!swap) continue;
    checked += 1;
    for (const speed of [0.5, 1, 2, 4]) {
      const fast = planAt(p, index, index - 1, { speed });
      const durations = fast.operations
        .filter((operation) => operation.op === MOTION_OPERATION.move)
        .map((operation) => operation.durationMs);
      assert.equal(new Set(durations).size, 1, `speed ${speed} keeps the pair together`);
      assert.equal(fast.durationMs, Math.max(...durations));
      assert.ok(fast.durationMs >= 80, "a move never becomes instantaneous");
    }
  }
  assert.ok(checked > 0, "the fixture really has swaps");
});

test("a reverse step and a seek keep the same start and end, but only the step animates", () => {
  const p = program("bubble-sort");
  const index = p.trace.findIndex(
    (event, at) =>
      at > 0 &&
      planAt(p, at)?.operations.some(
        (operation) => operation.op === MOTION_OPERATION.move && operation.motion === "swap",
      ),
  );
  assert.ok(index > 0, "the fixture has a verified swap");

  const forward = planAt(p, index, index - 1);
  const backward = planAt(p, index - 1, index);
  assert.equal(forward.animate, true);
  assert.equal(backward.animate, true, "reverse playback animates the inverse action");

  // What the renderer would measure is the same pair of slots either way, so the
  // paths are the same length; only the recorded state they land on differs.
  const swap = forward.operations.find((operation) => operation.motion === "swap");
  const [left, right] = swap.action.payload.indices;
  for (const plan of [forward, backward]) {
    const pair = plan.operations.find((operation) => operation.motion === "swap");
    assert.deepEqual(
      pair.action.payload.indices,
      [left, right],
      "reverse playback animates the same verified pair",
    );
    const rects = { [left]: rectAt(right), [right]: rectAt(left) };
    for (const cell of [left, right]) {
      const offset = offsetOf(rects[cell], rectAt(cell));
      assert.equal(Math.abs(offset.dx), SLOT);
      assert.deepEqual(moveKeyframes(offset.dx, offset.dy, { arc: MOTION_ARC.swap }).at(-1), {
        transform: "translate(0, 0)",
      });
    }
  }

  // A seek or a reset renders the target directly: no animation is planned, so
  // no path is ever built and nothing can jump from a stale transform.
  const seek = planAt(p, index, null);
  assert.equal(seek.animate, false);
  assert.equal(planAt(p, 0, null).animate, false);
  assert.equal(planAt(p, index, index - 1, { reducedMotion: true }).animate, false);
});

test("animation length follows speed without collapsing or fading away", () => {
  const slow = motionDuration("move", { speed: 0.5 });
  const normal = motionDuration("move", { speed: 1 });
  const fast = motionDuration("move", { speed: 4 });
  assert.ok(slow > normal, "slow playback lingers");
  assert.ok(fast < normal, "fast playback shortens the move");
  assert.ok(fast >= 80, "but never past the floor");
  assert.equal(motionDuration("move", { reducedMotion: true }), 0);
  for (const operation of Object.values(MOTION_OPERATION)) {
    const value = motionDuration(operation, { speed: 2 });
    assert.ok(Number.isFinite(value) && value >= 0, `${operation} has a usable duration`);
  }
});

test("a curved path is only ever built from the target state the plan holds", () => {
  const p = program("bubble-sort");
  for (let index = 1; index < p.trace.length; index += 1) {
    const plan = planAt(p, index);
    if (!plan) continue;
    if (!plan.animate) continue;
    // Whatever the plan says happened, the recorded state is still the target,
    // so the animation can only ever land on it.
    assert.deepEqual(plan.state, stateOf(snapshotAt(p.trace, index)));
  }
});
