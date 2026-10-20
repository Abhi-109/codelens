// Comparing two recorded steps, without inventing a state the trace does not
// contain.
//
// Everything here is a pure function over the same trace the rest of the
// workspace draws. A variable that is absent from a different frame is not
// called deleted; an object that is not in the later heap is not called
// destroyed; and an endpoint outside the trace is reported as unavailable
// instead of being silently moved.

import { stateAt } from "../tracer/stepView.js";
import { describeObject, showValue } from "../tracer/values.js";
import { objectLabel } from "../tracer/objects.js";
import { exceptionEntries, outputAt } from "./output.js";

const MODULE = "<module>";
const DEFINED_TYPES = new Set(["function", "class", "module"]);

const clamp = (value, lo, hi) => Math.min(Math.max(value, lo), hi);

function listOf(trace) {
  return Array.isArray(trace) ? trace : [];
}

function topFrame(state) {
  return state?.frames?.[state.frames.length - 1] ?? null;
}

function scopeOf(frame) {
  if (!frame) return null;
  return frame.function === MODULE ? "global" : frame.function;
}

function typeOf(value, heap) {
  if (!value) return null;
  if (value.type === "ref") return heap?.[value.id]?.type ?? "ref";
  return value.type;
}

function frameRows(frames) {
  return (frames ?? []).map((frame, depth) => ({
    frameId: frame.frame_id,
    function: frame.function,
    scope: scopeOf(frame),
    line: frame.line ?? null,
    callLine: frame.call_line ?? null,
    depth,
    variableCount: Object.entries(frame.variables ?? {}).filter(
      ([, value]) => !DEFINED_TYPES.has(value?.type),
    ).length,
  }));
}

/**
 * Variables from the top frame at each endpoint. Removal is only claimed when
 * both snapshots are the same frame; otherwise the name is "not comparable"
 * because it belongs to a different scope, which is a fact the trace shows.
 */
function compareVariables(stateA, stateB, frameA, frameB) {
  const varsA = frameA?.variables ?? {};
  const varsB = frameB?.variables ?? {};
  const sameFrame =
    frameA != null && frameB != null && frameA.frame_id === frameB.frame_id;
  const names = [...new Set([...Object.keys(varsA), ...Object.keys(varsB)])]
    .filter((name) => !DEFINED_TYPES.has(varsA[name]?.type) && !DEFINED_TYPES.has(varsB[name]?.type))
    .sort();

  return names.map((name) => {
    const valueA = varsA[name];
    const valueB = varsB[name];
    const textA = valueA ? showValue(valueA, stateA?.heap) : null;
    const textB = valueB ? showValue(valueB, stateB?.heap) : null;
    let status = "unchanged";
    if (valueA && valueB) {
      status =
        textA !== textB || JSON.stringify(valueA) !== JSON.stringify(valueB)
          ? "changed"
          : "unchanged";
    } else if (valueA) {
      status = sameFrame ? "removed" : "unavailable";
    } else {
      status = "added";
    }
    return {
      name,
      status,
      scopeA: scopeOf(frameA),
      scopeB: scopeOf(frameB),
      textA,
      textB,
      typeA: typeOf(valueA, stateA?.heap),
      typeB: typeOf(valueB, stateB?.heap),
      refA: valueA?.type === "ref" ? valueA.id : null,
      refB: valueB?.type === "ref" ? valueB.id : null,
      referenceChanged:
        valueA?.type === "ref" && valueB?.type === "ref" && valueA.id !== valueB.id,
    };
  });
}

/** Objects matched only by the trace's own stable object id, never by guesswork. */
function compareObjects(stateA, stateB) {
  const heapA = stateA?.heap ?? {};
  const heapB = stateB?.heap ?? {};
  const ids = [...new Set([...Object.keys(heapA), ...Object.keys(heapB)])].sort();
  return ids.map((id) => {
    const objectA = heapA[id];
    const objectB = heapB[id];
    const textA = objectA ? describeObject(objectA, heapA) : null;
    const textB = objectB ? describeObject(objectB, heapB) : null;
    let status = "unchanged";
    if (objectA && objectB) status = textA === textB ? "unchanged" : "changed";
    else if (objectA) status = "only-baseline";
    else status = "added";
    return {
      id,
      label: objectLabel(id, objectA ?? objectB),
      status,
      textA,
      textB,
      typeA: objectA?.type ?? null,
      typeB: objectB?.type ?? null,
    };
  });
}

function compareStack(stateA, stateB) {
  const framesA = frameRows(stateA?.frames);
  const framesB = frameRows(stateB?.frames);
  const idsA = new Set(framesA.map((frame) => frame.frameId));
  const idsB = new Set(framesB.map((frame) => frame.frameId));
  const topA = framesA[framesA.length - 1] ?? null;
  const topB = framesB[framesB.length - 1] ?? null;
  const entered = framesB.filter((frame) => !idsA.has(frame.frameId));
  const left = framesA.filter((frame) => !idsB.has(frame.frameId));
  const changed =
    framesA.length !== framesB.length || entered.length > 0 || left.length > 0;
  return {
    framesA,
    framesB,
    depthA: Math.max(framesA.length - 1, 0),
    depthB: Math.max(framesB.length - 1, 0),
    topA,
    topB,
    entered,
    left,
    status: changed ? "changed" : "unchanged",
  };
}

function compareOutput(trace, a, b) {
  const textA = outputAt(trace, a);
  const textB = outputAt(trace, b);
  if (textA === textB) {
    return { status: "unchanged", baselineText: textA, comparisonText: textB, addedText: "", removedText: "" };
  }
  if (textB.startsWith(textA)) {
    return {
      status: "added",
      baselineText: textA,
      comparisonText: textB,
      addedText: textB.slice(textA.length),
      removedText: "",
    };
  }
  if (textA.startsWith(textB)) {
    return {
      status: "removed",
      baselineText: textA,
      comparisonText: textB,
      addedText: "",
      removedText: textA.slice(textB.length),
    };
  }
  return {
    status: "changed",
    baselineText: textA,
    comparisonText: textB,
    addedText: "",
    removedText: "",
  };
}

