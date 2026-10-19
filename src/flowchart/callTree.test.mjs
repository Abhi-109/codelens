// Unit tests for the call tree (src/flowchart/callTree.js).
//
//   node --test src/flowchart/callTree.test.mjs
//
// The tree must be the trace's own story: every parent is the frame that was
// underneath it on the real stack, every return value came from a real
// `return` event, and a program that called nothing grows no branches.

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCallTree, callStatus, onlyModule } from "./callTree.js";
import {
  FACT_SOURCE,
  boomTrace,
  factTrace,
  moduleOnlyTrace,
  repeatedTrace,
} from "./__fixtures__/miniTrace.mjs";

const topFrame = (trace, index) => {
  const frames = trace[index]?.frames ?? [];
  return frames.length > 0 ? frames[frames.length - 1].frame_id : null;
};

const statuses = (tree, trace, index) => {
  const current = topFrame(trace, index);
  return tree.nodes.map((node) => [node.label, callStatus(node, index, current)]);
};

test("buildCallTree nests each call under the frame that called it", () => {
  const tree = buildCallTree(factTrace(), FACT_SOURCE);
  assert.deepEqual(
    tree.nodes.map((n) => [n.function, n.parentId, n.depth]),
    [
      ["<module>", null, 0],
      ["fact", 1, 1],
      ["fact", 2, 2],
    ],
    "module → fact(2) → fact(1), each one level deeper",
  );
  assert.deepEqual(
    tree.nodes.map((n) => n.label),
    ["<module>", "fact(2)", "fact(1)"],
    "arguments are read from the frame the trace captured",
  );
  assert.equal(tree.roots.length, 1);
  assert.equal(tree.nodes.filter((n) => n.parentId === 2).length, 1);
});

test("recursion produces one distinct node per call, never a shared one", () => {
  const tree = buildCallTree(factTrace(), FACT_SOURCE);
  const facts = tree.nodes.filter((n) => n.function === "fact");
  assert.equal(facts.length, 2);
  assert.notEqual(facts[0].frameId, facts[1].frameId);
  assert.equal(facts[1].parentId, facts[0].frameId);
  assert.deepEqual(
    tree.byId.get(facts[0].frameId).children.map((c) => c.frameId),
    [facts[1].frameId],
  );
});

test("repeated calls to one function become ordered siblings", () => {
  const tree = buildCallTree(repeatedTrace(), "def double(n):\n    return n * 2\n\ndouble(2)\ndouble(3)\n");
  const doubles = tree.nodes.filter((n) => n.function === "double");
  assert.equal(doubles.length, 2, "the second call is a second node, not a re-run");
  assert.equal(doubles[0].parentId, doubles[1].parentId, "both hang off the module frame");
  assert.ok(doubles[0].firstIndex < doubles[1].firstIndex, "siblings keep the order they ran in");
  assert.deepEqual(
    tree.byId.get(doubles[0].parentId).children.map((c) => c.frameId),
    [doubles[0].frameId, doubles[1].frameId],
  );
});

test("return values are read from the trace's own return events", () => {
  const tree = buildCallTree(factTrace(), FACT_SOURCE);
  assert.equal(tree.nodes.find((n) => n.label === "fact(1)").returnText, "1");
  assert.equal(tree.nodes.find((n) => n.label === "fact(2)").returnText, "2");
  assert.equal(
    tree.nodes.find((n) => n.function === "<module>").returnText,
    null,
    "the module frame handed back nothing the tracer recorded",
  );
});

test("a click target is the step the call actually started at", () => {
  const trace = factTrace();
  const tree = buildCallTree(trace, FACT_SOURCE);
  const fact2 = tree.nodes.find((n) => n.label === "fact(2)");
  assert.equal(trace[fact2.firstIndex].event, "call");
  assert.equal(trace[fact2.firstIndex].frame_id, fact2.frameId);
  const fact1 = tree.nodes.find((n) => n.label === "fact(1)");
  assert.equal(trace[fact1.firstIndex].event, "call");
  assert.ok(fact1.firstIndex > fact2.firstIndex);
});

test("callStatus walks a call from future to running to done", () => {
  const trace = factTrace();
  const tree = buildCallTree(trace, FACT_SOURCE);

  assert.deepEqual(statuses(tree, trace, 2), [
    ["<module>", "running"],
    ["fact(2)", "future"],
    ["fact(1)", "future"],
  ]);
  assert.deepEqual(statuses(tree, trace, 5), [
    ["<module>", "waiting"],
    ["fact(2)", "running"],
    ["fact(1)", "future"],
  ]);
  assert.deepEqual(statuses(tree, trace, 7), [
    ["<module>", "waiting"],
    ["fact(2)", "waiting"],
    ["fact(1)", "running"],
  ]);
  assert.deepEqual(statuses(tree, trace, 9), [
    ["<module>", "waiting"],
    ["fact(2)", "waiting"],
    ["fact(1)", "done"],
  ]);
  assert.deepEqual(statuses(tree, trace, 12), [
    ["<module>", "done"],
    ["fact(2)", "done"],
    ["fact(1)", "done"],
  ]);
});

