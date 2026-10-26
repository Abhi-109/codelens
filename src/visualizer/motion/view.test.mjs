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
import { MOTION_OPERATION, motionNodes, planMotion } from "./plan.js";
import { comparisonOf, MAX_VISIBLE_FRAMES, motionView, returnOf } from "./view.js";

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

/**
 * A sequence state in the shape the tracer records. Booleans, None and nested
 * objects never appear inside a fixture list, so those value kinds are checked
 * on the projection itself; every other case below comes from a real trace.
 */
function sequence(items, heap = {}) {
  return {
    frames: [
      {
        frame_id: 1,
        function: "<module>",
        call_line: null,
        line: 1,
        variables: { a: { type: "ref", id: "o1" } },
      },
    ],
    heap: { o1: { type: "list", items }, ...heap },
  };
}

const cellsOf = (state) =>
  motionNodes(state).objects.find((object) => object.objectId === "o1").slots;

test("a real list draws one cell per item, value over index, with its own key", () => {
  const { plan } = findPlan("bubble-sort", (candidate) =>
    candidate.nodes.objects.some((object) => object.type === "list" && object.slots.length >= 5),
  );
  const list = motionView(plan).objects.find((object) => object.type === "list");
  const items = plan.state.heap[list.objectId].items;

  assert.equal("bars" in list, false, "a sequence has exactly one representation");
  assert.equal(list.slots.length, items.length);
  assert.deepEqual(
    list.slots.map((slot) => slot.index),
    items.map((_, index) => index),
  );
  assert.deepEqual(
    list.slots.map((slot) => slot.label),
    items.map((_, index) => String(index)),
  );
  assert.deepEqual(
    list.slots.map((slot) => slot.key),
    items.map((_, index) => `cell:${list.objectId}:${index}`),
    "keys are positional and stable",
  );
  assert.deepEqual(
    list.slots.map((slot) => slot.text),
    items.map((item) => showValue(item, plan.state.heap)),
  );
  assert.deepEqual(
    list.slots.map((slot) => slot.valueType),
    items.map((item) => item.type),
  );
});

test("cells label strings, booleans, None and references compactly", () => {
  const slots = cellsOf(
    sequence([
      { type: "int", value: 4 },
      { type: "str", value: "a value much too long for one cell" },
      { type: "bool", value: false },
      { type: "none" },
      { type: "ref", id: "o9" },
    ], {
      o9: {
        type: "list",
        items: [
          { type: "int", value: 1 },
          { type: "int", value: 2 },
        ],
      },
    }),
  );

  assert.deepEqual(slots.map((slot) => slot.text), [
    "4",
    '"a value much too long for one cell"',
    "False",
    "None",
    "[1, 2]",
  ]);
  assert.deepEqual(slots.map((slot) => slot.valueType), ["int", "str", "bool", "none", "ref"]);
  assert.deepEqual(
    slots.map((slot) => slot.index),
    [0, 1, 2, 3, 4],
  );
  assert.equal(slots[4].refId, "o9");
  assert.equal(
    slots.filter((slot) => slot.refId).length,
    1,
    "only the reference cell carries a ref id",
  );
});

test("a real nested reference shows the referred object, not just its id", () => {
  const { plan } = findPlan("alias-dict-in-list", (candidate) =>
    candidate.nodes.objects.some(
      (object) => object.type === "list" && object.slots.some((slot) => slot.refId),
    ),
  );
  const list = motionView(plan).objects.find((object) => object.type === "list");
  const cell = list.slots.find((slot) => slot.refId);
  assert.ok(cell, "the fixture really stores a reference in a list");
  assert.equal(
    cell.text,
    showValue({ type: "ref", id: cell.refId }, plan.state.heap),
    "the cell shows what the reference points at",
  );
  assert.notEqual(cell.text, "(not shown at this step)");
});

test("duplicate values keep distinct cells and distinct keys", () => {
  const { plan } = findPlan("bubble-duplicates", (candidate) =>
    candidate.nodes.objects.some((object) => object.type === "list" && object.slots.length >= 4),
  );
  const slots = motionView(plan).objects.find((object) => object.type === "list").slots;
  const keys = slots.map((slot) => slot.key);
  const texts = slots.map((slot) => slot.text);

  assert.equal(new Set(keys).size, keys.length, "no key is shared");
  assert.ok(new Set(texts).size < texts.length, "the fixture really repeats a value");
  assert.deepEqual(
    slots.map((slot) => slot.index),
    texts.map((_, index) => index),
    "duplicates still sit at their own indices",
  );
});

test("an empty sequence draws no cells", () => {
  assert.deepEqual(cellsOf(sequence([])), []);
});

