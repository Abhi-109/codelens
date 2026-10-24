// The diff core's contract: snapshots, state actions, overlays, and the round
// trip. Nothing here is allowed to be normalised to make a property pass - the
// compared state is exactly docs/animation.md section 3.
//
//   node --test src/animation/diff.test.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { gunzipSync } from "node:zlib";

import {
  STATE_KINDS,
  canonicalValue,
  createAction,
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

function recognitionProgram(name) {
  const entry = RECOGNITION.programs[name];
  assert.ok(entry, `${name} is in the recognition fixture`);
  return { name: `recognition/${name}`, source: entry.source, trace: eventsOf(entry.trace) };
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
    case "list":
      return `list[${value.items.length}]`;
    case "tuple":
      return `tuple[${value.items.length}]`;
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
      return `change ${action.path} ${brief(action.from)} -> ${brief(action.to)}${
        action.reason ? ` (${action.reason})` : ""
      }`;
    case "move":
      return `move.${action.motion} ${action.path} [${action.payload.indices.join(", ")}]`;
    case "grow":
      return `grow.${action.motion} ${action.path} ${brief(action.to)}${
        action.reason ? ` (${action.reason})` : ""
      }`;
    case "shrink":
      return `shrink.${action.motion} ${action.path} ${brief(action.from)}${
        action.reason ? ` (${action.reason})` : ""
      }`;
    case "highlight":
      return `highlight ${action.path} ${action.reason}`;
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

const int = (value) => ({ type: "int", value });

function snapshotOf(step, heap, line = 1) {
  return {
    event: "line",
    step,
    line,
    frames: [
      { frame_id: 1, function: "<module>", call_line: null, variables: {} },
    ],
    heap,
  };
}

function actionsAt({ source, trace }, index) {
  return diffSteps(index === 0 ? null : snapshotAt(trace, index - 1), snapshotAt(trace, index), {
    source,
    consoleAfterReturn: consoleFollowsReturn(trace, index),
  });
}

function roundTrip(program, index) {
  const { trace } = program;
  const before = stateOf(index === 0 ? null : snapshotAt(trace, index - 1));
  const after = stateOf(snapshotAt(trace, index));
  const actions = actionsAt(program, index);
  assert.deepEqual(applyState(before, actions), after, `${program.name} step ${index} forward`);
  assert.deepEqual(
    applyState(after, reverseActions(actions, after)),
    before,
    `${program.name} step ${index} backward`,
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
  const { trace } = program("list-mutation");
  const snapshot = snapshotAt(trace, 3);
  const state = stateOf(snapshot);
  assert.deepEqual(Object.keys(state).sort(), ["frames", "heap"]);
  assert.notEqual(state.heap, snapshot.heap, "the heap is copied");
  assert.notEqual(state.heap.o1, snapshot.heap.o1, "heap entries are copied");
  assert.notEqual(state.heap.o1.items, snapshot.heap.o1.items, "cell arrays are copied");
  for (const frame of state.frames) {
    assert.deepEqual(
      Object.keys(frame).sort(),
      ["call_line", "frame_id", "function", "variables"],
      "frame.line is cursor metadata, not state",
    );
  }
  state.frames[0].variables.injected = { type: "int", value: 1 };
  state.heap.o1.items[0] = { type: "int", value: 999 };
  assert.equal(Object.hasOwn(snapshot.frames[0].variables, "injected"), false, "the trace is untouched");
  assert.deepEqual(snapshot.heap.o1.items[0], { type: "int", value: 10 }, "the trace heap is untouched");
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

test("every transition is classified: supported, or explicitly deferred", () => {
  const programs = [
    ...Object.entries(CORPUS).map(([name, entry]) => ({
      name,
      source: entry.source,
      trace: eventsOf(entry.trace),
    })),
    ...Object.entries(RECOGNITION.programs).map(([name, entry]) => ({
      name: `recognition/${name}`,
      source: entry.source,
      trace: eventsOf(entry.trace),
    })),
  ];
  const failures = [];
  const reasons = { "task-6": 0, truncated: 0, tuple: 0, "unsupported-list": 0 };
  let total = 0;
  let pairs = 0;
  let supported = 0;
  let supportedPairs = 0;
  let deferred = 0;
  const stateFor = (id, entry) =>
    entry === undefined ? { frames: [], heap: {} } : { frames: [], heap: { [id]: entry } };
  const roundTripsObject = (actions, older, newer, id) => {
    const own = actions.filter(
      (action) => isStateAction(action) && action.target?.objectId === id,
    );
    try {
      return (
        isDeepStrictEqual(applyState(stateFor(id, older), own), stateFor(id, newer)) &&
        isDeepStrictEqual(
          applyState(stateFor(id, newer), reverseActions(own, stateFor(id, newer))),
          stateFor(id, older),
        )
      );
    } catch {
      return false;
    }
  };
  const highlightOn = (actions, id, reason) =>
    actions.some(
      (action) =>
        action.kind === "highlight" &&
        action.target?.kind === "object" &&
        action.target.objectId === id &&
        action.reason === reason,
    );

  for (const { name, source, trace } of programs) {
    for (let index = 0; index < trace.length; index += 1) {
      total += 1;
      if (index > 0) pairs += 1;
      const prev = index === 0 ? null : snapshotAt(trace, index - 1);
      const next = snapshotAt(trace, index);
      const before = stateOf(prev);
      const after = stateOf(next);
      let actions;
      try {
        actions = diffSteps(prev, next, {
          source,
          consoleAfterReturn: consoleFollowsReturn(trace, index),
        });
      } catch (error) {
        failures.push(`${name} step ${next.step}: diff threw ${error.message}`);
        continue;
      }

      for (const action of actions) {
        if (action.kind === "move") {
          const indices = action.payload?.indices;
          if (!Array.isArray(indices) || indices.length !== 2) {
            failures.push(`${name} step ${next.step}: a move must carry its index pair`);
          } else if (action.motion === "swap") {
            if (action.target?.index !== Math.min(...indices)) {
              failures.push(`${name} step ${next.step}: a swap must target its lower index`);
            }
          } else if (action.motion === "shift") {
            if (action.target?.index !== indices[1]) {
              failures.push(`${name} step ${next.step}: a shift must target its destination`);
            }
            if (Math.abs(indices[1] - indices[0]) !== 1) {
              failures.push(`${name} step ${next.step}: a shift must be adjacent`);
            }
            if (
              action.from === null ||
              action.from === undefined ||
              action.to === null ||
              action.to === undefined
            ) {
              failures.push(`${name} step ${next.step}: a shift must carry both values`);
            }
          } else {
            failures.push(`${name} step ${next.step}: unknown move motion ${action.motion}`);
          }
        }
        if (
          action.target?.kind === "cell" &&
          ["change", "move", "grow", "shrink"].includes(action.kind)
        ) {
          const entry = before.heap[action.target.objectId] ?? after.heap[action.target.objectId];
          if (entry?.type === "tuple") {
            failures.push(`${name} step ${next.step}: tuple cell mutation`);
          }
        }
      }

      let forward = false;
      let backward = false;
      try {
        forward = isDeepStrictEqual(applyState(before, actions), after);
        backward = isDeepStrictEqual(applyState(after, reverseActions(actions, after)), before);
      } catch (error) {
        failures.push(`${name} step ${next.step}: apply threw ${error.message}`);
      }
      if (forward && backward) {
        supported += 1;
        if (index > 0) supportedPairs += 1;
        continue;
      }
      deferred += 1;

      // Deferred covers the heap comparison only. The frame and variable half
      // of the state must still round trip exactly, or a dictionary change
      // could hide a broken call or a lost variable.
      const frameActions = actions.filter(
        (action) =>
          isStateAction(action) &&
          (action.target?.kind === "frame" || action.target?.kind === "variable"),
      );
      try {
        const forwardFrames = applyState(before, frameActions);
        const backwardFrames = applyState(after, reverseActions(frameActions, after));
        if (!isDeepStrictEqual(forwardFrames.frames, after.frames)) {
          failures.push(`${name} step ${next.step}: deferred transition hides a frame/variable change`);
        }
        if (!isDeepStrictEqual(backwardFrames.frames, before.frames)) {
          failures.push(`${name} step ${next.step}: deferred transition cannot restore its frames`);
        }
      } catch (error) {
        failures.push(`${name} step ${next.step}: frame/variable apply threw ${error.message}`);
      }

      const found = new Set();
      const ids = new Set([...Object.keys(before.heap), ...Object.keys(after.heap)]);
      for (const id of ids) {
        const older = before.heap[id];
        const newer = after.heap[id];
        const oldSequence = older?.type === "list" || older?.type === "tuple";
        const newSequence = newer?.type === "list" || newer?.type === "tuple";
        if (!oldSequence && !newSequence) {
          if (!isDeepStrictEqual(older, newer)) found.add("task-6");
          continue;
        }
        // Every list/tuple object is checked on its own, including one that
        // appears or disappears: its whole-entry action must restore the other
        // side. Lifecycle is not an exemption from the round trip.
        if (roundTripsObject(actions, older, newer, id)) continue;
        if (oldSequence !== newSequence) {
          const lifecycle =
            (oldSequence && newer === undefined) || (!oldSequence && older === undefined);
          if (lifecycle) {
            failures.push(`${name} step ${next.step}: ${id} lifecycle does not round trip`);
          }
          found.add("task-6");
          continue;
        }
        if (older?.type !== newer?.type) {
          found.add("unsupported-list");
          continue;
        }
        if (older.more !== undefined || newer.more !== undefined) {
          if (highlightOn(actions, id, "truncated")) found.add("truncated");
          else if (highlightOn(actions, id, "unsupported")) found.add("tuple");
          else if (highlightOn(actions, id, "unknown-shape")) found.add("unsupported-list");
          else failures.push(`${name} step ${next.step}: ${id} does not round trip and has no highlight`);
        } else if (older.type === "tuple") {
          if (highlightOn(actions, id, "unsupported")) found.add("tuple");
          else failures.push(`${name} step ${next.step}: tuple ${id} changed without a highlight`);
        } else if (
          highlightOn(actions, id, "unknown-shape") ||
          highlightOn(actions, id, "unsupported")
        ) {
          found.add("unsupported-list");
        } else {
          failures.push(`${name} step ${next.step}: list ${id} does not round trip and has no highlight`);
        }
      }
      if (found.size === 0) {
        failures.push(`${name} step ${next.step}: deferred with no reason`);
      }
      for (const reason of found) reasons[reason] += 1;
    }
  }

  assert.deepEqual(failures, []);
  assert.equal(programs.length, 114, "every program in the corpus and recognition fixtures");
  assert.equal(supported - supportedPairs, programs.length, "every run-start step is supported");
  assert.equal(supported + deferred, total, "every event step is classified");
  // Task 6 models dict, set and object contents, so every fixture transition
  // now round trips. These remain exact counts, not floors: a regression that
  // defers a transition fails the test instead of quietly moving between
  // groups.
  assert.equal(total, 2933, "the fixtures' exact event-step count, including 114 run starts");
  assert.equal(pairs, 2819, "consecutive state pairs: the event steps after the run starts");
  assert.equal(supported, 2933, "event steps whose state actions round trip");
  assert.equal(supportedPairs, 2819, "consecutive pairs whose state actions round trip");
  assert.equal(deferred, 0, "consecutive pairs still owned by task 6");
  assert.deepEqual(reasons, { "task-6": 0, truncated: 0, tuple: 0, "unsupported-list": 0 });
});

test("list-mutation's sort, reverse, assignment and delete are explicit and reversible", () => {
  const { source, trace } = program("list-mutation");
  assert.deepEqual(goldenRows(program("list-mutation")), [
    "call f1 <module> {}",
    "",
    "appear f1.scores o1 | appear o1 list[3]",
    "change o1[0] 30 -> 10 (unknown-shape) | change o1[1] 10 -> 20 (unknown-shape) | change o1[2] 20 -> 30 (unknown-shape)",
    "change o1[0] 10 -> 30 (unknown-shape) | change o1[2] 30 -> 10 (unknown-shape)",
    "change o1[0] 30 -> 99",
    "shrink.delete o1[2] 10",
    'print "[99, 20]"',
    'print "\\n"',
    "return f1 None ->null",
  ]);

  for (const index of [3, 4, 5, 6]) {
    const before = stateOf(snapshotAt(trace, index - 1));
    const after = stateOf(snapshotAt(trace, index));
    const actions = diffSteps(snapshotAt(trace, index - 1), snapshotAt(trace, index), { source });
    assert.deepEqual(applyState(before, actions), after, `step ${index} forward`);
    assert.deepEqual(applyState(after, reverseActions(actions, after)), before, `step ${index} backward`);
  }

  const deleted = diffSteps(snapshotAt(trace, 5), snapshotAt(trace, 6), { source });
  assert.deepEqual(
    deleted.map((action) => [action.kind, action.motion, action.path, action.reason]),
    [["shrink", "delete", "o1[2]", null]],
  );
  const restored = reverseActions(deleted, stateOf(snapshotAt(trace, 6)));
  assert.deepEqual(
    restored.map((action) => [action.kind, action.motion, action.path]),
    [["grow", "insert", "o1[2]"]],
  );
});

test("list lifecycle, append and aliasing are explicit and reversible", () => {
  const basics = program("list-basics");
  assert.deepEqual(actionsAt(basics, 3).map(describe), ['grow.append o1[2] "cherry"']);
  assert.deepEqual(actionsAt(basics, 5).map(describe), [
    "appear f1.pair o2",
    "appear o2 list[2]",
  ]);
  for (let index = 0; index < basics.trace.length; index += 1) roundTrip(basics, index);

  const aliased = program("alias-shared");
  assert.deepEqual(actionsAt(aliased, 4).map(describe), ["grow.append o1[2] 3"]);
  assert.deepEqual(actionsAt(aliased, 5).map(describe), ["change o1[0] 1 -> 9"]);
  assert.equal(
    actionsAt(aliased, 4).filter((action) => action.target.kind === "cell").length,
    1,
    "two names for one list do not duplicate the change",
  );
  for (let index = 0; index < aliased.trace.length; index += 1) roundTrip(aliased, index);

  const classes = program("class-basic");
  assert.deepEqual(actionsAt(classes, 15).map(describe), ['grow.append o2[0] "sit"']);
});

test("a verified insert is one grow.insert at the Python-normalized index", () => {
  const cases = [
    { source: "a.insert(0, 9)\n", at: 0 },
    { source: "a.insert(i, 9)\n", i: 1, at: 1 },
    { source: "a.insert(i, 9)\n", i: 3, at: 3 },
    { source: "a.insert(-1, 9)\n", at: 2 },
    { source: "a.insert(i, 9)\n", i: -4, at: 0 },
    { source: "a.insert(99, 9)\n", at: 3 },
    { source: "a.insert(i, 9)\n", i: 99, at: 3 },
  ];
  for (const { source, i, at } of cases) {
    const variables = { a: { type: "ref", id: "o1" } };
    if (i !== undefined) variables.i = int(i);
    const before = snapshotOf(1, { o1: { type: "list", items: [int(1), int(2), int(3)] } });
    const items = [int(1), int(2), int(3)];
    items.splice(at, 0, int(9));
    const after = snapshotOf(2, { o1: { type: "list", items } });
    before.frames[0].variables = variables;
    after.frames[0].variables = variables;
    const actions = diffSteps(before, after, { source });
    assert.deepEqual(actions.map(describe), [`grow.insert o1[${at}] 9`], source);
    assert.equal(actions.length, 1, source);
    assert.equal(actions[0].reason, null, source);
    assert.equal(actions[0].target.index, at, source);
    assert.deepEqual(actions[0].to, int(9), source);
    assert.deepEqual(applyState(stateOf(before), actions), stateOf(after), source);
    const inverse = reverseActions(actions, stateOf(after));
    assert.deepEqual(inverse.map(describe), [`shrink.delete o1[${at}] 9`], source);
    assert.deepEqual(applyState(stateOf(after), inverse), stateOf(before), source);
  }
});

test("duplicate insert values follow the source index, not value matching", () => {
  const before = snapshotOf(1, {
    o1: { type: "list", items: [int(1), int(2), int(1)] },
  });
  const after = snapshotOf(2, {
    o1: { type: "list", items: [int(1), int(2), int(2), int(1)] },
  });
  for (const i of [1, 2]) {
    const variables = { a: { type: "ref", id: "o1" }, i: int(i) };
    before.frames[0].variables = variables;
    after.frames[0].variables = variables;
    const actions = diffSteps(before, after, { source: "a.insert(i, 2)\n" });
    assert.deepEqual(actions.map(describe), [`grow.insert o1[${i}] 2`]);
    assert.deepEqual(applyState(stateOf(before), actions), stateOf(after));
    assert.deepEqual(
      applyState(stateOf(after), reverseActions(actions, stateOf(after))),
      stateOf(before),
    );
  }
});

test("an insert through an alias is one action on the shared object", () => {
  const variables = {
    a: { type: "ref", id: "o1" },
    b: { type: "ref", id: "o1" },
    i: int(1),
  };
  const before = snapshotOf(1, { o1: { type: "list", items: [int(1), int(2)] } });
  const after = snapshotOf(2, { o1: { type: "list", items: [int(1), int(9), int(2)] } });
  before.frames[0].variables = variables;
  after.frames[0].variables = variables;
  const actions = diffSteps(before, after, { source: "b.insert(i, 9)\n" });
  assert.deepEqual(actions.map(describe), ["grow.insert o1[1] 9"]);
  assert.equal(actions.length, 1);
  assert.deepEqual(applyState(stateOf(before), actions), stateOf(after));
  assert.deepEqual(applyState(stateOf(after), reverseActions(actions, stateOf(after))), stateOf(before));
});

test("a verified bare pop is a tail shrink.pop and reverses to append", () => {
  const variables = { a: { type: "ref", id: "o1" } };
  const before = snapshotOf(1, { o1: { type: "list", items: [int(1), int(2), int(3)] } });
  const after = snapshotOf(2, { o1: { type: "list", items: [int(1), int(2)] } });
  before.frames[0].variables = variables;
  after.frames[0].variables = variables;
  const actions = diffSteps(before, after, { source: "a.pop()\n" });
  assert.deepEqual(actions.map(describe), ["shrink.pop o1[2] 3"]);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].motion, "pop");
  assert.equal(actions[0].target.index, 2);
  assert.deepEqual(actions[0].from, int(3));
  assert.equal(actions[0].reason, null);
  assert.deepEqual(applyState(stateOf(before), actions), stateOf(after));
  const inverse = reverseActions(actions, stateOf(after));
  assert.deepEqual(inverse.map(describe), ["grow.append o1[2] 3"]);
  assert.deepEqual(applyState(stateOf(after), inverse), stateOf(before));
});

test("an explicit pop is a shrink.delete even at the last cell", () => {
  const cases = [
    { source: "a.pop(0)\n", at: 0 },
    { source: "a.pop(i)\n", i: 1, at: 1 },
    { source: "a.pop(i)\n", i: 2, at: 2 },
    { source: "a.pop(i)\n", i: -1, at: 2 },
    { source: "a.pop(i)\n", i: -3, at: 0 },
  ];
  for (const { source, i, at } of cases) {
    const variables = { a: { type: "ref", id: "o1" } };
    if (i !== undefined) variables.i = int(i);
    const before = snapshotOf(1, { o1: { type: "list", items: [int(1), int(2), int(3)] } });
    const after = snapshotOf(2, {
      o1: { type: "list", items: [int(1), int(2), int(3)].filter((_, index) => index !== at) },
    });
    before.frames[0].variables = variables;
    after.frames[0].variables = variables;
    const actions = diffSteps(before, after, { source });
    assert.deepEqual(actions.map(describe), [`shrink.delete o1[${at}] ${at + 1}`], source);
    assert.equal(actions.length, 1, source);
    assert.equal(actions[0].motion, "delete", source);
    assert.equal(actions[0].target.index, at, source);
    assert.deepEqual(actions[0].from, int(at + 1), source);
    assert.equal(actions[0].reason, null, source);
    assert.deepEqual(applyState(stateOf(before), actions), stateOf(after), source);
    const inverse = reverseActions(actions, stateOf(after));
    assert.deepEqual(inverse.map(describe), [`grow.insert o1[${at}] ${at + 1}`], source);
    assert.deepEqual(applyState(stateOf(after), inverse), stateOf(before), source);
  }
});

test("insert and pop handle empty and single-cell lists", () => {
  const variables = { a: { type: "ref", id: "o1" } };
  const empty = snapshotOf(1, { o1: { type: "list", items: [] } });
  const one = snapshotOf(2, { o1: { type: "list", items: [int(7)] } });
  empty.frames[0].variables = variables;
  one.frames[0].variables = variables;
  const inserted = diffSteps(empty, one, { source: "a.insert(0, 7)\n" });
  assert.deepEqual(inserted.map(describe), ["grow.insert o1[0] 7"]);
  assert.deepEqual(applyState(stateOf(empty), inserted), stateOf(one));
  assert.deepEqual(applyState(stateOf(one), reverseActions(inserted, stateOf(one))), stateOf(empty));

  const popped = diffSteps(one, empty, { source: "a.pop(0)\n" });
  assert.deepEqual(popped.map(describe), ["shrink.delete o1[0] 7"]);
  assert.deepEqual(applyState(stateOf(one), popped), stateOf(empty));
  assert.deepEqual(applyState(stateOf(empty), reverseActions(popped, stateOf(empty))), stateOf(one));
});

test("insert and append resolve nested attribute and subscript receivers", () => {
  const cases = [
    {
      name: "attribute insert",
      source: "self.data.insert(0, 9)\n",
      variables: { self: { type: "ref", id: "o1" } },
      beforeHeap: {
        o1: { type: "object", class: "Box", attrs: [{ name: "data", value: { type: "ref", id: "o2" } }] },
        o2: { type: "list", items: [int(1), int(2)] },
      },
      afterHeap: {
        o1: { type: "object", class: "Box", attrs: [{ name: "data", value: { type: "ref", id: "o2" } }] },
        o2: { type: "list", items: [int(9), int(1), int(2)] },
      },
      expected: "grow.insert o2[0] 9",
      kind: "grow",
      motion: "insert",
      index: 0,
      value: int(9),
    },
    {
      name: "subscript append",
      source: "rows[0].append(2)\n",
      variables: { rows: { type: "ref", id: "o1" } },
      beforeHeap: {
        o1: { type: "list", items: [{ type: "ref", id: "o2" }] },
        o2: { type: "list", items: [int(1)] },
      },
      afterHeap: {
        o1: { type: "list", items: [{ type: "ref", id: "o2" }] },
        o2: { type: "list", items: [int(1), int(2)] },
      },
      expected: "grow.append o2[1] 2",
      kind: "grow",
      motion: "append",
      index: 1,
      value: int(2),
    },
    {
      name: "subscript pop",
      source: "rows[0].pop()\n",
      variables: { rows: { type: "ref", id: "o1" } },
      beforeHeap: {
        o1: { type: "list", items: [{ type: "ref", id: "o2" }] },
        o2: { type: "list", items: [int(1), int(2)] },
      },
      afterHeap: {
        o1: { type: "list", items: [{ type: "ref", id: "o2" }] },
        o2: { type: "list", items: [int(1)] },
      },
      expected: "shrink.pop o2[1] 2",
      kind: "shrink",
      motion: "pop",
      index: 1,
      value: int(2),
    },
  ];

  for (const { name, source, variables, beforeHeap, afterHeap, expected, kind, motion, index, value } of cases) {
    const before = snapshotOf(1, beforeHeap);
    const after = snapshotOf(2, afterHeap);
    before.frames[0].variables = variables;
    after.frames[0].variables = variables;
    const actions = diffSteps(before, after, { source });
    assert.deepEqual(actions.map(describe), [expected], name);
    assert.equal(actions.length, 1, name);
    const [action] = actions;
    assert.equal(action.kind, kind, name);
    assert.equal(action.motion, motion, name);
    assert.equal(action.target.kind, "cell", name);
    assert.equal(action.target.objectId, "o2", name);
    assert.equal(action.target.index, index, name);
    assert.equal(action.payload, null, name);
    if (kind === "grow") assert.deepEqual(action.to, value, name);
    else assert.deepEqual(action.from, value, name);
    assert.deepEqual(applyState(stateOf(before), actions), stateOf(after), `${name} forward`);
    const inverse = reverseActions(actions, stateOf(after));
    assert.deepEqual(applyState(stateOf(after), inverse), stateOf(before), `${name} backward`);
  }
});

test("tuple cells are lifecycle only; a mutation is refused explicitly", () => {
  const tuple = program("tuple-unpack");
  assert.deepEqual(actionsAt(tuple, 2).map(describe), [
    "appear f1.point o1",
    "appear o1 tuple[2]",
  ]);
  for (let index = 0; index < tuple.trace.length; index += 1) roundTrip(tuple, index);

  const before = snapshotOf(1, {
    o1: { type: "tuple", items: [int(1), int(2)] },
  });
  const after = snapshotOf(2, {
    o1: { type: "tuple", items: [int(1), int(3)] },
  });
  const actions = diffSteps(before, after);
  assert.deepEqual(
    actions.map((action) => [action.kind, action.reason]),
    [["highlight", "unsupported"]],
  );
  assert.equal(actions.some((action) => action.target.kind === "cell"), false);
  const mutation = createAction("change", {
    step: 2,
    target: { kind: "cell", objectId: "o1", index: 1 },
    from: int(2),
    to: int(3),
  });
  assert.throws(() => applyState(stateOf(before), [mutation]), /tuple/);
  assert.throws(() => reverseActions([mutation], stateOf(before)), /tuple/);

  for (const [source, items] of [
    ["a.insert(1, 9)\n", [int(1), int(9), int(2)]],
    ["a.pop()\n", [int(1)]],
  ]) {
    const tupleBefore = snapshotOf(1, {
      o1: { type: "tuple", items: [int(1), int(2)] },
    });
    const tupleAfter = snapshotOf(2, { o1: { type: "tuple", items } });
    const variables = { a: { type: "ref", id: "o1" } };
    tupleBefore.frames[0].variables = variables;
    tupleAfter.frames[0].variables = variables;
    const tupleActions = diffSteps(tupleBefore, tupleAfter, { source });
    assert.deepEqual(
      tupleActions.map((action) => [action.kind, action.reason]),
      [["highlight", "unsupported"]],
    );
    assert.equal(tupleActions.some((action) => action.target.kind === "cell"), false);
  }
});

test("truncated lists use visible changes and an explicit truncated fallback", () => {
  const truncated = recognitionProgram("bubble-truncated");
  const all = [];
  for (let index = 0; index < truncated.trace.length; index += 1) {
    all.push(...actionsAt(truncated, index));
  }
  const listActions = all.filter((action) => action.target.objectId === "o1");
  assert.equal(
    listActions.some((action) => ["move", "grow", "shrink"].includes(action.kind)),
    false,
    "a truncated list never claims movement, growth or shrinkage",
  );
  const changes = listActions.filter((action) => action.kind === "change");
  assert.ok(changes.length > 0, "the fixture really changes visible cells");
  assert.ok(changes.every((action) => action.reason === "truncated"));
  assert.equal(
    goldenRows(truncated)[5],
    "change o1[0] 35 -> 34 (truncated) | change o1[1] 34 -> 35 (truncated)",
  );
  for (let index = 0; index < truncated.trace.length; index += 1) {
    roundTrip(truncated, index);
  }

  const before = snapshotOf(1, { o1: { type: "list", items: [int(1), int(2)], more: 5 } });
  const moreChanged = snapshotOf(2, {
    o1: { type: "list", items: [int(1), int(2)], more: 4 },
  });
  assert.deepEqual(diffSteps(before, moreChanged).map(describe), ["highlight o1 truncated"]);

  const shorter = snapshotOf(2, { o1: { type: "list", items: [int(1)], more: 5 } });
  const shortened = diffSteps(before, shorter);
  assert.deepEqual(shortened.map(describe), ["highlight o1 truncated"]);
  assert.equal(shortened.some((action) => action.target.kind === "cell"), false);

  const visible = snapshotOf(2, { o1: { type: "list", items: [int(1), int(3)], more: 5 } });
  const visibleActions = diffSteps(before, visible);
  assert.deepEqual(visibleActions.map(describe), ["change o1[1] 2 -> 3 (truncated)"]);
  assert.deepEqual(applyState(stateOf(before), visibleActions), stateOf(visible));
});

test("insert and pop on a truncated list never claim cell growth or shrinkage", () => {
  const variables = { a: { type: "ref", id: "o1" } };
  const snap = (step, items) => {
    const snapshot = snapshotOf(step, { o1: { type: "list", items, more: 5 } });
    snapshot.frames[0].variables = variables;
    return snapshot;
  };
  const before = snap(1, [int(1), int(2)]);
  const inserted = diffSteps(before, snap(2, [int(1), int(9), int(2)]), {
    source: "a.insert(1, 9)\n",
  });
  assert.deepEqual(inserted.map(describe), [
    "change o1[1] 2 -> 9 (truncated)",
    "highlight o1 truncated",
  ]);
  assert.equal(inserted.some((action) => ["grow", "shrink"].includes(action.kind)), false);
  assert.ok(inserted.every((action) => action.reason === "truncated"));

  const popped = diffSteps(before, snap(2, [int(1)]), { source: "a.pop()\n" });
  assert.deepEqual(popped.map(describe), ["highlight o1 truncated"]);
  assert.equal(popped.some((action) => ["grow", "shrink"].includes(action.kind)), false);
  assert.equal(popped.some((action) => action.target.kind === "cell"), false);
});

test("insert and pop never claim list cells on dictionaries or sets", () => {
  const variables = { a: { type: "ref", id: "o1" } };
  const cases = [
    {
      before: { type: "dict", entries: [{ key: { type: "str", value: "k" }, value: int(1) }] },
      after: {
        type: "dict",
        entries: [
          { key: { type: "str", value: "k" }, value: int(1) },
          { key: { type: "str", value: "x" }, value: int(9) },
        ],
      },
      source: "a.insert(0, 9)\n",
    },
    {
      before: { type: "set", items: [int(1)] },
      after: { type: "set", items: [int(1), int(9)] },
      source: "a.pop()\n",
    },
  ];
  for (const { before, after, source } of cases) {
    const older = snapshotOf(1, { o1: before });
    const newer = snapshotOf(2, { o1: after });
    older.frames[0].variables = variables;
    newer.frames[0].variables = variables;
    const actions = diffSteps(older, newer, { source });
    assert.equal(actions.some((action) => action.target.kind === "cell"), false, source);
    assert.equal(actions.some((action) => ["grow", "shrink"].includes(action.kind)), false, source);
  }
});

test("list objects appear and disappear with their recorded heap entries", () => {
  const filter = recognitionProgram("filter-list");
  assert.deepEqual(actionsAt(filter, 5).map(describe), [
    "appear f2.result o2",
    "appear o2 list[0]",
  ]);
  const last = filter.trace.length - 1;
  assert.deepEqual(actionsAt(filter, last).map(describe), [
    "disappear f2 f2",
    "disappear o1 list[3]",
    "disappear o2 list[2]",
    "return f1 None ->null",
  ]);
  for (let index = 0; index < filter.trace.length; index += 1) roundTrip(filter, index);
});

test("state-proven tail growth is explicit and reversible", () => {
  const sort = recognitionProgram("merge-sort");
  assert.deepEqual(actionsAt(sort, 42).map(describe), [
    "grow.append o7[1] 43 (unknown-shape)",
  ]);
  assert.deepEqual(actionsAt(sort, 142).map(describe), [
    "grow.append o18[2] 10 (unknown-shape)",
    "grow.append o18[3] 82 (unknown-shape)",
  ]);
  for (let index = 0; index < sort.trace.length; index += 1) roundTrip(sort, index);
});

test("state-proven tail shrinkage removes every extra cell and reverses exactly", () => {
  const three = snapshotOf(1, { o1: { type: "list", items: [int(1), int(2), int(3)] } });
  const one = snapshotOf(2, { o1: { type: "list", items: [int(1)] } });
  const popped = diffSteps(three, one);
  assert.deepEqual(popped.map(describe), [
    "shrink.pop o1[2] 3 (unknown-shape)",
    "shrink.pop o1[1] 2 (unknown-shape)",
  ]);
  assert.deepEqual(applyState(stateOf(three), popped), stateOf(one));

  const inverse = reverseActions(popped, stateOf(one));
  assert.deepEqual(inverse.map(describe), [
    "grow.append o1[1] 2 (unknown-shape)",
    "grow.append o1[2] 3 (unknown-shape)",
  ]);
  assert.deepEqual(applyState(stateOf(one), inverse), stateOf(three));
  assert.deepEqual(
    reverseActions(inverse, stateOf(three)).map(describe),
    popped.map(describe),
    "the removal and its inverse invert back",
  );
});

test("nested insert and pop stay conservative until the state proves a tail change", () => {
  const variables = { a: { type: "ref", id: "o1" }, x: int(0) };
  const snap = (step, items, frameVariables = variables) => {
    const snapshot = snapshotOf(step, { o1: { type: "list", items } });
    snapshot.frames[0].variables = frameVariables;
    return snapshot;
  };

  const printed = diffSteps(
    snap(1, [int(1), int(2), int(3)]),
    snap(2, [int(1), int(2)]),
    { source: "print(a.pop())\n" },
  );
  assert.deepEqual(printed.map(describe), ["shrink.pop o1[2] 3 (unknown-shape)"]);
  assert.equal(printed.some((action) => action.reason === null), false);

  const assigned = diffSteps(
    snap(1, [int(1), int(2), int(3)]),
    snap(2, [int(1), int(2)], { a: { type: "ref", id: "o1" }, x: int(3) }),
    { source: "x = a.pop()\n" },
  );
  assert.ok(assigned.some((action) => describe(action) === "shrink.pop o1[2] 3 (unknown-shape)"));
  assert.equal(assigned.some((action) => action.kind === "shrink" && action.reason === null), false);

  const middle = diffSteps(
    snap(1, [int(1), int(2), int(3)]),
    snap(2, [int(2), int(3)]),
    { source: "print(a.pop(0))\n" },
  );
  assert.deepEqual(middle.map(describe), ["highlight o1 unknown-shape"]);

  const inserted = diffSteps(
    snap(1, [int(1), int(2), int(3)]),
    snap(2, [int(1), int(9), int(2), int(3)]),
    { source: "print(a.insert(1, 9))\n" },
  );
  assert.deepEqual(inserted.map(describe), ["highlight o1 unknown-shape"]);
});

test("a mutation made while printing is shown only at the next state step", () => {
  const variables = { a: { type: "ref", id: "o1" } };
  const first = snapshotOf(0, { o1: { type: "list", items: [int(1), int(2), int(3)] } });
  first.frames[0].variables = variables;
  const output = { event: "output", step: 1, text: "3\n", frame_id: 1, line: 1 };
  const next = snapshotOf(2, { o1: { type: "list", items: [int(1), int(2)] } }, 2);
  next.frames[0].variables = variables;
  const trace = [first, output, next];
  const source = "print(a.pop())\nx = 1\n";

  // The output event carries the state it printed from, so it has no state
  // action for the pop that happened while the line was evaluated.
  const atOutput = diffSteps(snapshotAt(trace, 0), snapshotAt(trace, 1), { source });
  assert.deepEqual(stateActions(atOutput), []);
  assert.deepEqual(atOutput.map((action) => action.kind), ["print"]);
  assert.deepEqual(stateOf(snapshotAt(trace, 1)), stateOf(first));

  // The pop becomes visible only when the next line's snapshot records it. The
  // call is not the whole statement, so the tail change is the conservative
  // unknown-shape fallback, never an invented insert or intermediate state.
  const atNext = diffSteps(snapshotAt(trace, 1), snapshotAt(trace, 2), { source });
  assert.deepEqual(atNext.map(describe), ["shrink.pop o1[2] 3 (unknown-shape)"]);
  assert.deepEqual(stateActions(atNext), atNext);
  assert.equal(atNext.some((action) => action.kind === "grow" || action.kind === "change"), false);
  assert.deepEqual(applyState(stateOf(snapshotAt(trace, 1)), atNext), stateOf(next));
  assert.deepEqual(
    applyState(stateOf(next), reverseActions(atNext, stateOf(next))),
    stateOf(snapshotAt(trace, 1)),
  );
});

test("insert and pop evidence that disagrees falls back conservatively", () => {
  const variables = { a: { type: "ref", id: "o1" }, i: int(0) };
  const snap = (step, items) => {
    const snapshot = snapshotOf(step, { o1: { type: "list", items } });
    snapshot.frames[0].variables = variables;
    return snapshot;
  };

  const mismatchInsert = diffSteps(
    snap(1, [int(1), int(2), int(3)]),
    snap(2, [int(1), int(9), int(2), int(3)]),
    { source: "a.insert(0, 9)\n" },
  );
  assert.deepEqual(mismatchInsert.map(describe), ["highlight o1 unknown-shape"]);
  assert.equal(mismatchInsert.some((action) => action.kind === "grow"), false);

  const mismatchPop = diffSteps(
    snap(1, [int(1), int(2), int(3)]),
    snap(2, [int(2), int(3)]),
    { source: "a.pop(2)\n" },
  );
  assert.deepEqual(mismatchPop.map(describe), ["highlight o1 unknown-shape"]);
  assert.equal(mismatchPop.some((action) => action.kind === "shrink"), false);

  const unresolvedInsert = diffSteps(
    snap(1, [int(1), int(2), int(3)]),
    snap(2, [int(1), int(2), int(3), int(9)]),
    { source: "a.insert(missing, 9)\n" },
  );
  assert.deepEqual(unresolvedInsert.map(describe), ["grow.append o1[3] 9 (unknown-shape)"]);
  assert.equal(unresolvedInsert.some((action) => action.motion === "insert"), false);

  const unresolvedPop = diffSteps(
    snap(1, [int(1), int(2), int(3)]),
    snap(2, [int(1), int(2)]),
    { source: "a.pop(missing)\n" },
  );
  assert.deepEqual(unresolvedPop.map(describe), ["shrink.pop o1[2] 3 (unknown-shape)"]);
  assert.equal(unresolvedPop.some((action) => action.motion === "delete"), false);
});

test("a verified swap is one move with its index pair, and reverses to itself", () => {
  const variables = { a: { type: "ref", id: "o1" }, i: int(0), j: int(2) };
  const before = snapshotOf(1, { o1: { type: "list", items: [int(10), int(20), int(30)] } });
  const after = snapshotOf(2, { o1: { type: "list", items: [int(30), int(20), int(10)] } });
  before.frames[0].variables = variables;
  after.frames[0].variables = variables;
  const actions = diffSteps(before, after, { source: "a[i], a[j] = a[j], a[i]\n" });
  assert.deepEqual(actions.map(describe), ["move.swap o1[0] [0, 2]"]);
  assert.equal(actions[0].motion, "swap");
  assert.deepEqual(actions[0].payload.indices, [0, 2]);
  assert.deepEqual(applyState(stateOf(before), actions), stateOf(after));

  const inverse = reverseActions(actions, stateOf(after));
  assert.deepEqual(inverse, actions, "a swap is its own inverse");
  assert.deepEqual(applyState(stateOf(after), inverse), stateOf(before));
});

test("a swap written high-first still targets the lower cell and round trips", () => {
  const variables = { a: { type: "ref", id: "o1" }, i: int(0), j: int(2) };
  const before = snapshotOf(1, { o1: { type: "list", items: [int(10), int(20), int(30)] } });
  const after = snapshotOf(2, { o1: { type: "list", items: [int(30), int(20), int(10)] } });
  before.frames[0].variables = variables;
  after.frames[0].variables = variables;
  const actions = diffSteps(before, after, { source: "a[j], a[i] = a[i], a[j]\n" });
  assert.deepEqual(actions.map(describe), ["move.swap o1[0] [2, 0]"]);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].target.objectId, "o1");
  assert.equal(actions[0].target.index, 0);
  assert.deepEqual(actions[0].payload.indices, [2, 0]);
  assert.deepEqual(applyState(stateOf(before), actions), stateOf(after));
  const inverse = reverseActions(actions, stateOf(after));
  assert.deepEqual(inverse, actions);
  assert.deepEqual(applyState(stateOf(after), inverse), stateOf(before));
});

