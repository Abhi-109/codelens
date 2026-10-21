// The always-available adapter: the current step, rendered from the same
// StepView, heap and trace index every existing panel already uses.
//
// It makes no algorithm claim and adds no comparison, boundary, swap or graph
// edge that the trace did not record. Missing or truncated state becomes an
// explicit partial/unsupported scene instead of a guessed one.

import { buildStatementStage } from "./statementStage.js";
import { getTraceIndex } from "./traceIndex.js";
import { namesById, objectLabel, slotEntries } from "./objects.js";
import { showValue } from "./values.js";
import {
  SCENE_EVIDENCE_SOURCES,
  SCENE_KIND,
  SCENE_VERSION,
} from "./scene.js";

const GENERIC = "generic";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isString(value) {
  return typeof value === "string";
}

function idOrder(left, right) {
  return String(left).localeCompare(String(right), undefined, { numeric: true });
}

function recognitionView(recognition) {
  if (!isObject(recognition) || !isString(recognition.adapterId)) return null;
  return {
    adapterId: recognition.adapterId,
    confidence:
      typeof recognition.confidence === "number" && Number.isFinite(recognition.confidence)
        ? recognition.confidence
        : 0,
    unavailableReason: isString(recognition.unavailableReason)
      ? recognition.unavailableReason
      : null,
  };
}

function recognitionEvidence(recognition) {
  if (!Array.isArray(recognition?.evidence)) return [];
  return recognition.evidence.filter(
    (item) =>
      isObject(item) &&
      SCENE_EVIDENCE_SOURCES.includes(item.source) &&
      isString(item.kind) &&
      isString(item.detail),
  );
}

function requestedIdFor(context, recognition) {
  if (isString(context?.requestedAdapterId) && context.requestedAdapterId.length > 0) {
    return context.requestedAdapterId;
  }
  if (isString(recognition?.adapterId) && recognition.adapterId.length > 0) {
    return recognition.adapterId;
  }
  return GENERIC;
}

function unsupportedScene(context, reason) {
  const recognition = recognitionView(context?.recognition);
  const view = isObject(context?.stepView) ? context.stepView : null;
  return {
    version: SCENE_VERSION,
    kind: SCENE_KIND,
    adapterId: GENERIC,
    status: "unsupported",
    title: "Generic step view",
    subtitle: "No selected step",
    capabilities: [GENERIC],
    sourceLine: null,
    focus: null,
    highlights: [],
    regions: [],
    changes: [],
    accessibility: {
      label: "No execution step",
      summary: reason,
    },
    evidence: [
      { source: "adapter", kind: "no_step", detail: reason },
      ...recognitionEvidence(context?.recognition),
    ],
    unsupportedReason: reason,
    meta: {
      stepIndex: view?.event ? view.index : null,
      eventKind: view?.kind ?? null,
      function: view?.function ?? null,
      frameId: view?.frameId ?? null,
      truncated: false,
      requestedAdapterId: requestedIdFor(context, recognition),
      recognition,
    },
  };
}

function hasMissingReference(frames, heap) {
  for (const frame of frames ?? []) {
    for (const value of Object.values(frame.variables ?? {})) {
      if (value?.type === "ref" && !heap[value.id]) return true;
    }
  }
  for (const object of Object.values(heap ?? {})) {
    let entries = [];
    try {
      entries = slotEntries(object);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.value?.type === "ref" && !heap[entry.value.id]) return true;
    }
  }
  return false;
}

function partialReason(view, context, resultStatus) {
  const reasons = [];
  if (["step_limit", "timeout", "output_limit", "internal_error"].includes(resultStatus)) {
    reasons.push(`the trace ended at its ${resultStatus} limit`);
  }
  if (view.selectionLost) {
    reasons.push("the selected call is no longer on the stack; the live frame is shown");
  }
  if (view.line != null && view.code == null) {
    reasons.push("the selected source line is not present in the submitted source");
  }
  const heap = isObject(view.heap) ? view.heap : {};
  if (Object.values(heap).some((object) => Number(object?.more ?? 0) > 0)) {
    reasons.push("one or more containers were truncated in the trace snapshot");
  }
  if (hasMissingReference(view.frames, heap)) {
    reasons.push("some referenced objects are not present in this trace snapshot");
  }
  return reasons.length > 0 ? reasons.join("; ") : null;
}

