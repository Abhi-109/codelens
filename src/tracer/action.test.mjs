// The short "action" label every execution-graph node carries. These tests pin
// the vocabulary: a label must say what the line does in a few words, must come
// from the statement's *kind* rather than from any particular program, and must
// never be empty or say "undefined" — an unknown line still gets its own words.

import test from "node:test";
import assert from "node:assert/strict";

import { STATEMENT_KINDS, explainAction, statementKind } from "./explain.js";

const LINE_CASES = [
  // def / class / decorator
  ["def fact(n):", "def", "Define fact()"],
  ["async def fetch(url):", "async-def", "Define async fetch()"],
  ["@staticmethod", "decorator", "Decorate"],
  ["class Point:", "class", "Define class Point"],
  // imports
  ["import math", "import", "Import math"],
  ["from collections import deque", "import", "Import collections"],
  // branches
  ["if n <= 1:", "if", "Check n <= 1"],
  ["elif n == 2:", "elif", "Check n == 2"],
  ["else:", "else", "other branch"],
  // loops
  ["for i in range(3):", "for", "Loop over i"],
  ["for i, x in enumerate(xs):", "for", "Loop over i, x"],
  ["while n > 0:", "while", "loop condition"],
  ["break", "break", "Break"],
  ["continue", "continue", "Skip"],
  ["pass", "pass", "Do nothing"],
  // functions
  ["return n * fact(n - 1)", "return", "Return n * fact(n - 1)"],
  ["return", "return", "no value"],
  ["yield x * 2", "yield", "Produce"],
  // assignments
  ["x = 5", "assign", "Set x"],
  ["a, b = b, a", "assign", "Set a, b"],
  ["x: int = 5", "assign", "Set x"],
  ["total += 5", "augmented", "total += 5"],
  ["grid[1] = 9", "item-assign", "Change one item in grid"],
  ["counts[word] = counts[word] + 1", "item-assign", "Change one item in counts"],
  ["self.total = 0", "attr-assign", "Set self.total"],
  // calls and output
  ["print(fact(5))", "print", "Print"],
  ["math.sqrt(9)", "expression", "Call math.sqrt()"],
  ["nested(1)", "expression", "Call nested()"],
  // errors and cleanup
  ["try:", "try", "Try these lines"],
  ["except ValueError as e:", "except", "Handle the error"],
  ["finally:", "finally", "cleanup"],
  ["raise ValueError('no')", "raise", "Raise an error"],
  ["with open('f') as fh:", "with", "Open open"],
  ["del items[0]", "del", "Delete items"],
  ["assert x > 0", "assert", "Check x > 0"],
  ["global counter", "global", "Use the global counter"],
  ["match command:", "match", "Match command"],
  ["case 1:", "case", "Match this case"],
  ["await task", "await", "Wait for task"],
];

test("statementKind names the kind of every line it is given", () => {
  for (const [line, kind] of LINE_CASES) {
    assert.equal(statementKind(line), kind, `kind of ${JSON.stringify(line)}`);
  }
  // Every kind a rule can return must be declared, so the UI can rely on the set.
  for (const [, kind] of LINE_CASES) {
    assert.ok(STATEMENT_KINDS.includes(kind), `${kind} is declared in STATEMENT_KINDS`);
  }
});

test("explainAction gives a short verb phrase per statement kind", () => {
  for (const [line, , expected] of LINE_CASES) {
    const action = explainAction(
      { event: "line", line: 2, function: "<module>", frame_id: 1 },
      [],
      0,
      `x = 0\n${line}\n`,
    );
    assert.match(action, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `action for ${line}`);
    assert.ok(action.length <= 40, `"${action}" stays short`);
  }
});

test("explainAction reads the event type, not just the line", () => {
  const source = "def fact(n):\n    return n\nprint(fact(2))\n";
  const call = { event: "call", function: "fact", frame_id: 2, line: 1, frames: [{}] };
  const ret = { event: "return", function: "fact", frame_id: 2, return_value: { type: "int", value: 2 } };
  assert.equal(explainAction(call, [call], 0, source), "Call fact()");
  assert.equal(explainAction(ret, [ret], 0, source), "fact() returns");
  assert.equal(
    explainAction({ event: "call", function: "<module>", frame_id: 1 }, [], 0, source),
    "Start the program",
  );
  assert.equal(
    explainAction({ event: "exception", exception: { type: "ZeroDivisionError" } }, [], 0, source),
    "Stop: ZeroDivisionError",
  );
  assert.equal(explainAction({ event: "output", text: "hi\n" }, [], 0, source), "Print to the screen");
  assert.equal(explainAction({ event: "step_limit" }, [], 0, source), "Stopped to stay safe");
});

test("no line and no event still produce honest labels", () => {
  assert.equal(explainAction(null, [], 0, ""), "Start of the run");
  assert.equal(explainAction({ event: "line", line: 9 }, [], 0, "x = 1\n"), "Move on to the next line");
  assert.equal(explainAction({ event: "wat" }, [], 3, ""), "Step 4");
});

test("an unknown statement falls back to its own words, never to undefined", () => {
  const odd = ["~x", "4234 4", ":", "a b c d", "print", "=", "lambda: 1"];
  for (const line of odd) {
    const kind = statementKind(line);
    const action = explainAction({ event: "line", line: 1, frame_id: 1 }, [], 0, `${line}\n`);
    assert.ok(STATEMENT_KINDS.includes(kind), `${line} -> a declared kind`);
    assert.ok(action.length > 0, `${line} gets a label`);
    assert.doesNotMatch(action, /undefined|null|NaN|\[object/, `${line} label is readable`);
  }
});

test("labels never leak a frame id or a variable id", () => {
  const source = "value = compute(a)\n";
  const event = { event: "line", line: 1, function: "<module>", frame_id: 7 };
  const action = explainAction(event, [event], 0, source);
  assert.doesNotMatch(action, /\bo\d+\b|\bf\d+l\d+\b/, action);
});
