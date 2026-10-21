// Sorting scenes for bubble, selection, insertion and merge sort. The adapter
// tracks the real list object through the selected frame, so a variable whose
// name merely looks like a list is not enough. Swaps and writes come from
// StepView changes; comparison positions are only highlighted when the trace
// records both the comparison line and the two indices.

import { normalizeProgramProfile } from "./programProfile.js";
import { SCENE_KIND, SCENE_VERSION } from "./scene.js";
import {
  baseMeta,
  changesOf,
  containerOf,
  contextRegion,
  focusOf,
  isInteger,
  isObject,
  isString,
  missingReferenceReason,
  mixedValueReason,
  numericValue,
  recognitionEvidence,
  recognitionView,
  requestedIdFor,
  sequenceRegion,
  slotHighlight,
  sourceLineOf,
  unsupportedScene,
  variableRegion,
} from "./sequenceScene.js";

const SORTING = "sorting";
const LIST_TYPES = new Set(["list"]);
const ORDERING = new Set(["<", "<=", ">", ">="]);
const LIMIT_STATUSES = new Set(["step_limit", "timeout", "output_limit", "internal_error"]);
const TITLES = {
  exchange: "Exchange sort",
  selection: "Selection sort",
  insertion: "Insertion sort",
  combine: "Divide-and-conquer sort",
  sorting: "Sorting",
};
const CACHE = new WeakMap();

function functionName(id, byId) {
  if (id === "module") return "<module>";
  return byId.get(id)?.name ?? null;
}

function operandLabels(comparison) {
  return [comparison?.left, ...(comparison?.comparators ?? [])]
    .map((operand) => operand?.label)
    .filter(isString);
}

function simpleName(label) {
  return isString(label) && /^[A-Za-z_]\w*$/.test(label) ? label : null;
}

function parseSubscript(label) {
  if (!isString(label)) return null;
  const match = /^([A-Za-z_]\w*)\[(.+)\]$/.exec(label);
  if (!match) return null;
  return { base: match[1], indexText: match[2].trim() };
}

function parseIndex(text) {
  const name = simpleName(text);
  if (name) return { name, offset: 0 };
  const shifted = /^([A-Za-z_]\w*)\s*([+-])\s*(\d+)$/.exec(text);
  if (!shifted) return null;
  return {
    name: shifted[1],
    offset: shifted[2] === "-" ? -Number(shifted[3]) : Number(shifted[3]),
  };
}

function indexValue(frame, index) {
  if (!index?.name) return null;
  const base = numericValue(frame?.variables?.[index.name]);
  if (base === null) return null;
  return base + (index.offset ?? 0);
}

function hasOrdering(comparison) {
  return comparison?.operators?.length === 1 && ORDERING.has(comparison.operators[0]);
}

function subscriptsOf(comparison) {
  return operandLabels(comparison).map(parseSubscript).filter(Boolean);
}

function isSequenceMutation(mutation) {
  if (!isObject(mutation) || mutation.loop_depth < 1) return false;
  if (mutation.kind === "list_method") {
    return !["sort", "reverse"].includes(mutation.operation);
  }
  return true;
}

function adjacentIndexes(left, right) {
  const a = parseIndex(left);
  const b = parseIndex(right);
  if (!a || !b || a.name !== b.name) return false;
  return Math.abs((a.offset ?? 0) - (b.offset ?? 0)) === 1;
}

function classify(related, mutation, merge) {
  if (merge) return "combine";
  const labels = related.map(operandLabels);
  const hasOneSided = labels.some((items) => {
    const subscripts = items.map(parseSubscript).filter(Boolean);
    return (
      subscripts.length === 1 &&
      items.some((label) => !parseSubscript(label) && simpleName(label))
    );
  });
  if (hasOneSided) return "insertion";
  const adjacent = related.some((comparison) => {
    const subscripts = subscriptsOf(comparison);
    if (subscripts.length < 2) return false;
    return (
      subscripts[0].base === subscripts[1].base &&
      adjacentIndexes(subscripts[0].indexText, subscripts[1].indexText)
    );
  });
  if (adjacent) return "exchange";
  if (mutation.loop_depth === 1 && subscriptsOf(related[0] ?? {}).length >= 2) {
    return "selection";
  }
  return "sorting";
}

