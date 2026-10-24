// The vocabulary every later diff test will speak: kinds, effects, canonical
// targets, and the deterministic id rule. These tests pin the contract in
// docs/animation.md sections 4-6, so a change to an id or an effect is a
// deliberate, reviewed change rather than a silent one.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ACTION_EFFECT,
  ACTION_KINDS,
  FALLBACK_REASON,
  MOTIONS,
  OVERLAY_KINDS,
  STATE_KINDS,
  TARGET_KINDS,
  canonicalValue,
  createAction,
  isStateAction,
  overlayActionsAt,
  targetPath,
} from "./actions.js";

const cell = (index, objectId = "o1") => ({ kind: "cell", objectId, index });
const variable = (name, frameId = 1) => ({ kind: "variable", frameId, name });

test("the vocabulary is exactly the spec's action types, frozen and in order", () => {
  assert.deepEqual(
    [...ACTION_KINDS],
    [
      "appear",
      "disappear",
      "change",
      "highlight",
      "move",
      "grow",
      "shrink",
      "connect",
      "disconnect",
      "call",
      "return",
      "print",
      "error",
    ],
  );
  assert.equal(new Set(ACTION_KINDS).size, ACTION_KINDS.length, "no duplicate kind");
  assert.ok(Object.isFrozen(ACTION_KINDS), "the list is frozen");
});

test("every kind has exactly one effect, and state + overlay partition the list", () => {
  const state = new Set(STATE_KINDS);
  const overlay = new Set(OVERLAY_KINDS);
  assert.equal(state.size, STATE_KINDS.length, "no duplicate state kind");
  assert.equal(overlay.size, OVERLAY_KINDS.length, "no duplicate overlay kind");
  for (const kind of STATE_KINDS) assert.ok(!overlay.has(kind), `${kind} has one effect`);
  assert.deepEqual(
    [...STATE_KINDS, ...OVERLAY_KINDS].sort(),
    [...ACTION_KINDS].sort(),
    "the two effects cover every kind exactly once",
  );
  for (const kind of STATE_KINDS) {
    assert.equal(
      createAction(kind, {
        step: 0,
        target: kind === "call" ? { kind: "frame", frameId: 2 } : { kind: "object", objectId: "o1" },
        motion: kind === "move" ? "swap" : kind === "grow" ? "append" : kind === "shrink" ? "pop" : null,
      }).effect,
      ACTION_EFFECT.state,
      `${kind} is a state action`,
    );
  }
});

test("movement names its shape and nothing else may carry one", () => {
  assert.deepEqual([...MOTIONS.move], ["swap", "shift"]);
  assert.deepEqual([...MOTIONS.grow], ["append", "insert"]);
  assert.deepEqual([...MOTIONS.shrink], ["pop", "delete"]);
  for (const kind of ["move", "grow", "shrink"]) {
    assert.throws(
      () => createAction(kind, { step: 1, target: cell(0) }),
      TypeError,
      `${kind} needs a motion`,
    );
  }
  assert.throws(() => createAction("change", { step: 1, target: cell(0), motion: "swap" }), TypeError);
  assert.throws(() => createAction("move", { step: 1, target: cell(0), motion: "append" }), TypeError);
});

test("ids are deterministic, recomputable and independent of creation order", () => {
  const spec = { step: 4, target: cell(2), motion: "swap" };
  const first = createAction("move", spec);
  const second = createAction("move", spec);
  assert.equal(first.id, second.id);
  assert.equal(first.id, "4:move.swap:o1[2]");
  // Recomputing after a seek is the same call with the same facts.
  const afterSeek = createAction("move", { ...spec, target: cell(2) });
  assert.equal(afterSeek.id, first.id);
});

