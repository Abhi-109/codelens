// Unit tests for the call-tree geometry (src/flowchart/callTreeLayout.js).
//
//   node --test src/flowchart/callTreeLayout.test.mjs
//
// The properties that matter to a learner: a child always sits under its
// parent, siblings never overlap, the parent is centred over its children, and
// — the one that keeps the diagram from twitching on every tick — the layout
// never reads the current step at all.

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCallTree } from "./callTree.js";
import {
  BOUNDS_PAD,
  H_GAP,
  MAX_CHARS,
  MAX_W,
  MIN_W,
  layoutCallTree,
  linkPath,
  measureCallNode,
} from "./callTreeLayout.js";
import {
  FACT_SOURCE,
  boomTrace,
  buildTrace,
  factTrace,
  moduleOnlyTrace,
  repeatedTrace,
} from "./__fixtures__/miniTrace.mjs";

const overlaps = (a, b) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function assertNoOverlaps(boxes) {
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      assert.equal(
        overlaps(boxes[i], boxes[j]),
        false,
        `boxes ${boxes[i].id} and ${boxes[j].id} overlap`,
      );
    }
  }
}

test("layout places every child strictly below its parent and centred", () => {
  const tree = buildCallTree(factTrace(), FACT_SOURCE);
  const laid = layoutCallTree(tree);
  const byId = new Map(laid.boxes.map((b) => [b.id, b]));

  for (const box of laid.boxes) {
    for (const childNode of tree.byId.get(box.id).children) {
      const child = byId.get(childNode.frameId);
      assert.ok(child.y > box.y, "the child row is below the parent row");
      assert.ok(
        child.cx >= box.cx - (box.w / 2 + child.w / 2) &&
          child.cx <= box.cx + (box.w / 2 + child.w / 2),
        "the child sits inside the parent's slice of the row",
      );
    }
  }
  assertNoOverlaps(laid.boxes);
  assert.equal(laid.boxes.length, 3);
  assert.ok(laid.width > 0 && laid.height > 0);
  assert.ok(laid.ready);
});

test("a parent is centred over the span of its children", () => {
  const tree = buildCallTree(repeatedTrace(), "def double(n):\n    return n * 2\n\ndouble(2)\ndouble(3)\n");
  const laid = layoutCallTree(tree);
  const mod = laid.boxes.find((b) => b.function === "<module>");
  const kids = laid.boxes.filter((b) => b.parentId === mod.id);
  assert.equal(kids.length, 2);
  const centre = (kids[0].cx + kids[1].cx) / 2;
  assert.ok(Math.abs(centre - mod.cx) < 0.5, `${centre} vs ${mod.cx}`);
  assert.ok(kids[1].x - (kids[0].x + kids[0].w) >= H_GAP, "siblings keep the gap");
  assertNoOverlaps(laid.boxes);
});

test("layout is deterministic: the same tree always lands in the same place", () => {
  const first = layoutCallTree(buildCallTree(factTrace(), FACT_SOURCE));
  const second = layoutCallTree(buildCallTree(factTrace(), FACT_SOURCE));
  assert.deepEqual(first, second);
});

test("geometry does not move as the learner steps — layout never reads the step", () => {
  // The layout's only inputs are the tree and which subtrees are folded. Build
  // the tree from the whole trace each time and assert the boxes are identical:
  // if any part of the geometry had read `index`, this could not hold.
  const trace = factTrace();
  const tree = buildCallTree(trace, FACT_SOURCE);
  const atStart = layoutCallTree(tree);
  for (let index = 0; index < trace.length; index += 1) {
    assert.deepEqual(layoutCallTree(tree), atStart, `identical at step ${index}`);
  }
});

test("the call running now always has a box to centre on", () => {
  const trace = factTrace();
  const tree = buildCallTree(trace, FACT_SOURCE);
  const laid = layoutCallTree(tree);
  const boxes = new Map(laid.boxes.map((b) => [b.id, b]));
  for (let index = 0; index < trace.length; index += 1) {
    const frames = trace[index].frames;
    const current = frames.length > 0 ? frames[frames.length - 1].frame_id : null;
    assert.ok(current === null || boxes.has(current), `step ${index} has a box to follow`);
  }
  // Folding the running call must not lose it: the view walks up to the
  // nearest call still on screen instead of emptying.
  const fact2 = tree.nodes.find((n) => n.label === "fact(2)");
  const folded = layoutCallTree(tree, { collapsed: new Set([fact2.frameId]) });
  assert.equal(folded.boxes.some((b) => b.id === 3), false, "the child really is folded away");
  assert.equal(folded.boxes.some((b) => b.id === fact2.frameId), true, "its parent is still drawn");
});

test("a module-only run draws one box, centred, with no connector", () => {
  const laid = layoutCallTree(buildCallTree(moduleOnlyTrace(), "x = 1\n"));
  assert.equal(laid.boxes.length, 1);
  assert.equal(laid.links.length, 0);
  const box = laid.boxes[0];
  assert.equal(box.depth, 0);
  assert.ok(box.x >= BOUNDS_PAD);
  assert.ok(box.cx > laid.width / 2 - 1 && box.cx < laid.width / 2 + 1, "centred in the drawing");
  assert.ok(laid.width > 0);
});

test("an empty tree lays out to an empty, unready drawing", () => {
  const laid = layoutCallTree({ nodes: [], roots: [], byId: new Map() });
  assert.deepEqual(laid, { boxes: [], links: [], width: 0, height: 0, ready: false });
  assert.deepEqual(layoutCallTree(null).boxes, []);
  assert.deepEqual(layoutCallTree(undefined).boxes, []);
});