test("cell keys follow the snapshot, so forward, backward and seek agree", () => {
  const p = program("list-basics");
  const index = p.trace.length - 2;
  const plans = [
    planAt(p, index),
    planAt(p, index, { previousIndex: index + 1 }),
    planAt(p, index, { previousIndex: 0 }),
  ];
  const keySets = plans.map((plan) =>
    motionView(plan)
      .objects.flatMap((object) => object.slots.map((slot) => slot.key))
      .join("|"),
  );
  assert.equal(new Set(keySets).size, 1, "direction never changes an identity");
  for (const key of keySets[0].split("|")) {
    assert.match(key, /^cell:o\d+:\d+$/);
  }
});

test("a verified swap moves values between the same positional cells", () => {
  const { plan } = findPlan("bubble-sort", (candidate) =>
    candidate.operations.some(
      (operation) => operation.op === MOTION_OPERATION.move && operation.motion === "swap",
    ),
  );
  const swap = plan.operations.find(
    (operation) => operation.op === MOTION_OPERATION.move && operation.motion === "swap",
  );
  const id = swap.action.target.objectId;
  const [left, right] = swap.action.payload.indices;
  const before = plan.previousState.heap[id].items;
  const after = plan.state.heap[id].items;
  const list = motionView(plan).objects.find((object) => object.objectId === id);

  assert.equal(after[left].value, before[right].value);
  assert.equal(after[right].value, before[left].value);
  assert.equal(list.slots[left].key, `cell:${id}:${left}`, "the cell keeps its identity");
  assert.equal(list.slots[right].key, `cell:${id}:${right}`);
  assert.equal(list.slots[left].text, showValue(after[left], plan.state.heap));
  assert.equal(list.slots[right].text, showValue(after[right], plan.state.heap));
});

const moveOf = (plan, motion) =>
  plan.operations.find(
    (operation) => operation.op === MOTION_OPERATION.move && operation.motion === motion,
  );

const activeCells = (view) => allSlots(view).filter((slot) => slot.active);
const compareCells = (view) => allSlots(view).filter((slot) => slot.compare);
const keysOf = (slots) => slots.map((slot) => slot.key).sort();
const indicesOf = (slots) => slots.map((slot) => slot.index).sort((a, b) => a - b);

test("a verified swap marks exactly its two cells, forward and backward", () => {
  const { p, index, plan } = findPlan("bubble-sort", (candidate) =>
    Boolean(moveOf(candidate, "swap")),
  );
  const swap = moveOf(plan, "swap");
  const [left, right] = swap.action.payload.indices;
  const objectId = swap.action.target.objectId;
  const expected = [`cell:${objectId}:${left}`, `cell:${objectId}:${right}`].sort();

  const forward = activeCells(motionView(plan));
  assert.deepEqual(keysOf(forward), expected);
  assert.deepEqual(indicesOf(forward), [left, right].sort((a, b) => a - b));
  assert.ok(
    forward.every((slot) => slot.active && !slot.changed),
    "a swap rings its cells; it does not relabel them as changed values",
  );

  const backwardPlan = planAt(p, index - 1, { previousIndex: index });
  assert.equal(backwardPlan.transition, "backward");
  const backward = activeCells(motionView(backwardPlan));
  assert.deepEqual(keysOf(backward), expected, "the inverse swap names the same pair");
});

test("a verified shift marks its origin and its destination", () => {
  const { plan } = findPlan("insertion-sort", (candidate) => Boolean(moveOf(candidate, "shift")));
  const shift = moveOf(plan, "shift");
  const [origin, destination] = shift.action.payload.indices;
  const active = activeCells(motionView(plan));

  assert.deepEqual(indicesOf(active), [origin, destination].sort((a, b) => a - b));
  assert.ok(active.every((slot) => slot.objectId === shift.action.target.objectId));
});

