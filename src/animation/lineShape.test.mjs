// The shape parser's contract: recognize the spec's statement shapes from
// source syntax, refuse everything else with a reason, and never turn a
// lookalike into a movement shape. Runtime evidence is deliberately absent here;
// these tests only assert what the *source* can prove.

import assert from "node:assert/strict";
import { test } from "node:test";

import { SHAPE_KINDS, UNKNOWN_REASON, lineShape } from "./lineShape.js";

const shapeOf = (source, line = 1, env = null) => lineShape(source, line, { env });
const REASONS = Object.values(UNKNOWN_REASON);

function assertUnknown(source, line = 1, env = null) {
  const result = shapeOf(source, line, env);
  assert.equal(result.kind, "unknown", `expected unknown for ${JSON.stringify(source)}`);
  assert.ok(REASONS.includes(result.reason), `${result.reason} is a declared reason`);
  return result;
}

test("a two-cell swap is recognized from its syntax", () => {
  const result = shapeOf("a[i], a[j] = a[j], a[i]\n", 1, { i: 0, j: 1 });
  assert.deepEqual(
    { kind: result.kind, reason: result.reason, operator: result.operator, direction: result.direction },
    { kind: "swap", reason: null, operator: "=", direction: null },
  );
  assert.equal(result.statement.text, "a[i], a[j] = a[j], a[i]");
  assert.equal(result.statement.startLine, 1);
  assert.equal(result.statement.endLine, 1);
  assert.equal(result.targets.length, 2);
  assert.equal(result.sources.length, 2);
  assert.equal(result.targets[0].text, "a[i]");
  assert.equal(result.targets[0].base, "a");
  assert.equal(result.targets[0].tail, "subscript");
  assert.equal(result.targets[0].access[0].value, 0);
  assert.equal(result.targets[1].access[0].value, 1);
  assert.equal(result.sources[0].text, "a[j]");
  assert.equal(result.sources[1].text, "a[i]");
  assert.equal(result.args.length, 0);
});

test("a swap survives spacing, newlines and a parenthesised right side", () => {
  const spaced = shapeOf("a[ i ], a[ j ] = a[ j ], a[ i ]\n", 1, { i: 0, j: 1 });
  assert.equal(spaced.kind, "swap");
  assert.equal(spaced.targets[0].access[0].text, "i");
  assert.equal(spaced.targets[0].canonical, spaced.sources[1].canonical);

  const source = "a[i], a[j] = (\n    a[j],\n    a[i],\n)\n";
  const multiline = shapeOf(source, 1, { i: 0, j: 1 });
  assert.equal(multiline.kind, "swap");
  assert.equal(multiline.statement.startLine, 1);
  assert.equal(multiline.statement.endLine, 4);
  assert.equal(multiline.sources[1].text, "a[i]");

  // A swap needs no environment: values are then simply unknown.
  const bare = shapeOf("a[i], a[j] = a[j], a[i]\n");
  assert.equal(bare.kind, "swap");
  assert.equal(bare.targets[0].access[0].value, null);
});

test("only a same-container, reversed, two-cell assignment is a swap", () => {
  const unsupported = [
    "a[i], b[j] = b[j], a[i]", // different containers
    "a[i], a[j], a[k] = a[k], a[j], a[i]", // three targets
    "*a[i], a[j] = a[j], a[i]", // star target
    "a[i], a[j] = a[j]", // not a tuple on the right
    "a[i], a[j] = a[j], a[i], a[k]", // three sources
    "a[i], a[j] = a[i], a[j]", // copies in place, not a swap
    "o.x, o.y = o.y, o.x", // attributes, not cells
    "m[i][0], m[i][1] = m[i][1], m[i][0]", // nested subscripts
    "(a[i], a[j]) = (a[j], a[i])", // parenthesised targets
    "a[i], a[j] = b[j], a[i]", // one source on another container
  ];
  for (const source of unsupported) {
    const result = assertUnknown(`${source}\n`);
    assert.equal(result.reason, UNKNOWN_REASON.unsupported, source);
  }
  const ambiguous = assertUnknown("a[i], a[i] = a[i], a[i]\n");
  assert.equal(ambiguous.reason, UNKNOWN_REASON.ambiguous);
  const malformed = assertUnknown("a[i], a[j] += 1\n");
  assert.equal(malformed.reason, UNKNOWN_REASON.malformed);
});