function chooseSite(related, kind, primaryName) {
  if (kind === "combine") {
    return related.find((comparison) => {
      const bases = new Set(subscriptsOf(comparison).map((item) => item.base));
      return bases.size >= 2;
    }) ?? related[0] ?? null;
  }
  if (kind === "insertion") {
    return related.find((comparison) => {
      const items = operandLabels(comparison);
      const subscripts = items.map(parseSubscript).filter(Boolean);
      return (
        subscripts.length === 1 &&
        items.some((label) => !parseSubscript(label) && simpleName(label))
      );
    }) ?? related[0] ?? null;
  }
  return (
    related.find((comparison) =>
      subscriptsOf(comparison).some((item) => item.base === primaryName),
    ) ?? related[0] ?? null
  );
}

function proveContainers(trace, functionContainers) {
  const found = new Set();
  for (const event of trace) {
    const frames = Array.isArray(event?.frames) ? event.frames : [];
    const heap = isObject(event?.heap) ? event.heap : {};
    for (const frame of frames) {
      const name = functionContainers.get(frame.function);
      if (!name) continue;
      const value = frame.variables?.[name];
      if (value?.type !== "ref") continue;
      const object = heap[value.id];
      if (object && LIST_TYPES.has(object.type)) found.add(frame.function);
    }
  }
  return found.size > 0 ? found : null;
}

function buildModel(profileInput, trace) {
  const entry = CACHE.get(trace);
  if (entry && entry.profile === profileInput) return entry.model;
  const profile = normalizeProgramProfile(profileInput);
  const model = detectModel(profile, trace);
  CACHE.set(trace, { profile: profileInput, model });
  return model;
}

function detectModel(profile, trace) {
  if (profile?.status !== "ok") return null;
  const byId = new Map(
    (Array.isArray(profile.functions) ? profile.functions : [])
      .filter((fn) => isObject(fn) && isString(fn.id) && isString(fn.name))
      .map((fn) => [fn.id, fn]),
  );
  const comparisons = Array.isArray(profile.comparisons) ? profile.comparisons : [];
  const mutations = (Array.isArray(profile.mutations) ? profile.mutations : [])
    .filter(isSequenceMutation)
    .sort((left, right) => left.line - right.line);
  const orderings = comparisons
    .filter((comparison) => hasOrdering(comparison) && subscriptsOf(comparison).length > 0)
    .sort((left, right) => left.line - right.line);

  for (const mutation of mutations) {
    const name = functionName(mutation.function_id, byId);
    const primaryName = simpleName(mutation.container?.label);
    if (!name || !primaryName) continue;
    const related = orderings.filter((comparison) => comparison.function_id === mutation.function_id);
    if (related.length === 0) continue;
    const merge =
      mutation.kind === "list_method" &&
      ["append", "extend"].includes(mutation.operation) &&
      related.some((comparison) => {
        const bases = new Set(subscriptsOf(comparison).map((item) => item.base));
        return bases.size >= 2;
      });
    if (!merge && !related.some((comparison) =>
      subscriptsOf(comparison).some((item) => item.base === primaryName),
    )) {
      continue;
    }
    const kind = classify(related, mutation, merge);
    const site = chooseSite(related, kind, primaryName);
    if (!site) continue;
    const secondaryNames = merge
      ? [...new Set(subscriptsOf(site).map((item) => item.base))].filter(
          (item) => item !== primaryName,
        )
      : [];
    const functionContainers = new Map([[name, primaryName]]);
    if (merge) {
      for (const id of profile.recursion?.direct ?? []) {
        const recursiveName = functionName(id, byId);
        if (!recursiveName) continue;
        const operation = (profile.container_operations ?? []).find(
          (entry) => entry.function_id === id && entry.operation === "slice_read",
        );
        const base = parseSubscript(operation?.target?.label)?.base;
        if (base) functionContainers.set(recursiveName, base);
      }
    }
    const proof = proveContainers(trace, functionContainers);
    if (!proof) continue;
    return {
      kind,
      primaryName,
      secondaryNames,
      site: {
        line: site.line,
        functionName: name,
        operands: operandLabels(site).map((label) => ({
          label,
          subscript: parseSubscript(label),
        })),
      },
      comparisonLine: site.line,
      mutationLine: mutation.line,
      functionContainers,
      proof,
      returnEvents: trace
        .map((event, index) => ({ event, index }))
        .filter(
          (entry) =>
            entry.event?.event === "return" &&
            functionContainers.has(entry.event.function) &&
            entry.event.return_value?.type === "ref",
        ),
    };
  }
  return null;
}

