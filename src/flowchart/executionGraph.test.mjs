// Unit tests for the execution graph (src/flowchart/executionGraph.js).
//
//   node --test src/flowchart/executionGraph.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildExecutionGraph,
  nodeRuns,
  wrapText,
} from "./executionGraph.js";

// Compact trace builder: [event, function, frame_id, line] tuples. It keeps the
// call stack the way the tracer does, so every state event carries all frames.
function events(list) {
  const trace = [];
  const stack = [];
  list.forEach(([event, functionName, frame_id, line], i) => {
    if (event === "call") {
      stack.push({ frame_id, function: functionName, line: null, call_line: line, variables: {} });
    } else if (event === "return" || event === "unwind") {
      if (stack.length > 0 && stack[stack.length - 1].frame_id === frame_id) stack.pop();
    } else if (event === "line") {
      const top = stack[stack.length - 1];
      if (top) top.line = line;
    }
    trace.push({
      step: i,
      event,
      function: functionName,
      frame_id,
      line,
      frames: stack.map((f) => ({ ...f, variables: { ...f.variables } })),
      heap: {},
    });
  });
  return trace;
}

const edge = (graph, from, to, kind) =>
  graph.edges.find((e) => e.from === from && e.to === to && e.kind === kind);

test("wrapText wraps words and hard-splits an overlong word", () => {
  assert.deepEqual(wrapText("one two three four five", 9), ["one two", "three", "four five"]);
  assert.deepEqual(wrapText("supercalifragilistic", 8), ["supercal", "ifragili", "stic"]);
  assert.deepEqual(wrapText("", 10), [""]);
});

// A program that defines greet() and calls it once:
//   def greet():        line 1
//       return "hi"     line 2
//   print(greet())      line 4
const callTrace = events([
  ["call", "<module>", 1, 1],
  ["line", "<module>", 1, 1],
  ["line", "<module>", 1, 4],
  ["call", "greet", 2, 2],
  ["line", "greet", 2, 2],
  ["return", "greet", 2, 2],
  ["return", "<module>", 1, 4],
]);

test("buildExecutionGraph makes one node per (call, line)", () => {
  const graph = buildExecutionGraph(callTrace, "def greet():\n    return 'hi'\n\nprint(greet())");
  assert.deepEqual(
    graph.nodes.map((n) => n.id),
    ["f1l1", "f1l4", "f2l2"],
  );
  assert.equal(graph.nodes.find((n) => n.id === "f2l2").function, "greet");
  assert.equal(graph.nodes.find((n) => n.id === "f1l4").text, "print(greet())");
});

test("buildExecutionGraph links the call and the return back to the call site", () => {
  const graph = buildExecutionGraph(callTrace, "");
  assert.equal(graph.edges.length, 3);
  assert.ok(edge(graph, "f1l1", "f1l4", "next"));
  assert.ok(edge(graph, "f1l4", "f2l2", "call"), "the call edge");
  const back = edge(graph, "f2l2", "f1l4", "return");
  assert.ok(back, "the return edge runs back up to the caller");
  assert.equal(back.count, 1);
});

test("buildExecutionGraph maps every trace step to a token position", () => {
  const graph = buildExecutionGraph(callTrace, "");
  assert.equal(graph.steps.length, callTrace.length);
  assert.equal(graph.steps[0], null, "the entry call has no token yet");
  assert.equal(graph.steps[1], "f1l1");
  assert.equal(graph.steps[4], "f2l2", "token sits inside greet()");
  assert.equal(graph.steps[5], "f2l2", "still there while returning");
  assert.equal(graph.steps[6], "f1l4", "back at the call site");
});

// A loop: like `for n in [1, 2]: total += n` — line 2 repeats, line 3 repeats.
const loopTrace = events([
  ["call", "<module>", 1, 1],
  ["line", "<module>", 1, 1],
  ["line", "<module>", 1, 2],
  ["line", "<module>", 1, 3],
  ["line", "<module>", 1, 2],
  ["line", "<module>", 1, 3],
  ["line", "<module>", 1, 2],
  ["line", "<module>", 1, 4],
  ["return", "<module>", 1, 4],
]);

test("buildExecutionGraph turns a loop into a counted cycle", () => {
  const graph = buildExecutionGraph(loopTrace, "");
  assert.deepEqual(
    graph.nodes.map((n) => n.id),
    ["f1l1", "f1l2", "f1l3", "f1l4"],
  );
  assert.equal(edge(graph, "f1l2", "f1l3", "next").count, 2, "body ran twice");
  const back = edge(graph, "f1l3", "f1l2", "back");
  assert.ok(back, "the loop closes with a back edge");
  assert.equal(back.count, 2);
  assert.ok(edge(graph, "f1l2", "f1l4", "next"), "and leaves when the loop ends");
});

