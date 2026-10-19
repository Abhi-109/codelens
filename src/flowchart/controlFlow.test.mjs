// Unit tests for the trace-to-chart layer (src/flowchart/controlFlow.js).
//
//   node --test src/flowchart/controlFlow.test.mjs
//
// This is the layer that keeps the Control Flow Graph honest. Every claim it
// makes about execution has to be checkable against the trace: the box the
// token is on, the arrow it took, the Yes or No that was really answered, and
// — just as importantly — the cases where the trace supports no answer at all.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chartOrder,
  executedNodes,
  jumpToNode,
  mapSteps,
  outgoingEdge,
  raisingNodeId,
  traversedEdges,
} from "./controlFlow.js";
import { buildTrace } from "./__fixtures__/miniTrace.mjs";

// FACT_SOURCE, as a format-2 graph:
//   def fact(n):                line 1
//       if n <= 1:              line 2
//           return 1            line 3
//       return n * fact(n - 1)  line 4
//   print(fact(2))              line 6
const factFlow = {
  format_version: 2,
  error: null,
  functions: {
    "<main>": {
      name: "<main>",
      params: [],
      entry: "n1",
      exit: "n2",
      nodes: [
        { id: "n1", kind: "start", label: "Start", code: "", lines: null },
        { id: "n2", kind: "end", label: "End", code: "", lines: null },
        { id: "n3", kind: "process", label: "Define fact(n)", code: "def fact(n):", lines: [1, 1] },
        { id: "n4", kind: "io", label: "Show fact(2)", code: "print(fact(2))", lines: [6, 6] },
      ],
      edges: [
        { from: "n1", to: "n3", label: null, back: false },
        { from: "n3", to: "n4", label: null, back: false },
        { from: "n4", to: "n2", label: null, back: false },
      ],
    },
    fact: {
      name: "fact",
      params: ["n"],
      entry: "n1",
      exit: "n2",
      nodes: [
        { id: "n1", kind: "start", label: "Start", code: "", lines: null },
        { id: "n2", kind: "end", label: "End", code: "", lines: null },
        { id: "n3", kind: "decision", label: "Is n ≤ 1?", code: "if n <= 1:", lines: [2, 2] },
        { id: "n4", kind: "return", label: "Return 1", code: "return 1", lines: [3, 3] },
        {
          id: "n5",
          kind: "return",
          label: "Return n * fact(n - 1)",
          code: "return n * fact(n - 1)",
          lines: [4, 4],
        },
      ],
      edges: [
        { from: "n1", to: "n3", label: null, back: false },
        { from: "n3", to: "n4", label: "Yes", back: false },
        { from: "n3", to: "n5", label: "No", back: false },
        { from: "n4", to: "n2", label: null, back: false },
        { from: "n5", to: "n2", label: null, back: false },
      ],
    },
  },
};

// def divide(x):      line 1
//     return 1 / x    line 2
// divide(0)           line 3
const boomFlow = {
  format_version: 2,
  error: null,
  functions: {
    "<main>": {
      name: "<main>",
      params: [],
      entry: "n1",
      exit: "n2",
      nodes: [
        { id: "n1", kind: "start", label: "Start", code: "", lines: null },
        { id: "n2", kind: "end", label: "End", code: "", lines: null },
        { id: "n3", kind: "process", label: "Define divide(x)", code: "def divide(x):", lines: [1, 1] },
        { id: "n4", kind: "io", label: "Show divide(0)", code: "divide(0)", lines: [3, 3] },
      ],
      edges: [
        { from: "n1", to: "n3", label: null, back: false },
        { from: "n3", to: "n4", label: null, back: false },
        { from: "n4", to: "n2", label: null, back: false },
      ],
    },
    divide: {
      name: "divide",
      params: ["x"],
      entry: "n1",
      exit: "n2",
      nodes: [
        { id: "n1", kind: "start", label: "Start", code: "", lines: null },
        { id: "n2", kind: "end", label: "End", code: "", lines: null },
        { id: "n3", kind: "return", label: "Return 1 / x", code: "return 1 / x", lines: [2, 2] },
      ],
      edges: [
        { from: "n1", to: "n3", label: null, back: false },
        { from: "n3", to: "n2", label: null, back: false },
      ],
    },
  },
};