test("a swap with negative indices resolves both cells and round trips", () => {
  const variables = { a: { type: "ref", id: "o1" }, i: int(-1) };
  const before = snapshotOf(1, { o1: { type: "list", items: [int(10), int(20), int(30)] } });
  const after = snapshotOf(2, { o1: { type: "list", items: [int(30), int(20), int(10)] } });
  before.frames[0].variables = variables;
  after.frames[0].variables = variables;
  const actions = diffSteps(before, after, { source: "a[i], a[0] = a[0], a[i]\n" });
  assert.deepEqual(actions.map(describe), ["move.swap o1[0] [2, 0]"]);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].target.objectId, "o1");
  assert.equal(actions[0].target.index, 0);
  assert.deepEqual(actions[0].payload.indices, [2, 0]);
  assert.deepEqual(applyState(stateOf(before), actions), stateOf(after));
  const inverse = reverseActions(actions, stateOf(after));
  assert.deepEqual(applyState(stateOf(after), inverse), stateOf(before));
});

test("a verified right shift copies into the destination and reverses to a change", () => {
  const variables = { values: { type: "ref", id: "o1" }, j: int(0) };
  const before = snapshotOf(1, { o1: { type: "list", items: [int(5), int(2), int(4)] } });
  const after = snapshotOf(2, { o1: { type: "list", items: [int(5), int(5), int(4)] } });
  before.frames[0].variables = variables;
  after.frames[0].variables = variables;
  const actions = diffSteps(before, after, { source: "values[j + 1] = values[j]\n" });
  assert.deepEqual(actions.map(describe), ["move.shift o1[1] [0, 1]"]);
  assert.equal(actions[0].motion, "shift");
  assert.equal(actions[0].target.index, 1);
  assert.deepEqual(actions[0].payload.indices, [0, 1]);
  assert.deepEqual(actions[0].from, int(2));
  assert.deepEqual(actions[0].to, int(5));
  assert.deepEqual(applyState(stateOf(before), actions), stateOf(after));
  assert.deepEqual(
    applyState(stateOf(before), actions).heap.o1.items[0],
    int(5),
    "the source keeps its value",
  );

  const inverse = reverseActions(actions, stateOf(after));
  assert.deepEqual(inverse.map(describe), ["change o1[1] 5 -> 2"]);
  assert.equal(inverse[0].kind, "change");
  assert.deepEqual(applyState(stateOf(after), inverse), stateOf(before));
});

