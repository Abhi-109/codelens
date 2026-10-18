// A tiny hand-written trace for the graph tests: the same shape the real tracer
// produces (docs/trace-format.md), so tests can state exactly what they mean
// without shipping a gzip fixture for every case.
//
//   def fact(n):                line 1
//       if n <= 1:              line 2
//           return 1            line 3
//       return n * fact(n - 1)  line 4
//
//   print(fact(2))              line 6

export const FACT_SOURCE = [
  "def fact(n):",
  "    if n <= 1:",
  "        return 1",
  "    return n * fact(n - 1)",
  "",
  "print(fact(2))",
].join("\n");

/** A frame in a synthesised trace, the same shape docs/trace-format.md uses. */
export function frame(id, fn, variables = {}, callLine = null) {
  return { frame_id: id, function: fn, line: null, call_line: callLine, variables };
}

/**
 * Builds a trace from short step descriptions, filling in the stack and heap the
 * way the tracer does: every state-carrying event carries all frames, and a
 * return event is recorded while the returning frame is still on the stack.
 *
 * @param {Array} steps [kind, function, line, extra] rows
 */
export function buildTrace(steps) {
  const trace = [];
  const heap = {};
  const stack = [];
  const value = (n) => ({ type: "int", value: String(n) });

  for (const [kind, fn, line, extra] of steps) {
    let event;
    let pop = false;
    if (kind === "call") {
      stack.push(frame(extra.id, fn, extra.vars ?? {}, line));
      event = { event: "call", function: fn, frame_id: extra.id, line };
    } else if (kind === "return") {
      const top = stack[stack.length - 1];
      event = {
        event: "return",
        function: top.function,
        frame_id: top.frame_id,
        line,
        return_value: extra?.value === undefined ? null : value(extra.value),
      };
      pop = true;
    } else if (kind === "line") {
      const top = stack[stack.length - 1];
      top.line = line;
      if (extra?.vars) top.variables = { ...top.variables, ...extra.vars };
      event = { event: "line", function: fn, frame_id: top.frame_id, line };
    } else {
      event = { event: kind, function: fn, frame_id: line, text: extra?.text ?? "" };
    }
    event.step = trace.length;
    event.frames = stack.map((f) => ({ ...f, variables: { ...f.variables } }));
    event.heap = heap;
    trace.push(event);
    if (pop) stack.pop();
  }
  return trace;
}

/** fact(2) calling itself once: six nodes, two calls, twelve steps. */
export function factTrace() {
  return buildTrace([
    ["call", "<module>", 1, { id: 1 }],
    ["line", "<module>", 1, {}],
    ["line", "<module>", 6, {}],
    ["call", "fact", 6, { id: 2, vars: { n: { type: "int", value: "2" } } }],
    ["line", "fact", 2, { vars: { n: { type: "int", value: "2" } } }],
    ["line", "fact", 4, { vars: { n: { type: "int", value: "2" } } }],
    ["call", "fact", 4, { id: 3, vars: { n: { type: "int", value: "1" } } }],
    ["line", "fact", 2, { vars: { n: { type: "int", value: "1" } } }],
    ["line", "fact", 3, { vars: { n: { type: "int", value: "1" } } }],
    ["return", "fact", 3, { value: 1 }],
    ["return", "fact", 4, { value: 2 }],
    ["line", "<module>", 6, {}],
    ["return", "<module>", 6, {}],
  ]);
}
