// The visualization plan: a small, versioned, validated statement of which
// canvas should draw this run and why. It carries no trace and no cursor — the
// plan is a recommendation, the execution session remains the only runtime
// truth. Malformed input is rejected, never repaired into something valid.

import { CONCEPT_IDS, EVIDENCE_KINDS } from "./concepts.js";
import { DEFAULT_VIZ } from "../visualizer/vizMode.js";
import { isRendererId } from "./renderers.js";

export const PLAN_VERSION = 1;
export const PLAN_PROVENANCE = Object.freeze(["deterministic", "ai"]);
export const EMPHASIS_RULES = Object.freeze([
  "values",
  "calls",
  "control",
  "collections",
  "timeline",
]);
export const EXPLANATION_LEVELS = Object.freeze(["brief", "standard", "detailed"]);
export const REASON_CODES = Object.freeze([
  "recognized_sorting",
  "recognized_searching",
  "observed_recursion",
  "nested_calls_with_collections",
  "nested_calls",
  "branch_heavy",
  "collection_motion",
  "generic_values",
  "empty_trace",
  "source_syntax_error",
  "source_analysis_error",
  "source_invalid",
  "source_unsupported",
  "renderer_missing_evidence",
  "ai_selected",
  "ai_rejected",
  "fallback",
]);

export const PLAN_LIMITS = Object.freeze({
  concepts: 24,
  evidencePerConcept: 3,
  emphasis: 4,
  reasons: 8,
  characters: 8192,
});

const CONCEPT_SET = new Set(CONCEPT_IDS);
const EVIDENCE_SET = new Set(EVIDENCE_KINDS);
const EMPHASIS_SET = new Set(EMPHASIS_RULES);
const EXPLANATION_SET = new Set(EXPLANATION_LEVELS);
const REASON_SET = new Set(REASON_CODES);
const EVIDENCE_REF = /^(profile|trace|recognition|derived)\.[a-z_]+(\.[a-z_]+)*(\[\d+\])?$/;
const SUBJECT = /^[A-Za-z0-9_.:-]{1,64}$/;
const PLAN_KEYS = new Set([
  "schema_version",
  "primary",
  "fallback",
  "provenance",
  "concepts",
  "emphasis",
  "explanation",
  "reasons",
]);
const CONCEPT_KEYS = new Set(["id", "strength", "evidence"]);
const REASON_KEYS = new Set(["code", "subject"]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys, errors, where) {
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) errors.push(`${where}: unknown field "${key}"`);
  }
}

