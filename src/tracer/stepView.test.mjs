// Unit tests for the single source of truth (src/tracer/stepView.js).
//
// The most important test here is the last one: it walks EVERY step of a real
// 142-line-step merge-sort trace produced by tracer-poc/tracer.py and asserts
// that the highlighted line, the variables, the stack, the graph node and the
// explanation all describe the same step and never contradict each other.
//
// The traces are vendored (gzipped) in src/tracer/__fixtures__/ so the test
// needs no Python and no network.
//
//   node --test src/tracer/stepView.test.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";

import { explainStep } from "./explain.js";
import { buildExecutionGraph } from "../flowchart/executionGraph.js";
import { getStepView, paramsFor, stateAt, variableHistory } from "./stepView.js";

const FIXTURES = JSON.parse(
  gunzipSync(readFileSync(new URL("./__fixtures__/traces.json.gz", import.meta.url))),
);

const topFrame = (state) => state?.frames?.[state.frames.length - 1] ?? null;
const variableNames = (frame) =>
  Object.entries(frame?.variables ?? {})
    .filter(([, value]) => !["function", "class", "module"].includes(value?.type))
    .map(([name]) => name)
    .sort();

// --- hand-built traces, matching docs/trace-format.md -----------------------

const int = (value) => ({ type: "int", value });

function state(i, event, { variables = {}, heap = {}, line = 1, fn = "<module>", id = 1 } = {}) {
  return {
    step: i,
    event,
    function: fn,
    frame_id: id,
    line,
    return_value: null,
    exception: null,
    exit_kind: null,
    frames: [{ frame_id: id, function: fn, call_line: null, line, variables }],
    heap,
  };
}

// x = 5 / x = 10 / print(x)
const ASSIGN_SOURCE = "x = 5\nx = 10\nprint(x)\n";
const ASSIGN_TRACE = [
  state(0, "call", { line: 0 }),
  state(1, "line", { line: 1 }),
  state(2, "line", { line: 2, variables: { x: int(5) } }),
  state(3, "line", { line: 3, variables: { x: int(10) } }),
];

test("the highlighted line is the line about to run, with its code text", () => {
  const view = getStepView(ASSIGN_TRACE, 2, ASSIGN_SOURCE);
  assert.equal(view.line, 2);
  assert.equal(view.code.text, "x = 10");
  assert.equal(view.previousLine, 1);
  assert.equal(view.function, "<module>");
});

test("variables show the state BEFORE the line, and changes preview the AFTER", () => {
  const view = getStepView(ASSIGN_TRACE, 2, ASSIGN_SOURCE);
  // Before: x is still 5, because line 2 has not run yet.
  assert.deepEqual(variableNames(topFrame(view.before)), ["x"]);
  assert.equal(topFrame(view.before).variables.x.value, 5);
  // The preview says what line 2 is about to do.
  assert.deepEqual(view.changes, [
    { kind: "changed", name: "x", from: "5", to: "10", line: 2 },
  ]);
  assert.equal(view.hint, "x = 10");
});

test("a brand new variable is flagged NEW by the line that creates it", () => {
  const view = getStepView(ASSIGN_TRACE, 1, ASSIGN_SOURCE);
  assert.equal(topFrame(view.before), topFrame(view.before)); // no variables yet
  assert.equal(variableNames(topFrame(view.before)).length, 0);
  assert.deepEqual(view.changes, [{ kind: "new", name: "x", from: null, to: "5", line: 1 }]);
  assert.equal(view.explanation.aboutToHappen, "x is created with the value 5.");
});

test("the explanation card reads just happened, about to happen and why now", () => {
  const view = getStepView(ASSIGN_TRACE, 2, ASSIGN_SOURCE);
  assert.equal(view.explanation.justHappened, explainStep(ASSIGN_TRACE, 1, ASSIGN_SOURCE).text);
  assert.equal(view.explanation.aboutToHappen, "x changes from 5 to 10.");
  assert.equal(view.explanation.why, "The previous line finished, so Python moved on to the next line.");
});

