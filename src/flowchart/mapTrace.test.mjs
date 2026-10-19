// Unit tests for the flowchart graph helpers (src/flowchart/mapTrace.js).
//
//   node --test src/flowchart/mapTrace.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { MAIN, chartByKey, chartFor, chartList, nodeForLine, nodeForSourceLine } from "./mapTrace.js";

// A graph shaped like flowchart.build_flowchart's (format version 2) for:
//   total = 0              (line 1)
//   for n in range(1, 6):  (line 2)
//       total = total + n  (line 3)
//   print(total)           (line 4)
//
// and a function chart, so chartFor has something besides the module chart:
//   def fact(n):           (line 6)
//       if n <= 1:         (line 7)
//           return 1       (line 8)
//       return n * fact(n - 1)   (line 9)
const flow = {
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
        { id: "n3", kind: "process", label: "Make total = 0", code: "total = 0", lines: [1, 1] },
        {
          id: "n4",
          kind: "loop",
          label: "Any more numbers to go?",
          code: "for n in range(1, 6):",
          lines: [2, 2],
          loop: "for",
          test: "range(1, 6)",
        },
        {
          id: "n5",
          kind: "process",
          label: "Add n to total",
          code: "total = total + n",
          lines: [3, 3],
        },
        { id: "n6", kind: "io", label: "Show total", code: "print(total)", lines: [4, 4] },
      ],
      edges: [],
    },
    fact: {
      name: "fact",
      params: ["n"],
      entry: "n1",
      exit: "n2",
      nodes: [
        { id: "n1", kind: "start", label: "Start", code: "", lines: null },
        { id: "n2", kind: "end", label: "End", code: "", lines: null },
        {
          id: "n3",
          kind: "decision",
          label: "Is n ≤ 1?",
          code: "if n <= 1:",
          lines: [7, 7],
          test: "n <= 1",
        },
        { id: "n4", kind: "return", label: "Return 1", code: "return 1", lines: [8, 8] },
        {
          id: "n5",
          kind: "return",
          label: "Return n * fact(n - 1)",
          code: "return n * fact(n - 1)",
          lines: [9, 9],
        },
      ],
      edges: [],
    },
  },
};

// A one-liner compound header that spans several lines owns the whole header.
const multiLine = {
  name: "main",
  entry: "n1",
  exit: "n2",
  nodes: [
    { id: "n1", kind: "start", label: "Start", code: "", lines: null },
    { id: "n2", kind: "end", label: "End", code: "", lines: null },
    {
      id: "n3",
      kind: "decision",
      label: "Is a ≤ b?",
      code: "if (\n    a <= b\n):",
      lines: [2, 4],
      test: "a <= b",
    },
    { id: "n4", kind: "process", label: "Make x = 1", code: "x = 1", lines: [5, 5] },
  ],
  edges: [],
};

const main = flow.functions["<main>"];

test("chartFor translates <module> to <main>", () => {
  assert.equal(chartFor(flow, "<module>"), flow.functions["<main>"]);
  assert.equal(chartFor(flow, "<main>"), flow.functions["<main>"]);
});

test("chartFor returns the named function's chart", () => {
  assert.equal(chartFor(flow, "fact"), flow.functions.fact);
});

test("chartFor falls back to <main> for an unknown name", () => {
  assert.equal(chartFor(flow, "noSuchFunction"), flow.functions["<main>"]);
  assert.equal(chartFor(flow, undefined), flow.functions["<main>"]);
});

test("chartFor returns null when there is no graph", () => {
  assert.equal(chartFor(null, "<module>"), null);
  assert.equal(chartFor(undefined, "fact"), null);
  assert.equal(chartFor({}, "fact"), null);
  assert.equal(chartFor({ functions: {} }, "fact"), null);
});

test("chartByKey names a chart exactly, with no fallback", () => {
  assert.equal(chartByKey(flow, "fact"), flow.functions.fact);
  assert.equal(chartByKey(flow, MAIN), flow.functions["<main>"]);
  assert.equal(chartByKey(flow, "noSuchFunction"), flow.functions["<main>"], "the module chart");
  assert.equal(chartByKey(null, "fact"), null);
});