/** Validate a candidate plan. Returns `{ok, plan, errors}`; never throws. */
export function validatePlan(raw) {
  const errors = [];
  if (!isObject(raw)) {
    return { ok: false, plan: null, errors: ["plan: not an object"] };
  }
  exactKeys(raw, PLAN_KEYS, errors, "plan");
  for (const key of PLAN_KEYS) {
    if (!(key in raw)) errors.push(`plan: missing field "${key}"`);
  }
  if (raw.schema_version !== PLAN_VERSION) {
    errors.push(`plan: unsupported schema_version ${String(raw.schema_version)}`);
  }
  if (!isRendererId(raw.primary)) errors.push(`plan: unknown primary renderer "${String(raw.primary)}"`);
  if (!isRendererId(raw.fallback)) errors.push(`plan: unknown fallback renderer "${String(raw.fallback)}"`);
  if (raw.fallback !== DEFAULT_VIZ) errors.push(`plan: fallback must be "${DEFAULT_VIZ}"`);
  if (!PLAN_PROVENANCE.includes(raw.provenance)) {
    errors.push(`plan: unknown provenance "${String(raw.provenance)}"`);
  }
  if (!EXPLANATION_SET.has(raw.explanation)) {
    errors.push(`plan: unknown explanation level "${String(raw.explanation)}"`);
  }

  if (!Array.isArray(raw.concepts) || raw.concepts.length > PLAN_LIMITS.concepts) {
    errors.push("plan: concepts must be an array within bounds");
  } else {
    const seen = new Set();
    raw.concepts.forEach((concept, index) => {
      const where = `plan.concepts[${index}]`;
      if (!isObject(concept)) {
        errors.push(`${where}: not an object`);
        return;
      }
      exactKeys(concept, CONCEPT_KEYS, errors, where);
      if (!CONCEPT_SET.has(concept.id)) errors.push(`${where}: unknown concept "${String(concept.id)}"`);
      if (seen.has(concept.id)) errors.push(`${where}: duplicate concept "${String(concept.id)}"`);
      seen.add(concept.id);
      if (!EVIDENCE_SET.has(concept.strength)) {
        errors.push(`${where}: unknown evidence strength "${String(concept.strength)}"`);
      }
      if (!Array.isArray(concept.evidence) || concept.evidence.length > PLAN_LIMITS.evidencePerConcept) {
        errors.push(`${where}: evidence must be an array within bounds`);
        return;
      }
      for (const ref of concept.evidence) {
        if (typeof ref !== "string" || ref.length > 64 || !EVIDENCE_REF.test(ref)) {
          errors.push(`${where}: invalid evidence reference "${String(ref)}"`);
        }
      }
    });
  }

  if (!Array.isArray(raw.emphasis) || raw.emphasis.length > PLAN_LIMITS.emphasis) {
    errors.push("plan: emphasis must be an array within bounds");
  } else {
    for (const rule of raw.emphasis) {
      if (!EMPHASIS_SET.has(rule)) errors.push(`plan: unknown emphasis rule "${String(rule)}"`);
    }
  }

  if (!Array.isArray(raw.reasons) || raw.reasons.length < 1 || raw.reasons.length > PLAN_LIMITS.reasons) {
    errors.push("plan: reasons must be a non-empty array within bounds");
  } else {
    raw.reasons.forEach((reason, index) => {
      const where = `plan.reasons[${index}]`;
      if (!isObject(reason)) {
        errors.push(`${where}: not an object`);
        return;
      }
      exactKeys(reason, REASON_KEYS, errors, where);
      if (!REASON_SET.has(reason.code)) errors.push(`${where}: unknown reason code "${String(reason.code)}"`);
      if ("subject" in reason && (typeof reason.subject !== "string" || !SUBJECT.test(reason.subject))) {
        errors.push(`${where}: invalid subject`);
      }
    });
  }

  if (errors.length === 0 && JSON.stringify(raw).length > PLAN_LIMITS.characters) {
    errors.push("plan: larger than the allowed size");
  }
  return {
    ok: errors.length === 0,
    plan: errors.length === 0 ? JSON.parse(JSON.stringify(raw)) : null,
    errors,
  };
}

/** A valid plan that draws the generic motion canvas. */
export function fallbackPlan(reason = "fallback", concepts = []) {
  const safe = (Array.isArray(concepts) ? concepts : [])
    .filter(
      (concept) =>
        isObject(concept) &&
        CONCEPT_SET.has(concept.id) &&
        EVIDENCE_SET.has(concept.strength) &&
        Array.isArray(concept.evidence) &&
        concept.evidence.length <= PLAN_LIMITS.evidencePerConcept &&
        concept.evidence.every((ref) => typeof ref === "string" && EVIDENCE_REF.test(ref)),
    )
    .slice(0, PLAN_LIMITS.concepts);
  return validatePlan({
    schema_version: PLAN_VERSION,
    primary: DEFAULT_VIZ,
    fallback: DEFAULT_VIZ,
    provenance: "deterministic",
    concepts: safe,
    emphasis: ["values"],
    explanation: "standard",
    reasons: [{ code: REASON_SET.has(reason) ? reason : "fallback" }],
  }).plan;
}

/** Build and validate a plan from already-decided parts. */
export function makePlan({ primary, concepts = [], emphasis = ["values"], reasons, provenance = "deterministic", explanation = "standard" }) {
  const candidate = {
    schema_version: PLAN_VERSION,
    primary,
    fallback: DEFAULT_VIZ,
    provenance,
    concepts,
    emphasis,
    explanation,
    reasons,
  };
  const result = validatePlan(candidate);
  if (result.ok) return result.plan;
  return fallbackPlan("fallback", concepts);
}