test("a verified left shift targets its lower destination as well", () => {
  const variables = { values: { type: "ref", id: "o1" }, j: int(0) };
  const before = snapshotOf(1, { o1: { type: "list", items: [int(5), int(2), int(4)] } });
  const after = snapshotOf(2, { o1: { type: "list", items: [int(2), int(2), int(4)] } });
  before.frames[0].variables = variables;
  after.frames[0].variables = variables;
  const actions = diffSteps(before, after, { source: "values[j] = values[j + 1]\n" });
  assert.deepEqual(actions.map(describe), ["move.shift o1[0] [1, 0]"]);
  assert.equal(actions[0].target.index, 0);
  assert.deepEqual(actions[0].payload.indices, [1, 0]);
  assert.deepEqual(actions[0].from, int(5));
  assert.deepEqual(actions[0].to, int(2));
  assert.deepEqual(applyState(stateOf(before), actions), stateOf(after));
  assert.deepEqual(
    applyState(stateOf(before), actions).heap.o1.items[1],
    int(2),
    "the source keeps its value",
  );

  const inverse = reverseActions(actions, stateOf(after));
  assert.deepEqual(inverse.map(describe), ["change o1[0] 2 -> 5"]);
  assert.deepEqual(applyState(stateOf(after), inverse), stateOf(before));
});

