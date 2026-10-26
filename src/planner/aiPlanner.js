// AI-assisted planning, kept strictly downstream of validation.
//
// The model returns a renderer id and, optionally, concept ids and emphasis.
// It never returns a plan we trust: the response is checked against the real
// renderer registry and against the concepts the deterministic detector found,
// then we build the plan ourselves with provenance "ai" and an `ai_selected`
// reason. Runtime facts, evidence strengths and the trace are never taken from
// the model.

import { EMPHASIS_RULES, EXPLANATION_LEVELS, makePlan } from "./plan.js";
import { canRender, getRenderer, rendererIds } from "./renderers.js";

export const AI_REQUEST_VERSION = 1;
export const AI_SOURCE_LIMIT = 8000;
export const AI_CONCEPT_LIMIT = 8;
export const AI_CACHE_LIMIT = 8;

const RESPONSE_KEYS = new Set(["primary", "concepts", "emphasis", "explanation"]);
const EMPHASIS_SET = new Set(EMPHASIS_RULES);
const EXPLANATION_SET = new Set(EXPLANATION_LEVELS);

// A run with no trace, or a source the analyser could not read, has one honest
// answer: its fallback. Letting the model replace that would trade a true reason
// ("the source did not compile") for a vague "the planner chose this".
const NON_OVERRIDABLE = new Set([
  "empty_trace",
  "source_syntax_error",
  "source_analysis_error",
  "source_invalid",
  "source_unsupported",
  "fallback",
]);