test("an adjacent cell copy is a shift, with a direction from the indices", () => {
  const right = shapeOf("a[j + 1] = a[j]\n", 1, { j: 0 });
  assert.equal(right.kind, "shift");
  assert.equal(right.direction, "right");
  assert.equal(right.targets[0].access[0].value, 1);
  assert.equal(right.sources[0].access[0].value, 0);

  const left = shapeOf("a[j] = a[j + 1]\n", 1, { j: 0 });
  assert.equal(left.kind, "shift");
  assert.equal(left.direction, "left");

  // Adjacency is established by the evaluated indices, not by the spelling.
  assert.equal(shapeOf("a[i] = a[j]\n", 1, { i: 1, j: 0 }).direction, "right");
  assert.equal(shapeOf("a[i] = a[k]\n", 1, { i: 2, k: 3 }).direction, "left");
  assert.equal(shapeOf("a[i + 1] = a[k - 1]\n", 1, { i: 3, k: 4 }).kind, "shift");
  assert.equal(shapeOf("a[i + 1] = a[k - 1]\n", 1, { i: 3, k: 5 }).kind, "subscript-assign");
});

test("without an established adjacent pattern the copy is not a shift", () => {
  const cases = [
    ["a[j + 1] = a[j]\n", null], // no environment, so no indices
    ["a[i] = a[j]\n", { i: 5, j: 1 }], // not adjacent
    ["a[i] = a[i]\n", { i: 2 }], // same cell
    ["b[j + 1] = a[j]\n", { j: 0 }], // different containers
    ["a[j + 1] = a[j] + 1\n", { j: 0 }], // not a plain copy
    ["a[j + 1] = a[j][0]\n", { j: 0 }], // nested source
    ["a[j + 1:j + 3] = a[j]\n", { j: 0 }], // slice target
  ];
  for (const [source, env] of cases) {
    const result = shapeOf(source, 1, env);
    assert.notEqual(result.kind, "shift", source);
    assert.ok(["subscript-assign", "unknown"].includes(result.kind), source);
    if (result.kind === "unknown") assert.ok(REASONS.includes(result.reason), source);
  }
  assert.equal(shapeOf("a[i] = a[j]\n", 1, { i: 5, j: 1 }).kind, "subscript-assign");
  assert.equal(shapeOf("a[i] = a[j]\n", 1, { i: 5, j: 1 }).sources.length, 1);
});

test("a single subscript assignment carries its index and key", () => {
  const plain = shapeOf("a[0] = 9\n");
  assert.equal(plain.kind, "subscript-assign");
  assert.equal(plain.targets[0].text, "a[0]");
  assert.equal(plain.targets[0].access[0].value, 0);
  assert.equal(plain.targets[0].access[0].literal, null);

  const keyed = shapeOf("d['k'] = 1\n");
  assert.equal(keyed.kind, "subscript-assign");
  assert.equal(keyed.targets[0].access[0].literal, "str");
  assert.equal(keyed.targets[0].access[0].text, "'k'");
  assert.equal(keyed.targets[0].access[0].value, null);

  const nested = shapeOf("rows[0]['score'] = 5\n");
  assert.equal(nested.kind, "subscript-assign");
  assert.equal(nested.targets[0].access.length, 2);
  assert.equal(nested.targets[0].access[1].literal, "str");

  const negative = shapeOf("a[-1] = 0\n");
  assert.equal(negative.targets[0].access[0].value, -1);

  const slice = assertUnknown("a[1:3] = [1]\n");
  assert.equal(slice.reason, UNKNOWN_REASON.unsupported);

  const other = shapeOf("a[0] = b[0]\n");
  assert.equal(other.kind, "subscript-assign");
  assert.equal(other.sources.length, 0, "a copy from another container is not a source");
});

test("attribute assignment is its own shape", () => {
  for (const source of ["obj.x = 1", "self.tricks = []", "a[i].x = 1", "p.x = p.y"]) {
    const result = shapeOf(`${source}\n`);
    assert.equal(result.kind, "attribute-assign", source);
    assert.equal(result.targets[0].tail, "attr", source);
  }
});

