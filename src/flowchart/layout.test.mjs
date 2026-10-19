// Unit tests for the flowchart layout (src/flowchart/layout.js).
//
//   node --test src/flowchart/layout.test.mjs
//
// A chart in, boxes and arrows out. The properties a learner relies on: a box
// never sits on top of another, an arrow leaves the box that owns it and
// arrives at the box it names, a loop-back arrow goes round the side rather
// than through the middle — and the whole thing lands in exactly the same
// place every time, because a diagram that rearranges itself under the
// cursor is worse than no diagram at all.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CHANNEL_PAD,
  MARGIN,
  NODE_SEP,
  layoutChart,
  measureNode,
  pathOf,
  rankNodes,
} from "./layout.js";

// `total = 0` / `for n in range(1, 6):` / `total = total + n` / `print(total)`
// — one loop, one arrow that runs back to the diamond.
const looping = {
  name: "<main>",
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
    { from: "n5", to: "n4", label: null, back: true },
    { from: "n4", to: "n6", label: "No", back: false },
    { from: "n6", to: "n2", label: null, back: false },
  ],
};

// An if / else: two arms that rejoin, so two rows hold more than one box.
const branching = {
  name: "<main>",
  entry: "n1",
  exit: "n2",
  nodes: [
    { id: "n1", kind: "start", label: "Start", code: "", lines: null },
    { id: "n2", kind: "end", label: "End", code: "", lines: null },
    { id: "n3", kind: "process", label: "Make n = 3", code: "n = 3", lines: [1, 1] },
    { id: "n4", kind: "decision", label: "Is n ≤ 1?", code: "if n <= 1:", lines: [2, 2], test: "n <= 1" },
    { id: "n5", kind: "io", label: "Show 1", code: "print(1)", lines: [3, 3] },
    { id: "n6", kind: "io", label: "Show n", code: "print(n)", lines: [5, 5] },
  ],
  edges: [
    { from: "n1", to: "n3", label: null, back: false },
    { from: "n3", to: "n4", label: null, back: false },
    { from: "n4", to: "n5", label: "Yes", back: false },
    { from: "n4", to: "n6", label: "No", back: false },
    { from: "n5", to: "n2", label: null, back: false },
    { from: "n6", to: "n2", label: null, back: false },
  ],
};

const boxFor = (laid, id) => laid.nodes.find((n) => n.id === id);

const overlaps = (a, b) =>
  a.x - a.width / 2 < b.x + b.width / 2 &&
  b.x - b.width / 2 < a.x + a.width / 2 &&
  a.y - a.height / 2 < b.y + b.height / 2 &&
  b.y - b.height / 2 < a.y + a.height / 2;

function assertNoOverlaps(laid) {
  for (let i = 0; i < laid.nodes.length; i += 1) {
    for (let j = i + 1; j < laid.nodes.length; j += 1) {
      assert.equal(
        overlaps(laid.nodes[i], laid.nodes[j]),
        false,
        `${laid.nodes[i].id} and ${laid.nodes[j].id} overlap`,
      );
    }
  }
}

test("every box fits inside the drawing, with the margin kept", () => {
  for (const chart of [looping, branching]) {
    const laid = layoutChart(chart);
    assertNoOverlaps(laid);
    for (const node of laid.nodes) {
      assert.ok(node.x - node.width / 2 >= MARGIN - 1, `${node.id} kept its left margin`);
      assert.ok(node.x + node.width / 2 <= laid.width - MARGIN + 1, `${node.id} kept its right margin`);
      assert.ok(node.y - node.height / 2 >= MARGIN - 1, `${node.id} kept its top margin`);
      assert.ok(node.y + node.height / 2 <= laid.height - MARGIN + 1, `${node.id} kept its bottom margin`);
    }
  }
});

