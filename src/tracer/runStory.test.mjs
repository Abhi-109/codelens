// Tests for the run story: the sentences that explain what a whole run did.
//
// The corpus is the point. Every one of the 60 programs is turned into a story
// and the story is checked against the trace it came from:
//
//   * every section points at a real step, and its jump is inside its range;
//   * every chain value is a value that variable actually held (no invented
//     numbers, the same honesty rule the canvases follow);
//   * a "repeat" section's header line is really a loop header in the source —
//     a repeated decorator line is not a loop, and must not be called one;
//   * rounds are body executions, so a for loop's exhausted check is not one;
//   * a program with no repetition never gets a repeat section;
//   * the story is deterministic and does not touch the trace.
//
// Then a handful of exact stories, because "looks plausible" is not the
// standard: the numbers and words for a for loop, a while loop, nested loops,
// a break, recursion, a subclass and an error are asserted literally.
//
//   node --test src/tracer/runStory.test.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";

import { buildRunStory, sectionAt } from "./runStory.js";
import { variableSeries } from "./stepView.js";

const CORPUS = JSON.parse(
  gunzipSync(readFileSync(new URL("./__fixtures__/corpus.json.gz", import.meta.url))),
);
const PROGRAMS = Object.entries(CORPUS);
const LEAKED = /\bundefined\b|\bNaN\b|\[object Object\]|\bo\d+\b/;

const story = (name) => buildRunStory(CORPUS[name].trace, CORPUS[name].source);
const section = (name, kind) => story(name).sections.find((entry) => entry.kind === kind);

test("every corpus program gets an ordered story that points at real steps", () => {
  for (const [name, program] of PROGRAMS) {
    const built = buildRunStory(program.trace, program.source);
    assert.equal(built.kind, "run_story", name);
    assert.equal(built.steps, program.trace.length, name);
    assert.ok(built.sections.length > 0, `${name} has no sections`);
    let previous = -1;
    for (const entry of built.sections) {
      for (const field of ["id", "kind", "label", "title", "text"]) {
        assert.equal(typeof entry[field], "string", `${name}: ${field} is not text`);
        assert.ok(entry[field].length > 0, `${name}: ${field} is empty`);
      }
      assert.ok(Number.isInteger(entry.from), `${name}: from is not an index`);
      assert.ok(entry.from >= 0 && entry.from < program.trace.length, `${name}: from out of range`);
      assert.ok(Number.isInteger(entry.to), `${name}: to is not an index`);
      assert.ok(entry.to >= entry.from && entry.to < program.trace.length, `${name}: to out of range`);
      assert.ok(entry.jump >= entry.from && entry.jump <= entry.to, `${name}: jump outside its section`);
      assert.ok(entry.from >= previous, `${name}: sections are not in run order`);
      previous = entry.from;
      assert.ok(!LEAKED.test(`${entry.label} ${entry.title} ${entry.text}`), `${name}: leaked an id`);
    }
  }
});

test("a repeat section only ever points at a real loop header", () => {
  for (const [name, program] of PROGRAMS) {
    const lines = program.source.split("\n");
    for (const entry of buildRunStory(program.trace, program.source).sections) {
      if (entry.kind !== "repeat") continue;
      const text = (lines[entry.line - 1] ?? "").trim();
      const isLoop =
        /^(async\s+)?(for|while)\b/.test(text) ||
        /\bfor\s+[A-Za-z_]\w*\s+in\b/.test(text);
      assert.ok(isLoop, `${name}: line ${entry.line} is not a loop: ${JSON.stringify(text)}`);
    }
  }
});

test("every chain value is a value the trace actually recorded", () => {
  for (const [name, program] of PROGRAMS) {
    for (const entry of buildRunStory(program.trace, program.source).sections) {
      for (const series of [entry.chain, entry.values]) {
        if (!series || series.name === "returns") continue;
        const recorded = new Set(variableSeries(program.trace, series.name).map((item) => item.value));
        assert.ok(recorded.size > 0, `${name}: ${series.name} was never recorded`);
        for (const value of series.values) {
          assert.ok(
            recorded.has(value),
            `${name}: "${value}" is not a recorded value of ${series.name}`,
          );
        }
      }
    }
  }
});

test("rounds are body executions, so a for loop's exhausted check is not one", () => {
  const repeat = section("for-loop", "repeat");
  assert.equal(repeat.rounds, 5);
  assert.equal(repeat.label, "Lines 2–3");
  assert.match(repeat.text, /run 5 times/);
  assert.match(repeat.text, /`n` takes 1, 2, 3, 4, 5/);
  assert.equal(repeat.chain.name, "total");
  assert.deepEqual(repeat.chain.values, ["0", "1", "3", "6", "10", "15"]);
  assert.match(repeat.text, /`total` grows 0 → 1 → 3 → 6 → 10 → 15/);
  assert.deepEqual(story("for-loop").sections.map((entry) => entry.kind), [
    "start",
    "repeat",
    "finish",
  ]);
  assert.equal(story("for-loop").sections[2].outputSummary, "15");
});