test("an insert, a removal and a value change mark only the cell they name", () => {
  const appended = findPlan("list-basics", (candidate) =>
    candidate.operations.some(
      (operation) => operation.op === MOTION_OPERATION.enter && operation.action?.kind === "grow",
    ),
  );
  const grow = appended.plan.operations.find((operation) => operation.action?.kind === "grow");
  const grown = activeCells(motionView(appended.plan));
  assert.equal(grown.length, 1);
  assert.equal(grown[0].index, grow.action.target.index);

  const removed = findPlan("list-mutation", (candidate) =>
    candidate.operations.some(
      (operation) => operation.op === MOTION_OPERATION.exit && operation.action?.kind === "shrink",
    ),
  );
  const shrink = removed.plan.operations.find((operation) => operation.action?.kind === "shrink");
  const removedView = motionView(removed.plan);
  assert.deepEqual(
    activeCells(removedView),
    [],
    "the removed cell is no longer in the target state",
  );
  const leaving = removedView.ghosts.find(
    (ghost) => ghost.kind === "cell" && ghost.node.index === shrink.action.target.index,
  );
  assert.ok(leaving, "the removed cell is drawn as a ghost");
  assert.equal(leaving.active, true, "the leaving cell is the affected one");

  const changed = findPlan("list-mutation", (candidate) =>
    candidate.operations.some(
      (operation) => operation.op === MOTION_OPERATION.value && operation.target?.kind === "cell",
    ),
  );
  const value = changed.plan.operations.find(
    (operation) => operation.op === MOTION_OPERATION.value && operation.target?.kind === "cell",
  );
  const changedCells = activeCells(motionView(changed.plan));
  assert.ok(changedCells.some((slot) => slot.index === value.target.index));
  assert.ok(
    changedCells.every((slot) => slot.changed),
    "a value change is both the active operation and the change flash",
  );
});

test("no recorded operation or comparison means no active cell, on any fixture", () => {
  const held = findPlan(
    "bubble-sort",
    (candidate) => candidate.index > 0 && candidate.operations.length === 0,
  );
  assert.deepEqual(activeCells(motionView(held.plan)), []);
  assert.deepEqual(compareCells(motionView(held.plan)), []);

  for (const name of MATRIX) {
    const p = program(name);
    for (let index = 1; index < p.trace.length; index += 1) {
      const plan = planAt(p, index);
      if (!plan) continue;
      const recordedCompare = new Set(comparisonOf(plan)?.cells ?? []);
      const named = new Set(recordedCompare);
      for (const operation of plan.operations) {
        if (operation.op === MOTION_OPERATION.move) {
          for (const cell of operation.action?.payload?.indices ?? []) {
            named.add(`cell:${operation.target.objectId}:${cell}`);
          }
        } else if (operation.target?.kind === "cell") {
          named.add(operation.targetKey);
        }
      }
      for (const slot of activeCells(motionView(plan))) {
        assert.ok(named.has(slot.key), `${name} step ${index} invents ${slot.key}`);
      }
      for (const slot of compareCells(motionView(plan))) {
        assert.ok(
          recordedCompare.has(slot.key),
          `${name} step ${index} invents comparison cell ${slot.key}`,
        );
      }
    }
  }
});

test("a verified swap reports the real indices and the values that move", () => {
  const { p, index } = findPlan("bubble-sort", (candidate) => Boolean(moveOf(candidate, "swap")));
  const plan = planAt(p, index);
  const view = motionView(plan);
  const swap = moveOf(plan, "swap");
  const [left, right] = swap.action.payload.indices;
  const before = plan.previousState.heap[swap.action.target.objectId].items;

  assert.equal(view.feedback.kind, "swap");
  assert.ok(view.feedback.text.startsWith(`Swap [${left}]`), view.feedback.text);
  assert.ok(view.feedback.text.includes(`↔ [${right}]`), view.feedback.text);
  assert.ok(view.feedback.text.includes(showValue(before[left], plan.previousState.heap)));
  assert.ok(view.feedback.text.includes(showValue(before[right], plan.previousState.heap)));
  assert.equal(
    view.explanation,
    `${showValue(before[left], plan.previousState.heap)} and ${showValue(before[right], plan.previousState.heap)} exchange places.`,
  );

  // Backward playback replays the same verified pair, so it is still a swap.
  const backwardPlan = planMotion(p.trace, index - 1, {
    source: p.source,
    previousIndex: index,
  });
  assert.equal(backwardPlan.transition, "backward");
  const backward = motionView(backwardPlan);
  const backSwap = moveOf(backwardPlan, "swap");
  assert.ok(backSwap, "the inverse of a swap is the same swap");
  assert.deepEqual(backSwap.action.payload.indices, [left, right]);
  assert.equal(backward.feedback.kind, "swap");
  assert.ok(backward.feedback.text.startsWith(`Swap [${left}]`), backward.feedback.text);
  assert.ok(backward.feedback.text.includes(`↔ [${right}]`), backward.feedback.text);
  for (const value of [
    showValue(before[left], plan.previousState.heap),
    showValue(before[right], plan.previousState.heap),
  ]) {
    assert.ok(backward.explanation.includes(value), backward.explanation);
  }
  assert.match(backward.explanation, / exchange places\.$/);
});