function activeSort(view, model) {
  const frames = Array.isArray(view?.frames) ? view.frames : [];
  for (let i = frames.length - 1; i >= 0; i -= 1) {
    const frame = frames[i];
    const name = model.functionContainers.get(frame.function);
    if (!name) continue;
    const container = containerOf(view.heap, frame, name, LIST_TYPES);
    return container ? { frame, ...container } : null;
  }
  return null;
}

function recentReturnObject(view, model) {
  if (view.kind !== "output") return null;
  for (let i = model.returnEvents.length - 1; i >= 0; i -= 1) {
    const entry = model.returnEvents[i];
    if (entry.index > view.index) continue;
    if (entry.event.function !== view.function) continue;
    const id = entry.event.return_value?.id;
    const object = view.heap?.[id];
    if (object && LIST_TYPES.has(object.type)) return { objectId: id, object, name: "return value" };
  }
  return null;
}

function primaryForStep(view, model, active) {
  if (model.kind !== "combine") return active;
  if (view.kind === "return" && model.functionContainers.has(view.function)) {
    const raw = view.event?.return_value;
    const object = raw?.type === "ref" ? view.heap?.[raw.id] : null;
    if (object && LIST_TYPES.has(object.type)) {
      // Keep the active name when a function returns its own list; a different
      // object is the value produced by a combine step.
      return {
        ...active,
        objectId: raw.id,
        object,
        name: raw.id === active?.objectId ? active.name : "return value",
      };
    }
  }
  return recentReturnObject(view, model) ?? active;
}

function orderedNumber(value) {
  const numeric = numericValue(value);
  if (numeric !== null) return numeric;
  if (value?.type === "bool") return value.value ? 1 : 0;
  return null;
}

function nondecreasing(items, start, end) {
  let previous = null;
  for (let i = start; i < end; i += 1) {
    const value = orderedNumber(items?.[i]);
    if (value === null) return false;
    if (previous !== null && value < previous) return false;
    previous = value;
  }
  return true;
}

function addTone(tones, objectId, index, tone) {
  if (!Number.isInteger(index) || index < 0) return;
  let byIndex = tones.get(objectId);
  if (!byIndex) {
    byIndex = new Map();
    tones.set(objectId, byIndex);
  }
  const rank = { muted: 1, changed: 2, focus: 3 };
  const current = byIndex.get(index);
  if (!current || rank[tone] > rank[current]) byIndex.set(index, tone);
}

function sourceRegion(view) {
  if (!view?.code) return null;
  return {
    id: "source",
    kind: "source",
    label: "Current line",
    items: [
      {
        kind: "line",
        line: view.code.line,
        text: view.code.text,
        indent: view.code.indent,
      },
    ],
  };
}

function variableNamesFor(kind) {
  switch (kind) {
    case "exchange":
      return ["i", "j"];
    case "selection":
      return ["i", "j", "smallest"];
    case "insertion":
      return ["i", "j", "key"];
    case "combine":
      return ["i", "j", "mid"];
    default:
      return ["i", "j"];
  }
}

function mergeInputs(view, model, active, primary) {
  const regions = [];
  const reasons = [];
  if (model.kind !== "combine") return { regions, reasons };
  const required = active.frame.function === model.site.functionName;
  for (const name of model.secondaryNames) {
    const container = containerOf(view.heap, active.frame, name, LIST_TYPES);
    if (!container) {
      if (required) reasons.push(`combine input ${name} is not available at this step`);
      continue;
    }
    if (container.objectId === primary.objectId) continue;
    const region = sequenceRegion(
      view,
      container.objectId,
      `Combine input (${name})`,
      `sequence-${name}`,
    );
    if (region) regions.push(region);
    if (container.object.more > 0) {
      reasons.push(
        `combine input ${name} is truncated: ${container.object.more} more item${container.object.more === 1 ? "" : "s"} are not in the snapshot`,
      );
    }
    const missing = missingReferenceReason(container.object, view.heap, `combine input ${name}`);
    if (missing) reasons.push(missing);
  }
  return { regions, reasons };
}