test("a shift the values do not prove stays conservative", () => {
  const variables = { values: { type: "ref", id: "o1" }, j: int(0) };
  const snap = (step, items) => {
    const snapshot = snapshotOf(step, { o1: { type: "list", items } });
    snapshot.frames[0].variables = variables;
    return snapshot;
  };
  const source = "values[j + 1] = values[j]\n";

  const changed = diffSteps(
    snap(1, [int(5), int(2), int(4)]),
    snap(2, [int(5), int(9), int(4)]),
    { source },
  );
  assert.deepEqual(changed.map(describe), ["change o1[1] 2 -> 9 (unknown-shape)"]);
  assert.equal(changed.some((action) => action.kind === "move"), false);

  const equal = diffSteps(
    snap(1, [int(5), int(5), int(4)]),
    snap(2, [int(5), int(5), int(4)]),
    { source },
  );
  assert.deepEqual(equal.map(describe), ["highlight o1 duplicate-values"]);
  assert.deepEqual(stateActions(equal), []);

  const extra = diffSteps(
    snap(1, [int(5), int(2), int(4)]),
    snap(2, [int(5), int(5), int(9)]),
    { source },
  );
  assert.equal(extra.some((action) => action.kind === "move"), false);
  assert.deepEqual(extra.map(describe), [
    "change o1[1] 2 -> 5 (unknown-shape)",
    "change o1[2] 4 -> 9 (unknown-shape)",
  ]);
});

