// The deterministic planner. Pure, explainable, and independent of React,
// network and the execution cursor: it reads a concept report and the existing
// recognizer's conclusion, then names one real canvas with a reason code.
//
// Structure alone can suggest a canvas; only observed evidence can prove one.
// Recursion that is merely visible in the AST therefore does not open the call
// tree, and a sorting-shaped loop does not become "sorting" without the
// recognizer's runtime evidence.

import { VIZ_LABELS } from "../visualizer/vizMode.js";
import { canRender } from "./renderers.js";
import { fallbackPlan, makePlan } from "./plan.js";

export const PLAN_REASON_TEXT = Object.freeze({
  recognized_sorting: "sorting comparisons and collection changes were observed",
  recognized_searching: "a search over a sequence was observed",
  observed_recursion: "the same function ran at more than one depth",
  nested_calls_with_collections: "nested calls and collection changes were observed",
  nested_calls: "calls nested inside other calls were observed",
  branch_heavy: "the run is mostly decisions",
  collection_motion: "the run changes a collection",
  generic_values: "no specialized pattern was proven",
  empty_trace: "there are no recorded steps to draw",
  source_syntax_error: "the source did not compile",
  source_analysis_error: "the source could not be analysed",
  source_invalid: "the analysis result was not usable",
  source_unsupported: "the source uses something the analyser does not support",
  renderer_missing_evidence: "the better canvas needs evidence this run does not have",
  ai_selected: "the optional planner chose this canvas",
  ai_rejected: "the optional planner's answer was rejected",
  fallback: "the plan fell back to the generic canvas",
});

const STATUS_REASON = {
  syntax_error: "source_syntax_error",
  analysis_error: "source_analysis_error",
  invalid: "source_invalid",
  unsupported: "source_unsupported",
  empty: "empty_trace",
};

const COLLECTION_CONCEPTS = new Set([
  "list",
  "tuple",
  "dict_lookup",
  "dict_mutation",
  "set",
  "collection_mutation",
]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function conceptMap(concepts) {
  const map = new Map();
  for (const concept of Array.isArray(concepts) ? concepts : []) {
    if (isObject(concept) && typeof concept.id === "string") map.set(concept.id, concept);
  }
  return map;
}

function planConcepts(map) {
  return [...map.values()].map((concept) => ({
    id: concept.id,
    strength: concept.strength,
    evidence: Array.isArray(concept.evidence) ? concept.evidence.slice(0, 3) : [],
  }));
}

function hasCollection(map) {
  return [...map.keys()].some((id) => COLLECTION_CONCEPTS.has(id));
}

function emphasisFor(primary, map) {
  if (primary === "tree" || primary === "combined") return ["calls", "values"];
  if (primary === "flow") return ["control"];
  if (primary === "scene") return ["collections", "values"];
  if (hasCollection(map)) return ["collections", "values"];
  return ["values"];
}

/**
 * Choose a canvas for one run.
 *
 * @param {{analysis?: object, recognition?: {adapterId?: string}, hasFlow?: boolean}} input
 * @returns {object} a validated plan
 */
export function planVisualization(input = {}) {
  const analysis = isObject(input?.analysis) ? input.analysis : null;
  const recognition = isObject(input?.recognition) ? input.recognition : {};
  const concepts = conceptMap(analysis?.concepts);
  const planConceptsList = planConcepts(concepts);
  const counts = isObject(analysis?.counts) ? analysis.counts : {};
  const trace = isObject(analysis?.trace) ? analysis.trace : {};
  const evidence = { trace, hasFlow: input?.hasFlow === true };

  if (!analysis) return fallbackPlan("source_invalid", planConceptsList);
  if (analysis.status !== "ok") {
    return fallbackPlan(STATUS_REASON[analysis.status] ?? "source_invalid", planConceptsList);
  }

  const choose = (primary, reason) => {
    const capability = canRender(primary, evidence);
    if (!capability.ok) {
      return fallbackPlan("renderer_missing_evidence", planConceptsList);
    }
    return makePlan({
      primary,
      concepts: planConceptsList,
      emphasis: emphasisFor(primary, concepts),
      reasons: [{ code: reason }],
    });
  };

  if (recognition.adapterId === "sorting") return choose("scene", "recognized_sorting");
  if (recognition.adapterId === "searching") return choose("scene", "recognized_searching");

  if (concepts.get("recursion")?.strength === "observed") {
    return choose("tree", "observed_recursion");
  }

  if (concepts.get("nested_calls")) {
    return hasCollection(concepts)
      ? choose("combined", "nested_calls_with_collections")
      : choose("tree", "nested_calls");
  }

  const branchHeavy =
    (counts.conditions ?? 0) >= 2 && !concepts.has("function") && !hasCollection(concepts);
  if (branchHeavy) return choose("flow", "branch_heavy");

  if (hasCollection(concepts)) return choose("motion", "collection_motion");
  return choose("motion", "generic_values");
}

/** One restrained sentence for the canvas toolbar. */
export function describePlan(plan) {
  const primary = plan?.primary;
  const reason = plan?.reasons?.[0]?.code;
  const label = VIZ_LABELS[primary] ?? primary ?? "Motion";
  const text = PLAN_REASON_TEXT[reason] ?? PLAN_REASON_TEXT.fallback;
  return `${label}: ${text}`;
}
