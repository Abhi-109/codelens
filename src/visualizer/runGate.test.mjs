import assert from "node:assert/strict";
import { test } from "node:test";

import { createRunGate } from "./runGate.js";

test("a later run makes the earlier async result stale", () => {
  const gate = createRunGate();
  const first = gate.begin("print(1)\n");
  const second = gate.begin("print(2)\n");

  assert.equal(gate.isLatest(first), false);
  assert.equal(gate.isCurrent(first, "print(2)\n"), false);
  assert.equal(gate.isLatest(second), true);
  assert.equal(gate.isCurrent(second, "print(2)\n"), true);
});

test("editing the source rejects an in-flight result without rejecting a new run", () => {
  const gate = createRunGate();
  const run = gate.begin("x = 1\n");

  assert.equal(gate.isLatest(run), true);
  assert.equal(gate.isCurrent(run, "x = 2\n"), false, "the source moved on");

  const next = gate.begin("x = 2\n");
  assert.equal(gate.isCurrent(run, "x = 2\n"), false, "the old run is never current");
  assert.equal(gate.isCurrent(next, "x = 2\n"), true);
});
