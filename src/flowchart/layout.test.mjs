// Unit tests for the flowchart graph layout (src/flowchart/layout.js).
//
//   node --test src/flowchart/layout.test.mjs
//
// dagre is deterministic, so positions are stable enough to assert ordering
// (which node sits above which), without pinning exact pixels.

import assert from "node:assert/strict";
import { test } from "node:test";
import { layoutChart, measureNode, wrapText } from "./layout.js";

// A chart shaped like flowchart.build_flowchart's for:
//   total = 0              (line 1)
//   for n in range(1, 6):  (line 2)
//       total = total + n  (line 3)
//   print(total)           (line 4)
const mainChart = {
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
    { id: "n5", kind: "process", label: "Add n to total", code: "total = total + n", lines: [3, 3] },
    { id: "n6", kind: "io", label: "Show total", code: "print(total)", lines: [4, 4] },
  ],
  edges: [
    { from: "n1", to: "n3", label: null, back: false },
    { from: "n3", to: "n4", label: null, back: false },
    { from: "n4", to: "n5", label: "Yes", back: false },
    { from: "n4", to: "n6", label: "No", back: false },
    { from: "n5", to: "n4", label: null, back: true },
    { from: "n6", to: "n2", label: null, back: false },
  ],
};

function nodeById(layout, id) {
  return layout.nodes.find((n) => n.id === id);
}

test("wrapText wraps at word boundaries", () => {
  assert.deepEqual(wrapText("one two three four five", 9), ["one two", "three", "four five"]);
  assert.deepEqual(wrapText("short", 20), ["short"]);
});

test("wrapText hard-splits a single overlong word and never returns nothing", () => {
  assert.deepEqual(wrapText("supercalifragilistic", 8), ["supercal", "ifragili", "stic"]);
  assert.deepEqual(wrapText("", 10), [""]);
  assert.deepEqual(wrapText(null, 10), [""]);
});

test("measureNode respects the minimum size for each kind", () => {
  const start = measureNode({ kind: "start", label: "Start" });
  assert.ok(start.width >= 90);
  assert.ok(start.height >= 36);
  const process = measureNode({ kind: "process", label: "Make total = 0" });
  assert.ok(process.width >= 140);
  assert.deepEqual(process.displayLines, ["Make total = 0"]);
});

test("measureNode gives diamonds the extra width their text needs", () => {
  const process = measureNode({ kind: "process", label: "Is this true?" });
  const decision = measureNode({ kind: "decision", label: "Is this true?" });
  assert.ok(decision.width > process.width);
});

test("measureNode wraps a long label onto several lines", () => {
  const node = measureNode({ kind: "process", label: "Make a very long variable name equal to a value" });
  assert.ok(node.displayLines.length > 1);
  assert.ok(node.height > 44);
});

test("measureNode can measure the raw code instead of the label", () => {
  const node = measureNode({ kind: "process", label: "Make x", code: "x = compute(1, 2)" }, true);
  assert.deepEqual(node.displayLines, ["x = compute(1, 2)"]);
});

test("layoutChart returns an empty layout for a missing or empty chart", () => {
  assert.deepEqual(layoutChart(null), { nodes: [], edges: [], width: 0, height: 0 });
  assert.deepEqual(layoutChart({ nodes: [] }), { nodes: [], edges: [], width: 0, height: 0 });
});

test("layoutChart positions every node with finite coordinates", () => {
  const layout = layoutChart(mainChart);
  assert.equal(layout.nodes.length, mainChart.nodes.length);
  assert.ok(layout.width > 0);
  assert.ok(layout.height > 0);
  for (const node of layout.nodes) {
    assert.ok(Number.isFinite(node.x), `${node.id} x`);
    assert.ok(Number.isFinite(node.y), `${node.id} y`);
    assert.ok(node.width > 0 && node.height > 0);
    assert.ok(Array.isArray(node.displayLines));
  }
});

test("layoutChart stacks the main path top to bottom", () => {
  const layout = layoutChart(mainChart);
  const y = (id) => nodeById(layout, id).y;
  assert.ok(y("n1") < y("n3"), "start above the assignment");
  assert.ok(y("n3") < y("n4"), "assignment above the loop");
  assert.ok(y("n4") < y("n5"), "loop above its body");
  assert.ok(y("n4") < y("n6"), "loop above the exit branch");
  assert.ok(y("n6") < y("n2"), "exit branch above the end");
});

test("layoutChart gives every edge a polyline and keeps the back flag", () => {
  const layout = layoutChart(mainChart);
  assert.equal(layout.edges.length, mainChart.edges.length);
  for (const edge of layout.edges) {
    assert.ok(edge.points.length >= 2, `${edge.from}->${edge.to} points`);
  }
  const back = layout.edges.find((e) => e.back);
  assert.ok(back, "the loop back edge survives");
  assert.equal(back.to, "n4");
});

test("layoutChart places labels on Yes/No edges", () => {
  const layout = layoutChart(mainChart);
  const yes = layout.edges.find((e) => e.label === "Yes");
  const no = layout.edges.find((e) => e.label === "No");
  assert.ok(Number.isFinite(yes.labelX) && Number.isFinite(yes.labelY));
  assert.ok(Number.isFinite(no.labelX) && Number.isFinite(no.labelY));
  const plain = layout.edges.find((e) => e.label === null);
  assert.equal(plain.labelX, null);
});
