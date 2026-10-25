// Property tests over the vendored corpus: every step of every program.
//
// tracer-poc/corpus.py collects ~45 small programs, one per construct, and
// dump_corpus.py vendors their real traces here. This file walks *every step*
// of *every* program through the same functions the UI uses and asserts the
// promises the panels make together:
//
//   * a step explains itself, and the wording is explainStep's;
//   * the highlighted line is a line that exists in the source;
//   * the graph node a step points at is a node the graph drew;
//   * values and changes come from the trace - nothing says "undefined",
//     "[object Object]", shows "?" where a value should be, or prints one of
//     the trace's internal ids (o7);
//   * stepping backwards rebuilds exactly the same step as stepping forwards;
//   * a card builds for every node of every program and says something.
//
// Categories are the grouping in docs/supported-python.md; this is where the
// "works for every construct, not just one example" claim is tested.
//
//   node --test src/tracer/corpus.test.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";

import { buildExecutionGraph } from "../flowchart/executionGraph.js";
import { cardBody, nodeRunIndex } from "../flowchart/nodeBody.js";
import { DEFAULT_REGISTRY } from "./adapters.js";
import { explainStep } from "./explain.js";
import { recognizeProgram } from "./recognition.js";
import { errorStep, getStepView } from "./stepView.js";
import { getTraceIndex } from "./traceIndex.js";

const CORPUS = JSON.parse(
  gunzipSync(readFileSync(new URL("./__fixtures__/corpus.json.gz", import.meta.url))),
);
const RECOGNITION = JSON.parse(
  gunzipSync(readFileSync(new URL("./__fixtures__/recognition.json.gz", import.meta.url))),
);
const PROGRAMS = Object.entries(CORPUS);

// A leaked identifier looks like `o7`; a leaked value is undefined/NaN/an
// object printed by String(). None of these may reach a learner.
const LEAKED = /\bundefined\b|\bNaN\b|\[object Object\]|\bo\d+\b/;

/** Everything the learner could read for one step, in one string. */
function readable(view) {
  const parts = [
    view.code?.text ?? "",
    view.explanation?.justHappened ?? "",
    view.explanation?.aboutToHappen ?? "",
    view.explanation?.why ?? "",
    view.hint ?? "",
    view.returnValue ?? "",
    view.printed ?? "",
    ...(view.shared ?? []).map((note) => note.text ?? ""),
    ...Object.values(view.values ?? {}),
    ...(view.callStack ?? []).flatMap((frame) => [
      `${frame.function}#${frame.callNumber}`,
      ...(frame.variables ?? []).map((variable) => `${variable.name}=${variable.text}`),
    ]),
    ...(view.changes ?? []).map((change) => `${change.name} ${change.from} ${change.to}`),
  ];
  return parts.join(" ");
}

/** A projection of a view, everything the panels render from it. */
function projected(view) {
  return JSON.stringify({
    index: view.index,
    kind: view.kind,
    line: view.line,
    function: view.function,
    frameId: view.frameId,
    nodeId: view.nodeId,
    code: view.code,
    values: view.values,
    changes: view.changes,
    shared: view.shared,
    stack: (view.callStack ?? []).map((frame) => [
      frame.frameId,
      frame.function,
      frame.callNumber,
      frame.returnValue,
    ]),
    explanation: view.explanation,
    hint: view.hint,
    printed: view.printed,
    returnValue: view.returnValue,
    nextNode: view.nextNode,
    cameFrom: view.cameFrom,
  });
}

test("the corpus is broad: many programs across many categories", () => {
  const categories = new Set(PROGRAMS.map(([, program]) => program.category));
  assert.ok(PROGRAMS.length >= 40, `${PROGRAMS.length} programs`);
  assert.ok(categories.size >= 25, `${categories.size} categories`);
  // The twelve constructs the teaching layer must generalise to, named in
  // docs/supported-python.md, each proven by a program here.
  const required = [
    "basic variables",
    "if / elif / else",
    "for loop",
    "while loop",
    "break and continue",
    "lists",
    "dictionaries",
    "tuples and unpacking",
    "sets",
    "functions",
    "recursion",
    "exceptions",
    "runtime errors",
    "classes",
    "class inheritance",
    "scope",
    "imports",
    "input and output",
    "generators",
    "async and await",
    "safety limits",
  ];
  for (const category of required) {
    assert.ok(
      PROGRAMS.some(([, program]) => program.category === category),
      `no program for ${category}`,
    );
  }
});

