// The data-structure lab is an authored model, so its behaviour is checked
// here rather than in a browser: operations, boundaries, duplicates, and the
// promise that a frame is a complete, independent snapshot.
//
//   node --test src/datastructures/model.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

import {
  STRUCTURES,
  applyOperation,
  initialState,
  structureByType,
} from "./model.js";

const valuesOf = (state) => state.values;

test("every structure is complete and has a URL-safe type", () => {
  const types = new Set();
  for (const structure of STRUCTURES) {
    assert.match(structure.type, /^[a-z-]+$/, `${structure.name} has a URL-safe type`);
    assert.ok(!types.has(structure.type), `${structure.type} is used once`);
    types.add(structure.type);
    assert.ok(structure.name.trim().length > 0);
    assert.ok(structure.blurb.trim().length > 20);
    assert.ok(structure.limits.trim().length > 10, `${structure.type} says what it does not offer`);
    assert.ok(structure.operations.length > 0, `${structure.type} has an operation`);
    for (const operation of structure.operations) {
      assert.match(operation.id, /^[a-z-]+$/);
      assert.ok(operation.label.trim().length > 0);
      for (const field of operation.fields) {
        assert.ok(field.name && field.label);
        assert.ok(field.default !== undefined, `${operation.id}.${field.name} has a default`);
        if (field.type) assert.ok(['text', 'number', 'select'].includes(field.type));
        if (field.type === 'select') {
          assert.ok(field.options.length >= 2, `${operation.id}.${field.name} offers real choices`);
          assert.ok(
            field.options.some((option) => option.value === field.default),
            `${operation.id}.${field.name} has a valid default`,
          );
        }
      }
    }
  }
});

test("the starting state is a clone, not a shared object", () => {
  const first = initialState("array");
  const second = initialState("array");
  assert.deepEqual(first, second);
  first.values.push(99);
  assert.notDeepEqual(first, second);
  assert.equal(initialState("nope"), null);
});

test("an unknown type or operation is refused without inventing a step", () => {
  assert.deepEqual(applyOperation("nope", {}, "append", {}), { error: "Unknown structure: nope." });
  assert.deepEqual(applyOperation("array", initialState("array"), "fly", {}), {
    error: "Unsupported operation: fly.",
  });
});

test("an array append records a step and grows when full", () => {
  const start = { values: [4, 7, 1, 2], capacity: 4 };
  const grown = applyOperation("array", start, "append", { value: 6 });
  assert.ok(!grown.error);
  assert.equal(grown.frames.length, 2);
  assert.equal(grown.frames[0].state.capacity, 8);
  assert.match(grown.frames[0].text, /capacity doubles from 4 to 8/);
  assert.deepEqual(valuesOf(grown.state), [4, 7, 1, 2, 6]);
  assert.deepEqual(grown.frames.at(-1).marks.active, ["4"]);
  assert.deepEqual(grown.frames.at(-1).state, grown.state);
});

test("array insert shifts, remove shifts back, and a bad index changes nothing", () => {
  const start = initialState("array");
  const inserted = applyOperation("array", start, "insert", { index: 1, value: 9 });
  assert.deepEqual(valuesOf(inserted.state), [4, 9, 7, 1]);
  assert.match(inserted.frames.at(-1).text, /shift right/);

  const removed = applyOperation("array", inserted.state, "remove", { index: 2 });
  assert.deepEqual(valuesOf(removed.state), [4, 9, 1]);
  assert.match(removed.frames.at(-1).text, /shift left/);

  for (const index of [-1, 9, 1.5, "x"]) {
    const bad = applyOperation("array", start, "remove", { index });
    assert.ok(bad.error, `index ${index} is refused`);
    assert.equal(bad.frames, undefined);
  }
});

test("array search walks in order and finds the first match", () => {
  const found = applyOperation("array", { values: [4, 7, 7], capacity: 4 }, "search", { value: 7 });
  assert.equal(found.frames.length, 2);
  assert.deepEqual(found.frames[0].marks.compare, ["0"]);
  assert.deepEqual(found.frames[1].marks.found, ["1"]);
  assert.match(found.frames[1].text, /index 1/);

  const missing = applyOperation("array", { values: [4, 7], capacity: 4 }, "search", { value: 3 });
  assert.equal(missing.frames.length, 3);
  assert.match(missing.frames.at(-1).text, /not in the array/);
});

test("a linked list keeps head-to-tail order and reports a miss", () => {
  const prepended = applyOperation("linked-list", initialState("linked-list"), "prepend", { value: "D" });
  assert.deepEqual(valuesOf(prepended.state), ["D", "A", "B", "C"]);

  const removed = applyOperation("linked-list", prepended.state, "remove", { value: "B" });
  assert.deepEqual(valuesOf(removed.state), ["D", "A", "C"]);
  assert.match(removed.frames.at(-1).text, /link before it now points past it/);

  const missing = applyOperation("linked-list", initialState("linked-list"), "search", { value: "Z" });
  assert.match(missing.frames.at(-1).text, /not in the list/);

  const walk = applyOperation("linked-list", initialState("linked-list"), "traverse", {});
  assert.equal(walk.frames.length, 3);
  assert.match(walk.frames[0].text, /next is B/);
  assert.match(walk.frames.at(-1).text, /next is null/);
});

