// The evaluator's contract: a tiny grammar, names only from the supplied
// environment, exact integer arithmetic, and null instead of an exception for
// everything else. These tests also pin the split between evaluating an
// expression and resolving it against a list's length.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { EVALUATOR_LIMITS, evaluateExpression, resolveIndex } from "./evaluate.js";

test("names and integer literals are the whole vocabulary", () => {
  assert.equal(evaluateExpression("i", { i: 3 }), 3);
  assert.equal(evaluateExpression("  i\t", { i: 3 }), 3);
  assert.equal(evaluateExpression("0"), 0);
  assert.equal(evaluateExpression("42"), 42);
  assert.equal(evaluateExpression("-7"), -7);
  assert.equal(evaluateExpression("- 7"), -7);
  assert.equal(evaluateExpression("mid + 1", { mid: 4 }), 5);
  assert.equal(evaluateExpression("(n)", { n: 2 }), 2);
});

test("operators follow Python precedence and associate to the left", () => {
  assert.equal(evaluateExpression("2 + 3 * 4"), 14);
  assert.equal(evaluateExpression("(2 + 3) * 4"), 20);
  assert.equal(evaluateExpression("20 - 5 - 3"), 12);
  assert.equal(evaluateExpression("100 // 5 // 2"), 10);
  assert.equal(evaluateExpression("2 * 3 + 4 * 5"), 26);
  assert.equal(evaluateExpression("i + j * 2", { i: 1, j: 5 }), 11);
  assert.equal(evaluateExpression("(i + j) * 2", { i: 1, j: 5 }), 12);
  assert.equal(evaluateExpression("-2 * 3"), -6);
  assert.equal(evaluateExpression("2 * -3"), -6);
  assert.equal(evaluateExpression("n - -2", { n: 5 }), 7);
});

test("// is floor division, as in Python", () => {
  assert.equal(evaluateExpression("7 // 2"), 3);
  assert.equal(evaluateExpression("-7 // 2"), -4);
  assert.equal(evaluateExpression("7 // -2"), -4);
  assert.equal(evaluateExpression("-7 // -2"), 3);
  assert.equal(evaluateExpression("6 // 3"), 2);
  assert.equal(evaluateExpression("0 // 5"), 0);
});

test("a unary minus is only a negative integer literal", () => {
  assert.equal(evaluateExpression("-1"), -1);
  assert.equal(evaluateExpression("-i", { i: 2 }), null, "-i is not in the grammar");
  assert.equal(evaluateExpression("-(1)"), null);
  assert.equal(evaluateExpression("--1"), null);
  assert.equal(evaluateExpression("- 1 + 2"), 1, "the literal is -1, then + 2");
});

test("names resolve only from the supplied environment", () => {
  assert.equal(evaluateExpression("i", {}), null);
  assert.equal(evaluateExpression("i"), null, "no environment means no names");
  assert.equal(evaluateExpression("3"), 3, "literals need no environment");
  assert.equal(evaluateExpression("i", { j: 1 }), null);
  const bare = Object.create(null);
  bare.n = 4;
  assert.equal(evaluateExpression("n", bare), 4, "a null-prototype environment works");
  // Prototype members and globals are not names the expression may read.
  for (const name of ["toString", "constructor", "__proto__", "valueOf", "hasOwnProperty"]) {
    assert.equal(evaluateExpression(name, {}), null, `${name} is not readable`);
  }
  for (const name of ["NaN", "Infinity", "undefined", "globalThis", "window", "Math", "process"]) {
    assert.equal(evaluateExpression(name, {}), null, `${name} is not readable`);
  }
});

test("an environment value must be a safe integer", () => {
  for (const value of [1.5, "3", true, false, null, undefined, NaN, Infinity, -Infinity, {}, [3]]) {
    assert.equal(evaluateExpression("x", { x: value }), null, `${String(value)} is not an index`);
  }
  assert.equal(evaluateExpression("x", { x: 2 ** 53 }), null, "an unsafe integer is not an index");
  assert.equal(evaluateExpression("x", { x: -(2 ** 53) }), null);
  assert.equal(evaluateExpression("x", { x: Number.MAX_SAFE_INTEGER }), Number.MAX_SAFE_INTEGER);
  assert.equal(evaluateExpression("x", null), null);
});

test("division by zero is null, not an exception", () => {
  assert.equal(evaluateExpression("1 // 0"), null);
  assert.equal(evaluateExpression("0 // 0"), null);
  assert.equal(evaluateExpression("i // j", { i: 9, j: 0 }), null);
  assert.equal(evaluateExpression("i // (j - j)", { i: 9, j: 2 }), null);
});

test("everything outside the grammar is refused", () => {
  const refused = [
    "",
    "   ",
    "\n",
    "i +",
    "* 2",
    "(i",
    "i)",
    "()",
    "i j",
    "i, j",
    "1.",
    "1.5",
    ".5",
    "1e3",
    "1_000",
    "0x10",
    "0b11",
    "'a'",
    '"a"',
    "f(1)",
    "a.b",
    "a[0]",
    "a[1:2]",
    "i ** 2",
    "i / 2",
    "i % 2",
    "i < 2",
    "i <= 2",
    "i == 2",
    "i != 2",
    "i and j",
    "i or j",
    "not i",
    "~i",
    "i++",
    "[1]",
    "{1}",
    "lambda: 1",
    "i if j else 0",
    "i?",
    "i\u00a0+ 1",
  ];
  for (const text of refused) {
    assert.equal(
      evaluateExpression(text, { i: 1, j: 2, a: 3, f: 4 }),
      null,
      `refused: ${JSON.stringify(text)}`,
    );
  }
});