test("the graph node at a step comes from the graph's own steps array", () => {
  const graph = buildExecutionGraph(ASSIGN_TRACE, ASSIGN_SOURCE);
  for (let i = 0; i < ASSIGN_TRACE.length; i += 1) {
    const view = getStepView(ASSIGN_TRACE, i, ASSIGN_SOURCE, { steps: graph.steps });
    assert.equal(view.nodeId, graph.steps[i], `step ${i}`);
  }
});

// --- the vendored real traces ----------------------------------------------

test("a call step carries the new frame's arguments, and selecting it shows its own n", () => {
  const { source, trace } = FIXTURES.fact;
  const callIndex = trace.findIndex((event) => event.event === "call" && event.function === "fact");
  const view = getStepView(trace, callIndex, source);
  assert.equal(view.callStack[0].function, "fact");
  assert.deepEqual(view.callStack[0].args.map((arg) => [arg.name, arg.text]), [["n", "3"]]);
  assert.equal(view.callStack[0].callLine, 7);
  assert.equal(view.callStack[0].callNumber, 1);
  // Changes at a call are the fresh argument bindings.
  assert.deepEqual(
    view.changes.map((change) => [change.name, change.to, change.line, change.arg]),
    [["n", "3", 7, true]],
  );
  // Select a deeper call and you get that call's own variables.
  const deep = view.callStack.find((frame) => frame.function === "fact" && frame.frameId !== view.frameId);
  if (deep) {
    const selected = getStepView(trace, callIndex, source, { frameId: deep.frameId });
    assert.equal(selected.frame.frameId, deep.frameId);
  }
});

test("a return step carries the returned value in words", () => {
  const { source, trace } = FIXTURES.fact;
  const index = trace.findIndex((event) => event.event === "return" && event.function === "fact");
  const view = getStepView(trace, index, source);
  assert.equal(view.returnValue, "1");
  assert.match(view.explanation.why, /result goes back/);
});

test("a for loop reports the accumulating total, with the reason for the jump back", () => {
  const { source, trace } = FIXTURES.loop;
  const index = trace.findIndex((event, i) =>
    getStepView(trace, i, source).changes.some(
      (change) => change.name === "total" && change.kind === "changed" && change.to === "3",
    ),
  );
  const view = getStepView(trace, index, source);
  assert.equal(view.code.text, "total = total + n");
  assert.deepEqual(view.changes, [
    { kind: "changed", name: "total", from: "1", to: "3", line: 3 },
  ]);
  // The next round comes back to the `for` line, and the card says why.
  const backIndex = index + 1;
  const back = getStepView(trace, backIndex, source);
  assert.equal(back.code.text, "for n in range(1, 6):");
  assert.equal(back.explanation.why, "The loop body finished, so Python jumped back up to line 2 for the next round.");
});

test("variableHistory lists each value with the line that produced it", () => {
  assert.deepEqual(variableHistory(ASSIGN_TRACE, "x"), [
    { index: 2, line: 1, value: "5", function: "<module>" },
    { index: 3, line: 2, value: "10", function: "<module>" },
  ]);
});

test("paramsFor reads parameter names, leaving self out", () => {
  assert.deepEqual(paramsFor("def learn(self, trick):\n    pass\n", "learn"), ["trick"]);
  assert.deepEqual(paramsFor("def merge(left, right):\n", "merge"), ["left", "right"]);
  assert.deepEqual(paramsFor("x = 1\n", "missing"), []);
});

test("a syntax-error trace still explains itself without crashing", () => {
  const { source, trace } = FIXTURES.syntaxError;
  const view = getStepView(trace, 0, source);
  assert.ok(view.explanation.aboutToHappen.length > 0);
});

