// Unit tests for the graph's reasons (src/flowchart/reasons.js): what each edge
// means and which way a decision really went, read from the trace.
//
//   node --test src/flowchart/reasons.test.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";

import { buildExecutionGraph } from "./executionGraph.js";
import { decisionResult, edgeReason, isDecision } from "./reasons.js";

const FIXTURES = JSON.parse(
  gunzipSync(readFileSync(new URL("../tracer/__fixtures__/traces.json.gz", import.meta.url))),
);

const node = (id, line, text, frameId = 1) => ({ id, line, text, frameId, function: "<module>" });
const source = ["if x > 0:", "    y = 1", "print(x)"].join("\n");

test("isDecision spots if, elif, while and for headers only", () => {
  assert.equal(isDecision("if len(arr) <= 1:"), true);
  assert.equal(isDecision("elif marks >= 60:"), true);
  assert.equal(isDecision("while i < len(left):"), true);
  assert.equal(isDecision("for n in range(1, 6):"), true);
  assert.equal(isDecision("y = 1"), false);
  assert.equal(isDecision("print(x)"), false);
});

test("edgeReason names the kind of every edge", () => {
  assert.equal(edgeReason({ kind: "call" }, null, null, source), "call");
  assert.equal(edgeReason({ kind: "return" }, null, null, source), "return");
  assert.equal(edgeReason({ kind: "back" }, null, null, source), "loop");
  assert.equal(edgeReason({ kind: "error" }, null, null, source), "error");
  assert.equal(edgeReason({ kind: "next" }, node("a", 3, "print(x)"), node("b", 4, "x"), source), "next");
});

test("edgeReason says Yes when a condition entered its block and No when it skipped it", () => {
  const header = node("h", 1, "if x > 0:");
  assert.equal(edgeReason({ kind: "next" }, header, node("body", 2, "y = 1"), source), "Yes");
  assert.equal(edgeReason({ kind: "next" }, header, node("after", 3, "print(x)"), source), "No");
});

test("decisionResult shows the real values behind a decision, from the trace", () => {
  const { source: mergeSource, trace } = FIXTURES.mergeSort;
  const graph = buildExecutionGraph(trace, mergeSource);
  // Step 6 is the first guard: `if len(arr) <= 1:` with arr of length 7.
  const guard = graph.nodes.find((entry) => entry.id === graph.steps[6]);
  const result = decisionResult(guard, trace, graph, mergeSource, 6);
  assert.ok(result, "expected a chip for the guard");
  assert.equal(result.yes, false);
  assert.equal(result.text, "len(arr) <= 1 is False");
});

test("a for-loop header gets no True/False chip", () => {
  const { source: mergeSource, trace } = FIXTURES.mergeSort;
  const graph = buildExecutionGraph(trace, mergeSource);
  const loop = graph.nodes.find((entry) => entry.text.startsWith("for "));
  assert.equal(decisionResult(loop, trace, graph, mergeSource, 30), null);
});

test("decisionResult is null for a line that is not a condition", () => {
  const { source: mergeSource, trace } = FIXTURES.mergeSort;
  const graph = buildExecutionGraph(trace, mergeSource);
  const plain = graph.nodes.find((entry) => entry.text === "mid = len(arr) // 2");
  assert.equal(decisionResult(plain, trace, graph, mergeSource, 7), null);
});
