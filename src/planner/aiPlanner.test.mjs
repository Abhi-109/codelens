// AI planning is optional and always subordinate to validation. These tests
// never touch a network: a fake provider returns exactly the bytes a model
// might, including the wrong ones.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AI_CONCEPT_LIMIT,
  AI_SOURCE_LIMIT,
  aiPlanFromResponse,
  buildAiRequest,
  cacheKey,
  createPlanCache,
  isAiResultCurrent,
  planWithAi,
} from "./aiPlanner.js";
import { makePlan, validatePlan } from "./plan.js";

function analysis(overrides = {}) {
  return {
    status: "ok",
    concepts: [
      { id: "recursion", strength: "observed", evidence: ["trace.frames"] },
      { id: "list", strength: "observed", evidence: ["trace.heap.list"] },
    ],
    counts: { conditions: 0 },
    trace: {
      events: 20,
      calls: 3,
      returns: 2,
      comparisons: 1,
      exceptions: 0,
      outputs: 1,
      maxDepth: 3,
      recursive: true,
      hasFrames: true,
      termination: "completed",
    },
    ...overrides,
  };
}

function deterministicPlan(report = analysis()) {
  return makePlan({
    primary: "tree",
    concepts: report.concepts,
    emphasis: ["calls", "values"],
    reasons: [{ code: "observed_recursion" }],
  });
}

function fakeProvider(response, error = null) {
  let calls = 0;
  return {
    configured: true,
    calls: () => calls,
    async request() {
      calls += 1;
      if (error) throw Object.assign(new Error(error.code), { code: error.code });
      return response;
    },
  };
}

test("the request is bounded and carries no trace events or secret", () => {
  const request = buildAiRequest({
    source: "x".repeat(AI_SOURCE_LIMIT + 100),
    analysis: analysis(),
    plan: deterministicPlan(),
  });
  assert.equal(request.source.length, AI_SOURCE_LIMIT);
  assert.equal(request.source_truncated, true);
  assert.equal(request.renderers.length, 6);
  assert.equal(request.trace.events, 20);
  assert.equal("trace" in request.trace, false);
  assert.equal("events" in request.trace, true);
  assert.ok(!JSON.stringify(request).includes("apiKey"));
});

test("a valid answer becomes an ai plan with detected evidence", () => {
  const report = analysis();
  const result = aiPlanFromResponse(
    { primary: "tree", concepts: ["recursion"] },
    { analysis: report, deterministic: deterministicPlan(report), hasFlow: true },
  );
  assert.equal(result.error, null);
  assert.equal(result.plan.provenance, "ai");
  assert.equal(result.plan.primary, "tree");
  assert.equal(result.plan.reasons[0].code, "ai_selected");
  assert.deepEqual(result.plan.concepts, [
    { id: "recursion", strength: "observed", evidence: ["trace.frames"] },
  ]);
  assert.equal(validatePlan(result.plan).ok, true);
});

test("the model cannot upgrade evidence strength", () => {
  const report = analysis({
    concepts: [{ id: "recursion", strength: "structural", evidence: ["profile.recursion.direct"] }],
  });
  const result = aiPlanFromResponse(
    { primary: "tree", concepts: ["recursion"] },
    { analysis: report, deterministic: deterministicPlan(report), hasFlow: true },
  );
  assert.equal(result.plan.concepts[0].strength, "structural");
});

test("an unknown renderer or a renderer without evidence is rejected", () => {
  const report = analysis();
  assert.equal(
    aiPlanFromResponse({ primary: "graph" }, { analysis: report, deterministic: deterministicPlan(report) }).error.code,
    "rejected",
  );
  const noCalls = analysis({ trace: { ...report.trace, calls: 0 } });
  const result = aiPlanFromResponse(
    { primary: "tree" },
    { analysis: noCalls, deterministic: deterministicPlan(noCalls) },
  );
  assert.equal(result.plan, null);
  assert.match(result.error.detail, /missing_call_events/);
});