test("augmented assignment records the operator and target", () => {
  const chip = shapeOf("x += 1\n");
  assert.equal(chip.kind, "augmented");
  assert.equal(chip.operator, "+=");
  assert.equal(chip.targets[0].tail, "name");

  const cell = shapeOf("a[i] += 2\n", 1, { i: 1 });
  assert.equal(cell.kind, "augmented");
  assert.equal(cell.targets[0].access[0].value, 1);

  assert.equal(shapeOf("obj.n //= 2\n").operator, "//=");
  assert.equal(shapeOf("a[j] **= 2\n").operator, "**=");
  assert.equal(shapeOf("count = count + 1\n").kind, "unknown", "a plain assignment is not augmented");
  assert.equal(shapeOf("count = count + 1\n").reason, UNKNOWN_REASON.notAMutation);
  assert.equal(assertUnknown("a[1:2] += [1]\n").reason, UNKNOWN_REASON.unsupported);
});

test("del names exactly one reference", () => {
  const cell = shapeOf("del scores[2]\n");
  assert.equal(cell.kind, "del");
  assert.equal(cell.targets[0].base, "scores");
  assert.equal(cell.targets[0].access[0].value, 2);
  assert.equal(cell.operator, "del");

  assert.equal(shapeOf("del d['k']\n").targets[0].access[0].literal, "str");
  assert.equal(shapeOf("del obj.attr\n").targets[0].tail, "attr");
  assert.equal(shapeOf("del x\n").targets[0].tail, "name");
  assert.equal(assertUnknown("del a[1:3]\n").reason, UNKNOWN_REASON.unsupported);
  assert.equal(assertUnknown("del a[i], a[j]\n").reason, UNKNOWN_REASON.unsupported);
  assert.equal(assertUnknown("del (a[0])\n").reason, UNKNOWN_REASON.unsupported);
  assert.equal(assertUnknown("del\n").reason, UNKNOWN_REASON.malformed);
});

test("append, insert and pop are recognized with their arity", () => {
  const append = shapeOf("a.append(3)\n");
  assert.equal(append.kind, "append");
  assert.deepEqual(append.args, ["3"]);
  assert.equal(append.targets[0].base, "a");
  assert.equal(append.operator, "append");

  const insert = shapeOf("a.insert(1, 9)\n");
  assert.equal(insert.kind, "insert");
  assert.deepEqual(insert.args, ["1", "9"]);

  assert.deepEqual(shapeOf("a.pop()\n").args, []);
  assert.deepEqual(shapeOf("a.pop(0)\n").args, ["0"]);
  assert.equal(shapeOf("d.pop('k')\n").kind, "pop");

  const nested = shapeOf("a[0].append('x')\n");
  assert.equal(nested.kind, "append");
  assert.equal(nested.targets[0].text, "a[0]");
  assert.deepEqual(nested.args, ["'x'"]);

  const attributeReceiver = shapeOf("self.tricks.append('sit')\n");
  assert.equal(attributeReceiver.kind, "append");
  assert.equal(attributeReceiver.targets[0].text, "self.tricks");

  assert.deepEqual(shapeOf("a.append(1,)\n").args, ["1"], "a trailing comma is allowed");
  assert.equal(assertUnknown("a.append()\n").reason, UNKNOWN_REASON.unsupported);
  assert.equal(assertUnknown("a.insert(1)\n").reason, UNKNOWN_REASON.unsupported);
  assert.equal(assertUnknown("a.pop(1, 2)\n").reason, UNKNOWN_REASON.unsupported);
  assert.equal(assertUnknown("a.append(,)\n").reason, UNKNOWN_REASON.malformed);
  assert.equal(
    assertUnknown("groups.setdefault('f', []).append('a')\n").reason,
    UNKNOWN_REASON.unsupported,
    "a call result is not a receiver",
  );
});