test("stack and queue refuse to remove from empty, and peek changes nothing", () => {
  const emptyStack = { values: [] };
  assert.match(applyOperation("stack", emptyStack, "pop", {}).error, /empty/);
  assert.match(applyOperation("stack", emptyStack, "peek", {}).error, /empty/);
  const pushed = applyOperation("stack", initialState("stack"), "push", { value: "C" });
  assert.deepEqual(valuesOf(pushed.state), ["A", "B", "C"]);
  const popped = applyOperation("stack", pushed.state, "pop", {});
  assert.deepEqual(valuesOf(popped.state), ["A", "B"]);
  assert.match(popped.frames[0].text, /Pop C from the top/);
  const peeked = applyOperation("stack", initialState("stack"), "peek", {});
  assert.deepEqual(valuesOf(peeked.state), ["A", "B"]);
  assert.match(peeked.frames[0].text, /top is B/);

  const emptyQueue = { values: [] };
  assert.match(applyOperation("queue", emptyQueue, "dequeue", {}).error, /empty/);
  assert.match(applyOperation("queue", emptyQueue, "peek", {}).error, /empty/);
  const queued = applyOperation("queue", initialState("queue"), "enqueue", { value: "C" });
  assert.deepEqual(valuesOf(queued.state), ["A", "B", "C"]);
  const dequeued = applyOperation("queue", queued.state, "dequeue", {});
  assert.deepEqual(valuesOf(dequeued.state), ["B", "C"]);
  assert.match(dequeued.frames[0].text, /Dequeue A from the front/);
});

test("the tree inserts, refuses duplicates, searches and walks in order", () => {
  let state = initialState("bst");
  for (const value of [8, 3, 10, 1, 6]) {
    const result = applyOperation("bst", state, "insert", { value });
    assert.ok(!result.error, `insert ${value}`);
    state = result.state;
  }

  const duplicate = applyOperation("bst", state, "insert", { value: 6 });
  assert.match(duplicate.frames.at(-1).text, /keeps one copy/);
  assert.deepEqual(duplicate.state, state);

  const found = applyOperation("bst", state, "search", { value: 6 });
  assert.deepEqual(found.frames.at(-1).marks.found, ["6"]);
  const missing = applyOperation("bst", state, "search", { value: 7 });
  assert.match(missing.frames.at(-1).text, /not in the tree/);

  const walk = applyOperation("bst", state, "inorder", {});
  assert.match(walk.frames.at(-1).text, /In-order traversal: 1, 3, 6, 8, 10/);
  assert.deepEqual(walk.frames.at(-1).marks.done.sort(), ["1", "10", "3", "6", "8"]);
});

test("the graph traverses breadth first and depth first from A", () => {
  const bfs = applyOperation("graph", initialState("graph"), "bfs", {});
  assert.match(bfs.frames.at(-1).text, /Breadth-first order: A → B → C → D → E → F/);
  const dfs = applyOperation("graph", initialState("graph"), "dfs", {});
  assert.match(dfs.frames.at(-1).text, /Depth-first order: A → B → D → F → E → C/);
});

test("the same input always records the same frames", () => {
  for (const structure of STRUCTURES) {
    const operation = structure.operations[0];
    const input = Object.fromEntries(operation.fields.map((field) => [field.name, field.default]));
    const first = applyOperation(structure.type, initialState(structure.type), operation.id, input);
    const second = applyOperation(structure.type, initialState(structure.type), operation.id, input);
    assert.deepEqual(first, second, `${structure.type} is deterministic`);
  }
});

test("every frame is a snapshot, so seeking back cannot keep a later effect", () => {
  const result = applyOperation("array", { values: [4, 7, 1, 2], capacity: 4 }, "append", { value: 6 });
  assert.equal(result.frames.length, 2);
  result.frames[0].state.values.push(999);
  assert.ok(!result.frames.at(-1).state.values.includes(999), "frames do not share state");
  assert.ok(!result.state.values.includes(999), "the returned state is its own copy");
});

test("a successful operation ends on its own returned state", () => {
  for (const structure of STRUCTURES) {
    for (const operation of structure.operations) {
      const input = Object.fromEntries(operation.fields.map((field) => [field.name, field.default]));
      const result = applyOperation(structure.type, initialState(structure.type), operation.id, input);
      if (result.error) continue;
      assert.ok(result.frames.length > 0, `${structure.type}.${operation.id} records a step`);
      assert.deepEqual(result.frames.at(-1).state, result.state);
    }
  }
});

test("the registry lookup is exact", () => {
  assert.equal(structureByType("stack")?.name, "Stack");
  assert.equal(structureByType("nope"), null);
  assert.equal(structureByType(""), null);
});
