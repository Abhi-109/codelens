// Persistent sorted-position highlights are evidence, not a guess: every
// settled cell is proven from the recording (a clean finish, an untruncated
// sorted outcome, a list the trace rearranged in place, and a value that
// already matches that outcome from an end of the row). No algorithm name, no
// loop variable and no "has not moved lately" rule is involved.
//
//   node --test src/visualizer/motion/finality.test.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";

import { canonicalValue } from "../../animation/actions.js";
import { snapshotAt, stateOf } from "../../animation/diff.js";
import { finalIndices, finalizedCells, sequenceOutcomes } from "./finality.js";
import { planMotion } from "./plan.js";

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

function planAt(p, index, previousIndex = index === 0 ? null : index - 1) {
  return planMotion(p.trace, index, { source: p.source, previousIndex });
}

function settled(plan) {
  return plan.finalized.flatMap((group) => group.indices);
}

/** The last step that still draws the list, i.e. the visible end of the run. */
function lastVisibleIndex(trace) {
  for (let index = trace.length - 1; index >= 0; index -= 1) {
    const state = stateOf(snapshotAt(trace, index));
    const list = state.heap?.o1;
    if (Array.isArray(list?.items) && list.items.length > 0) return index;
  }
  return -1;
}

test("a settled cell already holds the value its position ends with", () => {
  const p = program("bubble-sort");
  const outcome = sequenceOutcomes(p.trace);
  assert.equal(outcome.completed, true);
  const final = outcome.objects.get("o1").items.map((item) => canonicalValue(item));
  const itemsAt = (index) =>
    stateOf(snapshotAt(p.trace, index)).heap.o1.items.map((item) => canonicalValue(item));
  const valuesAt = (index) =>
    stateOf(snapshotAt(p.trace, index)).heap.o1.items.map((item) => item.value);

  // [4, 2, 5, 1, 3]: the trailing 3 is trivially "in order" and 5 is not at the
  // end yet, so no position is claimed until the first pass really finishes.
  assert.deepEqual(settled(planAt(p, 2)), []);
  assert.deepEqual(valuesAt(2), [4, 2, 5, 1, 3]);

  // After pass 1 the array is [2, 4, 1, 3, 5]: 5 is home for good.
  assert.deepEqual(settled(planAt(p, 14)), [4]);
  // After pass 2, [2, 1, 3, 4, 5]: the settled tail has grown to three cells.
  assert.deepEqual(settled(planAt(p, 24)), [2, 3, 4]);
  // The run's own final array, [1, 2, 3, 4, 5], leaves nothing unsettled.
  assert.deepEqual(settled(planAt(p, 29)), [0, 1, 2, 3, 4]);

  for (let index = 0; index < p.trace.length; index += 1) {
    if (!stateOf(snapshotAt(p.trace, index)).heap?.o1?.items) continue;
    const items = itemsAt(index);
    for (const cell of settled(planAt(p, index))) {
      assert.equal(items[cell], final[cell], `step ${index} cell ${cell} is not final`);
    }
  }
});

test("settled cells never lose a position while the run moves toward its outcome", () => {
  const names = [
    "bubble-sort",
    "bubble-duplicates",
    "bubble-negative",
    "insertion-sort",
    "selection-sort",
  ];
  for (const name of names) {
    const p = program(name);
    let previous = new Set();
    for (let index = 0; index < p.trace.length; index += 1) {
      const list = stateOf(snapshotAt(p.trace, index)).heap?.o1;
      // A step that no longer draws the list (the frame that held it returned)
      // proves nothing either way, so the comparison restarts there.
      if (!Array.isArray(list?.items) || list.items.length === 0) {
        previous = new Set();
        continue;
      }
      const current = new Set(settled(planAt(p, index)));
      for (const cell of previous) {
        assert.ok(current.has(cell), `${name} step ${index} forgets settled cell ${cell}`);
      }
      previous = new Set([...previous, ...current]);
    }
  }
});

test("a successful run settles every cell of the list it finishes with", () => {
  for (const name of ["bubble-sort", "insertion-sort", "selection-sort", "builtin-sort"]) {
    const p = program(name);
    const last = lastVisibleIndex(p.trace);
    assert.ok(last > 0, `${name} shows its list at the end`);
    const items = stateOf(snapshotAt(p.trace, last)).heap.o1.items;
    assert.deepEqual(
      settled(planAt(p, last)),
      items.map((_, index) => index),
      `${name} leaves a cell unmarked at its last visible step`,
    );
  }
});

/** The cells a rule that grows from both ends of the row can produce. */
function boundaryShape(cells, length) {
  const has = (cell) => cells.includes(cell);
  let head = 0;
  while (head < length && has(head)) head += 1;
  let tail = length - 1;
  while (tail >= head && has(tail)) tail -= 1;
  const expected = [];
  for (let cell = 0; cell < head; cell += 1) expected.push(cell);
  for (let cell = tail + 1; cell < length; cell += 1) expected.push(cell);
  return expected;
}

test("settled cells always grow in from an end of the row", () => {
  const firstSettled = {};
  for (const name of ["bubble-sort", "insertion-sort", "selection-sort"]) {
    const p = program(name);
    for (let index = 0; index < p.trace.length; index += 1) {
      const items = stateOf(snapshotAt(p.trace, index)).heap?.o1?.items;
      if (!Array.isArray(items) || items.length === 0) continue;
      const cells = settled(planAt(p, index));
      assert.deepEqual(
        cells,
        boundaryShape(cells, items.length),
        `${name} step ${index} settled a cell that does not reach in from an end`,
      );
      if (cells.length > 0 && !firstSettled[name]) firstSettled[name] = cells;
    }
  }

  // A bubble-sort pass settles the tail first; the sorts that carry a sorted
  // run at the front settle the head first. Same rule, different shape.
  assert.deepEqual(firstSettled["bubble-sort"], [4]);
  assert.deepEqual(firstSettled["insertion-sort"], [0, 1]);
  assert.deepEqual(firstSettled["selection-sort"], [0, 1]);
});

