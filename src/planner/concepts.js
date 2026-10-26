// Deterministic concept detection.
//
// The program profile says what the syntax can do; the trace says what actually
// ran. This module reads both and returns a closed list of concept candidates,
// each carrying evidence whose strength is one of three words rather than a
// number: `observed` (the trace shows it), `structural` (the AST shows the
// shape), `derived` (an existing recognizer concluded it), `hypothesis` (a
// pattern that is worth mentioning but proves nothing). A name alone never
// becomes a classification.

import { normalizeProgramProfile } from "../tracer/programProfile.js";

export const CONCEPT_IDS = Object.freeze([
  "scalars",
  "assignment",
  "reassignment",
  "branch",
  "loop",
  "nested_loop",
  "sequence_traversal",
  "index_iteration",
  "comparison",
  "function",
  "call",
  "recursion",
  "nested_calls",
  "return",
  "list",
  "tuple",
  "dict_lookup",
  "dict_mutation",
  "set",
  "class",
  "attribute_access",
  "attribute_mutation",
  "collection_mutation",
  "exception_handling",
  "raise",
  "output",
  "search_like",
  "sort_like",
  "graph_like",
]);

export const EVIDENCE_KINDS = Object.freeze([
  "structural",
  "observed",
  "derived",
  "hypothesis",
]);

const SCALAR_TYPES = new Set(["int", "float", "bool", "str", "none"]);
const MUTABLE_KINDS = new Set(["list", "dict", "set", "tuple"]);
const NEIGHBOUR_NAMES = new Set(["neighbors", "neighbours", "edges", "adjacent", "children"]);
const CONCEPT_SET = new Set(CONCEPT_IDS);
const EVIDENCE_RANK = { hypothesis: 0, structural: 1, derived: 2, observed: 3 };

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function includesOperator(comparison, operators) {
  return list(comparison?.operators).some((op) => operators.includes(op));
}

/** A bounded summary of what the run actually did. No raw events leave here. */
function summarizeTrace(trace, result) {
  const summary = {
    events: 0,
    lines: 0,
    calls: 0,
    returns: 0,
    comparisons: 0,
    exceptions: 0,
    unwinds: 0,
    outputs: 0,
    inputs: 0,
    maxDepth: 0,
    hasFrames: false,
    recursive: false,
    scalars: 0,
    boundVariables: 0,
    reassigned: false,
    heapKinds: {},
    objectAttrs: [],
    truncated: false,
    termination: typeof result?.status === "string" ? result.status : "unknown",
  };
  const lastVariables = new Map();
  const attrs = new Set();
  for (const event of list(trace)) {
    if (!isObject(event)) continue;
    summary.events += 1;
    switch (event.event) {
      case "line":
        summary.lines += 1;
        break;
      case "call":
        summary.calls += 1;
        break;
      case "return":
        summary.returns += 1;
        break;
      case "compare":
        summary.comparisons += 1;
        break;
      case "exception":
        summary.exceptions += 1;
        break;
      case "unwind":
        summary.unwinds += 1;
        break;
      case "output":
        summary.outputs += 1;
        break;
      case "input":
        summary.inputs += 1;
        break;
      default:
        break;
    }
    const frames = list(event.frames);
    if (frames.length > 0) {
      summary.hasFrames = true;
      summary.maxDepth = Math.max(summary.maxDepth, frames.length);
      const names = frames.map((frame) => frame?.function).filter(Boolean);
      if (new Set(names).size < names.length) summary.recursive = true;
      const top = frames[frames.length - 1];
      const variables = isObject(top?.variables) ? top.variables : {};
      const namesInFrame = Object.keys(variables);
      if (namesInFrame.length > 0) summary.boundVariables += 1;
      for (const value of Object.values(variables)) {
        if (SCALAR_TYPES.has(value?.type)) summary.scalars += 1;
      }
      const key = String(top?.frame_id ?? "?");
      const snapshot = JSON.stringify(variables);
      if (lastVariables.has(key) && lastVariables.get(key) !== snapshot) summary.reassigned = true;
      lastVariables.set(key, snapshot);
    }
    if (isObject(event.heap)) {
      for (const entry of Object.values(event.heap)) {
        const kind = entry?.type;
        if (typeof kind !== "string") continue;
        summary.heapKinds[kind] = (summary.heapKinds[kind] ?? 0) + 1;
        if (kind === "object") {
          for (const attr of list(entry.attrs)) {
            if (typeof attr?.name === "string" && attrs.size < 32) attrs.add(attr.name);
          }
        }
      }
    }
  }
  summary.objectAttrs = [...attrs].sort();
  return summary;
}