test("shifts, appends and removals use the recorded index and value", () => {
  const shifted = findPlan("insertion-sort", (candidate) => Boolean(moveOf(candidate, "shift")));
  const shift = moveOf(shifted.plan, "shift");
  const [origin, destination] = shift.action.payload.indices;
  const shiftView = motionView(shifted.plan);
  assert.equal(shiftView.feedback.kind, "shift");
  assert.equal(
    shiftView.feedback.text,
    `shift [${origin}] ${showValue(shift.action.to, shifted.plan.previousState.heap)} → [${destination}]`,
  );
  assert.equal(
    shiftView.explanation,
    `The value at index ${origin} moves to index ${destination}.`,
  );

  const appended = findPlan("list-basics", (candidate) =>
    candidate.operations.some(
      (operation) => operation.op === MOTION_OPERATION.enter && operation.action?.kind === "grow",
    ),
  );
  const grow = appended.plan.operations.find((operation) => operation.action?.kind === "grow");
  assert.equal(motionView(appended.plan).feedback.kind, "insert");
  assert.ok(
    motionView(appended.plan).feedback.text.startsWith(`append [${grow.action.target.index}]`),
    motionView(appended.plan).feedback.text,
  );

  const removed = findPlan("list-mutation", (candidate) =>
    candidate.operations.some(
      (operation) => operation.op === MOTION_OPERATION.exit && operation.action?.kind === "shrink",
    ),
  );
  const shrink = removed.plan.operations.find((operation) => operation.action?.kind === "shrink");
  assert.equal(motionView(removed.plan).feedback.kind, "remove");
  assert.ok(
    motionView(removed.plan).feedback.text.startsWith(`remove [${shrink.action.target.index}]`),
    motionView(removed.plan).feedback.text,
  );
});

test("value changes, calls and returns say exactly what the trace proves", () => {
  const cellChange = findPlan("list-mutation", (candidate) =>
    candidate.operations.some(
      (operation) => operation.op === MOTION_OPERATION.value && operation.target?.kind === "cell",
    ),
  );
  const cellOp = cellChange.plan.operations.find(
    (operation) => operation.op === MOTION_OPERATION.value && operation.target?.kind === "cell",
  );
  const cellView = motionView(cellChange.plan);
  assert.equal(cellView.feedback.kind, "change");
  assert.ok(cellView.feedback.text.startsWith(`[${cellOp.target.index}] `), cellView.feedback.text);
  assert.ok(cellView.feedback.text.includes("→"), cellView.feedback.text);
  assert.equal(
    cellView.explanation,
    `The value at index ${cellOp.target.index} changed from ${showValue(
      cellOp.action.from,
      cellChange.plan.previousState.heap,
    )} to ${showValue(cellOp.action.to, cellChange.plan.state.heap)}.`,
  );

  const variableChange = findPlan("bubble-sort", (candidate) =>
    candidate.operations.some(
      (operation) =>
        operation.op === MOTION_OPERATION.value && operation.target?.kind === "variable",
    ),
  );
  const variableOp = variableChange.plan.operations.find(
    (operation) =>
      operation.op === MOTION_OPERATION.value && operation.target?.kind === "variable",
  );
  const variableView = motionView(variableChange.plan);
  assert.equal(
    variableView.feedback.kind,
    "neutral",
    "a loop counter is not the operation being taught",
  );
  assert.equal(variableView.feedback.text, "step");
  assert.ok(
    !variableView.feedback.text.includes(variableOp.target.name),
    "the headline never reads like an internal variable chip",
  );
  assert.ok(
    variableView.frames.some((frame) =>
      frame.variables.some((variable) => variable.name === variableOp.target.name),
    ),
    "the variable is still visible in the call strip",
  );

  const called = findPlan("function-basic", (candidate) =>
    candidate.operations.some(
      (operation) => operation.op === MOTION_OPERATION.enter && operation.action?.kind === "call",
    ),
  );
  const callOp = called.plan.operations.find((operation) => operation.action?.kind === "call");
  assert.equal(motionView(called.plan).feedback.kind, "call");
  assert.equal(motionView(called.plan).feedback.text, `call ${callOp.action.payload.function}`);
  assert.equal(
    motionView(called.plan).explanation,
    `${callOp.action.payload.function}() starts running.`,
  );

  const returned = findPlan("function-basic", (candidate) =>
    candidate.operations.some((operation) => operation.action?.kind === "return"),
  );
  assert.equal(motionView(returned.plan).feedback.kind, "return");
  assert.ok(motionView(returned.plan).feedback.text.startsWith("return"));
});

