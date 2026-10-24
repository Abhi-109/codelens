// The diff core's contract: snapshots, state actions, overlays, and the round
// trip. Nothing here is allowed to be normalised to make a property pass - the
// compared state is exactly docs/animation.md section 3.
//
//   node --test src/animation/diff.test.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";

import {
  FALLBACK_REASON,
  STATE_KINDS,
  canonicalValue,
  isStateAction,
  overlayActionsAt,
} from "./actions.js";
import {
  applyState,
  consoleFollowsReturn,
  diffSteps,
  reverseActions,
  snapshotAt,
  stateActions,
  stateOf,
} from "./diff.js";

const read = (path) =>
  JSON.parse(gunzipSync(readFileSync(new URL(path, import.meta.url))).toString());

const CORPUS = read("./../tracer/__fixtures__/corpus.json.gz");
const RECOGNITION = read("./../tracer/__fixtures__/recognition.json.gz");

const eventsOf = (trace) => (Array.isArray(trace) ? trace : Object.values(trace));

function program(name) {
  const entry = CORPUS[name];
  assert.ok(entry, `${name} is in the corpus fixture`);
  return { name, source: entry.source, trace: eventsOf(entry.trace) };
}

/** A compact, hand-reviewable rendering of an action, for the golden lists. */
const brief = (value) => {
  if (value === null || value === undefined) return "-";
  if (value.frame_id !== undefined) return `f${value.frame_id}`;
  switch (value.type) {
    case "none":
      return "None";
    case "int":
      return String(value.value);
    case "float":
      return String(value.value ?? value.repr);
    case "str":
      return JSON.stringify(value.value);
    case "bool":
      return String(value.value);
    case "ref":
      return value.id;
    case "function":
      return `fn ${value.name}`;
    case "class":
      return `class ${value.name}`;
    default:
      return value.name ?? value.type;
  }
};

const argsOf = (variables) =>
  `{${Object.entries(variables ?? {})
    .map(([name, value]) => `${name}=${brief(value)}`)
    .join(", ")}}`;

function describe(action) {
  switch (action.kind) {
    case "call":
      return `call ${action.path} ${action.to.function} ${argsOf(action.payload.args)}`;
    case "return":
      return `return ${action.path} ${brief(action.payload.value)} ->${action.payload.to}`;
    case "print":
      return `print ${JSON.stringify(action.payload.text)}`;
    case "error":
      return `error ${action.path} ${action.payload.type} "${action.payload.message}" line ${action.payload.line}`;
    case "appear":
      return `appear ${action.path} ${brief(action.to)}`;
    case "disappear":
      return `disappear ${action.path} ${brief(action.from)}`;
    case "change":
      return `change ${action.path} ${brief(action.from)} -> ${brief(action.to)}`;
    default:
      return `${action.kind} ${action.path}`;
  }
}

/** One golden row per event: the actions of that step, joined. */
function goldenRows({ source, trace }) {
  return trace.map((event, index) =>
    diffSteps(index === 0 ? null : snapshotAt(trace, index - 1), snapshotAt(trace, index), {
      source,
      consoleAfterReturn: consoleFollowsReturn(trace, index),
    })
      .map(describe)
      .join(" | "),
  );
}

test("snapshotAt gives a print step the state it printed from", () => {
  const { trace } = program("function-print-return");
  const print = trace.findIndex((event) => event.event === "output");
  const snapshot = snapshotAt(trace, print);
  assert.equal(snapshot.step, trace[print].step, "the snapshot keeps its own step");
  assert.equal(snapshot.event, "output");
  assert.equal(snapshot.text, trace[print].text);
  const earlier = trace.slice(0, print).reverse().find((event) => Array.isArray(event.frames));
  assert.equal(snapshot.frames, earlier.frames, "the last recorded stack is carried forward");
  assert.equal(snapshot.heap, earlier.heap);

  // Outside the trace there is no snapshot at all.
  assert.equal(snapshotAt(trace, -1), null);
  assert.equal(snapshotAt(trace, trace.length), null);
  assert.equal(snapshotAt(trace, 1.5), null);
  assert.equal(snapshotAt("not a trace", 0), null);

  // A trace that never records a state still yields an empty one.
  const syntax = eventsOf(CORPUS["error-syntax"].trace);
  assert.deepEqual(stateOf(snapshotAt(syntax, 0)), { frames: [], heap: {} });
  assert.equal(snapshotAt(syntax, 0).type, "SyntaxError");

  // A limit event records no state either, so it shows the last line's.
  const limited = eventsOf(CORPUS["limit-steps"].trace);
  const limit = limited.length - 1;
  const limitedSnap = snapshotAt(limited, limit);
  assert.equal(limitedSnap.event, "step_limit");
  assert.equal(limitedSnap.limit, 400);
  assert.deepEqual(stateOf(limitedSnap), stateOf(snapshotAt(limited, limit - 1)));
});

