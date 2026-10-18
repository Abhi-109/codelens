// Unit tests for value formatting (src/tracer/values.js).
//
// The rule these tests protect: a value shown to the learner must come from the
// trace, and when the trace stopped short the display must say so. Printing an
// internal heap id (`o7`) or a list that looks complete would be a lie.
//
//   node --test src/tracer/values.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { describeObject, formatValue, showValue } from "./values.js";

const int = (value) => ({ type: "int", value });
const str = (value, extra = {}) => ({ type: "str", value, ...extra });
const ref = (id) => ({ type: "ref", id });
const list = (items, extra = {}) => ({ type: "list", items, ...extra });
const dict = (entries, extra = {}) => ({ type: "dict", entries, ...extra });

test("formatValue covers every value kind the tracer emits", () => {
  assert.equal(formatValue({ type: "none" }), "None");
  assert.equal(formatValue({ type: "bool", value: true }), "True");
  assert.equal(formatValue({ type: "bool", value: false }), "False");
  assert.equal(formatValue(int(12)), "12");
  assert.equal(formatValue({ type: "float", value: 1.5 }), "1.5");
  assert.equal(formatValue(str("hi")), '"hi"');
  assert.equal(formatValue({ type: "function", name: "f" }), "f()");
  assert.equal(formatValue({ type: "class", name: "Dog" }), "class Dog");
  assert.equal(formatValue({ type: "module", name: "math" }), "math");
  assert.equal(formatValue({ type: "other", class: "Dog", repr: "<Dog>" }), "<Dog>");
});

test("a container the tracer stopped listing says how much it left out", () => {
  const items = [int(1), int(2), int(3)];
  assert.equal(showValue(ref("o1"), { o1: list(items) }), "[1, 2, 3]");
  assert.equal(showValue(ref("o1"), { o1: list(items, { more: 27 }) }), "[1, 2, 3, … 27 more]");
  assert.equal(
    showValue(ref("o1"), { o1: dict([{ key: str("a"), value: int(1) }], { more: 4 }) }),
    '{"a": 1, … 4 more}',
  );
  assert.equal(
    showValue(ref("o1"), {
      o1: { type: "object", class: "Dog", attrs: [{ name: "age", value: int(3) }], more: 2 },
    }),
    "Dog(age=3, … 2 more)",
  );
});

test("a truncated string is marked as cut short", () => {
  assert.equal(showValue(str("abc")), '"abc"');
  assert.equal(showValue(str("abc", { truncated: true })), '"abc…"');
});

test("a reference whose object is missing never prints the raw id", () => {
  assert.equal(showValue(ref("o7"), {}), "(not shown at this step)");
  assert.equal(formatValue(ref("o7"), {}), "(not shown at this step)");
  assert.ok(!showValue(ref("o7"), {}).includes("o7"));
});

test("nested references are described, not labelled with ids", () => {
  const heap = {
    o1: list([ref("o2"), int(2)]),
    o2: list([int(1)]),
  };
  const text = showValue(ref("o1"), heap);
  assert.equal(text, "[[1], 2]");
  assert.ok(!text.includes("o2"));
});

test("describeObject survives a missing object and an unknown kind", () => {
  assert.equal(describeObject(undefined, {}), "?");
  assert.equal(describeObject({ type: "weird", repr: "<weird>" }, {}), "<weird>");
});

test("an unknown value is shown as unknown, never invented", () => {
  assert.equal(formatValue(undefined, {}), "?");
  assert.equal(showValue(undefined, {}), "?");
});
