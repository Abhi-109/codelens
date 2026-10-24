// Stage 2's renderer model: every flag and ghost comes from a real plan built
// from a real trace and its verified actions. No algorithm names, no synthetic
// Bubble Sort sequence.
//
//   node --test src/visualizer/motion/view.test.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";

import { snapshotAt, stateOf } from "../../animation/diff.js";
import { showValue } from "../../tracer/values.js";
import { numericBars } from "./bars.js";
import { MOTION_OPERATION, motionNodes, planMotion } from "./plan.js";
import { motionView } from "./view.js";

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

const MATRIX = [
  "list-mutation",
  "dict-basics",
  "set-basics",
  "class-basic",
  "recursion",
  "function-print-return",
  "exception-custom",
  "error-division",
  "comprehension",
  "bubble-sort",
  "insertion-sort",
  "selection-sort",
  "bubble-truncated",
];

function planAt(p, index, options = {}) {
  return planMotion(p.trace, index, {
    source: p.source,
    previousIndex: index === 0 ? null : index - 1,
    ...options,
  });
}

function viewKeys(view) {
  const keys = [];
  for (const frame of view.frames) {
    keys.push(frame.key, ...frame.variables.map((variable) => variable.key));
  }
  for (const object of view.objects) {
    keys.push(object.key, ...object.slots.map((slot) => slot.key));
  }
  return keys;
}

function allSlots(view) {
  return view.objects.flatMap((object) => object.slots);
}

function findPlan(name, predicate) {
  const p = program(name);
  for (let index = 0; index < p.trace.length; index += 1) {
    const plan = planAt(p, index);
    if (plan && predicate(plan, p, index)) return { p, index, plan };
  }
  assert.fail(`${name} has no plan matching the requested real action`);
}

test("every live action marks the exact element the target snapshot contains", () => {
  for (const name of MATRIX) {
    const p = program(name);
    for (let index = 0; index < p.trace.length; index += 1) {
      const plan = planAt(p, index);
      if (!plan) continue;
      const view = motionView(plan);
      assert.ok(view, `${name} step ${index} has a view`);
      const keys = viewKeys(view);
      assert.equal(new Set(keys).size, keys.length, `${name} step ${index} keys are unique`);

      for (const operation of plan.operations) {
        if (operation.op === MOTION_OPERATION.overlay) continue;
        assert.ok(operation.targetKey, `${name} step ${index} ${operation.op} names a target`);

        if (operation.op === MOTION_OPERATION.exit) {
          if (!plan.animate) continue;
          const ghost = view.ghosts.find(
            (candidate) => candidate.key === operation.targetKey,
          );
          assert.ok(ghost, `${name} step ${index} exits ${operation.targetKey}`);
          assert.equal(ghost.node.kind, operation.target.kind);
          continue;
        }

        assert.ok(
          keys.includes(operation.targetKey),
          `${name} step ${index} ${operation.op} targets a live element`,
        );
      }

      for (const key of view.entering) {
        assert.ok(keys.includes(key), `${name} step ${index} entering ${key} is live`);
      }
      for (const key of view.changed) {
        assert.ok(keys.includes(key), `${name} step ${index} changed ${key} is live`);
      }
      for (const key of view.highlighted) {
        assert.ok(keys.includes(key), `${name} step ${index} highlight ${key} is live`);
      }
      for (const move of view.moves) {
        assert.ok(keys.includes(move.key), `${name} step ${index} move ${move.key} is live`);
      }
      for (const ghost of view.ghosts) {
        assert.ok(
          plan.previousState,
          `${name} step ${index} ghost comes from a recorded previous state`,
        );
        const before = motionNodes(plan.previousState);
        const previousKeys = [];
        for (const frame of before.frames) {
          previousKeys.push(frame.key, ...frame.variables.map((item) => item.key));
        }
        for (const object of before.objects) {
          previousKeys.push(object.key, ...object.slots.map((item) => item.key));
        }
        assert.ok(previousKeys.includes(ghost.key), `${name} step ${index} ghost was real`);
      }
    }
  }
});

test("the view is a copy and replaying it is deterministic", () => {
  const { plan } = findPlan("bubble-sort", (candidate) =>
    candidate.operations.some((operation) => operation.op === MOTION_OPERATION.move),
  );
  const before = JSON.stringify(plan.nodes);
  const first = motionView(plan);
  const second = motionView(plan);
  assert.equal(JSON.stringify(plan.nodes), before, "the plan's live model was not mutated");
  assert.deepEqual(first, second);
  assert.notEqual(first.objects, plan.nodes.objects, "objects are copied");
});

