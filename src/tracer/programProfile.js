// The browser-side contract for tracer-poc/analyze.py.
//
// The Python analyzer returns a static, versioned program profile. This module
// validates that shape and always returns the same normalised object: malformed
// JSON, missing fields, a bad version or a syntax error become diagnostics, not
// an exception and never a made-up function. The profile is metadata only; it
// shares no state with the execution trace.

export const PROGRAM_PROFILE_VERSION = 1;
export const PROGRAM_PROFILE_KIND = "program_profile";

const STATUSES = new Set(["ok", "syntax_error", "analysis_error", "invalid", "unsupported"]);
const SEVERITIES = new Set(["error", "warning", "info"]);
const RESOLUTIONS = new Set(["self", "name_candidate", "method_candidate", "unresolved"]);
const PARAMETER_KINDS = new Set([
  "positional_only",
  "positional",
  "vararg",
  "keyword_only",
  "kwarg",
]);

const EMPTY_LISTS = {
  functions: [],
  calls: [],
  loops: [],
  conditions: [],
  decisions: [],
  comparisons: [],
  mutations: [],
  returns: [],
  container_operations: [],
};

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function numberOrNull(value, minimum = 0) {
  return isNumber(value) && value >= minimum ? value : null;
}

function stringOrNull(value) {
  return typeof value === "string" ? value : null;
}

function stringList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item) => typeof item === "string" && item.length > 0))].sort();
}

/** Ordered string lists (comparison operators) must keep their source order. */
function stringArray(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string" && item.length > 0)
    : [];
}

function rangeOf(raw) {
  return {
    line: numberOrNull(raw?.line, 1),
    column: numberOrNull(raw?.column),
    end_line: numberOrNull(raw?.end_line, 1),
    end_column: numberOrNull(raw?.end_column),
  };
}

function summaryOf(raw) {
  if (typeof raw === "string") return { kind: "unknown", label: raw };
  if (!isObject(raw)) return null;
  const label = stringOrNull(raw.label);
  if (label === null) return null;
  return {
    kind: stringOrNull(raw.kind) ?? "unknown",
    label,
  };
}

function emptyProfile(status, diagnostics, source = null) {
  return {
    profile_version: PROGRAM_PROFILE_VERSION,
    kind: PROGRAM_PROFILE_KIND,
    language: "python",
    status,
    source: {
      lines: numberOrNull(source?.lines, 0),
      characters: numberOrNull(source?.characters, 0),
    },
    diagnostics,
    ...Object.fromEntries(Object.entries(EMPTY_LISTS).map(([key, value]) => [key, [...value]])),
    call_graph: {},
    recursion: { direct: [], mutual_candidates: [] },
    summary: {
      functions: 0,
      calls: 0,
      loops: 0,
      max_loop_depth: 0,
      conditions: 0,
      decisions: 0,
      comparisons: 0,
      mutations: 0,
      returns: 0,
      container_operations: 0,
      direct_recursive_functions: [],
      mutual_recursion_candidates: [],
    },
  };
}

function diagnostic(code, message, extra = {}) {
  return {
    code,
    message,
    severity: SEVERITIES.has(extra.severity) ? extra.severity : "error",
    line: numberOrNull(extra.line, 1),
    column: numberOrNull(extra.column),
    end_line: numberOrNull(extra.end_line, 1),
    end_column: numberOrNull(extra.end_column),
  };
}

function normalizeDiagnostic(raw, fallbackCode) {
  if (!isObject(raw)) return null;
  const message = stringOrNull(raw.message);
  if (message === null) return null;
  return diagnostic(stringOrNull(raw.code) || fallbackCode, message, raw);
}

function arrayOf(raw, key, diagnostics) {
  if (raw[key] == null) return [];
  if (!Array.isArray(raw[key])) {
    diagnostics.push(diagnostic(`${key}_not_array`, `${key} must be an array`));
    return [];
  }
  return raw[key];
}

function normalizeList(items, normalizer, code, diagnostics) {
  const out = [];
  for (const item of items) {
    try {
      const normalized = normalizer(item);
      if (normalized) out.push(normalized);
      else diagnostics.push(diagnostic(code, `dropped an invalid ${code.replace(/_/g, " ")}`));
    } catch {
      diagnostics.push(diagnostic(code, `dropped an unreadable ${code.replace(/_/g, " ")}`));
    }
  }
  return out;
}

function normalizeParameter(raw) {
  if (!isObject(raw) || typeof raw.name !== "string" || raw.name.length === 0) return null;
  return {
    name: raw.name,
    kind: PARAMETER_KINDS.has(raw.kind) ? raw.kind : "unknown",
    has_default: raw.has_default === true,
    default: summaryOf(raw.default),
    annotation: summaryOf(raw.annotation),
    ...rangeOf(raw),
  };
}

