// Shared scene pieces for the searching and sorting adapters. They render the
// selected StepView's real sequence objects and variables; nothing here makes
// an algorithm claim or guesses a value the trace did not record.

import { namesById, objectLabel, slotEntries } from "./objects.js";
import {
  SCENE_EVIDENCE_SOURCES,
  SCENE_KIND,
  SCENE_VERSION,
} from "./scene.js";
import { showValue } from "./values.js";

const SEQUENCE_TYPES = new Set(["list", "tuple"]);

export function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isString(value) {
  return typeof value === "string";
}

export function isInteger(value) {
  return Number.isInteger(value);
}

export function numericValue(value) {
  if (!isObject(value) || !["int", "float"].includes(value.type)) return null;
  return typeof value.value === "number" && Number.isFinite(value.value) ? value.value : null;
}

export function isSequenceType(value) {
  return SEQUENCE_TYPES.has(value);
}

export function readTrace(context = {}) {
  if (Array.isArray(context.trace)) return context.trace;
  if (Array.isArray(context.result?.trace)) return context.result.trace;
  return [];
}

export function recognitionView(recognition) {
  if (!isObject(recognition) || !isString(recognition.adapterId)) return null;
  return {
    adapterId: recognition.adapterId,
    confidence:
      typeof recognition.confidence === "number" ? recognition.confidence : 0,
    unavailableReason: isString(recognition.unavailableReason)
      ? recognition.unavailableReason
      : null,
  };
}

export function requestedIdFor(context, recognition, fallback) {
  if (isString(context?.requestedAdapterId) && context.requestedAdapterId.length > 0) {
    return context.requestedAdapterId;
  }
  if (isString(recognition?.adapterId) && recognition.adapterId.length > 0) {
    return recognition.adapterId;
  }
  return fallback;
}

export function recognitionEvidence(recognition) {
  if (!Array.isArray(recognition?.evidence)) return [];
  return recognition.evidence.filter(
    (item) =>
      isObject(item) &&
      SCENE_EVIDENCE_SOURCES.includes(item.source) &&
      isString(item.kind) &&
      isString(item.detail),
  );
}

export function sourceLineOf(view) {
  if (!view?.code) return null;
  return { line: view.code.line, text: view.code.text, indent: view.code.indent };
}

export function focusOf(view) {
  if (!view) return null;
  if (view.line != null) return { kind: "line", line: view.line };
  return { kind: "event", id: view.index };
}

export function contextRegion(view, context, recognition) {
  if (!view) return null;
  const items = [];
  if (isString(view.function)) {
    items.push({ kind: "context", name: "function", text: view.function });
  }
  if (isString(view.kind)) {
    items.push({ kind: "context", name: "event", text: view.kind });
  }
  items.push({ kind: "context", name: "step", text: String(view.index) });
  const status = context?.result?.status ?? context?.status ?? null;
  if (isString(status)) {
    items.push({ kind: "context", name: "status", text: status });
  }
  if (recognition) {
    items.push({ kind: "context", name: "recognition", text: recognition.adapterId });
  }
  if (isString(view.returnValue)) {
    items.push({ kind: "context", name: "return value", text: view.returnValue });
  }
  if (isString(view.printed)) {
    items.push({ kind: "context", name: "printed", text: view.printed });
  }
  if (view.selectionLost) {
    items.push({ kind: "context", name: "selection", text: "lost" });
  }
  return items.length > 0
    ? { id: "context", kind: "context", label: "Step context", items }
    : null;
}

export function variableRegion(frame, names, heap, id = "state", label = "State") {
  if (!frame) return null;
  const items = [];
  for (const name of new Set(names)) {
    const value = frame.variables?.[name];
    if (!value) continue;
    const item = {
      kind: "variable",
      frameId: frame.frame_id,
      name,
      text: showValue(value, heap),
      valueType: value.type,
    };
    if (value.type === "ref") item.refId = value.id;
    items.push(item);
  }
  return items.length > 0
    ? { id, kind: "variables", label, items }
    : null;
}

