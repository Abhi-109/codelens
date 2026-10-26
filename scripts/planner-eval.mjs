// npm run check:planner
//
// Scores the deterministic planner against the hand-written expectations in
// src/planner/quality.js, then scores the same corpus through the AI validator
// with scripted answers. No network and no provider: the AI numbers describe a
// mock, not a live model.

import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { performance } from "node:perf_hooks";

import { detectConcepts } from "../src/planner/concepts.js";
import { planVisualization } from "../src/planner/planner.js";
import {
  EXPECTED_CANVAS,
  REQUIRED_CATEGORIES,
  evaluateCase,
  evaluateWithScriptedAi,
  summarize,
} from "../src/planner/quality.js";
import { recognizeProgram } from "../src/tracer/recognition.js";

const corpus = JSON.parse(
  gunzipSync(readFileSync(new URL("../src/tracer/__fixtures__/corpus.json.gz", import.meta.url))).toString(),
);
const recognitionFixtures = JSON.parse(
  gunzipSync(readFileSync(new URL("../src/tracer/__fixtures__/recognition.json.gz", import.meta.url))).toString(),
);

function buildCases() {
  const cases = [];
  for (const [name, entry] of Object.entries(corpus)) {
    const profile = recognitionFixtures.corpus_profiles[name];
    const recognition = recognizeProgram({ profile, trace: entry.trace, result: entry.result });
    const analysis = detectConcepts({ profile, trace: entry.trace, result: entry.result, recognition });
    const plan = planVisualization({ analysis, recognition, hasFlow: true });
    cases.push({ name, kind: "corpus", analysis, recognition, plan, hasFlow: true });
  }
  for (const [name, entry] of Object.entries(recognitionFixtures.programs)) {
    const result = { status: entry.status };
    const recognition = recognizeProgram({ profile: entry.profile, trace: entry.trace, result });
    const analysis = detectConcepts({ profile: entry.profile, trace: entry.trace, result, recognition });
    const plan = planVisualization({ analysis, recognition, hasFlow: true });
    cases.push({ name, kind: "recognition", analysis, recognition, plan, hasFlow: true });
  }
  return cases;
}

const pct = (value) => `${(value * 100).toFixed(1)}%`;
const line = (label, metric) => `  ${label.padEnd(20)} ${String(metric.count).padStart(3)}  ${pct(metric.rate)}`;

const cases = buildCases();
const missingExpectation = cases.filter((entry) => !(entry.name in EXPECTED_CANVAS));
const unknownExpectation = Object.keys(EXPECTED_CANVAS).filter((name) => !cases.some((entry) => entry.name === name));

const rows = cases.map((entry) =>
  evaluateCase({ ...entry, expected: EXPECTED_CANVAS[entry.name] }),
);
const deterministic = summarize(rows);

// The planner must be a pure function of its input.
const unstable = cases.filter((entry) => {
  const again = planVisualization({ analysis: entry.analysis, recognition: entry.recognition, hasFlow: true });
  return JSON.stringify(again) !== JSON.stringify(entry.plan);
});

const deterministicPlans = new Map(cases.map((entry) => [entry.name, entry.plan]));
const aiStarted = performance.now();
const aiRows = evaluateWithScriptedAi({
  cases: cases.map((entry) => ({ ...entry, expected: EXPECTED_CANVAS[entry.name] })),
  deterministicPlans,
});
const aiMs = performance.now() - aiStarted;
const ai = summarize(aiRows);

console.log("Planner quality corpus (deterministic)\n");
console.log(`  cases                ${cases.length} (${Object.keys(corpus).length} corpus + ${Object.keys(recognitionFixtures.programs).length} recognition)`);
console.log(line("registered", deterministic.registered));
console.log(line("evidence-supported", deterministic.evidenceSupported));
console.log(line("appropriate", deterministic.appropriate));
console.log(line("fallback", deterministic.fallback));
console.log(`  unsupported claims   ${deterministic.unsupportedClaims}`);
console.log(`  nondeterministic     ${unstable.length}`);

if (deterministic.misses.length > 0) {
  console.log("\n  misses:");
  for (const miss of deterministic.misses) {
    console.log(`    ${miss.name.padEnd(28)} expected ${miss.expected}, chose ${miss.primary}`);
  }
}

console.log("\nScripted AI comparison (mock answers, no provider)\n");
console.log(line("appropriate", ai.appropriate));
console.log(line("rejected", ai.rejected));
console.log(line("fallback", ai.fallback));
console.log(`  unsupported claims   ${ai.unsupportedClaims}`);
console.log(`  validation latency   ${(aiMs / Math.max(1, cases.length)).toFixed(2)} ms/case (local, not network)`);
const improved = ai.appropriate.count - deterministic.appropriate.count;
const changed = aiRows.filter((row) => row.primary !== deterministicPlans.get(row.name)?.primary).length;
console.log(`  accepted changes     ${changed} cases`);
console.log(
  `  change vs baseline   ${improved >= 0 ? "+" : ""}${improved} cases (${pct(deterministic.appropriate.rate)} → ${pct(ai.appropriate.rate)})`,
);
console.log("\n  The AI rows use a scripted mock that answers the expected canvas when the evidence");
console.log("  supports it, so they measure the validator and the fallback path, not a model.");

const categoryGaps = Object.entries(REQUIRED_CATEGORIES).filter(
  ([, names]) => names.length === 0 || names.some((name) => !(name in EXPECTED_CANVAS)),
);

const failures = [];
if (missingExpectation.length > 0) failures.push(`${missingExpectation.length} case(s) have no expectation`);
if (unknownExpectation.length > 0) failures.push(`${unknownExpectation.length} expectation(s) name no case`);
if (categoryGaps.length > 0) failures.push(`${categoryGaps.length} required categor(ies) are incomplete`);
if (unstable.length > 0) failures.push("the planner is not deterministic");
if (deterministic.registered.count !== deterministic.total) failures.push("an unregistered renderer was selected");
if (deterministic.evidenceSupported.count !== deterministic.total) failures.push("a renderer lacked its evidence");
if (deterministic.appropriate.count !== deterministic.total) failures.push("the planner missed an expected canvas");
if (deterministic.unsupportedClaims > 0) failures.push("a plan claimed an algorithm the evidence does not prove");

if (failures.length > 0) {
  console.error(`\nFAIL\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log("\nPASS: every expected canvas matches, with no unsupported claim.");