test("every step of every program explains itself from the trace", () => {
  let steps = 0;
  for (const [name, program] of PROGRAMS) {
    const { source, trace } = program;
    const graph = buildExecutionGraph(trace, source);
    const lines = source.split("\n");

    for (let i = 0; i < trace.length; i += 1) {
      const event = trace[i];
      const where = `${name} step ${i} (${event.event})`;
      const view = getStepView(trace, i, source, { steps: graph.steps });

      assert.equal(view.event, event, `${where}: same event`);
      assert.equal(view.line, event.line || null, `${where}: highlighted line`);
      if (view.code) {
        assert.ok(view.line >= 1 && view.line <= lines.length, `${where}: line in range`);
        assert.equal(view.code.text, lines[view.line - 1].trim(), `${where}: code text`);
      }

      // The three cards of the explanation card are always populated, and the
      // third one answers "why is control here?" for every kind of step.
      assert.ok(view.explanation.aboutToHappen.length > 0, `${where}: about to happen`);
      assert.equal(
        view.explanation.aboutToHappen,
        explainStep(trace, i, source).text,
        `${where}: the same wording explainStep gives`,
      );
      if (i > 0) assert.ok(view.explanation.justHappened.length > 0, `${where}: just happened`);
      assert.ok(view.explanation.why, `${where}: why is control here`);

      // The stack shown is the stack in the trace's own state.
      const stateFrames = view.event.frames ?? view.before?.frames ?? [];
      assert.equal(view.callStack.length, stateFrames.length, `${where}: stack length`);
      if (stateFrames.length > 0) {
        assert.equal(
          view.callStack[0].frameId,
          stateFrames[stateFrames.length - 1].frame_id,
          `${where}: newest frame is on top`,
        );
      }

      // The node the panels and the graph both point at.
      assert.equal(view.nodeId, graph.steps[i], `${where}: graph node`);
      if (event.event === "line") {
        assert.ok(view.nodeId, `${where}: a line event has a node`);
      }
      steps += 1;
    }
  }
  assert.ok(steps > 800, `${steps} steps walked`);
});

test("no step shows an invented value, a '?', or one of the trace's ids", () => {
  for (const [name, program] of PROGRAMS) {
    const { source, trace } = program;
    const graph = buildExecutionGraph(trace, source);
    for (let i = 0; i < trace.length; i += 1) {
      const view = getStepView(trace, i, source, { steps: graph.steps });
      const where = `${name} step ${i}`;
      const text = readable(view);

      assert.doesNotMatch(text, LEAKED, `${where}: leaked value in "${text.slice(0, 200)}"`);
      for (const [variable, value] of Object.entries(view.values)) {
        assert.notEqual(value, "?", `${where}: value of ${variable} is unknown`);
        assert.notEqual(value, "", `${where}: value of ${variable} is empty`);
      }
      for (const change of view.changes) {
        assert.notEqual(change.to, "?", `${where}: ${change.name} has no value after`);
        if (change.from !== null) {
          assert.notEqual(change.from, "?", `${where}: ${change.name} has no value before`);
          assert.notEqual(change.from, change.to, `${where}: ${change.name} "changed" to itself`);
        } else {
          assert.ok(
            change.kind === "new" || change.kind === "new-slot",
            `${where}: ${change.name} has no before value, so it must be marked new`,
          );
        }
      }
    }
  }
});

test("stepping backwards rebuilds exactly the same step as stepping forwards", () => {
  for (const [name, program] of PROGRAMS) {
    const { source, trace } = program;
    const graph = buildExecutionGraph(trace, source);
    const forward = [];
    for (let i = 0; i < trace.length; i += 1) {
      forward.push(projected(getStepView(trace, i, source, { steps: graph.steps })));
    }
    // Now walk the same trace in reverse, the way the Back button does.
    for (let i = trace.length - 1; i >= 0; i -= 1) {
      const backward = projected(getStepView(trace, i, source, { steps: graph.steps }));
      assert.equal(backward, forward[i], `${name} step ${i}: back and forward disagree`);
    }
  }
});

