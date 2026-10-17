// The single source of truth for "what is happening at step N".
//
// Every panel — code, graph, variables, changes, function calls, output and the
// explanation card — reads this one object, built from the trace at one index.
// Pure: no React, so node --test can prove that the panels cannot disagree.
//
// The convention (see docs/ui-diagnosis.md), straight out of
// docs/trace-format.md §5 "one-step lag":
//
//   * The highlighted line is the line ABOUT TO RUN.
//   * The variables panel shows the state BEFORE it runs, and `changes` is a
//     preview of what that same line is about to do.
//   * The explanation card has three labelled parts: just happened, about to
//     happen, and why this line runs now.
//
//   getStepView(trace, index, source, { nodeId, frameId, steps })
//
// `steps`, when given, is the execution graph's step → node array, so the graph
// node here is guaranteed to be the same node the graph draws for this index.

import { explainStepView } from "./explain.js";
import { changedSlots, namesById, slotEntries } from "./objects.js";
import { showValue } from "./values.js";

const MODULE = "<module>";
/** A holder for a function, class or module is not a value the learner tracks. */
export const DEFINED_TYPES = new Set(["function", "class", "module"]);

/** Events that move control; only they can be "the line that just ran". */
const ANCHOR_AHEAD = new Set(["line", "call", "return", "unwind", "exception"]);

/** The state-carrying event at or before `index` (output/input carry no stack). */
export function stateAt(trace, index) {
  for (let i = Math.min(index, (trace?.length ?? 0) - 1); i >= 0; i -= 1) {
    if (trace[i]?.frames) return trace[i];
  }
  return null;
}

function topFrame(state) {
  return state?.frames?.[state.frames.length - 1] ?? null;
}

/** The next state whose top frame is `frameId` — this same frame, later on. */
function sameFrameAfter(trace, index, frameId) {
  for (let i = index + 1; i < trace.length; i += 1) {
    const frames = trace[i]?.frames;
    if (frames && frames[frames.length - 1].frame_id === frameId) return trace[i];
  }
  return null;
}

/** The line that just ran before `index`, or null. */
function previousLineNumber(trace, index) {
  for (let i = index - 1; i >= 0; i -= 1) {
    if (trace[i].event === "line") return trace[i].line;
  }
  return null;
}

/** The line that produced the value visible at `index` in `frameId`. */
function producedByLine(trace, index, frameId) {
  for (let i = index - 1; i >= 0; i -= 1) {
    const event = trace[i];
    if (event.event === "line" && event.frame_id === frameId) return event.line;
  }
  return trace[index]?.line ?? null;
}

/** The parameter names of a function, read from its `def` line. */
export function paramsFor(source, functionName) {
  if (!functionName || functionName === MODULE) return [];
  const line = (source ?? "")
    .split("\n")
    .find((text) => text.trim().startsWith(`def ${functionName}(`));
  const inner = line?.match(/^def\s+[A-Za-z_]\w*\s*\(([^)]*)\)/)?.[1];
  if (!inner) return [];
  return inner
    .split(",")
    .map((part) => part.trim().split("=")[0].replace(/^\*+/, "").trim())
    .filter((name) => name && name !== "self");
}

/** One frame, ready to display: arguments, variables, defined names. */
function frameView(frame, heap, params, { depth, isTop, callNumber, returnValue }) {
  const variables = [];
  const args = [];
  const defined = [];
  for (const [name, value] of Object.entries(frame.variables ?? {})) {
    if (DEFINED_TYPES.has(value?.type)) {
      defined.push(name);
      continue;
    }
    const entry = {
      name,
      text: showValue(value, heap),
      type: value?.type ?? "?",
      refId: value?.type === "ref" ? value.id : null,
      isArg: params.includes(name),
    };
    variables.push(entry);
    if (entry.isArg) args.push(entry);
  }
  return {
    frameId: frame.frame_id,
    function: frame.function,
    callLine: frame.call_line,
    line: frame.line,
    depth,
    isTop: Boolean(isTop),
    callNumber,
    args,
    variables,
    defined,
    returnValue: returnValue ?? null,
  };
}