function profileCounts(profile) {
  const loops = list(profile?.loops);
  const conditions = list(profile?.conditions);
  const calls = list(profile?.calls);
  const functions = list(profile?.functions);
  const returns = list(profile?.returns);
  const comparisons = list(profile?.comparisons);
  const mutations = list(profile?.mutations);
  const operations = list(profile?.container_operations);
  return {
    functions: functions.length,
    calls: calls.length,
    loops: loops.length,
    maxLoopDepth: loops.reduce((max, loop) => Math.max(max, Number(loop?.depth) || 0), 0),
    conditions: conditions.length,
    comparisons: comparisons.length,
    mutations: mutations.length,
    returns: returns.length,
    containerOperations: operations.length,
  };
}

function hasNestedCallGraph(callGraph) {
  if (!isObject(callGraph)) return false;
  return Object.values(callGraph).some((callees) => list(callees).length > 0) &&
    Object.keys(callGraph).some((caller) => list(callGraph[caller]).some((callee) => list(callGraph[callee]).length > 0));
}

function collect(profile, trace, result, recognition) {
  const found = new Map();
  const add = (id, strength, ref) => {
    if (!CONCEPT_SET.has(id)) return;
    const entry = found.get(id) ?? { id, strength, evidence: [] };
    // A stronger observation replaces the weaker label, but every piece of
    // evidence is kept so the plan can show why.
    if (EVIDENCE_RANK[strength] > EVIDENCE_RANK[entry.strength]) {
      entry.strength = strength;
    }
    if (entry.evidence.length < 3 && !entry.evidence.includes(ref)) entry.evidence.push(ref);
    found.set(id, entry);
  };

  const loops = list(profile.loops);
  const conditions = list(profile.conditions);
  const comparisons = list(profile.comparisons);
  const mutations = list(profile.mutations);
  const operations = list(profile.container_operations);
  const functions = list(profile.functions);
  const recursion = isObject(profile.recursion) ? profile.recursion : {};
  const opsOf = (name) => operations.some((op) => op?.operation === name);
  const mutationOf = (kind) => mutations.some((mutation) => mutation?.container_kind === kind);
  const heap = trace.heapKinds;

  if (trace.scalars > 0) add("scalars", "observed", "trace.values");
  if (trace.boundVariables > 0) add("assignment", "observed", "trace.variables");
  if (trace.reassigned) add("reassignment", "observed", "trace.reassignment");

  if (conditions.length > 0) add("branch", "structural", "profile.conditions");
  if (loops.length > 0) add("loop", "structural", "profile.loops");
  if (loops.some((loop) => (Number(loop?.depth) || 0) >= 2)) {
    add("nested_loop", "structural", "profile.loops");
  }
  if (
    loops.some(
      (loop) =>
        loop?.kind === "for" &&
        !String(loop?.iterator?.label ?? "").startsWith("range(") &&
        !String(loop?.iterator?.label ?? "").startsWith("enumerate("),
    )
  ) {
    add("sequence_traversal", "structural", "profile.loops");
  }
  if (
    loops.some((loop) => String(loop?.iterator?.label ?? "").startsWith("range(")) ||
    operations.some((op) => op?.operation === "index_read" && (Number(op?.loop_depth) || 0) > 0)
  ) {
    add("index_iteration", "structural", "profile.container_operations");
  }

  if (trace.comparisons > 0) add("comparison", "observed", "trace.compare");
  else if (comparisons.length > 0) add("comparison", "structural", "profile.comparisons");

  if (functions.length > 0) add("function", "structural", "profile.functions");
  if (trace.calls > 1) add("call", "observed", "trace.call");
  else if (list(profile.calls).length > 0) add("call", "structural", "profile.calls");

  if (list(recursion.direct).length > 0) add("recursion", "structural", "profile.recursion.direct");
  if (trace.recursive) add("recursion", "observed", "trace.frames");

  if (trace.maxDepth >= 3) add("nested_calls", "observed", "trace.frames");
  else if (hasNestedCallGraph(profile.call_graph)) {
    add("nested_calls", "structural", "profile.call_graph");
  }

  if (trace.returns > 0) add("return", "observed", "trace.return");
  else if (list(profile.returns).length > 0) add("return", "structural", "profile.returns");

  if (heap.list > 0 || opsOf("list_literal")) add("list", heap.list > 0 ? "observed" : "structural", heap.list > 0 ? "trace.heap.list" : "profile.container_operations");
  if (heap.tuple > 0 || opsOf("tuple_literal")) add("tuple", heap.tuple > 0 ? "observed" : "structural", heap.tuple > 0 ? "trace.heap.tuple" : "profile.container_operations");
  if (heap.set > 0 || opsOf("set_literal")) add("set", heap.set > 0 ? "observed" : "structural", heap.set > 0 ? "trace.heap.set" : "profile.container_operations");

  const hasDict = heap.dict > 0 || opsOf("dict_literal") || mutationOf("dict");
  if (hasDict && operations.some((op) => op?.operation === "index_read")) {
    add("dict_lookup", "structural", "profile.container_operations");
  }
  if (mutationOf("dict")) add("dict_mutation", "structural", "profile.mutations");

  if (functions.some((fn) => fn?.kind === "method" || typeof fn?.class === "string")) {
    add("class", "structural", "profile.functions");
  }
  if (heap.object > 0) add("class", "observed", "trace.heap.object");
  if (found.has("class")) add("attribute_access", "structural", "profile.functions");
  if (mutationOf("attribute")) {
    add("attribute_access", "structural", "profile.mutations");
    add("attribute_mutation", "structural", "profile.mutations");
  }

  if (mutations.some((mutation) => MUTABLE_KINDS.has(mutation?.container_kind))) {
    add("collection_mutation", "structural", "profile.mutations");
  }

  if (trace.exceptions > 0 || trace.unwinds > 0) {
    add("exception_handling", "observed", "trace.exception");
  }
  if (trace.exceptions > 0) add("raise", "observed", "trace.exception");
  if (trace.outputs > 0 || (typeof result?.output === "string" && result.output.length > 0)) {
    add("output", "observed", "trace.output");
  }

  const adapter = recognition?.adapterId;
  if (adapter === "searching") add("search_like", "derived", "recognition.searching");
  else if (
    loops.length > 0 &&
    comparisons.some(
      (comparison) =>
        (Number(comparison?.loop_depth) || 0) > 0 && includesOperator(comparison, ["=="]),
    ) &&
    operations.some((op) => op?.operation === "index_read" && (Number(op?.loop_depth) || 0) > 0)
  ) {
    // The shape is search-like, but only the trace can prove a search ran.
    add("search_like", "hypothesis", "derived.search_shape");
  }

  if (adapter === "sorting") add("sort_like", "derived", "recognition.sorting");
  else if (
    comparisons.some(
      (comparison) =>
        (Number(comparison?.loop_depth) || 0) > 0 &&
        includesOperator(comparison, ["<", "<=", ">", ">="]),
    ) &&
    mutations.some(
      (mutation) =>
        (Number(mutation?.loop_depth) || 0) > 0 && MUTABLE_KINDS.has(mutation?.container_kind),
    )
  ) {
    add("sort_like", "hypothesis", "derived.sort_shape");
  }

  const looksGraphLike =
    trace.objectAttrs.some((name) => NEIGHBOUR_NAMES.has(name)) && trace.objectAttrs.length >= 2;
  if (looksGraphLike) {
    // A neighbour-shaped object is a data-shape hint, never proof of BFS/DFS.
    add("graph_like", "hypothesis", "derived.object_attributes");
  }

  return CONCEPT_IDS.filter((id) => found.has(id)).map((id) => found.get(id));
}

