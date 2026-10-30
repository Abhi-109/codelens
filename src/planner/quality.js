// The explicit quality corpus: what each recorded program should open, and what
// "good" means for a plan. Expectations are authored by hand from what the run
// actually shows, not copied from the planner's current answer — the harness is
// only useful if it can disagree with the planner.
//
// The conservative recognizer is respected on purpose: a bubble sort on an
// already-sorted list proves no swap, so Motion is the honest canvas even though
// the program's name says "sort". Those cases are grouped under "misleading
// names".

import { canRender, rendererIds } from "./renderers.js";

export const EXPECTED_CANVAS = Object.freeze({
  // --- corpus programs -------------------------------------------------------
  "alias-dict-in-list": "motion",
  "alias-shared": "motion",
  "assign-only": "motion",
  "async-await": "motion",
  booleans: "motion",
  "break-continue": "flow",
  "call-chain": "tree",
  "class-basic": "motion",
  "class-inheritance": "motion",
  "class-property": "motion",
  "combo-class-loop-dict": "motion",
  "combo-exception-loop": "motion",
  "combo-nested-loop-call": "flow",
  "combo-recursion-list": "tree",
  "compare-chained": "motion",
  "compare-custom-result": "motion",
  comprehension: "motion",
  "dict-basics": "motion",
  "dict-nested": "motion",
  "dict-remove": "motion",
  "error-division": "motion",
  "error-index": "motion",
  "error-name": "motion",
  "error-syntax": "motion",
  "exception-caught": "motion",
  "exception-custom": "motion",
  "exception-reraise": "motion",
  "for-loop": "motion",
  "function-args": "motion",
  "function-basic": "motion",
  "function-early-return": "motion",
  "function-implicit-none": "motion",
  "function-print-return": "motion",
  "function-return-none": "motion",
  "function-star-args": "motion",
  generator: "motion",
  "generator-delegates": "tree",
  "if-elif-else": "flow",
  "if-nested": "flow",
  "import-module": "motion",
  "io-empty-print": "motion",
  "io-input": "motion",
  "io-print-options": "motion",
  "io-two-inputs": "motion",
  "lambda-key": "motion",
  "limit-output": "motion",
  "limit-steps": "motion",
  "limit-timeout": "motion",
  "list-basics": "motion",
  "list-duplicates": "motion",
  "list-insert-pop": "motion",
  "list-mutation": "motion",
  "list-print-element": "motion",
  "nested-lists": "motion",
  "nested-loops": "flow",
  numbers: "motion",
  recursion: "tree",
  "recursion-mutual": "tree",
  "scalars-only": "motion",
  "scope-closure": "motion",
  "scope-global": "motion",
  "set-basics": "motion",
  "sort-orders": "motion",
  strings: "motion",
  ternary: "motion",
  "tuple-unpack": "motion",
  variables: "motion",
  "while-loop": "motion",

  // --- recognition programs --------------------------------------------------
  "binary-duplicates": "motion",
  "binary-empty": "motion",
  "binary-first": "motion",
  "binary-last": "scene",
  "binary-missing": "scene",
  "binary-one": "motion",
  "binary-one-missing": "motion",
  "binary-search": "scene",
  "bubble-alias": "scene",
  "bubble-duplicates": "scene",
  "bubble-empty": "motion",
  "bubble-negative": "scene",
  "bubble-reverse": "scene",
  "bubble-single": "motion",
  "bubble-sort": "scene",
  "bubble-sorted": "motion",
  "bubble-truncated": "scene",
  "builtin-sort": "motion",
  "builtin-sorted": "motion",
  "count-matches": "motion",
  "dict-iteration": "motion",
  fibonacci: "tree",
  "filter-list": "motion",
  "insertion-sort": "scene",
  "linear-alias": "scene",
  "linear-break": "motion",
  "linear-dict": "motion",
  "linear-duplicates": "scene",
  "linear-empty": "motion",
  "linear-enumerate": "motion",
  "linear-first": "motion",
  "linear-flag": "motion",
  "linear-helper": "combined",
  "linear-index": "scene",
  "linear-item": "scene",
  "linear-item-duplicates": "scene",
  "linear-last": "scene",
  "linear-missing": "scene",
  "linear-mixed": "scene",
  "linear-truncated": "motion",
  "linear-tuple": "scene",
  "linear-while": "scene",
  "max-scan": "motion",
  "merge-sort": "scene",
  "merge-sort-duplicates": "scene",
  "merge-sort-empty": "combined",
  "plain-loop": "motion",
  "recursive-binary-search": "tree",
  "recursive-caught": "tree",
  "recursive-deep": "tree",
  "recursive-exception": "tree",
  "selection-sort": "scene",
  "sort-mixed": "motion",
});

