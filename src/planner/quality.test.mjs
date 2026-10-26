// The quality corpus is a contract: every recorded program has one expected
// canvas, every required behaviour has a case, and the deterministic planner
// matches all of them. The AI half is a scripted mock, never a provider.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { test } from "node:test";

import { detectConcepts } from "./concepts.js";
import { planVisualization } from "./planner.js";
import {
  EXPECTED_CANVAS,
  REQUIRED_CATEGORIES,
  SCRIPTED_WRONG,
  evaluateCase,
  evaluateWithScriptedAi,
  scriptedAnswer,
  summarize,
} from "./quality.js";
import { recognizeProgram } from "../tracer/recognition.js";

const corpus = JSON.parse(
  gunzipSync(readFileSync(new URL("../tracer/__fixtures__/corpus.json.gz", import.meta.url))).toString(),
);
const recognitionFixtures = JSON.parse(
  gunzipSync(readFileSync(new URL("../tracer/__fixtures__/recognition.json.gz", import.meta.url))).toString(),
);

function buildCases() {
  const cases = [];
  for (const [name, entry] of Object.entries(corpus)) {
    const profile = recognitionFixtures.corpus_profiles[name];
    const recognition = recognizeProgram({ profile, trace: entry.trace, result: entry.result });
    const analysis = detectConcepts({ profile, trace: entry.trace, result: entry.result, recognition });
    cases.push({
      name,
      analysis,
      recognition,
      plan: planVisualization({ analysis, recognition, hasFlow: true }),
      hasFlow: true,
    });
  }
  for (const [name, entry] of Object.entries(recognitionFixtures.programs)) {
    const result = { status: entry.status };
    const recognition = recognizeProgram({ profile: entry.profile, trace: entry.trace, result });
    const analysis = detectConcepts({ profile: entry.profile, trace: entry.trace, result, recognition });
    cases.push({
      name,
      analysis,
      recognition,
      plan: planVisualization({ analysis, recognition, hasFlow: true }),
      hasFlow: true,
    });
  }
  return cases;
}

const cases = buildCases();
const rows = cases.map((entry) => evaluateCase({ ...entry, expected: EXPECTED_CANVAS[entry.name] }));

test("every recorded program has exactly one expectation", () => {
  const names = new Set(cases.map((entry) => entry.name));
  assert.equal(cases.length, 122);
  for (const name of names) assert.ok(name in EXPECTED_CANVAS, `${name} has no expected canvas`);
  for (const name of Object.keys(EXPECTED_CANVAS)) assert.ok(names.has(name), `${name} names no recorded program`);
});

test("all twenty required behaviours are covered by real cases", () => {
  const names = new Set(cases.map((entry) => entry.name));
  assert.equal(Object.keys(REQUIRED_CATEGORIES).length, 20);
  for (const [category, members] of Object.entries(REQUIRED_CATEGORIES)) {
    assert.ok(members.length > 0, `${category} has no case`);
    for (const name of members) {
      assert.ok(names.has(name), `${category} names an unknown program: ${name}`);
      assert.ok(name in EXPECTED_CANVAS, `${category} names a program without an expectation: ${name}`);
    }
  }
});

test("the deterministic planner matches every expectation", () => {
  const summary = summarize(rows);
  assert.equal(summary.total, 122);
  assert.equal(summary.registered.rate, 1);
  assert.equal(summary.evidenceSupported.rate, 1);
  assert.equal(summary.appropriate.rate, 1, JSON.stringify(summary.misses));
  assert.equal(summary.unsupportedClaims, 0);
  // One fallback, and it is the honest one: the source did not compile.
  assert.equal(summary.fallback.count, 1);
  const syntax = rows.find((row) => row.name === "error-syntax");
  assert.equal(syntax.primary, "motion");
  assert.equal(syntax.expected, "motion");
});

test("planning is deterministic and the trace is untouched", () => {
  for (const entry of cases) {
    const before = JSON.stringify(entry.analysis.trace);
    const again = planVisualization({ analysis: entry.analysis, recognition: entry.recognition, hasFlow: true });
    assert.deepEqual(again, entry.plan, `${entry.name} changed between runs`);
    assert.equal(JSON.stringify(entry.analysis.trace), before, `${entry.name} mutated its trace`);
  }
});

test("no case claims an algorithm its evidence does not prove", () => {
  for (const row of rows) {
    assert.deepEqual(row.claims, [], `${row.name} made an unsupported claim`);
  }
  // The misleading names are conservative on purpose.
  for (const name of ["bubble-sorted", "binary-first", "linear-first", "binary-one"]) {
    assert.equal(EXPECTED_CANVAS[name], "motion", `${name} should stay conservative`);
    assert.equal(rows.find((row) => row.name === name).primary, "motion");
  }
});

test("the scripted AI comparison exercises acceptance and rejection", () => {
  const plans = new Map(cases.map((entry) => [entry.name, entry.plan]));
  const withExpected = cases.map((entry) => ({ ...entry, expected: EXPECTED_CANVAS[entry.name] }));
  const aiRows = evaluateWithScriptedAi({ cases: withExpected, deterministicPlans: plans });
  const summary = summarize(aiRows);

  assert.equal(summary.total, 122);
  // The deliberately wrong answers plus every run whose deterministic plan is a
  // fallback (there, the model is not asked to overrule an honest reason).
  assert.equal(summary.rejected.count, SCRIPTED_WRONG.length + rows.filter((row) => row.fallback).length);
  for (const name of SCRIPTED_WRONG) {
    assert.equal(aiRows.find((row) => row.name === name).rejected, true, `${name} was not rejected`);
  }
  assert.equal(summary.appropriate.rate, 1, JSON.stringify(summary.misses));
  assert.equal(summary.unsupportedClaims, 0);
  // A rejected answer keeps the deterministic plan, so nothing regresses.
  for (const name of SCRIPTED_WRONG) {
    const deterministic = plans.get(name);
    assert.equal(aiRows.find((row) => row.name === name).primary, deterministic.primary);
  }
});

test("the scripted mock answers an expected canvas only when it is renderable", () => {
  const entry = cases.find((row) => row.name === "if-nested");
  assert.deepEqual(scriptedAnswer({ ...entry, expected: "flow" }), { primary: "flow" });
  const noEvents = { ...entry, analysis: { ...entry.analysis, trace: { ...entry.analysis.trace, events: 0 } } };
  assert.deepEqual(scriptedAnswer({ ...noEvents, expected: "motion" }), { primary: "graph" });
});
