// The homepage preview must never invent anything: it replays a REAL
// recorded trace of a real corpus program through the visualizer's own
// getStepView, and this file proves that on every step.
//
//   node --test src/pages/preview.test.mjs
//
// It also guards the fixture generator: preview-fixture.json is a copy of
// one corpus entry, and if tracer.py / dump_corpus.py ever re-record it,
// the copy and the corpus must still agree or this test fails.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

import {
  buildPreviewFrames,
  nextFrameIndex,
  previousFrameIndex,
  markedLine,
} from "./preview.js";

const CORPUS = JSON.parse(
  gunzipSync(readFileSync(new URL("../tracer/__fixtures__/corpus.json.gz", import.meta.url))),
);
const FIXTURE = JSON.parse(
  readFileSync(new URL("./preview-fixture.json", import.meta.url), "utf8"),
);

// Same definition as corpus.test.mjs: an invented value, or a trace-internal
// id (o7) leaking out of the engine.
const LEAKED = /\bundefined\b|\bNaN\b|\[object Object\]|\bo\d+\b/;

test("the preview fixture is exactly the corpus program it claims to replay", () => {
  const entry = CORPUS[FIXTURE.program];
  assert.ok(entry, `no corpus program named "${FIXTURE.program}"`);
  assert.equal(FIXTURE.source, entry.source, "source drifted from the corpus");
  assert.deepEqual(FIXTURE.trace, entry.trace, "trace drifted from the corpus");
  assert.equal(FIXTURE.output, entry.result?.output, "recorded output drifted");
});

test("the preview replays real steps with real lines", () => {
  const frames = buildPreviewFrames(FIXTURE.source, FIXTURE.trace);
  const sourceLines = new Set(FIXTURE.source.split("\n").map((_, i) => i + 1));

  assert.ok(frames.length >= 5, `expected a playable preview, got ${frames.length} frames`);

  // Frames are in trace order and each points at the event it came from.
  const indices = frames.map((frame) => frame.index);
  assert.deepEqual(indices, [...indices].sort((a, b) => a - b), "frames must be in trace order");

  for (const frame of frames) {
    const event = FIXTURE.trace[frame.index];
    assert.ok(event.line > 0, `frame ${frame.index} replays a bookkeeping event`);
    assert.ok(sourceLines.has(frame.line), `line ${frame.line} is not in the source`);
    assert.equal(frame.code.line, frame.line, "code pane and frame disagree");
    assert.ok(frame.code.text.length > 0, `frame ${frame.index} has no code text`);
  }
});

test("no preview frame shows an invented value or a trace id", () => {
  const frames = buildPreviewFrames(FIXTURE.source, FIXTURE.trace);
  for (const frame of frames) {
    const text = [
      frame.code.text,
      ...Object.entries(frame.values).map(([name, value]) => `${name}=${value}`),
      ...(frame.callStack ?? []).flatMap((entry) => [
        entry.function,
        ...(entry.variables ?? []).map((variable) => `${variable.name}=${variable.text}`),
      ]),
      ...(frame.changes ?? []).map((change) => `${change.name} ${change.from} ${change.to}`),
      frame.output,
    ].join(" ");
    assert.doesNotMatch(text, LEAKED, `frame ${frame.index} leaked: ${text}`);
    assert.ok(text.trim().length > 0, `frame ${frame.index} rendered nothing`);
  }
});

test("the preview shows a real call stack, real variables and real output", () => {
  const frames = buildPreviewFrames(FIXTURE.source, FIXTURE.trace);

  // The program calls greet(): some frame must be inside that call.
  const insideCall = frames.filter((frame) =>
    frame.callStack.some((entry) => entry.function === "greet" && entry.depth > 0),
  );
  assert.ok(insideCall.length > 0, "no frame showed the greet() call");

  // The greeting must appear as printed output, accumulated over frames.
  const printed = frames.map((frame) => frame.output);
  assert.ok(
    printed.some((output) => output.includes("Hello, Asha")),
    `expected the real output, saw ${JSON.stringify(printed.at(-1))}`,
  );
  // Output only ever grows - the preview never rewrites history.
  for (let i = 1; i < printed.length; i += 1) {
    assert.ok(
      printed[i].startsWith(printed[i - 1]),
      `output shrank at frame ${i}: "${printed[i - 1]}" -> "${printed[i]}"`,
    );
  }

  // And variables are visible somewhere (name = value pairs).
  const withVars = frames.filter((frame) => Object.keys(frame.values).length > 0);
  assert.ok(withVars.length > 0, "no frame showed a variable");
  assert.match(Object.entries(withVars.at(-1).values).join(" "), /result/);
});

test("rebuilding the preview is deterministic", () => {
  const once = buildPreviewFrames(FIXTURE.source, FIXTURE.trace);
  const twice = buildPreviewFrames(FIXTURE.source, FIXTURE.trace);
  assert.deepEqual(once, twice);
});

test("the loop wraps in both directions", () => {
  assert.equal(nextFrameIndex(0, 7), 1);
  assert.equal(nextFrameIndex(6, 7), 0, "last frame must wrap to the first");
  assert.equal(previousFrameIndex(0, 7), 6, "first frame must wrap to the last");
  assert.equal(previousFrameIndex(3, 7), 2);
  // Empty/zero totals must not divide by zero or go negative.
  assert.equal(nextFrameIndex(0, 0), 0);
  assert.equal(previousFrameIndex(0, 0), 0);
});

test("an empty trace or empty source builds no frames, not a crash", () => {
  assert.deepEqual(buildPreviewFrames(FIXTURE.source, []), []);
  assert.deepEqual(buildPreviewFrames("", FIXTURE.trace), []);
});

test("the marked line rebuilds itself exactly, and marks only traced names", () => {
  const text = "result = greet('Asha')  # value";
  const values = { result: "'Asha'" };
  const segments = markedLine(text, values);

  assert.equal(
    segments.map((segment) => segment.text).join(""),
    text,
    "marking must never change the line a learner reads",
  );
  // `result` holds a value right now, so it is marked; `greet` is a name the
  // trace never assigned a value to, so it is left alone.
  assert.equal(segments.find((segment) => segment.text === "result")?.name, "result");
  assert.equal(segments.find((segment) => segment.text === "greet")?.name, null);
  assert.ok(
    segments.some((segment) => segment.name === "result"),
    "the assigned name must be marked",
  );
  assert.equal(markedLine("").length, 0);
  assert.deepEqual(markedLine("x", {}), [{ text: "x", name: null }]);
});

test("every preview line marks only names the trace says exist", () => {
  const frames = buildPreviewFrames(FIXTURE.source, FIXTURE.trace);
  for (const frame of frames) {
    const segments = markedLine(frame.code.text, frame.values);
    assert.equal(
      segments.map((segment) => segment.text).join(""),
      frame.code.text,
      `frame ${frame.index}: line was rewritten`,
    );
    for (const segment of segments) {
      if (segment.name) {
        assert.ok(
          Object.hasOwn(frame.values, segment.name),
          `frame ${frame.index}: "${segment.name}" marked without a traced value`,
        );
      }
    }
  }
});