test("an id is sensitive to step, kind, motion and target, and nothing else", () => {
  const base = createAction("change", { step: 2, target: cell(0) });
  assert.notEqual(base.id, createAction("change", { step: 3, target: cell(0) }).id);
  assert.notEqual(base.id, createAction("appear", { step: 2, target: cell(0) }).id);
  assert.notEqual(base.id, createAction("change", { step: 2, target: cell(1) }).id);
  assert.notEqual(
    createAction("move", { step: 2, target: cell(0), motion: "swap" }).id,
    createAction("move", { step: 2, target: cell(0), motion: "shift" }).id,
  );
  // The value on either side, the reason and the payload are not identity.
  assert.equal(
    base.id,
    createAction("change", {
      step: 2,
      target: cell(0),
      from: { type: "int", value: 1 },
      to: { type: "int", value: 2 },
      reason: FALLBACK_REASON.duplicateValues,
      payload: { note: "anything" },
    }).id,
  );
  assert.match(base.id, /^(0|[1-9]\d*):[a-z]+(\.[a-z]+)?:.+$/);
});

test("ids are unique within one step for the actions a transition can emit", () => {
  const step = 7;
  const actions = [
    createAction("appear", { step, target: variable("total") }),
    createAction("change", { step, target: variable("total") }),
    createAction("move", { step, target: cell(0), motion: "swap" }),
    createAction("move", { step, target: cell(1), motion: "swap" }),
    createAction("grow", { step, target: cell(2), motion: "append" }),
    createAction("appear", { step, target: { kind: "object", objectId: "o2" } }),
    createAction("connect", { step, target: cell(2) }),
    createAction("print", { step, target: { kind: "console" } }),
    createAction("return", { step, target: { kind: "frame", frameId: 3 } }),
  ];
  const ids = actions.map((action) => action.id);
  assert.equal(new Set(ids).size, ids.length, "no id collides");
});

test("a target path is canonical whatever order a value's keys arrived in", () => {
  const key = { type: "str", value: "a" };
  const sameKey = { value: "a", type: "str" };
  const entry = { kind: "entry", objectId: "o3", key };
  assert.equal(targetPath(entry), 'o3[{"type":"str","value":"a"}]');
  assert.equal(targetPath(entry), targetPath({ kind: "entry", objectId: "o3", key: sameKey }));
  assert.equal(
    createAction("change", { step: 1, target: entry }).id,
    createAction("change", { step: 1, target: { kind: "entry", objectId: "o3", key: sameKey } }).id,
  );
  // Two different keys can never share a path.
  assert.notEqual(
    targetPath(entry),
    targetPath({ kind: "entry", objectId: "o3", key: { type: "str", value: "b" } }),
  );
  assert.notEqual(
    targetPath(entry),
    targetPath({ kind: "entry", objectId: "o4", key }),
  );
  assert.equal(canonicalValue([1, { b: 2, a: 1 }]), '[1,{"a":1,"b":2}]');
});

test("every target kind produces the path the stage will use", () => {
  assert.equal(targetPath(variable("total", 1)), "f1.total");
  assert.equal(targetPath(cell(3)), "o1[3]");
  assert.equal(targetPath({ kind: "entry", objectId: "o2", key: { type: "int", value: 5 } }), 'o2[{"type":"int","value":5}]');
  assert.equal(targetPath({ kind: "attribute", objectId: "o1", name: "next" }), "o1.next");
  assert.equal(targetPath({ kind: "object", objectId: "o1" }), "o1");
  assert.equal(targetPath({ kind: "frame", frameId: 4 }), "f4");
  assert.equal(targetPath({ kind: "console" }), "console");
  assert.deepEqual([...TARGET_KINDS].sort(), [
    "attribute",
    "cell",
    "console",
    "entry",
    "frame",
    "object",
    "variable",
  ]);
});

test("two frames never collide on a same-named variable", () => {
  const moduleVar = createAction("change", { step: 1, target: variable("n", 1) });
  const functionVar = createAction("change", { step: 1, target: variable("n", 2) });
  assert.equal(moduleVar.path, "f1.n");
  assert.equal(functionVar.path, "f2.n");
  assert.notEqual(moduleVar.id, functionVar.id);
});

