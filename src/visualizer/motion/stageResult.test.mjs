// The stage's non-diff facts: output at the cursor, the last named function
// return, and the run's ending. Every assertion reads a real corpus trace or a
// deliberately minimal trace shape, never the final output string on its own.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";

import { lastFunctionReturn, stageResult } from "./stageResult.js";

const CORPUS = JSON.parse(
  gunzipSync(
    readFileSync(new URL("../../tracer/__fixtures__/corpus.json.gz", import.meta.url)),
  ).toString(),
);

function program(name) {
  const entry = CORPUS[name];
  assert.ok(entry, `${name} is in the corpus`);
  return { name, source: entry.source, trace: entry.trace, result: entry.result };
}

const endOf = (p) => stageResult(p.trace, p.trace.length - 1, p.result);

test("output is the recorded tail at the cursor, never the final string", () => {
  const p = program("function-print-return");
  const final = endOf(p);
  assert.equal(final.output, "inside\n42\n");

  let previous = "";
  for (let index = 0; index < p.trace.length; index += 1) {
    const output = stageResult(p.trace, index, p.result).output;
    assert.ok(final.output.startsWith(output), `step ${index} output is a prefix of the end`);
    assert.ok(output.startsWith(previous), `step ${index} output never rewinds forward`);
    previous = output;
  }

  const firstOutput = p.trace.findIndex((event) => event.event === "output");
  assert.ok(firstOutput > 0);
  assert.equal(stageResult(p.trace, firstOutput - 1, p.result).output, "");
  assert.equal(stageResult(p.trace, firstOutput, p.result).output, "inside");
  assert.equal(stageResult(p.trace, firstOutput - 1, p.result).output, "");
});

test("multiple output chunks join exactly, preserving spaces and newlines", () => {
  const p = program("io-print-options");
  const end = endOf(p);
  assert.equal(end.output, p.result.output);
  assert.match(end.output, /one \| two\n/);
  assert.match(end.output, /no newline\.\.\.continues\n/);
});

test("an empty print still contributes its newline", () => {
  const p = program("io-empty-print");
  assert.equal(endOf(p).output, "\ndone\n");
});

test("a successful run with nothing printed shows no output", () => {
  const p = program("assign-only");
  const end = endOf(p);
  assert.equal(end.output, "");
  assert.equal(end.ending.label, "Completed");
});

test("a named function return is a result; the module's None is completion", () => {
  const p = program("function-print-return");
  const end = endOf(p);
  assert.equal(end.lastReturn.function, "report");
  assert.equal(end.lastReturn.text, "42");
  assert.equal(end.lastReturn.valueType, "int");

  const moduleReturn = p.trace.findIndex(
    (event, index) => index > 0 && event.event === "return" && event.function === "<module>",
  );
  assert.ok(moduleReturn > 0);
  const atModule = stageResult(p.trace, moduleReturn, p.result);
  assert.equal(
    atModule.lastReturn.function,
    "report",
    "the implicit top-level None never replaces the real result",
  );
});

test("a return without print keeps the result and invents no output", () => {
  const trace = [
    { event: "call", function: "<module>", frame_id: 1, frames: [] },
    {
      event: "return",
      function: "add",
      frame_id: 2,
      return_value: { type: "int", value: 3 },
      heap: {},
    },
    {
      event: "return",
      function: "<module>",
      frame_id: 1,
      return_value: { type: "none" },
      heap: {},
    },
  ];
  const result = { status: "completed" };

  const before = stageResult(trace, 0, result);
  assert.equal(before.lastReturn, null);
  assert.equal(before.ending, null, "an unfinished run has no final status");

  const end = stageResult(trace, 2, result);
  assert.equal(end.lastReturn.function, "add");
  assert.equal(end.lastReturn.text, "3");
  assert.equal(end.output, "");
  assert.equal(end.ending.label, "Completed");
});

test("the final step reports the run's ending, not the last event's name", () => {
  const ok = program("function-print-return");
  assert.equal(endOf(ok).ending.label, "Completed");

  const limit = program("limit-steps");
  assert.equal(endOf(limit).ending.id, "limit");
  assert.equal(endOf(limit).ending.label, "Step limit");

  const error = program("error-index");
  const end = endOf(error);
  assert.equal(end.ending.id, "error");
  assert.equal(end.ending.label, "Runtime error");
  assert.match(end.ending.detail, /IndexError/);
  assert.equal(end.output, "10\n", "output printed before the crash is kept");
});

test("the reset position clears output, result and final status", () => {
  const p = program("function-print-return");
  assert.equal(endOf(p).ending.label, "Completed");
  assert.equal(endOf(p).output, "inside\n42\n");

  const start = stageResult(p.trace, 0, p.result);
  assert.equal(start.output, "");
  assert.equal(start.ending, null);
  assert.equal(start.lastReturn, null);
});

test("a caught exception still completes; an uncaught one does not", () => {
  const caught = program("exception-custom");
  assert.equal(endOf(caught).ending.label, "Completed");

  const exceptionIndex = caught.trace.findIndex((event) => event.event === "exception");
  assert.ok(exceptionIndex > 0);
  assert.equal(
    stageResult(caught.trace, exceptionIndex, caught.result).ending,
    null,
    "a future status is not shown before the cursor reaches the end",
  );

  const uncaught = program("error-index");
  assert.equal(endOf(uncaught).ending.label, "Runtime error");
});

test("a cyclic returned collection renders a marker instead of recursing", () => {
  const trace = [
    {
      event: "return",
      function: "loop",
      frame_id: 2,
      return_value: { type: "ref", id: "o1" },
      heap: { o1: { type: "list", items: [{ type: "ref", id: "o1" }] } },
    },
  ];
  const returned = lastFunctionReturn(trace, 0);
  assert.equal(returned.function, "loop");
  assert.match(returned.text, /\[…\]/);
});

test("recursive calls report the most recent completed return", () => {
  const p = program("recursion");
  assert.equal(endOf(p).lastReturn.function, "fact");
  assert.equal(endOf(p).lastReturn.text, "120");

  const firstReturn = p.trace.findIndex(
    (event) => event.event === "return" && event.function === "fact",
  );
  assert.ok(firstReturn > 0);
  const early = stageResult(p.trace, firstReturn, p.result);
  assert.equal(early.lastReturn.index, firstReturn);
  assert.equal(early.lastReturn.text, "1");
});

test("nested calls report the last completed call", () => {
  const p = program("call-chain");
  const end = endOf(p);
  assert.equal(end.lastReturn.function, "quadruple");
  assert.equal(end.lastReturn.text, "12");
});

test("switching runs replaces the ending and output", () => {
  const ok = endOf(program("function-print-return"));
  const bad = endOf(program("error-index"));
  assert.equal(ok.ending.label, "Completed");
  assert.equal(bad.ending.label, "Runtime error");
  assert.notEqual(ok.output, bad.output);
});

test("an empty trace has no stage facts", () => {
  assert.deepEqual(stageResult([], 5, { status: "completed" }), {
    index: 0,
    atEnd: false,
    output: "",
    lastReturn: null,
    ending: null,
  });
});