test("stateOf is exactly the compared state, and a copy of it", () => {
  const { trace } = program("for-loop");
  const snapshot = snapshotAt(trace, 3);
  const state = stateOf(snapshot);
  assert.deepEqual(Object.keys(state).sort(), ["frames", "heap"]);
  assert.equal(state.heap, snapshot.heap, "no action this module emits changes the heap");
  for (const frame of state.frames) {
    assert.deepEqual(
      Object.keys(frame).sort(),
      ["call_line", "frame_id", "function", "variables"],
      "frame.line is cursor metadata, not state",
    );
  }
  state.frames[0].variables.injected = { type: "int", value: 1 };
  assert.equal(Object.hasOwn(snapshot.frames[0].variables, "injected"), false, "the trace is untouched");
  assert.deepEqual(stateOf(null), { frames: [], heap: {} });
});

test("the module frame and a variable's first value are golden", () => {
  const rows = goldenRows(program("assign-only"));
  assert.deepEqual(rows, [
    "call f1 <module> {}",
    "",
    "appear f1.x 1",
    "appear f1.y 2 | return f1 None ->null",
  ]);
  // The module return names no console: nothing was printed after it.
  assert.equal(rows[3].includes("->console"), false);
});

test("branches, loop accumulators and reassignment are golden", () => {
  assert.deepEqual(goldenRows(program("if-elif-else")), [
    "call f1 <module> {}",
    "",
    'appear f1.marks 68',
    "",
    "",
    'appear f1.grade "B"',
    'print "B"',
    'print "\\n"',
    "return f1 None ->null",
  ]);
  assert.deepEqual(goldenRows(program("for-loop")), [
    "call f1 <module> {}",
    "",
    "appear f1.total 0",
    "appear f1.n 1",
    "change f1.total 0 -> 1",
    "change f1.n 1 -> 2",
    "change f1.total 1 -> 3",
    "change f1.n 2 -> 3",
    "change f1.total 3 -> 6",
    "change f1.n 3 -> 4",
    "change f1.total 6 -> 10",
    "change f1.n 4 -> 5",
    "change f1.total 10 -> 15",
    "",
    'print "15"',
    'print "\\n"',
    "return f1 None ->null",
  ]);
});

test("calls, returns and printed output are golden", () => {
  assert.deepEqual(goldenRows(program("function-print-return")), [
    "call f1 <module> {}",
    "",
    "appear f1.report fn report",
    "call f2 report {}",
    "",
    'print "inside"',
    'print "\\n"',
    "",
    // "42" is printed straight after report() returns, so it may fly to the console.
    "return f2 42 ->console",
    'print "42"',
    'print "\\n"',
    "disappear f2 f2 | return f1 None ->null",
  ]);
  assert.deepEqual(goldenRows(program("recursion")), [
    "call f1 <module> {}",
    "",
    "appear f1.fact fn fact",
    "call f2 fact {n=5}",
    "",
    "",
    "call f3 fact {n=4}",
    "",
    "",
    "call f4 fact {n=3}",
    "",
    "",
    "call f5 fact {n=2}",
    "",
    "",
    "call f6 fact {n=1}",
    "",
    "",
    // Nothing is printed between these returns, so they name no destination.
    "return f6 1 ->null",
    "disappear f6 f6 | return f5 2 ->null",
    "disappear f5 f5 | return f4 6 ->null",
    "disappear f4 f4 | return f3 24 ->null",
    "disappear f3 f3 | return f2 120 ->console",
    'print "120"',
    'print "\\n"',
    "disappear f2 f2 | return f1 None ->null",
  ]);
});

