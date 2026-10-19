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
    } else if (kind === "exception") {
      const targetId = extra?.frameId ?? stack[stack.length - 1]?.frame_id;
      event = {
        event: "exception",
        function: fn,
        frame_id: targetId,
        line,
        exception: { type: extra?.type ?? "ValueError", message: extra?.message ?? "boom" },
      };
    } else if (kind === "unwind") {
      const targetId = extra?.frameId ?? stack[stack.length - 1]?.frame_id;
      event = { event: "unwind", function: fn, frame_id: targetId, line };
      // Only the unwinding frame leaves the stack, and only after its event has
      // been snapshotted — the same order tracer.py records.
      if (stack.length > 0 && stack[stack.length - 1].frame_id === targetId) pop = true;
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

/**
 * `print(fail(1))` where fail() divides by zero: the exception is raised in
 * the child, then unwinds through both frames. Used to check that a failed
 * call reads as failed without inventing an edge the trace never recorded.
 */
export function boomTrace() {
  return buildTrace([
    ["call", "<module>", 1, { id: 1 }],
    ["line", "<module>", 1, {}],
    ["line", "<module>", 3, {}],
    ["call", "fail", 3, { id: 2, vars: { x: { type: "int", value: "1" } } }],
    ["line", "fail", 2, { vars: { x: { type: "int", value: "1" } } }],
    ["line", "fail", 3, { vars: { x: { type: "int", value: "1" } } }],
    [
      "exception",
      "fail",
      3,
      { frameId: 2, type: "ZeroDivisionError", message: "division by zero" },
    ],
    ["unwind", "fail", 3, { frameId: 2 }],
    ["unwind", "<module>", 3, { frameId: 1 }],
    ["error", "<module>", 3, {}],
  ]);
}

/**
 * Two separate calls to the same function — not recursion, so the tree has two
 * siblings under one parent:
 *
 *   double(2)      line 4
 *   double(3)      line 5
 */
export function repeatedTrace() {
  return buildTrace([
    ["call", "<module>", 1, { id: 1 }],
    ["line", "<module>", 1, {}],
    ["line", "<module>", 4, {}],
    ["call", "double", 4, { id: 2, vars: { n: { type: "int", value: "2" } } }],
    ["line", "double", 1, { vars: { n: { type: "int", value: "2" } } }],
    ["return", "double", 1, { value: 4 }],
    ["line", "<module>", 5, {}],
    ["call", "double", 5, { id: 3, vars: { n: { type: "int", value: "3" } } }],
    ["line", "double", 1, { vars: { n: { type: "int", value: "3" } } }],
    ["return", "double", 1, { value: 6 }],
    ["line", "<module>", 6, {}],
    ["return", "<module>", 6, {}],
  ]);
}

/** A run that never called a function: only the module frame itself. */
export function moduleOnlyTrace() {
  return buildTrace([
    ["call", "<module>", 1, { id: 1 }],
    ["line", "<module>", 1, {}],
    ["line", "<module>", 2, {}],
    ["return", "<module>", 2, {}],
  ]);
}
