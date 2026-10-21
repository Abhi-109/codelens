// The shared execution model: one step, one honest story about what the
// program did. These tests walk real traces and pin the three places where
// that story used to break:
//
//   * print() writes text and its newline as separate chunks, so a newline
//     chunk must not be explained as a blank line;
//   * the module frame "returns" None when Python finishes, so completion is a
//     program-completion stage, not a function returning None;
//   * a caught exception continues the program, while an uncaught one ends it.
//
//   node --test src/tracer/executionSemantics.test.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";

import { DEFAULT_REGISTRY } from "./adapters.js";
import { buildExecutionGraph } from "../flowchart/executionGraph.js";
import { nextStep } from "../flowchart/nodeBody.js";
import { getStepView } from "./stepView.js";
import { buildStatementStage, validateStatementStage } from "./statementStage.js";
import { getTraceIndex } from "./traceIndex.js";

const CORPUS = JSON.parse(
  gunzipSync(readFileSync(new URL("./__fixtures__/corpus.json.gz", import.meta.url))),
);

function entry(name) {
  return CORPUS[name];
}

function viewOf(name, index) {
  const { trace, source } = entry(name);
  return getStepView(trace, index, source);
}

function staged(name, index) {
  const { trace, source } = entry(name);
  const context = {
    stepView: getStepView(trace, index, source),
    trace,
    traceIndex: getTraceIndex(trace),
    source,
  };
  return {
    context,
    stage: buildStatementStage(context),
    index: getTraceIndex(trace),
    trace,
  };
}

function outputIndices(name) {
  return entry(name).trace.flatMap((event, index) =>
    event.event === "output" ? [index] : [],
  );
}

test("the raw trace keeps output as writes and closes the module with a return", () => {
  for (const [name, expected] of [
    ["list-print-element", "cherry\n"],
    ["io-empty-print", "\ndone\n"],
    ["assign-only", ""],
    ["function-print-return", "inside\n42\n"],
  ]) {
    const { trace, result } = entry(name);
    assert.equal(
      trace.filter((event) => event.event === "output").map((event) => event.text).join(""),
      expected,
      `${name} output chunks are the program's own writes`,
    );
    assert.equal(result.output, expected);
    if (result.status === "completed") {
      const last = trace.at(-1);
      assert.equal(last.event, "return");
      assert.equal(last.function, "<module>");
      assert.deepEqual(last.return_value, { type: "none" });
    }
  }
});

test("a print newline is the end of its line, never a blank line", () => {
  for (const name of [
    "list-print-element",
    "function-print-return",
    "io-print-options",
    "variables",
    "while-loop",
  ]) {
    for (const index of outputIndices(name)) {
      const view = viewOf(name, index);
      const line = getTraceIndex(entry(name).trace).printedLineAt(index);
      const chunk = entry(name).trace[index].text ?? "";
      assert.equal(view.printed, line.text, `${name} step ${index}`);
      if (/^\n+$/.test(chunk)) {
        assert.match(view.explanation.aboutToHappen, /^This finishes /);
      } else {
        assert.match(view.explanation.aboutToHappen, /^The program prints: /);
      }
      assert.doesNotMatch(view.explanation.aboutToHappen, /blank line/);
    }
  }
});

test("a print's text and its newline read as two different moments", () => {
  const indices = outputIndices("list-print-element");
  assert.equal(indices.length, 2);
  const text = viewOf("list-print-element", indices[0]);
  const closing = viewOf("list-print-element", indices[1]);
  assert.equal(text.printed, "cherry");
  assert.equal(closing.printed, "cherry");
  assert.equal(text.explanation.aboutToHappen, "The program prints: cherry");
  assert.equal(closing.explanation.aboutToHappen, "This finishes the printed line: cherry");
  assert.notEqual(text.explanation.aboutToHappen, closing.explanation.aboutToHappen);
});