test("the model cannot invent a concept or contradict the detector", () => {
  const report = analysis();
  const base = { analysis: report, deterministic: deterministicPlan(report) };
  assert.equal(aiPlanFromResponse({ primary: "tree", concepts: ["sort_like"] }, base).error.detail, "unknown_concept");
  assert.equal(aiPlanFromResponse({ primary: "tree", concepts: ["recursion", "recursion"] }, base).error.detail, "unknown_concept");
  assert.equal(
    aiPlanFromResponse(
      { primary: "tree", concepts: Array.from({ length: AI_CONCEPT_LIMIT + 1 }, () => "recursion") },
      base,
    ).error.detail,
    "concepts",
  );
});

test("unknown fields, emphasis and explanation are rejected", () => {
  const report = analysis();
  const base = { analysis: report, deterministic: deterministicPlan(report) };
  assert.equal(aiPlanFromResponse({ primary: "tree", code: "x" }, base).error.code, "invalid_schema");
  assert.equal(aiPlanFromResponse({ primary: "tree", emphasis: ["sparkles"] }, base).error.detail, "emphasis");
  assert.equal(aiPlanFromResponse({ primary: "tree", explanation: "verbose" }, base).error.detail, "explanation");
  assert.equal(aiPlanFromResponse(null, base).error.code, "invalid_schema");
  assert.equal(aiPlanFromResponse([], base).error.code, "invalid_schema");
});

test("the provider's failure leaves the deterministic plan untouched", async () => {
  const report = analysis();
  const deterministic = deterministicPlan(report);
  const before = JSON.stringify(deterministic);
  const result = await planWithAi({
    provider: fakeProvider(null, { code: "timeout" }),
    request: buildAiRequest({ source: "print(1)", analysis: report, plan: deterministic }),
    analysis: report,
    deterministic,
  });
  assert.equal(result.plan, null);
  assert.equal(result.error.code, "timeout");
  assert.equal(JSON.stringify(deterministic), before);
});

test("not configured means no request at all", async () => {
  const provider = fakeProvider({ primary: "tree" });
  provider.configured = false;
  const result = await planWithAi({
    provider,
    request: buildAiRequest({ source: "", analysis: analysis(), plan: deterministicPlan() }),
    analysis: analysis(),
    deterministic: deterministicPlan(),
  });
  assert.equal(result.error.code, "not_configured");
  assert.equal(provider.calls(), 0);
});

test("a malformed answer is rejected without throwing", async () => {
  const report = analysis();
  const result = await planWithAi({
    provider: fakeProvider({ primary: "scene", bogus: true }),
    request: buildAiRequest({ source: "x", analysis: report, plan: deterministicPlan(report) }),
    analysis: report,
    deterministic: deterministicPlan(report),
  });
  assert.equal(result.plan, null);
  assert.equal(result.error.code, "invalid_schema");
});

test("the cache is keyed by the request, so a new source misses", async () => {
  const report = analysis();
  const cache = createPlanCache(2);
  const provider = fakeProvider({ primary: "tree" });
  const first = buildAiRequest({ source: "a = 1", analysis: report, plan: deterministicPlan(report) });
  const second = buildAiRequest({ source: "a = 2", analysis: report, plan: deterministicPlan(report) });

  const one = await planWithAi({ provider, request: first, analysis: report, deterministic: deterministicPlan(report), cache });
  const two = await planWithAi({ provider, request: first, analysis: report, deterministic: deterministicPlan(report), cache });
  const three = await planWithAi({ provider, request: second, analysis: report, deterministic: deterministicPlan(report), cache });

  assert.equal(one.cached, false);
  assert.equal(two.cached, true);
  assert.equal(three.cached, false);
  assert.equal(provider.calls(), 2);
  assert.notEqual(cacheKey(first), cacheKey(second));
});

test("the cache is bounded", () => {
  const cache = createPlanCache(2);
  cache.set("a", {});
  cache.set("b", {});
  cache.set("c", {});
  assert.equal(cache.size, 2);
  assert.equal(cache.has("a"), false);
});

test("a late answer is only current for the run that asked", () => {
  const run = {};
  assert.equal(isAiResultCurrent({ expectedRun: run, currentRun: run }), true);
  assert.equal(isAiResultCurrent({ expectedRun: run, currentRun: {} }), false);
  assert.equal(isAiResultCurrent({ expectedRun: run, currentRun: run, pinned: true }), false);
  assert.equal(isAiResultCurrent({ expectedRun: null, currentRun: null }), false);
});