// Recursion: fact(2) calls fact(1). Each call is its own frame, so it fans out.
const recTrace = events([
  ["call", "<module>", 1, 1],
  ["line", "<module>", 1, 1],
  ["line", "<module>", 1, 7],
  ["call", "fact", 2, 2],
  ["line", "fact", 2, 2],
  ["line", "fact", 2, 4],
  ["call", "fact", 3, 2],
  ["line", "fact", 3, 2],
  ["line", "fact", 3, 3],
  ["return", "fact", 3, 3],
  ["return", "fact", 2, 4],
  ["return", "<module>", 1, 7],
]);

test("buildExecutionGraph fans recursion out into a tree", () => {
  const graph = buildExecutionGraph(recTrace, "");
  assert.ok(graph.nodes.some((n) => n.id === "f2l2"), "outer call");
  assert.ok(graph.nodes.some((n) => n.id === "f3l2"), "inner call is its own node");
  assert.notEqual("f2l2", "f3l2");
});

test("buildExecutionGraph chains returns as visible backtracking", () => {
  const graph = buildExecutionGraph(recTrace, "");
  assert.ok(edge(graph, "f2l4", "f3l2", "call"), "recursive descent");
  assert.ok(edge(graph, "f3l3", "f2l4", "return"), "fact(1) returns into fact(2)");
  assert.ok(edge(graph, "f2l4", "f1l7", "return"), "fact(2) returns to the module");
  assert.equal(graph.steps[10], "f2l4", "token climbs back a frame");
  assert.equal(graph.steps[11], "f1l7");
});

test("buildExecutionGraph records an unhandled exception as an error edge", () => {
  const trace = events([
    ["call", "<module>", 1, 1],
    ["line", "<module>", 1, 1],
    ["line", "<module>", 1, 2],
    ["call", "boom", 2, 1],
    ["line", "boom", 2, 1],
    ["exception", "boom", 2, 1],
    ["unwind", "boom", 2, 1],
    ["unwind", "<module>", 1, 2],
    ["error", "<module>", 1, 2],
  ]);
  const graph = buildExecutionGraph(trace, "");
  assert.ok(edge(graph, "f2l1", "f1l2", "error"), "the unwind runs back up");
});

test("buildExecutionGraph is empty for no trace", () => {
  const graph = buildExecutionGraph(null, "");
  assert.deepEqual(graph.nodes, []);
  assert.deepEqual(graph.edges, []);
  assert.deepEqual(graph.steps, []);
});

test("nodeRuns lists every step index a node is current, in order", () => {
  const graph = buildExecutionGraph(loopTrace, "");
  const runs = nodeRuns(graph);
  // The token sits on line 2 at steps 2, 4 and 6, then leaves for line 4.
  assert.deepEqual(runs.get("f1l2"), [2, 4, 6]);
  assert.deepEqual(runs.get("f1l1"), [1]);
  assert.deepEqual(runs.get("f1l4"), [7, 8]);
  assert.equal(nodeRuns(null).size, 0);
});

test("a node counts how many times its line actually ran", () => {
  const graph = buildExecutionGraph(loopTrace, "");
  const body = graph.nodes.find((n) => n.id === "f1l2");
  assert.equal(body.runs, 3, "the loop body line ran three times");
  assert.equal(body.firstStep, 2);
  assert.equal(body.lastStep, 6);
  assert.equal(graph.nodes.find((n) => n.id === "f1l1").runs, 1);
});

test("a node carries its action and its statement kind, read from the trace", () => {
  const source = "total = 0\nfor n in [1, 2]:\n    total += n\nprint(total)\n";
  const trace = events([
    ["call", "<module>", 1, 1],
    ["line", "<module>", 1, 1],
    ["line", "<module>", 1, 2],
    ["line", "<module>", 1, 3],
    ["line", "<module>", 1, 4],
    ["return", "<module>", 1, 4],
  ]);
  const graph = buildExecutionGraph(trace, source);
  assert.equal(graph.nodes.find((n) => n.id === "f1l1").action, "Set total");
  assert.equal(graph.nodes.find((n) => n.id === "f1l2").action, "Loop over n");
  assert.equal(graph.nodes.find((n) => n.id === "f1l3").stepKind, "augmented");
  assert.equal(graph.nodes.find((n) => n.id === "f1l4").stepKind, "print");
});

test("a node knows how deep in the call stack it ran", () => {
  const graph = buildExecutionGraph(recTrace, "");
  assert.equal(graph.nodes.find((n) => n.id === "f1l1").depth, 0);
  assert.equal(graph.nodes.find((n) => n.id === "f2l2").depth, 1);
  assert.equal(graph.nodes.find((n) => n.id === "f3l2").depth, 2);
});