test("nodeForLine finds the node that owns a line", () => {
  assert.equal(nodeForLine(main, 1).id, "n3");
  assert.equal(nodeForLine(main, 2).kind, "loop");
  assert.equal(nodeForLine(main, 3).id, "n5");
  assert.equal(nodeForLine(main, 4).kind, "io");
  assert.equal(nodeForLine(flow.functions.fact, 7).id, "n3");
  assert.equal(nodeForLine(flow.functions.fact, 9).kind, "return");
});

test("nodeForLine never matches start or end (lines is null)", () => {
  const ids = new Set(main.nodes.map((n) => n.id));
  assert.deepEqual([...ids], ["n1", "n2", "n3", "n4", "n5", "n6"]);
  assert.equal(nodeForLine(main, 0), null); // before the first real node
  assert.equal(nodeForLine(main, 99), null); // past the end
  assert.equal(nodeForLine(main, 5), null, "line 5 belongs to no chart node here");
});

test("nodeForLine handles a multi-line header range", () => {
  assert.equal(nodeForLine(multiLine, 1), null);
  assert.equal(nodeForLine(multiLine, 2).id, "n3");
  assert.equal(nodeForLine(multiLine, 3).id, "n3");
  assert.equal(nodeForLine(multiLine, 4).id, "n3");
  assert.equal(nodeForLine(multiLine, 5).id, "n4");
});

test("nodeForLine is defensive about empty or odd input", () => {
  assert.equal(nodeForLine(null, 1), null);
  assert.equal(nodeForLine(undefined, 1), null);
  assert.equal(nodeForLine(main, null), null);
  assert.equal(nodeForLine(main, undefined), null);
  assert.equal(nodeForLine({ nodes: [] }, 1), null);
  assert.equal(nodeForLine({}, 1), null);
  assert.equal(nodeForLine({ nodes: [{ id: "x", lines: null }] }, 1), null);
  assert.equal(nodeForLine({ nodes: [{ id: "x", lines: [1] }] }, 1), null);
});

test("within one chart, every covered line maps to exactly one node", () => {
  for (const chart of Object.values(flow.functions)) {
    for (let line = 1; line <= 12; line += 1) {
      const hits = chart.nodes.filter((node) => nodeForLine(chart, line) === node);
      assert.ok(hits.length <= 1, `${chart.name} line ${line} matched ${hits.length} nodes`);
    }
  }
});

test("nodeForSourceLine finds a line in whatever chart owns it", () => {
  assert.equal(nodeForSourceLine(flow, 3).node.id, "n5");
  assert.equal(nodeForSourceLine(flow, 3).chart, main);
  assert.equal(nodeForSourceLine(flow, 8).node.id, "n4");
  assert.equal(nodeForSourceLine(flow, 8).chart, flow.functions.fact);
  assert.equal(nodeForSourceLine(flow, 42), null);
  assert.equal(nodeForSourceLine(null, 1), null);
  assert.equal(nodeForSourceLine({}, 1), null);
  assert.equal(nodeForSourceLine(flow, null), null);
  assert.equal(nodeForSourceLine(flow, undefined), null);
});

test("no line belongs to two charts at once", () => {
  // A function's body is drawn in the function's chart and nowhere else, so
  // the fallback lookup above is unambiguous for this program.
  for (let line = 1; line <= 12; line += 1) {
    const owners = Object.values(flow.functions).filter((chart) => nodeForLine(chart, line));
    assert.ok(owners.length <= 1, `line ${line} belongs to ${owners.length} charts`);
  }
});

test("chartList lists the module first, then the rest in source order", () => {
  assert.deepEqual(chartList(flow), [MAIN, "fact"]);
  assert.deepEqual(chartList({ functions: { fact: { name: "fact" } } }), ["fact"]);
  assert.deepEqual(chartList({ functions: { [MAIN]: main } }), [MAIN]);
  assert.deepEqual(chartList(null), []);
  assert.deepEqual(chartList({}), []);
});
