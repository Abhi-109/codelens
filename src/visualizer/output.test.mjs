import assert from "node:assert/strict";
import { test } from "node:test";

import {
  exceptionEntries,
  exceptionOutcome,
  inputEntries,
  outputAt,
  outputSegments,
  outputView,
  promptOf,
} from "./output.js";

const frame = (id = 1, fn = "<module>") => ({
  frame_id: id,
  function: fn,
  line: 1,
  call_line: null,
  variables: {},
});

function output(index, text) {
  return { step: index, event: "output", line: 1, text };
}

function input(index, text) {
  return { step: index, event: "input", line: 1, text };
}

function state(index, kind = "line") {
  return {
    step: index,
    event: kind,
    frame_id: 1,
    line: 1,
    frames: [frame()],
    heap: {},
  };
}

test("output keeps exact order, spaces and line breaks", () => {
  const trace = [
    output(0, "Name? "),
    input(1, "Asha"),
    output(2, "Asha\n"),
    state(3),
    output(4, "Hi"),
    output(5, " "),
    output(6, "Asha\n"),
  ];
  assert.equal(outputAt(trace, 0), "Name? ");
  assert.equal(outputAt(trace, 2), "Name? Asha\n");
  assert.equal(outputAt(trace, 6), "Name? Asha\nHi Asha\n");
  const segments = outputSegments(trace, 0, 6);
  assert.equal(segments.map((segment) => segment.text).join(""), "Name? Asha\nHi Asha\n");
  assert.deepEqual(
    segments.map((segment) => segment.at),
    [0, 4],
    "a click jumps to the first output event of each printed run",
  );
});

test("the output view separates what has happened from what comes later", () => {
  const trace = [output(0, "A"), output(1, "B"), output(2, "C")];
  const view = outputView(trace, 1);
  assert.equal(view.pastText, "AB");
  assert.equal(view.futureText, "C");
  assert.deepEqual(view.pastSegments.map((segment) => segment.at), [0]);
  assert.deepEqual(view.futureSegments.map((segment) => segment.at), [2]);
  assert.equal(outputView(trace, 0).futureText, "BC");
  assert.equal(outputView(trace, 2).futureText, "");
});

test("input entries carry the prompt the program really printed", () => {
  const trace = [
    output(0, "Name? "),
    input(1, "Asha"),
    output(2, "Asha\n"),
    output(3, "Age? "),
    input(4, "12"),
  ];
  const entries = inputEntries(trace);
  assert.equal(entries.length, 2);
  assert.deepEqual(
    entries.map((entry) => [entry.index, entry.prompt, entry.value]),
    [
      [1, "Name? ", "Asha"],
      [4, "Age? ", "12"],
    ],
  );
  assert.equal(promptOf("hello\nworld? "), "world? ");
  const view = outputView(trace, 2);
  assert.equal(view.inputs.length, 1);
  assert.equal(view.futureInputs.length, 1);
});

test("a caught exception is only called handled when the frame runs again", () => {
  const caught = [
    state(0),
    {
      step: 1,
      event: "exception",
      line: 1,
      frame_id: 1,
      function: "<module>",
      frames: [frame()],
      heap: {},
      exception: { type: "ZeroDivisionError", message: "division by zero" },
    },
    state(2),
  ];
  assert.equal(exceptionOutcome(caught, 1), "handled");
  assert.equal(exceptionEntries(caught)[0].type, "ZeroDivisionError");
  assert.equal(exceptionEntries(caught)[0].message, "division by zero");

  const uncaught = [
    state(0),
    caught[1],
    { ...state(2, "unwind"), frame_id: 1 },
    { ...state(3, "error"), type: "ZeroDivisionError", message: "division by zero" },
  ];
  assert.equal(exceptionOutcome(uncaught, 1), "uncaught");
  assert.deepEqual(
    exceptionEntries(uncaught).map((entry) => [entry.event, entry.outcome]),
    [
      ["exception", "uncaught"],
      ["error", "uncaught"],
    ],
  );
});

test("errors are split by the current step and the final error is still available", () => {
  const trace = [
    state(0),
    {
      step: 1,
      event: "exception",
      line: 1,
      frame_id: 1,
      frames: [frame()],
      heap: {},
      exception: { type: "ValueError", message: "bad" },
    },
    state(2),
  ];
  const result = { status: "error", error: { type: "ValueError", message: "bad", line: 1 } };
  const early = outputView(trace, 0, result);
  assert.equal(early.errors.length, 0);
  assert.equal(early.futureErrors.length, 2, "the exception and the final error are later");
  assert.equal(early.finalError.type, "ValueError");
  const late = outputView(trace, 2, result);
  assert.equal(late.errors.length, 2);
  assert.equal(late.futureErrors.length, 0);
  assert.equal(late.errors.at(-1).recorded, false, "this trace has no error event");
});

test("empty output and a failed run have clear states", () => {
  const empty = outputView([], 0);
  assert.equal(empty.hasTrace, false);
  assert.equal(empty.pastText, "");
  assert.deepEqual(empty.pastSegments, []);
  assert.deepEqual(empty.errors, []);
  const failed = outputView([], 0, {
    status: "error",
    error: { type: "SyntaxError", message: "invalid syntax", line: 2 },
  });
  assert.equal(failed.finalError.type, "SyntaxError");
  assert.equal(failed.finalError.index, null);
  assert.equal(failed.errors.length, 1);
});