/** `call #n` counting same-named frames that are already on the stack. */
function callNumbers(frames) {
  const seen = new Map();
  return frames.map((frame) => {
    const n = (seen.get(frame.function) ?? 0) + 1;
    seen.set(frame.function, n);
    return n;
  });
}

/** Variables that appeared or changed between two states of the same frame. */
function variableChanges(before, after, line) {
  const beforeTop = topFrame(before);
  const afterTop = topFrame(after);
  if (!afterTop || beforeTop?.frame_id !== afterTop.frame_id) return [];
  const beforeVars = beforeTop.variables ?? {};
  const afterVars = afterTop.variables ?? {};
  const changes = [];
  for (const [name, value] of Object.entries(afterVars)) {
    if (DEFINED_TYPES.has(value?.type)) continue;
    const was = beforeVars[name];
    if (was === undefined) {
      changes.push({ kind: "new", name, from: null, to: showValue(value, after.heap), line });
    } else if (JSON.stringify(was) !== JSON.stringify(value)) {
      changes.push({
        kind: "changed",
        name,
        from: showValue(was, before.heap),
        to: showValue(value, after.heap),
        line,
      });
    }
  }
  return changes;
}

/** The exact slot that changed inside a list, dict, set or object. */
function slotChanges(before, after, names) {
  const beforeHeap = before?.heap ?? {};
  const afterHeap = after?.heap ?? {};
  const changes = [];
  for (const [id, object] of Object.entries(afterHeap)) {
    const changed = changedSlots(beforeHeap[id], object);
    if (changed.size === 0) continue;
    const label = (names.get(id) ?? [id])[0];
    const now = new Map(slotEntries(object).map((entry) => [entry.key, entry.value]));
    const then = new Map(slotEntries(beforeHeap[id]).map((entry) => [entry.key, entry.value]));
    const inSlotEntries = new Set(now.keys());
    for (const key of changed) {
      if (!inSlotEntries.has(key)) continue; // the "+N more" marker is not a slot
      const name =
        object.type === "object" ? `${label}.${key}` : `${label}[${JSON.stringify(key)}]`;
      changes.push({
        kind: "slot",
        name,
        from: beforeHeap[id] ? showValue(then.get(key), beforeHeap) : null,
        to: showValue(now.get(key), afterHeap),
        line: null,
      });
    }
  }
  return changes;
}