test("strings and comments cannot fake a shape", () => {
  const closers = shapeOf("a[']'] = 1\n");
  assert.equal(closers.kind, "subscript-assign");
  assert.equal(closers.targets[0].access[0].text, "']'");
  assert.equal(shapeOf("a['#'] = 2\n").kind, "subscript-assign");
  assert.equal(shapeOf("a['='] = 3\n").kind, "subscript-assign");
  assert.equal(shapeOf("a[';'] = 4\n").kind, "subscript-assign", "a ; inside a string is not a separator");
  assert.equal(shapeOf("a['('] = 5\n").kind, "subscript-assign");

  const method = shapeOf("a.append('a, b = b, a')\n");
  assert.equal(method.kind, "append");
  assert.deepEqual(method.args, ["'a, b = b, a'"]);

  assert.equal(shapeOf("s = 'a[i], a[j] = a[j], a[i]'\n").reason, UNKNOWN_REASON.notAMutation);
  assert.equal(shapeOf("print('del a[0]')\n").reason, UNKNOWN_REASON.notAMutation);
  assert.equal(shapeOf("a.append('a[i], a[j] = a[j], a[i]')\n").kind, "append");

  const commented = shapeOf("a[0] = 1  # a[1], a[2] = a[2], a[1]\n");
  assert.equal(commented.kind, "subscript-assign");
  assert.equal(commented.targets[0].access[0].value, 0);
  assert.equal(assertUnknown("# a[i], a[j] = a[j], a[i]\n").reason, UNKNOWN_REASON.outsideStatement);

  assert.equal(shapeOf("a.append(\"\"\"x\"\"\")\n").kind, "append");
  assert.equal(shapeOf("a.append(f'{x}')\n").kind, "append");
});

test("a misleading f-string never becomes a movement shape", () => {
  const result = shapeOf("a[f'{a[\"k\"]}'] = 1\n");
  assert.notEqual(result.kind, "swap");
  assert.notEqual(result.kind, "shift");
  assert.ok(["subscript-assign", "unknown"].includes(result.kind), result.kind);
  if (result.kind === "unknown") assert.ok(REASONS.includes(result.reason));
});

test("a multi-line statement is resolved as one unit", () => {
  const source = "def greet(name):\n    return 'hi ' + name\n\nresult = greet(\n    'Asha',\n)\nprint(result)\n";
  for (const line of [4, 5, 6]) {
    const result = shapeOf(source, line);
    assert.equal(result.statement.startLine, 4, `line ${line}`);
    assert.equal(result.statement.endLine, 6, `line ${line}`);
    assert.equal(result.reason, UNKNOWN_REASON.notAMutation, `line ${line}`);
  }

  const literal = "rows = [\n    1,\n    2,\n]\n";
  for (const line of [1, 2, 3, 4]) {
    const result = shapeOf(literal, line);
    assert.equal(result.statement.startLine, 1, `line ${line}`);
    assert.equal(result.statement.endLine, 4, `line ${line}`);
  }

  const continued = "total = first + \\\n    second\n";
  const backslash = shapeOf(continued, 2);
  assert.equal(backslash.statement.startLine, 1);
  assert.equal(backslash.statement.endLine, 2);
  assert.equal(backslash.statement.text, "total = first + \\\n    second");
});

test("a line that starts no statement is refused, not guessed", () => {
  const source = "x = 1\n\n# a comment\ny = 2\n";
  assert.equal(assertUnknown(source, 2).reason, UNKNOWN_REASON.outsideStatement);
  assert.equal(assertUnknown(source, 3).reason, UNKNOWN_REASON.outsideStatement);
  assert.equal(assertUnknown(source, 0).reason, UNKNOWN_REASON.outsideStatement);
  assert.equal(assertUnknown(source, 99).reason, UNKNOWN_REASON.outsideStatement);
  assert.equal(assertUnknown("", 1).reason, UNKNOWN_REASON.outsideStatement);
});

test("malformed syntax is malformed, never a shape", () => {
  const malformed = [
    "a[0] = (\n",
    "a[ = 1\n",
    "a[0] = 1)\n",
    "a[0] = 'unterminated\n",
    "a[i] = \n",
    "a[i], = 1\n",
  ];
  for (const source of malformed) {
    const result = assertUnknown(source);
    assert.equal(result.reason, UNKNOWN_REASON.malformed, source);
  }
  assert.equal(assertUnknown("a..b = 1\n").reason, UNKNOWN_REASON.unsupported);
});

