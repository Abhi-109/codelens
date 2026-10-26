// The facts the motion stage needs beyond the diff: what the program had
// printed at the cursor, the most recent recorded function return, and — only
// at the final step — how the run ended.
//
// Every field is derived from the trace or the run result at the same cursor,
// so a seek cannot show future output and a fresh editor cannot show a stale
// result. Nothing here invents a value the recording does not hold.

import { showValue } from "../../tracer/values.js";
import { outputAt } from "../output.js";

const ENDINGS = {
  ok: { id: "completed", label: "Completed" },
  completed: { id: "completed", label: "Completed" },
  step_limit: { id: "limit", label: "Step limit" },
  timeout: { id: "limit", label: "Timeout" },
  output_limit: { id: "limit", label: "Output limit" },
  engine_error: { id: "error", label: "Engine error" },
  internal_error: { id: "error", label: "Internal error" },
};

/**
 * The last recorded return from a named function at or before `index`.
 *
 * `<module>` is deliberately excluded: Python's top-level script hands back an
 * implicit None, which is a completion fact, not a result the learner asked
 * for. A return event carries the heap it was recorded against, so a returned
 * collection still prints its real contents.
 *
 * @param {Array} trace
 * @param {number} index
 * @returns {{index: number, function: string, text: string, valueType: string|null}|null}
 */
export function lastFunctionReturn(trace, index) {
  const list = Array.isArray(trace) ? trace : [];
  if (list.length === 0) return null;
  const last = Math.min(Math.max(Math.round(Number(index) || 0), 0), list.length - 1);
  for (let at = last; at >= 0; at -= 1) {
    const event = list[at];
    if (event?.event !== "return") continue;
    if (!event.function || event.function === "<module>") continue;
    const value = event.return_value ?? null;
    if (!value) continue;
    return {
      index: at,
      function: event.function,
      text: showValue(value, event.heap ?? {}),
      valueType: value.type ?? null,
    };
  }
  return null;
}

/** How the run ended, from the run result only. Never from the last event. */
function endingOf(result) {
  if (!result) return null;
  // The tracer records a crashed run as status "error" with error_type and
  // exception, while an engine failure carries a ready-made `error` object.
  const error =
    result.error ??
    (result.status === "error"
      ? {
          type: result.error_type ?? result.exception?.type ?? "Error",
          message: result.exception?.message ?? "",
          phase: result.error_phase ?? null,
        }
      : null);
  if (error) {
    const type = error.type ?? "Error";
    const syntax = type === "SyntaxError" || error.phase === "compile";
    return {
      id: syntax ? "syntax" : "error",
      label: syntax ? "Syntax error" : "Runtime error",
      detail: [type, error.message].filter(Boolean).join(": "),
    };
  }
  const known = ENDINGS[result.status];
  if (known) return known;
  if (!result.status) return ENDINGS.completed;
  // An unrecognised status is still a stop, not a success.
  return { id: "limit", label: String(result.status) };
}

/**
 * The stage's output and ending for one cursor.
 *
 * `ending` is null until the cursor reaches the last recorded step, so a
 * program that is still running is never given a final result.
 *
 * @param {Array} trace
 * @param {number} index
 * @param {{status?: string, error?: {type?: string, message?: string}}|null} result
 */
export function stageResult(trace, index, result = null) {
  const list = Array.isArray(trace) ? trace : [];
  if (list.length === 0) {
    return { index: 0, atEnd: false, output: "", lastReturn: null, ending: null };
  }
  const at = Math.min(Math.max(Math.round(Number(index) || 0), 0), list.length - 1);
  const atEnd = at === list.length - 1;
  return {
    index: at,
    atEnd,
    output: outputAt(list, at),
    lastReturn: lastFunctionReturn(list, at),
    ending: atEnd ? endingOf(result) : null,
  };
}