function normalizeDecorator(raw) {
  const summary = summaryOf(raw);
  if (!summary) return null;
  return { ...summary, ...rangeOf(raw) };
}

function normalizeFunction(raw) {
  if (
    !isObject(raw) ||
    typeof raw.id !== "string" ||
    raw.id.length === 0 ||
    typeof raw.name !== "string" ||
    raw.name.length === 0
  ) {
    return null;
  }
  return {
    id: raw.id,
    name: raw.name,
    qualified_name: stringOrNull(raw.qualified_name) ?? raw.name,
    kind: stringOrNull(raw.kind) ?? "function",
    async: raw.async === true,
    class: stringOrNull(raw.class),
    parent_function_id: stringOrNull(raw.parent_function_id),
    ...rangeOf(raw),
    parameters: Array.isArray(raw.parameters)
      ? normalizeList(raw.parameters, normalizeParameter, "invalid_parameter", [])
      : [],
    decorators: Array.isArray(raw.decorators)
      ? normalizeList(raw.decorators, normalizeDecorator, "invalid_decorator", [])
      : [],
    call_ids: stringArray(raw.call_ids),
    return_ids: stringArray(raw.return_ids),
    direct_self_recursion: raw.direct_self_recursion === true,
    call_count: numberOrNull(raw.call_count) ?? 0,
    return_count: numberOrNull(raw.return_count) ?? 0,
    has_return_value: raw.has_return_value === true,
  };
}

function normalizeCall(raw) {
  if (
    !isObject(raw) ||
    typeof raw.id !== "string" ||
    raw.id.length === 0 ||
    typeof raw.caller !== "string" ||
    raw.caller.length === 0
  ) {
    return null;
  }
  return {
    id: raw.id,
    caller: raw.caller,
    name: stringOrNull(raw.name),
    target: stringOrNull(raw.target),
    attribute: raw.attribute === true,
    receiver: stringOrNull(raw.receiver),
    resolution: RESOLUTIONS.has(raw.resolution) ? raw.resolution : "unresolved",
    candidate_function_ids: stringList(raw.candidate_function_ids),
    resolved_function_id: stringOrNull(raw.resolved_function_id),
    self_recursion: raw.self_recursion === true,
    arg_count: numberOrNull(raw.arg_count) ?? 0,
    keyword_count: numberOrNull(raw.keyword_count) ?? 0,
    has_star_args: raw.has_star_args === true,
    has_star_kwargs: raw.has_star_kwargs === true,
    ...rangeOf(raw),
  };
}

function normalizeLoop(raw) {
  if (!isObject(raw) || typeof raw.id !== "string" || raw.id.length === 0) return null;
  return {
    id: raw.id,
    kind: stringOrNull(raw.kind) ?? "loop",
    function_id: stringOrNull(raw.function_id),
    depth: numberOrNull(raw.depth) ?? 0,
    parent_id: stringOrNull(raw.parent_id),
    condition_id: stringOrNull(raw.condition_id),
    condition: summaryOf(raw.condition),
    target: summaryOf(raw.target),
    iterator: summaryOf(raw.iterator),
    ...rangeOf(raw),
  };
}

function normalizeCondition(raw) {
  if (!isObject(raw) || typeof raw.id !== "string" || raw.id.length === 0) return null;
  return {
    id: raw.id,
    kind: stringOrNull(raw.kind) ?? "condition",
    function_id: stringOrNull(raw.function_id),
    loop_depth: numberOrNull(raw.loop_depth) ?? 0,
    expression: summaryOf(raw.expression),
    operators: stringArray(raw.operators),
    ...rangeOf(raw),
  };
}

function normalizeDecision(raw) {
  if (!isObject(raw) || typeof raw.id !== "string" || raw.id.length === 0) return null;
  const out = {
    id: raw.id,
    kind: stringOrNull(raw.kind) ?? "decision",
    function_id: stringOrNull(raw.function_id),
    loop_depth: numberOrNull(raw.loop_depth) ?? 0,
    condition_id: stringOrNull(raw.condition_id),
    condition: summaryOf(raw.condition),
    iterator: summaryOf(raw.iterator),
    loop_id: stringOrNull(raw.loop_id),
    is_elif: raw.is_elif === true,
    ...rangeOf(raw),
  };
  if (raw.subject != null) out.subject = summaryOf(raw.subject);
  return out;
}

function normalizeComparison(raw) {
  if (!isObject(raw) || typeof raw.id !== "string" || raw.id.length === 0) return null;
  return {
    id: raw.id,
    function_id: stringOrNull(raw.function_id),
    loop_depth: numberOrNull(raw.loop_depth) ?? 0,
    left: summaryOf(raw.left),
    operators: stringArray(raw.operators),
    comparators: Array.isArray(raw.comparators)
      ? raw.comparators.map(summaryOf).filter(Boolean)
      : [],
    ...rangeOf(raw),
  };
}

