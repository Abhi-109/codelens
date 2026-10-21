// The statement stage is the Adaptive canvas's view of an ordinary Python step.
// These tests use real corpus traces: a false first condition, a true elif, an
// assignment, a print, a for loop's first and last visit, and a while loop's
// true and false checks. A tampered stage must be rejected.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";

import { DEFAULT_REGISTRY } from "./adapters.js";
import { getStepView } from "./stepView.js";
import { getTraceIndex } from "./traceIndex.js";
import { buildStatementStage, validateStatementStage } from "./statementStage.js";
import { explainStep } from "./explain.js";

const CORPUS = JSON.parse(
  gunzipSync(readFileSync(new URL("./__fixtures__/corpus.json.gz", import.meta.url))),
);
const EMPTY = JSON.parse(
  gunzipSync(readFileSync(new URL("./__fixtures__/empty-source.json.gz", import.meta.url))),
);

function stageFor(name, index) {
  const entry = CORPUS[name];
  const trace = entry.trace;
  const stepView = getStepView(trace, index, entry.source);
  const context = {
    stepView,
    trace,
    traceIndex: getTraceIndex(trace),
    source: entry.source,
  };
  return { stage: buildStatementStage(context), context };
}

test("a false if shows the observed outcome, the skipped body, and the next reached elif", () => {
  const { stage, context } = stageFor("if-elif-else", 2);
  assert.equal(stage.kind, "branch");
  assert.equal(stage.display, "68 >= 90");
  assert.equal(stage.outcome, "false");
  assert.equal(stage.nextLine, 4);
  assert.deepEqual(
    stage.branches.map((branch) => [branch.line, branch.state, branch.outcome]),
    [
      [2, "current", "false"],
      [4, "next", null],
    ],
  );
  assert.equal(stage.branches[0].bodyState, "skipped");
  assert.deepEqual(
    stage.branches[0].body.map((line) => line.line),
    [3],
  );
  assert.equal(validateStatementStage(stage, context).valid, true);
});

test("a true elif shows its taken body and the later else as unreached", () => {
  const { stage, context } = stageFor("if-elif-else", 3);
  assert.equal(stage.display, "68 >= 60");
  assert.equal(stage.outcome, "true");
  assert.deepEqual(
    stage.branches.map((branch) => [branch.line, branch.state, branch.outcome]),
    [
      [2, "checked", "false"],
      [4, "current", "true"],
      [6, "unreached", null],
    ],
  );
  assert.equal(stage.branches[1].bodyState, "taken");
  assert.equal(stage.branches[1].body[0].line, 5);
  assert.equal(validateStatementStage(stage, context).valid, true);
});

test("an assignment stage carries the recorded value change", () => {
  const { stage, context } = stageFor("if-elif-else", 4);
  assert.equal(stage.kind, "assignment");
  assert.equal(stage.statement, "grade = 'B'");
  assert.deepEqual(stage.changes, [
    {
      name: "grade",
      changeKind: "new",
      from: null,
      to: '"B"',
      line: 5,
    },
  ]);
  assert.equal(validateStatementStage(stage, context).valid, true);
});

test("a print line uses the text the trace actually wrote", () => {
  const { stage, context } = stageFor("if-elif-else", 5);
  assert.equal(stage.kind, "print");
  assert.equal(stage.printed, "B");
  assert.equal(stage.nextLine, null);
  assert.equal(validateStatementStage(stage, context).valid, true);
});

test("a for loop shows its first item, then its exhausted exit", () => {
  const first = stageFor("for-loop", 2);
  assert.equal(first.stage.kind, "loop");
  assert.equal(first.stage.loopKind, "for");
  assert.equal(first.stage.iteration, 1);
  assert.equal(first.stage.nextValue, "1");
  assert.equal(first.stage.outcome, "true");
  assert.equal(validateStatementStage(first.stage, first.context).valid, true);

  const last = stageFor("for-loop", 12);
  assert.equal(last.stage.iteration, 6);
  assert.equal(last.stage.nextValue, null);
  assert.equal(last.stage.outcome, "false");
  assert.equal(last.stage.nextLine, 4);
  assert.equal(validateStatementStage(last.stage, last.context).valid, true);
});

