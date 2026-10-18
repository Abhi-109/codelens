// What a card in the execution graph says. These tests pin the learning claims:
// the values come from the step the line ran on, a change reads "before → after",
// the next step says where control goes and why, and a card for a line that has
// not run yet says so instead of showing a stale value.

import test from "node:test";
import assert from "node:assert/strict";

import { buildExecutionGraph, callFrames, visibleRows } from "./executionGraph.js";
import { layoutRows } from "./layoutGraph.js";
import { VALUE_CHARS, cardBody, lastAtOrBefore, nextStep, nodeRunIndex, valueLine } from "./nodeBody.js";
import { FACT_SOURCE, buildTrace, factTrace } from "./__fixtures__/miniTrace.mjs";

/** A trace with one loop: the same line runs three times with a new value. */
function loopTrace() {
  return buildTrace([
    ["call", "<module>", 1, { id: 1 }],
    ["line", "<module>", 1, {}],
    ["line", "<module>", 2, { vars: { total: { type: "int", value: "0" } } }],
    ["line", "<module>", 3, { vars: { total: { type: "int", value: "0" } } }],
    ["line", "<module>", 2, { vars: { total: { type: "int", value: "1" } } }],
    ["line", "<module>", 3, { vars: { total: { type: "int", value: "1" } } }],
    ["line", "<module>", 2, { vars: { total: { type: "int", value: "3" } } }],
    ["line", "<module>", 4, { vars: { total: { type: "int", value: "3" } } }],
    ["return", "<module>", 4, {}],
  ]);
}

const LOOP_SOURCE = [
  "total = 0",
  "for n in [1, 2]:",
  "    total += n",
  "print(total)",
].join("\n");

const layoutOf = (trace, source, index, options = {}) => {
  const graph = buildExecutionGraph(trace, source);
  const calls = callFrames(trace, source);
  const shown = visibleRows(graph, { index, calls, fold: options.fold ?? false });
  return { graph, calls, laid: layoutRows(shown, graph.edges) };
};

test("nodeRunIndex counts the line running, not the events around it", () => {
  const trace = loopTrace();
  const graph = buildExecutionGraph(trace, LOOP_SOURCE);
  const runs = nodeRunIndex(trace, graph);
  assert.equal(runs.get("f1l2").length, 3, "the loop header ran once per round, then once more to finish");
  assert.equal(runs.get("f1l3").length, 2, "the body ran twice");
  assert.equal(runs.get("f1l4").length, 1);
  assert.equal(nodeRunIndex([], null).size, 0);
});

test("lastAtOrBefore finds an earlier run, and says when there is none", () => {
  assert.equal(lastAtOrBefore([2, 4, 6], 5), 4);
  assert.equal(lastAtOrBefore([2, 4, 6], 6), 6);
  assert.equal(lastAtOrBefore([2, 4, 6], 1), -1);
  assert.equal(lastAtOrBefore([], 9), -1);
});

test("valueLine leads with the change this run makes", () => {
  const trace = loopTrace();
  const { graph } = layoutOf(trace, LOOP_SOURCE, 5);
  const node = graph.nodes.find((entry) => entry.id === "f1l3");
  const body = cardBody(node, {
    graph,
    trace,
    source: LOOP_SOURCE,
    index: 5,
    usable: nodeRunIndex(trace, graph),
  });
  assert.match(body.values, /total: 1 → 3/, body.values);
  assert.equal(body.changed, true, "a change is flagged for the card styling");
});

test("valueLine never hides an overflow, and stays one line wide", () => {
  const view = {
    changes: [],
    frame: {
      variables: [
        { name: "alpha", text: "1", isArg: false },
        { name: "beta", text: "2", isArg: false },
        { name: "gamma", text: "3", isArg: false },
        { name: "delta", text: "4", isArg: false },
        { name: "epsilon", text: "5", isArg: false },
      ],
    },
  };
  const line = valueLine(view, { text: "alpha + beta" });
  assert.ok(line.length <= VALUE_CHARS + 12, line);
  assert.match(line, /more\)/, `overflow is counted: ${line}`);
  assert.match(line, /alpha/, "the name the code uses comes first");
});

