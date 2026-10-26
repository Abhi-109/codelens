// The planner is pure: same input, same plan, no network, no cursor. These
// tests drive it with the repository's real profiles and traces.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";

import { detectConcepts } from "./concepts.js";
import { describePlan, planVisualization } from "./planner.js";
import { validatePlan } from "./plan.js";
import { recognizeProgram } from "../tracer/recognition.js";
import { PROGRAM_PROFILE_VERSION } from "../tracer/programProfile.js";

const FIXTURE = JSON.parse(
  gunzipSync(readFileSync(new URL("../tracer/__fixtures__/recognition.json.gz", import.meta.url))),
);
const CORPUS = JSON.parse(
  gunzipSync(readFileSync(new URL("../tracer/__fixtures__/corpus.json.gz", import.meta.url))),
);

function corpusPlan(name, options = {}) {
  const entry = CORPUS[name];
  const profile = FIXTURE.corpus_profiles[name];
  const trace = entry?.trace ?? [];
  const recognition = recognizeProgram({ profile, trace, result: entry?.result });
  const analysis = detectConcepts({ profile, trace, result: entry?.result, recognition });
  return planVisualization({ analysis, recognition, hasFlow: options.hasFlow ?? true });
}

function programPlan(name) {
  const entry = FIXTURE.programs[name];
  const recognition = recognizeProgram({ profile: entry.profile, trace: entry.trace });
  const analysis = detectConcepts({
    profile: entry.profile,
    trace: entry.trace,
    result: { status: entry.status },
    recognition,
  });
  return planVisualization({ analysis, recognition, hasFlow: true });
}

function emptyProfile() {
  return {
    profile_version: PROGRAM_PROFILE_VERSION,
    kind: "program_profile",
    language: "python",
    status: "ok",
    loops: [],
    conditions: [],
    comparisons: [],
    mutations: [],
    returns: [],
    container_operations: [],
    functions: [],
    calls: [],
    call_graph: {},
    recursion: { direct: [], mutual_candidates: [] },
  };
}

test("a scalar-only program opens on the generic motion canvas", () => {
  const plan = corpusPlan("scalars-only");
  assert.equal(plan.primary, "motion");
  assert.equal(plan.reasons[0].code, "generic_values");
  assert.equal(validatePlan(plan).ok, true);
});

test("a function call and return without nesting stays on motion", () => {
  const plan = corpusPlan("function-basic");
  assert.equal(plan.primary, "motion");
  assert.equal(plan.reasons[0].code, "generic_values");
});

test("observed recursion opens the call tree", () => {
  const plan = programPlan("fibonacci");
  assert.equal(plan.primary, "tree");
  assert.equal(plan.reasons[0].code, "observed_recursion");
  assert.ok(plan.concepts.some((concept) => concept.id === "recursion" && concept.strength === "observed"));
});

test("structural recursion with no observed recursive frame does not open the tree", () => {
  const analysis = {
    status: "ok",
    concepts: [{ id: "recursion", strength: "structural", evidence: ["profile.recursion.direct"] }],
    counts: { conditions: 0 },
    trace: { events: 4, calls: 1, hasFrames: true },
  };
  const plan = planVisualization({ analysis, recognition: { adapterId: "generic" }, hasFlow: true });
  assert.equal(plan.primary, "motion");
});

test("recognized sorting and searching open the adaptive canvas", () => {
  const sorting = programPlan("bubble-sort");
  assert.equal(sorting.primary, "scene");
  assert.equal(sorting.reasons[0].code, "recognized_sorting");

  const searching = programPlan("binary-search");
  assert.equal(searching.primary, "scene");
  assert.equal(searching.reasons[0].code, "recognized_searching");
});

test("a sort-shaped hypothesis alone is not enough for the adaptive canvas", () => {
  const analysis = {
    status: "ok",
    concepts: [{ id: "sort_like", strength: "hypothesis", evidence: ["derived.sort_shape"] }],
    counts: { conditions: 0 },
    trace: { events: 9, calls: 1, hasFrames: true },
  };
  const plan = planVisualization({ analysis, recognition: { adapterId: "generic" }, hasFlow: true });
  assert.equal(plan.primary, "motion");
  assert.equal(plan.reasons[0].code, "generic_values");
});

