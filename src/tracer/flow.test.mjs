// Unit tests for the flowchart helpers (src/tracer/flow.js).
//
//   node --test src/tracer/flow.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { countFor, flowFor, pathToLine, runsByLine } from "./flow.js";

// A flowchart shaped like build_flowchart's for:
//   marks = 68            (line 1)
//   if marks >= 90:       (line 2)
//       grade = "A"       (line 3)
//   else:                 (line 4)
//       grade = "C"       (line 5)
//   print(grade)          (line 6)
const flow = {
  format_version: 1,
  functions: {
    "<module>": {
      name: "<module>",
      params: [],
      nodes: [
        { kind: "statement", line: 1, end_line: 1, text: "marks = 68" },
        {
          kind: "branch",
          line: 2,
          end_line: 5,
          arms: [
            { test: "marks >= 90", line: 2, body: [{ kind: "statement", line: 3, end_line: 3, text: 'grade = "A"' }] },
            { test: null, line: null, body: [{ kind: "statement", line: 5, end_line: 5, text: 'grade = "C"' }] },
          ],
        },
        { kind: "statement", line: 6, end_line: 6, text: "print(grade)" },
      ],
    },
    fact: {
      name: "fact",
      params: ["n"],
      nodes: [
        {
          kind: "loop",
          loop: "while",
          line: 2,
          end_line: 3,
          header: "while n > 0",
          body: [{ kind: "statement", line: 3, end_line: 3, text: "n -= 1" }],
        },
      ],
    },
  },
  error: null,
};

const line = (n, fn = "<module>") => ({ event: "line", line: n, function: fn });

test("flowFor picks the current function, falling back to the module", () => {
  assert.equal(flowFor(flow, "fact").name, "fact");
  assert.equal(flowFor(flow, "<module>").name, "<module>");
  assert.equal(flowFor(flow, "unknownFn").name, "<module>");
  assert.equal(flowFor(null, "x"), null);
  assert.equal(flowFor({ functions: {} }, "x"), null);
});

test("runsByLine counts line events for one function only", () => {
  const trace = [line(1), line(2), line(2), line(3), line(5), line(6), line(2, "fact")];
  const runs = runsByLine(trace, "<module>");
  assert.equal(runs.get(2), 2);
  assert.equal(runs.get(3), 1);
  assert.equal(runs.get(7), undefined);
  assert.equal(runsByLine(trace, "fact").get(2), 1);
});

test("pathToLine returns outermost to innermost", () => {
  const nodes = flow.functions["<module>"].nodes;
  assert.deepEqual(pathToLine(nodes, 1).map((n) => n.kind), ["statement"]);
  assert.deepEqual(pathToLine(nodes, 2).map((n) => n.kind), ["branch"]);
  assert.deepEqual(pathToLine(nodes, 3).map((n) => n.kind), ["branch", "statement"]);
  assert.deepEqual(pathToLine(nodes, 5).map((n) => n.text), [undefined, 'grade = "C"']);
});

test("pathToLine descends into loops and handles misses", () => {
  const nodes = flow.functions.fact.nodes;
  assert.deepEqual(pathToLine(nodes, 3).map((n) => n.kind), ["loop", "statement"]);
  assert.deepEqual(pathToLine(nodes, 99), []);
  assert.deepEqual(pathToLine(nodes, null), []);
});

test("countFor sums branch arms but uses a loop's own header line", () => {
  const nodes = flow.functions["<module>"].nodes;
  const runs = new Map([[1, 1], [2, 1], [3, 1], [5, 1], [6, 1]]);
  assert.equal(countFor(nodes[0], runs), 1);
  assert.equal(countFor(nodes[1], runs), 1); // only the if-line counts; the else arm has no line
  runs.set(2, 4);
  assert.equal(countFor(nodes[1], runs), 4);
  const loopRuns = new Map([[2, 3]]);
  assert.equal(countFor(flow.functions.fact.nodes[0], loopRuns), 3);
});
