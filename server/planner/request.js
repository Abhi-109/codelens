// Request validation for POST /api/plan.
//
// The shape is the Phase 7A client request, trimmed to facts: source, concepts,
// a trace summary, the real renderer capabilities and the deterministic
// baseline. It is checked against the *same* plan schema the client validates
// with, so there is one definition of a valid concept, evidence reference and
// reason code rather than a second, drifting one.

import { validatePlan } from "../../src/planner/plan.js";
import { getRenderer, rendererIds } from "../../src/planner/renderers.js";
import { PLANNER_LIMITS } from "./config.js";

export const REQUEST_VERSION = 1;
export const REQUEST_TASK = "choose_visualization";

const REQUEST_KEYS = Object.freeze([
  "request_version",
  "task",
  "source",
  "source_truncated",
  "concepts",
  "trace",
  "renderers",
  "deterministic",
  "has_flow",
]);
const TRACE_KEYS = Object.freeze([
  "events",
  "calls",
  "returns",
  "comparisons",
  "exceptions",
  "outputs",
  "maxDepth",
  "recursive",
  "hasFrames",
  "termination",
]);
const RENDERER_KEYS = Object.freeze(["id", "purpose", "concepts", "requiredEvidence"]);
const DETERMINISTIC_KEYS = Object.freeze(["primary", "reasons"]);
const REQUEST_KEY_SET = new Set(REQUEST_KEYS);
const TRACE_KEY_SET = new Set(TRACE_KEYS);
const RENDERER_KEY_SET = new Set(RENDERER_KEYS);
const DETERMINISTIC_KEY_SET = new Set(DETERMINISTIC_KEYS);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) return `${label}_unknown_field`;
  }
  return null;
}

function boundedCount(value) {
  return Number.isInteger(value) && value >= 0 && value <= 1_000_000;
}

/** Validate concepts/reasons through the plan schema instead of restating it. */
function schemaProbe(concepts, reasons) {
  return validatePlan({
    schema_version: 1,
    primary: "motion",
    fallback: "motion",
    provenance: "deterministic",
    concepts,
    emphasis: ["values"],
    explanation: "standard",
    reasons,
  }).ok;
}

function fail(detail) {
  return { ok: false, error: { code: "invalid_schema", detail } };
}

/**
 * @param {unknown} raw
 * @param {{limits?: typeof PLANNER_LIMITS}} [options]
 * @returns {{ok: true, request: object} | {ok: false, error: {code: string, detail: string}}}
 */
export function validatePlannerRequest(raw, options = {}) {
  const limits = options.limits ?? PLANNER_LIMITS;
  if (!isObject(raw)) return fail("request");

  const unknown = exactKeys(raw, REQUEST_KEY_SET, "request");
  if (unknown) return fail(unknown);
  for (const key of REQUEST_KEYS) {
    if (!(key in raw)) return fail(`request_missing_${key}`);
  }

  if (raw.request_version !== REQUEST_VERSION) return fail("request_version");
  if (raw.task !== REQUEST_TASK) return fail("request_task");
  if (typeof raw.source !== "string") return fail("source");
  if (raw.source.length > limits.sourceBytes) return fail("source_size");
  if (typeof raw.source_truncated !== "boolean") return fail("source_truncated");
  if (typeof raw.has_flow !== "boolean") return fail("has_flow");

  if (!Array.isArray(raw.concepts) || raw.concepts.length > limits.concepts) {
    return fail("concepts");
  }
  if (!schemaProbe(raw.concepts, [{ code: "generic_values" }])) return fail("concepts");

  if (!isObject(raw.trace)) return fail("trace");
  const traceUnknown = exactKeys(raw.trace, TRACE_KEY_SET, "trace");
  if (traceUnknown) return fail(traceUnknown);
  for (const key of TRACE_KEYS) {
    if (!(key in raw.trace)) return fail(`trace_missing_${key}`);
  }
  for (const key of ["events", "calls", "returns", "comparisons", "exceptions", "outputs", "maxDepth"]) {
    if (!boundedCount(raw.trace[key])) return fail(`trace_${key}`);
  }
  if (typeof raw.trace.recursive !== "boolean") return fail("trace_recursive");
  if (typeof raw.trace.hasFrames !== "boolean") return fail("trace_hasFrames");
  if (typeof raw.trace.termination !== "string" || raw.trace.termination.length > 24) {
    return fail("trace_termination");
  }

  if (!Array.isArray(raw.renderers) || raw.renderers.length < 1 || raw.renderers.length > limits.renderers) {
    return fail("renderers");
  }
  const seenRenderers = new Set();
  for (const entry of raw.renderers) {
    if (!isObject(entry)) return fail("renderers");
    const entryUnknown = exactKeys(entry, RENDERER_KEY_SET, "renderer");
    if (entryUnknown) return fail(entryUnknown);
    if (!rendererIds().includes(entry.id)) return fail("renderer_unknown");
    if (seenRenderers.has(entry.id)) return fail("renderer_duplicate");
    seenRenderers.add(entry.id);
    // The browser may not advertise capabilities the build does not have.
    const real = getRenderer(entry.id);
    if (
      entry.purpose !== real.purpose ||
      JSON.stringify(entry.concepts) !== JSON.stringify(real.concepts) ||
      JSON.stringify(entry.requiredEvidence) !== JSON.stringify(real.requiredEvidence)
    ) {
      return fail("renderer_capability");
    }
  }

  if (!isObject(raw.deterministic)) return fail("deterministic");
  const deterministicUnknown = exactKeys(raw.deterministic, DETERMINISTIC_KEY_SET, "deterministic");
  if (deterministicUnknown) return fail(deterministicUnknown);
  if (!("primary" in raw.deterministic) || !("reasons" in raw.deterministic)) {
    return fail("deterministic_missing");
  }
  if (raw.deterministic.primary !== null && !rendererIds().includes(raw.deterministic.primary)) {
    return fail("deterministic_primary");
  }
  if (!Array.isArray(raw.deterministic.reasons) || raw.deterministic.reasons.length > 8) {
    return fail("deterministic_reasons");
  }
  const reasons = raw.deterministic.reasons.map((code) => ({ code }));
  if (!schemaProbe([], reasons)) return fail("deterministic_reasons");

  return {
    ok: true,
    request: {
      request_version: REQUEST_VERSION,
      task: REQUEST_TASK,
      source: raw.source,
      source_truncated: raw.source_truncated,
      concepts: raw.concepts,
      trace: raw.trace,
      renderers: raw.renderers,
      deterministic: { primary: raw.deterministic.primary, reasons: raw.deterministic.reasons },
      has_flow: raw.has_flow,
    },
  };
}