test("a repeat section exposes one jump per round", () => {
  const program = CORPUS["for-loop"];
  const repeat = section("for-loop", "repeat");
  assert.equal(repeat.roundJumps.length, repeat.rounds);
  assert.deepEqual(repeat.roundJumps, [2, 4, 6, 8, 10]);
  for (const step of repeat.roundJumps) {
    assert.ok(step >= repeat.from && step <= repeat.to);
    assert.equal(program.trace[step].event, "line");
    assert.equal(program.trace[step].line, 2);
  }
  assert.equal(section("break-continue", "repeat").roundJumps.length, 6);
});

test("a while loop's changing value becomes the chain", () => {
  const repeat = section("while-loop", "repeat");
  assert.equal(repeat.rounds, 3);
  assert.equal(repeat.chain.name, "fuel");
  assert.deepEqual(repeat.chain.values, ["3", "2", "1", "0"]);
  assert.match(repeat.text, /`fuel` shrinks 3 → 2 → 1 → 0/);
});

test("a break ends the rounds at the round it ran", () => {
  const repeat = section("break-continue", "repeat");
  assert.equal(repeat.rounds, 6); // range(1, 8), but n == 6 breaks
  assert.deepEqual(repeat.values.values, ["1", "2", "3", "4", "5", "6"]);
});

test("nested loops report the outer rounds and the outer accumulator", () => {
  const repeat = section("nested-loops", "repeat");
  assert.equal(repeat.rounds, 3);
  assert.equal(repeat.values.name, "r");
  assert.deepEqual(repeat.values.values, ["0", "1", "2"]);
  assert.equal(repeat.chain.name, "line");
  assert.equal(repeat.chain.values.at(-1), '"*/**/***/"');
});

test("recursion is one section with the real depth and the return chain", () => {
  const call = section("recursion", "call");
  assert.equal(call.title, "Calls itself 5 times");
  assert.match(call.text, /with `n` = 5, 4, 3, 2, 1/);
  assert.deepEqual(call.chain.values, ["1", "2", "6", "24", "120"]);
  assert.match(call.text, /come back up as 1 → 2 → 6 → 24 → 120/);
});

test("a subclass is created as the subclass, not as its base", () => {
  const creation = story("class-inheritance").sections.find(
    (entry) => entry.kind === "call" && entry.title.startsWith("Creates"),
  );
  assert.equal(creation.title, "Creates a `Dog`");
  assert.match(creation.text, /Line 12 creates a `Dog` object with `name` = "Rex"/);
  assert.doesNotMatch(creation.title, /Animal/);
});

test("a program without repetition gets one straight-through section", () => {
  for (const name of ["assign-only", "if-elif-else", "list-basics", "dict-basics", "function-basic"]) {
    const kinds = story(name).sections.map((entry) => entry.kind);
    assert.ok(!kinds.includes("repeat"), `${name} claims a repeat`);
  }
  const sections = story("assign-only").sections;
  assert.equal(sections.length, 1);
  assert.equal(sections[0].kind, "run");
  assert.match(sections[0].text, /x is created with the value 1/);
});

test("errors and limits are reported without pretending the run finished", () => {
  const error = story("error-division").sections.at(-1);
  assert.equal(error.kind, "error");
  assert.equal(error.label, "Line 2");
  assert.match(error.text, /ZeroDivisionError: division by zero/);
  assert.ok(!story("error-division").sections.some((entry) => entry.kind === "finish"));

  const syntax = story("error-syntax").sections;
  assert.equal(syntax.length, 1);
  assert.equal(syntax[0].title, "It never ran");
  assert.match(syntax[0].text, /SyntaxError: invalid syntax/);

  const limited = story("limit-output").sections.at(-1);
  assert.equal(limited.kind, "limit");
  assert.equal(limited.title, "Stopped at the output limit");
  assert.equal(story("limit-steps").sections.at(-1).kind, "limit");
});

test("the story is deterministic and never mutates the trace", () => {
  const before = JSON.stringify(CORPUS["for-loop"].trace);
  const once = story("for-loop");
  const twice = story("for-loop");
  assert.deepEqual(once, twice);
  assert.equal(JSON.stringify(CORPUS["for-loop"].trace), before);
});

test("sectionAt finds the part of the story a step belongs to", () => {
  const built = story("for-loop");
  const repeat = built.sections.find((entry) => entry.kind === "repeat");
  assert.equal(sectionAt(built, repeat.from).id, repeat.id);
  assert.equal(sectionAt(built, repeat.to).id, repeat.id);
  assert.equal(sectionAt(built, 0).kind, "start");
  assert.equal(sectionAt(built, 999).id, built.sections.at(-1).id);
});

test("an empty trace is an empty story", () => {
  const built = buildRunStory([], "");
  assert.equal(built.steps, 0);
  assert.deepEqual(built.sections, []);
  assert.equal(sectionAt(built, 0), null);
});
