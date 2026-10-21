// The recursion adapter: a scene built from the calls the trace really made.
//
// A recursive invocation is a call whose function belongs to the profile's
// direct or mutual recursion evidence and whose caller is another invocation
// from that same family. A family edge alone is not recursion: one candidate
// calling another one-way is an ordinary chain, so a function must actually
// reappear in its ancestry. Helpers called by a recursive function are not part
// of the invocation tree; the trace supports the family edge, not an invented
// one.
//
// The tree is the whole run, like the existing Call Tree. Breadth-first
// selection keeps it bounded: the first 200 invocations are represented and the
// scene reports exactly how many were omitted. Every field is read from real
// frame, call, return, unwind and exception events; the validator re-derives it.

import { buildCallTree } from "../flowchart/callTree.js";
import { getTraceIndex } from "./traceIndex.js";
import { showValue } from "./values.js";
import {
  SCENE_EVIDENCE_SOURCES,
  SCENE_KIND,
  SCENE_VERSION,
} from "./scene.js";

const RECURSION = "recursion";
const MODULE = "<module>";

/** Same tree-size ceiling the existing Call Tree uses. */
export const RECURSION_MAX_INVOCATIONS = 200;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isString(value) {
  return typeof value === "string";
}

function traceOf(context) {
  if (Array.isArray(context?.trace)) return context.trace;
  if (Array.isArray(context?.result?.trace)) return context.result.trace;
  return [];
}

function sourceOf(context) {
  return isString(context?.source) ? context.source : "";
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
  return RECURSION;
}

function familyNames(profile, recognition) {
  const names = new Set();
  const byId = new Map(
    (Array.isArray(profile?.functions) ? profile.functions : [])
      .filter((fn) => isObject(fn) && isString(fn.id) && isString(fn.name))
      .map((fn) => [fn.id, fn.name]),
  );
  const direct = Array.isArray(profile?.recursion?.direct) ? profile.recursion.direct : [];
  for (const id of direct) {
    const name = byId.get(id);
    if (name) names.add(name);
  }
  const mutual = Array.isArray(profile?.recursion?.mutual_candidates)
    ? profile.recursion.mutual_candidates
    : [];
  for (const group of mutual) {
    if (!Array.isArray(group)) continue;
    for (const id of group) {
      const name = byId.get(id);
      if (name) names.add(name);
    }
  }
  for (const item of Array.isArray(recognition?.evidence) ? recognition.evidence : []) {
    if (item?.kind === "direct_recursion" && isString(item.function)) names.add(item.function);
    if (item?.kind === "mutual_recursion_candidates" && Array.isArray(item.functions)) {
      for (const name of item.functions) if (isString(name)) names.add(name);
    }
  }
  names.delete(MODULE);
  return names;
}

function analyze(context) {
  const view = isObject(context?.stepView) ? context.stepView : null;
  if (!view || !isObject(view.event)) {
    return { available: false, reason: "no execution step is available for this trace" };
  }
  const trace = traceOf(context);
  if (trace.length === 0) {
    return { available: false, reason: "the trace is empty" };
  }
  const profile = context?.profile;
  if (!isObject(profile) || profile.status !== "ok") {
    const status = isObject(profile) && isString(profile.status) ? profile.status : "missing";
    return { available: false, reason: `program profile is not usable (status: ${status})` };
  }
  const names = familyNames(profile, context?.recognition);
  if (names.size === 0) {
    return {
      available: false,
      reason: "the program profile shows no direct or mutual recursion",
    };
  }

  const source = sourceOf(context);
  const tree = buildCallTree(trace, source);
  const familyNodes = tree.nodes.filter((node) => names.has(node.function));
  if (familyNodes.length === 0) {
    return {
      available: false,
      reason: "the trace contains no call to the recursive function family",
    };
  }

  const parentIds = new Map();
  const children = new Map();
  let edgeCount = 0;
  for (const node of familyNodes) {
    const actualParent = node.parentId === null ? null : tree.byId.get(node.parentId) ?? null;
    const parent = actualParent && names.has(actualParent.function) ? actualParent : null;
    if (parent) {
      parentIds.set(node.frameId, parent.frameId);
      const list = children.get(parent.frameId) ?? [];
      list.push(node);
      children.set(parent.frameId, list);
      edgeCount += 1;
    }
  }
  for (const list of children.values()) list.sort((a, b) => a.firstIndex - b.firstIndex);
  const roots = familyNodes
    .filter((node) => !parentIds.has(node.frameId))
    .sort((a, b) => a.firstIndex - b.firstIndex);
  if (edgeCount === 0) {
    return {
      available: false,
      reason: "the trace shows no nested recursive invocation",
    };
  }

  // A family edge alone is not enough: one candidate calling another is an
  // ordinary chain until some function actually reappears in its ancestry.
  let directCycle = false;
  let mutualCycle = false;
  for (const node of familyNodes) {
    let parentId = parentIds.get(node.frameId);
    let distance = 0;
    while (parentId !== undefined) {
      distance += 1;
      const ancestor = tree.byId.get(parentId);
      if (ancestor?.function === node.function) {
        if (distance === 1) directCycle = true;
        else mutualCycle = true;
        break;
      }
      parentId = parentIds.get(parentId);
    }
  }
  if (!directCycle && !mutualCycle) {
    return {
      available: false,
      reason: "the trace shows no repeated recursive invocation",
    };
  }

  // Breadth-first is the same deterministic selection the Call Tree layout
  // uses, so a capped scene keeps the top of the recursion tree.
  const queue = [...roots];
  const reachable = [];
  for (let i = 0; i < queue.length; i += 1) {
    const node = queue[i];
    reachable.push(node);
    for (const child of children.get(node.frameId) ?? []) queue.push(child);
  }

  return {
    available: true,
    reason: null,
    model: {
      names,
      mutual: mutualCycle,
      nodes: reachable,
      parentIds,
      children,
      edgeCount,
      total: reachable.length,
    },
  };
}

