// Unit tests for the plain-English teaching layer (src/tracer/explain.js).
// Traces are hand-built to match docs/trace-format.md, so the explainer can
// be tested without running Python.
//
//   node --test src/tracer/explain.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { CONCEPTS, conceptAt, explainStep, explainStepView, explainTransition, isNewConcept } from "./explain.js";

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

/** A state-carrying event built from an explicit list of frames (oldest first). */
function framesEvent(i, event, frames, { heap = {}, line = 1, returnValue = null } = {}) {
  const top = frames[frames.length - 1];
  return {
    step: i,
    event,
    function: top.function,
    frame_id: top.frame_id,
    line,
    return_value: returnValue,
    exception: null,
    exit_kind: null,
    frames,
    heap,
  };
}

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

// --- the three-part explanation card ---------------------------------------

const GREET_SOURCE = 'def greet(name):\n    print(name)\n\ngreet("Asha")\n';
const GREET_TRACE = [
  framesEvent(0, "call", [frame({})]),
  framesEvent(1, "line", [frame({ greet: { type: "function", name: "greet" } })], { line: 4 }),
  framesEvent(
    2,
    "call",
    [
      frame({ greet: { type: "function", name: "greet" } }),
      frame({ name: str("Asha") }, { fn: "greet", id: 2, call_line: 4, line: 1 }),
    ],
    { line: 1 },
  ),
  framesEvent(
    3,
    "line",
    [
      frame({ greet: { type: "function", name: "greet" } }),
      frame({ name: str("Asha") }, { fn: "greet", id: 2, call_line: 4, line: 2 }),
    ],
    { line: 2 },
  ),
  out(4, "Asha"),
  out(5, "\n"),
];

test("the card has a just-happened part, an about-to-happen part and a why-now part", () => {
  const view = explainStepView(GREET_TRACE, 3, GREET_SOURCE);
  assert.equal(view.justHappened, "Calls greet() with name = \"Asha\".");
  assert.equal(view.aboutToHappen, "This line prints Asha on the screen.");
  assert.equal(view.why, "greet() was just called, so its first line runs now.");
  assert.equal(view.concept, "print");
});

test("why-now names the call that started a function", () => {
  assert.equal(
    explainTransition(GREET_TRACE, 3, GREET_SOURCE),
    "greet() was just called, so its first line runs now.",
  );
  assert.equal(
    explainTransition(GREET_TRACE, 2, GREET_SOURCE),
    "line 4 calls greet(), so Python starts that function here.",
  );
});

test("why-now borrows the decision sentence when control jumps forward", () => {
  const source = "if x > 0:\n    y = 1\nprint(x)\n";
  const trace = [
    state(0, "call"),
    state(1, "line", { line: 1, variables: { x: int(-1) } }),
    state(2, "line", { line: 3, variables: { x: int(-1) } }),
  ];
  assert.equal(explainTransition(trace, 2, source), "-1 > 0 is False, so this branch is skipped.");
});

test("why-now explains a loop coming round again", () => {
  const source = "total = 0\nfor n in range(1, 6):\n    total = total + n\n";
  const trace = [
    state(0, "call"),
    state(1, "line", { line: 2, variables: { total: int(0) } }),
    state(2, "line", { line: 3, variables: { total: int(0), n: int(1) } }),
    state(3, "line", { line: 2, variables: { total: int(1), n: int(1) } }),
  ];
  assert.equal(
    explainTransition(trace, 3, source),
    "The loop body finished, so Python jumped back up to line 2 for the next round.",
  );
});

test("why-now explains a return handing a result back", () => {
  const trace = [
    state(0, "call"),
    state(1, "return", { fn: "fact", id: 2, return_value: int(120) }),
  ];
  assert.equal(
    explainTransition(trace, 1),
    "fact() reached a return, so its result goes back and the caller carries on.",
  );
});

test("a print line names the value it prints", () => {
  const source = "print(x)\n";
  const trace = [
    state(0, "call"),
    state(1, "line", { line: 1, variables: { x: int(7) } }),
    out(2, "7"),
    out(3, "\n"),
  ];
  assert.equal(explainStep(trace, 1, source).text, "This line prints 7 on the screen.");
});

test("an item assignment names the slot that changed and its new value", () => {
  const source = "xs[0] = 9\n";
  const before = { o1: { type: "list", items: [int(1), int(2)] } };
  const after = { o1: { type: "list", items: [int(9), int(2)] } };
  const trace = [
    state(0, "call"),
    state(1, "line", { line: 1, variables: { xs: { type: "ref", id: "o1" } }, heap: before }),
    state(2, "line", { line: 2, variables: { xs: { type: "ref", id: "o1" } }, heap: after }),
  ];
  assert.equal(explainStep(trace, 1, source).text, "Sets one item inside xs: xs[0] is now 9.");
  assert.equal(explainStep(trace, 1, source).concept, "index");
});

test("a call to a function that is already running is taught as recursion", () => {
  const source = "def fact(n):\n    return n * fact(n - 1)\n\nprint(fact(3))\n";
  const trace = [
    framesEvent(0, "call", [frame({})]),
    framesEvent(
      1,
      "call",
      [
        frame({}),
        frame({ n: int(3) }, { fn: "fact", id: 2, call_line: 4, line: 1 }),
        frame({ n: int(2) }, { fn: "fact", id: 3, call_line: 2, line: 1 }),
      ],
      { line: 1 },
    ),
  ];
  assert.equal(explainStep(trace, 1, source).text, "Calls fact() with n = 2.");
  assert.equal(explainStep(trace, 1, source).concept, "recursion");
});

test("just happened says a line called a function, not that the line finished", () => {
  const view = explainStepView(GREET_TRACE, 2, GREET_SOURCE);
  assert.equal(view.justHappened, "line 4 called greet().");
});

test("just happened at a failure says the line started, not that it printed", () => {
  const source = "nums = [1, 2, 3]\nprint(nums[10])\n";
  const trace = [
    framesEvent(0, "call", [frame({})]),
    framesEvent(1, "line", [frame({ nums: { type: "ref", id: "o1" } })], { line: 1 }),
    framesEvent(2, "line", [frame({ nums: { type: "ref", id: "o1" } })], { line: 2 }),
    { event: "exception", line: 2, frames: [frame({ nums: { type: "ref", id: "o1" } })], exception: { type: "IndexError", message: "list index out of range" } },
  ];
  const view = explainStepView(trace, 3, source);
  assert.equal(view.justHappened, "line 2 started running, and this is where it stopped.");
  assert.match(view.aboutToHappen, /Python stops with IndexError/);
});

test("just happened reports the value a finished call handed back", () => {
  const source = "def fact(n):\n    if n <= 1:\n        return 1\n    return n * fact(n - 1)\n";
  const inside = frame({ n: int(1) }, { fn: "fact", id: 2, call_line: 4, line: 3 });
  const trace = [
    framesEvent(0, "call", [frame({})]),
    framesEvent(1, "line", [inside], { line: 3 }),
    framesEvent(2, "return", [inside], { line: 3, returnValue: int(1) }),
  ];
  const view = explainStepView(trace, 2, source);
  assert.equal(view.justHappened, "line 3 handed back 1 from fact().");
  assert.match(view.why, /reached a return/);
});