test("every category shows values and changes somewhere in its programs", () => {
  const byCategory = new Map();
  for (const [name, program] of PROGRAMS) {
    const group = byCategory.get(program.category) ?? {
      names: [],
      values: 0,
      changes: 0,
      explained: 0,
    };
    group.names.push(name);
    const { source, trace } = program;
    for (let i = 0; i < trace.length; i += 1) {
      const view = getStepView(trace, i, source);
      group.values += Object.keys(view.values).length;
      group.changes += view.changes.length;
      if (view.explanation.aboutToHappen) group.explained += 1;
    }
    byCategory.set(program.category, group);
  }
  for (const [category, group] of byCategory) {
    if (group.values === 0 && group.changes === 0) {
      // A category where nothing ever ran — a syntax error — still has to say
      // why there is nothing to show. Inventing values here would be a lie.
      assert.ok(
        group.explained > 0,
        `${category}: nothing ran and nothing explains why`,
      );
      continue;
    }
    assert.ok(group.values > 0, `${category}: no variable values anywhere`);
    assert.ok(group.changes > 0, `${category}: nothing ever changes`);
  }
});

test("an error program opens on the line that failed", () => {
  for (const [name, program] of PROGRAMS) {
    if (program.result?.status !== "error") continue;
    const { source, trace } = program;
    const graph = buildExecutionGraph(trace, source);
    const view = getStepView(trace, errorStep(trace), source, { steps: graph.steps });
    const exceptionIndex = trace.findIndex((event) => event.event === "exception");
    if (exceptionIndex >= 0) {
      // The run stops on the failing line, and that is what stays highlighted.
      assert.equal(view.line, program.result.error_line, `${name}: failing line`);
      assert.ok(view.explanation.aboutToHappen.length > 0, `${name}: still explained`);
    } else {
      // A syntax error never ran: there is one event and it explains itself.
      assert.equal(trace.length, 1, `${name}: only the error event`);
      assert.ok(view.explanation.aboutToHappen.length > 0, `${name}: still explained`);
    }
  }
});

test("a run stopped by a limit is shown as stopped, with its real last state", () => {
  for (const [name, program] of PROGRAMS) {
    const status = program.result?.status;
    if (!["step_limit", "timeout", "output_limit"].includes(status)) continue;
    const { source, trace } = program;
    const last = trace[trace.length - 1];
    assert.equal(
      status,
      last.event,
      `${name}: the trace's last event names the stop`,
    );
    const view = getStepView(trace, trace.length - 1, source);
    assert.ok(view.explanation.aboutToHappen.length > 0, `${name}: the stop is explained`);
    assert.doesNotMatch(readable(view), LEAKED, `${name}: no leak at the stop`);
  }
});

test("no step of any program falls back to the generic line wording", () => {
  // The fallback still exists for unfamiliar syntax, but every construct the
  // corpus promises has a specific explanation. A new program that only says
  // "Runs this line: …" is a gap in the shared explainer, not a new feature.
  for (const [name, program] of PROGRAMS) {
    const { source, trace } = program;
    for (let i = 0; i < trace.length; i += 1) {
      if (trace[i].event !== "line") continue;
      const view = getStepView(trace, i, source);
      assert.doesNotMatch(
        view.explanation.aboutToHappen,
        /^Runs this line:/,
        `${name} step ${i}: ${view.code?.text ?? "(no code)"}`,
      );
    }
  }
});

test("statements the generic rules used to skip name what really happened", () => {
  const expected = [
    ["class-basic", 9, 'Sets self.name to "Rex".'],
    ["class-basic", 10, "Sets self.tricks to []."],
    ["class-basic", 14, "Calls the method append() on self.tricks."],
    ["class-property", 6, "Decorates the function below with property, so it is wrapped before anyone calls it."],
    ["tuple-unpack", 2, "Unpacks point into x and y: x = 3, y = 4."],
    ["tuple-unpack", 3, "Swaps x and y: x = 4, y = 3."],
    ["list-mutation", 5, "Deletes one item: scores[2]."],
    ["import-module", 1, "Loads the math module and makes it available."],
    ["import-module", 2, "Takes sqrt from math, so the program can use it by name."],
    ["generator-delegates", 5, "Hands every value from inner() to the caller, one at a time."],
    ["generator-delegates", 7, "Produces 'a' and pauses here until the next value is asked for."],
    ["alias-dict-in-list", 3, "Sets rows[0]['score'] to 5."],
  ];
  for (const [name, index, text] of expected) {
    const { source, trace } = PROGRAMS.find(([key]) => key === name)[1];
    const view = getStepView(trace, index, source);
    assert.equal(view.explanation.aboutToHappen, text, `${name} step ${index}`);
  }
});

