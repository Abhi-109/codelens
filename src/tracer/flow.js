// Pure helpers over the flowchart JSON (tracer.py: build_flowchart) and the
// trace: which chart to show, where the current step is, and how many times
// each block ran. No React here, so node --test can cover this logic.

/** The flowchart for the function currently on top of the stack, else the module's. */
export function flowFor(flow, functionName) {
  const functions = flow?.functions ?? {};
  return functions[functionName] ?? functions["<module>"] ?? null;
}

/** How many times each source line ran, for one function. */
export function runsByLine(trace, functionName) {
  const runs = new Map();
  for (const event of trace) {
    if (event.event !== "line" || event.function !== functionName) continue;
    runs.set(event.line, (runs.get(event.line) ?? 0) + 1);
  }
  return runs;
}

function childrenOf(node) {
  if (node.kind === "loop") return node.body ?? [];
  if (node.kind === "branch") return (node.arms ?? []).flatMap((arm) => arm.body ?? []);
  return [];
}

/**
 * The chain of nodes containing `line`, outermost first (branch or loop
 * first, then the innermost statement). Empty when the line is not drawn.
 */
export function pathToLine(nodes, line, path = []) {
  if (line == null) return [];
  for (const node of nodes) {
    const start = node.line;
    const end = node.end_line ?? node.line;
    if (start == null || line < start || line > end) continue;
    const chain = [...path, node];
    const deeper = pathToLine(childrenOf(node), line, chain);
    return deeper.length > 0 ? deeper : chain;
  }
  return [];
}

/** Run count for a node's badge: its own line for statements and loops. */
export function countFor(node, runs) {
  if (node.kind === "branch") {
    return (node.arms ?? []).reduce(
      (sum, arm) => sum + (arm.line != null ? (runs.get(arm.line) ?? 0) : 0),
      0,
    );
  }
  return runs.get(node.line) ?? 0;
}