test("collection mutation keeps the motion canvas, with collection emphasis", () => {
  for (const name of ["dict-basics", "list-basics", "alias-shared", "set-basics"]) {
    const plan = corpusPlan(name);
    assert.equal(plan.primary, "motion", name);
    assert.equal(plan.reasons[0].code, "collection_motion", name);
    assert.ok(plan.emphasis.includes("collections"), name);
  }
});

test("nested calls with collections use the combined canvas", () => {
  const analysis = {
    status: "ok",
    concepts: [
      { id: "nested_calls", strength: "observed", evidence: ["trace.frames"] },
      { id: "list", strength: "observed", evidence: ["trace.heap.list"] },
    ],
    counts: { conditions: 0 },
    trace: { events: 20, calls: 3, hasFrames: true },
  };
  const plan = planVisualization({ analysis, recognition: { adapterId: "generic" }, hasFlow: true });
  assert.equal(plan.primary, "combined");
  assert.equal(plan.reasons[0].code, "nested_calls_with_collections");
});

test("branch-heavy scalar code opens control flow when the graph exists", () => {
  const plan = corpusPlan("if-nested");
  assert.equal(plan.primary, "flow");
  assert.equal(plan.reasons[0].code, "branch_heavy");

  const withoutGraph = corpusPlan("if-nested", { hasFlow: false });
  assert.equal(withoutGraph.primary, "motion");
  assert.equal(withoutGraph.reasons[0].code, "renderer_missing_evidence");
});

test("nested loops without a collection open control flow", () => {
  const plan = corpusPlan("nested-loops");
  assert.equal(plan.primary, "flow");
  assert.equal(plan.reasons[0].code, "nested_loop");

  // A collection keeps its own canvas: the changes are what matters there.
  const withList = planVisualization({
    analysis: {
      status: "ok",
      counts: {},
      trace: { events: 8, calls: 1, hasFrames: false },
      concepts: [
        { id: "nested_loop", strength: "structural", evidence: ["profile.loops"] },
        { id: "list", strength: "observed", evidence: ["trace.heap.list"] },
      ],
    },
    recognition: { adapterId: "generic" },
    hasFlow: true,
  });
  assert.equal(withList.primary, "motion");
});

test("a syntax error and an empty program fall back without inventing a story", () => {
  const broken = corpusPlan("error-syntax");
  assert.equal(broken.primary, "motion");
  assert.equal(broken.reasons[0].code, "source_syntax_error");

  const empty = planVisualization({
    analysis: detectConcepts({ profile: emptyProfile(), trace: [] }),
    recognition: { adapterId: "generic" },
    hasFlow: true,
  });
  assert.equal(empty.primary, "motion");
  assert.equal(empty.reasons[0].code, "empty_trace");
});

test("a renderer that lacks evidence is not chosen", () => {
  const analysis = {
    status: "ok",
    concepts: [{ id: "recursion", strength: "observed", evidence: ["trace.frames"] }],
    counts: { conditions: 0 },
    trace: { events: 0, calls: 0, hasFrames: false },
  };
  const plan = planVisualization({ analysis, recognition: { adapterId: "generic" }, hasFlow: true });
  assert.equal(plan.primary, "motion");
  assert.equal(plan.reasons[0].code, "renderer_missing_evidence");
});

test("the planner is deterministic and never mutates its input", () => {
  const entry = FIXTURE.programs["bubble-sort"];
  const recognition = recognizeProgram({ profile: entry.profile, trace: entry.trace });
  const analysis = detectConcepts({ profile: entry.profile, trace: entry.trace, recognition });
  const before = JSON.stringify({ analysis, recognition });
  const first = planVisualization({ analysis, recognition, hasFlow: true });
  const second = planVisualization({ analysis, recognition, hasFlow: true });
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify({ analysis, recognition }), before);
});

test("the why-line is short and names the canvas", () => {
  const plan = programPlan("fibonacci");
  assert.match(describePlan(plan), /^Call tree: /);
  assert.ok(describePlan(plan).length < 90);
});