// fact(2) calling itself once — two invocations, interleaved in one trace.
function factTrace() {
  return buildTrace([
    ["call", "<module>", 1, { id: 1 }],
    ["line", "<module>", 1, {}],
    ["line", "<module>", 6, {}],
    ["call", "fact", 6, { id: 2 }],
    ["line", "fact", 2, {}],
    ["line", "fact", 4, {}],
    ["call", "fact", 4, { id: 3 }],
    ["line", "fact", 2, {}],
    ["line", "fact", 3, {}],
    ["return", "fact", 3, { value: 1 }],
    ["return", "fact", 4, { value: 2 }],
    ["line", "<module>", 6, {}],
    ["return", "<module>", 6, {}],
  ]);
}

function boomTrace() {
  return buildTrace([
    ["call", "<module>", 1, { id: 1 }],
    ["line", "<module>", 1, {}],
    ["line", "<module>", 3, {}],
    ["call", "divide", 3, { id: 2 }],
    ["line", "divide", 2, {}],
    ["exception", "divide", 2, { frameId: 2, type: "ZeroDivisionError", message: "division by zero" }],
    ["unwind", "divide", 2, { frameId: 2 }],
    ["unwind", "<module>", 3, { frameId: 1 }],
  ]);
}

const at = (steps, i) => steps[i];

test("every trace step is accounted for, in order", () => {
  const trace = factTrace();
  const steps = mapSteps(factFlow, trace);
  assert.equal(steps.length, trace.length);
  steps.forEach((step, i) => assert.equal(step.index, i));
});

test("a call lands on the function's Start, not on its first statement", () => {
  const steps = mapSteps(factFlow, factTrace());
  assert.deepEqual([at(steps, 0).chartKey, at(steps, 0).nodeId], ["<main>", "n1"]);
  assert.deepEqual([at(steps, 3).chartKey, at(steps, 3).nodeId], ["fact", "n1"]);
  // The second, recursive call gets its own Start too — same box, new frame.
  assert.deepEqual([at(steps, 6).chartKey, at(steps, 6).nodeId], ["fact", "n1"]);
  assert.notEqual(at(steps, 3).frameId, at(steps, 6).frameId);
});

test("a line lands on the node that owns that line", () => {
  const steps = mapSteps(factFlow, factTrace());
  assert.deepEqual([at(steps, 1).chartKey, at(steps, 1).nodeId], ["<main>", "n3"]);
  assert.deepEqual([at(steps, 2).chartKey, at(steps, 2).nodeId], ["<main>", "n4"]);
  assert.deepEqual([at(steps, 4).chartKey, at(steps, 4).nodeId], ["fact", "n3"]);
  assert.deepEqual([at(steps, 8).chartKey, at(steps, 8).nodeId], ["fact", "n4"]);
  assert.equal(at(steps, 4).kind, "decision");
});

test("a call into a function the program does not define maps to nothing", () => {
  const flow = {
    format_version: 2,
    functions: {
      "<main>": {
        name: "<main>",
        params: [],
        entry: "n1",
        exit: "n2",
        nodes: [
          { id: "n1", kind: "start", label: "Start", code: "", lines: null },
          { id: "n2", kind: "end", label: "End", code: "", lines: null },
          { id: "n3", kind: "io", label: "Show len(nums)", code: "print(len(nums))", lines: [2, 2] },
        ],
        edges: [{ from: "n1", to: "n3", label: null, back: false }],
      },
    },
  };
  const steps = mapSteps(flow, buildTrace([
    ["call", "<module>", 1, { id: 1 }],
    ["line", "<module>", 2, {}],
    ["call", "len", 2, { id: 2 }],
  ]));
  assert.deepEqual([at(steps, 2).chartKey, at(steps, 2).nodeId], [null, null]);
  assert.deepEqual([at(steps, 2).frameId], [2], "the frame is real even though the chart is not");
});

test("mapSteps is defensive about a missing run", () => {
  assert.deepEqual(mapSteps(factFlow, []), []);
  assert.deepEqual(mapSteps(factFlow, null), []);
  assert.deepEqual(mapSteps(factFlow, undefined), []);
  assert.deepEqual(mapSteps(null, factTrace()), []);
  assert.deepEqual(mapSteps({}, factTrace()), []);
  // With no chart to find, every step still keeps its slot but maps to
  // nothing — the index stays aligned with the trace for stepping.
  const unmapped = mapSteps({ functions: {} }, factTrace());
  assert.equal(unmapped.length, factTrace().length);
  for (const step of unmapped) {
    assert.equal(step.chartKey, null);
    assert.equal(step.nodeId, null);
    assert.equal(step.kind, null);
  }
});

test("the charts are listed in the order the run first entered them", () => {
  assert.deepEqual(chartOrder(mapSteps(factFlow, factTrace())), ["<main>", "fact"]);
  assert.deepEqual(chartOrder(mapSteps(boomFlow, boomTrace())), ["<main>", "divide"]);
  assert.deepEqual(chartOrder([]), []);
  assert.deepEqual(chartOrder(null), []);
});