test("insertion sort shifts are adjacent moves that round trip exactly", () => {
  const shifting = recognitionProgram("insertion-sort");
  const moves = [];
  for (let index = 0; index < shifting.trace.length; index += 1) {
    moves.push(...actionsAt(shifting, index).filter((action) => action.kind === "move"));
  }
  assert.equal(moves.length, 7, "insertion sort shifts seven times");
  for (const move of moves) {
    assert.equal(move.motion, "shift");
    assert.equal(move.payload.indices.length, 2);
    assert.equal(move.target.index, move.payload.indices[1]);
    assert.equal(Math.abs(move.payload.indices[1] - move.payload.indices[0]), 1);
    assert.notEqual(move.from, null);
    assert.notEqual(move.to, null);
  }
  assert.deepEqual(actionsAt(shifting, 9).map(describe), ["move.shift o1[1] [0, 1]"]);
  for (let index = 0; index < shifting.trace.length; index += 1) roundTrip(shifting, index);
});

test("a swap the values do not prove stays conservative", () => {
  const variables = { a: { type: "ref", id: "o1" }, i: int(0), j: int(2) };
  const snap = (step, items) => {
    const snapshot = snapshotOf(step, { o1: { type: "list", items } });
    snapshot.frames[0].variables = variables;
    return snapshot;
  };
  const source = "a[i], a[j] = a[j], a[i]\n";

  const changed = diffSteps(
    snap(1, [int(1), int(2), int(3)]),
    snap(2, [int(1), int(2), int(9)]),
    { source },
  );
  assert.deepEqual(changed.map(describe), ["change o1[2] 3 -> 9 (unknown-shape)"]);
  assert.equal(changed.some((action) => action.kind === "move"), false);

  const equal = diffSteps(
    snap(1, [int(2), int(5), int(2)]),
    snap(2, [int(2), int(5), int(2)]),
    { source },
  );
  assert.deepEqual(equal.map(describe), ["highlight o1 duplicate-values"]);
  assert.deepEqual(stateActions(equal), []);

  const withoutJ = { a: { type: "ref", id: "o1" }, i: int(0) };
  const noIndex = snapshotOf(1, { o1: { type: "list", items: [int(1), int(2), int(3)] } });
  noIndex.frames[0].variables = withoutJ;
  const afterSwap = snapshotOf(2, { o1: { type: "list", items: [int(3), int(2), int(1)] } });
  afterSwap.frames[0].variables = withoutJ;
  const unresolved = diffSteps(noIndex, afterSwap, { source });
  assert.equal(unresolved.some((action) => action.kind === "move"), false);
  assert.deepEqual(unresolved.map(describe), [
    "change o1[0] 1 -> 3 (unknown-shape)",
    "change o1[2] 3 -> 1 (unknown-shape)",
  ]);
});

