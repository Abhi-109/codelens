// What this build can actually draw, in machine-readable form.
//
// The ids are the ones `vizMode.js` already offers — this registry describes
// them, it does not create a second list of canvases. Anything not in
// `VIZ_MODES` is rejected rather than registered as a future renderer.

import { VIZ_BLURBS, VIZ_LABELS, VIZ_MODES, isVizMode } from "../visualizer/vizMode.js";

export const RENDERER_REGISTRY_VERSION = 1;

const ALL_EVENTS = Object.freeze([
  "call",
  "line",
  "return",
  "exception",
  "unwind",
  "output",
  "input",
  "compare",
]);

function capability(entry) {
  return Object.freeze({
    secondary: true,
    events: ALL_EVENTS,
    shapes: [],
    requiredEvidence: [],
    concepts: [],
    limitations: [],
    sharedCursor: true,
    reducedMotion: true,
    fallback: "motion",
    ...entry,
  });
}

/** One entry per real canvas, in the order the workspace offers them. */
export const RENDERER_CAPABILITIES = Object.freeze([
  capability({
    id: "motion",
    name: VIZ_LABELS.motion,
    purpose: VIZ_BLURBS.motion,
    primary: true,
    shapes: ["scalar", "ref", "list", "tuple", "dict", "set", "object"],
    requiredEvidence: ["trace"],
    concepts: [],
    limitations: ["Only draws movement the recorded actions prove."],
  }),
  capability({
    id: "scene",
    name: VIZ_LABELS.scene,
    purpose: VIZ_BLURBS.scene,
    primary: true,
    requiredEvidence: ["trace_frames"],
    concepts: ["recursion", "search_like", "sort_like", "list", "dict", "scalars"],
    limitations: ["A specialized adapter is shown only when the recognizer has every piece of evidence."],
  }),
  capability({
    id: "tree",
    name: VIZ_LABELS.tree,
    purpose: VIZ_BLURBS.tree,
    primary: true,
    requiredEvidence: ["call_events"],
    concepts: ["function", "call", "recursion", "nested_calls", "return"],
    limitations: ["Shows calls the tracer recorded; it cannot invent a call it did not see."],
  }),
  capability({
    id: "flow",
    name: VIZ_LABELS.flow,
    purpose: VIZ_BLURBS.flow,
    primary: true,
    events: ["line", "call", "return", "exception", "unwind"],
    shapes: [],
    requiredEvidence: ["source_flow"],
    concepts: ["branch", "loop", "nested_loop", "comparison", "exception_handling"],
    limitations: ["The flowchart is a reading of the source; the lit path comes from the trace."],
  }),
  capability({
    id: "combined",
    name: VIZ_LABELS.combined,
    purpose: VIZ_BLURBS.combined,
    primary: true,
    requiredEvidence: ["call_events", "trace_frames"],
    concepts: ["function", "call", "nested_calls", "recursion", "list", "dict"],
    limitations: ["Draws two existing views side by side; it adds no new evidence."],
  }),
  capability({
    id: "timeline",
    name: VIZ_LABELS.timeline,
    purpose: VIZ_BLURBS.timeline,
    primary: false,
    events: ALL_EVENTS,
    shapes: ["scalar", "ref"],
    requiredEvidence: ["trace"],
    concepts: [],
    limitations: ["A list of every step; it is not chosen automatically because it explains less per step."],
  }),
]);

const BY_ID = new Map(RENDERER_CAPABILITIES.map((entry) => [entry.id, entry]));

export function isRendererId(id) {
  return typeof id === "string" && BY_ID.has(id) && isVizMode(id);
}

export function getRenderer(id) {
  return isRendererId(id) ? BY_ID.get(id) : null;
}

export function rendererIds() {
  return VIZ_MODES.filter((id) => BY_ID.has(id));
}

export function supportsConcept(id, concept) {
  const renderer = getRenderer(id);
  if (!renderer) return false;
  return renderer.concepts.length === 0 || renderer.concepts.includes(concept);
}

/**
 * Can `id` draw this evidence? Returns the explicit missing pieces instead of a
 * bare boolean, so a plan reason can say what was absent.
 *
 * @param {string} id
 * @param {{trace?: {events?: number, calls?: number, hasFrames?: boolean}, hasFlow?: boolean}} evidence
 */
export function canRender(id, evidence = {}) {
  const renderer = getRenderer(id);
  if (!renderer) return { ok: false, renderer: null, missing: ["unknown_renderer"] };
  const trace = evidence?.trace ?? {};
  const missing = [];
  for (const requirement of renderer.requiredEvidence) {
    if (requirement === "trace" && !((trace.events ?? 0) > 0)) missing.push("trace");
    if (requirement === "trace_frames" && !trace.hasFrames) missing.push("trace_frames");
    if (requirement === "call_events" && !((trace.calls ?? 0) > 0)) missing.push("call_events");
    if (requirement === "source_flow" && evidence?.hasFlow !== true) missing.push("source_flow");
  }
  return { ok: missing.length === 0, renderer, missing };
}
