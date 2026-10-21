// What the program had printed at one recorded step, plus the input and errors
// that the trace actually contains.
//
// The trace is the source of truth: output chunks are joined in event order and
// never re-wrapped, so spaces and line breaks are the program's own. Later
// output is kept separate rather than mixed into what has happened, and an
// exception is called "handled" only when the same frame really ran another
// line afterwards.

import { getTraceIndex } from "../tracer/traceIndex.js";

function listOf(trace) {
  return Array.isArray(trace) ? trace : [];
}

/** Everything printed at or before `index`, exactly as recorded. */
export function outputAt(trace, index) {
  return getTraceIndex(listOf(trace)).outputAt(index);
}

/**
 * Consecutive output chunks between two steps, grouped so clicking a printed
 * sentence jumps to the first trace event that produced it. Input events do not
 * break a group: they add no text of their own, and the echoed value belongs to
 * the same console line.
 */
export function outputSegments(trace, from, to) {
  return getTraceIndex(listOf(trace)).outputSegments(from, to);
}

/** The last unfinished line of a console, which is the prompt an input asked. */
export function promptOf(text) {
  const value = String(text ?? "");
  const at = value.lastIndexOf("\n");
  return at < 0 ? value : value.slice(at + 1);
}

/**
 * What happened to one `exception` event: `handled` when the same frame ran a
 * later line, `propagated` when the frame unwound and a caller then reported
 * the same exception, `uncaught` when the frame unwound and the run ended with
 * an error, and `raised` when the trace ends before either can be seen.
 */
export function exceptionOutcome(trace, index) {
  return getTraceIndex(listOf(trace)).exceptionOutcome(index);
}

/**
 * Every exception and final error the trace records, with the real message and
 * a jumpable index. No exception path is invented for a step that has none.
 */
export function exceptionEntries(trace) {
  return getTraceIndex(listOf(trace))
    .exceptions()
    .map((entry) => ({ ...entry }));
}

/** Every input the trace records, with the actual prompt and submitted value. */
export function inputEntries(trace) {
  return getTraceIndex(listOf(trace))
    .inputs()
    .map((entry) => ({ ...entry }));
}

/** The final error the result reports, even when the trace has no error event. */
export function finalError(trace, result) {
  const list = listOf(trace);
  const error = result?.error;
  if (!error) return null;
  const at = getTraceIndex(list).errorIndex();
  return {
    index: at >= 0 ? at : list.length > 0 ? list.length - 1 : null,
    event: "error",
    type: error.type ?? "Error",
    message: error.message ?? "",
    line: error.line ?? null,
    function: null,
    outcome: "uncaught",
    recorded: at >= 0,
  };
}

/**
 * The output panel's whole state: what has been printed, what comes later, the
 * inputs already used and the errors seen up to the current step.
 */
export function outputView(trace, index, result = null) {
  const list = listOf(trace);
  const indexOf = getTraceIndex(list);
  const last = Math.max(list.length - 1, 0);
  const at = Math.max(0, Math.min(Math.round(Number(index) || 0), last));
  const pastSegments = indexOf.outputSegments(0, at);
  const futureSegments = list.length > 0 ? indexOf.outputSegments(at + 1, last) : [];
  const inputs = indexOf.inputs();
  const recorded = indexOf.exceptions();
  const final = finalError(list, result);
  const errors =
    final && !recorded.some((entry) => entry.index === final.index && entry.event === "error")
      ? [...recorded, final]
      : recorded;
  return {
    index: at,
    hasTrace: list.length > 0,
    pastSegments,
    futureSegments,
    pastText: pastSegments.map((segment) => segment.text).join(""),
    futureText: futureSegments.map((segment) => segment.text).join(""),
    inputs: inputs.filter((entry) => entry.index <= at),
    futureInputs: inputs.filter((entry) => entry.index > at),
    errors: errors.filter((entry) => entry.index == null || entry.index <= at),
    futureErrors: errors.filter((entry) => entry.index != null && entry.index > at),
    finalError: final,
    status: result?.status ?? null,
  };
}