test("a real swap maps both cells to one verified index pair", () => {
  const { p, index, plan } = findPlan("bubble-sort", (candidate) =>
    candidate.operations.some(
      (operation) =>
        operation.op === MOTION_OPERATION.move &&
        operation.motion === "swap" &&
        operation.action?.payload?.indices?.length === 2,
    ),
  );
  const view = motionView(plan);
  const swap = view.moves.find((move) => move.motion === "swap");
  assert.ok(swap);
  assert.deepEqual(
    swap.indices,
    plan.operations.find((operation) => operation.motion === "swap").action.payload.indices,
  );
  const [i, j] = swap.indices;
  const slots = allSlots(view);
  assert.ok(slots.some((slot) => slot.index === i));
  assert.ok(slots.some((slot) => slot.index === j));
  assert.deepEqual(plan.state, stateOf(snapshotAt(p.trace, index)));
});

test("a real append enters the new positional cell; a delete keeps the old value as a ghost", () => {
  const appended = findPlan("list-basics", (candidate) =>
    candidate.operations.some(
      (operation) =>
        operation.op === MOTION_OPERATION.enter &&
        operation.action?.kind === "grow" &&
        operation.action?.target?.kind === "cell",
    ),
  );
  const appendView = motionView(appended.plan);
  const grow = appended.plan.operations.find(
    (operation) => operation.action?.kind === "grow" && operation.target?.kind === "cell",
  );
  const newCell = allSlots(appendView).find((slot) => slot.key === grow.targetKey);
  assert.ok(newCell, "the grown cell is in the target state");
  assert.equal(newCell.entering, true);
  assert.equal(newCell.text, showValue(grow.action.to, appended.plan.state.heap));

  const deleted = findPlan("list-mutation", (candidate) =>
    candidate.operations.some(
      (operation) =>
        operation.op === MOTION_OPERATION.exit &&
        operation.action?.kind === "shrink" &&
        operation.action?.target?.kind === "cell",
    ),
  );
  const deleteView = motionView(deleted.plan);
  const shrink = deleted.plan.operations.find(
    (operation) => operation.action?.kind === "shrink" && operation.target?.kind === "cell",
  );
  const ghost = deleteView.ghosts.find((candidate) => candidate.key === shrink.targetKey);
  assert.ok(ghost, "the removed cell keeps a ghost");
  assert.deepEqual(ghost.node.value, shrink.action.from);
  assert.equal(
    ghost.node.text,
    showValue(shrink.action.from, deleted.plan.previousState.heap),
    "the ghost shows the recorded previous value, not a target value",
  );
});

test("a real value change marks the stable key and never invents a move", () => {
  const { plan } = findPlan("dict-basics", (candidate) =>
    candidate.operations.some(
      (operation) =>
        operation.op === MOTION_OPERATION.value && operation.target?.kind === "entry",
    ),
  );
  const view = motionView(plan);
  const change = plan.operations.find(
    (operation) =>
      operation.op === MOTION_OPERATION.value && operation.target?.kind === "entry",
  );
  const entry = allSlots(view).find((slot) => slot.key === change.targetKey);
  assert.ok(entry);
  assert.equal(entry.changed, true);
  assert.equal(entry.text, showValue(change.action.to, plan.state.heap));
  assert.equal(view.moves.length, 0, "a dictionary value change is not a movement");
});

test("a real call and return enter and remove a frame node", () => {
  const entered = findPlan("recursion", (candidate) =>
    candidate.operations.some(
      (operation) =>
        operation.op === MOTION_OPERATION.enter && operation.target?.kind === "frame",
    ),
  );
  const enterView = motionView(entered.plan);
  const call = entered.plan.operations.find(
    (operation) =>
      operation.op === MOTION_OPERATION.enter && operation.target?.kind === "frame",
  );
  assert.equal(
    enterView.frames.find((frame) => frame.key === call.targetKey)?.entering,
    true,
  );

  const left = findPlan("recursion", (candidate) =>
    candidate.operations.some(
      (operation) =>
        operation.op === MOTION_OPERATION.exit && operation.target?.kind === "frame",
    ),
  );
  const exitView = motionView(left.plan);
  const vanish = left.plan.operations.find(
    (operation) =>
      operation.op === MOTION_OPERATION.exit && operation.target?.kind === "frame",
  );
  const ghost = exitView.ghosts.find((candidate) => candidate.key === vanish.targetKey);
  assert.ok(ghost);
  assert.equal(ghost.kind, "frame");
  assert.equal(ghost.node.function, vanish.action.from?.function);
});

