import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";

import { COVERAGE_PART, coverageOf, summarizeCoverage } from "./coverage.js";
import { planMotion } from "./plan.js";
import { motionView } from "./view.js";

const read = (path) =>
  JSON.parse(gunzipSync(readFileSync(new URL(path, import.meta.url))).toString());

const CORPUS = read("../../tracer/__fixtures__/corpus.json.gz");
const RECOGNITION = read("../../tracer/__fixtures__/recognition.json.gz").programs;

function programs() {
  const all = [];
  for (const [name, entry] of Object.entries(CORPUS)) {
    all.push({ name, source: entry.source, trace: entry.trace, result: entry.result ?? null });
  }
  for (const [name, entry] of Object.entries(RECOGNITION)) {
    all.push({ name, source: entry.source, trace: entry.trace, result: null });
  }
  return all.filter((entry) => Array.isArray(entry.trace) && entry.trace.length > 0);
}

test("a missing plan or view is reported as blank, never as covered", () => {
  assert.equal(coverageOf(null, null).covered, false);
  assert.equal(coverageOf(null, null).blankReason, "no recorded step to draw");
  const blank = coverageOf({}, null);
  assert.equal(blank.covered, false);
  assert.equal(blank.visual, false);
});

test("a line and a sentence are covered but not visual; values are visual", () => {
  const textOnly = coverageOf(
    {},
    { line: 3, feedback: { text: "defines function greet" }, frames: [], scalars: [], objects: [] },
  );
  assert.equal(textOnly.covered, true);
  assert.equal(textOnly.visual, false);
  assert.deepEqual(textOnly.parts, [COVERAGE_PART.line, COVERAGE_PART.operation]);

  const withValues = coverageOf({}, { line: 3, scalars: [{ name: "x" }], objects: [], frames: [] });
  assert.equal(withValues.covered, true);
  assert.equal(withValues.visual, true);
  assert.ok(withValues.parts.includes(COVERAGE_PART.values));
});

test("a recorded input event is visual evidence of its own", () => {
  const synthetic = coverageOf(
    {},
    {
      line: 1,
      feedback: { text: 'input "Your name? " → "Asha"' },
      io: { kind: "input", text: "Asha", prompt: "Your name? ", line: 1 },
      frames: [],
      scalars: [],
      objects: [],
    },
  );
  assert.equal(synthetic.visual, true);
  assert.ok(synthetic.parts.includes(COVERAGE_PART.io));

  const entry = CORPUS["io-input"];
  const inputAt = entry.trace.findIndex((event) => event.event === "input");
  const plan = planMotion(entry.trace, inputAt, {
    source: entry.source,
    previousIndex: inputAt - 1,
  });
  const view = motionView(plan, { trace: entry.trace, result: entry.result });
  const coverage = coverageOf(plan, view);
  assert.equal(view.io.kind, "input");
  assert.equal(view.io.prompt, "Your name? ");
  assert.ok(coverage.parts.includes(COVERAGE_PART.io));
});

test("summarizeCoverage counts text-only, visual, blank and unanchored steps", () => {
  const summary = summarizeCoverage([
    { covered: true, visual: true, anchor: true },
    { covered: true, visual: false, anchor: true },
    { covered: true, visual: false, anchor: false },
    { covered: false, visual: false, anchor: false },
  ]);
  assert.deepEqual(summary, {
    steps: 4,
    covered: 3,
    visual: 1,
    textOnly: 2,
    blank: 1,
    unanchored: 1,
  });
});

test("every recorded step of the corpus and recognition fixtures is covered", () => {
  const steps = [];
  let checked = 0;
  for (const program of programs()) {
    for (let index = 0; index < program.trace.length; index += 1) {
      const plan = planMotion(program.trace, index, {
        source: program.source,
        previousIndex: index > 0 ? index - 1 : null,
      });
      const view = motionView(plan, { trace: program.trace, result: program.result });
      assert.ok(view, `${program.name}: step ${index} produced no view`);
      const coverage = coverageOf(plan, view);
      assert.ok(coverage.covered, `${program.name}: step ${index} is blank (${coverage.blankReason})`);
      steps.push({
        covered: coverage.covered,
        visual: coverage.visual,
        anchor: Boolean(view.lineText || view.feedback?.text),
      });
      checked += 1;
    }
  }

  const summary = summarizeCoverage(steps);
  assert.equal(summary.steps, checked);
  assert.equal(summary.blank, 0);
  assert.equal(summary.unanchored, 0, "a text-only step must name its line or operation");
  assert.ok(summary.steps > 3000, `expected the full fixture corpus, saw ${summary.steps} steps`);
  assert.ok(summary.visual > summary.steps * 0.5, "most steps should carry a visual, not only a sentence");
});