function exceptionForUnwind(trace, frameId, unwindIndex) {
  if (unwindIndex === null || unwindIndex === undefined) return null;
  let found = null;
  for (let i = 0; i < unwindIndex; i += 1) {
    const event = trace[i];
    if (event?.event === "exception" && event.frame_id === frameId) {
      found = {
        type: event.exception?.type ?? null,
        message: event.exception?.message ?? null,
      };
    }
  }
  return found;
}

function outcomeOf(info, view, active) {
  if (view.index < info.firstIndex) return "future";
  if (info.returnIndex !== null && view.index >= info.returnIndex) return "returned";
  if (info.unwindIndex !== null && view.index >= info.unwindIndex) return "raised";
  if (active) return info.frameId === view.frameId ? "running" : "waiting";
  return "unfinished";
}

function invocationItem(node, context, model, included, activeIds) {
  const view = context.stepView;
  const trace = traceOf(context);
  const traceIndex = isObject(context.traceIndex)
    ? context.traceIndex
    : getTraceIndex(trace);
  const info = traceIndex.frame(node.frameId);
  if (!info) return null;

  const returnEvent = info.returnIndex === null ? null : trace[info.returnIndex];
  const returnValue =
    returnEvent?.return_value ? showValue(returnEvent.return_value, returnEvent.heap) : null;
  const exception = exceptionForUnwind(trace, node.frameId, info.unwindIndex);
  const active = activeIds.has(node.frameId);
  const children = model.children.get(node.frameId) ?? [];
  const representedChildren = children.filter((child) => included.has(child.frameId)).length;

  return {
    kind: "invocation",
    frameId: node.frameId,
    parentFrameId: model.parentIds.get(node.frameId) ?? null,
    function: info.function,
    depth: info.depth,
    callLine: info.callLine,
    firstIndex: info.firstIndex,
    returnIndex: info.returnIndex,
    unwindIndex: info.unwindIndex,
    returnValue,
    outcome: outcomeOf(info, view, active),
    exceptionType: exception?.type ?? null,
    exceptionMessage: exception?.message ?? null,
    args: node.args.map((arg) => ({ name: arg.name, text: arg.text })),
    active,
    current: view.frameId === node.frameId,
    historical: !active,
    baseCase:
      info.returnIndex !== null &&
      info.unwindIndex === null &&
      children.length === 0 &&
      view.index >= info.returnIndex,
    hiddenChildren: children.length - representedChildren,
  };
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

function contextRegion(view, recognition, resultStatus) {
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
  ];
  if (isString(view.function)) {
    items.push({ kind: "context", name: "function", text: view.function });
  }
  if (isString(resultStatus)) {
    items.push({ kind: "context", name: "status", text: resultStatus });
  }
  if (recognition) {
    items.push({ kind: "context", name: "recognition", text: recognition.adapterId });
  }
  if (view.returnValue !== null && view.returnValue !== undefined) {
    items.push({ kind: "context", name: "return value", text: String(view.returnValue) });
  }
  return {
    id: "context",
    kind: "context",
    label: "Execution context",
    items,
  };
}

function reasonFor(context, model, shown, limit) {
  const reasons = [];
  const resultStatus = context?.result?.status ?? context?.status ?? null;
  if (["step_limit", "timeout", "output_limit", "internal_error"].includes(resultStatus)) {
    reasons.push(`the trace ended at its ${resultStatus} limit`);
  }
  const omitted = model.total - shown.length;
  if (omitted > 0) {
    reasons.push(
      `${omitted} recursive invocation${omitted === 1 ? "" : "s"} omitted by the ${limit} invocation scene limit`,
    );
  }
  const unfinished = shown.filter((item) => item.outcome === "unfinished").length;
  if (unfinished > 0) {
    reasons.push(
      `${unfinished} recursive invocation${unfinished === 1 ? "" : "s"} did not finish before the trace ended`,
    );
  }
  if (context?.stepView?.selectionLost) {
    reasons.push("the selected call is no longer on the stack; the live invocation path is shown");
  }
  if (context?.stepView?.line != null && context.stepView.code == null) {
    reasons.push("the selected source line is not present in the submitted source");
  }
  return reasons.length > 0 ? reasons.join("; ") : null;
}

