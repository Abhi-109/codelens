// The diff core: one transition of a format-2 trace becomes a list of actions.
//
// Task 4 covers the parts of the state that are not collections: the call stack,
// each frame's variables, and the console/return/error facts an event records.
// List, dict, set and object contents are tasks 5 and 6; this module makes **no
// claim at all** about them yet. A heap transition therefore produces no action,
// which is recorded here and in docs/animation.md rather than papered over with
// a generic highlight: the vocabulary has no reason code for "deferred", and a
// highlight on every list step would be noise, not information.
//
// What the diff may look at is fixed by docs/animation.md section 2: the two
// snapshots, the next event's recorded facts, and (for a return) whether recorded
// output follows it. It never runs Python, never reads the editor's text, never
// looks past the transition, and never invents a value.
//
// Two contracts live here and are pinned by diff.test.mjs:
//
//   * `stateOf` is the compared state of section 3, exactly: every frame's
//     frame_id, function, call_line and variables, and the whole heap. A frame's
//     own `line` is cursor metadata and is deliberately excluded, so moving the
//     cursor never looks like a data change.
//   * `applyState(s, diff(a, b))` equals `stateOf(b)`, and applying the reverse
//     to `stateOf(b)` equals `stateOf(a)`. Nothing is normalised, sorted or
//     dropped to make that true.
//
// Events that record no snapshot (`output`, `input`, `error`, the limit events)
// are not states of their own. `snapshotAt` gives them the last recorded state,
// so a print step shows the state it printed from instead of an empty program.

import { canonicalValue, createAction, isStateAction } from "./actions.js";

/**
 * Events that end the search for a return's console destination: the next
 * control event means the returned value was not printed.
 */
const CONTROL_EVENTS = new Set([
  "call",
  "line",
  "return",
  "exception",
  "unwind",
  "error",
  "step_limit",
  "timeout",
  "output_limit",
]);

function hasRecordedState(event) {
  return event !== null && typeof event === "object" && Array.isArray(event.frames);
}

function isFrameSnapshot(frame) {
  return (
    frame !== null &&
    typeof frame === "object" &&
    Number.isInteger(frame.frame_id) &&
    typeof frame.function === "string" &&
    frame.variables !== null &&
    typeof frame.variables === "object" &&
    !Array.isArray(frame.variables)
  );
}

function copyFrame(frame) {
  return {
    frame_id: frame.frame_id,
    function: frame.function,
    call_line: frame.call_line ?? null,
    variables: { ...frame.variables },
  };
}

function findFrame(state, frameId) {
  return state.frames.find((frame) => frame.frame_id === frameId);
}

/**
 * The event at `index`, with the state it is shown against.
 *
 * An execution event carries its own `frames`/`heap`; an `output`, `input`,
 * `error` or limit event records none, so it is shown against the last state
 * recorded before it. That is what makes `print` a step that prints the state
 * it printed from, without re-running Python or inventing a snapshot.
 *
 * @param {Array} trace the trace's events, oldest first
 * @param {number} index the event index (the playback cursor)
 * @returns {Object|null} a snapshot: the event plus `frames` and `heap`
 */
export function snapshotAt(trace, index) {
  if (!Array.isArray(trace)) return null;
  if (!Number.isInteger(index) || index < 0 || index >= trace.length) return null;
  const event = trace[index];
  if (event === null || typeof event !== "object") return null;
  if (Array.isArray(event.frames)) return event;
  for (let i = index - 1; i >= 0; i -= 1) {
    const earlier = trace[i];
    if (hasRecordedState(earlier)) {
      return { ...event, frames: earlier.frames, heap: earlier.heap ?? {} };
    }
  }
  return { ...event, frames: [], heap: {} };
}

/**
 * The compared state of a snapshot (docs/animation.md section 3): the frame
 * stack and the heap, and nothing else. The frames are copied, so applying
 * actions can never write into the trace; the heap is shared, because no action
 * this module emits changes it.
 *
 * @param {Object|null} snapshot a snapshot from `snapshotAt`, or null for "before the run"
 * @returns {{frames: Array, heap: Object}}
 */
export function stateOf(snapshot) {
  if (snapshot === null || snapshot === undefined) return { frames: [], heap: {} };
  const frames = (snapshot.frames ?? []).map(copyFrame);
  return { frames, heap: snapshot.heap ?? {} };
}

/**
 * The actions of one transition.
 *
 * @param {Object|null} prev the previous snapshot (null before the run starts)
 * @param {Object} next the snapshot the cursor is on
 * @param {{source?: string, consoleAfterReturn?: boolean}} [context]
 *   `consoleAfterReturn` is the recorded fact that output follows this return;
 *   `consoleFollowsReturn(trace, index)` answers it. Without it the return
 *   overlay names no destination.
 * @returns {Array} state actions first, then the step's overlays
 */