/**
 * Detect the concepts a program's structure and recorded run support.
 *
 * @param {{profile?: unknown, trace?: unknown, result?: unknown, recognition?: unknown}} input
 * @returns {{status: string, concepts: Array<{id: string, strength: string, evidence: string[]}>, counts: object, trace: object, diagnostics: Array<object>}}
 */
export function detectConcepts(input = {}) {
  const profile = normalizeProgramProfile(input?.profile);
  const trace = summarizeTrace(input?.trace, input?.result);
  const recognition = isObject(input?.recognition) ? input.recognition : null;
  const counts = profileCounts(profile);
  const diagnostics = list(profile.diagnostics).slice(0, 3).map((entry) => ({
    code: String(entry?.code ?? "profile_diagnostic"),
    severity: String(entry?.severity ?? "error"),
  }));

  if (profile.status !== "ok") {
    return { status: profile.status, concepts: [], counts, trace, diagnostics };
  }
  if (trace.events === 0) {
    return {
      status: "empty",
      concepts: collect(profile, trace, input?.result, recognition),
      counts,
      trace,
      diagnostics: [{ code: "empty_trace", severity: "info" }],
    };
  }
  return {
    status: "ok",
    concepts: collect(profile, trace, input?.result, recognition),
    counts,
    trace,
    diagnostics,
  };
}
