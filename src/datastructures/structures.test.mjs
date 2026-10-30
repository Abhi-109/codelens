// The capabilities the screenshots said were missing: array capacity, linked
// list variants and cycles, stack search, circular and priority queues, BST
// deletion, and graph editing. Each is checked against the authored model,
// not against a screenshot.
//
//   node --test src/datastructures/structures.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

import { applyOperation, initialState } from "./model.js";
import { layoutGraph } from "./graphLayout.js";

const run = (type, state, op, input = {}) => applyOperation(type, state, op, input);
const ok = (type, state, op, input = {}) => {
  const result = run(type, state, op, input);
  assert.ok(!result.error, `${type}.${op}: ${result.error}`);
  assert.ok(result.frames.length > 0);
  assert.deepEqual(result.frames.at(-1).state, result.state);
  return result;
};
const inorder = (root) => {
  const values = [];
  const walk = (at) => {
    if (!at) return;
    walk(at.left);
    values.push(at.value);
    walk(at.right);
  };
  walk(root);
  return values;
};
const treeOf = (values) => {
  let state = initialState("bst");
  for (const value of values) state = ok("bst", state, "insert", { value }).state;
  return state;
};

/* --- Array ---------------------------------------------------------------- */

test("an array grows manually and keeps every value", () => {
  const start = initialState("array");
  const grown = ok("array", start, "resize", { capacity: 8 });
  assert.equal(grown.state.capacity, 8);
  assert.deepEqual(grown.state.values, [4, 7, 1]);
  assert.match(grown.frames[0].text, /from 4 to 8/);
  assert.match(grown.frames[0].text, /new slots are empty/);
  assert.equal(grown.state.values.length, 3, "capacity is not length");
});

test("shrinking is refused when a value would be lost", () => {
  const start = initialState("array");
  const refused = run("array", start, "resize", { capacity: 2 });
  assert.match(refused.error, /Cannot shrink to 2/);
  assert.match(refused.error, /holds 3 values/);
  assert.equal(refused.frames, undefined);

  const exact = ok("array", start, "resize", { capacity: 3 });
  assert.equal(exact.state.capacity, 3);
  assert.deepEqual(exact.state.values, [4, 7, 1]);
  assert.match(exact.frames[0].text, /released slots were empty/);
});

test("array resize validates the requested capacity", () => {
  const start = initialState("array");
  for (const capacity of [0, -1, 1.5, 300, "x"]) {
    const refused = run("array", start, "resize", { capacity });
    assert.ok(refused.error, `${capacity} is refused`);
  }
  assert.match(run("array", start, "resize", { capacity: 4 }).error, /already has capacity/);
});

test("clearing an array removes every value but keeps its capacity", () => {
  const start = { ...initialState("array"), capacity: 8 };
  const cleared = ok("array", start, "clear", {});
  assert.deepEqual(cleared.state.values, []);
  assert.equal(cleared.state.capacity, 8);
  assert.match(cleared.frames[0].text, /all 3 values are removed/);
  assert.match(run("array", cleared.state, "search", { value: 4 }).error, /empty/);
});

/* --- Linked list ---------------------------------------------------------- */

test("a doubly linked list traverses both ways with previous pointers", () => {
  const start = initialState("linked-list");
  const forward = ok("linked-list", start, "traverse", {});
  assert.doesNotMatch(forward.frames[0].text, /points back/);

  const doubled = ok("linked-list", start, "mode", { mode: "doubly" });
  assert.equal(doubled.state.doubly, true);
  assert.match(doubled.frames[0].text, /previous pointer/);

  const backwardMode = run("linked-list", start, "traverse-backward", {});
  assert.match(backwardMode.error, /no previous pointers/);

  const back = ok("linked-list", doubled.state, "traverse-backward", {});
  assert.equal(back.frames.length, 3);
  assert.match(back.frames[0].text, /Visit C from the tail; previous is B/);
  assert.match(back.frames.at(-1).text, /previous is null/);

  const doublyForward = ok("linked-list", doubled.state, "traverse", {});
  assert.match(doublyForward.frames[0].text, /points back to null/);
});

test("insert and delete keep both sets of pointers consistent", () => {
  const doubled = ok("linked-list", initialState("linked-list"), "mode", { mode: "doubly" }).state;
  const prepended = ok("linked-list", doubled, "prepend", { value: "Z" });
  assert.deepEqual(prepended.state.values, ["Z", "A", "B", "C"]);
  assert.equal(prepended.state.doubly, true);
  const removed = ok("linked-list", prepended.state, "remove", { value: "B" });
  assert.deepEqual(removed.state.values, ["Z", "A", "C"]);
  assert.equal(removed.state.doubly, true);
});