test("the boxes a run reached are exactly the ones that may be clicked", () => {
  const steps = mapSteps(factFlow, factTrace());
  assert.deepEqual([...executedNodes(steps, "fact")].sort(), ["n1", "n3", "n4", "n5"]);
  assert.deepEqual([...executedNodes(steps, "<main>")].sort(), ["n1", "n3", "n4"]);
  // End is never reached by this run, and the diagram must not pretend it was.
  assert.equal(executedNodes(steps, "fact").has("n2"), false);
  assert.equal(executedNodes(steps, "<main>").has("n2"), false);
});

test("the arrows walked are only the ones within one chart and one call", () => {
  const steps = mapSteps(factFlow, factTrace());
  assert.deepEqual([...traversedEdges(steps, "<main>")].sort(), ["n1>n3", "n3>n4"]);
  // Recursion crossing into a new call is not an arrow, and two returns one
  // after the other are two different invocations, not an arrow between boxes.
  assert.deepEqual(
    [...traversedEdges(steps, "fact")].sort(),
    ["n1>n3", "n3>n4", "n3>n5"],
  );
  assert.deepEqual([...traversedEdges(steps, "nope")], []);
  assert.deepEqual([...traversedEdges(null, "fact")], []);
});

test("a Yes or a No is the branch this run really took, invocation by invocation", () => {
  const steps = mapSteps(factFlow, factTrace());
  const fact = factFlow.functions.fact;
  const main = factFlow.functions["<main>"];

  // fact(2): the condition was false, so the token went to "Return n * fact(n-1)".
  assert.equal(outgoingEdge(fact, steps, 4).edge.label, "No");
  assert.equal(outgoingEdge(fact, steps, 4).edge.to, "n5");
  // fact(1): the condition was true, so it went the other way.
  assert.equal(outgoingEdge(fact, steps, 7).edge.label, "Yes");
  assert.equal(outgoingEdge(fact, steps, 7).edge.to, "n4");

  // At the top level the token simply moved to the next box.
  assert.equal(outgoingEdge(main, steps, 0).edge.to, "n3");
  assert.equal(outgoingEdge(main, steps, 1).edge.to, "n4");
  assert.equal(outgoingEdge(main, steps, 0).edge.label, null, "no Yes/No on a straight line");
});

test("no arrow is invented when the token left some other way", () => {
  const steps = mapSteps(factFlow, factTrace());
  const fact = factFlow.functions.fact;
  const main = factFlow.functions["<main>"];

  // The recursive return box handed back to a call: the token left this chart,
  // and the chart draws no arrow for that.
  assert.equal(outgoingEdge(fact, steps, 5), null);
  // The very last step has nothing after it.
  assert.equal(outgoingEdge(main, steps, 12), null);
  assert.equal(outgoingEdge(null, steps, 0), null);
  assert.equal(outgoingEdge(main, [], 0), null);
  assert.equal(outgoingEdge(main, null, 0), null);
});

test("an exception stops the run on the box it broke on, and draws no arrow", () => {
  const steps = mapSteps(boomFlow, boomTrace());
  const divide = boomFlow.functions.divide;
  const main = boomFlow.functions["<main>"];

  assert.equal(raisingNodeId(steps, 5), "n3", "the return box is where it broke");
  assert.equal(raisingNodeId(steps, 4), null, "a plain line is not an exception");
  assert.equal(raisingNodeId(steps, 2), null);
  assert.equal(raisingNodeId(null, 0), null);
  assert.equal(raisingNodeId(steps, 99), null);

  assert.equal(outgoingEdge(divide, steps, 4), null, "no Yes/No, no arrow — it never got one");
  assert.equal(outgoingEdge(main, steps, 2), null, "the call box never finished");
});

test("jumping to a box lands on the first step that reached it", () => {
  const steps = mapSteps(factFlow, factTrace());
  assert.equal(jumpToNode(steps, "fact", "n4"), 8);
  assert.equal(jumpToNode(steps, "fact", "n1"), 3);
  assert.equal(jumpToNode(steps, "<main>", "n4"), 2);
  // A box the run never reached has no step to jump to, and says so.
  assert.equal(jumpToNode(steps, "fact", "n2"), null);
  assert.equal(jumpToNode(steps, "fact", "nonsense"), null);
  assert.equal(jumpToNode(steps, "nope", "n3"), null);
  assert.equal(jumpToNode(null, "fact", "n3"), null);
});