function eventsBetween(trace, a, b) {
  const low = Math.min(a, b);
  const high = Math.max(a, b);
  const inputs = [];
  for (const entry of exceptionEntries(trace)) {
    if (entry.index > low && entry.index <= high) inputs.push(entry);
  }
  const inputEvents = [];
  for (let i = low + 1; i <= high; i += 1) {
    if (trace[i]?.event !== "input") continue;
    inputEvents.push({
      index: i,
      value: trace[i].text ?? "",
      line: trace[i].line ?? null,
    });
  }
  return { inputs: inputEvents, exceptions: inputs };
}

function endpoint(trace, index) {
  if (!Number.isInteger(index) || index < 0 || index >= trace.length) return null;
  const state = stateAt(trace, index);
  if (!state) return null;
  const stateIndex = trace.indexOf(state);
  const frame = topFrame(state);
  return {
    index,
    stateIndex: stateIndex >= 0 ? stateIndex : index,
    state,
    frame,
    scope: scopeOf(frame),
    function: frame?.function ?? null,
    line: state?.line ?? null,
    depth: Math.max((state.frames?.length ?? 0) - 1, 0),
  };
}

/**
 * The complete, deterministic comparison of two trace indices.
 *
 * @param {Array} trace the recorded trace
 * @param {number} a the baseline step index
 * @param {number} b the comparison step index
 * @returns {Object} a report the comparison panel can draw directly
 */
export function compareSteps(trace, a, b) {
  const list = listOf(trace);
  const report = {
    available: false,
    reason: null,
    a,
    b,
    equalIndices: a === b,
    baseline: null,
    comparison: null,
    variables: [],
    objects: [],
    stack: null,
    output: null,
    events: { inputs: [], exceptions: [] },
    summary: { different: false, changedVariables: 0 },
  };
  if (list.length === 0) {
    report.reason = "No execution steps have been recorded.";
    return report;
  }
  if (!Number.isInteger(a) || !Number.isInteger(b)) {
    report.reason = "Both comparison steps must be whole step numbers.";
    return report;
  }
  if (a < 0 || b < 0 || a >= list.length || b >= list.length) {
    report.reason = `That step is outside this trace (0 to ${list.length - 1}).`;
    return report;
  }

  const baseline = endpoint(list, a);
  const comparison = endpoint(list, b);
  if (!baseline || !comparison) {
    report.reason = "The trace does not record program state at one of these steps.";
    return report;
  }

  report.baseline = {
    index: baseline.index,
    stateIndex: baseline.stateIndex,
    scope: baseline.scope,
    function: baseline.function,
    line: baseline.line,
    depth: baseline.depth,
  };
  report.comparison = {
    index: comparison.index,
    stateIndex: comparison.stateIndex,
    scope: comparison.scope,
    function: comparison.function,
    line: comparison.line,
    depth: comparison.depth,
  };
  report.variables = compareVariables(
    baseline.state,
    comparison.state,
    baseline.frame,
    comparison.frame,
  );
  report.objects = compareObjects(baseline.state, comparison.state);
  report.stack = compareStack(baseline.state, comparison.state);
  report.output = compareOutput(list, a, b);
  report.events = eventsBetween(list, a, b);
  report.available = true;

  const changedVariables = report.variables.filter((row) =>
    ["added", "removed", "changed"].includes(row.status),
  ).length;
  const changedObjects = report.objects.filter((row) =>
    ["added", "changed", "only-baseline"].includes(row.status),
  ).length;
  report.summary = {
    changedVariables,
    changedObjects,
    different:
      changedVariables > 0 ||
      changedObjects > 0 ||
      report.stack.status === "changed" ||
      report.output.status !== "unchanged" ||
      report.events.inputs.length > 0 ||
      report.events.exceptions.length > 0,
  };
  return report;
}

/* --- Comparison mode's own state ----------------------------------------- */

/** Comparison mode starts closed, with both endpoints on the first step. */
export function initialComparison() {
  return { open: false, baseline: 0, comparison: 0 };
}

/**
 * Open comparison at "previous step vs this step". Only the open flag and the
 * two endpoints are set; the caller's playback step is never part of this state.
 */
export function openComparison(state, index, traceLength) {
  const last = Math.max((Number(traceLength) || 1) - 1, 0);
  const at = clamp(Math.round(Number(index) || 0), 0, last);
  return {
    ...(state ?? {}),
    open: true,
    baseline: Math.max(at - 1, 0),
    comparison: at,
  };
}

/** Choose one endpoint independently, clamped onto the recorded trace. */
export function setComparisonEndpoint(state, which, value, traceLength) {
  if (which !== "baseline" && which !== "comparison") return state;
  const last = Math.max((Number(traceLength) || 1) - 1, 0);
  const next = clamp(Math.round(Number(value) || 0), 0, last);
  if (!state) return { ...initialComparison(), open: true, [which]: next };
  if (state[which] === next) return state;
  return { ...state, [which]: next };
}

/** Leave comparison mode without touching the playback step or the endpoints. */
export function closeComparison(state) {
  if (!state?.open) return state ?? initialComparison();
  return { ...state, open: false };
}

/** Swap the two endpoints, so a reversed comparison can be read the other way. */
export function swapComparison(state) {
  if (!state || state.baseline === state.comparison) return state;
  return { ...state, baseline: state.comparison, comparison: state.baseline };
}