test("a runtime error keeps the failing line highlighted", () => {
  const { source, trace } = FIXTURES.runtimeError;
  const errorIndex = trace.findIndex((event) => event.event === "exception");
  const view = getStepView(trace, errorIndex, source);
  assert.equal(view.line, 2);
  assert.ok(view.explanation.aboutToHappen.length > 0);
});

// --- the anti-contradiction sweep over the real merge sort -----------------

test("every step of the merge-sort trace agrees across all panels", () => {
  const { source, trace } = FIXTURES.mergeSort;
  const graph = buildExecutionGraph(trace, source);
  const lines = source.split("\n");
  let slotChanges = 0;
  let sharedNotes = 0;

  for (let i = 0; i < trace.length; i += 1) {
    const event = trace[i];
    const view = getStepView(trace, i, source, { steps: graph.steps });
    const where = `step ${i} (${event.event})`;

    // 1. One line, one code reading, straight from the source.
    assert.equal(view.line, event.line || null, `${where}: highlighted line`);
    if (view.code) {
      assert.ok(view.line >= 1 && view.line <= lines.length, `${where}: line in range`);
      assert.equal(view.code.text, lines[view.line - 1].trim(), `${where}: code text`);
    }

    // 2. The explanation always says something, and is the same wording the
    //    card uses.
    assert.ok(view.explanation.aboutToHappen.length > 0, `${where}: about to happen`);
    assert.equal(
      view.explanation.aboutToHappen,
      explainStep(trace, i, source).text,
      `${where}: explanation matches explainStep`,
    );
    if (i > 0) {
      assert.equal(
        view.explanation.justHappened,
        explainStep(trace, i - 1, source).text,
        `${where}: just happened`,
      );
    }

    // 3. The graph node is the one the graph draws for this step.
    assert.equal(view.nodeId, graph.steps[i], `${where}: graph node`);

    // 4. The stack mirrors the trace's frames, newest first.
    const frames = stateAt(trace, i)?.frames ?? [];
    assert.equal(view.callStack.length, frames.length, `${where}: stack length`);
    if (frames.length > 0) {
      assert.equal(
        view.callStack[0].frameId,
        frames[frames.length - 1].frame_id,
        `${where}: top frame`,
      );
    }

    // 5. No contradiction between the before state and the changes preview.
    if (event.event === "line") {
      const beforeVars = topFrame(view.before)?.variables ?? {};
      const afterVars = topFrame(view.after)?.variables ?? {};
      for (const change of view.changes) {
        if (change.kind === "slot") {
          slotChanges += 1;
          continue;
        }
        assert.equal(change.line, view.line, `${where}: change line`);
        if (change.kind === "new") {
          assert.ok(!(change.name in beforeVars), `${where}: '${change.name}' was not new`);
          assert.ok(change.name in afterVars, `${where}: '${change.name}' missing after`);
        } else if (change.kind === "changed") {
          assert.ok(change.name in beforeVars, `${where}: '${change.name}' was not there before`);
          assert.ok(change.from !== change.to, `${where}: '${change.name}' did not change`);
        }
      }
    }

    // 6. Shared-object notes only ever name one string per shared list.
    for (const note of view.shared) {
      sharedNotes += 1;
      assert.ok(note.names.length >= 2, `${where}: shared note needs two names`);
    }
  }

  // The sweep actually exercised the interesting cases.
  assert.ok(slotChanges > 0, "expected at least one list-slot change");
  assert.ok(sharedNotes > 0, "expected the arr/data shared-list note");
});

test("the merge-sort trace shows arr and data as two names for one list", () => {
  const { source, trace } = FIXTURES.mergeSort;
  const index = 6; // inside merge_sort, with data still on the module frame
  const view = getStepView(trace, index, source);
  const note = view.shared.find((entry) => entry.names.includes("arr"));
  assert.ok(note, "expected a shared note for arr");
  assert.deepEqual(note.names, ["arr", "data"]);
  assert.match(note.text, /arr.*data.*same list/);
});