test("an explicit cycle is detected, blocks mutations, and can be broken", () => {
  const start = initialState("linked-list");
  const missed = ok("linked-list", start, "detect-cycle", {});
  assert.match(missed.frames.at(-1).text, /no cycle/);

  const cycled = ok("linked-list", start, "cycle", { to: 1 });
  assert.equal(cycled.state.cycleTo, 1);
  assert.match(cycled.frames[0].text, /cycle of length 2/);

  const detected = ok("linked-list", cycled.state, "detect-cycle", {});
  assert.match(detected.frames.at(-1).text, /Cycle entry at node 1 \(B\); cycle length 2/);

  const blocked = run("linked-list", cycled.state, "append", { value: "D" });
  assert.match(blocked.error, /break it before changing the links/);
  assert.match(run("linked-list", cycled.state, "remove", { value: "A" }).error, /break it/);

  const broken = ok("linked-list", cycled.state, "break-cycle", {});
  assert.equal(broken.state.cycleTo, null);
  const appended = ok("linked-list", broken.state, "append", { value: "D" });
  assert.deepEqual(appended.state.values, ["A", "B", "C", "D"]);
});

test("cycle construction validates its target", () => {
  const start = initialState("linked-list");
  assert.match(run("linked-list", start, "cycle", { to: 2 }).error, /from 0 to 1/);
  assert.match(run("linked-list", start, "cycle", { to: 9 }).error, /from 0 to 1/);
  const cycled = ok("linked-list", start, "cycle", { to: 0 }).state;
  assert.match(run("linked-list", cycled, "cycle", { to: 1 }).error, /already has a cycle/);
  assert.match(run("linked-list", initialState("linked-list"), "break-cycle", {}).error, /no cycle/);
});

/* --- Stack ---------------------------------------------------------------- */

test("stack search inspects downward from the top without changing the stack", () => {
  const state = { values: ["A", "B", "C"] };
  const found = ok("stack", state, "search", { value: "A" });
  assert.equal(found.frames.length, 3);
  assert.deepEqual(found.frames[0].marks.compare, ["2"]);
  assert.deepEqual(found.frames.at(-1).marks.found, ["0"]);
  assert.match(found.frames.at(-1).text, /position 0 below the top/);
  assert.match(found.frames.at(-1).text, /unchanged/);
  assert.deepEqual(found.state.values, ["A", "B", "C"]);

  const missing = ok("stack", state, "search", { value: "Z" });
  assert.match(missing.frames.at(-1).text, /not in the stack/);
  assert.match(missing.frames.at(-1).text, /not a normal stack operation/);
  assert.deepEqual(missing.state.values, ["A", "B", "C"]);

  assert.match(run("stack", { values: [] }, "search", { value: "A" }).error, /empty/);
  assert.match(run("stack", state, "search", { value: "" }).error, /Type a value/);
});

/* --- Queue ---------------------------------------------------------------- */