export function diffSteps(prev, next, context = {}) {
  if (prev !== null && prev !== undefined && !hasRecordedState(prev)) {
    throw new TypeError("diffSteps needs snapshots from snapshotAt, not a raw event");
  }
  if (!hasRecordedState(next) || !Number.isInteger(next.step) || next.step < 0) {
    throw new TypeError("diffSteps needs the next snapshot and its step");
  }
  const options = context ?? {};
  const step = next.step;
  const before = stateOf(prev);
  const after = stateOf(next);
  const actions = [];

  // The stack: a frame leaves, or a call adds one. A frame is identified by its
  // frame_id, so recursion gets one action per call even for the same function.
  const beforeIds = new Set(before.frames.map((frame) => frame.frame_id));
  const afterIds = new Set(after.frames.map((frame) => frame.frame_id));
  for (const frame of before.frames) {
    if (afterIds.has(frame.frame_id)) continue;
    actions.push(
      createAction("disappear", {
        step,
        target: { kind: "frame", frameId: frame.frame_id },
        from: frame,
      }),
    );
  }
  for (const frame of after.frames) {
    if (beforeIds.has(frame.frame_id)) continue;
    actions.push(
      createAction("call", {
        step,
        target: { kind: "frame", frameId: frame.frame_id },
        to: frame,
        // At a call event the frame's variables are exactly the bound arguments.
        payload: { function: frame.function, callLine: frame.call_line, args: frame.variables },
      }),
    );
  }

  // Variables of the frames that survive the transition. Values are compared
  // canonically: the tracer happens to emit sorted keys, but a change must not
  // depend on that accident.
  for (const frame of after.frames) {
    const older = findFrame(before, frame.frame_id);
    if (!older) continue;
    const target = (name) => ({ kind: "variable", frameId: frame.frame_id, name });
    for (const name of Object.keys(older.variables)) {
      if (Object.hasOwn(frame.variables, name)) continue;
      actions.push(createAction("disappear", { step, target: target(name), from: older.variables[name] }));
    }
    for (const name of Object.keys(frame.variables)) {
      if (!Object.hasOwn(older.variables, name)) {
        actions.push(createAction("appear", { step, target: target(name), to: frame.variables[name] }));
      } else if (canonicalValue(older.variables[name]) !== canonicalValue(frame.variables[name])) {
        actions.push(
          createAction("change", {
            step,
            target: target(name),
            from: older.variables[name],
            to: frame.variables[name],
          }),
        );
      }
    }
  }

  // Overlays describe what the event recorded. They never change the state, and
  // they are keyed to this step, so moving the cursor drops them.
  const consoleTarget = { kind: "console" };
  if (next.event === "output") {
    actions.push(
      createAction("print", {
        step,
        target: consoleTarget,
        payload: { text: typeof next.text === "string" ? next.text : "" },
      }),
    );
  } else if (next.event === "return") {
    const value = next.return_value ?? null;
    actions.push(
      createAction("return", {
        step,
        target: Number.isInteger(next.frame_id)
          ? { kind: "frame", frameId: next.frame_id }
          : consoleTarget,
        payload: {
          function: typeof next.function === "string" ? next.function : null,
          value,
          to: options.consoleAfterReturn === true ? "console" : null,
        },
      }),
    );
  } else if (next.event === "exception") {
    const error = next.exception ?? {};
    actions.push(
      createAction("error", {
        step,
        target: Number.isInteger(next.frame_id)
          ? { kind: "frame", frameId: next.frame_id }
          : consoleTarget,
        payload: {
          type: error.type ?? null,
          message: error.message ?? null,
          line: Number.isInteger(next.line) ? next.line : null,
        },
      }),
    );
  } else if (next.event === "error") {
    // A compile error has no frame; a runtime error already raised its badge on
    // the exception event, and this is the run's recorded outcome.
    actions.push(
      createAction("error", {
        step,
        target: consoleTarget,
        payload: {
          type: next.type ?? null,
          message: next.message ?? null,
          line: Number.isInteger(next.line) ? next.line : null,
          phase: next.phase ?? null,
        },
      }),
    );
  }
  // `unwind` repeats an exception that already has its badge, and `input`'s echo
  // is recorded as a following output event, so neither adds an overlay here.

  return actions;
}

/**
 * Whether recorded output follows this return before the next control event -
 * the only evidence that lets a return value travel to the console
 * (docs/animation.md section 10). Without it the diff names no destination.
 *
 * @param {Array} trace the trace's events
 * @param {number} index the index of the `return` event
 * @returns {boolean}
 */
