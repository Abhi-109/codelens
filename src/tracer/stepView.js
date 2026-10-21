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
import { changedSlots, namesById, objectLabel, slotEntries } from "./objects.js";
import { getTraceIndex } from "./traceIndex.js";
import { formatValue, showValue } from "./values.js";

const MODULE = "<module>";
const CHANGE_LOG = new WeakMap();
/** A holder for a function, class or module is not a value the learner tracks. */
export const DEFINED_TYPES = new Set(["function", "class", "module"]);

/** The state-carrying event at or before `index` (output/input carry no stack). */
export function stateAt(trace, index) {
  return getTraceIndex(trace).stateAt(index);
}

function topFrame(state) {
  return state?.frames?.[state.frames.length - 1] ?? null;
}

/** The line that produced the value visible at `index` in `frameId`. */
function producedByLine(trace, index, frameId) {
  const previous = getTraceIndex(trace).previousLineInFrame(index, frameId);
  return previous ?? trace[index]?.line ?? null;
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
function frameView(frame, heap, params, { depth, isTop, callNumber, returnValue, lineText }) {
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
    lineText,
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

/** Variables that appeared, changed, or were removed in one frame. */
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
  // `del x` leaves no value to compare with, so without this the deletion is
  // invisible. `to: null` means "gone", never Python's None.
  for (const [name, was] of Object.entries(beforeVars)) {
    if (DEFINED_TYPES.has(was?.type) || afterVars[name] !== undefined) continue;
    changes.push({ kind: "removed", name, from: showValue(was, before.heap), to: null, line });
  }
  return changes;
}

/** The learner's name for one slot, e.g. `xs[0]`, `d["a"]`, `dog.name`. */
function slotName(label, entry, object, heap) {
  if (object.type === "object") return `${label}.${entry.label ?? entry.key}`;
  if (object.type === "set") return `${label}{${showValue(entry.value, heap)}}`;
  const shown =
    entry.label !== null && typeof entry.label === "object"
      ? formatValue(entry.label, heap)
      : entry.label ?? entry.key;
  return `${label}[${shown}]`;
}

/** The exact slot that changed inside an object the program already had. */
function slotChanges(before, after, names, line) {
  const beforeHeap = before?.heap ?? {};
  const afterHeap = after?.heap ?? {};
  const changes = [];
  for (const [id, object] of Object.entries(afterHeap)) {
    // A brand new list is one "data is new" change, not one per slot.
    if (!beforeHeap[id]) continue;
    const oldObject = beforeHeap[id];
    const changed = changedSlots(oldObject, object);
    if (changed.size === 0) continue;
    const label = (names.get(id) ?? [])[0] ?? objectLabel(id, object);
    const now = new Map(slotEntries(object).map((entry) => [entry.key, entry]));
    const then = new Map(slotEntries(oldObject).map((entry) => [entry.key, entry]));
    for (const key of changed) {
      const nowEntry = now.get(key);
      const thenEntry = then.get(key);
      if (!nowEntry && !thenEntry) continue; // the "+N more" marker is not a slot
      // A dict slot is keyed by the trace's JSON for its key; the learner must
      // see the key's value ("a"), not that JSON.
      const entry = nowEntry ?? thenEntry;
      const heap = nowEntry ? afterHeap : beforeHeap;
      const name = slotName(label, entry, object, heap);
      // A slot that did not exist before is new, not a change from nothing —
      // calling it a change would print a made-up "before" value. A slot that
      // vanished is a removal, not a silent gap.
      const kind = !thenEntry ? "new-slot" : !nowEntry ? "removed-slot" : "slot";
      changes.push({
        kind,
        name,
        from: thenEntry ? showValue(thenEntry.value, beforeHeap) : null,
        to: nowEntry ? showValue(nowEntry.value, afterHeap) : null,
        line,
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
    const count = names.length === 2 ? "are two names" : `are ${names.length} names`;
    notes.push({
      id,
      names,
      text: `${names.map((name) => `\`${name}\``).join(", ")} ${count} for the same ${word}. Changing one changes the other.`,
    });
  }
  return notes;
}

/** Text a print() line writes, gathered from the output events that follow it. */
function printedAfter(trace, index) {
  return getTraceIndex(trace).printedAfter(index);
}

/** A short result hint for the highlighted line, taken from the trace. */
function lineHint(event, changes, trace, index) {
  if (event?.event !== "line") return null;
  const gone = (change) => change.kind === "removed" || change.kind === "removed-slot";
  if (changes.length === 1) return gone(changes[0]) ? `${changes[0].name} removed` : changes[0].to;
  if (changes.length > 1) {
    return changes
      .map((change) => (gone(change) ? `${change.name} removed` : `${change.name} = ${change.to}`))
      .join(", ");
  }
  const printed = printedAfter(trace, index);
  return printed ? `prints ${printed}` : null;
}

/**
 * Everything the UI needs to show step `index`, from the trace's shared index.
 * @param {Array} trace the trace array from docs/trace-format.md
 * @param {number} index which step is current
 * @param {string} source the user's code, for line text and parameter names
 * @param {{ nodeId?: string|null, frameId?: number|null, steps?: Array<string|null> }} [options]
 * @returns {Object}
 */
export function getStepView(trace, index, source = "", options = {}) {
  const { frameId = null, steps = null } = options;
  const list = Array.isArray(trace) ? trace : [];
  const indexOf = getTraceIndex(list);
  const event = list[index] ?? null;
  const kind = event?.event ?? null;
  const state = indexOf.stateAt(index);
  const top = topFrame(state);
  const currentFrameId = top?.frame_id ?? null;

  const isLine = kind === "line";
  const before = kind === "call" ? indexOf.stateAt(index - 1) : state;
  const after = isLine ? indexOf.sameFrameAfter(index, currentFrameId) : kind === "call" ? event : null;

  let changes = [];
  if (isLine && after) {
    changes = [
      ...variableChanges(before, after, event.line),
      ...slotChanges(before, after, namesById(after.frames, after.heap), event.line),
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
    kind === "return" && event.function !== MODULE && event.return_value
      ? showValue(event.return_value, event.heap)
      : null;
  const callStack = frames
    .map((frame, i) =>
      frameView(frame, state?.heap, paramsFor(source, frame.function), {
        depth: i,
        isTop: i === frames.length - 1,
        callNumber: numbers[i],
        returnValue: i === frames.length - 1 ? returnValue : null,
        lineText: sourceText(source, frame.line),
      }),
    )
    .reverse();
  // The status belongs to the real stack, not to which frame the learner has
  // selected: a waiting caller stays a waiting caller while you inspect it.
  callStack.forEach((entry, i) => {
    if (i > 0) {
      entry.status = "waiting";
      entry.waitingFor = callStack[i - 1];
    } else if (kind === "return") {
      entry.status = event.function === MODULE ? "completed" : "returning";
    } else if (kind === "exception" || kind === "unwind") {
      entry.status = "raising";
    } else {
      entry.status = "running";
    }
  });
  const selectedId = frameId ?? currentFrameId;
  const frame =
    callStack.find((entry) => entry.frameId === selectedId) ?? callStack[0] ?? null;
  // A selection only means anything while that call is still on the stack. Once
  // it returns, the view falls back to the live frame and says so, rather than
  // leaving the panels pointing at variables no frame holds any more.
  const selectionLost = frameId != null && !callStack.some((entry) => entry.frameId === frameId);

  const values = Object.fromEntries(
    (frame?.variables ?? []).map((entry) => [entry.name, entry.text]),
  );

  const nodeId = options.nodeId ?? (steps ? steps[index] ?? null : null);
  const printed = kind === "output" ? indexOf.printedLineAt(index)?.text ?? null : null;
  const line = event?.line || null;

  return {
    index,
    kind,
    event,
    function: top?.function ?? MODULE,
    frameId: currentFrameId,
    line,
    previousLine: indexOf.previousLineNumber(index),
    code: sourceLine(source, line),
    before,
    after,
    frame,
    selectionLost,
    callStack,
    frames,
    heap: state?.heap ?? {},
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

/** The real source text on `line`, for a frame card; never a guess. */
function sourceText(source, line) {
  if (!line) return null;
  return (source ?? "").split("\n")[line - 1]?.trim() ?? null;
}

/**
 * Every value change the program made, in step order: the Changes list and its
 * click-to-jump targets. One entry per changed variable or list slot.
 * @returns {Array<{ index: number, kind: string, name: string, from: string|null, to: string, line: number|null }>}
 */
export function changeLog(trace) {
  if (!Array.isArray(trace)) return [];
  const cached = CHANGE_LOG.get(trace);
  if (cached) return cached;
  const list = trace;
  const indexOf = getTraceIndex(list);
  const out = [];
  for (let i = 0; i < list.length; i += 1) {
    const event = list[i];
    if (event.event !== "line") continue;
    const after = indexOf.sameFrameAfter(i, event.frame_id);
    if (!after) continue;
    for (const change of variableChanges(event, after, event.line)) {
      out.push({ index: i, ...change });
    }
    for (const change of slotChanges(event, after, namesById(after.frames, after.heap), event.line)) {
      out.push({ index: i, ...change });
    }
  }
  CHANGE_LOG.set(trace, out);
  return out;
}

/**
 * The step to open on after a run that ended badly: the step that raised, so
 * the failing line is the one lit up. A syntax error never ran at all, so its
 * single event is the answer.
 * @returns {number} an index into `trace`, or 0
 */
export function errorStep(trace) {
  const list = Array.isArray(trace) ? trace : [];
  if (list.length === 0) return 0;
  // A run can contain a caught exception before the one that ended it, and an
  // exception that escapes a call is recorded once per frame while it unwinds.
  // Find the last exception, then walk back through its unwind chain to the
  // line that first raised it, which is the failing line the run reports.
  let last = -1;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i]?.event === "exception") {
      last = i;
      break;
    }
  }
  if (last < 0) return list.length - 1;

  const index = getTraceIndex(list);
  if (index.exceptionOutcome(last) !== "uncaught") return last;
  let origin = last;
  for (let i = last - 1; i >= 0; i -= 1) {
    const event = list[i];
    if (event?.event === "unwind") continue;
    if (event?.event === "exception" && index.exceptionOutcome(i) === "propagated") {
      origin = i;
      continue;
    }
    break;
  }
  return origin;
}

/**
 * The numeric value of a trace value, or null when it cannot honestly be put
 * on a number line. Booleans, big integers and nan/inf deliberately return
 * null: a chart that treats them as 0/1 or a gap would invent data.
 */
function numericValue(value) {
  if (!value || value.big || value.repr) return null;
  if (value.type !== "int" && value.type !== "float") return null;
  return typeof value.value === "number" && Number.isFinite(value.value) ? value.value : null;
}

/** One entry per value change, with the number when the value has one. */
function collectHistory(trace, name) {
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
      number: numericValue(value),
    });
  }
  return entries;
}

/**
 * How one variable changed over the whole run: the value it first held at each
 * step, and the line that put it there. Powers "watch this variable".
 * @returns {Array<{ index: number, line: number|null, value: string, function: string }>}
 */
export function variableHistory(trace, name) {
  return collectHistory(trace, name).map((entry) => ({
    index: entry.index,
    line: entry.line,
    value: entry.value,
    function: entry.function,
  }));
}

/**
 * The same history with `number` beside each value, for the Variables chart.
 * `number` is null for anything that is not a finite int/float.
 * @returns {Array<{ index: number, line: number|null, value: string, function: string, number: number|null }>}
 */
export function variableSeries(trace, name) {
  return collectHistory(trace, name);
}
