/**
 * Plain functions the inspector panels are built from.
 *
 * They live apart from the panel components so each module has one job - and
 * so React's fast refresh keeps working, which only holds while a file
 * exports components and nothing else.
 */

import { DEFINED_TYPES } from "../tracer/stepView.js";
import { showValue } from "../tracer/values.js";

/** The learner's words for one step of the trace: a line, or the reason. */
export function stepLabel(event) {
  if (!event) return "end of the run";
  if (event.line) return `line ${event.line}`;
  const words = {
    output: "printing",
    input: "asking for input",
    call: `calling ${event.function}`,
    return: `returning from ${event.function}`,
    exception: "an error being raised",
    unwind: "an error leaving a call",
    step_limit: "the step limit",
    timeout: "the time limit",
    output_limit: "the output limit",
    error: "the run ending with an error",
  };
  return words[event.event] ?? event.event;
}

/** Rows read straight from one frame, with the same rules as the view. */
function frameRows(frame, heap, argNames) {
  const rows = [];
  for (const [name, value] of Object.entries(frame?.variables ?? {})) {
    if (DEFINED_TYPES.has(value?.type)) continue;
    rows.push({
      name,
      text: showValue(value, heap),
      type: value?.type ?? "?",
      refId: value?.type === "ref" ? value.id : null,
      isArg: argNames.has(name),
    });
  }
  return rows;
}

const isSlot = (change) =>
  change.kind === "slot" ||
  change.kind === "new-slot" ||
  change.kind === "removed-slot";

/** Changed names first, in their original order; everything else keeps its place. */
function changedFirst(rows, changes) {
  const names = new Set(changes.filter((change) => !isSlot(change)).map((change) => change.name));
  return [...rows.filter((row) => names.has(row.name)), ...rows.filter((row) => !names.has(row.name))];
}

/** The variables list, switched between the before and after state. */
export function variableRows(view, showAfter) {
  const frame = view.frame;
  const before = (frame?.variables ?? []).map((entry) => ({ ...entry }));
  if (!showAfter) return changedFirst(before, view.changes);

  // The after state is a whole snapshot, so a list that grew shows its real
  // contents instead of a stale copy. Fall back to the changes preview only
  // when there is no later state for this frame.
  const afterFrame = view.after?.frames?.find((entry) => entry.frame_id === frame?.frameId);
  if (afterFrame) {
    const argNames = new Set((frame?.args ?? []).map((arg) => arg.name));
    return changedFirst(frameRows(afterFrame, view.after.heap, argNames), view.changes);
  }

  const byName = new Map(before.map((row) => [row.name, row]));
  const removed = new Set();
  for (const change of view.changes) {
    if (isSlot(change)) continue;
    if (change.kind === "removed") {
      removed.add(change.name);
      continue;
    }
    const row = byName.get(change.name);
    if (row) row.text = change.to;
    else {
      const added = { name: change.name, text: change.to, isArg: Boolean(change.arg) };
      before.push(added);
      byName.set(added.name, added);
    }
  }
  return changedFirst(
    before.filter((row) => !removed.has(row.name)),
    view.changes,
  );
}

/**
 * Which call a name belongs to, in the learner's words: "global" for the
 * module, otherwise "local to fact(4)" from the frame's real argument values.
 */
export function scopeLabel(frame) {
  if (!frame) return "—";
  if (frame.function === "<module>") return "global";
  const args = (frame.args ?? []).map((arg) => arg.text).join(", ");
  return `local to ${frame.function}(${args})`;
}