function comparisonTones(view, model, active, tones) {
  if (view.line !== model.site.line) return;
  if (active.frame.function !== model.site.functionName) return;
  for (const operand of model.site.operands) {
    if (!operand.subscript) continue;
    const index = indexValue(active.frame, parseIndex(operand.subscript.indexText));
    if (!isInteger(index)) continue;
    const container = containerOf(view.heap, active.frame, operand.subscript.base, LIST_TYPES);
    if (!container) continue;
    if (index < 0 || index >= (container.object.items?.length ?? 0)) continue;
    addTone(tones, container.objectId, index, "focus");
  }
}

function rangeTones(view, model, primary, tones, object) {
  if (object.more > 0) return null;
  const items = object.items ?? [];
  if (model.kind === "exchange") {
    const i = numericValue(primary.frame.variables?.i);
    if (i === null) return null;
    const start = Math.max(0, Math.min(items.length, items.length - i));
    if (start >= items.length || !nondecreasing(items, start, items.length)) return null;
    for (let index = start; index < items.length; index += 1) {
      addTone(tones, primary.objectId, index, "muted");
    }
    return start < items.length ? `recorded suffix from index ${start}` : null;
  }
  if (model.kind === "selection" || model.kind === "insertion") {
    const i = numericValue(primary.frame.variables?.i);
    if (i === null) return null;
    const end = Math.max(0, Math.min(items.length, i));
    if (end === 0 || !nondecreasing(items, 0, end)) return null;
    for (let index = 0; index < end; index += 1) {
      addTone(tones, primary.objectId, index, "muted");
    }
    return `recorded prefix through index ${end - 1}`;
  }
  if (
    model.kind === "combine" &&
    (primary.name === "result" || primary.name === "return value") &&
    nondecreasing(items, 0, items.length)
  ) {
    for (let index = 0; index < items.length; index += 1) {
      addTone(tones, primary.objectId, index, "muted");
    }
    return items.length > 0 ? "recorded combined prefix" : null;
  }
  return null;
}

function buildScene(context, model, active) {
  const view = context.stepView;
  const heap = isObject(view.heap) ? view.heap : {};
  const primary = primaryForStep(view, model, active);
  const reasons = [];
  const tones = new Map();
  const resultStatus = context?.result?.status ?? context?.status ?? null;

  if (LIMIT_STATUSES.has(resultStatus)) {
    reasons.push(`the trace ended at its ${resultStatus} limit`);
  }
  if (view.selectionLost) {
    reasons.push("the selected call is no longer on the stack; the live sorting state is shown");
  }
  if (view.line != null && view.code == null) {
    reasons.push("the selected source line is not present in the submitted source");
  }
  if (primary.object.more > 0) {
    reasons.push(
      `the sequence is truncated: ${primary.object.more} more item${primary.object.more === 1 ? "" : "s"} are not in the snapshot`,
    );
  }
  const mixed = mixedValueReason(primary.object, { numbersAreComparable: true });
  if (mixed) reasons.push(mixed);
  const missing = missingReferenceReason(primary.object, heap, "the sequence");
  if (missing) reasons.push(missing);

  comparisonTones(view, model, active, tones);
  const rangeText = rangeTones(view, model, primary, tones, primary.object);
  const inputs = mergeInputs(view, model, active, primary);
  reasons.push(...inputs.reasons);

  const primaryLabel = primary.name ?? "sequence";
  const title = TITLES[model.kind] ?? TITLES.sorting;
  const subtitleParts = [
    primaryLabel,
    `${primary.object.items?.length ?? 0} item${(primary.object.items?.length ?? 0) === 1 ? "" : "s"}`,
    model.kind === "combine" && inputs.regions.length > 0 ? "combine inputs shown" : null,
    rangeText,
  ].filter((part) => isString(part) && part.length > 0);
  const reason = reasons.length > 0 ? [...new Set(reasons)].join("; ") : null;
  const status = reason === null ? "ok" : "partial";
  const recognition = recognitionView(context.recognition);
  const requested = requestedIdFor(context, recognition, SORTING);
  const summary = [
    `${title} on ${primaryLabel}.`,
    `${primary.object.items?.length ?? 0} recorded item${(primary.object.items?.length ?? 0) === 1 ? "" : "s"}.`,
    rangeText
      ? model.kind === "combine"
        ? `The result is a ${rangeText}; this does not claim the whole input is sorted.`
        : `The ${rangeText} is nondecreasing.`
      : null,
    model.kind === "combine" && inputs.regions.length > 0
      ? `${inputs.regions.length} recorded combine input${inputs.regions.length === 1 ? "" : "s"} shown.`
      : null,
    reason,
  ]
    .filter((part) => isString(part) && part.length > 0)
    .join(" ");

  const regions = [
    sourceRegion(view),
    variableRegion(active.frame, variableNamesFor(model.kind), heap, "state", "Sort state"),
    sequenceRegion(view, primary.objectId, `Sorting sequence (${primaryLabel})`),
    ...inputs.regions,
    contextRegion(view, context, recognition),
  ].filter(Boolean);

  const highlights = [...tones.entries()]
    .sort((left, right) => String(left[0]).localeCompare(String(right[0])))
    .flatMap(([objectId, byIndex]) =>
      [...byIndex.entries()]
        .sort((left, right) => left[0] - right[0])
        .map(([index, tone]) => slotHighlight(objectId, index, tone)),
    );

  return {
    version: SCENE_VERSION,
    kind: SCENE_KIND,
    adapterId: SORTING,
    status,
    title,
    subtitle: subtitleParts.length > 0 ? subtitleParts.join(" · ") : null,
    capabilities: [SORTING],
    sourceLine: sourceLineOf(view),
    focus: focusOf(view),
    highlights,
    regions,
    changes: changesOf(view),
    accessibility: {
      label: `${title} at step ${view.index + 1}: ${primaryLabel}`,
      summary,
    },
    evidence: [
      {
        source: "profile",
        kind: "sort_structure",
        detail: `${model.kind} ordering comparison on line ${model.comparisonLine} and a recorded sequence mutation on line ${model.mutationLine}`,
        line: model.comparisonLine,
      },
      {
        source: "trace",
        kind: "sort_container",
        detail: `${model.primaryName} is a real list at the selected step`,
        container: model.primaryName,
        container_kind: primary.object.type,
      },
      {
        source: "trace",
        kind: "sort_comparison",
        detail: "comparison positions come from the recorded indices at this line",
        line: model.site.line,
      },
      {
        source: "adapter",
        kind: "sort_scene",
        detail: "swaps and writes come from StepView changes; no built-in sort internals are inferred",
      },
      ...recognitionEvidence(context.recognition),
    ],
    unsupportedReason: reason,
    meta: baseMeta(view, context, recognition, requested, reason !== null),
  };
}

