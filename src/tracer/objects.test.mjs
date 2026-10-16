// Unit tests for the object-diagram helpers (src/tracer/objects.js).
//
//   node --test src/tracer/objects.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { changedSlots, namesById, objectChanges, slotEntries } from "./objects.js";

const int = (value) => ({ type: "int", value });
const str = (value) => ({ type: "str", value });
const ref = (id) => ({ type: "ref", id });

const frame = (variables, fn = "<module>") => ({ frame_id: 1, function: fn, variables });

test("namesById lists every name pointing at one object, top frame first", () => {
  const frames = [
    frame({ a: ref("o1"), x: int(1) }, "<module>"),
    frame({ b: ref("o1"), c: ref("o2") }, "f"),
  ];
  const names = namesById(frames);
  assert.deepEqual(names.get("o1"), ["b", "a"]); // inner frame first
  assert.deepEqual(names.get("o2"), ["c"]);
  assert.equal(names.has("x"), false);
  assert.deepEqual(namesById(null), new Map());
});

test("namesById names nested objects after their parent's path", () => {
  // rex (o1) holds tricks (o2), whose first item is another list (o3).
  const heap = {
    o1: { type: "object", class: "Dog", attrs: [{ name: "tricks", value: ref("o2") }] },
    o2: { type: "list", items: [ref("o3")] },
    o3: { type: "list", items: [str("sit")] },
  };
  const frames = [frame({ rex: ref("o1") }, "<module>")];
  const names = namesById(frames, heap);
  assert.deepEqual(names.get("o2"), ["rex.tricks"]);
  assert.deepEqual(names.get("o3"), ["rex.tricks[0]"]);
  // Objects only reachable through a dict value get the entry index path.
  const dictHeap = { o1: { type: "dict", entries: [{ key: str("a"), value: ref("o2") }] }, o2: { type: "list", items: [] } };
  const dictNames = namesById([frame({ d: ref("o1") })], dictHeap);
  assert.deepEqual(dictNames.get("o2"), ["d[0]"]);
});

test("slotEntries numbers list slots", () => {
  const entries = slotEntries({ type: "list", items: [int(1), str("two")] });
  assert.deepEqual(entries, [
    { key: 0, label: 0, value: int(1) },
    { key: 1, label: 1, value: str("two") },
  ]);
});

test("slotEntries keys dict slots by their key's content", () => {
  const entries = slotEntries({
    type: "dict",
    entries: [{ key: str("a"), value: int(1) }],
  });
  assert.equal(entries[0].key, JSON.stringify(str("a")));
  assert.deepEqual(entries[0].label, str("a"));
  assert.deepEqual(entries[0].value, int(1));
});

test("slotEntries uses attribute names for instances and no index for sets", () => {
  const attrs = slotEntries({ type: "object", class: "Dog", attrs: [{ name: "name", value: str("Rex") }] });
  assert.deepEqual(attrs.map((e) => e.key), ["name"]);

  const set = slotEntries({ type: "set", items: [int(5)] });
  assert.deepEqual(set, [{ key: JSON.stringify(int(5)), label: null, value: int(5) }]);
});

test("changedSlots: appending to a list lights up only the new slot", () => {
  const before = { type: "list", items: [str("a"), str("b")] };
  const after = { type: "list", items: [str("a"), str("b"), str("c")] };
  assert.deepEqual([...changedSlots(before, after)], [2]);
});

test("changedSlots: unchanged objects and untouched slots stay dark", () => {
  const list = { type: "list", items: [int(1), int(2)] };
  assert.deepEqual([...changedSlots(list, list)], []);
  assert.deepEqual([...changedSlots(list, { type: "list", items: [int(1), int(9)] })], [1]);
});

test("changedSlots: a first-time object marks every slot new", () => {
  const after = { type: "list", items: [int(1)] };
  assert.deepEqual([...changedSlots(undefined, after)], [0]);
});

test("changedSlots: a removed slot still lights up, and so does the overflow count", () => {
  const before = { type: "list", items: [int(1), int(2)] };
  const after = { type: "list", items: [int(1)] };
  assert.deepEqual([...changedSlots(before, after)], [1]);

  const fullBefore = { type: "list", items: [int(1)], more: 0 };
  const fullAfter = { type: "list", items: [int(1)], more: 1 };
  assert.deepEqual([...changedSlots(fullBefore, fullAfter)], ["more"]);
});

test("objectChanges reports only objects whose contents changed", () => {
  const before = { o1: { type: "list", items: [int(1)] }, o2: { type: "list", items: [int(7)] } };
  const after = { o1: { type: "list", items: [int(1), int(2)] }, o2: { type: "list", items: [int(7)] } };
  const changes = objectChanges(before, after);
  assert.deepEqual([...changes.keys()], ["o1"]);
  assert.deepEqual([...changes.get("o1")], [1]);
  assert.deepEqual(objectChanges(null, after).size, 2); // everything is new without a previous heap
});
