// Unit tests for the plain-English teaching layer (src/tracer/explain.js).
// Traces are hand-built to match docs/trace-format.md, so the explainer can
// be tested without running Python.
//
//   node --test src/tracer/explain.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { CONCEPTS, conceptAt, explainStep, isNewConcept } from "./explain.js";

// --- trace builders ---------------------------------------------------------

const int = (value) => ({ type: "int", value });
const str = (value) => ({ type: "str", value });

function frame(variables, { fn = "<module>", id = 1, line = 1, call_line = null } = {}) {
  return { frame_id: id, function: fn, call_line, line, variables };
}

/** Builds a state-carrying event (call, line, return, exception, unwind). */
function state(i, event, { variables = {}, heap = {}, line = 1, fn = "<module>", id = 1, ...rest } = {}) {
  return {
    step: i,
    event,
    function: fn,
    frame_id: id,
    line,
    return_value: null,
    exception: null,
    exit_kind: null,
    frames: [frame(variables, { fn, id, line })],
    heap,
    ...rest,
  };
}

const out = (i, text) => ({ step: i, event: "output", text, frame_id: 1, line: 1 });

// --- the tests --------------------------------------------------------------

test("module call starts the program", () => {
  const trace = [state(0, "call")];
  assert.equal(explainStep(trace, 0).text, "The program starts running, from the very top.");
});

test("module return ends the program", () => {
  const trace = [state(0, "call"), state(1, "return")];
  assert.equal(explainStep(trace, 1).text, "The program finishes. That is the whole run!");
});

test("empty trace (before any run) gets a friendly placeholder", () => {
  assert.match(explainStep([], 0).text, /Run your code/);
});

test("a new variable is created with its value", () => {
  const source = "x = 5\n";
  const trace = [
    state(0, "call"),
    state(1, "line", { line: 1, variables: {} }),
    state(2, "line", { line: 2, variables: { x: int(5) } }), // pretend a line 2 follows
  ];
  assert.equal(explainStep(trace, 1, source).text, "x is created with the value 5.");
});

test("a changed variable reports the old and new values", () => {
  const source = "total = total + n\n";
  const trace = [
    state(0, "call"),
    state(1, "line", { line: 1, variables: { total: int(10), n: int(5) } }),
    state(2, "line", { line: 1, variables: { total: int(15), n: int(5) } }),
  ];
  assert.equal(explainStep(trace, 1, source).text, "total changes from 10 to 15.");
});

test("augmented assignment says what it adds and the new value", () => {
  const source = "total += n\n";
  const trace = [
    state(0, "call"),
    state(1, "line", { line: 1, variables: { total: int(10), n: int(5) } }),
    state(2, "line", { line: 1, variables: { total: int(15), n: int(5) } }),
  ];
  assert.equal(explainStep(trace, 1, source).text, "Adds 5 to total; it is now 15.");
});

test("a true if-branch says the condition is True", () => {
  const source = "if x > 0:\n    y = 1\n";
  const trace = [
    state(0, "call"),
    state(1, "line", { line: 1, variables: { x: int(1) } }),
    state(2, "line", { line: 2, variables: { x: int(1) } }),
  ];
  assert.equal(explainStep(trace, 1, source).text, "1 > 0 is True, so this branch runs.");
});

test("a false if with no else says the branch is skipped", () => {
  const source = "if x > 0:\n    y = 1\nprint(x)\n";
  const trace = [
    state(0, "call"),
    state(1, "line", { line: 1, variables: { x: int(-1) } }),
    state(2, "line", { line: 3, variables: { x: int(-1) } }),
  ];
  assert.equal(explainStep(trace, 1, source).text, "-1 > 0 is False, so this branch is skipped.");
});

test("a false if with an else points at the else branch", () => {
  const source = "if x > 0:\n    y = 1\nelse:\n    y = 2\n";
  const trace = [
    state(0, "call"),
    state(1, "line", { line: 1, variables: { x: int(-1) } }),
    state(2, "line", { line: 4, variables: { x: int(-1) } }), // jumps into the else body
  ];
  assert.equal(explainStep(trace, 1, source).text, "-1 > 0 is False, so the else branch runs instead.");
});

test("for-loop first round, next round, and end", () => {
  const source = "total = 0\nfor n in range(1, 6):\n    total = total + n\n";
  const trace = [
    state(0, "call"),
    state(1, "line", { line: 2, variables: { total: int(0) } }),
    state(2, "line", { line: 3, variables: { total: int(0), n: int(1) } }),
    state(3, "line", { line: 2, variables: { total: int(1), n: int(1) } }),
    state(4, "line", { line: 3, variables: { total: int(1), n: int(2) } }),
    state(5, "line", { line: 2, variables: { total: int(3), n: int(5) } }),
    state(6, "line", { line: 4, variables: { total: int(15) } }), // loop var is deleted at the end
  ];
  assert.equal(explainStep(trace, 1, source).text, "The loop starts: n is now 1.");
  assert.equal(explainStep(trace, 3, source).text, "Next round of the loop: n becomes 2.");
  assert.equal(explainStep(trace, 5, source).text, "The loop found no more items, so it stops here.");
});

test("while loop reports the condition each check", () => {
  const source = "count = 2\nwhile count > 0:\n    count -= 1\n";
  const trace = [
    state(0, "call"),
    state(1, "line", { line: 2, variables: { count: int(2) } }),
    state(2, "line", { line: 3, variables: { count: int(2) } }),
    state(3, "line", { line: 2, variables: { count: int(1) } }),
    state(4, "line", { line: 3, variables: { count: int(1) } }),
    state(5, "line", { line: 2, variables: { count: int(0) } }),
    state(6, "return"),
  ];
  assert.equal(explainStep(trace, 1, source).text, "The while loop checks its condition: 2 > 0 is True, so the loop begins.");
  assert.equal(explainStep(trace, 3, source).text, "The while loop checks again: 1 > 0 is True, so another round begins.");
  assert.equal(explainStep(trace, 5, source).text, "The while loop checks 0 > 0 one last time; the loop ends here.");
});