/** The twenty behaviours Phase 7B must cover, each with the cases that prove it. */
export const REQUIRED_CATEGORIES = Object.freeze({
  "scalar assignments": ["assign-only", "variables"],
  "arithmetic and expressions": ["numbers", "compare-chained"],
  "conditional branches": ["if-nested", "if-elif-else", "ternary"],
  "simple loops": ["for-loop", "while-loop"],
  "nested loops": ["nested-loops", "combo-nested-loop-call"],
  "functions and return values": ["function-basic", "function-early-return"],
  "observed recursion": ["recursion", "fibonacci", "recursive-deep"],
  "sorting algorithms": ["bubble-sort", "insertion-sort", "selection-sort", "merge-sort"],
  "searching algorithms": ["linear-index", "binary-search", "recursive-binary-search"],
  "lists and list mutations": ["list-basics", "list-mutation"],
  "dictionaries and sets": ["dict-basics", "set-basics"],
  "aliasing and references": ["alias-shared", "alias-dict-in-list"],
  "classes and object attributes": ["class-basic", "class-property"],
  "nested calls combined with collections": ["combo-recursion-list", "linear-helper"],
  "caught exceptions": ["exception-caught", "combo-exception-loop"],
  "uncaught exceptions": ["error-division", "error-index", "error-name"],
  "empty input": ["binary-empty", "linear-empty", "bubble-empty", "io-empty-print"],
  "syntax errors": ["error-syntax"],
  "step-limit termination": ["limit-steps"],
  "misleading names": ["bubble-sorted", "binary-first", "linear-first", "binary-one"],
});

const FALLBACK_REASONS = new Set([
  "empty_trace",
  "source_syntax_error",
  "source_analysis_error",
  "source_invalid",
  "source_unsupported",
  "renderer_missing_evidence",
  "fallback",
]);

function rate(count, total) {
  return total === 0 ? 0 : Math.round((count / total) * 1000) / 1000;
}

/**
 * Score one plan against one expectation.
 *
 * `supported` treats a validated fallback as supported by definition: falling
 * back is what the schema promises when the evidence is missing.
 */
export function evaluateCase({ name, plan, analysis, recognition, expected, hasFlow = true }) {
  const trace = analysis?.trace ?? {};
  const reasons = (plan?.reasons ?? []).map((reason) => reason.code);
  const fallback = reasons.some((code) => FALLBACK_REASONS.has(code));
  const registered = Boolean(plan) && rendererIds().includes(plan.primary);
  const supported = Boolean(plan) && (fallback || canRender(plan.primary, { trace, hasFlow }).ok);

  const claims = [];
  if (reasons.includes("recognized_sorting") && recognition?.adapterId !== "sorting") claims.push("sorting");
  if (reasons.includes("recognized_searching") && recognition?.adapterId !== "searching") claims.push("searching");
  if (reasons.includes("observed_recursion")) {
    const recursion = (analysis?.concepts ?? []).find((concept) => concept.id === "recursion");
    if (recursion?.strength !== "observed") claims.push("recursion");
  }

  return {
    name,
    expected,
    primary: plan?.primary ?? null,
    registered,
    supported,
    appropriate: Boolean(plan) && plan.primary === expected,
    fallback,
    claims,
  };
}

/** Turn per-case rows into the rates the phase report quotes. */
export function summarize(rows) {
  const total = rows.length;
  const count = (predicate) => rows.filter(predicate).length;
  return {
    total,
    registered: { count: count((row) => row.registered), rate: rate(count((row) => row.registered), total) },
    evidenceSupported: { count: count((row) => row.supported), rate: rate(count((row) => row.supported), total) },
    appropriate: { count: count((row) => row.appropriate), rate: rate(count((row) => row.appropriate), total) },
    fallback: { count: count((row) => row.fallback), rate: rate(count((row) => row.fallback), total) },
    rejected: { count: count((row) => row.rejected), rate: rate(count((row) => row.rejected), total) },
    unsupportedClaims: count((row) => row.claims.length > 0),
    misses: rows
      .filter((row) => !row.appropriate)
      .map((row) => ({ name: row.name, expected: row.expected, primary: row.primary })),
  };
}