export function sequenceRegion(view, objectId, label, id = "sequence") {
  const heap = isObject(view?.heap) ? view.heap : {};
  const object = heap[objectId];
  if (!object || !SEQUENCE_TYPES.has(object.type)) return null;
  const names = namesById(view.frames, heap).get(objectId) ?? [];
  const items = [
    {
      kind: "object",
      objectId,
      label: names.length > 0 ? names.join(", ") : objectLabel(objectId, object),
      objectType: object.type,
    },
  ];
  for (const entry of slotEntries(object)) {
    if (!isInteger(entry.key)) continue;
    const value = entry.value;
    const item = {
      kind: "slot",
      objectId,
      index: entry.key,
      text: showValue(value, heap),
      valueType: value?.type,
    };
    if (value?.type === "ref") item.refId = value.id;
    items.push(item);
  }
  return { id, kind: "algorithm", label, items };
}

export function changesOf(view) {
  if (!Array.isArray(view?.changes)) return [];
  return view.changes.map((change) => ({
    kind: "change",
    name: change.name,
    changeKind: change.kind,
    from: change.from,
    to: change.to,
    line: change.line,
  }));
}

export function slotHighlight(objectId, index, tone) {
  return { kind: "slot", id: objectId, index, tone };
}

export function containerOf(heap, frame, name, types = SEQUENCE_TYPES) {
  const value = frame?.variables?.[name];
  if (value?.type !== "ref") return null;
  const object = heap?.[value.id];
  if (!object || !types.has(object.type)) return null;
  return { objectId: value.id, object, name };
}

export function activeFrame(view, functions) {
  const frames = Array.isArray(view?.frames) ? view.frames : [];
  for (let i = frames.length - 1; i >= 0; i -= 1) {
    if (functions.has(frames[i].function)) return frames[i];
  }
  return null;
}

export function baseMeta(view, context, recognition, requestedAdapterId, truncated) {
  return {
    stepIndex: view?.event ? view.index : null,
    eventKind: view?.kind ?? null,
    function: view?.function ?? null,
    frameId: view?.frameId ?? null,
    truncated: Boolean(truncated),
    requestedAdapterId,
    recognition: recognitionView(recognition),
  };
}

export function unsupportedScene({
  adapterId,
  title,
  capabilities,
  view,
  context,
  recognition,
  reason,
  requestedAdapterId,
}) {
  const requested = requestedAdapterId ?? requestedIdFor(context, recognition, adapterId);
  return {
    version: SCENE_VERSION,
    kind: SCENE_KIND,
    adapterId,
    status: "unsupported",
    title,
    subtitle: "Unsupported step",
    capabilities,
    sourceLine: sourceLineOf(view),
    focus: focusOf(view),
    highlights: [],
    regions: [],
    changes: [],
    accessibility: {
      label: `${title} unavailable`,
      summary: reason,
    },
    evidence: [{ source: "adapter", kind: "unsupported", detail: reason }],
    unsupportedReason: reason,
    meta: baseMeta(view, context, recognition, requested, false),
  };
}

export function valueKind(value) {
  if (!isObject(value)) return "missing";
  if (["int", "float"].includes(value.type)) return "number";
  if (value.type === "bool") return "bool";
  if (value.type === "str") return "text";
  if (value.type === "none") return "none";
  if (value.type === "ref") return "ref";
  return "other";
}

export function mixedValueReason(object, { numbersAreComparable = false } = {}) {
  const kinds = new Set((object?.items ?? []).map(valueKind));
  if (kinds.size <= 1) return null;
  if (numbersAreComparable && [...kinds].every((kind) => kind === "number" || kind === "bool")) {
    return null;
  }
  return "the sequence contains mixed value types; only recorded values are shown";
}

export function missingReferenceReason(object, heap, label) {
  const missing = (object?.items ?? []).some(
    (value) => value?.type === "ref" && !heap?.[value.id],
  );
  return missing
    ? `${label} contains a reference the trace snapshot does not contain`
    : null;
}