test("an empty-string print is blank; no output is not", () => {
  const blank = viewOf("io-empty-print", 2);
  assert.equal(blank.printed, "");
  assert.equal(blank.explanation.aboutToHappen, "This finishes a blank line.");

  const blankLineStep = viewOf("io-empty-print", 1);
  assert.equal(blankLineStep.explanation.aboutToHappen, "This line prints a blank line.");

  const text = viewOf("io-empty-print", 4);
  assert.equal(text.printed, "done");
  assert.equal(text.explanation.aboutToHappen, "The program prints: done");

  const closing = viewOf("io-empty-print", 5);
  assert.equal(closing.printed, "done");
  assert.equal(closing.explanation.aboutToHappen, "This finishes the printed line: done");

  const silent = entry("assign-only");
  assert.equal(silent.result.output, "");
  assert.equal(outputIndices("assign-only").length, 0);
  const final = viewOf("assign-only", silent.trace.length - 1);
  assert.equal(final.printed, null);
  assert.doesNotMatch(final.explanation.aboutToHappen, /blank line/);
  assert.doesNotMatch(final.explanation.justHappened ?? "", /blank line/);
});

test("a completed program ends on a program-completion stage, not a return of None", () => {
  let completed = 0;
  for (const name of Object.keys(CORPUS)) {
    const { trace } = entry(name);
    const last = trace.at(-1);
    if (last?.event !== "return" || last.function !== "<module>") continue;
    completed += 1;
    const index = trace.length - 1;
    const view = viewOf(name, index);
    assert.equal(view.returnValue, null, name);
    assert.equal(view.callStack[0].status, "completed", name);
    assert.equal(view.explanation.aboutToHappen, "The program finishes. That is the whole run!");

    const { context, stage } = staged(name, index);
    assert.equal(stage.kind, "complete", name);
    assert.equal(stage.label, "Program finished", name);
    assert.equal(stage.returnValue, null, name);
    assert.equal(stage.statement, null, name);
    assert.equal(validateStatementStage(stage, context).valid, true, name);
    const built = DEFAULT_REGISTRY.build("generic", context);
    assert.equal(built.validation.valid, true, `${name}: ${built.validation.errors}`);
    assert.equal(built.scene.stage.kind, "complete", name);
  }
  assert.ok(completed > 40, `expected the corpus to complete many programs, saw ${completed}`);
});

test("function returns keep their real value, including None", () => {
  for (const [name, fn, expected] of [
    ["function-basic", "greet", '"Hello, Asha"'],
    ["function-return-none", "label", "None"],
    ["function-implicit-none", "quiet", "None"],
    ["function-print-return", "report", "42"],
  ]) {
    const index = entry(name).trace.findIndex(
      (event) => event.event === "return" && event.function === fn,
    );
    assert.ok(index >= 0, `${name} recorded ${fn}'s return`);
    const view = viewOf(name, index);
    assert.equal(view.returnValue, expected, name);
    assert.equal(view.callStack[0].status, "returning", name);
    const { stage } = staged(name, index);
    assert.equal(stage.kind, "return", name);
    assert.equal(stage.returnValue, expected, name);
  }
});

test("a function printing one value does not claim it returned that value", () => {
  const trace = entry("function-print-return").trace;
  const printed = trace.findIndex((event) => event.event === "output" && event.text === "inside");
  const returned = trace.findIndex(
    (event) => event.event === "return" && event.function === "report",
  );

  const printView = viewOf("function-print-return", printed);
  assert.equal(printView.printed, "inside");
  assert.equal(printView.returnValue, null);

  const returnView = viewOf("function-print-return", returned);
  assert.equal(returnView.printed, null);
  assert.equal(returnView.returnValue, "42");
  assert.match(returnView.explanation.aboutToHappen, /hands back 42/);
});

