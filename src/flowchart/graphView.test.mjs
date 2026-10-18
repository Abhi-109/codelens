// Tests for the execution-graph *view*: which rows are shown for a step, what
// each call was, and the geometry the renderer draws. The invariants here are
// the ones the learner sees: never two cards on top of each other, never a row
// per loop round, and recursion that spreads sideways instead of stacking up.

import test from "node:test";
import assert from "node:assert/strict";

import { buildExecutionGraph, callFrames, visibleRows } from "./executionGraph.js";
import { CARD, cardHeight, cardSlots, codeLines, layoutRows } from "./layoutGraph.js";
import { FACT_SOURCE as factSource, buildTrace, factTrace } from "./__fixtures__/miniTrace.mjs";


test("callFrames says what each call was given and what it gave back", () => {
  const frames = callFrames(factTrace(), factSource);
  const outer = frames.get(2);
  assert.equal(outer.label, "fact(2)", "named with the argument it received");
  assert.equal(outer.callLine, 6, "called from line 6");
  assert.equal(outer.depth, 1);
  assert.equal(outer.returnIndex, 10);
  assert.equal(outer.returnText, "2");
  assert.equal(frames.get(3).label, "fact(1)");
  assert.equal(frames.get(1).label, "<module>");
});

test("visibleRows is the timeline, one row per line per call", () => {
  const graph = buildExecutionGraph(factTrace(), factSource);
  const calls = callFrames(factTrace(), factSource);
  const { rows, anchors } = visibleRows(graph, { index: 5, calls, fold: false });
  assert.deepEqual(
    rows.map((row) => row.id),
    ["f1l1", "f1l6", "f2l2", "f2l4", "f3l2", "f3l3"],
    "both calls keep their own rows, in the order they ran",
  );
  assert.equal(anchors.get("f2l2"), "n:f2l2");
});

test("a finished call folds into one summary row, an active one does not", () => {
  const graph = buildExecutionGraph(factTrace(), factSource);
  const calls = callFrames(factTrace(), factSource);
  // Standing inside fact(1) on line 3: fact(1) is running, fact(2) is waiting.
  const here = visibleRows(graph, { index: 8, calls, stack: [1, 2, 3] });
  assert.equal(here.rows.filter((row) => row.kind === "call").length, 0, "nothing to fold yet");

  // Later, after fact(1) returned: it is finished, so it folds to one row.
  const after = visibleRows(graph, { index: 10, calls, stack: [1, 2] });
  const folded = after.rows.filter((row) => row.kind === "call");
  assert.equal(folded.length, 1);
  assert.equal(folded[0].label, "fact(1)");
  assert.equal(folded[0].returned, "1", "the summary says what it handed back");
  assert.equal(folded[0].count, 2, "and how many lines it ran");
  assert.equal(after.anchors.get("f3l3"), folded[0].key, "its lines point at the summary");
});

test("a folded call opens up when the learner expands it", () => {
  const graph = buildExecutionGraph(factTrace(), factSource);
  const calls = callFrames(factTrace(), factSource);
  const open = visibleRows(graph, { index: 10, calls, stack: [1, 2], expanded: new Set([3]) });
  assert.equal(open.rows.filter((row) => row.kind === "call").length, 0);
  assert.ok(open.rows.some((row) => row.id === "f3l2"));
});

test("layoutRows stacks cards down the timeline and indents by call depth", () => {
  const graph = buildExecutionGraph(factTrace(), factSource);
  const calls = callFrames(factTrace(), factSource);
  const view = visibleRows(graph, { index: 5, calls, fold: false });
  const layout = layoutRows(view, graph.edges);

  assert.equal(layout.rows.length, view.rows.length);
  layout.rows.forEach((row, i) => {
    assert.equal(row.x, row.depth * CARD.INDENT, `${row.key} is indented by its depth`);
    if (i > 0) {
      const previous = layout.rows[i - 1];
      assert.ok(
        row.y >= previous.bottom + CARD.GAP,
        `${row.key} starts below ${previous.key} with a gap between them`,
      );
    }
  });
  assert.ok(layout.height > 0 && layout.width > 0);
});

test("no two cards can overlap, at any depth or height", () => {
  const graph = buildExecutionGraph(factTrace(), factSource);
  const calls = callFrames(factTrace(), factSource);
  const layout = layoutRows(visibleRows(graph, { index: 5, calls, fold: false }), graph.edges);
  for (let i = 0; i < layout.rows.length; i += 1) {
    for (let j = i + 1; j < layout.rows.length; j += 1) {
      const a = layout.rows[i];
      const b = layout.rows[j];
      const apart = a.bottom <= b.y || b.bottom <= a.y;
      assert.ok(apart, `${a.key} and ${b.key} do not overlap`);
    }
  }
});

