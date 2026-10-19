// Pure helpers over the flowchart *graph* (tracer-poc/flowchart.py, format
// version 2; see docs/flowchart-format.md). No React, no network, no Pyodide,
// so `node --test` can cover the mapping from trace events to chart nodes.
//
// The graph holds one chart per function, keyed by plain name, with
// module-level code keyed "<main>". The trace reports module-level code
// "<module>", so every lookup goes through the one translation below.

import { MODULE } from "./executionGraph.js";

export const MAIN = "<main>";

/**
 * The chart to draw for a frame. The trace reports module-level code as
 * "<module>"; the graph keys it as "<main>". An unknown name falls back to the
 * module chart, so a frame with no chart of its own is never blank.
 * @param {Object} flow the flowchart graph (format version 2)
 * @param {string} functionName the current frame's function name
 * @returns {Object|null} the chart, or null when there is no graph at all
 */
export function chartFor(flow, functionName) {
  const functions = flow?.functions;
  if (!functions) return null;
  const key = functionName === MODULE ? MAIN : functionName;
  return functions[key] ?? functions[MAIN] ?? null;
}

/**
 * The chart whose key is `key`, or the module chart. Used by the canvas's
 * function strip, which names charts directly rather than through a frame.
 */
export function chartByKey(flow, key) {
  const functions = flow?.functions;
  if (!functions) return null;
  return functions[key] ?? functions[MAIN] ?? null;
}

/**
 * The node whose `lines` range contains `line`. The graph builder guarantees
 * ranges never overlap within one chart, so this is a single lookup; the
 * `start` / `end` nodes carry `lines: null` and therefore never match.
 * @param {Object} chart one chart from the graph
 * @param {number} line a 1-based source line
 * @returns {Object|null} the node, or null when no node owns the line
 */
export function nodeForLine(chart, line) {
  if (!chart || line == null) return null;
  for (const node of chart.nodes ?? []) {
    const range = node.lines;
    if (!Array.isArray(range) || range.length < 2) continue;
    const [start, end] = range;
    if (start != null && end != null && line >= start && line <= end) return node;
  }
  return null;
}

/**
 * The node anywhere in the graph that owns `line`.
 *
 * `lines` are real source lines, so a line belongs to exactly one node across
 * the whole program — a function's body is drawn in the function's chart and
 * nowhere else. The one documented exception is a redefined function, whose
 * two charts are keyed `name` and `name#2` while the trace calls both `name`;
 * callers that have a frame should prefer {@link nodeForLine} with that
 * frame's chart, and use this only as a fallback.
 */
export function nodeForSourceLine(flow, line) {
  if (!flow?.functions || line == null) return null;
  for (const chart of Object.values(flow.functions)) {
    const node = nodeForLine(chart, line);
    if (node) return { chart, node };
  }
  return null;
}

/**
 * Every chart in the graph, module first and the rest in the order the source
 * defines them — the order the graph builder produced, which is source order.
 */
export function chartList(flow) {
  const functions = flow?.functions;
  if (!functions) return [];
  const rest = Object.keys(functions).filter((key) => key !== MAIN);
  return functions[MAIN] ? [MAIN, ...rest] : rest;
}