function isFallbackBaseline(deterministic) {
  const code = deterministic?.reasons?.[0]?.code;
  return typeof code === "string" && NON_OVERRIDABLE.has(code);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function traceSummary(analysis) {
  const trace = isObject(analysis?.trace) ? analysis.trace : {};
  return {
    events: trace.events ?? 0,
    calls: trace.calls ?? 0,
    returns: trace.returns ?? 0,
    comparisons: trace.comparisons ?? 0,
    exceptions: trace.exceptions ?? 0,
    outputs: trace.outputs ?? 0,
    maxDepth: trace.maxDepth ?? 0,
    recursive: trace.recursive === true,
    hasFrames: trace.hasFrames === true,
    termination: typeof trace.termination === "string" ? trace.termination : "unknown",
  };
}

/** The smallest request that can improve a renderer choice. */
export function buildAiRequest({ source = "", analysis, plan, hasFlow = true } = {}) {
  const text = String(source ?? "");
  const concepts = (Array.isArray(analysis?.concepts) ? analysis.concepts : [])
    .slice(0, 24)
    .map((concept) => ({
      id: concept.id,
      strength: concept.strength,
      evidence: Array.isArray(concept.evidence) ? concept.evidence.slice(0, 3) : [],
    }));
  return {
    request_version: AI_REQUEST_VERSION,
    task: "choose_visualization",
    source: text.slice(0, AI_SOURCE_LIMIT),
    source_truncated: text.length > AI_SOURCE_LIMIT,
    concepts,
    trace: traceSummary(analysis),
    renderers: rendererIds().map((id) => {
      const renderer = getRenderer(id);
      return {
        id,
        purpose: renderer.purpose,
        concepts: renderer.concepts,
        requiredEvidence: renderer.requiredEvidence,
      };
    }),
    deterministic: {
      primary: plan?.primary ?? null,
      reasons: Array.isArray(plan?.reasons) ? plan.reasons.map((reason) => reason.code) : [],
    },
    has_flow: hasFlow === true,
  };
}

/**
 * Validate one model answer and build a plan from it. The model's primary must
 * be a real renderer that this run's evidence can support; its concepts must
 * already be in the deterministic report. A model cannot add evidence.
 */
export function aiPlanFromResponse(raw, { analysis, deterministic, hasFlow = true } = {}) {
  if (isFallbackBaseline(deterministic)) {
    return { plan: null, error: { code: "rejected", detail: "deterministic_fallback" } };
  }
  if (!isObject(raw)) return { plan: null, error: { code: "invalid_schema" } };
  for (const key of Object.keys(raw)) {
    if (!RESPONSE_KEYS.has(key)) return { plan: null, error: { code: "invalid_schema" } };
  }
  if (typeof raw.primary !== "string" || !rendererIds().includes(raw.primary)) {
    return { plan: null, error: { code: "rejected", detail: "unknown_renderer" } };
  }
  const capability = canRender(raw.primary, {
    trace: isObject(analysis?.trace) ? analysis.trace : {},
    hasFlow: hasFlow === true,
  });
  if (!capability.ok) {
    return { plan: null, error: { code: "rejected", detail: `missing_${capability.missing.join("_")}` } };
  }

  const detected = new Map(
    (Array.isArray(analysis?.concepts) ? analysis.concepts : []).map((concept) => [concept.id, concept]),
  );
  let concepts = Array.isArray(deterministic?.concepts) ? deterministic.concepts : [];
  if (raw.concepts !== undefined) {
    if (!Array.isArray(raw.concepts) || raw.concepts.length > AI_CONCEPT_LIMIT) {
      return { plan: null, error: { code: "rejected", detail: "concepts" } };
    }
    const picked = [];
    const seen = new Set();
    for (const id of raw.concepts) {
      if (typeof id !== "string" || !detected.has(id) || seen.has(id)) {
        return { plan: null, error: { code: "rejected", detail: "unknown_concept" } };
      }
      seen.add(id);
      const concept = detected.get(id);
      picked.push({
        id: concept.id,
        strength: concept.strength,
        evidence: Array.isArray(concept.evidence) ? concept.evidence.slice(0, 3) : [],
      });
    }
    concepts = picked;
  }

  let emphasis = Array.isArray(deterministic?.emphasis) ? deterministic.emphasis : ["values"];
  if (raw.emphasis !== undefined) {
    if (
      !Array.isArray(raw.emphasis) ||
      raw.emphasis.length === 0 ||
      raw.emphasis.length > 4 ||
      raw.emphasis.some((rule) => !EMPHASIS_SET.has(rule))
    ) {
      return { plan: null, error: { code: "rejected", detail: "emphasis" } };
    }
    emphasis = raw.emphasis;
  }

  let explanation = typeof deterministic?.explanation === "string" ? deterministic.explanation : "standard";
  if (raw.explanation !== undefined) {
    if (!EXPLANATION_SET.has(raw.explanation)) {
      return { plan: null, error: { code: "rejected", detail: "explanation" } };
    }
    explanation = raw.explanation;
  }

  const plan = makePlan({
    primary: raw.primary,
    concepts,
    emphasis,
    explanation,
    provenance: "ai",
    reasons: [{ code: "ai_selected", subject: raw.primary }],
  });
  if (plan.primary !== raw.primary || plan.provenance !== "ai") {
    return { plan: null, error: { code: "rejected", detail: "plan" } };
  }
  return { plan, error: null };
}

/** A tiny deterministic hash, so a cache key is stable across reloads. The
 * endpoint is part of the key: two deployments may answer differently. */
export function cacheKey(request, endpoint = "") {
  const text = JSON.stringify({ endpoint: endpoint ?? "", request });
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${text.length.toString(36)}:${hash.toString(16)}`;
}

/** Bounded insertion-order cache. */
export function createPlanCache(limit = AI_CACHE_LIMIT) {
  const entries = new Map();
  return {
    has: (key) => entries.has(key),
    get: (key) => entries.get(key) ?? null,
    set(key, plan) {
      if (entries.has(key)) entries.delete(key);
      entries.set(key, plan);
      while (entries.size > limit) entries.delete(entries.keys().next().value);
    },
    clear: () => entries.clear(),
    get size() {
      return entries.size;
    },
  };
}

/**
 * Ask the provider, validate the answer, and return a plan or a classified
 * error. This never throws and never blocks the caller's deterministic plan.
 */
export async function planWithAi({
  provider,
  request,
  analysis,
  deterministic,
  hasFlow = true,
  cache = null,
  signal = null,
} = {}) {
  if (!provider?.configured) return { plan: null, error: { code: "not_configured" }, cached: false };
  // Nothing to ask: the deterministic answer is already the only honest one.
  if (isFallbackBaseline(deterministic)) return { plan: null, error: { code: "rejected" }, cached: false };
  const key = cacheKey(request, provider.endpoint ?? "");
  if (cache?.has(key)) return { plan: cache.get(key), error: null, cached: true };
  let raw;
  try {
    raw = await provider.request(request, { signal });
  } catch (error) {
    return { plan: null, error: { code: error?.code ?? "network" }, cached: false };
  }
  const result = aiPlanFromResponse(raw, { analysis, deterministic, hasFlow });
  if (result.plan && cache) cache.set(key, result.plan);
  return { ...result, cached: false };
}

/** A late answer may only land on the run that asked for it, and only if the
 * user has not picked a canvas since. */
export function isAiResultCurrent({ expectedRun, currentRun, pinned = false }) {
  return !pinned && expectedRun != null && expectedRun === currentRun;
}