test("an arrow leaves the box that owns it and arrives at the box it names", () => {
  for (const chart of [looping, branching]) {
    const laid = layoutChart(chart);
    const byId = new Map(laid.nodes.map((n) => [n.id, n]));
    assert.equal(laid.edges.length, chart.edges.length, "every edge is drawn");
    for (const edge of laid.edges) {
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      const start = edge.points[0];
      const end = edge.points[edge.points.length - 1];
      assert.ok(
        Math.abs(start.x - from.x) <= from.width / 2 + 1 && Math.abs(start.y - from.y) <= from.height / 2 + 1,
        `${edge.from}→${edge.to} starts on ${edge.from}`,
      );
      assert.ok(
        Math.abs(end.x - to.x) <= to.width / 2 + 1 && Math.abs(end.y - to.y) <= to.height / 2 + 1,
        `${edge.from}→${edge.to} ends on ${edge.to}`,
      );
    }
  }
});

test("a loop-back arrow goes round the right-hand side, not through the middle", () => {
  const laid = layoutChart(looping);
  const back = laid.edges.find((e) => e.back);
  assert.ok(back, "the loop's return arrow is marked back");
  assert.equal(back.from, "n5");
  assert.equal(back.to, "n4");
  const right = laid.nodes.reduce((most, n) => Math.max(most, n.x + n.width / 2), 0);
  assert.ok(back.points[1].x > right, `its channel (${back.points[1].x}) is clear of every box (${right})`);
  assert.ok(laid.width >= right + CHANNEL_PAD, "the drawing grows to fit the channel");
});

test("every Yes and No label sits beside the arrow that carries it", () => {
  const laid = layoutChart(looping);
  for (const edge of laid.edges.filter((e) => e.label)) {
    assert.ok(edge.labelX != null && edge.labelY != null, `${edge.label} has somewhere to go`);
    const start = edge.points[0];
    const end = edge.points[edge.points.length - 1];
    const low = Math.min(start.y, end.y) - 12;
    const high = Math.max(start.y, end.y) + 12;
    assert.ok(
      edge.labelY >= low && edge.labelY <= high,
      `${edge.label} sits along the arrow it names (y=${edge.labelY}, span ${start.y}→${end.y})`,
    );
    assert.ok(edge.labelX != start.x, `${edge.label} is beside the line, not on it`);
  }
});

test("the two arms of a branch sit side by side, above where they rejoin", () => {
  const laid = layoutChart(branching);
  const yes = boxFor(laid, "n5");
  const no = boxFor(laid, "n6");
  assert.equal(yes.y, no.y, "the same row");
  assert.ok(Math.abs(yes.x - no.x) > (yes.width + no.width) / 2, "but not on top of each other");
  assert.ok(boxFor(laid, "n4").y < yes.y, "both under the diamond that asked");
  assert.ok(boxFor(laid, "n2").y > yes.y, "both above where the paths rejoin");
});

test("layout is deterministic: the same chart always lands in the same place", () => {
  assert.deepEqual(layoutChart(looping), layoutChart(looping));
  assert.deepEqual(layoutChart(branching), layoutChart(branching));
  // Rebuilding the chart object from scratch must not change a pixel.
  assert.deepEqual(layoutChart(JSON.parse(JSON.stringify(looping))), layoutChart(looping));
});

test("an empty or missing chart lays out to an empty drawing", () => {
  for (const chart of [null, undefined, {}, { nodes: [] }, { nodes: null }]) {
    const laid = layoutChart(chart);
    assert.deepEqual(laid, { nodes: [], edges: [], width: 0, height: 0 });
  }
});

test("rankNodes puts each box one step below everything that reaches it", () => {
  const rank = rankNodes(branching.nodes, branching.edges);
  assert.equal(rank.get("n1"), 0);
  assert.ok(rank.get("n3") > rank.get("n1"));
  assert.ok(rank.get("n4") > rank.get("n3"));
  assert.ok(rank.get("n5") > rank.get("n4"));
  assert.ok(rank.get("n6") > rank.get("n4"));
  assert.ok(rank.get("n2") > rank.get("n5"), "the join sits below both arms");
  assert.ok(rank.get("n2") > rank.get("n6"));
});

