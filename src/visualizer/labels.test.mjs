// Unit tests for the learner-facing labels (src/visualizer/labels.js).
//
//   node --test src/visualizer/labels.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";

import { scopeLabel, variableRows } from "./labels.js";

const frame = (overrides) => ({
  function: "fact",
  callNumber: 1,
  args: [{ name: "n", text: "4", isArg: true }],
  ...overrides,
});

test("scope names the whole program, or the call and its real arguments", () => {
  assert.equal(scopeLabel(frame({ function: "<module>", args: [] })), "global");
  assert.equal(scopeLabel(frame()), "local to fact(4)");
  assert.equal(
    scopeLabel(frame({ function: "merge", args: [{ name: "left", text: "[1]" }, { name: "right", text: "[]" }] })),
    "local to merge([1], [])",
  );
  assert.equal(scopeLabel(null), "—");
});

test("the after state updates a row and adds a brand new one", () => {
  const view = {
    frame: { variables: [{ name: "x", text: "5", isArg: false }] },
    changes: [
      { kind: "changed", name: "x", to: "10" },
      { kind: "new", name: "y", to: "2", arg: true },
      { kind: "slot", name: "xs[0]", to: "9" },
    ],
  };
  assert.deepEqual(variableRows(view, false), [{ name: "x", text: "5", isArg: false }]);
  assert.deepEqual(variableRows(view, true), [
    { name: "x", text: "10", isArg: false },
    { name: "y", text: "2", isArg: true },
  ]);
});