test("a call's value is revealed only from the step its own return was recorded", () => {
  // The parent's answer is drawn the moment, and only from the moment, the
  // trace recorded it - not when the run as a whole happened to finish.
  const trace = factTrace();
  const tree = buildCallTree(trace, FACT_SOURCE);
  let checked = 0;
  for (const node of tree.nodes) {
    if (node.returnIndex === null) continue;
    checked += 1;

    for (let i = 0; i < node.returnIndex; i += 1) {
      const before = callStatus(node, i, null);
      assert.ok(
        before === "future" || before === "waiting" || before === "running",
        `${node.label} must not show its value at step ${i} (was ${before})`,
      );
    }

    for (let i = node.returnIndex; i < trace.length; i += 1) {
      const after = callStatus(node, i, null);
      assert.ok(
        after === "done" || after === "failed",
        `${node.label} must show its value from step ${node.returnIndex} on (step ${i} was ${after})`,
      );
    }
  }
  assert.ok(checked > 1, "the tree has calls whose returns were recorded");
});

test("callStatus needs no step to stay consistent with itself", () => {
  const trace = factTrace();
  const tree = buildCallTree(trace, FACT_SOURCE);
  const fact2 = tree.nodes.find((n) => n.label === "fact(2)");
  assert.equal(callStatus(fact2, 0, 1), "future");
  assert.equal(callStatus(null, 0, 1), "future");
  // Status only depends on the node and the step — never on when we asked.
  for (let i = 0; i < trace.length; i += 1) {
    const once = callStatus(fact2, i, topFrame(trace, i));
    assert.equal(callStatus(fact2, i, topFrame(trace, i)), once, `stable at step ${i}`);
  }
});

test("a failed call reads as failed, and names the exception that did it", () => {
  const trace = boomTrace();
  const tree = buildCallTree(trace, "def fail(x):\n    return 1 / x\n\nfail(1)\n");
  const fail = tree.nodes.find((n) => n.function === "fail");
  const mod = tree.nodes.find((n) => n.function === "<module>");

  assert.equal(fail.raised, true, "it exited through an unwind, not a return");
  assert.equal(fail.raisedType, "ZeroDivisionError", "from the trace's exception event");
  assert.equal(mod.raised, true, "the exception propagated through the module frame");
  assert.equal(mod.raisedType, "ZeroDivisionError", "inherited from the call that raised it");
  assert.deepEqual(tree.nodes.map((n) => n.function), ["<module>", "fail"], "no invented branches");

  const atRaise = statuses(tree, trace, 6);
  assert.equal(atRaise.find(([label]) => label.startsWith("fail("))[1], "running");
  assert.deepEqual(statuses(tree, trace, 7), [
    ["<module>", "waiting"],
    ["fail(1)", "failed"],
  ]);
  assert.deepEqual(statuses(tree, trace, 9), [
    ["<module>", "failed"],
    ["fail(1)", "failed"],
  ]);
});

test("a program with no function calls gets exactly one module node", () => {
  const tree = buildCallTree(moduleOnlyTrace(), "x = 1\ny = x + 2\n");
  assert.equal(tree.nodes.length, 1);
  assert.equal(tree.nodes[0].function, "<module>");
  assert.equal(tree.nodes[0].parentId, null);
  assert.deepEqual(tree.nodes[0].children, []);
  assert.equal(tree.roots.length, 1);
  assert.ok(onlyModule(tree), "the UI can say so honestly instead of drawing a branch");
});

test("an empty or missing trace yields an empty tree, not a fabricated one", () => {
  for (const trace of [[], null, undefined, "nonsense"]) {
    const tree = buildCallTree(trace, "");
    assert.deepEqual(tree.nodes, []);
    assert.deepEqual(tree.roots, []);
    assert.equal(tree.byId.size, 0);
    assert.equal(onlyModule(tree), false);
  }
});

test("the pre-order walk puts every parent before its children", () => {
  const tree = buildCallTree(factTrace(), FACT_SOURCE);
  const position = new Map(tree.nodes.map((node, i) => [node.frameId, i]));
  for (const node of tree.nodes) {
    for (const child of node.children) {
      assert.ok(
        position.get(node.frameId) < position.get(child.frameId),
        `${node.label} must come before ${child.label}`,
      );
    }
  }
});