test("an exception and the run's error are golden", () => {
  assert.deepEqual(goldenRows(program("error-division")), [
    "call f1 <module> {}",
    "",
    "appear f1.divide fn divide",
    "call f2 divide {a=6, b=2}",
    "",
    "return f2 3 ->console",
    'print "3.0"',
    'print "\\n"',
    "disappear f2 f2",
    "call f3 divide {a=1, b=0}",
    "",
    'error f3 ZeroDivisionError "division by zero" line 2',
    "",
    "disappear f3 f3 | error f1 ZeroDivisionError \"division by zero\" line 5",
    "",
    'error console ZeroDivisionError "division by zero" line 2',
  ]);
});

test("a return names the console only when output was recorded after it", () => {
  const { trace } = program("function-print-return");
  const returnAt = trace.findIndex((event) => event.event === "return" && event.function === "report");
  assert.equal(consoleFollowsReturn(trace, returnAt), true);
  assert.equal(
    consoleFollowsReturn(trace, trace.length - 1),
    false,
    "a return with nothing after it has no destination",
  );
  const recursive = program("recursion").trace;
  const inner = recursive.findIndex((event) => event.event === "return" && event.function === "fact");
  assert.equal(consoleFollowsReturn(recursive, inner), false, "a following return is a control event");

  // The destination is a decision of the caller, and the default is no destination.
  const withConsole = diffSteps(snapshotAt(trace, returnAt - 1), snapshotAt(trace, returnAt), {
    consoleAfterReturn: true,
  });
  const plain = diffSteps(snapshotAt(trace, returnAt - 1), snapshotAt(trace, returnAt));
  assert.equal(withConsole.at(-1).payload.to, "console");
  assert.equal(plain.at(-1).payload.to, null);
  assert.equal(consoleFollowsReturn(trace, 0), false);
  assert.equal(consoleFollowsReturn(null, 0), false);
});

test("print and return overlays carry recorded values, never invented ones", () => {
  const { trace } = program("function-print-return");
  const returnAt = trace.findIndex((event) => event.event === "return" && event.function === "report");
  const actions = diffSteps(snapshotAt(trace, returnAt - 1), snapshotAt(trace, returnAt));
  const overlay = actions.at(-1);
  assert.equal(overlay.kind, "return");
  assert.equal(overlay.effect, "overlay");
  assert.equal(overlay.path, "f2");
  assert.equal(overlay.payload.function, "report");
  assert.deepEqual(overlay.payload.value, trace[returnAt].return_value);
  assert.equal(isStateAction(overlay), false);

  const print = trace.findIndex((event) => event.event === "output");
  const printed = diffSteps(snapshotAt(trace, print - 1), snapshotAt(trace, print));
  assert.deepEqual(printed.map((action) => action.kind), ["print"]);
  assert.equal(printed[0].payload.text, trace[print].text);
  assert.deepEqual(printed[0].target, { kind: "console" });

  // An input event is not printed twice: its echo is the following output event.
  const input = eventsOf(CORPUS["io-input"].trace);
  const inputAt = input.findIndex((event) => event.event === "input");
  assert.deepEqual(diffSteps(snapshotAt(input, inputAt - 1), snapshotAt(input, inputAt)), []);
});

test("the error badge rides the exception, not the unwind, plus the run's outcome", () => {
  const { trace } = program("error-division");
  const raise = trace.findIndex((event) => event.event === "exception");
  const raised = diffSteps(snapshotAt(trace, raise - 1), snapshotAt(trace, raise));
  const badge = raised.at(-1);
  assert.equal(badge.kind, "error");
  assert.equal(badge.path, "f3");
  assert.deepEqual(badge.payload, {
    type: "ZeroDivisionError",
    message: "division by zero",
    line: 2,
  });

  const unwind = raise + 1;
  assert.equal(trace[unwind].event, "unwind");
  assert.deepEqual(diffSteps(snapshotAt(trace, unwind - 1), snapshotAt(trace, unwind)), []);

  const terminal = trace.length - 1;
  assert.equal(trace[terminal].event, "error");
  const outcome = diffSteps(snapshotAt(trace, terminal - 1), snapshotAt(trace, terminal));
  assert.deepEqual(outcome.map(describe), [
    'error console ZeroDivisionError "division by zero" line 2',
  ]);

  // A compile error has no frame at all.
  const syntax = eventsOf(CORPUS["error-syntax"].trace);
  const compile = diffSteps(null, snapshotAt(syntax, 0));
  assert.deepEqual(compile.map(describe), ['error console SyntaxError "invalid syntax" line 1']);
  assert.equal(compile[0].payload.phase, "compile");
});