test("a body assignment knows which loop round it belongs to", () => {
  const { stage, context } = stageFor("for-loop", 3);
  assert.equal(stage.kind, "assignment");
  assert.deepEqual(stage.loopContext, {
    line: 2,
    loopKind: "for",
    statement: "for n in range(1, 6):",
    iteration: 1,
  });
  assert.equal(validateStatementStage(stage, context).valid, true);
});

test("a while loop shows a true check and its false exit", () => {
  const trueCheck = stageFor("while-loop", 2);
  assert.equal(trueCheck.stage.loopKind, "while");
  assert.equal(trueCheck.stage.display, "3 > 0");
  assert.equal(trueCheck.stage.outcome, "true");
  assert.equal(trueCheck.stage.iteration, 1);
  assert.equal(validateStatementStage(trueCheck.stage, trueCheck.context).valid, true);

  const falseCheck = stageFor("while-loop", 17);
  assert.equal(falseCheck.stage.display, "0 > 0");
  assert.equal(falseCheck.stage.outcome, "false");
  assert.equal(falseCheck.stage.iteration, 4);
  assert.equal(falseCheck.stage.nextLine, 6);
  assert.equal(validateStatementStage(falseCheck.stage, falseCheck.context).valid, true);
});

test("the validator rejects a changed branch outcome or loop item", () => {
  const branch = stageFor("if-elif-else", 2);
  const tamperedBranch = structuredClone(branch.stage);
  tamperedBranch.branches[0].outcome = "true";
  assert.equal(validateStatementStage(tamperedBranch, branch.context).valid, false);

  const loop = stageFor("for-loop", 2);
  const tamperedLoop = structuredClone(loop.stage);
  tamperedLoop.nextValue = "99";
  assert.equal(validateStatementStage(tamperedLoop, loop.context).valid, false);
});

test("the generic adapter ships a stage that passes the scene validator", () => {
  for (const [name, index] of [
    ["if-elif-else", 2],
    ["if-elif-else", 3],
    ["for-loop", 3],
    ["while-loop", 17],
    ["variables", 1],
  ]) {
    const entry = CORPUS[name];
    const trace = entry.trace;
    const stepView = getStepView(trace, index, entry.source);
    const built = DEFAULT_REGISTRY.build("generic", {
      stepView,
      trace,
      traceIndex: getTraceIndex(trace),
      source: entry.source,
    });
    assert.equal(built.validation.valid, true, `${name} step ${index}: ${built.validation.errors}`);
    assert.ok(built.scene.stage, `${name} step ${index} has a statement stage`);
  }
});

test("fallback steps name the operation instead of always saying Step", () => {
  for (const [name, index, label] of [
    ["break-continue", 15, "Continue"],
    ["break-continue", 31, "Break"],
    ["function-basic", 1, "Function definition"],
    ["class-basic", 1, "Class definition"],
    ["import-module", 1, "Import"],
    ["exception-caught", 2, "Try block"],
    ["exception-reraise", 8, "Exception handler"],
    ["generator", 4, "Yield"],
  ]) {
    const { stage, context } = stageFor(name, index);
    assert.equal(stage.kind, "step", `${name} step ${index}`);
    assert.equal(stage.label, label, `${name} step ${index}`);
    assert.equal(validateStatementStage(stage, context).valid, true, `${name} step ${index}`);
  }
});

test("an empty program says so instead of showing a blank Step", () => {
  const trace = EMPTY.trace;
  const stepView = getStepView(trace, 1, EMPTY.source);
  const context = {
    stepView,
    trace,
    traceIndex: getTraceIndex(trace),
    source: EMPTY.source,
  };
  const stage = buildStatementStage(context);
  assert.equal(stage.kind, "step");
  assert.equal(stage.label, "Empty program");
  assert.equal(stage.note, "There are no statements to run.");
  assert.equal(stage.statement, null);
  assert.equal(stage.line, null);
  assert.equal(validateStatementStage(stage, context).valid, true);
  assert.equal(
    explainStep(trace, 1, EMPTY.source).text,
    "There are no statements to run.",
  );
});