function unsupportedScene(context, reason, limit) {
  const view = isObject(context?.stepView) ? context.stepView : null;
  const recognition = recognitionView(context?.recognition);
  return {
    version: SCENE_VERSION,
    kind: SCENE_KIND,
    adapterId: RECURSION,
    status: "unsupported",
    title: "Recursive calls",
    subtitle: "Not enough recursion evidence",
    capabilities: [RECURSION],
    sourceLine: null,
    focus: null,
    highlights: [],
    regions: [],
    changes: [],
    accessibility: {
      label: "Recursion view unavailable",
      summary: reason,
    },
    evidence: [
      { source: "adapter", kind: "recursion_unavailable", detail: reason },
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
      invocationCount: 0,
      shownInvocations: 0,
      omittedInvocations: 0,
      invocationLimit: limit,
    },
  };
}

export function createRecursionAdapter(options = {}) {
  const limit = Number.isFinite(options?.limit)
    ? Math.max(1, Math.floor(options.limit))
    : RECURSION_MAX_INVOCATIONS;

  return Object.freeze({
    id: RECURSION,
    label: "Recursive calls",
    description:
      "Shows the real invocation tree, arguments, active path, returns, exceptions and base cases without inventing missing calls.",
    capabilities: Object.freeze([RECURSION]),
    availability(context) {
      const analysis = analyze(context);
      return analysis.available
        ? { available: true, reason: null }
        : { available: false, reason: analysis.reason };
    },
    build(context = {}) {
      const analysis = analyze(context);
      if (!analysis.available) return unsupportedScene(context, analysis.reason, limit);
      const model = analysis.model;
      const view = context.stepView;
      const recognition = recognitionView(context.recognition);
      const resultStatus = context?.result?.status ?? context?.status ?? null;

      const shownNodes = model.nodes.slice(0, limit);
      const included = new Set(shownNodes.map((node) => node.frameId));
      const activeIds = new Set(
        (Array.isArray(view.callStack) ? view.callStack : []).map((frame) => frame.frameId),
      );
      const items = shownNodes
        .map((node) => invocationItem(node, context, model, included, activeIds))
        .filter(Boolean);
      const omitted = model.total - shownNodes.length;
      const reason = reasonFor(context, model, items, limit);
      const status = reason === null ? "ok" : "partial";
      const activePath = (Array.isArray(view.callStack) ? view.callStack : []).filter((frame) =>
        model.names.has(frame.function),
      );
      const focusFrame = activePath[0] ?? null;
      const focus = focusFrame
        ? { kind: "frame", id: focusFrame.frameId }
        : view.code
          ? { kind: "line", line: view.code.line }
          : null;
      const names = [...model.names].sort();
      const kind = model.mutual ? "mutual" : "direct";
      const sourceLine = view.code
        ? { line: view.code.line, text: view.code.text, indent: view.code.indent }
        : null;
      const subtitle = [
        `${kind} recursion`,
        names.join(" ↔ "),
        omitted > 0 ? `${items.length} of ${model.total} shown` : null,
      ]
        .filter((part) => isString(part) && part.length > 0)
        .join(" · ");
      const summary = [
        `${kind === "mutual" ? "Mutual" : "Direct"} recursion among ${names.join(", ")}.`,
        `${items.length} of ${model.total} invocation${model.total === 1 ? "" : "s"} represented.`,
        reason,
      ]
        .filter((part) => isString(part) && part.length > 0)
        .join(" ");

      return {
        version: SCENE_VERSION,
        kind: SCENE_KIND,
        adapterId: RECURSION,
        status,
        title: "Recursive calls",
        subtitle: subtitle.length > 0 ? subtitle : null,
        capabilities: [RECURSION],
        sourceLine,
        focus,
        highlights: activePath.map((frame, i) => ({
          kind: "frame",
          id: frame.frameId,
          tone: i === 0 ? "focus" : "muted",
        })),
        regions: [
          sourceRegion(view),
          {
            id: "invocations",
            kind: "algorithm",
            label:
              items.length === model.total
                ? "Recursive invocations"
                : `Recursive invocations (${items.length} of ${model.total} shown)`,
            items,
          },
          contextRegion(view, recognition, resultStatus),
        ].filter(Boolean),
        changes: [],
        accessibility: {
          label: `Recursion at step ${view.index + 1}: ${focusFrame?.function ?? view.function ?? "no active call"}`,
          summary,
        },
        evidence: [
          {
            source: "profile",
            kind: "recursion_family",
            detail: `${kind} recursion: ${names.join(", ")}`,
          },
          {
            source: "trace",
            kind: "recursive_frames",
            detail: `${model.edgeCount} nested recursive call${model.edgeCount === 1 ? "" : "s"} across ${model.total} invocation${model.total === 1 ? "" : "s"}`,
          },
          {
            source: "adapter",
            kind: "invocation_tree",
            detail: `${items.length} invocation${items.length === 1 ? "" : "s"} represented in breadth-first order`,
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
          invocationCount: model.total,
          shownInvocations: items.length,
          omittedInvocations: omitted,
          invocationLimit: limit,
        },
      };
    },
  });
}

export const RECURSION_ADAPTER = createRecursionAdapter();