export const SORTING_ADAPTER = Object.freeze({
  id: SORTING,
  label: "Sorting",
  description:
    "Exchange, selection, insertion and divide-and-conquer list state from real list objects and traced changes.",
  capabilities: [SORTING],

  availability(context = {}) {
    const view = isObject(context.stepView) ? context.stepView : null;
    if (!view) return { available: false, reason: "no execution step is available" };
    const trace = Array.isArray(context.trace)
      ? context.trace
      : Array.isArray(context.result?.trace)
        ? context.result.trace
        : [];
    const model = buildModel(context.profile, trace);
    if (!model) {
      return {
        available: false,
        reason: "the profile and trace do not contain a trace-backed in-place sort",
      };
    }
    if (!activeSort(view, model)) {
      return {
        available: false,
        reason: "the selected step is outside the sorting function or has no real list",
      };
    }
    return { available: true, reason: null };
  },

  build(context = {}) {
    const view = isObject(context.stepView) ? context.stepView : null;
    if (!view || !isObject(view.event)) {
      return unsupportedScene({
        adapterId: SORTING,
        title: "Sorting",
        capabilities: [SORTING],
        view,
        context,
        recognition: context.recognition,
        reason: "no execution step is available for this trace",
      });
    }
    const trace = Array.isArray(context.trace)
      ? context.trace
      : Array.isArray(context.result?.trace)
        ? context.result.trace
        : [];
    const model = buildModel(context.profile, trace);
    if (!model) {
      return unsupportedScene({
        adapterId: SORTING,
        title: "Sorting",
        capabilities: [SORTING],
        view,
        context,
        recognition: context.recognition,
        reason: "the profile and trace do not contain a trace-backed in-place sort",
      });
    }
    const active = activeSort(view, model);
    if (!active) {
      return unsupportedScene({
        adapterId: SORTING,
        title: "Sorting",
        capabilities: [SORTING],
        view,
        context,
        recognition: context.recognition,
        reason: "the selected step is outside the sorting function or has no real list",
      });
    }
    return buildScene(context, model, active);
  },
});