test("aliasing keeps one object behind two names or two slots", () => {
  // Two names for one list: the trace, not the explainer, proves they share it.
  const shared = CORPUS["alias-shared"];
  const view = getStepView(shared.trace, 3, shared.source);
  assert.equal(view.shared.length, 1);
  assert.deepEqual([...view.shared[0].names].sort(), ["alias", "numbers"]);
  assert.match(view.shared[0].text, /same list/);

  // One dictionary stored twice in a list stays one object: writing through
  // rows[0] is visible through rows[1], and the heap holds a single dict.
  const nested = CORPUS["alias-dict-in-list"];
  const after = nested.trace[4];
  const rows = after.heap[after.frames[0].variables.rows.id];
  assert.equal(rows.type, "list");
  assert.equal(rows.items[0].id, rows.items[1].id);
  assert.equal(after.heap[rows.items[0].id].entries.length, 2);
});

test("a function can return from more than one exit", () => {
  const { source, trace } = CORPUS["function-early-return"];
  const returned = trace
    .filter((event) => event.event === "return" && event.function === "classify")
    .map((event) => event.return_value.value);
  assert.deepEqual(returned, ["negative", "zero", "positive"]);
  for (const line of [3, 5, 6]) {
    assert.ok(
      trace.some((event) => event.event === "return" && event.line === line),
      `the return on line ${line} ran`,
    );
  }
  // The line event and the return event it produces are consecutive steps; a
  // comparison inside the return expression would sit between them, so the pair
  // is located from the recorded return rather than a fixed index.
  const first = trace.findIndex(
    (event) => event.event === "return" && event.function === "classify",
  );
  assert.match(getStepView(trace, first - 1, source).explanation.aboutToHappen, /hands back 'negative'/);
  assert.match(getStepView(trace, first, source).explanation.aboutToHappen, /hands back "negative"/);
});

test("every step builds a valid scene for the adapter recognition chose", () => {
  // The canvas only ever draws what the registry validated. This is the same
  // path the Adaptive canvas takes, over every recorded step of every program.
  for (const [name, program] of PROGRAMS) {
    const profile = RECOGNITION.corpus_profiles[name];
    assert.ok(profile, `${name}: no recorded profile`);
    const { source, trace, result } = program;
    const recognition = recognizeProgram({ profile, trace, status: result.status });
    const traceIndex = getTraceIndex(trace);
    for (let i = 0; i < trace.length; i += 1) {
      const where = `${name} step ${i} (${trace[i].event})`;
      const context = {
        stepView: getStepView(trace, i, source),
        trace,
        traceIndex,
        source,
        profile,
        recognition,
        result,
      };
      const built = DEFAULT_REGISTRY.build(recognition.adapterId, context);
      assert.equal(built.validation?.valid, true, `${where}: ${built.validation?.errors?.join("; ")}`);
      assert.ok(["ok", "partial"].includes(built.scene.status), `${where}: scene status`);
      assert.equal(built.fallbackReason, null, `${where}: fell back because ${built.fallbackReason}`);
      assert.equal(built.scene.adapterId, recognition.adapterId, `${where}: drawn adapter`);
      assert.equal(built.scene.meta.stepIndex, i, `${where}: scene points at this step`);
    }
  }
});

test("every card of every program builds and says something real", () => {
  for (const [name, program] of PROGRAMS) {
    const { source, trace } = program;
    const graph = buildExecutionGraph(trace, source);
    const usable = nodeRunIndex(trace, graph);
    const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
    const marks = [0, Math.floor(trace.length / 2), trace.length - 1];
    for (const index of marks) {
      for (const node of graph.nodes) {
        const body = cardBody(node, { graph, trace, source, index, usable, nodesById });
        const where = `${name} step ${index + 1}, node ${node.id}`;
        assert.equal(typeof body.values, "string", where);
        assert.equal(typeof body.foot, "string", where);
        assert.doesNotMatch(`${body.values} ${body.foot}`, LEAKED, where);
        // A card that ran has code and an action, and says where control goes
        // next; a card the program has not reached yet says nothing at all
        // rather than inventing values it does not have.
        assert.ok(node.text, `${where}: has code`);
        assert.ok(node.action, `${where}: has an action`);
        if (body.sample >= 0) {
          assert.ok(body.foot, `${where}: says where control goes`);
        } else {
          assert.equal(body.values, "", `${where}: nothing yet, so nothing shown`);
        }
      }
    }
  }
});