test("valueLine shows a new name as created, not as a change", () => {
  const view = {
    changes: [{ kind: "new", name: "x", from: null, to: "5" }],
    frame: { variables: [{ name: "x", text: "5", isArg: false }] },
  };
  assert.equal(valueLine(view, { text: "x = 5" }), "x = 5");
  assert.equal(valueLine({ changes: [], frame: null }, { text: "pass" }), "");
});

test("nextStep names the move and its reason", () => {
  const trace = factTrace();
  const graph = buildExecutionGraph(trace, FACT_SOURCE);
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const callSite = graph.nodes.find((node) => node.id === "f1l6");
  const step = nextStep(2, callSite, graph, trace, { source: FACT_SOURCE, nodesById });
  assert.equal(step.reason, "call");
  assert.equal(step.line, 2, "the first line of the callee");
  assert.match(step.text, /call → line 2/);
});

test("a returning line says what it handed back and where it went", () => {
  const trace = factTrace();
  const graph = buildExecutionGraph(trace, FACT_SOURCE);
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const inner = graph.nodes.find((node) => node.id === "f3l3");
  const step = nextStep(8, inner, graph, trace, { source: FACT_SOURCE, nodesById });
  assert.equal(step.reason, "return");
  assert.match(step.text, /returns 1/, step.text);
  assert.match(step.text, /line 4/, "and which line carries on");
});

test("the last line of the run says so instead of inventing a next step", () => {
  const trace = factTrace();
  const graph = buildExecutionGraph(trace, FACT_SOURCE);
  const last = graph.nodes.find((node) => node.id === "f1l6");
  const step = nextStep(trace.length - 1, last, graph, trace, { source: FACT_SOURCE });
  assert.equal(step.text, "end of the run");
  assert.equal(step.line, null);
});

test("cardBody marks the current line, the ones ahead and how often a line ran", () => {
  const trace = factTrace();
  const { graph, laid } = layoutOf(trace, FACT_SOURCE, 5);
  const usable = nodeRunIndex(trace, graph);
  const byId = new Map(laid.rows.filter((row) => row.kind === "node").map((row) => [row.id, row]));

  const at = cardBody(byId.get("f2l4"), { graph, trace, source: FACT_SOURCE, index: 5, usable });
  assert.equal(at.current, true, "the line running now");
  assert.equal(at.ahead, false);

  const ahead = cardBody(byId.get("f3l3"), { graph, trace, source: FACT_SOURCE, index: 5, usable });
  assert.equal(ahead.ahead, true, "a line that has not run yet is marked, not guessed");

  const loopRuns = cardBody(byId.get("f2l4"), { graph, trace, source: FACT_SOURCE, index: 5, usable });
  assert.equal(loopRuns.ran, 1);
});

test("every card of a real trace builds, and none of them throws", () => {
  const trace = factTrace();
  for (let index = 0; index < trace.length; index += 1) {
    const { graph, laid } = layoutOf(trace, FACT_SOURCE, index);
    const usable = nodeRunIndex(trace, graph);
    const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
    for (const row of laid.rows) {
      if (row.kind !== "node") continue;
      const body = cardBody(row, {
        graph,
        trace,
        source: FACT_SOURCE,
        index,
        usable,
        nodesById,
      });
      assert.ok(typeof body.values === "string" && typeof body.foot === "string");
      assert.doesNotMatch(
        `${body.values} ${body.foot}`,
        /undefined|null|\[object|NaN/,
        `step ${index + 1}, ${row.id}: "${body.values}" / "${body.foot}"`,
      );
    }
  }
});

test("a broken trace is handled, not thrown", () => {
  const body = cardBody(
    { id: "f1l1", frameId: 1, line: 1, text: "x = 1", action: "Set x", depth: 0 },
    { graph: { steps: [null], nodes: [], edges: [] }, trace: [], source: "" },
  );
  assert.equal(body.current, false);
  assert.equal(body.values, "");
  assert.equal(body.foot, "");
});