test("a real object appears or disappears as a whole card", () => {
  const entered = findPlan("class-basic", (candidate) =>
    candidate.operations.some(
      (operation) =>
        operation.op === MOTION_OPERATION.enter && operation.target?.kind === "object",
    ),
  );
  const enterView = motionView(entered.plan);
  const appear = entered.plan.operations.find(
    (operation) =>
      operation.op === MOTION_OPERATION.enter && operation.target?.kind === "object",
  );
  assert.equal(
    enterView.objects.find((object) => object.key === appear.targetKey)?.entering,
    true,
  );

  const left = findPlan("exception-custom", (candidate) =>
    candidate.operations.some(
      (operation) =>
        operation.op === MOTION_OPERATION.exit && operation.target?.kind === "object",
    ),
  );
  const exitView = motionView(left.plan);
  const vanish = left.plan.operations.find(
    (operation) =>
      operation.op === MOTION_OPERATION.exit && operation.target?.kind === "object",
  );
  const ghost = exitView.ghosts.find((candidate) => candidate.key === vanish.targetKey);
  assert.ok(ghost);
  assert.equal(ghost.kind, "object");
  assert.equal(ghost.node.objectId, vanish.target.objectId);
  assert.equal(typeof ghost.node.label, "string");
});

test("highlights are static state; reduced motion removes every ghost", () => {
  // Synthetic highlight only: none of the corpus fixtures currently emits the
  // fallback highlight action. The plan and its node still come from a real
  // trace; only the one operation is substituted so the render map is covered.
  const base = planAt(program("list-basics"), 3);
  const slotKey = base.nodes.objects[0].slots[0].key;
  const highlighted = motionView({
    ...base,
    operations: [
      {
        ...base.operations[0],
        op: MOTION_OPERATION.highlight,
        targetKey: slotKey,
        target: { kind: "cell", objectId: base.nodes.objects[0].objectId, index: 0 },
      },
    ],
  });
  assert.deepEqual(highlighted.highlighted, [slotKey]);
  assert.equal(highlighted.objects[0].slots[0].highlighted, true);

  const removed = findPlan("list-mutation", (candidate) =>
    candidate.operations.some(
      (operation) => operation.op === MOTION_OPERATION.exit,
    ),
  );
  const reducedPlan = planAt(removed.p, removed.index, { reducedMotion: true });
  const reducedView = motionView(reducedPlan);
  assert.equal(reducedView.animate, false);
  assert.equal(reducedView.mode, "reduced");
  assert.deepEqual(reducedView.ghosts, [], "nothing leaves after the target is already drawn");
});