test("a limit event adds no action and claims no state change", () => {
  const { trace } = program("limit-steps");
  const limit = trace.length - 1;
  assert.equal(trace[limit].event, "step_limit");
  assert.deepEqual(diffSteps(snapshotAt(trace, limit - 1), snapshotAt(trace, limit)), []);
});

test("the round trip is exact for the golden programs", () => {
  for (const name of [
    "assign-only",
    "if-elif-else",
    "for-loop",
    "function-print-return",
    "error-division",
    "recursion",
  ]) {
    const { source, trace } = program(name);
    for (let index = 0; index < trace.length; index += 1) {
      const prev = index === 0 ? null : snapshotAt(trace, index - 1);
      const next = snapshotAt(trace, index);
      const before = stateOf(prev);
      const after = stateOf(next);
      const actions = diffSteps(prev, next, {
        source,
        consoleAfterReturn: consoleFollowsReturn(trace, index),
      });
      assert.deepEqual(
        canonicalValue(before.heap),
        canonicalValue(after.heap),
        `${name} step ${next.step} keeps the heap unchanged, so the state actions are complete`,
      );
      assert.deepEqual(applyState(before, actions), after, `${name} step ${next.step} forward`);
      assert.deepEqual(
        applyState(after, reverseActions(actions)),
        before,
        `${name} step ${next.step} backward`,
      );
    }
  }
});

test("the same round trip holds over the whole corpus wherever the heap is unchanged", () => {
  const programs = [
    ...Object.entries(CORPUS).map(([name, entry]) => ({
      name,
      trace: eventsOf(entry.trace),
    })),
    ...Object.entries(RECOGNITION.programs).map(([name, entry]) => ({
      name: `recognition/${name}`,
      trace: eventsOf(entry.trace),
    })),
  ];
  const failures = [];
  let checked = 0;
  let deferred = 0;
  for (const { name, trace } of programs) {
    for (let index = 0; index < trace.length; index += 1) {
      const prev = index === 0 ? null : snapshotAt(trace, index - 1);
      const next = snapshotAt(trace, index);
      const before = stateOf(prev);
      const after = stateOf(next);
      const actions = diffSteps(prev, next);
      // Task 4 emits no collection action, so a heap transition cannot round
      // trip yet. It is counted, not hidden: tasks 5 and 6 make it complete.
      if (canonicalValue(before.heap) !== canonicalValue(after.heap)) {
        deferred += 1;
        for (const action of actions) {
          if (["cell", "entry", "attribute", "object"].includes(action.target.kind)) {
            failures.push(`${name} step ${next.step} invented a ${action.target.kind} action`);
          }
        }
        continue;
      }
      checked += 1;
      try {
        assert.deepEqual(applyState(before, actions), after);
        assert.deepEqual(applyState(after, reverseActions(actions)), before);
      } catch {
        failures.push(`${name} step ${next.step} does not round trip`);
      }
    }
  }
  assert.deepEqual(failures, []);
  assert.ok(checked > 500, `${checked} heap-stable transitions were checked`);
  assert.ok(deferred > 100, `${deferred} heap transitions are deferred to tasks 5-6`);
});

test("a heap change alone produces no action and no claim yet", () => {
  const { trace } = program("list-mutation");
  // scores[0] = 99 changes only the heap.
  const change = trace.findIndex((event, index) => {
    if (index === 0) return false;
    const before = stateOf(snapshotAt(trace, index - 1));
    const after = stateOf(snapshotAt(trace, index));
    return (
      canonicalValue(before.heap) !== canonicalValue(after.heap) &&
      canonicalValue(before.frames) === canonicalValue(after.frames)
    );
  });
  assert.notEqual(change, -1, "the program has a heap-only transition");
  const actions = diffSteps(snapshotAt(trace, change - 1), snapshotAt(trace, change));
  assert.deepEqual(actions, [], "collections are tasks 5-6: no action, not a guessed one");
});