test("a circular queue tracks front and rear and wraps around", () => {
  const tripled = ok("queue", { values: ["A", "B"], mode: "simple", capacity: 5, front: 0, priorities: [] }, "mode", {
    mode: "circular",
    capacity: 3,
  });
  assert.equal(tripled.state.mode, "circular");
  assert.equal(tripled.state.capacity, 3);
  assert.match(tripled.frames[0].text, /circular buffer/);

  let state = tripled.state;
  state = ok("queue", state, "enqueue", { value: "C" }).state;
  assert.equal(state.values.length, 3);
  assert.match(run("queue", state, "enqueue", { value: "D" }).error, /full \(3 of 3/);

  const popped = ok("queue", state, "dequeue", {});
  state = popped.state;
  assert.equal(state.front, 1);
  assert.match(popped.frames[0].text, /front moves from slot 0 to slot 1/);

  const wrapped = ok("queue", state, "enqueue", { value: "D" });
  assert.equal(wrapped.state.values.length, 3);
  assert.match(wrapped.frames[0].text, /physical slot 0/);
  assert.match(wrapped.frames[0].text, /wrapped past the end/);
});

test("a priority queue removes the lowest priority first and keeps ties stable", () => {
  let state = ok("queue", initialState("queue"), "mode", { mode: "priority" }).state;
  assert.equal(state.mode, "priority");
  assert.deepEqual(state.priorities, [0, 0]);

  state = ok("queue", state, "enqueue", { value: "C", priority: 2 }).state;
  state = ok("queue", state, "enqueue", { value: "D", priority: 1 }).state;
  state = ok("queue", state, "enqueue", { value: "E", priority: 1 }).state;
  assert.deepEqual(state.values, ["A", "B", "D", "E", "C"]);
  assert.deepEqual(state.priorities, [0, 0, 1, 1, 2]);

  const first = ok("queue", state, "dequeue", {});
  assert.match(first.frames[0].text, /Dequeue A/);
  assert.match(first.frames[0].text, /priority 0/);
  const second = ok("queue", first.state, "dequeue", {});
  assert.match(second.frames[0].text, /Dequeue B/);
  assert.equal(second.state.values[0], "D", "ties keep arrival order");
});

test("queue mode changes validate the circular capacity", () => {
  const state = { values: ["A", "B", "C"], mode: "simple", capacity: 5, front: 0, priorities: [] };
  assert.match(run("queue", state, "mode", { mode: "circular", capacity: 2 }).error, /capacity from 3 to 12/);
  assert.equal(ok("queue", state, "mode", { mode: "circular", capacity: 3 }).state.capacity, 3);
  assert.equal(ok("queue", state, "mode", { mode: "simple" }).state.mode, "simple");
});

/* --- Binary search tree --------------------------------------------------- */

test("BST deletion removes a leaf and a one-child node", () => {
  const leafTree = treeOf([8, 3, 10, 1]);
  const leaf = ok("bst", leafTree, "delete", { value: 1 });
  assert.deepEqual(inorder(leaf.state.root), [3, 8, 10]);
  assert.match(leaf.frames.at(-1).text, /leaf 1/);

  const oneChild = ok("bst", leafTree, "delete", { value: 3 });
  assert.deepEqual(inorder(oneChild.state.root), [1, 8, 10]);
  assert.match(oneChild.frames.at(-1).text, /one child/);
  assert.match(oneChild.frames.at(-1).text, /\(1\) takes its place/);
});

test("BST deletion of a two-child root replaces it with its successor", () => {
  const state = treeOf([8, 3, 10, 1, 6, 14, 13]);
  const deleted = ok("bst", state, "delete", { value: 8 });
  assert.deepEqual(inorder(deleted.state.root), [1, 3, 6, 10, 13, 14]);
  assert.match(deleted.frames.at(-1).text, /Replace 8 with 10/);
  assert.ok(deleted.frames.some((entry) => /successor is 10/.test(entry.text)));
  assert.equal(deleted.state.root.value, 10, "the successor takes the root position");
});

test("repeated and missing BST deletions leave the tree alone", () => {
  const state = treeOf([8, 3, 10]);
  const missing = ok("bst", state, "delete", { value: 99 });
  assert.deepEqual(inorder(missing.state.root), [3, 8, 10]);
  assert.match(missing.frames.at(-1).text, /not in the tree, so nothing is deleted/);

  const removed = ok("bst", state, "delete", { value: 8 }).state;
  const again = ok("bst", removed, "delete", { value: 8 });
  assert.deepEqual(inorder(again.state.root), [3, 10]);
  assert.match(again.frames.at(-1).text, /nothing is deleted/);

  assert.match(run("bst", initialState("bst"), "delete", { value: 3 }).error, /empty/);
  assert.match(run("bst", state, "delete", { value: "x" }).error, /number/);
});

test("deleting the only node leaves an empty tree", () => {
  const single = ok("bst", initialState("bst"), "insert", { value: 5 }).state;
  const empty = ok("bst", single, "delete", { value: 5 });
  assert.equal(empty.state.root, null);
  assert.match(empty.frames.at(-1).text, /leaf 5/);
});

/* --- Graph ---------------------------------------------------------------- */

test("graph nodes and edges can be created and removed", () => {
  let state = initialState("graph");
  const added = ok("graph", state, "add-node", { id: "G" });
  state = added.state;
  assert.ok(state.nodes.includes("G"));
  const isolated = ok("graph", state, "bfs", {});
  assert.match(isolated.frames.at(-1).text, /Unreachable from A: G/);

  const edged = ok("graph", state, "add-edge", { from: "F", to: "G" });
  state = edged.state;
  assert.ok(state.edges.some(([a, b]) => a === "F" && b === "G"));
  const traversal = ok("graph", state, "bfs", {});
  assert.match(traversal.frames.at(-1).text, /A → B → C → D → E → F → G/);

  const removedEdge = ok("graph", state, "remove-edge", { from: "A", to: "B" });
  state = removedEdge.state;
  const rerouted = ok("graph", state, "bfs", {});
  assert.match(rerouted.frames.at(-1).text, /Breadth-first order: A → C → E → F → D → G → B/, "the other path still reaches B");

  const removedNode = ok("graph", state, "add-node", { id: "H" }).state;
  const shrunk = ok("graph", removedNode, "remove-node", { id: "H" });
  assert.ok(!shrunk.state.nodes.includes("H"));
  assert.ok(!shrunk.state.edges.some(([a, b]) => a === "H" || b === "H"));
});

test("graph editing validates endpoints, duplicates and start nodes", () => {
  const state = initialState("graph");
  assert.match(run("graph", state, "add-node", { id: "A" }).error, /already exists/);
  assert.match(run("graph", state, "add-node", { id: "" }).error, /name/);
  assert.match(run("graph", state, "add-edge", { from: "A", to: "Z" }).error, /must exist/);
  assert.match(run("graph", state, "add-edge", { from: "A", to: "A" }).error, /self-loop/);
  assert.match(run("graph", state, "add-edge", { from: "A", to: "B" }).error, /already exists/);
  assert.match(run("graph", state, "add-edge", { from: "B", to: "A" }).error, /already exists/, "undirected duplicates count both ways");
  assert.match(run("graph", state, "remove-edge", { from: "A", to: "F" }).error, /no edge/);
  assert.match(run("graph", state, "start", { node: "Z" }).error, /not in the graph/);
  assert.match(run("graph", state, "remove-node", { id: "Z" }).error, /not in the graph/);
});

test("the graph start node is configurable and unreachable nodes are reported", () => {
  let state = initialState("graph");
  const started = ok("graph", state, "start", { node: "D" });
  state = started.state;
  assert.equal(state.start, "D");
  const bfs = ok("graph", state, "bfs", {});
  assert.match(bfs.frames.at(-1).text, /Breadth-first order: D → B → F → A → E → C/);

  const stale = { ...state, start: "Z" };
  assert.match(run("graph", stale, "bfs", {}).error, /start node Z is not in the graph/);
});

test("directed graphs follow edges one way only", () => {
  let state = initialState("graph");
  const directed = ok("graph", state, "direction", { direction: "directed" });
  state = directed.state;
  assert.equal(state.directed, true);
  assert.match(directed.frames[0].text, /one way only/);

  const startedB = ok("graph", state, "start", { node: "B" }).state;
  const bfs = ok("graph", startedB, "bfs", {});
  assert.match(bfs.frames.at(-1).text, /Breadth-first order: B → D → F/);

  const back = ok("graph", state, "direction", { direction: "undirected" });
  assert.equal(back.state.directed, false);
  const same = ok("graph", state, "direction", { direction: "directed" });
  assert.match(same.frames[0].text, /already directed/);
});

test("an emptied graph explains itself instead of inventing a traversal", () => {
  let state = initialState("graph");
  for (const id of ["A", "B", "C", "D", "E", "F"]) state = ok("graph", state, "remove-node", { id }).state;
  assert.deepEqual(state.nodes, []);
  assert.equal(state.start, null);
  assert.match(run("graph", state, "bfs", {}).error, /no nodes/);
  assert.match(run("graph", state, "dfs", {}).error, /no nodes/);
});

test("the graph layout places every node inside the viewBox without overlap", () => {
  const state = initialState("graph");
  const layout = layoutGraph(state);
  const minGap = 30;
  const ids = state.nodes;
  for (const id of ids) {
    const point = layout.positions.get(id);
    assert.ok(point, `${id} has a position`);
    assert.ok(point.x >= 0 && point.x <= layout.width, `${id} x inside viewBox`);
    assert.ok(point.y >= 0 && point.y <= layout.height, `${id} y inside viewBox`);
  }
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const a = layout.positions.get(ids[i]);
      const b = layout.positions.get(ids[j]);
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      assert.ok(distance >= minGap, `${ids[i]} and ${ids[j]} do not overlap (${distance})`);
    }
  }
  // Deterministic: the same state yields the same positions.
  const again = layoutGraph(state);
  assert.deepEqual([...layout.positions], [...again.positions]);
});

test("the graph layout handles a disconnected graph and a single node", () => {
  let state = initialState("graph");
  state = applyOperation("graph", state, "add-node", { id: "G" }).state;
  const layout = layoutGraph(state);
  assert.ok(layout.positions.has("G"));
  assert.ok(layout.width > 0 && layout.height > 0);

  const single = layoutGraph({ nodes: ["Z"], edges: [], directed: false, start: "Z" });
  assert.equal(single.positions.size, 1);
  const point = single.positions.get("Z");
  assert.ok(point.x >= 0 && point.y >= 0);
});