test("a duplicate value is settled by position, not by matching the outcome", () => {
  const p = program("bubble-duplicates");
  // [1, 3, 3, 2] with the outcome [1, 2, 3, 3]: only the leading 1 is proven.
  // The 3 sitting at index 2 already equals its final value, but the boundary
  // does not reach it, so it is not marked.
  assert.deepEqual(settled(planAt(p, 6)), [0]);
  const items = stateOf(snapshotAt(p.trace, 6)).heap.o1.items;
  assert.equal(items[2].value, 3, "the unmarked cell really does hold its final value");
  assert.deepEqual(settled(planAt(p, 18)), [0, 1, 2, 3]);
});

test("a run that did not finish proves no outcome at all", () => {
  // A real trace whose last event is an error, with a list on screen.
  const failed = program("sort-mixed");
  assert.equal(sequenceOutcomes(failed.trace).completed, false);
  for (let index = 0; index < failed.trace.length; index += 1) {
    assert.deepEqual(settled(planAt(failed, index)), [], `sort-mixed step ${index}`);
  }

  // Synthetic: a sorted list that was rearranged, then a step limit stopped the
  // run. The final contents are not the program's outcome, so nothing is
  // claimed. No fixture pairs a list with a limit event, which is why this one
  // is built by hand.
  const int = (value) => ({ type: "int", value });
  const event = (step, items) => ({
    step,
    event: "line",
    function: "<module>",
    frame_id: 0,
    line: 1,
    frames: [{ frame_id: 0, function: "<module>", call_line: null, line: 1, variables: {} }],
    heap: { o1: { type: "list", items } },
  });
  const stopped = [
    event(0, [int(2), int(1)]),
    event(1, [int(1), int(2)]),
    { step: 2, event: "step_limit", message: "step limit reached", limit: 1500 },
  ];
  assert.equal(sequenceOutcomes(stopped).completed, false);
  assert.deepEqual(finalizedCells(stateOf(snapshotAt(stopped, 1)), stopped), []);
});

test("an untouched, grown, truncated or unsorted list is never marked", () => {
  const cases = [
    // Already sorted input: the trace never rearranges it, so it proves nothing
    // about the algorithm having settled a position.
    "bubble-sorted",
    // Append-only and mixed-type lists: no in-place rearrangement.
    "list-basics",
    "merge-sort",
    // The visible window is truncated, so no position's outcome is visible.
    "bubble-truncated",
    // The final contents are not in order.
    "list-mutation",
  ];
  for (const name of cases) {
    const p = program(name);
    for (let index = 0; index < p.trace.length; index += 1) {
      assert.deepEqual(settled(planAt(p, index)), [], `${name} step ${index} is marked`);
    }
  }
});

test("the same position proves the same cells however the cursor reached it", () => {
  const p = program("bubble-sort");
  const forward = planAt(p, 24, 23);
  const backward = planAt(p, 24, 25);
  const seek = planAt(p, 24, null);
  assert.deepEqual(backward.finalized, forward.finalized);
  assert.deepEqual(seek.finalized, forward.finalized);

  // Stepping back from a fully settled array must not keep the future cells.
  const at14 = planAt(p, 14, 13);
  assert.deepEqual(settled(at14), [4]);
  const backTo14 = planAt(p, 14, 35);
  assert.equal(settled(planAt(p, 35, 34)).length, 5);
  assert.deepEqual(backTo14.finalized, at14.finalized);
  assert.deepEqual(settled(backTo14), [4]);
});

test("a reset has nothing to show, because the first step proves no outcome", () => {
  for (const name of ["bubble-sort", "insertion-sort", "selection-sort"]) {
    const p = program(name);
    const plan = planMotion(p.trace, 0, { source: p.source, previousIndex: null });
    assert.deepEqual(plan.finalized, [], `${name} step 0`);
  }
});

test("only a list has positional cells, so nothing else can settle", () => {
  for (const name of ["dict-basics", "set-basics", "class-basic"]) {
    const p = program(name);
    for (let index = 0; index < p.trace.length; index += 1) {
      assert.deepEqual(settled(planAt(p, index)), [], `${name} step ${index}`);
    }
  }

  const outcome = { items: [{ type: "int", value: 1 }], sorted: true, rearranged: true };
  assert.deepEqual(
    finalIndices({ type: "list", items: [{ type: "int", value: 1 }], more: 2 }, outcome),
    [],
    "a truncated list never claims a settled position",
  );
  assert.deepEqual(
    finalIndices({ type: "list", items: [{ type: "str", value: "a" }] }, outcome),
    [],
    "a position whose value differs is not settled",
  );
});

test("the evidence is computed once per trace and never mutates it", () => {
  const p = program("bubble-sort");
  const before = JSON.stringify(p.trace);
  const first = sequenceOutcomes(p.trace);
  const second = sequenceOutcomes(p.trace);
  assert.equal(first, second, "the per-trace evidence is cached");
  assert.equal(JSON.stringify(p.trace), before, "the trace is untouched");
});
