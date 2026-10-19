// The layer that answers one question honestly: *where in this chart is the
// token right now?* Every answer is read from the trace, never inferred, so
// the diagram can say "the run has not reached this box" and mean it.
//
// Three ideas, all of them small:
//
//   mapSteps     one entry per trace step, naming the chart it happened in and
//                the node that chart gives that source line. A step with no
//                chart — a call into a function the program does not define,
//                for instance — is recorded as unmapped rather than being
//                pointed at the nearest box that happens to look plausible.
//   nextEdge     which arrow the token actually took out of the node it is on,
//                by looking at where the token next landed *in this chart*.
//                That is what makes a Yes/No label real instead of decorative.
//   jumpToNode   the first step at which a box was reached, so clicking a box
//                can go there. Returns null for a box this run never entered.

import { MAIN, chartFor, nodeForLine } from "./mapTrace.js";

const MODULE = "<module>";

/** A trace reports module-level code as `<module>`; the graph keys it `<main>`. */
export function chartKeyOf(name) {
  return name === MODULE ? MAIN : name;
}

/**
 * The chart a frame belongs to, with **no** fallback. The canvas wants a
 * fallback so a frame is never blank; the mapping layer must not have one,
 * because falling back would draw the token somewhere the token never was.
 */
function exactChart(flow, name) {
  return flow?.functions?.[chartKeyOf(name)] ?? null;
}

function entryNode(chart) {
  return chart?.nodes?.find((node) => node.id === chart.entry) ?? null;
}

/** The chart and node a single trace event lands on, or null if none. */
function locate(flow, event, name) {
  const chart = exactChart(flow, name);
  if (!chart) return null;
  // A `call` is the moment the token crosses into a function, so it lands on
  // that function's Start — not on the first statement, which belongs to the
  // statement that made the call.
  if (event.event === "call") {
    const node = entryNode(chart);
    return node ? { chart, node } : null;
  }
  const node = nodeForLine(chart, event.line);
  return node ? { chart, node } : null;
}

/**
 * One entry per trace step: which chart it happened in, which node the chart
 * gives that line, and whether that resolved at all.
 *
 * @param {Object} flow the flowchart graph (format version 2)
 * @param {Array} trace the trace from docs/trace-format.md
 * @returns {Array<{index:number, event:string|null, chartKey:string|null,
 *   line:number|null, nodeId:string|null, kind:string|null, frameId:number|null}>}
 */
export function mapSteps(flow, trace) {
  if (!flow?.functions || !Array.isArray(trace)) return [];
  const steps = [];
  for (let index = 0; index < trace.length; index += 1) {
    const event = trace[index];
    const name = event?.function ?? (index > 0 ? trace[index - 1]?.function : MODULE);
    const located = locate(flow, event, name);
    steps.push({
      index,
      event: event?.event ?? null,
      chartKey: located ? chartKeyOf(name) : null,
      line: event?.line ?? null,
      nodeId: located?.node.id ?? null,
      kind: located?.node.kind ?? null,
      frameId: event?.frame_id ?? null,
    });
  }
  return steps;
}

/** The charts the run entered, in the order it first entered them. */
export function chartOrder(steps) {
  const order = [];
  const seen = new Set();
  for (const step of steps ?? []) {
    if (!step.chartKey || seen.has(step.chartKey)) continue;
    seen.add(step.chartKey);
    order.push(step.chartKey);
  }
  return order;
}

/** The boxes this chart's run reached — the ones that may be clicked. */
export function executedNodes(steps, chartKey) {
  const set = new Set();
  for (const step of steps ?? []) {
    if (step.chartKey === chartKey && step.nodeId) set.add(step.nodeId);
  }
  return set;
}

/** The arrows this chart's run really travelled, as `from>to` pairs. */
export function traversedEdges(steps, chartKey) {
  const set = new Set();
  let previous = null;
  for (const step of steps ?? []) {
    if (step.chartKey !== chartKey) {
      previous = null;
      continue;
    }
    if (!step.nodeId) continue;
    // A `call` is the token crossing *into* a function, which no arrow in this
    // chart draws — and two returns one after the other belong to two
    // different invocations, not to an arrow between their boxes.
    const sameFrame =
      previous != null &&
      (previous.frameId == null || step.frameId == null || previous.frameId === step.frameId);
    if (step.event !== "call" && sameFrame && previous.nodeId !== step.nodeId) {
      set.add(`${previous.nodeId}>${step.nodeId}`);
    }
    previous = step;
  }
  return set;
}

/** Two steps follow one arrow only when they are the same call, one box apart. */
function sameFrame(here, step) {
  if (here.frameId == null || step.frameId == null) return true;
  return here.frameId === step.frameId;
}

/** Where the token landed next *inside this chart*, skipping any call it made. */
function nextNodeIn(steps, fromIndex) {
  const from = steps[fromIndex];
  if (from.chartKey == null) return null;
  for (let i = fromIndex + 1; i < steps.length; i += 1) {
    const step = steps[i];
    if (step.chartKey !== from.chartKey || step.nodeId == null) continue;
    if (!sameFrame(from, step)) continue;
    if (step.nodeId === from.nodeId) continue;
    return step.nodeId;
  }
  return null;
}

/**
 * The arrow the token took out of the node it is on at `index` — the one that
 * makes a Yes/No label true — or null when the trace does not support an
 * answer: the token left through an exception, the run ended here, or the
 * destination is not a node this chart draws.
 *
 * @param {Object} chart the chart being drawn, for its edge list
 * @param {Array} steps from mapSteps
 * @param {number} index the current trace step
 * @returns {{index:number, edge:Object}|null}
 */
export function outgoingEdge(chart, steps, index) {
  const here = steps?.[index];
  if (!here?.nodeId || !chart) return null;
  const to = nextNodeIn(steps, index);
  if (!to || to === here.nodeId) return null;
  const at = (chart.edges ?? []).findIndex((edge) => edge.from === here.nodeId && edge.to === to);
  if (at < 0) return null;
  return { index: at, edge: chart.edges[at] };
}

/**
 * The first step at which `chartKey`'s run was on `nodeId`, so clicking a box
 * can go there. Null for a box the run never reached.
 */
export function jumpToNode(steps, chartKey, nodeId) {
  const at = (steps ?? []).findIndex(
    (step) => step.chartKey === chartKey && step.nodeId === nodeId,
  );
  return at >= 0 ? at : null;
}

/** The node the exception was raised on, when the step really is an exception. */
export function raisingNodeId(steps, index) {
  const step = steps?.[index];
  return step && step.event === "exception" ? (step.nodeId ?? null) : null;
}

export { chartFor };