test("invalid actions fail loudly instead of defaulting", () => {
  const bad = [
    ["unknown kind", () => createAction("teleport", { step: 1, target: cell(0) })],
    ["negative step", () => createAction("change", { step: -1, target: cell(0) })],
    ["fractional step", () => createAction("change", { step: 1.5, target: cell(0) })],
    ["unknown target kind", () => createAction("change", { step: 1, target: { kind: "bucket" } })],
    ["variable without a frame", () => createAction("change", { step: 1, target: { kind: "variable", name: "x" } })],
    ["variable with a bad name", () => createAction("change", { step: 1, target: variable("a b") })],
    ["cell with a negative index", () => createAction("change", { step: 1, target: cell(-2) })],
    ["cell with a non-object id", () => createAction("change", { step: 1, target: cell(0, "1") })],
    ["entry without a key", () => createAction("change", { step: 1, target: { kind: "entry", objectId: "o1" } })],
    ["attribute without a name", () => createAction("change", { step: 1, target: { kind: "attribute", objectId: "o1" } })],
    ["unknown fallback reason", () => createAction("change", { step: 1, target: cell(0), reason: "meh" })],
    ["array payload", () => createAction("change", { step: 1, target: cell(0), payload: [1] })],
    [
      "extra target field",
      () => createAction("change", { step: 1, target: { ...cell(0), slot: "typo" } }),
    ],
  ];
  for (const [label, run] of bad) {
    assert.throws(run, TypeError, label);
  }
});

test("the caller cannot choose the effect, and the action cannot be mutated", () => {
  const target = cell(0);
  const action = createAction("change", { step: 2, target, effect: ACTION_EFFECT.overlay });
  assert.equal(action.effect, ACTION_EFFECT.state, "the effect comes from the kind");
  assert.ok(Object.isFrozen(action));
  target.index = 9;
  assert.equal(action.target.index, 0, "the target is copied, not aliased");
  assert.equal(action.path, "o1[0]");
});

test("every action carries the universal fields", () => {
  const action = createAction("print", {
    step: 5,
    target: { kind: "console" },
    payload: { text: "hi" },
  });
  assert.deepEqual(Object.keys(action).sort(), [
    "effect",
    "from",
    "id",
    "kind",
    "motion",
    "path",
    "payload",
    "reason",
    "step",
    "target",
    "to",
  ]);
  assert.equal(action.effect, ACTION_EFFECT.overlay);
  assert.equal(action.payload.text, "hi");
  assert.equal(isStateAction(action), false);
});

test("overlays never outlive their step, so backward and seek clear them", () => {
  const actions = [
    createAction("change", { step: 1, target: variable("x") }),
    createAction("highlight", { step: 1, target: cell(0), reason: FALLBACK_REASON.duplicateValues }),
    createAction("print", { step: 1, target: { kind: "console" }, payload: { text: "hi" } }),
    createAction("move", { step: 2, target: cell(0), motion: "swap" }),
    createAction("return", { step: 2, target: { kind: "frame", frameId: 2 } }),
  ];
  assert.deepEqual(
    overlayActionsAt(actions, 1).map((action) => action.kind),
    ["highlight", "print"],
  );
  assert.deepEqual(overlayActionsAt(actions, 2).map((action) => action.kind), ["return"]);
  // Moving the cursor anywhere else - one step back or a jump - keeps nothing.
  assert.deepEqual(overlayActionsAt(actions, 0), []);
  assert.deepEqual(overlayActionsAt(actions, 3), []);
  assert.deepEqual(overlayActionsAt(null, 1), []);
  for (const action of overlayActionsAt(actions, 1)) {
    assert.ok(!isStateAction(action), `${action.kind} is never applied to the snapshot`);
  }
});
