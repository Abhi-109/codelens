// What each card in the execution graph says once a step is selected: the
// values that matter for the line, what this run changed, and where control
// goes next. Everything comes from the trace through getStepView, so a card can
// never disagree with the panels next to it.
//
// Pure: no React, so node --test can prove the labels are read from the run.

import { getStepView } from "../tracer/stepView.js";
import { showValue } from "../tracer/values.js";
import { edgeReason } from "./reasons.js";

/** The one reserved value line, in characters of the 12.5px UI font. */
export const VALUE_CHARS = 42;

/**
 * The trace steps at which each node's *line* actually ran, in order. Output
 * and return events leave the token where it is, so they are not counted.
 * @returns {Map<string, number[]>}
 */
export function nodeRunIndex(trace, graph) {
  const byId = new Map((graph?.nodes ?? []).map((node) => [node.id, node]));
  const runs = new Map();
  (graph?.steps ?? []).forEach((id, i) => {
    const node = byId.get(id);
    if (!node || trace?.[i]?.event !== "line" || trace[i].frame_id !== node.frameId) return;
    const list = runs.get(id) ?? [];
    list.push(i);
    runs.set(id, list);
  });
  return runs;
}

/** The last entry of `list` at or before `index`, or -1. */
export function lastAtOrBefore(list, index) {
  let found = -1;
  for (const entry of list ?? []) {
    if (entry > index) break;
    found = entry;
  }
  return found;
}

/**
 * One line of values for a card: what this run changed first, then the names the
 * code mentions, then the arguments. Overflow is counted, never hidden.
 * @returns {string} e.g. "n: 4 → 3, total = 10 (+2 more)"
 */
export function valueLine(view, node) {
  const entries = [];
  const seen = new Set();
  for (const change of view?.changes ?? []) {
    if (seen.has(change.name)) continue;
    seen.add(change.name);
    entries.push({
      name: change.name,
      rank: 0,
      // A slot or name that did not exist before reads "= value", not "? → value".
      text:
        change.kind === "new" || change.kind === "new-slot" || change.from === null
          ? `${change.name} = ${change.to}`
          : `${change.name}: ${change.from} → ${change.to}`,
    });
  }
  const code = node?.text ?? "";
  for (const variable of view?.frame?.variables ?? []) {
    if (seen.has(variable.name)) continue;
    seen.add(variable.name);
    entries.push({
      name: variable.name,
      rank: code.includes(variable.name) ? 1 : variable.isArg ? 2 : 3,
      text: `${variable.name} = ${variable.text}`,
    });
  }
  entries.sort((a, b) => a.rank - b.rank);

  const packed = [];
  let width = 0;
  for (const entry of entries) {
    const add = entry.text.length + (packed.length > 0 ? 2 : 0);
    if (width + add > VALUE_CHARS) break;
    packed.push(entry.text);
    width += add;
  }
  if (packed.length === 0 && entries.length > 0) {
    const first = entries[0].text;
    packed.push(first.length > VALUE_CHARS ? `${first.slice(0, VALUE_CHARS - 1)}…` : first);
  }
  const hidden = entries.length - packed.length;
  const text = packed.join(", ");
  return hidden > 0 ? `${text} (+${hidden} more)` : text;
}

/**
 * Where control goes after a node's run, and why: the next line, the reason for
 * the move, and — when the line returned — what it handed back.
 * @returns {{ reason: string|null, line: number|null, step: number|null, text: string }}
 */
export function nextStep(sample, node, graph, trace, options = {}) {
  const { source = "", nodesById = null } = options;
  const steps = graph?.steps ?? [];
  const find = (id) => nodesById?.get(id) ?? graph?.nodes?.find((n) => n.id === id) ?? null;

  let i = sample + 1;
  while (i < steps.length && steps[i] === node.id) i += 1;
  const nextId = i < steps.length ? steps[i] : null;
  const to = nextId ? find(nextId) : null;

  const next = trace?.[sample + 1] ?? null;
  const returns = next?.event === "return" && next.frame_id === node.frameId;
  if (returns) {
    const value = next.return_value ? showValue(next.return_value, next.heap) : null;
    const where = to && to.id !== node.id ? ` → line ${to.line}` : "";
    return {
      reason: "return",
      line: to?.line ?? null,
      step: i < steps.length ? i : null,
      text: `${value === null ? "returns nothing" : `returns ${value}`}${where}`,
    };
  }

  if (!to) {
    return { reason: null, line: null, step: null, text: "end of the run" };
  }
  const edge = graph.edges?.find((entry) => entry.from === node.id && entry.to === to.id) ?? null;
  const reason = edgeReason(edge ?? { kind: "next" }, find(node.id) ?? node, to, source);
  return {
    reason,
    line: to.line,
    step: i < steps.length ? i : null,
    text: `${reason} → line ${to.line}`,
  };
}

/**
 * Everything one card shows beyond its own code, for the selected step.
 * @returns {{ current: boolean, ahead: boolean, ran: number, values: string,
 *   foot: string, changed: boolean, sample: number }}
 */
export function cardBody(node, options = {}) {
  const {
    graph,
    trace = [],
    source = "",
    index = 0,
    mode = "beginner",
    usable = null,
    nodesById = null,
  } = options;
  const list = usable?.get(node.id) ?? [];
  const current = graph?.steps?.[index] === node.id;
  let sample = current ? index : lastAtOrBefore(list, index);
  if (sample < 0) sample = list[0] ?? -1;
  const body = {
    current,
    ahead: !current && sample > index,
    ran: list.length,
    values: "",
    foot: "",
    changed: false,
    sample,
    advanced: mode === "advanced",
  };
  if (sample < 0) return body;
  try {
    const view = getStepView(trace, sample, source, { steps: graph.steps });
    body.values = valueLine(view, node);
    body.changed = (view?.changes ?? []).length > 0;
    body.foot = nextStep(sample, node, graph, trace, { source, nodesById }).text;
  } catch {
    // A card without values is still a useful card: it keeps its code and action.
    body.values = "";
    body.foot = "";
  }
  return body;
}