test("bubble and selection sort swaps are single moves with the written pair", () => {
  for (const name of ["bubble-sort", "selection-sort"]) {
    const swapping = recognitionProgram(name);
    const moves = [];
    for (let index = 0; index < swapping.trace.length; index += 1) {
      moves.push(...actionsAt(swapping, index).filter((action) => action.kind === "move"));
    }
    assert.ok(moves.length > 0, `${name} really swaps`);
    for (const move of moves) {
      assert.equal(move.motion, "swap");
      assert.equal(move.payload.indices.length, 2);
      assert.equal(move.target.index, Math.min(...move.payload.indices));
    }
    for (let index = 0; index < swapping.trace.length; index += 1) roundTrip(swapping, index);
  }
});

test("an unknown non-tail structural change is highlighted, not guessed", () => {
  const before = snapshotOf(1, { o1: { type: "list", items: [int(1), int(2), int(3)] } });
  const after = snapshotOf(2, { o1: { type: "list", items: [int(1), int(3)] } });
  const actions = diffSteps(before, after);
  assert.deepEqual(actions.map(describe), ["highlight o1 unknown-shape"]);
  assert.equal(actions.some((action) => action.target.kind === "cell"), false);

  const deleteBefore = snapshotOf(1, {
    o1: { type: "list", items: [int(1), int(2), int(3)] },
  });
  deleteBefore.frames[0].variables.a = { type: "ref", id: "o1" };
  const deleteAfter = snapshotOf(2, { o1: { type: "list", items: [int(2), int(3)] } });
  deleteAfter.frames[0].variables.a = { type: "ref", id: "o1" };
  const deleted = diffSteps(deleteBefore, deleteAfter, { source: "del a[0]\n" });
  assert.deepEqual(deleted.map(describe), ["shrink.delete o1[0] 1"]);
  assert.deepEqual(applyState(stateOf(deleteBefore), deleted), stateOf(deleteAfter));
  assert.deepEqual(
    applyState(stateOf(deleteAfter), reverseActions(deleted, stateOf(deleteAfter))),
    stateOf(deleteBefore),
  );
});