test("a call shows the values the function received", () => {
  const source = "def greet(name):\n    print(name)\n\ngreet(\"Asha\")\n";
  const trace = [
    state(0, "call"),
    state(1, "call", { fn: "greet", id: 2, line: 1, variables: { name: str("Asha") } }),
  ];
  assert.equal(explainStep(trace, 1, source).text, 'Calls greet() with name = "Asha".');
});

test("a return names the function and its value", () => {
  const trace = [
    state(0, "call"),
    state(1, "return", { fn: "fact", id: 2, return_value: int(120) }),
  ];
  assert.equal(explainStep(trace, 1).text, "fact() hands back 120.");
});

test("output says what was printed", () => {
  const trace = [state(0, "call"), out(1, "15\n")];
  assert.equal(explainStep(trace, 1).text, "The program prints: 15");
});

test("append says what was added to which list", () => {
  const source = 'fruits.append("cherry")\n';
  const heap = { o1: { type: "list", items: [str("apple"), str("banana")] } };
  const trace = [
    state(0, "call"),
    state(1, "line", { line: 1, variables: { fruits: { type: "ref", id: "o1" } }, heap }),
    state(2, "line", { line: 2, variables: { fruits: { type: "ref", id: "o1" } }, heap }),
  ];
  assert.equal(explainStep(trace, 1, source).text, 'Adds "cherry" to the end of fruits.');
});

test("a swap line inside a list is recognised", () => {
  const source = "numbers[j], numbers[j + 1] = numbers[j + 1], numbers[j]\n";
  const trace = [
    state(0, "call"),
    state(1, "line", { line: 1, variables: { numbers: { type: "ref", id: "o1" } } }),
    state(2, "line", { line: 1, variables: { numbers: { type: "ref", id: "o1" } } }),
  ];
  assert.match(explainStep(trace, 1, source).text, /Swaps two neighbouring items inside numbers\./);
});

test("exceptions and limit stops explain themselves", () => {
  const exception = [state(0, "call"), state(1, "exception", {
    exception: { type: "ZeroDivisionError", message: "division by zero" },
  })];
  assert.equal(
    explainStep(exception, 1).text,
    "Python stops with ZeroDivisionError: division by zero",
  );

  const limited = [
    state(0, "call"),
    { step: 1, event: "step_limit", message: "too many steps", limit: 1500 },
  ];
  assert.match(explainStep(limited, 1).text, /endless loop/);
});

test("def and class lines explain that nothing runs yet", () => {
  const source = "def fact(n):\n    return n\n\nclass Dog:\n    pass\n";
  const trace = [
    state(0, "call"),
    state(1, "line", { line: 1, variables: {} }),
    state(2, "line", { line: 1, variables: { n: int(1) }, fn: "fact", id: 2 }),
    state(3, "line", { line: 4, variables: {} }),
  ];
  assert.match(explainStep(trace, 1, source).text, /Defines a function named fact\./);
  assert.match(explainStep(trace, 3, source).text, /Defines a class named Dog\b/);
});

test("every rule emits a non-empty sentence and a known concept", () => {
  const source = [
    "def fact(n):",
    "    if n <= 1:",
    "        return 1",
    "    return n * fact(n - 1)",
    "",
    "numbers = [4, 2]",
    "numbers[0], numbers[1] = numbers[1], numbers[0]",
    "print(fact(5))",
  ].join("\n");
  const trace = [
    state(0, "call"),
    state(1, "line", { line: 1, variables: {} }),
    state(2, "call", { fn: "fact", id: 2, line: 1, variables: { n: int(5) } }),
    state(3, "line", { line: 2, variables: { n: int(5) }, fn: "fact", id: 2 }),
    state(4, "line", { line: 4, variables: { n: int(5) }, fn: "fact", id: 2 }),
    state(5, "return", { fn: "fact", id: 2, return_value: int(120) }),
    state(6, "line", { line: 6, variables: {} }),
    state(7, "line", { line: 7, variables: { numbers: { type: "ref", id: "o1" } } }),
    state(8, "line", { line: 8, variables: { numbers: { type: "ref", id: "o1" } } }),
    out(9, "120\n"),
    state(10, "return"),
    { step: 11, event: "timeout", message: "time limit", limit: 5 },
  ];
  for (let i = 0; i < trace.length; i += 1) {
    const { text, concept } = explainStep(trace, i, source);
    assert.ok(text.length > 0, `step ${i} has no text`);
    if (concept) assert.ok(concept in CONCEPTS, `step ${i} has unknown concept ${concept}`);
  }
});

test("a concept card shows only on the first step that introduces it", () => {
  const source = "x = 1\ny = 2\n";
  const trace = [
    state(0, "call"),
    state(1, "line", { line: 1, variables: {} }),
    state(2, "line", { line: 2, variables: { x: int(1) } }),
    state(3, "line", { line: 3, variables: { x: int(1), y: int(2) } }),
  ];
  assert.equal(conceptAt(trace, 1, source), "variable");
  assert.equal(isNewConcept(trace, 1, source, "variable"), true);
  assert.equal(isNewConcept(trace, 2, source, "variable"), false);
  assert.equal(isNewConcept(trace, 2, source, "loop"), true);
  assert.equal(isNewConcept(trace, 2, source, null), false);
});
