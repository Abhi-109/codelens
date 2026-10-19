// The teaching layer must teach *any* program, not the seven bundled examples.
//
// explain.js, stepView.js, values.js, objects.js, flow.js and the graph must
// describe a line from its statement kind and the trace — never from a name
// that happens to appear in one of the examples. This test reads the string
// literals in those files (comments are ignored) and fails if a program-specific
// word shows up, because that is the shape every "it works on the demo" bug
// takes.
//
//   node --test src/tracer/no-example-hardcoding.test.mjs

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// This file lives at src/tracer/, so the repository root is two levels up.
const ROOT = fileURLToPath(new URL("../..", import.meta.url));

// Words that belong to particular programs, taken from the bundled examples
// (App.jsx EXAMPLES) and the corpus (tracer-poc/corpus.py). None of them may
// appear in a string the teaching layer builds its explanations from.
const PROGRAM_WORDS = [
  "fact",
  "merge_sort",
  "merge",
  "bubble",
  "quicksort",
  "fibonacci",
  "fruits",
  "Rex",
  "Asha",
  "Ravi",
  "Meera",
  "Dog",
  "Animal",
  "marks",
  "grade",
  "Liftoff",
  "tricks",
  "make_adder",
  "is_even",
  "is_odd",
  "quadruple",
  "TooBig",
  "Counter",
];

/** The teaching layer: what a step, a value and a card are made of. */
const DIRS = [
  { dir: join(ROOT, "src", "tracer"), exts: [".js"] },
  { dir: join(ROOT, "src", "flowchart"), exts: [".js", ".jsx"] },
];

const isTestFile = (name) => name.endsWith(".test.mjs");
const isFixture = (name) => name.includes("__fixtures__");

function teachingFiles() {
  const out = [];
  for (const { dir, exts } of DIRS) {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (isTestFile(name) || isFixture(name)) continue;
      if (!exts.includes(name.slice(name.lastIndexOf(".")))) continue;
      out.push({ name, text: readFileSync(path, "utf8") });
    }
  }
  return out;
}

/**
 * Every quoted string in a JavaScript source, with comments skipped: a comment
 * that shows sample wording (`// name them like "rex.tricks"`) is documentation,
 * not a value the program builds. A small scanner rather than a regex, so a
 * quote inside a comment or a `//` inside a string cannot fool it.
 */
function stringLiterals(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === "/" && next === "/") {
      const end = text.indexOf("\n", i);
      if (end < 0) break;
      i = end;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = text.indexOf("*/", i);
      if (end < 0) break;
      i = end + 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === "\\") j += 2;
        else if (text[j] === ch) break;
        else j += 1;
      }
      out.push(text.slice(i + 1, j));
      i = j + 1;
      continue;
    }
    i += 1;
  }
  return out;
}

test("the teaching layer exists to be scanned", () => {
  const files = teachingFiles();
  assert.ok(files.length >= 6, `${files.length} files scanned`);
  assert.ok(files.some((file) => file.name === "explain.js"));
  assert.ok(files.some((file) => file.name === "stepView.js"));
  assert.ok(files.some((file) => file.name === "executionGraph.js"));
});

test("no explanation, value or card is written for a particular example", () => {
  const violations = [];
  for (const file of teachingFiles()) {
    const literals = stringLiterals(file.text);
    assert.ok(literals.length > 0, `${file.name} has strings to check`);
    for (const literal of literals) {
      for (const word of PROGRAM_WORDS) {
        const hit = new RegExp(`\\b${word}\\b`, "i").exec(literal);
        if (hit) violations.push(`${file.name}: "${word}" in \`${literal.slice(0, 80)}\``);
      }
    }
  }
  assert.deepEqual(violations, [], `example words leaked into the teaching layer:\n${violations.join("\n")}`);
});

test("the teaching layer never branches on which example is loaded", () => {
  // The other shape of hardcoding: `if (name === "Recursion") ...`. The
  // example names live in App.jsx, where the picker is; nowhere else may the
  // teaching layer compare its input against a known program.
  const exampleNames = [
    "Variables",
    "Recursion",
    "Merge sort",
    "if / else",
    "for loop",
    "Class",
    "List",
  ];
  const quoted = exampleNames.map((name) => `"${name}"`).join("|");
  const comparison = new RegExp(`(===|!==|==|!=)\\s*(${quoted})`, "g");
  const offenders = [];
  for (const file of teachingFiles()) {
    for (const match of file.text.matchAll(comparison)) {
      const line = file.text.slice(0, match.index).split("\n").length;
      offenders.push(`${file.name}:${line} ${match[0]}`);
    }
  }
  assert.deepEqual(offenders, [], offenders.join("\n"));
});