test("a step that changed nothing says so, and no change is ever called a swap", () => {
  const held = findPlan(
    "bubble-sort",
    (candidate) => candidate.index > 0 && candidate.operations.length === 0,
  );
  const view = motionView(held.plan);
  assert.equal(view.feedback.kind, "neutral");
  assert.equal(view.feedback.text, "no data change");

  for (const name of MATRIX) {
    const p = program(name);
    for (let index = 0; index < p.trace.length; index += 1) {
      const plan = planAt(p, index);
      if (!plan) continue;
      const feedback = motionView(plan).feedback;
      assert.ok(feedback && typeof feedback.text === "string", `${name} ${index} has feedback`);
      if (feedback.kind !== "swap") continue;
      assert.ok(
        moveOf(plan, "swap"),
        `${name} step ${index} claims a swap only with a verified swap action`,
      );
    }
  }
});

test("the view carries the source line that ran, verbatim", () => {
  const p = program("bubble-sort");
  const lines = p.source.split(/\r?\n/);
  const index = Math.min(6, p.trace.length - 1);
  const line = snapshotAt(p.trace, index).line;
  const view = motionView(planAt(p, index));

  assert.equal(view.line, line);
  assert.equal(view.lineText, lines[line - 1].trim());
  assert.ok(view.lineText.length > 0, "the head never shows an empty snippet");
});

test("a comparison-looking line never invents a swap or operand highlight", () => {
  const p = program("bubble-sort");
  const lines = p.source.split(/\r?\n/);
  let checked = 0;

  for (let index = 0; index < p.trace.length; index += 1) {
    // A `compare` event is real evidence and is covered by its own tests below.
    if (p.trace[index]?.event === "compare") continue;
    const line = snapshotAt(p.trace, index).line;
    if (!/[<>]=?|==|!=/.test(lines[line - 1] ?? "")) continue;
    checked += 1;
    const view = motionView(planAt(p, index));
    assert.ok(
      !["swap", "shift", "insert", "remove"].includes(view.feedback.kind),
      `step ${index} describes the comparison as a mutation`,
    );
    assert.deepEqual(
      activeCells(view),
      [],
      `step ${index} highlights operands the tracer never recorded`,
    );
  }

  assert.ok(checked > 0, "the fixture really runs comparison lines");
});

function comparePlans(name) {
  const p = program(name);
  const out = [];
  for (let index = 0; index < p.trace.length; index += 1) {
    if (p.trace[index]?.event === "compare") {
      out.push({ p, index, plan: planAt(p, index) });
    }
  }
  return out;
}

test("a recorded comparison rings its cells and reports only what it compared", () => {
  const compares = comparePlans("bubble-sort");
  assert.ok(compares.length > 0, "the fixture records comparisons");

  for (const { p, index, plan } of compares) {
    const event = plan.compareEvent;
    const view = motionView(plan);
    const pair = event.operands
      .map((operand) => showValue(operand.value, event.heap))
      .join(` ${event.operator} `);

    assert.equal(view.feedback.kind, "compare");
    assert.equal(view.feedback.text, `Compare ${pair}${event.result ? " → True" : " → False"}`);
    assert.ok(view.explanation.endsWith("."), view.explanation);
    assert.equal(view.line, event.line, "the head names the compared line");
    assert.equal(view.lineText, p.source.split(/\r?\n/)[event.line - 1].trim());

    // A comparison is not a mutation, even when the next step swaps.
    assert.equal(plan.actions.length, 0, `step ${index} produced actions`);
    assert.deepEqual(view.moves, []);
    assert.deepEqual(view.changed, []);
    assert.deepEqual(view.ghosts, []);
    assert.equal(view.animate, false);
    assert.deepEqual(keysOf(activeCells(view)), [], "a comparison is not the blue operation");

    // Only the operand cells at visible list positions are ringed.
    const expected = event.operands.flatMap((operand) => {
      const cell = operand.cell;
      if (!cell || !Number.isInteger(cell.index) || cell.index < 0) return [];
      const object = plan.state.heap[cell.object_id];
      if (!object || !["list", "tuple"].includes(object.type)) return [];
      if (cell.index >= object.items.length) return [];
      return [`cell:${cell.object_id}:${cell.index}`];
    });
    assert.deepEqual(keysOf(compareCells(view)), [...new Set(expected)].sort());
  }

  assert.equal(
    motionView(compares[0].plan).explanation,
    "4 is greater than 2.",
    "the sentence is built from the recorded operands and operator",
  );
  const falseCompare = compares.find(({ plan }) => plan.compareEvent.result === false);
  assert.equal(motionView(falseCompare.plan).explanation, "4 is not greater than 5.");
});

