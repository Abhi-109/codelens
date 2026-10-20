// What the program had printed at one recorded step, plus the input and errors
// that the trace actually contains.
//
// The trace is the source of truth: output chunks are joined in event order and
// never re-wrapped, so spaces and line breaks are the program's own. Later
// output is kept separate rather than mixed into what has happened, and an
// exception is called "handled" only when the same frame really ran another
// line afterwards.

function listOf(trace) {
  return Array.isArray(trace) ? trace : [];
}

/** Everything printed at or before `index`, exactly as recorded. */
export function outputAt(trace, index) {
  const list = listOf(trace);
  let out = "";
  const last = Math.min(Math.max(Number(index) || 0, 0), list.length - 1);
  for (let i = 0; i <= last; i += 1) {
    if (list[i]?.event === "output") out += list[i].text ?? "";
  }
  return out;
}

/**
 * Consecutive output chunks between two steps, grouped so clicking a printed
 * sentence jumps to the first trace event that produced it. Input events do not
 * break a group: they add no text of their own, and the echoed value belongs to
 * the same console line.
 */
export function outputSegments(trace, from, to) {
  const list = listOf(trace);
  const start = Math.max(Number(from) || 0, 0);
  const end = Math.min(Number.isFinite(Number(to)) ? Number(to) : list.length - 1, list.length - 1);
  const segments = [];
  let open = null;
  for (let i = start; i <= end; i += 1) {
    const event = list[i];
    if (event?.event === "output") {
      if (!open) open = { at: i, line: event.line ?? null, text: "", events: [] };
      open.text += event.text ?? "";
      open.events.push(i);
    } else if (event?.event !== "input") {
      if (open) {
        segments.push(open);
        open = null;
      }
    }
  }
  if (open) segments.push(open);
  return segments;
}

/** The last unfinished line of a console, which is the prompt an input asked. */
export function promptOf(text) {
  const value = String(text ?? "");
  const at = value.lastIndexOf("\n");
  return at < 0 ? value : value.slice(at + 1);
}

/**
 * What happened to one `exception` event: `handled` when the same frame ran a
 * later line, `uncaught` when the frame unwound or the run ended with an error,
 * and `raised` when the trace ends before either can be seen.
 */
export function exceptionOutcome(trace, index) {
  const list = listOf(trace);
  const event = list[index];
  if (!event || event.event !== "exception") return "raised";
  for (let i = index + 1; i < list.length; i += 1) {
    const next = list[i];
    if (next.event === "line" && next.frame_id === event.frame_id) return "handled";
    if (next.event === "unwind" && next.frame_id === event.frame_id) return "uncaught";
    if (next.event === "error") return "uncaught";
  }
  return "raised";
}

/**
 * Every exception and final error the trace records, with the real message and
 * a jumpable index. No exception path is invented for a step that has none.
 */
export function exceptionEntries(trace) {
  const list = listOf(trace);
  const entries = [];
  for (let i = 0; i < list.length; i += 1) {
    const event = list[i];
    if (event?.event === "exception") {
      entries.push({
        index: i,
        event: "exception",
        type: event.exception?.type ?? "Exception",
        message: event.exception?.message ?? "",
        line: event.line ?? null,
        function: event.function ?? null,
        outcome: exceptionOutcome(list, i),
      });
    } else if (event?.event === "error") {
      entries.push({
        index: i,
        event: "error",
        type: event.type ?? "Error",
        message: event.message ?? "",
        line: event.line ?? null,
        function: null,
        outcome: "uncaught",
      });
    }
  }
  return entries;
}

/** Every input the trace records, with the actual prompt and submitted value. */
export function inputEntries(trace) {
  const list = listOf(trace);
  const entries = [];
  for (let i = 0; i < list.length; i += 1) {
    if (list[i]?.event !== "input") continue;
    entries.push({
      index: i,
      value: list[i].text ?? "",
      prompt: promptOf(outputAt(list, i)),
      line: list[i].line ?? null,
    });
  }
  return entries;
}

/** The final error the result reports, even when the trace has no error event. */
export function finalError(trace, result) {
  const list = listOf(trace);
  const error = result?.error;
  if (!error) return null;
  const at = list.findIndex((event) => event.event === "error");
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
  const last = Math.max(list.length - 1, 0);
  const at = Math.max(0, Math.min(Math.round(Number(index) || 0), last));
  const pastSegments = outputSegments(list, 0, at);
  const futureSegments = list.length > 0 ? outputSegments(list, at + 1, last) : [];
  const inputs = inputEntries(list);
  const errors = exceptionEntries(list);
  const final = finalError(list, result);
  if (final && !errors.some((entry) => entry.index === final.index && entry.event === "error")) {
    errors.push(final);
  }
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