function normalizeMutation(raw) {
  if (!isObject(raw) || typeof raw.id !== "string" || raw.id.length === 0) return null;
  return {
    id: raw.id,
    kind: stringOrNull(raw.kind) ?? "mutation",
    operation: stringOrNull(raw.operation) ?? "unknown",
    function_id: stringOrNull(raw.function_id),
    loop_depth: numberOrNull(raw.loop_depth) ?? 0,
    target: summaryOf(raw.target),
    container: summaryOf(raw.container),
    container_kind: stringOrNull(raw.container_kind) ?? "unknown",
    certainty: stringOrNull(raw.certainty) ?? "unknown",
    ...rangeOf(raw),
  };
}

function normalizeReturn(raw) {
  if (!isObject(raw) || typeof raw.id !== "string" || raw.id.length === 0) return null;
  return {
    id: raw.id,
    function_id: stringOrNull(raw.function_id),
    loop_depth: numberOrNull(raw.loop_depth) ?? 0,
    has_value: raw.has_value === true,
    value: summaryOf(raw.value),
    ...rangeOf(raw),
  };
}

function normalizeContainerOperation(raw) {
  if (!isObject(raw) || typeof raw.id !== "string" || raw.id.length === 0) return null;
  return {
    id: raw.id,
    function_id: stringOrNull(raw.function_id),
    operation: stringOrNull(raw.operation) ?? "unknown",
    kind: stringOrNull(raw.kind) ?? "container",
    container_kind: stringOrNull(raw.container_kind),
    loop_depth: numberOrNull(raw.loop_depth) ?? 0,
    mutation_id: stringOrNull(raw.mutation_id),
    target: summaryOf(raw.target),
    ...rangeOf(raw),
  };
}

function normalizeCallGraph(raw, diagnostics) {
  if (raw == null) return {};
  if (!isObject(raw)) {
    diagnostics.push(diagnostic("call_graph_not_object", "call_graph must be an object"));
    return {};
  }
  const out = {};
  for (const key of Object.keys(raw).sort()) {
    if (typeof key !== "string" || key.length === 0) continue;
    if (!Array.isArray(raw[key])) {
      diagnostics.push(diagnostic("call_graph_targets_not_array", "call_graph targets must be arrays"));
      continue;
    }
    out[key] = stringList(raw[key]);
  }
  return out;
}

function normalizeRecursion(raw, diagnostics) {
  if (raw == null) return { direct: [], mutual_candidates: [] };
  if (!isObject(raw)) {
    diagnostics.push(diagnostic("recursion_not_object", "recursion must be an object"));
    return { direct: [], mutual_candidates: [] };
  }
  let mutual = [];
  if (raw.mutual_candidates != null) {
    if (!Array.isArray(raw.mutual_candidates)) {
      diagnostics.push(
        diagnostic("mutual_recursion_not_array", "mutual_candidates must be an array"),
      );
    } else {
      mutual = raw.mutual_candidates
        .filter((group) => Array.isArray(group))
        .map((group) => stringList(group))
        .filter((group) => group.length > 1);
      mutual.sort((a, b) => {
        const left = a.join("\u0000");
        const right = b.join("\u0000");
        return left < right ? -1 : left > right ? 1 : 0;
      });
    }
  }
  return { direct: stringList(raw.direct), mutual_candidates: mutual };
}

function normalizeSummaryObject(functions, calls, loops, conditions, decisions, comparisons, mutations, returns, operations, recursion) {
  return {
    functions: functions.length,
    calls: calls.length,
    loops: loops.length,
    max_loop_depth: loops.reduce((max, loop) => Math.max(max, loop.depth), 0),
    conditions: conditions.length,
    decisions: decisions.length,
    comparisons: comparisons.length,
    mutations: mutations.length,
    returns: returns.length,
    container_operations: operations.length,
    direct_recursive_functions: functions
      .filter((fn) => fn.direct_self_recursion)
      .map((fn) => fn.id)
      .sort(),
    mutual_recursion_candidates: recursion.mutual_candidates,
  };
}