const near = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} ≈ ${expected}`);

const numberSlot = (index, value, extra = {}) => ({
  key: `cell:o1:${index}`,
  index,
  text: String(value),
  valueType: Number.isInteger(value) ? "int" : "float",
  value: { type: Number.isInteger(value) ? "int" : "float", value },
  ...extra,
});

test("numeric bars scale positives, zero and equal values from a real baseline", () => {
  const positive = numericBars([numberSlot(0, 4), numberSlot(1, 2), numberSlot(2, 5)]);
  assert.equal(positive.min, 0);
  assert.equal(positive.max, 5);
  assert.equal(positive.zero, 0);
  assert.deepEqual(positive.cells.map((cell) => cell.from), [0, 0, 0]);
  near(positive.cells[0].size, 0.8, "4 of 5");
  near(positive.cells[1].size, 0.4, "2 of 5");
  near(positive.cells[2].size, 1, "5 of 5");

  const zeros = numericBars([numberSlot(0, 0), numberSlot(1, 0)]);
  assert.deepEqual(zeros.cells.map((cell) => cell.size), [0, 0]);
  assert.equal(zeros.zero, 0, "an all-zero list keeps the baseline at the bottom");

  const equal = numericBars([numberSlot(0, 3), numberSlot(1, 3), numberSlot(2, 3)]);
  assert.deepEqual(equal.cells.map((cell) => cell.size), [1, 1, 1]);
  assert.deepEqual(equal.cells.map((cell) => cell.from), [0, 0, 0]);

  const single = numericBars([numberSlot(0, 7)]);
  assert.equal(single.cells.length, 1);
  near(single.cells[0].size, 1, "a single positive value fills the plot");
});

test("numeric bars hang below the baseline for negatives and mixed signs", () => {
  const negative = numericBars([numberSlot(0, -4), numberSlot(1, -2)]);
  assert.equal(negative.min, -4);
  assert.equal(negative.max, 0);
  assert.equal(negative.zero, 1, "the baseline is the top of the plot");
  assert.deepEqual(negative.cells.map((cell) => cell.from), [0, 0.5]);
  near(negative.cells[0].size, 1, "-4 fills the plot downward");
  near(negative.cells[1].size, 0.5, "-2 fills half of it");

  const mixed = numericBars([numberSlot(0, -2), numberSlot(1, 5)]);
  assert.equal(mixed.min, -2);
  assert.equal(mixed.max, 5);
  near(mixed.zero, 2 / 7, "zero sits two sevenths up");
  near(mixed.cells[0].from, 0, "the negative bar starts at the bottom");
  near(mixed.cells[0].size, 2 / 7, "and ends at zero");
  near(mixed.cells[1].from, 2 / 7, "the positive bar starts at zero");
  near(mixed.cells[1].size, 5 / 7, "and ends at the top");

  const float = numericBars([numberSlot(0, 1.5), numberSlot(1, -0.5)]);
  assert.equal(float.cells.length, 2, "floats are numbers too");
});

test("numeric bars refuse empty, mixed, boolean and reference contents", () => {
  assert.equal(numericBars([]), null);
  assert.equal(numericBars(null), null);
  assert.equal(numericBars([numberSlot(0, 1), { ...numberSlot(1, 2), valueType: "str" }]), null);
  assert.equal(
    numericBars([{ ...numberSlot(0, 1), valueType: "bool", value: { type: "bool", value: true } }]),
    null,
  );
  assert.equal(
    numericBars([{ ...numberSlot(0, 1), valueType: "ref", value: { type: "ref", id: "o2" } }]),
    null,
  );
  assert.equal(numericBars([{ ...numberSlot(0, 1), value: { type: "int", value: NaN } }]), null);
});

test("numeric bars keep the exact slot keys, so verified swaps still match", () => {
  const slots = [numberSlot(0, 4), numberSlot(1, 2)];
  assert.deepEqual(
    numericBars(slots).cells.map((cell) => cell.key),
    slots.map((slot) => slot.key),
  );

  const swapped = findPlan("bubble-sort", (candidate) =>
    candidate.operations.some((operation) => operation.motion === "swap"),
  );
  const view = motionView(swapped.plan);
  const list = view.objects.find((object) => object.bars);
  assert.ok(list, "bubble-sort carries a numeric list");
  assert.deepEqual(
    list.bars.cells.map((cell) => cell.key),
    list.slots.map((slot) => slot.key),
    "bars are the same identities the cell view would have drawn",
  );
  assert.deepEqual(
    list.bars.cells.map((cell) => cell.value),
    list.slots.map((slot) => slot.value.value),
  );

  const swap = view.moves.find((move) => move.motion === "swap");
  assert.ok(swap);
  for (const index of swap.indices) {
    assert.ok(
      list.bars.cells.some((cell) => cell.index === index),
      `swap index ${index} is a bar`,
    );
    assert.ok(
      list.slots.some((slot) => slot.index === index),
      `swap index ${index} is a registered slot`,
    );
  }
});

test("a real shift keeps the destination bar, and a seek shows the same bars", () => {
  const shifted = findPlan("insertion-sort", (candidate) =>
    candidate.operations.some((operation) => operation.motion === "shift"),
  );
  const view = motionView(shifted.plan);
  const list = view.objects.find((object) => object.bars);
  assert.ok(list, "insertion-sort carries a numeric list");
  const shift = view.moves.find((move) => move.motion === "shift");
  assert.ok(shift);
  const destination = shift.indices[1];
  assert.ok(list.bars.cells.some((cell) => cell.index === destination));

  const seekPlan = planAt(shifted.p, shifted.index, { previousIndex: shifted.index - 2 });
  assert.equal(seekPlan.transition, "seek");
  assert.deepEqual(
    motionView(seekPlan).objects.find((object) => object.bars)?.bars,
    list.bars,
    "a seek renders the same projection as arriving forward",
  );
});

test("non-numeric collections keep their existing cell representation", () => {
  const strings = findPlan("list-basics", (candidate) =>
    candidate.nodes.objects.some((object) => object.type === "list"),
  );
  const stringList = motionView(strings.plan).objects.find((object) => object.type === "list");
  assert.ok(stringList);
  assert.equal(stringList.bars, null);
  assert.ok(stringList.slots.length > 0, "string cells are still drawn");

  const dict = findPlan("dict-basics", (candidate) =>
    candidate.nodes.objects.some((object) => object.type === "dict"),
  );
  const entries = motionView(dict.plan).objects.find((object) => object.type === "dict");
  assert.ok(entries);
  assert.equal(entries.bars, null);
});