test("a call is refused even when its name resolves to an integer", () => {
  const env = { f: 2, a: 1 };
  assert.equal(evaluateExpression("f(1)", env), null);
  assert.equal(evaluateExpression("(f)(1)", env), null);
  assert.equal(evaluateExpression("a(0)", env), null);
  assert.equal(evaluateExpression("a.b", env), null);
  assert.equal(evaluateExpression("a[0]", env), null);
});

test("results outside the safe integer range are refused, never rounded", () => {
  assert.equal(evaluateExpression("9007199254740991"), Number.MAX_SAFE_INTEGER);
  assert.equal(evaluateExpression("9007199254740992"), null);
  assert.equal(evaluateExpression("9007199254740991 + 1"), null);
  assert.equal(evaluateExpression("9007199254740991 * 2"), null);
  assert.equal(evaluateExpression("-9007199254740992"), null);
  assert.equal(evaluateExpression("(2 * 3) * 4503599627370496"), null);
  assert.equal(evaluateExpression("4503599627370496 + 4503599627370495"), Number.MAX_SAFE_INTEGER);
});

test("hostile input never throws", () => {
  const throwingEnv = {
    get x() {
      throw new Error("boom");
    },
  };
  const odd = [
    null,
    undefined,
    42,
    {},
    [],
    Symbol("i"),
    "i",
    "(".repeat(30) + "1" + ")".repeat(30),
    "1+" + "1+".repeat(400) + "1",
  ];
  for (const text of odd) {
    assert.doesNotThrow(() => evaluateExpression(text, { i: 1 }));
  }
  assert.equal(evaluateExpression("x", throwingEnv), null, "a throwing getter becomes null");
  assert.doesNotThrow(() => evaluateExpression("i", Symbol("env")));
});

test("the length and nesting limits are enforced", () => {
  const atLimit = "1+".repeat(99) + "1";
  assert.equal(atLimit.length, 199);
  assert.equal(evaluateExpression(atLimit), 100);
  const overLimit = "1+" + atLimit;
  assert.equal(overLimit.length, 201);
  assert.equal(overLimit.length > EVALUATOR_LIMITS.maxLength, true);
  assert.equal(evaluateExpression(overLimit), null);
  assert.equal(evaluateExpression("(".repeat(10) + "1" + ")".repeat(10)), 1);
  assert.equal(evaluateExpression("(".repeat(30) + "1" + ")".repeat(30)), null);
});

test("evaluation is deterministic and side-effect free", () => {
  const env = Object.freeze({ i: 2, j: 3 });
  const first = evaluateExpression("(i + j) * 2", env);
  const second = evaluateExpression("(i + j) * 2", env);
  assert.equal(first, second);
  assert.equal(first, 10);
  assert.deepEqual(env, { i: 2, j: 3 }, "the environment is not mutated");
  // No module-level memory: a different environment gives a different answer.
  assert.equal(evaluateExpression("i", { i: 9 }), 9);
  assert.equal(evaluateExpression("i", { i: 2 }), 2);
});

test("resolveIndex applies Python's negative and out-of-range rules", () => {
  assert.equal(resolveIndex(0, 3), 0);
  assert.equal(resolveIndex(2, 3), 2);
  assert.equal(resolveIndex(3, 3), null, "one past the end");
  assert.equal(resolveIndex(-1, 3), 2);
  assert.equal(resolveIndex(-3, 3), 0);
  assert.equal(resolveIndex(-4, 3), null);
  assert.equal(resolveIndex(0, 0), null, "an empty list has no cells");
  assert.equal(resolveIndex(1, -1), null);
  assert.equal(resolveIndex(1, 2.5), null);
  assert.equal(resolveIndex("1", 3), null);
  assert.equal(resolveIndex(1.5, 3), null);
  assert.equal(resolveIndex(NaN, 3), null);
  assert.equal(resolveIndex(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER), null);
  const zero = resolveIndex(-0, 3);
  assert.equal(zero, 0);
  assert.equal(Object.is(zero, 0), true, "a cell index is never negative zero");
});

test("evaluation knows nothing about list bounds; resolveIndex does", () => {
  // The expression is just an integer, even when no list of that length exists.
  assert.equal(evaluateExpression("-1"), -1);
  assert.equal(evaluateExpression("9"), 9);
  assert.equal(resolveIndex(9, 2), null);
  assert.equal(resolveIndex(evaluateExpression("-1"), 2), 1);
  // The evaluator has no length parameter; bounds are a second, explicit step.
  assert.equal(evaluateExpression.length, 1, "evaluateExpression(text, env)");
});

test("the source contains no dynamic code execution", () => {
  const source = readFileSync(new URL("./evaluate.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\beval\s*\(/, "no eval call");
  assert.doesNotMatch(source, /\bnew\s+Function\b/, "no Function constructor");
  assert.doesNotMatch(source, /\bFunction\s*\(/, "no Function call");
  assert.doesNotMatch(source, /\bsetTimeout\b|\bsetInterval\b/, "no deferred execution");
});
