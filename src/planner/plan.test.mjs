// The plan schema is strict on purpose: a malformed plan is discarded, never
// repaired into something that looks valid. The fallback is always drawable.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PLAN_LIMITS,
  PLAN_VERSION,
  fallbackPlan,
  makePlan,
  validatePlan,
} from "./plan.js";
import { CONCEPT_IDS } from "./concepts.js";

function validPlan() {
  return {
    schema_version: PLAN_VERSION,
    primary: "motion",
    fallback: "motion",
    provenance: "deterministic",
    concepts: [
      { id: "scalars", strength: "observed", evidence: ["trace.values"] },
      { id: "loop", strength: "structural", evidence: ["profile.loops"] },
    ],
    emphasis: ["values"],
    explanation: "standard",
    reasons: [{ code: "generic_values" }],
  };
}

test("a well-formed deterministic plan validates", () => {
  const input = validPlan();
  const result = validatePlan(input);
  assert.equal(result.ok, true);
  assert.deepEqual(result.plan, input);
  assert.notEqual(result.plan, input, "validation returns a copy");
});

test("makePlan validates and falls back instead of throwing", () => {
  const plan = makePlan({
    primary: "tree",
    concepts: [{ id: "recursion", strength: "observed", evidence: ["trace.frames"] }],
    emphasis: ["calls"],
    reasons: [{ code: "observed_recursion" }],
  });
  assert.equal(plan.primary, "tree");
  assert.equal(plan.fallback, "motion");

  const bad = makePlan({ primary: "graph", reasons: [{ code: "generic_values" }] });
  assert.equal(bad.primary, "motion");
  assert.equal(bad.reasons[0].code, "fallback");
});

test("unknown or missing fields are rejected", () => {
  const extra = { ...validPlan(), animation: "spin" };
  assert.equal(validatePlan(extra).ok, false);
  assert.match(validatePlan(extra).errors.join(" "), /unknown field "animation"/);

  const missing = validPlan();
  delete missing.reasons;
  assert.equal(validatePlan(missing).ok, false);
  assert.match(validatePlan(missing).errors.join(" "), /missing field "reasons"/);

  assert.equal(validatePlan(null).ok, false);
  assert.equal(validatePlan([]).ok, false);
  assert.equal(validatePlan("motion").ok, false);
});

test("the schema version, renderers and fallback are checked", () => {
  assert.equal(validatePlan({ ...validPlan(), schema_version: 2 }).ok, false);
  assert.equal(validatePlan({ ...validPlan(), primary: "graph" }).ok, false);
  assert.equal(validatePlan({ ...validPlan(), fallback: "tree" }).ok, false);
  assert.equal(validatePlan({ ...validPlan(), primary: "timeline" }).ok, true);
});

test("provenance, emphasis and explanation come from closed sets", () => {
  assert.equal(validatePlan({ ...validPlan(), provenance: "model" }).ok, false);
  assert.equal(validatePlan({ ...validPlan(), provenance: "ai" }).ok, true);
  assert.equal(validatePlan({ ...validPlan(), emphasis: ["sparkles"] }).ok, false);
  assert.equal(validatePlan({ ...validPlan(), explanation: "verbose" }).ok, false);
});

test("concepts and their evidence are validated", () => {
  const unknown = { ...validPlan(), concepts: [{ id: "bfs", strength: "observed", evidence: [] }] };
  assert.equal(validatePlan(unknown).ok, false);

  const duplicate = {
    ...validPlan(),
    concepts: [
      { id: "loop", strength: "structural", evidence: [] },
      { id: "loop", strength: "observed", evidence: [] },
    ],
  };
  assert.equal(validatePlan(duplicate).ok, false);

  const strength = { ...validPlan(), concepts: [{ id: "loop", strength: "certain", evidence: [] }] };
  assert.equal(validatePlan(strength).ok, false);

  const ref = { ...validPlan(), concepts: [{ id: "loop", strength: "observed", evidence: ["javascript.eval"] }] };
  assert.equal(validatePlan(ref).ok, false);

  const many = {
    ...validPlan(),
    concepts: [
      {
        id: "loop",
        strength: "observed",
        evidence: ["trace.a", "trace.b", "trace.c", "trace.d"],
      },
    ],
  };
  assert.equal(validatePlan(many).ok, false);
});

test("reasons and size are bounded", () => {
  assert.equal(validatePlan({ ...validPlan(), reasons: [] }).ok, false);
  assert.equal(validatePlan({ ...validPlan(), reasons: [{ code: "because" }] }).ok, false);
  assert.equal(validatePlan({ ...validPlan(), reasons: [{ code: "generic_values", why: "long" }] }).ok, false);
  assert.equal(validatePlan({ ...validPlan(), reasons: [{ code: "generic_values", subject: "x".repeat(65) }] }).ok, false);

  const tooManyConcepts = {
    ...validPlan(),
    concepts: CONCEPT_IDS.slice(0, PLAN_LIMITS.concepts + 1).map((id) => ({
      id,
      strength: "observed",
      evidence: [],
    })),
  };
  assert.equal(validatePlan(tooManyConcepts).ok, false);
});

test("the fallback plan is valid even when handed junk concepts", () => {
  const plan = fallbackPlan("empty_trace", [
    { id: "loop", strength: "observed", evidence: ["trace.loops"] },
    { id: "not_a_concept", strength: "observed", evidence: [] },
    { id: "loop", strength: "certain", evidence: ["nope"] },
    null,
  ]);
  assert.equal(plan.primary, "motion");
  assert.equal(plan.reasons[0].code, "empty_trace");
  assert.deepEqual(plan.concepts.map((concept) => concept.id), ["loop"]);
  assert.equal(validatePlan(plan).ok, true);
});

test("an unknown fallback reason becomes the generic fallback", () => {
  const plan = fallbackPlan("because_i_said_so");
  assert.equal(plan.reasons[0].code, "fallback");
  assert.equal(validatePlan(plan).ok, true);
});