test("a bare re-raise unwinds instead of looking like a return of None", () => {
  const { trace } = entry("exception-reraise");
  const unwindIndex = trace.findIndex(
    (event) => event.event === "unwind" && event.function === "risky",
  );
  assert.ok(unwindIndex >= 0, "the re-raise records an unwind");
  assert.ok(
    !trace.some((event) => event.event === "return" && event.function === "risky"),
    "a frame that re-raised did not return a value",
  );

  const view = viewOf("exception-reraise", unwindIndex);
  assert.equal(view.kind, "unwind");
  assert.equal(view.returnValue, null);
  assert.equal(view.callStack[0].status, "raising");
  assert.doesNotMatch(view.explanation.aboutToHappen, /returns None|hands back None/);

  const { stage } = staged("exception-reraise", unwindIndex);
  assert.equal(stage.kind, "error");
  assert.equal(stage.error.type, "ZeroDivisionError");
});

test("a caught exception continues; an uncaught one ends the run", () => {
  const trace = entry("combo-exception-loop").trace;
  const caughtIndex = trace.findIndex(
    (event, index) =>
      event.event === "exception" &&
      getTraceIndex(trace).exceptionOutcome(index) === "handled",
  );
  assert.ok(caughtIndex >= 0, "the corpus records a real handled exception");
  const caught = viewOf("combo-exception-loop", caughtIndex);
  assert.match(caught.explanation.aboutToHappen, /catches it, so the program can continue/);
  assert.equal(staged("combo-exception-loop", trace.length - 1).stage.kind, "complete");

  const failed = entry("error-division").trace;
  const failedIndex = failed.length - 1;
  const view = viewOf("error-division", failedIndex);
  assert.equal(view.kind, "error");
  assert.match(view.explanation.aboutToHappen, /could not run: ZeroDivisionError/);
  const { stage } = staged("error-division", failedIndex);
  assert.equal(stage.kind, "error");
  assert.notEqual(stage.kind, "complete");
  assert.equal(stage.error.type, "ZeroDivisionError");
  assert.equal(stage.error.message, "division by zero");
});

test("the flowchart card says the program ends instead of returning None", () => {
  const { trace, source } = entry("list-print-element");
  const graph = buildExecutionGraph(trace, source);
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const node = nodesById.get(graph.steps[graph.steps.length - 2]);
  assert.ok(node, "the last line has a graph node");
  const sample = graph.steps.findLastIndex(
    (id, index) =>
      id === node.id && trace[index + 1]?.event === "return" &&
      trace[index + 1]?.function === "<module>",
  );
  assert.ok(sample >= 0, "a card run is followed by the module return");
  const step = nextStep(sample, node, graph, trace, { source, nodesById });
  assert.doesNotMatch(step.text, /returns None/);
  assert.match(step.text, /the program ends/);
});

test("every step of the regression programs builds a valid generic scene", () => {
  for (const name of [
    "assign-only",
    "list-print-element",
    "function-return-none",
    "function-implicit-none",
    "function-print-return",
    "io-empty-print",
    "exception-caught",
    "combo-exception-loop",
    "error-division",
  ]) {
    const { trace, source } = entry(name);
    for (let index = 0; index < trace.length; index += 1) {
      const context = {
        stepView: getStepView(trace, index, source),
        trace,
        traceIndex: getTraceIndex(trace),
        source,
      };
      const built = DEFAULT_REGISTRY.build("generic", context);
      assert.equal(
        built.validation.valid,
        true,
        `${name} step ${index}: ${built.validation.errors}`,
      );
      assert.ok(built.scene.stage, `${name} step ${index} has a stage`);
      const id = built.scene.stage.kind;
      assert.ok(
        ["branch", "loop", "assignment", "print", "output", "input", "call", "return", "complete", "error", "step"].includes(id),
        `${name} step ${index} has a known stage kind (${id})`,
      );
      assert.equal(typeof built.scene.stage.label, "string");
      assert.ok(built.scene.stage.label.length > 0);
    }
  }
});
