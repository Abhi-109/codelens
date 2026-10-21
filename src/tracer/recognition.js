// Evidence-based algorithm recognition for a static program profile plus a
// real execution trace. This module is deliberately independent of the UI:
// it answers one question, deterministically, and leaves adapter selection to
// a later phase.
//
// The static profile says what the syntax can do. The trace says what actually
// ran. A specialized adapter is returned only when both sides provide every
// mandatory piece of evidence; otherwise the generic adapter is the safe
// default. No runtime values are invented, and a built-in sort is never treated
// as if its internal comparisons had been traced.

import { normalizeProgramProfile } from "./programProfile.js";

export const RECOGNITION_ADAPTERS = Object.freeze([
  "generic",
  "recursion",
  "searching",
  "sorting",
]);

// Deterministic confidence values. These are classification scores, not a
// substitute for evidence: a specialized result is only returned after all
// mandatory checks for that adapter pass.
export const RECOGNITION_CONFIDENCE = Object.freeze({
  directRecursion: 0.95,
  directRecursionWithoutCallLine: 0.9,
  mutualRecursion: 0.9,
  binarySearch: 0.95,
  indexedLinearSearch: 0.85,
  iteratedLinearSearch: 0.8,
  sorting: 0.95,
  sortingSingleSidedComparison: 0.9,
  generic: 0,
});

const MODULE = "<module>";
const ORDERING = new Set(["<", "<=", ">", ">="]);
const EQUALITY = new Set(["=="]);
const SEARCH_SEQUENCES = new Set(["list", "tuple", "str"]);
const BUILTIN_ORDERING = new Set(["sort", "sorted"]);
const EXCLUDED_MUTATIONS = new Set(["sort", "reverse"]);
const FUNCTION_ID = /^function:(.+)@\d+:\d+$/;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SUBSCRIPT = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\[(.+)\]\s*$/;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function bySource(left, right) {
  return (
    (left?.line ?? 0) - (right?.line ?? 0) ||
    (left?.column ?? 0) - (right?.column ?? 0) ||
    compareText(String(left?.id ?? ""), String(right?.id ?? ""))
  );
}

function topFrame(event) {
  const frames = event?.frames;
  return Array.isArray(frames) && frames.length > 0 ? frames[frames.length - 1] : null;
}

function traceFunction(event) {
  const top = topFrame(event);
  if (typeof event?.function === "string" && event.function.length > 0) return event.function;
  return typeof top?.function === "string" && top.function.length > 0 ? top.function : MODULE;
}

function lastEvent(trace) {
  for (let i = trace.length - 1; i >= 0; i -= 1) {
    if (isObject(trace[i]) && typeof trace[i].event === "string") return trace[i];
  }
  return null;
}

function terminationOf(trace, status) {
  if (typeof status === "string" && status.length > 0) return status;
  const last = lastEvent(trace);
  if (!last) return "empty";
  if (["step_limit", "timeout", "output_limit", "error", "internal_error"].includes(last.event)) {
    return last.event;
  }
  if (last.event === "return" && last.function === MODULE) return "completed";
  return "partial";
}

function functionNameFromId(profile, id) {
  if (id === "module") return MODULE;
  const known = profile.functions.find((fn) => fn.id === id);
  if (known) return known.name;
  const match = FUNCTION_ID.exec(String(id ?? ""));
  return match ? match[1].split(".").pop() : null;
}

function readTrace(input) {
  const candidate = input?.trace ?? input?.result?.trace;
  if (Array.isArray(candidate)) return candidate;
  if (Array.isArray(candidate?.trace)) return candidate.trace;
  return [];
}

function readStatus(input) {
  const status = input?.status ?? input?.result?.status;
  return typeof status === "string" ? status : null;
}

function buildContext(profile, trace, status) {
  const nameById = new Map();
  for (const fn of profile.functions) nameById.set(fn.id, fn.name);
  const lineIndex = new Map();
  const position = new Map();
  for (let i = 0; i < trace.length; i += 1) {
    const event = trace[i];
    position.set(event, i);
    if (!isObject(event) || event.event !== "line" || !Number.isInteger(event.line)) continue;
    const key = `${traceFunction(event)}\u0000${event.line}`;
    const list = lineIndex.get(key);
    if (list) list.push(event);
    else lineIndex.set(key, [event]);
  }
  return {
    profile,
    trace,
    nameById,
    lineIndex,
    position,
    termination: terminationOf(trace, status),
    failures: [],
  };
}

function traceNameFor(ctx, functionId) {
  if (functionId === "module") return MODULE;
  return ctx.nameById.get(functionId) ?? functionNameFromId(ctx.profile, functionId);
}

function lineEvents(ctx, line, functionId) {
  const name = traceNameFor(ctx, functionId);
  if (!name || !Number.isInteger(line)) return [];
  return ctx.lineIndex.get(`${name}\u0000${line}`) ?? [];
}