export function consoleFollowsReturn(trace, index) {
  if (!Array.isArray(trace) || !Number.isInteger(index)) return false;
  for (let i = index + 1; i < trace.length; i += 1) {
    const event = trace[i];
    const kind = event?.event;
    if (kind === "output") return true;
    if (kind === "input") continue;
    if (CONTROL_EVENTS.has(kind)) return false;
  }
  return false;
}

/** The actions that change the compared state; overlays are not state. */
export function stateActions(actions) {
  if (!Array.isArray(actions)) return [];
  return actions.filter(isStateAction);
}

/**
 * The actions that undo a step, in the order they must be applied.
 *
 * Overlays are **dropped**, not inverted: a flash, a print chunk or an error
 * badge describes the step it belongs to and has no "undo". State actions are
 * inverted by the table in docs/animation.md section 12, back to front, so two
 * actions on the same element undo in the right order. The step number is kept:
 * the inverse of step 12 belongs to step 12.
 *
 * @param {Array} actions
 * @returns {Array} state actions whose application undoes the transition
 */
export function reverseActions(actions) {
  if (!Array.isArray(actions)) return [];
  const reversed = [];
  for (let i = actions.length - 1; i >= 0; i -= 1) {
    const action = actions[i];
    if (!isStateAction(action)) continue;
    const common = { step: action.step, target: action.target };
    switch (action.kind) {
      case "appear":
        reversed.push(createAction("disappear", { ...common, from: action.to }));
        break;
      case "change":
        reversed.push(createAction("change", { ...common, from: action.to, to: action.from }));
        break;
      case "call":
        reversed.push(createAction("disappear", { ...common, from: action.to }));
        break;
      case "disappear":
        if (action.target.kind === "frame") {
          const frame = action.from;
          if (!isFrameSnapshot(frame)) throw new TypeError("a frame disappearance must carry the frame");
          reversed.push(
            createAction("call", {
              ...common,
              to: frame,
              payload: {
                function: frame.function,
                callLine: frame.call_line ?? null,
                args: frame.variables,
              },
            }),
          );
        } else {
          reversed.push(createAction("appear", { ...common, to: action.from }));
        }
        break;
      default:
        // move/grow/shrink arrive with the collection diff (tasks 5 and 6);
        // guessing their inverse here would be worse than refusing.
        throw new TypeError(`cannot reverse a ${action.kind} action yet`);
    }
  }
  return reversed;
}

/**
 * Apply state actions to a compared state, without mutating it.
 *
 * Overlays are ignored: they never change the snapshot. A state kind this
 * module does not emit yet is refused rather than silently skipped, so a
 * half-applied state can never pass for a correct one.
 *
 * @param {{frames: Array, heap: Object}|Object} state a state from `stateOf`
 * @param {Array} actions
 * @returns {{frames: Array, heap: Object}}
 */
export function applyState(state, actions) {
  const current = stateOf(state);
  for (const action of actions ?? []) {
    if (!isStateAction(action)) continue;
    const target = action.target ?? {};
    switch (action.kind) {
      case "call": {
        const frame = action.to;
        if (!isFrameSnapshot(frame)) throw new TypeError("a call action must carry the frame in to");
        if (findFrame(current, frame.frame_id)) {
          throw new TypeError(`frame ${frame.frame_id} is already on the stack`);
        }
        current.frames.push(copyFrame(frame));
        break;
      }
      case "appear": {
        const frame = findFrame(current, target.frameId);
        if (!frame || target.kind !== "variable") {
          throw new TypeError("an appear action must target a variable of a live frame");
        }
        frame.variables[target.name] = action.to;
        break;
      }
      case "change": {
        const frame = findFrame(current, target.frameId);
        if (!frame || target.kind !== "variable" || !Object.hasOwn(frame.variables, target.name)) {
          throw new TypeError("a change action must target a variable that exists");
        }
        frame.variables[target.name] = action.to;
        break;
      }
      case "disappear": {
        if (target.kind === "frame") {
          const at = current.frames.findIndex((frame) => frame.frame_id === target.frameId);
          if (at < 0) throw new TypeError(`frame ${target.frameId} is not on the stack`);
          current.frames.splice(at, 1);
          break;
        }
        const frame = findFrame(current, target.frameId);
        if (!frame || target.kind !== "variable" || !Object.hasOwn(frame.variables, target.name)) {
          throw new TypeError("a disappear action must target a variable that exists");
        }
        delete frame.variables[target.name];
        break;
      }
      default:
        throw new TypeError(`applyState cannot apply a ${action.kind} action yet`);
    }
  }
  return current;
}