test("a comparison is gold evidence, a swap is the blue operation", () => {
  const compare = comparePlans("bubble-sort")[0];
  const compareView = motionView(compare.plan);
  assert.deepEqual(keysOf(activeCells(compareView)), [], "a compare step is never a swap");
  assert.ok(compareCells(compareView).length > 0, "the operands are ringed");

  const { plan } = findPlan("bubble-sort", (candidate) => Boolean(moveOf(candidate, "swap")));
  const swapView = motionView(plan);
  assert.deepEqual(compareCells(swapView), [], "a swap carries no comparison ring");
  assert.ok(activeCells(swapView).length > 0, "the swapped cells are the operation");
});

test("a comparison with no recorded verdict invents no answer", () => {
  const nullResult = comparePlans("sort-mixed").find(
    ({ plan }) => plan.compareEvent.result === null,
  );
  assert.ok(nullResult, "the fixture records a comparison that raised");
  const view = motionView(nullResult.plan);
  assert.equal(view.feedback.kind, "compare");
  assert.ok(!view.feedback.text.includes("→"), view.feedback.text);
  assert.match(view.explanation, /produced no True or False\.$/);
  assert.deepEqual(keysOf(compareCells(view)), ["cell:o1:0", "cell:o1:1"]);
});

test("a comparison prints a referenced operand from its own recorded heap", () => {
  const p = program("set-basics");
  const found = p.trace.findIndex(
    (event) => event?.event === "compare" && event.operands.some((operand) => operand.value?.type === "ref"),
  );
  assert.notEqual(found, -1, "the fixture compares against a referenced set");
  const event = p.trace[found];
  const pair = event.operands
    .map((operand) => showValue(operand.value, event.heap))
    .join(` ${event.operator} `);
  const view = motionView(planAt(p, found));

  assert.ok(view.feedback.text.includes(pair), view.feedback.text);
  assert.match(view.explanation, / is in /);
  assert.deepEqual(
    compareCells(view),
    [],
    "a membership operand has no cell, so nothing is ringed",
  );
});

test("backward playback and seeking reconstruct the same comparison", () => {
  const { p, index, plan } = comparePlans("bubble-sort")[0];
  const expected = motionView(plan);
  for (const previousIndex of [index + 1, 0, index]) {
    const other = motionView(planAt(p, index, { previousIndex }));
    assert.equal(other.feedback.kind, "compare");
    assert.equal(other.feedback.text, expected.feedback.text);
    assert.equal(other.explanation, expected.explanation);
    assert.deepEqual(keysOf(compareCells(other)), keysOf(compareCells(expected)));
    assert.deepEqual(other.moves, []);
    assert.deepEqual(other.changed, []);
  }
});

test("a comparison never rings a cell its own evidence cannot place", () => {
  const base = comparePlans("bubble-sort")[0].plan;
  const event = base.compareEvent;
  const second = `cell:${event.operands[1].cell.object_id}:${event.operands[1].cell.index}`;
  const withFirstCell = (cell) => ({
    ...base,
    compareEvent: {
      ...event,
      operands: [{ ...event.operands[0], cell }, event.operands[1]],
    },
  });
  const compare = (cell) => keysOf(compareCells(motionView(withFirstCell(cell))));

  assert.deepEqual(compare(null), [second], "a scalar operand names no cell");
  assert.deepEqual(compare({ object_id: "o1", index: -1 }), [second]);
  assert.deepEqual(compare({ object_id: "o1", index: 1.5 }), [second]);
  assert.deepEqual(compare({ object_id: "o999", index: 0 }), [second]);
  assert.deepEqual(compare({ object_id: "o1", index: 999 }), [second]);
  assert.deepEqual(
    compare(event.operands[0].cell),
    keysOf(compareCells(motionView(base))),
    "the untouched evidence still rings both cells",
  );
});

test("a comparison step establishes no finality of its own", () => {
  for (const { p, index, plan } of comparePlans("bubble-sort")) {
    const before = planAt(p, index - 1);
    assert.deepEqual(plan.finalized, before.finalized, `step ${index} changed finality`);
    assert.deepEqual(plan.stateActions, [], `step ${index} changed state`);
  }
});

test("a settled cell is flagged on the exact slot the plan proves", () => {
  for (const name of MATRIX) {
    const p = program(name);
    for (let index = 0; index < p.trace.length; index += 1) {
      const plan = planAt(p, index);
      if (!plan) continue;
      const view = motionView(plan);
      const proven = new Set(
        plan.finalized.flatMap((group) =>
          group.indices.map((cell) => `cell:${group.objectId}:${cell}`),
        ),
      );
      const flagged = allSlots(view).filter((slot) => slot.settled);
      assert.deepEqual(
        new Set(flagged.map((slot) => slot.key)),
        proven,
        `${name} step ${index} flags cells the recording did not prove`,
      );
      for (const slot of flagged) {
        assert.equal(slot.kind, "cell", `${name} step ${index} settled a non-cell`);
        assert.equal(slot.container, "list", `${name} step ${index} settled a non-list`);
      }
    }
  }
});