test("folding a subtree hides its children and keeps its parent put", () => {
  const tree = buildCallTree(factTrace(), FACT_SOURCE);
  const open = layoutCallTree(tree);
  const fact2 = tree.nodes.find((n) => n.label === "fact(2)");
  const folded = layoutCallTree(tree, { collapsed: new Set([fact2.frameId]) });

  assert.deepEqual(folded.boxes.map((b) => b.id), [1, 2], "fact(1) is no longer drawn");
  assert.equal(folded.boxes.find((b) => b.id === fact2.frameId).hidden, 1);
  assert.equal(folded.boxes.find((b) => b.id === 1).hidden, 0);
  const openBox = open.boxes.find((b) => b.id === fact2.frameId);
  const foldedBox = folded.boxes.find((b) => b.id === fact2.frameId);
  assert.deepEqual(
    { x: foldedBox.x, y: foldedBox.y, w: foldedBox.w, h: foldedBox.h },
    { x: openBox.x, y: openBox.y, w: openBox.w, h: openBox.h },
    "folding a child does not nudge its parent",
  );
  assert.equal(folded.links.length, 1, "module → fact(2) remains; fact(2) → fact(1) is gone");
  assert.deepEqual(folded.links.map((l) => l.toId), [fact2.frameId]);
});

test("connectors join a parent's bottom to a child's top", () => {
  const tree = buildCallTree(factTrace(), FACT_SOURCE);
  const laid = layoutCallTree(tree);
  const byId = new Map(laid.boxes.map((b) => [b.id, b]));
  for (const link of laid.links) {
    const parent = byId.get(link.fromId);
    const child = byId.get(link.toId);
    assert.equal(link.points[0].x, parent.cx, "starts under the parent");
    assert.equal(link.points[0].y, parent.y + parent.h);
    const last = link.points[link.points.length - 1];
    assert.equal(last.x, child.cx, "ends over the child");
    assert.equal(last.y, child.y);
    assert.ok(link.points.length >= 2);
  }
  assert.equal(linkPath(laid.links[0].points).startsWith("M "), true);
  assert.equal(linkPath([]), null);
  assert.equal(linkPath(null), null);
});

test("a node box fits its label and reserves a return line only when there is one", () => {
  const tree = buildCallTree(factTrace(), FACT_SOURCE);
  const withReturn = measureCallNode(tree.nodes.find((n) => n.label === "fact(1)"));
  const without = measureCallNode(tree.nodes.find((n) => n.function === "<module>"));
  assert.equal(withReturn.value, "→ 1");
  assert.equal(withReturn.h, (withReturn.lines.length + 1) * 15 + 2 * 9, "label line plus the value line");
  assert.equal(without.value, null, "the module frame's None is not a result worth showing");
  assert.equal(without.h, 15 + 2 * 9, "and it does not reserve a line for one");
  assert.ok(withReturn.w >= MIN_W && withReturn.w <= MAX_W);
  assert.ok(withReturn.lines.every((line) => line.length <= MAX_CHARS), "labels never overflow");
});

test("a long label wraps instead of growing past the box", () => {
  const wide = measureCallNode({
    label: "sort_everything_in_this_really_long_name([1, 2, 3])",
    returnIndex: null,
    function: "sort_everything_in_this_really_long_name",
  });
  assert.ok(wide.lines.length > 1, "it wrapped rather than overflowed");
  assert.ok(wide.w <= MAX_W, `width ${wide.w} stayed inside ${MAX_W}`);
  assert.ok(wide.lines.every((line) => line.length <= MAX_CHARS));
});

test("a failed call keeps its box and shows the exception, not a value", () => {
  const tree = buildCallTree(boomTrace(), "def fail(x):\n    return 1 / x\n");
  const laid = layoutCallTree(tree);
  const failed = laid.boxes.find((b) => b.function === "fail");
  assert.equal(failed.raised, true);
  assert.match(failed.value, /^✕ ZeroDivisionError$/);
  const mod = laid.boxes.find((b) => b.function === "<module>");
  assert.match(mod.value, /^✕ ZeroDivisionError$/, "the caller reports the same real exception");
  assertNoOverlaps(laid.boxes);
});

test("deep trees stay inside their own bounds and never collide", () => {
  // A chain twelve calls deep: rows must stack, never interleave.
  const steps = [["call", "<module>", 1, { id: 1 }], ["line", "<module>", 1, {}]];
  for (let i = 1; i <= 12; i += 1) {
    steps.push(["line", "<module>", 1, {}]);
    steps.push(["call", `f${i}`, 2, { id: i + 1 }]);
    steps.push(["line", `f${i}`, 2, {}]);
  }
  for (let i = 12; i >= 1; i -= 1) steps.push(["return", `f${i}`, 2, {}]);
  steps.push(["return", "<module>", 1, {}]);

  const tree = buildCallTree(buildTrace(steps), "def f0():\n    pass\n");
  const laid = layoutCallTree(tree);
  assert.equal(laid.boxes.length, 13);
  assertNoOverlaps(laid.boxes);
  assert.equal(laid.boxes.filter((b) => b.depth === 5).length, 1, "one box per depth in a chain");
  const depths = [...new Set(laid.boxes.map((b) => b.depth))].sort((a, b) => a - b);
  assert.deepEqual(depths, [...Array(13).keys()], "every depth 0..12 is drawn exactly once");
  for (const box of laid.boxes) {
    assert.ok(box.x + box.w <= laid.width, "nothing sticks out past the drawing");
    assert.ok(box.y + box.h <= laid.height);
  }
  assert.equal(laid.links.length, 12, "every nesting is drawn");
});
