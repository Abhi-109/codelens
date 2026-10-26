// The browser's request is untrusted: these tests pin what the route accepts and
// what it refuses before the provider is ever reached.

import assert from "node:assert/strict";
import test from "node:test";

import { PLANNER_LIMITS } from "./config.js";
import { validatePlannerRequest } from "./request.js";
import { validRequest } from "./testFixtures.mjs";

const ok = (raw) => validatePlannerRequest(raw, { limits: PLANNER_LIMITS });

test("accepts the documented v1 request", () => {
  const result = ok(validRequest());
  assert.equal(result.ok, true, result.error?.detail);
  assert.equal(result.request.task, "choose_visualization");
  assert.equal(result.request.trace.hasFrames, true);
});

test("refuses a body that is not an object", () => {
  for (const raw of [null, [], "request", 7]) {
    assert.equal(ok(raw).ok, false);
  }
});

test("refuses unknown and missing top-level fields", () => {
  assert.equal(ok(validRequest({ untrusted_source: "hi" })).error.detail, "request_unknown_field");
  assert.equal(ok(validRequest({ response_shape: {} })).error.detail, "request_unknown_field");
  const missing = validRequest();
  delete missing.has_flow;
  assert.equal(ok(missing).error.detail, "request_missing_has_flow");
});

test("refuses a different version or task", () => {
  assert.equal(ok(validRequest({ request_version: 2 })).error.detail, "request_version");
  assert.equal(ok(validRequest({ task: "write_code" })).error.detail, "request_task");
});

test("bounds the source excerpt", () => {
  assert.equal(ok(validRequest({ source: 1 })).error.detail, "source");
  const long = "x = 1\n".repeat(PLANNER_LIMITS.sourceBytes);
  assert.equal(ok(validRequest({ source: long })).error.detail, "source_size");
  assert.equal(ok(validRequest({ source_truncated: "yes" })).error.detail, "source_truncated");
});

test("refuses concepts the plan schema does not know", () => {
  assert.equal(ok(validRequest({ concepts: "scalars" })).error.detail, "concepts");
  assert.equal(
    ok(validRequest({ concepts: [{ id: "not_a_concept", strength: "observed", evidence: [] }] })).error.detail,
    "concepts",
  );
  assert.equal(
    ok(validRequest({ concepts: [{ id: "scalars", strength: "certain", evidence: [] }] })).error.detail,
    "concepts",
  );
  assert.equal(
    ok(validRequest({ concepts: [{ id: "scalars", strength: "observed", evidence: ["made.up"] }] })).error.detail,
    "concepts",
  );
  const many = Array.from({ length: PLANNER_LIMITS.concepts + 1 }, () => ({
    id: "scalars",
    strength: "observed",
    evidence: [],
  }));
  assert.equal(ok(validRequest({ concepts: many })).error.detail, "concepts");
});

test("requires every trace field with the right type", () => {
  const missing = validRequest();
  delete missing.trace.hasFrames;
  assert.equal(ok(missing).error.detail, "trace_missing_hasFrames");
  assert.equal(ok(validRequest({ trace: { ...validRequest().trace, events: -1 } })).error.detail, "trace_events");
  assert.equal(
    ok(validRequest({ trace: { ...validRequest().trace, recursive: "yes" } })).error.detail,
    "trace_recursive",
  );
  assert.equal(
    ok(validRequest({ trace: { ...validRequest().trace, extra: 1 } })).error.detail,
    "trace_unknown_field",
  );
});

test("refuses a renderer list that does not match this build", () => {
  const widened = validRequest().renderers.map((entry) =>
    entry.id === "scene" ? { ...entry, concepts: [...entry.concepts, "graph"] } : entry,
  );
  assert.equal(ok(validRequest({ renderers: widened })).error.detail, "renderer_capability");

  const invented = [...validRequest().renderers, { ...validRequest().renderers[0], id: "hologram" }];
  assert.equal(ok(validRequest({ renderers: invented })).error.detail, "renderer_unknown");

  const duplicated = [...validRequest().renderers, validRequest().renderers[0]];
  assert.equal(ok(validRequest({ renderers: duplicated })).error.detail, "renderer_duplicate");

  assert.equal(ok(validRequest({ renderers: [] })).error.detail, "renderers");
});

test("refuses a deterministic baseline outside the schema", () => {
  assert.equal(ok(validRequest({ deterministic: { primary: "graph", reasons: [] } })).error.detail, "deterministic_primary");
  assert.equal(
    ok(validRequest({ deterministic: { primary: "motion", reasons: ["made_up"] } })).error.detail,
    "deterministic_reasons",
  );
  assert.equal(
    ok(validRequest({ deterministic: { primary: "motion", reasons: [], extra: 1 } })).error.detail,
    "deterministic_unknown_field",
  );
});
