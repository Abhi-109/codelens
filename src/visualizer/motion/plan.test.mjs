// Stage 1's motion foundation: the plan is derived from real snapshots and
// verified actions, never from an algorithm name or a guessed intermediate.
// These tests run in Node, with no DOM and no clock.
//
//   node --test src/visualizer/motion/plan.test.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";

import { applyState, reverseActions, snapshotAt, stateOf } from "../../animation/diff.js";
import {
  MOTION_MODE,
  MOTION_OPERATION,
  MOTION_TRANSITION,
  createMotionController,
  motionDuration,
  motionNodes,
  motionTargetKey,
  planMotion,
} from "./plan.js";

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

function allNodeKeys(nodes) {
  const keys = [];
  for (const frame of nodes.frames) {
    keys.push(frame.key, ...frame.variables.map((variable) => variable.key));
  }
  for (const object of nodes.objects) {
    keys.push(object.key, ...object.slots.map((slot) => slot.key));
  }
  return keys;
}

function planAt(program, index, options = {}) {
  return planMotion(program.trace, index, {
    source: program.source,
    previousIndex: index === 0 ? null : index - 1,
    ...options,
  });
}

test("real transitions produce exact target states and reversible action plans", () => {
  for (const name of MATRIX) {
    const p = program(name);
    for (let index = 0; index < p.trace.length; index += 1) {
      const plan = planAt(p, index);
      const target = stateOf(snapshotAt(p.trace, index));
      assert.ok(plan, `${name} step ${index} has a plan`);
      assert.deepEqual(plan.state, target, `${name} step ${index} state is exact`);
      assert.equal(plan.nodes.objects.length, Object.keys(target.heap).length);
      const keys = allNodeKeys(plan.nodes);
      assert.equal(new Set(keys).size, keys.length, `${name} step ${index} node keys are unique`);

      if (index === 0) {
        assert.equal(plan.transition, MOTION_TRANSITION.initial);
        assert.deepEqual(plan.actions, []);
        continue;
      }
      assert.equal(plan.transition, MOTION_TRANSITION.forward);
      assert.deepEqual(
        applyState(plan.previousState, plan.stateActions),
        plan.state,
        `${name} step ${index} applies to the recorded target`,
      );
      assert.deepEqual(
        applyState(plan.state, reverseActions(plan.stateActions, plan.state)),
        plan.previousState,
        `${name} step ${index} reverses to the recorded source`,
      );
      for (const operation of plan.operations) {
        if (operation.op === MOTION_OPERATION.exit || operation.targetKey === "console") continue;
        assert.ok(
          keys.includes(operation.targetKey),
          `${name} step ${index} operation target ${operation.targetKey} is a rendered node`,
        );
      }
    }
  }
});

test("backward plans undo the recorded transition and stop at the exact previous state", () => {
  for (const name of MATRIX) {
    const p = program(name);
    for (let index = 0; index < p.trace.length - 1; index += 1) {
      const plan = planMotion(p.trace, index, {
        source: p.source,
        previousIndex: index + 1,
      });
      assert.equal(plan.transition, MOTION_TRANSITION.backward, `${name} step ${index}`);
      assert.deepEqual(plan.state, stateOf(snapshotAt(p.trace, index)));
      assert.deepEqual(plan.previousState, stateOf(snapshotAt(p.trace, index + 1)));
      assert.deepEqual(
        applyState(plan.previousState, plan.stateActions),
        plan.state,
        `${name} step ${index} reverses onto the target`,
      );
      assert.deepEqual(
        applyState(plan.state, reverseActions(plan.stateActions, plan.state)),
        plan.previousState,
        `${name} step ${index} reverses again`,
      );
    }
  }
});

test("seeking, reset and holding render the target without replaying actions", () => {
  const p = program("bubble-sort");
  const targetIndex = Math.min(9, p.trace.length - 1);
  const target = stateOf(snapshotAt(p.trace, targetIndex));

  const seek = planMotion(p.trace, targetIndex, { source: p.source, previousIndex: 0 });
  assert.equal(seek.transition, MOTION_TRANSITION.seek);
  assert.deepEqual(seek.state, target);
  assert.deepEqual(seek.actions, []);
  assert.deepEqual(seek.operations, []);
  assert.equal(seek.animate, false);
  assert.equal(seek.previousState, null);

  const reset = planMotion(p.trace, 0, { source: p.source, previousIndex: p.trace.length - 1 });
  assert.equal(reset.transition, MOTION_TRANSITION.seek);
  assert.deepEqual(reset.state, stateOf(snapshotAt(p.trace, 0)));
  assert.deepEqual(reset.actions, []);

  const hold = planMotion(p.trace, targetIndex, {
    source: p.source,
    previousIndex: targetIndex,
  });
  assert.equal(hold.transition, MOTION_TRANSITION.hold);
  assert.deepEqual(hold.actions, []);
  assert.deepEqual(hold.state, target);
});