test("a loop-back edge never drags the rank loop round forever", () => {
  const rank = rankNodes(looping.nodes, looping.edges);
  assert.equal(rank.get("n1"), 0);
  assert.ok(rank.get("n5") > rank.get("n4"), "the body is below the diamond");
  // Even an edge the format forgot to mark as `back` must terminate.
  const unmarked = looping.edges.map((e) => (e.from === "n5" && e.to === "n4" ? { ...e, back: false } : e));
  const capped = rankNodes(looping.nodes, unmarked);
  assert.ok(capped.get("n5") > capped.get("n4"), "the marked body still ranks below the diamond");
});

test("the crossing sweeps never disturb the depth they were built from", () => {
  // Regression. The sweeps rewrite their own index map on every pass; once
  // they were handed the rank map itself, every box afterwards was routed by
  // its position in a row rather than by how deep it sits, and the loop drew
  // five of its six arrows as loop-backs through the middle of the drawing.
  const laid = layoutChart(looping);
  const y = (id) => boxFor(laid, id).y;
  assert.ok(y("n1") < y("n3"), "the first statement is under Start");
  assert.ok(y("n3") < y("n4"), "the loop header is under the assignment");
  assert.ok(y("n4") < y("n5") && y("n4") < y("n6"), "the body and the exit are both under the diamond");
  assert.ok(y("n6") < y("n2"), "End is below whatever leads into it");
  assert.equal(laid.edges.filter((e) => e.back).length, 1, "exactly one arrow loops back");
});

test("measureNode sizes each kind to its own minimum and never overflows", () => {
  const decision = measureNode(branching.nodes.find((n) => n.id === "n4"));
  const process = measureNode(branching.nodes.find((n) => n.id === "n3"));
  assert.ok(decision.width > process.width * 1.2, "a diamond needs the extra room for its middle");
  assert.ok(decision.height >= 64);
  const wide = measureNode({ kind: "process", code: "x", label: "a".repeat(200) });
  assert.ok(wide.displayLines.length > 1, "a long label wrapped rather than overflowed");
  assert.ok(wide.width <= 300, `width ${wide.width} stayed bounded`);
  for (const line of wide.displayLines) assert.ok(line.length <= 26, `"${line}" fits its box`);
});

test("showing raw code relabels every box and nothing else", () => {
  const plain = layoutChart(looping);
  const coded = layoutChart(looping, { showCode: true });
  assert.deepEqual(coded.nodes.map((n) => n.id), plain.nodes.map((n) => n.id));
  for (const box of coded.nodes) {
    const before = boxFor(plain, box.id);
    assert.equal(box.kind, before.kind, `${box.id} is still the same kind of box`);
    assert.deepEqual(box.lines, before.lines, `${box.id} still owns the same source lines`);
  }
  // The code itself, characters intact, however the box had to wrap it.
  const strip = (text) => text.replace(/\s+/g, "");
  assert.equal(strip(boxFor(coded, "n4").displayLines.join("")), strip("for n in range(1, 6):"));
  assert.equal(
    strip(boxFor(plain, "n4").displayLines.join("")),
    strip("Any more numbers to go?"),
  );
  assert.notEqual(boxFor(coded, "n4").displayLines[0], boxFor(plain, "n4").displayLines[0]);
});

test("pathOf draws a polyline and refuses anything that is not one", () => {
  assert.equal(
    pathOf([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 20 }]),
    "M 0 0 L 10 0 L 10 20",
  );
  assert.equal(pathOf([]), "");
  assert.equal(pathOf(null), "");
  assert.equal(pathOf([{ x: 0, y: 0 }]), "");
});

test("gaps between boxes and between rows stay as configured", () => {
  const laid = layoutChart(branching);
  const yes = boxFor(laid, "n5");
  const no = boxFor(laid, "n6");
  const gap = Math.abs(no.x - yes.x) - (yes.width + no.width) / 2;
  assert.ok(gap >= NODE_SEP - 1, `siblings kept at least ${NODE_SEP}px between them`);
});
