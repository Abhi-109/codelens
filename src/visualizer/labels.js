/**
 * Plain functions the inspector panels are built from.
 *
 * They live apart from the panel components so each module has one job - and
 * so React's fast refresh keeps working, which only holds while a file
 * exports components and nothing else.
 */

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

/** The variables list, switched between the before and after state. */
export function variableRows(view, showAfter) {
  const rows = (view.frame?.variables ?? []).map((entry) => ({ ...entry }));
  if (!showAfter) return rows;
  const byName = new Map(rows.map((row) => [row.name, row]));
  for (const change of view.changes) {
    if (change.kind === "slot" || change.kind === "new-slot") continue;
    const row = byName.get(change.name);
    if (row) row.text = change.to;
    else rows.push({ name: change.name, text: change.to, isArg: Boolean(change.arg) });
  }
  return rows;
}