function evidence(source, kind, detail, extra = {}) {
  return { source, kind, detail, ...extra };
}

function baseEvidence(ctx) {
  const profile = ctx.profile;
  const out = [
    evidence("profile", "profile_status", `profile status is ${profile.status}`, {
      status: profile.status,
      functions: profile.functions.length,
      loops: profile.loops.length,
      comparisons: profile.comparisons.length,
      mutations: profile.mutations.length,
    }),
    evidence("trace", "trace_summary", "execution events were inspected", {
      events: ctx.trace.length,
      termination: ctx.termination,
    }),
  ];
  if (profile.diagnostics.length > 0) {
    const first = profile.diagnostics[0];
    out.push(
      evidence("profile", "profile_diagnostic", first.message, {
        code: first.code,
        line: first.line,
      }),
    );
  }
  return out;
}

function noteFailure(ctx, reason, item) {
  if (item) ctx.failures.push({ reason, item });
  else ctx.failures.push({ reason, item: null });
}

function genericResult(ctx, reason, extra = []) {
  const failures = [];
  const seen = new Set();
  for (const failure of ctx.failures) {
    if (failure.item) failures.push(failure.item);
  }
  const fallback = evidence(
    "profile",
    "generic_fallback",
    reason ?? "no specialized adapter has all mandatory evidence",
  );
  const items = [...baseEvidence(ctx), ...extra, ...failures, fallback].filter((item) => {
    const key = `${item.source}\u0000${item.kind}\u0000${item.detail}\u0000${item.line ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    adapterId: "generic",
    confidence: RECOGNITION_CONFIDENCE.generic,
    evidence: items,
    unavailableReason: reason ?? "no specialized adapter has all mandatory evidence",
  };
}

function specialized(adapterId, confidence, items) {
  return {
    adapterId,
    confidence,
    evidence: items,
    unavailableReason: null,
  };
}

function withBase(ctx, items) {
  return [...baseEvidence(ctx), ...items];
}

function valueSignature(value) {
  if (value == null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function resolveValue(event, label) {
  if (!isObject(event) || typeof label !== "string" || label.length === 0) return null;
  const frame = topFrame(event);
  if (!frame || !isObject(frame.variables)) return null;
  const parts = label.split(".");
  let value = frame.variables[parts[0]];
  for (let i = 1; i < parts.length; i += 1) {
    if (!isObject(value) || value.type !== "ref") return null;
    const object = event.heap?.[value.id];
    if (!isObject(object) || !Array.isArray(object.attrs)) return null;
    const attr = object.attrs.find((entry) => entry?.name === parts[i]);
    value = attr?.value ?? null;
  }
  return value ?? null;
}

function runtimeKind(event, label) {
  const value = resolveValue(event, label);
  if (!isObject(value)) return null;
  if (value.type === "str") return "str";
  if (value.type === "ref") return event.heap?.[value.id]?.type ?? null;
  return value.type;
}

function listIdAt(ctx, event, label) {
  const value = resolveValue(event, label);
  if (!isObject(value) || value.type !== "ref") return null;
  const object = event.heap?.[value.id];
  return object?.type === "list" ? value.id : null;
}

function signatureOfObject(object) {
  if (!isObject(object)) return null;
  try {
    return JSON.stringify(object);
  } catch {
    return null;
  }
}

function numericAt(event, name) {
  const frame = topFrame(event);
  const value = frame?.variables?.[name];
  if (!isObject(value) || !["int", "float"].includes(value.type)) return null;
  return typeof value.value === "number" && Number.isFinite(value.value) ? value.value : null;
}

function numericVariables(event) {
  const out = new Map();
  const frame = topFrame(event);
  for (const [name, value] of Object.entries(frame?.variables ?? {})) {
    if (!isObject(value) || !["int", "float"].includes(value.type)) continue;
    if (typeof value.value !== "number" || !Number.isFinite(value.value)) continue;
    out.set(name, value.value);
  }
  return out;
}

function groupByFrame(events) {
  const groups = new Map();
  for (const event of events) {
    const id = event?.frame_id;
    if (id == null) continue;
    const list = groups.get(id);
    if (list) list.push(event);
    else groups.set(id, [event]);
  }
  return [...groups.values()].sort(
    (left, right) => (left[0]?.step ?? 0) - (right[0]?.step ?? 0),
  );
}

function operandsOf(comparison) {
  return [comparison?.left, ...(comparison?.comparators ?? [])]
    .filter(isObject)
    .map((value) => value.label)
    .filter((label) => typeof label === "string" && label.length > 0);
}

function subscriptInfo(label) {
  if (typeof label !== "string") return null;
  const match = SUBSCRIPT.exec(label);
  if (!match) return null;
  const index = match[2].trim();
  return {
    base: match[1],
    index: IDENTIFIER.test(index) ? index : null,
  };
}

function hasOperator(comparison, operators) {
  return (comparison?.operators ?? []).some((operator) => operators.has(operator));
}

function loopsContainingLine(profile, functionId, line) {
  return profile.loops
    .filter(
      (loop) =>
        loop.function_id === functionId &&
        Number.isInteger(loop.line) &&
        Number.isInteger(loop.end_line) &&
        loop.line <= line &&
        line <= loop.end_line,
    )
    .sort((left, right) => right.depth - left.depth || bySource(left, right));
}

function innermostLoopAt(profile, functionId, line) {
  return loopsContainingLine(profile, functionId, line)[0] ?? null;
}

function loopAncestorOrSame(profile, outer, inner) {
  let current = inner;
  while (current) {
    if (current.id === outer.id) return true;
    current = current.parent_id
      ? profile.loops.find((loop) => loop.id === current.parent_id) ?? null
      : null;
  }
  return false;
}

function loopsRelated(profile, first, second) {
  if (!first || !second) return false;
  return (
    loopAncestorOrSame(profile, first, second) ||
    loopAncestorOrSame(profile, second, first)
  );
}

function returnInsideLoop(ctx, comparison) {
  const loop = innermostLoopAt(
    ctx.profile,
    comparison.function_id,
    comparison.line,
  );
  if (!loop) return false;
  return ctx.profile.returns.some(
    (item) =>
      item.function_id === comparison.function_id &&
      item.loop_depth > 0 &&
      item.line >= loop.line &&
      item.line <= loop.end_line,
  );
}

function builtinOrdering(ctx) {
  const calls = ctx.profile.calls
    .filter((call) => BUILTIN_ORDERING.has(call.name))
    .sort(bySource);
  if (calls.length > 0) {
    const call = calls[0];
    return evidence(
      "profile",
      "builtin_ordering",
      "ordering is delegated to a built-in call whose internal comparisons are not traced",
      { line: call.line, function: traceNameFor(ctx, call.caller) },
    );
  }
  const mutations = ctx.profile.mutations
    .filter((mutation) => EXCLUDED_MUTATIONS.has(mutation.operation))
    .sort(bySource);
  if (mutations.length > 0) {
    const mutation = mutations[0];
    return evidence(
      "profile",
      "builtin_ordering",
      "ordering is delegated to a built-in list operation whose internal comparisons are not traced",
      { line: mutation.line, function: traceNameFor(ctx, mutation.function_id) },
    );
  }
  return null;
}

function isSequenceMutation(mutation) {
  if (!["index", "slice", "list_method"].includes(mutation?.kind)) return false;
  if (EXCLUDED_MUTATIONS.has(mutation.operation)) return false;
  if (mutation.container_kind === "dict" || mutation.container_kind === "attribute") return false;
  return true;
}

function sequenceChangeAfterMutation(ctx, mutation) {
  const container = mutation?.container?.label;
  if (typeof container !== "string" || container.length === 0) return null;
  const events = lineEvents(ctx, mutation.line, mutation.function_id);
  if (events.length === 0) return null;
  const changes = new Map();
  for (const event of events) {
    const id = listIdAt(ctx, event, container);
    if (!id) continue;
    const before = signatureOfObject(event.heap?.[id]);
    if (before === null) continue;
    const at = ctx.position.get(event);
    if (!Number.isInteger(at)) continue;
    let changed = false;
    for (let i = at + 1; i < ctx.trace.length; i += 1) {
      const later = ctx.trace[i];
      if (!isObject(later) || !later.heap || !later.heap[id]) continue;
      changed = signatureOfObject(later.heap[id]) !== before;
      break;
    }
    if (changed) changes.set(id, (changes.get(id) ?? 0) + 1);
  }
  if (changes.size === 0) return null;
  const ids = [...changes.keys()].sort(compareText);
  const id = ids[0];
  return {
    container,
    id,
    changes: changes.get(id),
    executions: events.length,
  };
}

function elementValueObserved(ctx, comparison, base, keyName) {
  const events = lineEvents(ctx, comparison.line, comparison.function_id);
  for (const event of events) {
    const key = resolveValue(event, keyName);
    const id = listIdAt(ctx, event, base);
    if (!isObject(key) || !id) continue;
    const keySignature = valueSignature(key);
    const items = event.heap?.[id]?.items ?? [];
    if (items.some((item) => valueSignature(item) === keySignature)) return true;
  }
  return false;
}

function sortingEvidence(ctx, comparison, mutation, change) {
  const events = lineEvents(ctx, comparison.line, comparison.function_id);
  const operands = operandsOf(comparison);
  const subscripts = operands.map(subscriptInfo).filter(Boolean);
  const singleSided = subscripts.length === 1;
  const count = events.length;
  const confidence = singleSided
    ? RECOGNITION_CONFIDENCE.sortingSingleSidedComparison
    : RECOGNITION_CONFIDENCE.sorting;
  const items = [
    evidence(
      "profile",
      "ordering_comparison",
      "a loop compares elements in ordering order",
      {
        line: comparison.line,
        function: traceNameFor(ctx, comparison.function_id),
        operators: [...(comparison.operators ?? [])],
      },
    ),
    evidence(
      "profile",
      "sequence_mutation",
      "a sequence mutation runs inside the same loop structure",
      {
        line: mutation.line,
        function: traceNameFor(ctx, mutation.function_id),
        operation: mutation.operation,
      },
    ),
    evidence(
      "trace",
      "comparison_executed",
      "the ordering comparison ran",
      { line: comparison.line, count },
    ),
    evidence(
      "trace",
      "sequence_changed",
      "the same list object changed after the mutation line",
      { line: mutation.line, count: change.changes },
    ),
  ];
  return specialized("sorting", confidence, withBase(ctx, items));
}

function recognizeSorting(ctx) {
  const comparisons = ctx.profile.comparisons
    .filter(
      (comparison) =>
        comparison.loop_depth >= 1 && hasOperator(comparison, ORDERING),
    )
    .sort(bySource);
  const mutations = ctx.profile.mutations
    .filter((mutation) => mutation.loop_depth >= 1 && isSequenceMutation(mutation))
    .sort(bySource);
  if (comparisons.length === 0 || mutations.length === 0) {
    const builtin = builtinOrdering(ctx);
    if (builtin) {
      noteFailure(
        ctx,
        "ordering is delegated to a built-in call, so its comparisons are not in the trace",
        builtin,
      );
    }
    return null;
  }

  for (const comparison of comparisons) {
    const operands = operandsOf(comparison);
    const subscripts = operands.map(subscriptInfo).filter(Boolean);
    if (subscripts.length === 0) continue;
    for (const mutation of mutations) {
      if (mutation.function_id !== comparison.function_id) continue;
      const comparisonLoop = innermostLoopAt(
        ctx.profile,
        comparison.function_id,
        comparison.line,
      );
      const mutationLoop = innermostLoopAt(
        ctx.profile,
        mutation.function_id,
        mutation.line,
      );
      if (!loopsRelated(ctx.profile, comparisonLoop, mutationLoop)) continue;
      const change = sequenceChangeAfterMutation(ctx, mutation);
      if (!change) continue;
      if (subscripts.length >= 2) {
        return sortingEvidence(ctx, comparison, mutation, change);
      }
      if (subscripts.length === 1) {
        const base = subscripts[0].base;
        const other = operands.find((label) => !subscriptInfo(label));
        if (!other || !IDENTIFIER.test(other)) continue;
        if (mutation.container?.label !== base) continue;
        if (!elementValueObserved(ctx, comparison, base, other)) continue;
        return sortingEvidence(ctx, comparison, mutation, change);
      }
    }
  }

  const builtin = builtinOrdering(ctx);
  if (builtin) {
    noteFailure(
      ctx,
      "ordering is delegated to a built-in call, so its comparisons are not in the trace",
      builtin,
    );
  } else if (comparisons.length > 0) {
    const elementComparisons = comparisons.filter((comparison) =>
      operandsOf(comparison).some((label) => subscriptInfo(label)),
    );
    if (elementComparisons.length === 0) {
      noteFailure(
        ctx,
        "ordering structure exists, but it does not compare sequence elements",
        evidence(
          "profile",
          "ordering_without_elements",
          "the ordering comparison does not read an indexed sequence element",
          { line: comparisons[0].line },
        ),
      );
    } else {
      noteFailure(
        ctx,
        "ordering structure exists, but no visible change to the same sequence was observed",
        evidence(
          "trace",
          "sequence_unchanged",
          "no observed mutation changed the candidate sequence",
          { line: elementComparisons[0].line },
        ),
      );
    }
  }
  return null;
}

function searchIndexInfo(comparison) {
  if (!comparison || (comparison.operators ?? []).length !== 1) return null;
  const operands = operandsOf(comparison);
  if (operands.length !== 2) return null;
  const indexes = operands.map(subscriptInfo);
  const subscriptCount = indexes.filter(Boolean).length;
  if (subscriptCount !== 1) return null;
  const info = indexes.find(Boolean);
  if (!info?.index) return null;
  const target = operands.find((label) => !subscriptInfo(label));
  if (!target || !IDENTIFIER.test(target)) return null;
  if (target === info.base || target === info.index) return null;
  return { ...info, target };
}

function linearIndexRuntime(ctx, comparison, info) {
  const events = lineEvents(ctx, comparison.line, comparison.function_id);
  if (events.length < 2) return null;
  for (const group of groupByFrame(events)) {
    if (group.length < 2) continue;
    const kinds = group.map((event) => runtimeKind(event, info.base)).filter(Boolean);
    if (!kinds.some((kind) => SEARCH_SEQUENCES.has(kind))) continue;
    const targets = group
      .map((event) => valueSignature(resolveValue(event, info.target)))
      .filter((value) => value != null);
    if (targets.length < 2 || new Set(targets).size !== 1) continue;
    const indexes = group
      .map((event) => numericAt(event, info.index))
      .filter((value) => value != null);
    if (new Set(indexes).size < 2) continue;
    return {
      count: group.length,
      kind: kinds.find((kind) => SEARCH_SEQUENCES.has(kind)),
      indexValues: new Set(indexes).size,
      base: info.base,
      index: info.index,
      target: info.target,
    };
  }
  return null;
}

function loopForComparison(ctx, comparison) {
  return ctx.profile.loops
    .filter(
      (loop) =>
        loop.function_id === comparison.function_id &&
        Number.isInteger(loop.line) &&
        Number.isInteger(loop.end_line) &&
        loop.line <= comparison.line &&
        comparison.line <= loop.end_line &&
        IDENTIFIER.test(loop.target?.label ?? "") &&
        IDENTIFIER.test(loop.iterator?.label ?? ""),
    )
    .sort((left, right) => right.depth - left.depth || bySource(left, right))[0] ?? null;
}

function linearItemRuntime(ctx, comparison, loop) {
  const item = loop.target.label;
  const container = loop.iterator.label;
  const operands = operandsOf(comparison);
  if (!operands.includes(item)) return null;
  const target = operands.find((label) => label !== item && IDENTIFIER.test(label));
  if (!target || target === container || target === item) return null;
  const events = lineEvents(ctx, comparison.line, comparison.function_id);
  if (events.length < 2) return null;
  for (const group of groupByFrame(events)) {
    if (group.length < 2) continue;
    const kinds = group.map((event) => runtimeKind(event, container)).filter(Boolean);
    if (!kinds.some((kind) => SEARCH_SEQUENCES.has(kind))) continue;
    const targetValues = group
      .map((event) => valueSignature(resolveValue(event, target)))
      .filter((value) => value != null);
    if (targetValues.length < 2 || new Set(targetValues).size !== 1) continue;
    const itemValues = group
      .map((event) => valueSignature(resolveValue(event, item)))
      .filter((value) => value != null);
    if (new Set(itemValues).size < 2) continue;
    return {
      count: group.length,
      kind: kinds.find((kind) => SEARCH_SEQUENCES.has(kind)),
      itemValues: new Set(itemValues).size,
      container,
      item,
      target,
    };
  }
  return null;
}

function narrowingBounds(observations, excluded) {
  const names = [...new Set(observations.flatMap((values) => [...values.keys()]))]
    .filter((name) => !excluded.has(name))
    .sort(compareText);
  for (let i = 0; i < names.length; i += 1) {
    for (let j = i + 1; j < names.length; j += 1) {
      const left = names[i];
      const right = names[j];
      const points = observations
        .map((values) => [values.get(left), values.get(right)])
        .filter(([a, b]) => a != null && b != null);
      if (points.length < 2) continue;
      const intervals = points.map(([a, b]) => Math.abs(a - b));
      let monotone = true;
      for (let p = 1; p < intervals.length; p += 1) {
        if (intervals[p] > intervals[p - 1]) monotone = false;
      }
      if (monotone && intervals[intervals.length - 1] < intervals[0]) {
        return { names: [left, right], observations: points.length };
      }
    }
  }
  return null;
}

function binaryRuntime(ctx, comparison, info) {
  const events = lineEvents(ctx, comparison.line, comparison.function_id);
  if (events.length < 2) return null;
  for (const group of groupByFrame(events)) {
    if (group.length < 2) continue;
    const kinds = group.map((event) => runtimeKind(event, info.base)).filter(Boolean);
    if (!kinds.some((kind) => SEARCH_SEQUENCES.has(kind))) continue;
    const targetValues = group
      .map((event) => valueSignature(resolveValue(event, info.target)))
      .filter((value) => value != null);
    if (targetValues.length < 2 || new Set(targetValues).size !== 1) continue;
    const indexes = group
      .map((event) => numericAt(event, info.index))
      .filter((value) => value != null);
    if (new Set(indexes).size < 2) continue;
    const excluded = new Set([info.index, info.target]);
    const bounds = narrowingBounds(group.map(numericVariables), excluded);
    if (!bounds) continue;
    const within = group.some((event) => {
      const index = numericAt(event, info.index);
      const first = numericAt(event, bounds.names[0]);
      const second = numericAt(event, bounds.names[1]);
      return (
        index != null &&
        first != null &&
        second != null &&
        index >= Math.min(first, second) &&
        index <= Math.max(first, second)
      );
    });
    if (!within) continue;
    return {
      count: group.length,
      kind: kinds.find((kind) => SEARCH_SEQUENCES.has(kind)),
      indexValues: new Set(indexes).size,
      bounds: bounds.names,
      base: info.base,
      index: info.index,
      target: info.target,
    };
  }
  return null;
}

function recognizeSearching(ctx) {
  const comparisons = ctx.profile.comparisons
    .filter((comparison) => comparison.loop_depth >= 1)
    .sort(bySource);
  const orderingFunctions = new Set();

  for (const comparison of comparisons) {
    if (!hasOperator(comparison, ORDERING)) continue;
    const info = searchIndexInfo(comparison);
    if (!info) continue;
    const reads = ctx.profile.container_operations.filter(
      (operation) =>
        operation.operation === "index_read" &&
        operation.function_id === comparison.function_id &&
        operation.line === comparison.line,
    );
    if (reads.length === 0) continue;
    orderingFunctions.add(comparison.function_id);
    const runtime = binaryRuntime(ctx, comparison, info);
    if (runtime) {
      const items = [
        evidence(
          "profile",
          "binary_search_structure",
          "an ordering comparison reads one indexed element and a candidate target inside a loop",
          { line: comparison.line, function: traceNameFor(ctx, comparison.function_id) },
        ),
        evidence(
          "profile",
          "indexed_container_access",
          "the compared element is an indexed sequence read",
          { line: comparison.line, container: info.base },
        ),
        evidence(
          "trace",
          "indexed_comparison_repeated",
          "the indexed comparison ran repeatedly in one frame",
          { line: comparison.line, count: runtime.count },
        ),
        evidence(
          "trace",
          "binary_bounds_narrowed",
          "two observed numeric bounds narrowed while the index changed",
          {
            line: comparison.line,
            bounds: runtime.bounds,
            index_value_count: runtime.indexValues,
          },
        ),
        evidence(
          "trace",
          "candidate_container",
          "the indexed object is a sequence at runtime",
          { container: info.base, container_kind: runtime.kind },
        ),
      ];
      return specialized(
        "searching",
        RECOGNITION_CONFIDENCE.binarySearch,
        withBase(ctx, items),
      );
    }
    noteFailure(
      ctx,
      "binary-like structure exists, but the observed trace did not show narrowing bounds",
      evidence(
        "trace",
        "binary_bounds_missing",
        "the indexed comparison did not show two narrowing numeric bounds",
        { line: comparison.line },
      ),
    );
  }

  for (const comparison of comparisons) {
    if (!hasOperator(comparison, EQUALITY)) continue;
    if (orderingFunctions.has(comparison.function_id)) {
      noteFailure(
        ctx,
        "ordering comparison on indexed elements is present; linear search was not assumed",
        evidence(
          "profile",
          "linear_search_ambiguous",
          "an indexed ordering comparison in the same function could be binary-like",
          { line: comparison.line },
        ),
      );
      continue;
    }
    if (!returnInsideLoop(ctx, comparison)) continue;

    const indexInfo = searchIndexInfo(comparison);
    if (indexInfo) {
      const reads = ctx.profile.container_operations.filter(
        (operation) =>
          operation.operation === "index_read" &&
          operation.function_id === comparison.function_id &&
          operation.line === comparison.line,
      );
      if (reads.length === 0) continue;
      const runtime = linearIndexRuntime(ctx, comparison, indexInfo);
      if (runtime) {
        const items = [
          evidence(
            "profile",
            "linear_search_structure",
            "an equality comparison reads one indexed element and a candidate target inside a loop",
            { line: comparison.line, function: traceNameFor(ctx, comparison.function_id) },
          ),
          evidence(
            "profile",
            "indexed_container_access",
            "the compared element is an indexed sequence read",
            { line: comparison.line, container: indexInfo.base },
          ),
          evidence(
            "trace",
            "indexed_comparison_repeated",
            "the indexed comparison ran repeatedly in one frame",
            { line: comparison.line, count: runtime.count },
          ),
          evidence(
            "trace",
            "index_changed",
            "the observed index took more than one value",
            { line: comparison.line, index_value_count: runtime.indexValues },
          ),
          evidence(
            "trace",
            "candidate_container",
            "the indexed object is a sequence at runtime",
            { container: indexInfo.base, container_kind: runtime.kind },
          ),
        ];
        return specialized(
          "searching",
          RECOGNITION_CONFIDENCE.indexedLinearSearch,
          withBase(ctx, items),
        );
      }
      noteFailure(
        ctx,
        "indexed search structure exists, but the trace did not show repeated indexed comparisons",
        evidence(
          "trace",
          "search_runtime_missing",
          "no frame had repeated indexed comparisons with a changing index",
          { line: comparison.line },
        ),
      );
      continue;
    }

    const loop = loopForComparison(ctx, comparison);
    if (!loop) continue;
    const runtime = linearItemRuntime(ctx, comparison, loop);
    if (runtime) {
      const items = [
        evidence(
          "profile",
          "linear_search_structure",
          "a loop compares each container item with a candidate target",
          { line: comparison.line, function: traceNameFor(ctx, comparison.function_id) },
        ),
        evidence(
          "trace",
          "container_iteration",
          "the comparison ran repeatedly while the loop variable changed",
          { line: comparison.line, count: runtime.count, item_value_count: runtime.itemValues },
        ),
        evidence(
          "trace",
          "candidate_container",
          "the iterated object is a sequence at runtime",
          { container: runtime.container, container_kind: runtime.kind },
        ),
      ];
      return specialized(
        "searching",
        RECOGNITION_CONFIDENCE.iteratedLinearSearch,
        withBase(ctx, items),
      );
    }
    noteFailure(
      ctx,
      "container iteration with an equality comparison was found, but runtime evidence was incomplete",
      evidence(
        "trace",
        "search_runtime_missing",
        "the trace did not show repeated item comparisons in one frame",
        { line: comparison.line },
      ),
    );
  }

  return null;
}

function selfCallLines(ctx, functionId) {
  return ctx.profile.calls
    .filter((call) => call.caller === functionId && call.self_recursion)
    .map((call) => call.line)
    .filter((line) => Number.isInteger(line))
    .sort((left, right) => left - right);
}

function findDirectRuntime(ctx, names) {
  let best = null;
  for (const event of ctx.trace) {
    if (!Array.isArray(event?.frames)) continue;
    const frames = event.frames;
    for (let i = 1; i < frames.length; i += 1) {
      const inner = frames[i];
      const parent = frames[i - 1];
      if (inner?.function !== parent?.function) continue;
      if (!names.has(inner.function)) continue;
      if (inner.frame_id === parent.frame_id) continue;
      const functionId = directFunctionId(ctx, inner.function);
      const selfLines = functionId ? selfCallLines(ctx, functionId) : [];
      const callLineMatches = Number.isInteger(inner.call_line) && selfLines.includes(inner.call_line);
      const depth = frames.filter((frame) => frame?.function === inner.function).length;
      const candidate = {
        function: inner.function,
        depth,
        callLine: Number.isInteger(inner.call_line) ? inner.call_line : null,
        callLineMatches,
      };
      if (
        !best ||
        candidate.depth > best.depth ||
        (candidate.depth === best.depth &&
          Number(candidate.callLineMatches) > Number(best.callLineMatches))
      ) {
        best = candidate;
      }
    }
  }
  return best;
}

function directFunctionId(ctx, name) {
  const entry = [...ctx.nameById.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .find(([, value]) => value === name);
  return entry?.[0] ?? null;
}

function findMutualRuntime(ctx, names) {
  const group = new Set(names);
  for (const event of ctx.trace) {
    if (!Array.isArray(event?.frames)) continue;
    const frames = event.frames;
    let run = [];
    for (let i = 1; i < frames.length; i += 1) {
      const name = frames[i]?.function;
      if (group.has(name)) {
        run.push(frames[i]);
        continue;
      }
      if (run.length > 0) break;
    }
    if (run.length < 3) continue;
    const counts = new Map();
    for (const frame of run) counts.set(frame.function, (counts.get(frame.function) ?? 0) + 1);
    if (![...counts.values()].some((count) => count > 1)) continue;
    return {
      length: run.length,
      functions: [...counts.keys()].sort(compareText),
      repeated: [...counts.entries()]
        .filter(([, count]) => count > 1)
        .map(([name]) => name)
        .sort(compareText),
    };
  }
  return null;
}

function recognizeRecursion(ctx) {
  const directNames = new Set();
  for (const id of ctx.profile.recursion.direct) {
    const name = ctx.nameById.get(id) ?? functionNameFromId(ctx.profile, id);
    if (name) directNames.add(name);
  }
  for (const fn of ctx.profile.functions) {
    if (fn.direct_self_recursion) directNames.add(fn.name);
  }
  if (directNames.size > 0) {
    const runtime = findDirectRuntime(ctx, directNames);
    if (runtime) {
      const items = [
        evidence(
          "profile",
          "direct_recursion",
          "the static call graph contains a self-call",
          {
            function: runtime.function,
            line: selfCallLines(ctx, directFunctionId(ctx, runtime.function) ?? "")[0] ?? null,
          },
        ),
        evidence(
          "trace",
          "nested_recursive_frames",
          "the same function appears at more than one stack depth",
          { function: runtime.function, depth: runtime.depth },
        ),
      ];
      if (runtime.callLineMatches) {
        items.push(
          evidence(
            "trace",
            "recursive_call_line",
            "the inner frame's call line matches the static self-call",
            { function: runtime.function, line: runtime.callLine },
          ),
        );
      }
      return specialized(
        "recursion",
        runtime.callLineMatches
          ? RECOGNITION_CONFIDENCE.directRecursion
          : RECOGNITION_CONFIDENCE.directRecursionWithoutCallLine,
        withBase(ctx, items),
      );
    }
    noteFailure(
      ctx,
      "the profile has a self-call, but the trace has no nested frames for that function",
      evidence(
        "trace",
        "recursive_frames_missing",
        "no event showed the same function nested inside itself",
      ),
    );
  }

  const groups = [];
  const seenGroups = new Set();
  for (const raw of ctx.profile.recursion.mutual_candidates) {
    const names = raw
      .map((id) => ctx.nameById.get(id) ?? functionNameFromId(ctx.profile, id))
      .filter(Boolean);
    if (names.length < 2) continue;
    const sorted = [...new Set(names)].sort(compareText);
    const key = sorted.join("\u0000");
    if (seenGroups.has(key)) continue;
    seenGroups.add(key);
    groups.push(sorted);
  }
  groups.sort((left, right) => compareText(left.join("\u0000"), right.join("\u0000")));

  for (const group of groups) {
    const runtime = findMutualRuntime(ctx, group);
    if (!runtime) continue;
    return specialized(
      "recursion",
      RECOGNITION_CONFIDENCE.mutualRecursion,
      withBase(ctx, [
        evidence(
          "profile",
          "mutual_recursion_candidates",
          "the static call graph contains a candidate call cycle",
          { functions: group },
        ),
        evidence(
          "trace",
          "nested_cycle_frames",
          "nested runtime frames repeat a function from the candidate cycle",
          { functions: runtime.functions, depth: runtime.length },
        ),
      ]),
    );
  }
  if (groups.length > 0) {
    noteFailure(
      ctx,
      "a candidate mutual-recursion cycle exists, but the trace has no nested frames that repeat it",
      evidence(
        "trace",
        "recursive_frames_missing",
        "no nested frame run repeated a member of the candidate cycle",
      ),
    );
  }

  const nestedFunctions = new Set();
  for (const event of ctx.trace) {
    if (!Array.isArray(event?.frames)) continue;
    const counts = new Map();
    for (const frame of event.frames) {
      if (typeof frame?.function === "string") {
        counts.set(frame.function, (counts.get(frame.function) ?? 0) + 1);
      }
    }
    for (const [name, count] of counts) if (count > 1) nestedFunctions.add(name);
  }
  if (nestedFunctions.size > 0 && directNames.size === 0 && groups.length === 0) {
    noteFailure(
      ctx,
      "nested runtime frames were observed, but the static profile has no recursive call cycle",
      evidence(
        "trace",
        "unmatched_nested_frames",
        "nested frames exist, but no matching static recursion structure was found",
        { functions: [...nestedFunctions].sort(compareText) },
      ),
    );
  }
  return null;
}

function defaultReason(ctx) {
  switch (ctx.termination) {
    case "step_limit":
      return "the trace reached the step limit before a specialized adapter had enough evidence";
    case "timeout":
      return "the trace reached the time limit before a specialized adapter had enough evidence";
    case "output_limit":
      return "the trace reached the output limit before a specialized adapter had enough evidence";
    case "error":
      return "the run ended with an error before a specialized adapter had enough evidence";
    case "partial":
      return "the trace is incomplete, and no specialized adapter has all mandatory evidence";
    default:
      return "no specialized adapter has all mandatory structural and runtime evidence";
  }
}

/**
 * Recognize one program from its normalised profile and trace.
 *
 * Accepts `{ profile, trace, status? }` or `{ profile, result }`. The function
 * never throws for malformed input and always returns one of:
 *
 *   { adapterId: "generic" | "recursion" | "searching" | "sorting",
 *     confidence, evidence, unavailableReason }
 *
 * Specialized adapter priority is sorting, then searching, then recursion,
 * because those adapters require more specific runtime evidence. Generic is
 * the fallback whenever any mandatory check is missing.
 */
export function recognizeProgram(input = {}) {
  const profile = normalizeProgramProfile(input?.profile);
  const trace = readTrace(input);
  const ctx = buildContext(profile, trace, readStatus(input));

  if (profile.status !== "ok") {
    return genericResult(
      ctx,
      `program profile is not usable (status: ${profile.status})`,
    );
  }
  if (trace.length === 0) {
    return genericResult(ctx, "the trace is empty");
  }
  if (!trace.some((event) => Array.isArray(event?.frames) && event.frames.length > 0)) {
    return genericResult(ctx, "the trace has no execution state to inspect");
  }

  const sorting = recognizeSorting(ctx);
  if (sorting) return sorting;
  const searching = recognizeSearching(ctx);
  if (searching) return searching;
  const recursion = recognizeRecursion(ctx);
  if (recursion) return recursion;

  return genericResult(ctx, ctx.failures[0]?.reason ?? defaultReason(ctx));
}