function sourceRegion(view) {
  if (!view.code) return null;
  return {
    id: "source",
    kind: "source",
    label: "Source",
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

function variableRegion(view) {
  const frame = view.frame;
  if (!frame) return null;
  const heap = isObject(view.heap) ? view.heap : {};
  const items = (frame.variables ?? []).map((variable) => ({
    kind: "variable",
    frameId: frame.frameId,
    name: variable.name,
    text: variable.text,
    valueType: variable.type,
    refId: variable.refId && heap[variable.refId] ? variable.refId : null,
    isArg: Boolean(variable.isArg),
  }));
  if (items.length === 0) return null;
  return {
    id: "variables",
    kind: "variables",
    label: `Variables in ${frame.function}`,
    items,
  };
}

function stackRegion(view) {
  if (!Array.isArray(view.callStack) || view.callStack.length === 0) return null;
  return {
    id: "stack",
    kind: "stack",
    label: "Call stack",
    items: view.callStack.map((frame) => ({
      kind: "frame",
      frameId: frame.frameId,
      function: frame.function,
      depth: frame.depth,
      status: frame.status,
      callLine: frame.callLine,
      current: Boolean(frame.isTop),
    })),
  };
}

function memoryRegion(view) {
  const heap = isObject(view.heap) ? view.heap : {};
  const ids = Object.keys(heap).sort(idOrder);
  if (ids.length === 0) return null;
  const names = namesById(view.frames ?? [], heap);
  const items = [];
  for (const objectId of ids) {
    const object = heap[objectId];
    if (!isObject(object)) continue;
    const labels = names.get(objectId) ?? [];
    items.push({
      kind: "object",
      objectId,
      label: labels.length > 0 ? labels.join(", ") : objectLabel(objectId, object),
      objectType: object.type ?? object.class ?? "object",
    });
    let entries = [];
    try {
      entries = slotEntries(object);
    } catch {
      entries = [];
    }
    for (const entry of entries) {
      const item = {
        kind: "slot",
        objectId,
        text: showValue(entry.value, heap),
        valueType: entry.value?.type ?? "?",
        refId:
          entry.value?.type === "ref" && heap[entry.value.id] ? entry.value.id : null,
      };
      if (object.type === "list" || object.type === "tuple") item.index = entry.key;
      else item.slotKey = entry.key;
      items.push(item);
    }
  }
  return items.length > 0
    ? { id: "memory", kind: "memory", label: "Memory and references", items }
    : null;
}

function lastOutputIndex(traceIndex, index) {
  let found = null;
  for (const eventIndex of traceIndex?.outputIndices ?? []) {
    if (eventIndex > index) break;
    found = eventIndex;
  }
  return found;
}

function outputRegion(view, traceIndex) {
  const text = traceIndex?.outputAt ? traceIndex.outputAt(view.index) : "";
  if (!text) return null;
  const eventIndex = lastOutputIndex(traceIndex, view.index);
  return {
    id: "output",
    kind: "output",
    label: "Output",
    items: [
      {
        kind: "output",
        text,
        ...(eventIndex === null ? {} : { eventIndex }),
      },
    ],
  };
}

function contextRegion(view, context, recognition) {
  const items = [
    {
      kind: "event",
      index: view.index,
      eventKind: view.kind ?? "none",
      line: view.line ?? null,
      function: view.function ?? null,
      frameId: view.frameId ?? null,
    },
    { kind: "context", name: "step", text: String(view.index) },
    {
      kind: "context",
      name: "selection",
      text: view.selectionLost ? "lost" : "current",
    },
  ];
  const status = context?.result?.status ?? context?.status ?? null;
  if (isString(status)) items.push({ kind: "context", name: "status", text: status });
  if (recognition) {
    items.push({ kind: "context", name: "recognition", text: recognition.adapterId });
  }
  if (view.returnValue !== null && view.returnValue !== undefined) {
    items.push({ kind: "context", name: "return value", text: String(view.returnValue) });
  }
  if (view.printed !== null && view.printed !== undefined) {
    items.push({ kind: "context", name: "printed", text: String(view.printed) });
  }
  return {
    id: "context",
    kind: "context",
    label: "Execution context",
    items,
  };
}

function changesOf(view) {
  return (view.changes ?? []).map((change) => ({
    kind: "change",
    name: change.name,
    changeKind: change.kind,
    from: change.from ?? null,
    to: change.to ?? null,
    line: change.line ?? null,
  }));
}

function highlightsOf(changes) {
  const seen = new Set();
  const out = [];
  for (const change of changes) {
    const key = `${change.name}\u0000${change.line ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: "change", id: change.name, line: change.line, tone: "changed" });
  }
  return out;
}

function accessibilityOf(view, changes, reason) {
  const label = `Step ${view.index + 1}: ${view.code?.text ?? view.kind ?? "no event"}`;
  const parts = [
    view.explanation?.aboutToHappen,
    view.explanation?.why,
    changes.length === 0
      ? null
      : `${changes.length} variable or slot ${changes.length === 1 ? "change" : "changes"} on this step.`,
    reason,
  ].filter((part) => isString(part) && part.length > 0);
  return { label, summary: parts.join(" ") };
}

export function createGenericAdapter() {
  return Object.freeze({
    id: GENERIC,
    label: "Generic step view",
    description:
      "Shows the selected step, variables, stack, heap references, output and execution context without an algorithm claim.",
    capabilities: Object.freeze([GENERIC]),
    availability() {
      return { available: true, reason: null };
    },
    build(context = {}) {
      const view = isObject(context.stepView) ? context.stepView : null;
      if (!view || !isObject(view.event)) {
        return unsupportedScene(context, "no execution step is available for this trace");
      }

      const trace = Array.isArray(context.trace)
        ? context.trace
        : Array.isArray(context.result?.trace)
          ? context.result.trace
          : [];
      const traceIndex = isObject(context.traceIndex)
        ? context.traceIndex
        : getTraceIndex(trace);
      const recognition = recognitionView(context.recognition);
      const resultStatus = context.result?.status ?? context.status ?? null;
      const reason = partialReason(view, context, resultStatus);
      const status = reason === null ? "ok" : "partial";
      const sourceLine = view.code
        ? { line: view.code.line, text: view.code.text, indent: view.code.indent }
        : null;
      const changes = changesOf(view);
      const focus =
        sourceLine && view.line != null
          ? { kind: "line", line: view.line }
          : { kind: "event", id: view.index };
      const regions = [
        sourceRegion(view),
        variableRegion(view),
        stackRegion(view),
        memoryRegion(view),
        outputRegion(view, traceIndex),
        contextRegion(view, context, recognition),
      ].filter(Boolean);
      const subtitleParts = [view.function, view.kind, view.line == null ? null : `line ${view.line}`]
        .filter((part) => isString(part) && part.length > 0);
      const stage = buildStatementStage({
        ...context,
        stepView: view,
        trace,
        traceIndex,
        source: isString(context.source) ? context.source : "",
      });

      return {
        version: SCENE_VERSION,
        kind: SCENE_KIND,
        adapterId: GENERIC,
        status,
        title: "Generic step view",
        subtitle: subtitleParts.length > 0 ? subtitleParts.join(" · ") : null,
        capabilities: [GENERIC],
        sourceLine,
        focus,
        highlights: highlightsOf(changes),
        regions,
        changes,
        stage,
        accessibility: accessibilityOf(view, changes, reason),
        evidence: [
          {
            source: "adapter",
            kind: "generic_step",
            detail: "scene built from the selected StepView, heap and trace index",
          },
          ...recognitionEvidence(context.recognition),
        ],
        unsupportedReason: reason,
        meta: {
          stepIndex: view.index,
          eventKind: view.kind ?? null,
          function: view.function ?? null,
          frameId: view.frameId ?? null,
          truncated: reason !== null,
          requestedAdapterId: requestedIdFor(context, recognition),
          recognition,
        },
      };
    },
  });
}

export const GENERIC_ADAPTER = createGenericAdapter();
