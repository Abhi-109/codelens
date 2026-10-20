// The timeline's pure rows: one real trace step per row, with the source line,
// the event's own words, the variables the snapshot holds, and the output
// printed so far. The table virtualises these rows; it never invents a step to
// fill space and never hides the current one behind a filter.

import { changeLog } from "../tracer/stepView.js";
import { showValue } from "../tracer/values.js";

const DEFINED_TYPES = new Set(["function", "class", "module"]);

/** Fixed row height, shared by the table, the virtual window and the tests. */
export const TIMELINE_ROW_HEIGHT = 34;
export const TIMELINE_OVERSCAN = 6;

function sourceLines(source) {
  return String(source ?? "").split("\n");
}

function clipText(text, max = 80) {
  const value = String(text ?? "").replace(/\s+/g, " ").trimEnd();
  return value.length > max ? `…${value.slice(-max)}` : value;
}

function variablesAt(frame, heap) {
  return Object.entries(frame?.variables ?? {})
    .filter(([, value]) => !DEFINED_TYPES.has(value?.type))
    .map(([name, value]) => ({ name, text: showValue(value, heap) }));
}

function kindOf(event, code, changed) {
  if (event?.event === "call") return "call";
  if (event?.event === "return") return "return";
  if (event?.event === "output") return "output";
  if (event?.event === "input") return "input";
  if (["exception", "unwind", "error"].includes(event?.event)) return "error";
  if (event?.event === "step_limit" || event?.event === "timeout" || event?.event === "output_limit") {
    return "error";
  }
  if (event?.event !== "line") return event?.event ?? "step";
  if (/^(for|while)\b/.test(code)) return "loop";
  if (/^(if|elif|else)\b/.test(code)) return "branch";
  if (changed) return "mutation";
  return "line";
}

function labelOf(event, kind, code, changes) {
  if (kind === "call") {
    return event.function === "<module>" ? "start" : `call ${event.function}()`;
  }
  if (kind === "return") return `return ${event.function}()`;
  if (kind === "output") return "print";
  if (kind === "input") return "input";
  if (kind === "error") {
    return event.exception?.type ?? event.type ?? (event.event === "unwind" ? "unwind" : "error");
  }
  if (kind === "loop") return "loop";
  if (kind === "branch") return "branch";
  if (kind === "mutation") {
    const names = changes.map((change) => change.name);
    return names.length > 2 ? `change ${names.slice(0, 2).join(", ")} +` : `change ${names.join(", ")}`;
  }
  if (event?.event !== "line") return event?.event ?? "step";
  if (!code) return "start";
  return "step";
}

function codeOf(event, lineText, label) {
  if (event?.event === "line") return lineText || label;
  if (event?.event === "output") return String(event.text ?? "").trim() || "(blank output)";
  if (event?.event === "input") return `input() → ${String(event.text ?? "")}`;
  if (event?.event === "call") return `${event.function}()`;
  if (event?.event === "return") return `${event.function}()`;
  if (event?.event === "exception") return event.exception?.message ?? event.exception?.type ?? "";
  if (event?.event === "error") return [event.type, event.message].filter(Boolean).join(": ");
  if (event?.event === "unwind") return "exception leaves this call";
  return label;
}

/**
 * One row per recorded step. The state used is the state at that step (the last
 * event that carried frames), and the output column is a short tail of what had
 * really been printed; the Output inspector keeps the exact text.
 */
export function timelineRows(trace, source = "") {
  const list = Array.isArray(trace) ? trace : [];
  const lines = sourceLines(source);
  const changes = changeLog(list);
  const byIndex = new Map();
  for (const change of changes) {
    const group = byIndex.get(change.index) ?? [];
    group.push(change);
    byIndex.set(change.index, group);
  }

  let state = null;
  let printed = "";
  return list.map((event, index) => {
    if (event?.frames?.length) state = event;
    if (event?.event === "output") printed += event.text ?? "";
    const line = event?.line > 0 ? event.line : null;
    const lineText = line ? (lines[line - 1] ?? "").trim() : "";
    const rowChanges = byIndex.get(index) ?? [];
    const variables = variablesAt(state?.frames?.[state.frames.length - 1], state?.heap);
    const kind = kindOf(event, lineText, rowChanges.length > 0);
    const label = labelOf(event, kind, lineText, rowChanges);
    const code = codeOf(event, lineText, label);
    return {
      index,
      step: index + 1,
      line,
      event: event?.event ?? null,
      kind,
      label,
      code,
      codeTitle: code,
      variables,
      variablesText: variables.map((entry) => `${entry.name} = ${entry.text}`).join(" · "),
      output: clipText(printed),
      outputTitle: printed,
      printedLength: printed.length,
      changes: rowChanges,
      changed: rowChanges.length > 0,
      // Anything that is not a plain unchanged line is worth seeing when the
      // "only changes" filter is on.
      notable: event?.event !== "line" || rowChanges.length > 0,
    };
  });
}

/**
 * The visible slice for a fixed-height virtual list. Overscan keeps a fast
 * scroll from flashing blank rows, and the returned pads let the spacer stand
 * at the full height without drawing every row.
 */
export function visibleRange(count, scrollTop, height) {
  const total = Math.max(Number(count) || 0, 0);
  const top = Math.max(Number(scrollTop) || 0, 0);
  const view = Math.max(Number(height) || TIMELINE_ROW_HEIGHT, TIMELINE_ROW_HEIGHT);
  const first = Math.floor(top / TIMELINE_ROW_HEIGHT);
  const start = Math.max(first - TIMELINE_OVERSCAN, 0);
  const end = Math.min(
    total,
    Math.ceil((top + view) / TIMELINE_ROW_HEIGHT) + TIMELINE_OVERSCAN,
  );
  return {
    start,
    end,
    topPad: start * TIMELINE_ROW_HEIGHT,
    bottomPad: Math.max(total - end, 0) * TIMELINE_ROW_HEIGHT,
  };
}

/**
 * The scroll offset that keeps one row inside a measured viewport. A hidden
 * pane has no height, so it has no target: scrolling it would move the list
 * behind the learner's back and leave the virtual window out of step with the
 * DOM. The component only calls this when the scroller is visible.
 */
export function scrollTarget(position, scrollTop, height) {
  const row = Math.max(Number(position) || 0, 0);
  const top = Math.max(Number(scrollTop) || 0, 0);
  const view = Number(height) || 0;
  if (!(view > 0)) return null;
  const first = row * TIMELINE_ROW_HEIGHT;
  const last = first + TIMELINE_ROW_HEIGHT;
  if (first < top) return first;
  if (last > top + view) return last - view;
  return top;
}

/**
 * Apply the "only changes" filter without ever hiding the step being played:
 * a filtered timeline with no current row would contradict the rest of the
 * workspace.
 */
export function filterTimelineRows(rows, onlyChanges, keepIndex = null) {
  const list = Array.isArray(rows) ? rows : [];
  if (!onlyChanges) return list;
  return list.filter((row) => row.notable || row.index === keepIndex);
}