/** Notes for names that point at one object: "a and b are two names for it". */
function sharedNotes(state) {
  const byId = new Map();
  for (let i = (state?.frames?.length ?? 0) - 1; i >= 0; i -= 1) {
    for (const [name, value] of Object.entries(state.frames[i].variables ?? {})) {
      if (value?.type !== "ref") continue;
      const names = byId.get(value.id) ?? [];
      if (!names.includes(name)) names.push(name);
      byId.set(value.id, names);
    }
  }
  const notes = [];
  for (const [id, names] of byId) {
    if (names.length < 2) continue;
    const kind = state?.heap?.[id]?.type;
    const word = kind === "dict" ? "dictionary" : kind === "object" ? "object" : "list";
    notes.push({
      id,
      names,
      text: `${names.map((name) => `\`${name}\``).join(" and ")} are two names for the same ${word}. Changing one changes the other.`,
    });
  }
  return notes;
}

/** Text a print() line writes, gathered from the output events that follow it. */
function printedAfter(trace, index) {
  let out = "";
  for (let i = index + 1; i < trace.length; i += 1) {
    const event = trace[i];
    if (ANCHOR_AHEAD.has(event.event)) break;
    if (event.event === "output") out += event.text;
  }
  return out.replace(/\n$/, "");
}

/** A short result hint for the highlighted line, taken from the trace. */
function lineHint(event, changes, trace, index) {
  if (event?.event !== "line") return null;
  if (changes.length === 1) return `${changes[0].name} = ${changes[0].to}`;
  if (changes.length > 1) {
    return `${changes.map((c) => `${c.name} = ${c.to}`).join(", ")}`;
  }
  const printed = printedAfter(trace, index);
  return printed ? `prints ${printed}` : null;
}

/**
 * Everything the UI needs to show step `index`, from one pass over the trace.
 * @param {Array} trace the trace array from docs/trace-format.md
 * @param {number} index which step is current
 * @param {string} source the user's code, for line text and parameter names
 * @param {{ nodeId?: string|null, frameId?: number|null, steps?: Array<string|null> }} [options]
 * @returns {Object}
 */
export function getStepView(trace, index, source = "", options = {}) {
  const { frameId = null, steps = null } = options;
  const list = Array.isArray(trace) ? trace : [];
  const event = list[index] ?? null;
  const kind = event?.event ?? null;
  const state = stateAt(list, index);
  const top = topFrame(state);
  const currentFrameId = top?.frame_id ?? null;

  const isLine = kind === "line";
  const before = kind === "call" ? stateAt(list, index - 1) : state;
  const after = isLine ? sameFrameAfter(list, index, currentFrameId) : kind === "call" ? event : null;

  let changes = [];
  if (isLine && after) {
    changes = [
      ...variableChanges(before, after, event.line),
      ...slotChanges(before, after, namesById(after.frames, after.heap)),
    ];
  } else if (kind === "call") {
    const frame = topFrame(event);
    const params = paramsFor(source, event.function);
    for (const [name, value] of Object.entries(frame?.variables ?? {})) {
      if (DEFINED_TYPES.has(value?.type)) continue;
      changes.push({
        kind: "new",
        name,
        from: null,
        to: showValue(value, event.heap),
        line: frame.call_line ?? event.line,
        arg: params.includes(name),
      });
    }
  }

  const frames = state?.frames ?? [];
  const numbers = callNumbers(frames);
  const returnValue =
    kind === "return" && event.return_value
      ? showValue(event.return_value, event.heap)
      : null;
  const callStack = frames
    .map((frame, i) =>
      frameView(frame, state?.heap, paramsFor(source, frame.function), {
        depth: i,
        isTop: i === frames.length - 1,
        callNumber: numbers[i],
        returnValue: i === frames.length - 1 ? returnValue : null,
      }),
    )
    .reverse();
  const selectedId = frameId ?? currentFrameId;
  const frame =
    callStack.find((entry) => entry.frameId === selectedId) ?? callStack[0] ?? null;

  const values = Object.fromEntries(
    (frame?.variables ?? []).map((entry) => [entry.name, entry.text]),
  );

  const nodeId = options.nodeId ?? (steps ? steps[index] ?? null : null);
  const printed = kind === "output" ? event.text.replace(/\n$/, "") : null;
  const line = event?.line || null;

  return {
    index,
    kind,
    event,
    function: top?.function ?? MODULE,
    frameId: currentFrameId,
    line,
    previousLine: previousLineNumber(list, index),
    code: sourceLine(source, line),
    before,
    after,
    frame,
    callStack,
    frames,
    changes,
    shared: sharedNotes(state),
    returnValue,
    printed,
    values,
    hint: lineHint(event, changes, list, index),
    nodeId,
    cameFrom: steps ? steps[index - 1] ?? null : null,
    nextNode: steps ? steps[index + 1] ?? null : null,
    explanation: explainStepView(list, index, source),
  };
}

function sourceLine(source, line) {
  if (line == null) return null;
  const raw = (source ?? "").split("\n")[line - 1] ?? "";
  return { line, text: raw.trim(), indent: raw.length - raw.trimStart().length };
}

/**
 * How one variable changed over the whole run: the value it first held at each
 * step, and the line that put it there. Powers "watch this variable".
 * @returns {Array<{ index: number, line: number|null, value: string, function: string }>}
 */
export function variableHistory(trace, name) {
  const list = Array.isArray(trace) ? trace : [];
  const entries = [];
  let last = null;
  for (let i = 0; i < list.length; i += 1) {
    const event = list[i];
    if (!event.frames) continue;
    const frame = event.frames[event.frames.length - 1];
    const value = frame.variables?.[name];
    if (value === undefined) continue;
    const json = JSON.stringify(value);
    if (json === last) continue;
    last = json;
    entries.push({
      index: i,
      line: producedByLine(list, i, frame.frame_id),
      value: showValue(value, event.heap),
      function: frame.function,
    });
  }
  return entries;
}