test("motion nodes keep stable identity and never key a list cell by value", () => {
  const int = (value) => ({ type: "int", value });
  const text = (value) => ({ type: "str", value });
  const before = motionNodes({
    frames: [],
    heap: {
      o1: { type: "list", items: [int(1), int(2)] },
      o2: { type: "dict", entries: [{ key: text("a"), value: int(1) }] },
      o3: { type: "object", class: "Box", attrs: [{ name: "x", value: int(1) }] },
    },
  });
  const after = motionNodes({
    frames: [],
    heap: {
      o1: { type: "list", items: [int(1), int(9)] },
      o2: { type: "dict", entries: [{ key: text("a"), value: int(9) }] },
      o3: { type: "object", class: "Box", attrs: [{ name: "x", value: int(9) }] },
    },
  });

  assert.deepEqual(
    before.objects.map((object) => object.key),
    after.objects.map((object) => object.key),
    "object identities are the trace ids",
  );
  assert.deepEqual(
    before.objects[0].slots.map((slot) => slot.key),
    after.objects[0].slots.map((slot) => slot.key),
    "a list value change keeps the same positional cell",
  );
  assert.notEqual(before.objects[0].slots[1].text, after.objects[0].slots[1].text);
  assert.equal(before.objects[1].slots[0].key, after.objects[1].slots[0].key);
  assert.equal(before.objects[2].slots[0].key, after.objects[2].slots[0].key);

  const swapped = motionNodes({ frames: [], heap: { o1: { type: "list", items: [int(2), int(1)] } } });
  assert.deepEqual(
    swapped.objects[0].slots.map((slot) => slot.key),
    ["cell:o1:0", "cell:o1:1"],
    "a value moving between cells does not invent a value identity",
  );
  assert.equal(motionTargetKey({ kind: "cell", objectId: "o1", index: 0 }), "cell:o1:0");
});

test("real actions map to generic operations without algorithm names", () => {
  const find = (name, predicate) => {
    const p = program(name);
    for (let index = 1; index < p.trace.length; index += 1) {
      const plan = planAt(p, index);
      const operation = plan.operations.find(predicate);
      if (operation) return { operation, plan };
    }
    return null;
  };

  const move = find("bubble-sort", (operation) => operation.op === MOTION_OPERATION.move);
  assert.ok(move, "a real swap exists");
  assert.equal(move.operation.action.kind, "move");
  assert.ok(move.operation.targetKey.startsWith("cell:"));
  assert.deepEqual(move.operation.action.payload.indices.length, 2);
  assert.ok(move.operation.durationMs > 0);

  const value = find("dict-basics", (operation) => operation.op === MOTION_OPERATION.value);
  assert.ok(value, "a real dictionary value change exists");
  assert.equal(value.operation.action.kind, "change");
  assert.ok(value.operation.targetKey.startsWith("entry:"));

  const exit = find("list-mutation", (operation) => operation.op === MOTION_OPERATION.exit);
  assert.ok(exit, "a real list deletion exists");
  assert.equal(exit.operation.action.kind, "shrink");
  assert.ok(exit.operation.targetKey.startsWith("cell:"));

  const enter = find(
    "class-basic",
    (operation) =>
      operation.op === MOTION_OPERATION.enter &&
      ["object", "attribute"].includes(operation.action.target.kind),
  );
  assert.ok(enter, "a real object/attribute appearance exists");
});

test("reduced motion and speed alter presentation only", () => {
  const p = program("list-mutation");
  const index = p.trace.findIndex((event, at) => at > 0 && event.event !== "output");
  const normal = planAt(p, index);
  const reduced = planAt(p, index, { reducedMotion: true });
  const faster = planAt(p, index, { speed: 2 });

  assert.deepEqual(reduced.state, normal.state);
  assert.deepEqual(reduced.actions, normal.actions);
  assert.equal(reduced.mode, MOTION_MODE.reduced);
  assert.equal(reduced.animate, false);
  assert.equal(reduced.durationMs, 0);
  for (const operation of reduced.operations) assert.equal(operation.durationMs, 0);

  assert.deepEqual(faster.state, normal.state);
  assert.deepEqual(faster.actions, normal.actions);
  assert.ok(faster.durationMs <= normal.durationMs);

  assert.equal(motionDuration("move", { speed: 1 }), 280);
  assert.equal(motionDuration("move", { speed: 2 }), 140);
  assert.equal(motionDuration("move", { speed: 99 }), 280);
  assert.equal(motionDuration("highlight", { speed: 1 }), 0);
});

test("the controller supersedes stale motion and ignores stale completion", () => {
  const controller = createMotionController();
  const first = controller.request({ index: 4 });
  assert.equal(controller.isCurrent(first), true);

  const second = controller.request({ index: 12 });
  assert.equal(controller.isCurrent(first), false);
  assert.equal(controller.isCurrent(second), true);
  assert.equal(controller.complete(first), false, "a stale completion cannot clear the active plan");
  assert.equal(controller.isCurrent(second), true);
  assert.equal(controller.complete(second), true);
  assert.equal(controller.current(), null);

  const third = controller.request({ index: 20 });
  controller.invalidate();
  assert.equal(controller.isCurrent(third), false);
  assert.equal(controller.complete(third), false);
});

test("motion plans are deterministic and never mutate the trace", () => {
  const p = program("bubble-sort");
  const index = Math.min(12, p.trace.length - 1);
  const before = JSON.stringify(p.trace);
  const first = planMotion(p.trace, index, { source: p.source, previousIndex: index - 1 });
  const second = planMotion(p.trace, index, { source: p.source, previousIndex: index - 1 });

  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(p.trace), before, "planning does not write to the trace");
  assert.deepEqual(first.state, stateOf(snapshotAt(p.trace, index)));
});

test("every plan carries the source line it renders, trimmed but unchanged", () => {
  for (const name of MATRIX) {
    const p = program(name);
    const lines = p.source.split(/\r?\n/);
    for (let index = 0; index < p.trace.length; index += 1) {
      const plan = planAt(p, index);
      if (!plan) continue;
      const line = snapshotAt(p.trace, index).line;
      assert.equal(plan.line, Number.isInteger(line) ? line : null, `${name} step ${index}`);
      if (plan.line === null) {
        assert.equal(plan.lineText, null);
      } else {
        assert.equal(
          plan.lineText,
          (lines[plan.line - 1] ?? "").trim() || null,
          `${name} step ${index} reads its own source line`,
        );
      }
    }
  }
});