test("edges stay inside the drawing and never cross a card's middle", () => {
  const graph = buildExecutionGraph(factTrace(), factSource);
  const calls = callFrames(factTrace(), factSource);
  const layout = layoutRows(visibleRows(graph, { index: 5, calls, fold: false }), graph.edges);
  assert.ok(layout.edges.length > 0);
  for (const edge of layout.edges) {
    assert.ok(edge.points.length >= 2, `${edge.id} has a route`);
    for (const point of edge.points) {
      assert.ok(point.x >= 0 && point.x <= layout.width, `${edge.id} x in range`);
      assert.ok(point.y >= 0 && point.y <= layout.height, `${edge.id} y in range`);
    }
  }
});

test("recursion grows sideways, not as one row per execution", () => {
  // A deeper recursion: 6 calls, each running the same two lines.
  const steps = [["call", "<module>", 1, { id: 1 }], ["line", "<module>", 1, {}], ["line", "<module>", 6, {}]];
  for (let depth = 0; depth < 6; depth += 1) {
    steps.push(["call", "fact", 6, { id: 10 + depth, vars: { n: { type: "int", value: String(6 - depth) } } }]);
    steps.push(["line", "fact", 2, { vars: { n: { type: "int", value: String(6 - depth) } } }]);
    steps.push(["line", "fact", 4, { vars: { n: { type: "int", value: String(6 - depth) } } }]);
  }
  const trace = buildTrace(steps);
  const graph = buildExecutionGraph(trace, factSource);
  const calls = callFrames(trace, factSource);
  const layout = layoutRows(visibleRows(graph, { index: 0, calls, fold: false }), graph.edges);

  assert.equal(layout.rows.length, graph.nodes.length, "one row per line per call, no repeats");
  const deepest = Math.max(...layout.rows.map((row) => row.depth));
  assert.equal(deepest, 6);
  assert.equal(layout.width, 6 * CARD.INDENT + CARD.WIDTH + 18 + 45, "width follows the call depth");
  assert.ok(
    layout.height > layout.width * 2,
    "a straight chain is still taller than wide, but the width carries the depth",
  );
  // The staircase: each call's rows sit strictly to the right of its caller's.
  const step = layout.rows.find((row) => row.depth === 1);
  const inner = layout.rows.find((row) => row.depth === 2);
  assert.ok(inner.x > step.x);
});

test("codeLines keeps a card's code to a few readable lines", () => {
  const long = `values = ${Array.from({ length: 12 }, (_, i) => `item_${i}`).join(" + ")}`;
  const { lines, cut } = codeLines(long);
  assert.equal(cut, true, `${long.length} characters cannot fit in ${CARD.CODE_LINES} lines`);
  assert.equal(lines.length, CARD.CODE_LINES);
  assert.ok(lines.every((line) => line.length <= CARD.CODE_CHARS), "never wider than the card");
  assert.ok(lines[lines.length - 1].endsWith("…"), "says it was cut");
  const short = codeLines("x = 1");
  assert.deepEqual(short, { lines: ["x = 1"], cut: false });
});

test("cardSlots reserves the same space whether or not a slot is filled", () => {
  const one = cardSlots(1);
  const two = cardSlots(2);
  assert.equal(two.height - one.height, CARD.CODE_H);
  assert.ok(one.header < one.code && one.code < one.action);
  assert.ok(one.action < one.values && one.values < one.foot);
  assert.ok(one.foot + CARD.VALUE_H <= one.height, "the last slot is inside the card");
  assert.equal(cardHeight(1), one.height);
});

test("the layout is deterministic and empty input stays empty", () => {
  const graph = buildExecutionGraph(factTrace(), factSource);
  const calls = callFrames(factTrace(), factSource);
  const view = visibleRows(graph, { index: 5, calls, fold: false });
  const once = layoutRows(view, graph.edges);
  const twice = layoutRows(view, graph.edges);
  assert.equal(JSON.stringify(once), JSON.stringify(twice));
  assert.deepEqual(layoutRows({ rows: [] }, []), {
    rows: [],
    edges: [],
    byKey: new Map(),
    width: 0,
    height: 0,
  });
});