function normalizeProfile(raw) {
  const diagnostics = [];
  if (!isObject(raw)) {
    return emptyProfile(
      "invalid",
      [diagnostic("not_an_object", "program profile must be a JSON object")],
    );
  }

  if (raw.profile_version !== PROGRAM_PROFILE_VERSION) {
    const version = raw.profile_version;
    const missing = version == null;
    return emptyProfile(
      missing ? "invalid" : "unsupported",
      [
        diagnostic(
          missing ? "missing_profile_version" : "unsupported_profile_version",
          missing
            ? "program profile has no profile_version"
            : `unsupported program profile version: ${String(version)}`,
        ),
      ],
      raw.source,
    );
  }
  if (raw.kind != null && raw.kind !== PROGRAM_PROFILE_KIND) {
    return emptyProfile(
      "invalid",
      [diagnostic("wrong_profile_kind", `profile kind must be ${PROGRAM_PROFILE_KIND}`)],
      raw.source,
    );
  }
  if (raw.language != null && raw.language !== "python") {
    return emptyProfile(
      "unsupported",
      [diagnostic("unsupported_language", `unsupported profile language: ${String(raw.language)}`)],
      raw.source,
    );
  }
  if (!STATUSES.has(raw.status)) {
    return emptyProfile(
      "invalid",
      [diagnostic("invalid_status", "program profile has an unknown status")],
      raw.source,
    );
  }

  const status = raw.status;
  if (status !== "ok") {
    return emptyProfile(
      status,
      Array.isArray(raw.diagnostics)
        ? raw.diagnostics
            .map((entry) => normalizeDiagnostic(entry, "profile_diagnostic"))
            .filter(Boolean)
        : [],
      raw.source,
    );
  }

  const functions = normalizeList(
    arrayOf(raw, "functions", diagnostics),
    normalizeFunction,
    "invalid_function",
    diagnostics,
  );
  const calls = normalizeList(
    arrayOf(raw, "calls", diagnostics),
    normalizeCall,
    "invalid_call",
    diagnostics,
  );
  const loops = normalizeList(
    arrayOf(raw, "loops", diagnostics),
    normalizeLoop,
    "invalid_loop",
    diagnostics,
  );
  const conditions = normalizeList(
    arrayOf(raw, "conditions", diagnostics),
    normalizeCondition,
    "invalid_condition",
    diagnostics,
  );
  const decisions = normalizeList(
    arrayOf(raw, "decisions", diagnostics),
    normalizeDecision,
    "invalid_decision",
    diagnostics,
  );
  const comparisons = normalizeList(
    arrayOf(raw, "comparisons", diagnostics),
    normalizeComparison,
    "invalid_comparison",
    diagnostics,
  );
  const mutations = normalizeList(
    arrayOf(raw, "mutations", diagnostics),
    normalizeMutation,
    "invalid_mutation",
    diagnostics,
  );
  const returns = normalizeList(
    arrayOf(raw, "returns", diagnostics),
    normalizeReturn,
    "invalid_return",
    diagnostics,
  );
  const operations = normalizeList(
    arrayOf(raw, "container_operations", diagnostics),
    normalizeContainerOperation,
    "invalid_container_operation",
    diagnostics,
  );
  const callGraph = normalizeCallGraph(raw.call_graph, diagnostics);
  const recursion = normalizeRecursion(raw.recursion, diagnostics);
  const analyzerDiagnostics = Array.isArray(raw.diagnostics)
    ? raw.diagnostics
        .map((entry) => normalizeDiagnostic(entry, "analyzer_diagnostic"))
        .filter(Boolean)
    : [];

  return {
    profile_version: PROGRAM_PROFILE_VERSION,
    kind: PROGRAM_PROFILE_KIND,
    language: "python",
    status: "ok",
    source: {
      lines: numberOrNull(raw.source?.lines, 0),
      characters: numberOrNull(raw.source?.characters, 0),
    },
    diagnostics: [...analyzerDiagnostics, ...diagnostics],
    functions,
    calls,
    loops,
    conditions,
    decisions,
    comparisons,
    mutations,
    returns,
    container_operations: operations,
    call_graph: callGraph,
    recursion,
    summary: normalizeSummaryObject(
      functions,
      calls,
      loops,
      conditions,
      decisions,
      comparisons,
      mutations,
      returns,
      operations,
      recursion,
    ),
  };
}

/**
 * Validate one analyzer response. Accepts an object or its JSON text and never
 * throws for bad input; malformed responses become a profile with diagnostics.
 */
export function parseProgramProfile(input) {
  let raw = input;
  if (typeof input === "string") {
    try {
      raw = JSON.parse(input);
    } catch {
      return emptyProfile(
        "invalid",
        [diagnostic("malformed_json", "program profile is not valid JSON")],
      );
    }
  }
  try {
    return normalizeProfile(raw);
  } catch {
    return emptyProfile(
      "invalid",
      [diagnostic("normalization_error", "program profile could not be normalised")],
    );
  }
}

/** Object-in, object-out alias for callers that already parsed the JSON. */
export function normalizeProgramProfile(input) {
  return parseProgramProfile(input);
}