test("overlays never change the state and vanish with their step", () => {
  const { source, trace } = program("function-print-return");
  const all = [];
  for (let index = 0; index < trace.length; index += 1) {
    all.push(
      ...diffSteps(index === 0 ? null : snapshotAt(trace, index - 1), snapshotAt(trace, index), {
        source,
        consoleAfterReturn: consoleFollowsReturn(trace, index),
      }),
    );
  }
  const step = trace.findIndex((event) => event.event === "output");
  const overlays = overlayActionsAt(all, step);
  assert.deepEqual(
    overlays.map((action) => action.kind),
    ["print"],
    "this step only printed",
  );
  const before = stateOf(snapshotAt(trace, step - 1));
  const after = stateOf(snapshotAt(trace, step));
  assert.deepEqual(stateActions(overlays), [], "a print overlay is never state");
  assert.deepEqual(applyState(before, overlays), before, "an overlay does not change the state");
  assert.deepEqual(applyState(before, overlays), after);

  // A step can carry both: the last transition drops a frame and returns.
  const last = trace.length - 1;
  const lastActions = diffSteps(snapshotAt(trace, last - 1), snapshotAt(trace, last), {
    source,
    consoleAfterReturn: consoleFollowsReturn(trace, last),
  });
  assert.deepEqual(
    lastActions.map((action) => action.kind).sort(),
    ["disappear", "return"],
    "state action plus overlay",
  );
  assert.deepEqual(
    applyState(stateOf(snapshotAt(trace, last - 1)), lastActions),
    stateOf(snapshotAt(trace, last)),
    "the return overlay is ignored by the state",
  );

  // Backward playback and a seek to another step leave no overlay behind.
  assert.deepEqual(overlayActionsAt(all, step - 1), []);
  assert.deepEqual(overlayActionsAt(all, 7), []);
  const nextStep = overlayActionsAt(all, step + 1);
  assert.ok(nextStep.length > 0, "the next output step has its own overlay");
  assert.ok(
    nextStep.every((action) => action.step === step + 1),
    "a step installs only its own overlays, never the previous step's",
  );
});

test("reverse drops overlays, inverts state actions, and inverts back", () => {
  const { source, trace } = program("function-print-return");
  const actions = [];
  for (let index = 0; index < trace.length; index += 1) {
    actions.push(
      ...diffSteps(index === 0 ? null : snapshotAt(trace, index - 1), snapshotAt(trace, index), {
        source,
        consoleAfterReturn: consoleFollowsReturn(trace, index),
      }),
    );
  }
  const reversed = reverseActions(actions);
  assert.equal(reversed.length, stateActions(actions).length, "overlays are dropped, not inverted");
  assert.ok(reversed.every((action) => STATE_KINDS.includes(action.kind)));
  assert.equal(reversed.some((action) => action.kind === "print"), false);
  assert.equal(reversed.some((action) => action.kind === "return"), false);

  for (const action of stateActions(actions)) {
    assert.deepEqual(reverseActions(reverseActions([action])), [action], `${action.id} inverts back`);
    assert.equal(reverseActions([action])[0].step, action.step, "the inverse belongs to its step");
  }
});

test("applyState refuses what it cannot honestly apply", () => {
  const { trace } = program("assign-only");
  const state = stateOf(snapshotAt(trace, 2));
  const cell = {
    id: "0:grow.append:o1[0]",
    step: 0,
    kind: "grow",
    motion: "append",
    effect: "state",
    target: { kind: "cell", objectId: "o1", index: 0 },
    path: "o1[0]",
    from: null,
    to: { type: "int", value: 1 },
    reason: null,
    payload: null,
  };
  assert.throws(() => applyState(state, [cell]), /cannot apply a grow action yet/);
  assert.throws(() => reverseActions([cell]), /cannot reverse a grow action yet/);
  // A silent skip would let a half-applied state pass for a correct one.
  assert.deepEqual(applyState(state, []), state);
  assert.equal(FALLBACK_REASON.unsupported, "unsupported");
});

test("diffSteps needs snapshots, and never mutates them", () => {
  const { source, trace } = program("for-loop");
  const before = snapshotAt(trace, 3);
  const after = snapshotAt(trace, 4);
  const frozen = JSON.stringify({ before, after });
  const first = diffSteps(before, after, { source });
  const second = diffSteps(before, after, { source });
  assert.deepEqual(first, second, "the diff is deterministic");
  assert.deepEqual(
    first.map((action) => action.id),
    second.map((action) => action.id),
    "ids are stable across recomputation",
  );
  assert.equal(JSON.stringify({ before, after }), frozen, "the snapshots are untouched");
  assert.throws(() => diffSteps({ event: "output", step: 1 }, after), /snapshotAt/);
  assert.throws(() => diffSteps(null, { event: "output" }), /next snapshot/);
});