test("a settled position survives the swap that follows it", () => {
  const { p, index, plan } = findPlan(
    "bubble-sort",
    (candidate) =>
      Boolean(moveOf(candidate, "swap")) &&
      candidate.finalized.some((group) => group.indices.length > 0),
  );
  const view = motionView(plan);
  const swap = moveOf(plan, "swap");
  const [left, right] = swap.action.payload.indices;
  const active = activeCells(view).map((slot) => slot.key);

  // The operation is exactly the pair the diff verified, and the position an
  // earlier pass settled is still green beside it.
  assert.deepEqual(new Set(active), new Set([`cell:o1:${left}`, `cell:o1:${right}`]));
  const settled = allSlots(view).filter((slot) => slot.settled);
  assert.ok(settled.length > 0, "the previous pass's positions are still marked");
  // This first proven swap is the one that puts a value into the place it ends
  // in, so the same cell is both the operation and settled. Both flags stay
  // set: the operation takes the blue ring, the settled green keeps the index.
  assert.ok(
    settled.some((slot) => active.includes(slot.key)),
    "a swap that completes a position carries both marks",
  );

  // The mark is not a one-step flash: the following step keeps it.
  const next = motionView(planAt(p, index + 1));
  const nextSettled = new Set(allSlots(next).filter((slot) => slot.settled).map((slot) => slot.key));
  for (const slot of settled) {
    assert.ok(nextSettled.has(slot.key), `step ${index + 1} lost the settled ${slot.key}`);
  }
});

test("a returned value rides on the frame the recording returned from", () => {
  const at = findPlan("function-print-return", (plan) => returnOf(plan) !== null);
  const returned = returnOf(at.plan);
  assert.equal(returned.function, "report");
  assert.equal(returned.text, "42");

  const view = motionView(at.plan);
  const frame = view.frames.find((candidate) => candidate.returned !== null);
  assert.ok(frame, "the returning frame is on screen at its return step");
  assert.equal(frame.function, "report");
  assert.equal(frame.returned.text, "42");
  assert.equal(
    view.frames.filter((candidate) => candidate.returned !== null).length,
    1,
    "only the frame the recording names carries the value",
  );
  assert.equal(view.feedback.kind, "return");
  assert.equal(view.feedback.text, "return 42");
});

test("a call step that hands nothing back still says it returned", () => {
  const at = findPlan("recursion", (plan) => {
    const returned = returnOf(plan);
    return returned !== null && returned.function === "<module>";
  });
  const view = motionView(at.plan);
  assert.equal(returnOf(at.plan).text, "None");
  assert.match(view.feedback.text, /^return/);
});

test("nested calls carry the recorded stack depth, deepest last and current", () => {
  const at = findPlan("recursion", (plan) => plan.nodes.frames.length >= 3);
  const view = motionView(at.plan);
  assert.deepEqual(
    view.frames.map((frame) => frame.depth),
    view.frames.map((_, index) => index),
    "depth is the frame's position in the recorded stack",
  );
  assert.equal(view.frames[0].function, "<module>");
  assert.ok(view.frames.slice(1).every((frame) => frame.function === "fact"));
  assert.equal(
    view.frames.filter((frame) => frame.current).length,
    1,
    "exactly one frame is running",
  );
  assert.equal(view.frames.at(-1).current, true);
});

test("a deep call stack keeps the most recent frames and counts the rest", () => {
  const at = findPlan("recursive-deep", (plan) => plan.nodes.frames.length > MAX_VISIBLE_FRAMES);
  const view = motionView(at.plan);
  assert.equal(view.frames.length, MAX_VISIBLE_FRAMES);
  assert.equal(view.framesHidden, at.plan.nodes.frames.length - MAX_VISIBLE_FRAMES);
  assert.ok(view.framesHidden > 0);
  assert.deepEqual(
    view.frames.map((frame) => frame.frameId),
    at.plan.nodes.frames.slice(-MAX_VISIBLE_FRAMES).map((frame) => frame.frameId),
    "the deepest, most recent calls are the ones kept",
  );
  assert.equal(view.frames.at(-1).current, true);
});