test("grow and shrink motions round trip, and invalid cell actions are refused", () => {
  const listState = (values) => ({
    frames: [],
    heap: { o1: { type: "list", items: values.map(int) } },
  });
  const cases = [
    {
      action: createAction("grow", {
        step: 1,
        target: { kind: "cell", objectId: "o1", index: 2 },
        motion: "append",
        to: int(3),
        reason: "unknown-shape",
      }),
      before: [1, 2],
      after: [1, 2, 3],
    },
    {
      action: createAction("grow", {
        step: 1,
        target: { kind: "cell", objectId: "o1", index: 1 },
        motion: "insert",
        to: int(3),
      }),
      before: [1, 2],
      after: [1, 3, 2],
    },
    {
      action: createAction("shrink", {
        step: 1,
        target: { kind: "cell", objectId: "o1", index: 1 },
        motion: "pop",
        from: int(2),
        reason: "unknown-shape",
      }),
      before: [1, 2],
      after: [1],
    },
    {
      action: createAction("shrink", {
        step: 1,
        target: { kind: "cell", objectId: "o1", index: 0 },
        motion: "delete",
        from: int(1),
      }),
      before: [1, 2],
      after: [2],
    },
  ];
  for (const { action, before, after } of cases) {
    const first = listState(before);
    const second = listState(after);
    assert.deepEqual(applyState(first, [action]), second, `${action.kind}.${action.motion} forward`);
    const inverse = reverseActions([action], second);
    assert.deepEqual(applyState(second, inverse), first, `${action.kind}.${action.motion} backward`);
    assert.deepEqual(
      reverseActions(inverse, first),
      [action],
      `${action.kind}.${action.motion} inverts back`,
    );
  }

  const two = listState([1, 2]);
  assert.throws(
    () =>
      applyState(two, [
        createAction("grow", {
          step: 1,
          target: { kind: "cell", objectId: "o1", index: 0 },
          motion: "append",
          to: int(3),
        }),
      ]),
    /append at the end/,
  );
  assert.throws(
    () =>
      applyState(two, [
        createAction("shrink", {
          step: 1,
          target: { kind: "cell", objectId: "o1", index: 2 },
          motion: "pop",
          from: int(3),
        }),
      ]),
    /outside/,
  );
  assert.throws(
    () =>
      applyState(two, [
        createAction("shrink", {
          step: 1,
          target: { kind: "cell", objectId: "o1", index: 0 },
          motion: "pop",
          from: int(1),
        }),
      ]),
    /last cell/,
  );
  assert.throws(
    () =>
      applyState(
        { frames: [], heap: { o1: { type: "dict", entries: [] } } },
        [
          createAction("grow", {
            step: 1,
            target: { kind: "cell", objectId: "o1", index: 0 },
            motion: "append",
            to: int(3),
          }),
        ],
      ),
    /target a list/,
  );
  assert.throws(
    () =>
      applyState(two, [
        createAction("grow", {
          step: 1,
          target: { kind: "cell", objectId: "o1", index: 3 },
          motion: "insert",
          to: int(3),
        }),
      ]),
    /outside/,
  );
  assert.throws(
    () =>
      applyState(two, [
        createAction("grow", {
          step: 1,
          target: { kind: "cell", objectId: "o1", index: 0 },
          motion: "insert",
        }),
      ]),
    /new value/,
  );
  assert.throws(
    () =>
      applyState(two, [
        createAction("shrink", {
          step: 1,
          target: { kind: "cell", objectId: "o1", index: 2 },
          motion: "delete",
          from: int(3),
        }),
      ]),
    /outside/,
  );
  assert.throws(
    () =>
      applyState(two, [
        createAction("shrink", {
          step: 1,
          target: { kind: "cell", objectId: "o1", index: 0 },
          motion: "delete",
        }),
      ]),
    /removed value/,
  );
  assert.throws(
    () =>
      applyState(
        { frames: [], heap: { o1: { type: "tuple", items: [int(1), int(2)] } } },
        [
          createAction("grow", {
            step: 1,
            target: { kind: "cell", objectId: "o1", index: 1 },
            motion: "insert",
            to: int(3),
          }),
        ],
      ),
    /tuple/,
  );
  assert.throws(
    () =>
      reverseActions(
        [
          createAction("grow", {
            step: 1,
            target: { kind: "cell", objectId: "o1", index: 0 },
            motion: "insert",
          }),
        ],
        two,
      ),
    /new value/,
  );
  assert.throws(
    () =>
      reverseActions(
        [
          createAction("shrink", {
            step: 1,
            target: { kind: "cell", objectId: "o1", index: 0 },
            motion: "delete",
          }),
        ],
        two,
      ),
    /removed value/,
  );
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

test("a swap applies once, targets its lower index, and is its own inverse", () => {
  const { trace } = program("assign-only");
  const state = stateOf(snapshotAt(trace, 2));
  const asList = (items) => ({ frames: [], heap: { o1: { type: "list", items } } });
  const before = asList([int(1), int(2), int(3)]);
  const after = asList([int(3), int(2), int(1)]);
  const swap = createAction("move", {
    step: 0,
    target: { kind: "cell", objectId: "o1", index: 0 },
    motion: "swap",
    payload: { indices: [0, 2] },
  });
  assert.ok(STATE_KINDS.includes(swap.kind));
  assert.deepEqual(applyState(before, [swap]), after);
  assert.deepEqual(reverseActions([swap], after), [swap], "a swap is its own inverse");
  assert.deepEqual(applyState(after, reverseActions([swap], after)), before);
  // A silent skip would let a half-applied state pass for a correct one.
  assert.deepEqual(applyState(state, []), state);

  // Malformed pairs are refused rather than half-applied.
  const move = (index, indices) =>
    createAction("move", {
      step: 0,
      target: { kind: "cell", objectId: "o1", index },
      motion: "swap",
      payload: { indices },
    });
  assert.throws(() => applyState(before, [move(2, [0, 2])]), /lower/);
  assert.throws(() => applyState(before, [move(0, [0, 0])]), /itself/);
  assert.throws(() => applyState(before, [move(0, [0, 5])]), /outside/);
  assert.throws(
    () =>
      applyState(before, [
        createAction("move", {
          step: 0,
          target: { kind: "cell", objectId: "o1", index: 0 },
          motion: "swap",
        }),
      ]),
    /index pair/,
  );
  assert.throws(
    () => applyState({ frames: [], heap: { o1: { type: "tuple", items: [int(1), int(2)] } } }, [swap]),
    /tuple/,
  );

});

test("a shift applies only its destination and refuses malformed actions", () => {
  const asList = (items) => ({ frames: [], heap: { o1: { type: "list", items } } });
  const before = asList([int(1), int(2), int(3)]);
  const after = asList([int(1), int(1), int(3)]);
  const shift = createAction("move", {
    step: 0,
    target: { kind: "cell", objectId: "o1", index: 1 },
    motion: "shift",
    from: int(2),
    to: int(1),
    payload: { indices: [0, 1] },
  });
  assert.deepEqual(applyState(before, [shift]), after);
  assert.deepEqual(
    applyState(before, [shift]).heap.o1.items[0],
    int(1),
    "the forward shift leaves the source alone",
  );
  const inverse = reverseActions([shift], after);
  assert.deepEqual(inverse.map(describe), ["change o1[1] 1 -> 2"]);
  assert.deepEqual(applyState(after, inverse), before);

  const malformed = (fields) =>
    createAction("move", {
      step: 0,
      target: { kind: "cell", objectId: "o1", index: 1 },
      motion: "shift",
      from: int(2),
      to: int(1),
      payload: { indices: [0, 1] },
      ...fields,
    });
  assert.throws(
    () => applyState(before, [malformed({ target: { kind: "cell", objectId: "o1", index: 0 } })]),
    /destination/,
  );
  assert.throws(() => applyState(before, [malformed({ payload: { indices: [0, 2] } })]), /adjacent/);
  assert.throws(() => applyState(before, [malformed({ payload: { indices: [2, 3] } })]), /outside/);
  assert.throws(() => applyState(before, [malformed({ from: null })]), /overwritten/);
  assert.throws(() => applyState(before, [malformed({ to: null })]), /copied/);
  assert.throws(() => applyState(before, [malformed({ payload: null })]), /index pair/);
  assert.throws(
    () => reverseActions([malformed({ target: { kind: "cell", objectId: "o1", index: 0 } })], after),
    /destination/,
  );
  assert.throws(
    () => reverseActions([malformed({ payload: { indices: [0, 2] } })], after),
    /adjacent/,
  );
  assert.throws(() => reverseActions([malformed({ from: null })], after), /overwritten/);
  assert.throws(() => reverseActions([malformed({ to: null })], after), /copied/);
  assert.throws(
    () => applyState({ frames: [], heap: { o1: { type: "tuple", items: [int(1), int(2)] } } }, [shift]),
    /tuple/,
  );
  assert.throws(() => reverseActions([shift], { frames: [], heap: { o1: { type: "tuple", items: [int(1), int(2)] } } }), /tuple/);
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
