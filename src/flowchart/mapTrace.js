// Pure helpers over the flowchart *graph* (tracer-poc/flowchart.py, format
// version 2; see docs/flowchart-format.md). No React, no network, no Pyodide,
// so node --test can cover the mapping from trace events to chart nodes.
//
// The graph holds one chart per function, keyed by plain name, with
// module-level code keyed "<main>". The trace calls module-level code
// "<module>", so every lookup goes through the one translation below.

const MODULE = "<module>";
const MAIN = "<main>";

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