test("an exception says whether a handler catches it", () => {
  const handled = findPlan(
    "exception-custom",
    (plan) => plan.event === "exception" && plan.exceptionOutcome === "handled",
  );
  const caught = motionView(handled.plan).feedback;
  assert.equal(caught.kind, "error");
  assert.equal(caught.text, "Raises TooBig");
  assert.match(caught.explanation, /catches it, so the program can continue/);

  const propagated = findPlan(
    "exception-custom",
    (plan) => plan.event === "exception" && plan.exceptionOutcome === "propagated",
  );
  assert.match(
    motionView(propagated.plan).feedback.explanation,
    /No handler caught it here, so it passes outward/,
  );

  const uncaught = findPlan(
    "error-division",
    (plan) => plan.event === "exception" && plan.exceptionOutcome === "uncaught",
  );
  const stopped = motionView(uncaught.plan).feedback;
  assert.equal(stopped.text, "Raises ZeroDivisionError");
  assert.match(stopped.explanation, /Nothing catches it, so the run ends/);
});

test("an unwind and the final error name the frame and the stop", () => {
  const unwind = findPlan("error-division", (plan) => plan.event === "unwind");
  const leaving = motionView(unwind.plan).feedback;
  assert.equal(leaving.kind, "error");
  assert.equal(leaving.text, "Error leaves divide");
  assert.match(leaving.explanation, /passes out of divide\(\), so that call stops without finishing/);

  const end = findPlan("error-division", (plan) => plan.event === "error");
  const stopped = motionView(end.plan).feedback;
  assert.equal(stopped.kind, "error");
  assert.equal(stopped.text, "Stops: ZeroDivisionError");
  assert.match(stopped.explanation, /The run ended with ZeroDivisionError/);
});

test("a seeked step still names its exception and its return value", () => {
  // A seek has no transition actions, so these facts must come from the
  // recorded event itself or the step would go blank on the way back.
  const p = program("exception-custom");
  const exceptionIndex = p.trace.findIndex(
    (event, index) => event.event === "exception" && index === 15,
  );
  const exceptionPlan = planMotion(p.trace, exceptionIndex, {
    source: p.source,
    previousIndex: null,
  });
  const caught = motionView(exceptionPlan).feedback;
  assert.equal(caught.text, "Raises TooBig");
  assert.match(caught.explanation, /catches it/);

  const q = program("function-print-return");
  const returnIndex = q.trace.findIndex((event) => event.event === "return");
  const returnPlan = planMotion(q.trace, returnIndex, { source: q.source, previousIndex: null });
  assert.equal(returnOf(returnPlan).text, "42");
  const view = motionView(returnPlan);
  assert.equal(view.feedback.text, "return 42");
  assert.equal(
    view.frames.find((frame) => frame.function === "report")?.returned?.text,
    "42",
  );
});

test("a seeked mutation still names its step without replaying it", () => {
  // Jumping straight to a swap plans no animation, but "no data change" would
  // be a false statement about a step the recording says swapped two values.
  const p = program("bubble-sort");
  let swapIndex = -1;
  for (let index = 2; index < p.trace.length; index += 1) {
    if (motionView(planAt(p, index)).feedback?.kind === "swap") {
      swapIndex = index;
      break;
    }
  }
  assert.ok(swapIndex > 0, "the fixture has a real swap to seek to");

  const seek = planMotion(p.trace, swapIndex, { source: p.source, previousIndex: 0 });
  assert.equal(seek.transition, "seek");
  assert.deepEqual(seek.operations, [], "a seek still plans no animation");
  assert.equal(seek.animate, false);
  const view = motionView(seek);
  assert.equal(view.feedback.kind, "swap");
  assert.match(view.feedback.text, /^Swap \[\d+\] /);

  // A seeked step that really changed nothing keeps saying so.
  const quiet = findPlan(
    "bubble-sort",
    (candidate) =>
      candidate &&
      candidate.index > 2 &&
      motionView(candidate).feedback?.text === "no data change",
  );
  const quietSeek = planMotion(p.trace, quiet.index, { source: p.source, previousIndex: 0 });
  assert.equal(motionView(quietSeek).feedback.kind, "neutral");
  assert.equal(motionView(quietSeek).feedback.text, "no data change");
});

test("a scalar-only program keeps its values in the call strip", () => {
  const at = findPlan(
    "recursion",
    (plan) =>
      plan.nodes.objects.length === 0 &&
      plan.nodes.frames.some((frame) => frame.variables.some((variable) => variable.name === "n")),
  );
  const view = motionView(at.plan);
  assert.equal(view.objects.length, 0);
  const scalar = view.frames
    .flatMap((frame) => frame.variables)
    .find((variable) => variable.name === "n");
  assert.ok(scalar, "the scalar argument is on screen in a frame");
  assert.equal(scalar.valueType, "int");
});
