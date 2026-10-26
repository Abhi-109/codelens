// The built-in examples are the one place the workspace, the example picker
// and the lesson pages agree on what a program is. These tests keep that
// agreement: stable ids, real source, and a default that exists.
//
//   node --test src/examples.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_EXAMPLE_ID, EXAMPLES, exampleById } from "./examples.js";

test("every example has a unique, stable id and a name", () => {
  const ids = new Set();
  for (const example of EXAMPLES) {
    assert.match(example.id, /^[a-z0-9-]+$/, `${example.name} has a URL-safe id`);
    assert.ok(!ids.has(example.id), `${example.id} is used once`);
    ids.add(example.id);
    assert.ok(example.name.trim().length > 0, `${example.id} has a name`);
  }
});

test("every example is a small program, not a fragment", () => {
  for (const example of EXAMPLES) {
    const lines = example.code.replace(/\n$/, "").split("\n");
    assert.ok(lines.length > 0 && lines.length <= 40, `${example.id} is short enough to read`);
    assert.ok(example.code.endsWith("\n"), `${example.id} ends with a newline`);
    assert.ok(!example.code.includes("\t"), `${example.id} uses spaces, never tabs`);
  }
});

test("the default example exists and can be looked up", () => {
  assert.ok(exampleById(DEFAULT_EXAMPLE_ID), `${DEFAULT_EXAMPLE_ID} is in the list`);
});

test("an unknown id resolves to nothing rather than a guess", () => {
  assert.equal(exampleById("does-not-exist"), null);
  assert.equal(exampleById(""), null);
  assert.equal(exampleById(undefined), null);
});