test("a token the grammar cannot read is unsupported, never a shape", () => {
  // A number literal has to be a number; `1abc` is not, and a statement
  // containing it must not come back as a supported mutation.
  assert.equal(assertUnknown("a[0] = 1abc\n").reason, UNKNOWN_REASON.unsupported);
  assert.equal(assertUnknown("a[1abc] = 1\n").reason, UNKNOWN_REASON.unsupported);
  assert.equal(assertUnknown("a.append(1abc)\n").reason, UNKNOWN_REASON.unsupported);
  assert.equal(assertUnknown("a[0] = 1 + café\n").reason, UNKNOWN_REASON.unsupported);
  // Real Python numbers keep tokenizing.
  for (const source of ["a[0] = 0x1f", "a[0] = 1_000", "a[0] = 1.5e3", "a[0] = .5"]) {
    assert.equal(shapeOf(`${source}\n`).kind, "subscript-assign", source);
  }
});

test("chained assignments and semicolons are ambiguous, never partially recognized", () => {
  assert.equal(assertUnknown("a[i] = b[j] = 0\n").reason, UNKNOWN_REASON.ambiguous);
  assert.equal(assertUnknown("a[i] = 1; b[j] = 2\n").reason, UNKNOWN_REASON.ambiguous);
  assert.equal(assertUnknown("a.append(1); b.append(2)\n").reason, UNKNOWN_REASON.ambiguous);
  assert.equal(assertUnknown("a[i] = 1; a[j], a[k] = a[k], a[j]\n").reason, UNKNOWN_REASON.ambiguous);
  // The same tokens inside a string or brackets are not separators.
  assert.equal(shapeOf("a.append('x; y')\n").kind, "append");
  assert.equal(shapeOf("d['a;b'] = 1\n").kind, "subscript-assign");
});

test("comparisons, calls and control flow have no mutation shape", () => {
  const noShape = [
    "a[i] == 1",
    "a[i] <= 1",
    "a[i] != 1",
    "print(a)",
    "a.pop",
    "a.pop(0) + 1",
    "x = a.append(1)",
    "for i in a: pass",
    "return a[0]",
    "pass",
    "x = 1",
  ];
  for (const source of noShape) {
    const result = shapeOf(`${source}\n`);
    assert.equal(result.kind, "unknown", source);
    assert.equal(result.reason, UNKNOWN_REASON.notAMutation, source);
  }
  const suite = shapeOf("if x: a.append(1)\n");
  assert.equal(suite.kind, "unknown");
  assert.ok(REASONS.includes(suite.reason));
});

test("the result is pure, deterministic and JSON-safe", () => {
  const source = "a[i], a[j] = a[j], a[i]\n";
  const first = lineShape(source, 1, { env: { i: 0, j: 1 } });
  const second = lineShape(source, 1, { env: { i: 0, j: 1 } });
  assert.deepEqual(first, second);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
  assert.equal(source, "a[i], a[j] = a[j], a[i]\n", "the source is unchanged");
  // A different environment changes only the values, never the shape.
  const other = lineShape(source, 1, { env: { i: 4, j: 9 } });
  assert.equal(other.kind, first.kind);
  assert.equal(other.targets[0].access[0].value, 4);
});

test("every recognized kind is declared and every unknown carries a reason", () => {
  const declared = new Set(SHAPE_KINDS);
  const samples = [
    "a[i], a[j] = a[j], a[i]",
    "a[j + 1] = a[j]",
    "a[0] = 1",
    "obj.x = 1",
    "x += 1",
    "del a[0]",
    "a.append(1)",
    "a.insert(0, 1)",
    "a.pop()",
  ];
  for (const source of samples) {
    const result = shapeOf(`${source}\n`, 1, { j: 0 });
    assert.ok(declared.has(result.kind), `${source} -> ${result.kind}`);
  }
  assert.equal(declared.size, SHAPE_KINDS.length);
  for (const source of ["", "x = 1", "a[i] = b[j] = 0", "a[", "del a[1:2]"]) {
    const result = shapeOf(`${source}\n`);
    assert.equal(result.kind, "unknown");
    assert.ok(REASONS.includes(result.reason), `${source} -> ${result.reason}`);
  }
});
