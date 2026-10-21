// Searching scenes for linear and binary search. Availability needs both a
// static search shape and a real list/tuple in the trace. The scene uses only
// the selected StepView's frame, heap and recorded return event; when an index,
// bound, target or element cannot be proven, the scene says so instead of
// guessing.

import { normalizeProgramProfile } from "./programProfile.js";
import { SCENE_KIND, SCENE_VERSION } from "./scene.js";
import {
  activeFrame,
  baseMeta,
  changesOf,
  containerOf,
  contextRegion,
  focusOf,
  isObject,
  isSequenceType,
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
import { showValue } from "./values.js";

const SEARCHING = "searching";
const ORDERING = new Set(["<", "<=", ">", ">="]);
const LIMIT_STATUSES = new Set(["step_limit", "timeout", "output_limit", "internal_error"]);
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

function indexedCandidate(comparison) {
  const labels = operandLabels(comparison);
  if (labels.length !== 2) return null;
  const leftSub = parseSubscript(labels[0]);
  const rightSub = parseSubscript(labels[1]);
  if (Boolean(leftSub) === Boolean(rightSub)) return null;
  const subscript = leftSub ?? rightSub;
  const other = leftSub ? labels[1] : labels[0];
  const targetName = simpleName(other);
  const index = parseIndex(subscript.indexText);
  if (!targetName || !index) return null;
  return {
    baseName: subscript.base,
    indexName: index.name,
    indexOffset: index.offset,
    targetName,
  };
}

function hasOrdering(comparison) {
  return comparison?.operators?.length === 1 && ORDERING.has(comparison.operators[0]);
}

function hasEquality(comparison) {
  return Array.isArray(comparison?.operators) && comparison.operators.includes("==");
}

function loopContaining(comparison, loops) {
  let found = null;
  for (const loop of loops) {
    if (loop.function_id !== comparison.function_id) continue;
    if (comparison.line < loop.line || comparison.line > loop.end_line) continue;
    if (!found || loop.depth > found.depth) found = loop;
  }
  return found;
}

function returnInsideLoop(comparison, loop, returns) {
  return returns.some(
    (entry) =>
      entry.function_id === comparison.function_id &&
      entry.line >= loop.line &&
      entry.line <= loop.end_line,
  );
}

function boundsCandidate(comparison, comparisons) {
  return comparisons.find((candidate) => {
    if (candidate === comparison) return false;
    if (candidate.function_id !== comparison.function_id) return false;
    if (candidate.line === comparison.line) return false;
    if (!hasOrdering(candidate)) return false;
    if (parseSubscript(candidate.left?.label)) return false;
    if (parseSubscript(candidate.comparators?.[0]?.label)) return false;
    const left = simpleName(candidate.left?.label);
    const right = simpleName(candidate.comparators?.[0]?.label);
    return Boolean(left && right && left !== right);
  });
}

function proveSearch(trace, { functionName: name, baseName, targetName, boundsNames, boundsLine }) {
  let container = null;
  let target = false;
  let bounds = false;
  for (const event of trace) {
    const frames = Array.isArray(event?.frames) ? event.frames : [];
    const heap = isObject(event?.heap) ? event.heap : {};
    for (const frame of frames) {
      if (frame.function !== name) continue;
      if (!container) {
        const value = frame.variables?.[baseName];
        if (value?.type === "ref") {
          const object = heap[value.id];
          if (object && isSequenceType(object.type)) {
            container = { objectId: value.id, objectType: object.type };
          }
        }
      }
      if (frame.variables?.[targetName] !== undefined) target = true;
    }
    if (boundsLine != null && event?.event === "line" && event.line === boundsLine) {
      const frame = frames.find((candidate) => candidate.function === name);
      if (
        frame &&
        boundsNames.every((bound) => numericValue(frame.variables?.[bound]) !== null)
      ) {
        bounds = true;
      }
    }
  }
  if (!container) return null;
  if (!target) return null;
  if (boundsNames && !bounds) return null;
  return { container, bounds: Boolean(boundsNames) };
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
  const loops = Array.isArray(profile.loops) ? profile.loops : [];
  const returns = Array.isArray(profile.returns) ? profile.returns : [];
  const sorted = [...comparisons].sort((left, right) => left.line - right.line);

  // Binary search: an indexed ordering comparison, a second comparison between
  // two named numeric bounds, and real values for both sides of that pair.
  for (const comparison of sorted) {
    if (!hasOrdering(comparison)) continue;
    const info = indexedCandidate(comparison);
    if (!info) continue;
    const name = functionName(comparison.function_id, byId);
    if (!name) continue;
    const loop = loopContaining(comparison, loops);
    const recursive = (profile.recursion?.direct ?? []).includes(comparison.function_id);
    if (!loop && !recursive) continue;
    const bounds = boundsCandidate(comparison, comparisons);
    if (!bounds) continue;
    const boundsNames = [bounds.left.label, bounds.comparators[0].label];
    const proof = proveSearch(trace, {
      functionName: name,
      baseName: info.baseName,
      targetName: info.targetName,
      boundsNames,
      boundsLine: bounds.line,
    });
    if (!proof) continue;
    const indexLines = sorted
      .filter((candidate) => {
        if (candidate.function_id !== comparison.function_id) return false;
        const other = indexedCandidate(candidate);
        return other?.baseName === info.baseName && other.indexName === info.indexName;
      })
      .map((candidate) => candidate.line);
    return {
      kind: "binary",
      functionName: name,
      baseName: info.baseName,
      indexName: info.indexName,
      indexOffset: info.indexOffset,
      targetName: info.targetName,
      boundsNames,
      boundsLine: bounds.line,
      indexLines: [...new Set(indexLines)],
      comparisonLine: comparison.line,
      proof,
      returnEvents: trace
        .map((event, index) => ({ event, index }))
        .filter(
          (entry) =>
            entry.event?.event === "return" &&
            entry.event.function === name &&
            entry.event.return_value,
        ),
    };
  }

  // Indexed linear search: an indexed equality comparison inside a loop with a
  // return in that loop, plus a real list/tuple of that name.
  for (const comparison of sorted) {
    if (!hasEquality(comparison)) continue;
    const info = indexedCandidate(comparison);
    if (!info) continue;
    const loop = loopContaining(comparison, loops);
    if (!loop || !returnInsideLoop(comparison, loop, returns)) continue;
    const name = functionName(comparison.function_id, byId);
    if (!name) continue;
    const proof = proveSearch(trace, {
      functionName: name,
      baseName: info.baseName,
      targetName: info.targetName,
      boundsNames: null,
      boundsLine: null,
    });
    if (!proof) continue;
    return {
      kind: "indexed-linear",
      functionName: name,
      baseName: info.baseName,
      indexName: info.indexName,
      indexOffset: info.indexOffset,
      targetName: info.targetName,
      boundsNames: null,
      boundsLine: null,
      indexLines: [comparison.line],
      comparisonLine: comparison.line,
      proof,
      returnEvents: trace
        .map((event, index) => ({ event, index }))
        .filter(
          (entry) =>
            entry.event?.event === "return" &&
            entry.event.function === name &&
            entry.event.return_value,
        ),
    };
  }

  // Iterated linear search: `for item in values:` and `item == target` with a
  // return in the same loop. A function that counts matches has no such return.
  for (const loop of [...loops].sort((left, right) => left.line - right.line)) {
    const itemName = simpleName(loop.target?.label);
    const baseName = simpleName(loop.iterator?.label);
    if (!itemName || !baseName) continue;
    const comparison = sorted.find((candidate) => {
      if (!hasEquality(candidate)) return false;
      if (candidate.function_id !== loop.function_id) return false;
      if (candidate.line < loop.line || candidate.line > loop.end_line) return false;
      const labels = operandLabels(candidate);
      return labels.includes(itemName);
    });
    if (!comparison) continue;
    if (!returnInsideLoop(comparison, loop, returns)) continue;
    const targetName = operandLabels(comparison).find(
      (label) => label !== itemName && simpleName(label),
    );
    if (!targetName) continue;
    const name = functionName(loop.function_id, byId);
    if (!name) continue;
    const proof = proveSearch(trace, {
      functionName: name,
      baseName,
      targetName,
      boundsNames: null,
      boundsLine: null,
    });
    if (!proof) continue;
    return {
      kind: "item-linear",
      functionName: name,
      baseName,
      indexName: null,
      indexOffset: 0,
      targetName,
      itemName,
      boundsNames: null,
      boundsLine: null,
      indexLines: [comparison.line],
      comparisonLine: comparison.line,
      proof,
      returnEvents: trace
        .map((event, index) => ({ event, index }))
        .filter(
          (entry) =>
            entry.event?.event === "return" &&
            entry.event.function === name &&
            entry.event.return_value,
        ),
    };
  }
  return null;
}

function activeSearch(view, model) {
  const frame = activeFrame(view, new Set([model.functionName]));
  if (!frame) return null;
  const container = containerOf(view.heap, frame, model.baseName);
  if (!container) return null;
  return { frame, ...container };
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function outcomeFor(raw, model, object, heap) {
  if (!isObject(raw)) return null;
  if (model.kind === "item-linear") {
    if (raw.type === "bool") {
      return { text: raw.value ? "found" : "not found", foundIndex: null };
    }
    return { text: `returned ${showValue(raw, heap)}`, foundIndex: null };
  }
  if (raw.type === "int") {
    if (raw.value === -1) return { text: "not found", foundIndex: null };
    if (Number.isInteger(raw.value) && raw.value >= 0) {
      const shown = raw.value < (object?.items?.length ?? 0);
      return {
        text: shown ? `found at index ${raw.value}` : `returned index ${raw.value}`,
        foundIndex: shown ? raw.value : null,
      };
    }
    return { text: `returned index ${raw.value}`, foundIndex: null };
  }
  if (raw.type === "bool") {
    return { text: raw.value ? "found" : "not found", foundIndex: null };
  }
  return { text: `returned ${showValue(raw, heap)}`, foundIndex: null };
}

function returnValueFor(view, model) {
  if (view.kind === "return" && view.function === model.functionName) {
    return view.event?.return_value ?? null;
  }
  if (view.kind === "output") {
    for (let i = model.returnEvents.length - 1; i >= 0; i -= 1) {
      const entry = model.returnEvents[i];
      if (entry.index <= view.index) return entry.event.return_value;
    }
  }
  return null;
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

function addTone(tones, index, tone) {
  if (!Number.isInteger(index) || index < 0) return;
  const rank = { muted: 1, changed: 2, focus: 3 };
  const current = tones.get(index);
  if (!current || rank[tone] > rank[current]) tones.set(index, tone);
}

function buildScene(context, model, active) {
  const view = context.stepView;
  const heap = isObject(view.heap) ? view.heap : {};
  const object = active.object;
  const frame = active.frame;
  const reasons = [];
  const tones = new Map();
  const targetValue = frame.variables?.[model.targetName] ?? null;

  const resultStatus = context?.result?.status ?? context?.status ?? null;
  if (LIMIT_STATUSES.has(resultStatus)) {
    reasons.push(`the trace ended at its ${resultStatus} limit`);
  }
  if (view.selectionLost) {
    reasons.push("the selected call is no longer on the stack; the live search state is shown");
  }
  if (view.line != null && view.code == null) {
    reasons.push("the selected source line is not present in the submitted source");
  }
  if (object.more > 0) {
    reasons.push(
      `the sequence is truncated: ${object.more} more item${object.more === 1 ? "" : "s"} are not in the snapshot`,
    );
  }
  const mixed = mixedValueReason(object);
  if (mixed) reasons.push(mixed);
  const missing = missingReferenceReason(object, heap, "the sequence");
  if (missing) reasons.push(missing);
  if (!targetValue) reasons.push("the target is not present in the selected frame");

  let comparedIndex = null;
  let comparedText = null;
  if (view.line != null && model.indexLines.includes(view.line)) {
    if (model.kind === "item-linear") {
      const item = frame.variables?.[model.itemName];
      if (!item) {
        reasons.push("the compared item is not present at this step");
      } else {
        comparedText = showValue(item, heap);
        const matches = [];
        for (let index = 0; index < (object.items?.length ?? 0); index += 1) {
          if (sameValue(object.items[index], item)) matches.push(index);
        }
        if (matches.length === 1 && !(object.more > 0)) {
          comparedIndex = matches[0];
        } else if (matches.length > 1) {
          reasons.push(
            "the compared item occurs more than once, so its index cannot be proven from this trace",
          );
        } else if (object.more > 0) {
          reasons.push(
            "the sequence is truncated, so the compared item's index cannot be proven",
          );
        } else if (matches.length === 0) {
          reasons.push("the compared item is not present in the recorded sequence");
        }
      }
    } else {
      const index = indexValue(frame, {
        name: model.indexName,
        offset: model.indexOffset,
      });
      if (!Number.isInteger(index)) {
        reasons.push("the compared index is not present at this step");
      } else if (index < 0 || index >= (object.items?.length ?? 0)) {
        reasons.push("the compared index is outside the recorded sequence");
      } else {
        comparedIndex = index;
        const entry = object.items[index];
        comparedText = showValue(entry, heap);
      }
    }
  }
  if (comparedIndex !== null) addTone(tones, comparedIndex, "focus");

  let rangeText = null;
  if (model.boundsNames) {
    const bounds = model.boundsNames.map((name) => numericValue(frame.variables?.[name]));
    if (bounds.some((value) => value === null)) {
      reasons.push("the search bounds are not present at this step");
    } else {
      const [low, high] = bounds;
      rangeText = `${low}..${high}`;
      if (low <= high && low >= 0 && high < (object.items?.length ?? 0)) {
        for (let index = low; index <= high; index += 1) addTone(tones, index, "muted");
      }
    }
  }

  const rawReturn = returnValueFor(view, model);
  const outcome = outcomeFor(rawReturn, model, object, heap);
  if (outcome?.foundIndex != null) addTone(tones, outcome.foundIndex, "focus");

  const variableNames = [
    model.targetName,
    model.itemName,
    model.indexName,
    ...(model.boundsNames ?? []),
  ];
  const title = model.kind === "binary" ? "Binary search" : "Linear search";
  const subtitleParts = [
    active.name,
    targetValue ? `target ${showValue(targetValue, heap)}` : null,
    rangeText ? `range ${rangeText}` : null,
    comparedIndex != null ? `compared index ${comparedIndex}` : null,
    outcome?.text ?? null,
  ].filter((part) => isString(part) && part.length > 0);
  const reason = reasons.length > 0 ? [...new Set(reasons)].join("; ") : null;
  const status = reason === null ? "ok" : "partial";
  const requested = requestedIdFor(context, recognitionView(context.recognition), SEARCHING);
  const recognition = recognitionView(context.recognition);
  const names = active.name;
  const summary = [
    `${title} on ${names}.`,
    targetValue ? `Target is ${showValue(targetValue, heap)}.` : null,
    rangeText ? `Recorded range is ${rangeText}.` : null,
    comparedText != null ? `The compared value is ${comparedText}.` : null,
    outcome ? `Result: ${outcome.text}.` : null,
    object.items?.length === 0 ? "The sequence is empty." : null,
    reason,
  ]
    .filter((part) => isString(part) && part.length > 0)
    .join(" ");

  return {
    version: SCENE_VERSION,
    kind: SCENE_KIND,
    adapterId: SEARCHING,
    status,
    title,
    subtitle: subtitleParts.length > 0 ? subtitleParts.join(" · ") : null,
    capabilities: [SEARCHING],
    sourceLine: sourceLineOf(view),
    focus: focusOf(view),
    highlights: [...tones.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([index, tone]) => slotHighlight(active.objectId, index, tone)),
    regions: [
      sourceRegion(view),
      variableRegion(frame, variableNames, heap, "state", "Search state"),
      sequenceRegion(view, active.objectId, `Search sequence (${names})`),
      contextRegion(view, context, recognition),
    ].filter(Boolean),
    changes: changesOf(view),
    accessibility: {
      label: `${title} at step ${view.index + 1}: ${names}`,
      summary,
    },
    evidence: [
      {
        source: "profile",
        kind: model.kind === "binary" ? "binary_search_structure" : "linear_search_structure",
        detail:
          model.kind === "binary"
            ? "an indexed ordering comparison is paired with two recorded search bounds"
            : "an equality comparison is followed by a return inside the search loop",
        line: model.comparisonLine,
      },
      {
        source: "trace",
        kind: "search_container",
        detail: `${model.baseName} is a real ${object.type} at the selected step`,
        container: model.baseName,
        container_kind: object.type,
      },
      ...(model.boundsNames
        ? [
            {
              source: "trace",
              kind: "search_bounds",
              detail: `${model.boundsNames.join(" and ")} were recorded as numbers`,
              bounds: model.boundsNames,
              line: model.boundsLine,
            },
          ]
        : []),
      {
        source: "adapter",
        kind: "search_scene",
        detail: "values, indices and outcomes are taken from the selected StepView and trace",
      },
      ...recognitionEvidence(context.recognition),
    ],
    unsupportedReason: reason,
    meta: baseMeta(view, context, recognition, requested, reason !== null),
  };
}

export const SEARCHING_ADAPTER = Object.freeze({
  id: SEARCHING,
  label: "Searching",
  description:
    "Linear and binary search over a real list or tuple, with traced indices, bounds and outcomes.",
  capabilities: [SEARCHING],

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
        reason: "the profile and trace do not contain a trace-backed linear or binary search",
      };
    }
    if (!activeSearch(view, model)) {
      return {
        available: false,
        reason: "the selected step is outside the search function or has no list/tuple sequence",
      };
    }
    return { available: true, reason: null };
  },

  build(context = {}) {
    const view = isObject(context.stepView) ? context.stepView : null;
    if (!view || !isObject(view.event)) {
      return unsupportedScene({
        adapterId: SEARCHING,
        title: "Searching",
        capabilities: [SEARCHING],
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
        adapterId: SEARCHING,
        title: "Searching",
        capabilities: [SEARCHING],
        view,
        context,
        recognition: context.recognition,
        reason: "the profile and trace do not contain a trace-backed linear or binary search",
      });
    }
    const active = activeSearch(view, model);
    if (!active) {
      return unsupportedScene({
        adapterId: SEARCHING,
        title: "Searching",
        capabilities: [SEARCHING],
        view,
        context,
        recognition: context.recognition,
        reason: "the selected step is outside the search function or has no list/tuple sequence",
      });
    }
    return buildScene(context, model, active);
  },
});
