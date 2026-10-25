// The pure half of the motion layer: one cursor position becomes a stable
// render model and a generic list of visual operations.
//
// Nothing here touches React, a timer or a DOM node. The logical state always
// comes from `snapshotAt(trace, index)`, so an interpolation layer can never
// become a second source of truth. The animation engine supplies the actions
// that explain *how* the previous state became this one; those actions are
// only choreography, never a replacement for the recorded state.
//
// Element identity is deliberately conservative:
//
//   * an object keeps its trace object id;
//   * a dict entry is keyed by its canonical key;
//   * a set member is keyed by its value (the only identity a set has);
//   * an object attribute is keyed by its name;
//   * a list/tuple cell is keyed by its position, because the trace records no
//     cell identity. A value change on one index therefore keeps the same key;
//     the layer never guesses that a value "moved" to another index.

import { canonicalValue } from "../../animation/actions.js";
import {
  consoleFollowsReturn,
  diffSteps,
  reverseActions,
  snapshotAt,
  stateActions,
  stateOf,
} from "../../animation/diff.js";
import { namesById, objectLabel } from "../../tracer/objects.js";
import { showValue } from "../../tracer/values.js";
import { isSpeed } from "../playback.js";
import { finalizedCells } from "./finality.js";

/** How the cursor reached this index. Only the two adjacent transitions animate. */
export const MOTION_TRANSITION = Object.freeze({
  initial: "initial",
  forward: "forward",
  backward: "backward",
  seek: "seek",
  hold: "hold",
});

/** Full motion, or the reduced-motion presentation the renderer may fade. */
export const MOTION_MODE = Object.freeze({
  full: "full",
  reduced: "reduced",
});

/** Generic visual operations; the action's own fields remain available beside them. */
export const MOTION_OPERATION = Object.freeze({
  enter: "enter",
  exit: "exit",
  value: "value",
  move: "move",
  highlight: "highlight",
  overlay: "overlay",
});

const BASE_DURATION_MS = Object.freeze({
  enter: 220,
  exit: 180,
  value: 180,
  move: 280,
  highlight: 0,
  overlay: 0,
});

const MIN_DURATION_MS = 80;

/** The canonical key of the render element an action target names. */
export function motionTargetKey(target) {
  if (!target || typeof target !== "object") return null;
  switch (target.kind) {
    case "object":
      return `object:${target.objectId}`;
    case "entry":
      return `entry:${target.objectId}:${canonicalValue(target.key)}`;
    case "attribute":
      return `attribute:${target.objectId}:${target.name}`;
    case "cell":
      return `cell:${target.objectId}:${target.index}`;
    case "frame":
      return `frame:${target.frameId}`;
    case "variable":
      return `variable:${target.frameId}:${target.name}`;
    case "console":
      return "console";
    default:
      return null;
  }
}

/** Milliseconds for one generic operation at the requested speed. */
export function motionDuration(operation, { reducedMotion = false, speed = 1 } = {}) {
  if (reducedMotion) return 0;
  const base = BASE_DURATION_MS[operation] ?? 0;
  if (base === 0) return 0;
  const rate = isSpeed(speed) ? Number(speed) : 1;
  return Math.max(MIN_DURATION_MS, Math.round(base / rate));
}

function valueNode(value, heap) {
  return {
    value,
    text: showValue(value, heap),
    valueType: value?.type ?? "?",
    refId: value?.type === "ref" ? value.id : null,
  };
}

function listSlots(objectId, object, heap) {
  return (object.items ?? []).map((value, index) => ({
    key: motionTargetKey({ kind: "cell", objectId, index }),
    kind: "cell",
    container: "list",
    objectId,
    index,
    label: String(index),
    ...valueNode(value, heap),
  }));
}

function dictSlots(objectId, object, heap) {
  return (object.entries ?? []).map((entry) => ({
    key: motionTargetKey({ kind: "entry", objectId, key: entry.key }),
    kind: "entry",
    container: "dict",
    objectId,
    rawKey: entry.key,
    label: showValue(entry.key, heap),
    ...valueNode(entry.value, heap),
  }));
}

function setSlots(objectId, object, heap) {
  return (object.items ?? []).map((member) => ({
    key: motionTargetKey({ kind: "entry", objectId, key: member }),
    kind: "entry",
    container: "set",
    objectId,
    rawKey: member,
    label: showValue(member, heap),
    ...valueNode(member, heap),
  }));
}

function attributeSlots(objectId, object, heap) {
  return (object.attrs ?? []).map((attribute) => ({
    key: motionTargetKey({ kind: "attribute", objectId, name: attribute.name }),
    kind: "attribute",
    container: "object",
    objectId,
    name: attribute.name,
    label: attribute.name,
    ...valueNode(attribute.value, heap),
  }));
}

function objectSlots(objectId, object, heap) {
  switch (object?.type) {
    case "list":
    case "tuple":
      return listSlots(objectId, object, heap);
    case "dict":
      return dictSlots(objectId, object, heap);
    case "set":
      return setSlots(objectId, object, heap);
    case "object":
      return attributeSlots(objectId, object, heap);
    default:
      return [];
  }
}

function objectOrder(left, right) {
  const a = Number(String(left).replace(/^o/, ""));
  const b = Number(String(right).replace(/^o/, ""));
  if (Number.isFinite(a) && Number.isFinite(b) && a !== b) return a - b;
  return String(left).localeCompare(String(right));
}

/**
 * The stable render model for one exact state.
 *
 * @param {{frames: Array, heap: Object}} state a state from `stateOf`
 * @returns {{frames: Array, objects: Array}} nodes with stable `key` fields
 */
export function motionNodes(state) {
  const frames = Array.isArray(state?.frames) ? state.frames : [];
  const heap = state?.heap ?? {};
  const labels = namesById(frames, heap);

  return {
    frames: frames.map((frame, depth) => ({
      key: motionTargetKey({ kind: "frame", frameId: frame.frame_id }),
      kind: "frame",
      frameId: frame.frame_id,
      function: frame.function,
      callLine: frame.call_line ?? null,
      depth,
      current: depth === frames.length - 1,
      variables: Object.entries(frame.variables ?? {}).map(([name, value]) => ({
        key: motionTargetKey({ kind: "variable", frameId: frame.frame_id, name }),
        kind: "variable",
        frameId: frame.frame_id,
        name,
        ...valueNode(value, heap),
      })),
    })),
    objects: Object.keys(heap)
      .sort(objectOrder)
      .map((objectId) => {
        const object = heap[objectId] ?? {};
        const names = labels.get(objectId) ?? [];
        return {
          key: motionTargetKey({ kind: "object", objectId }),
          kind: "object",
          objectId,
          objectType: object.class ?? object.type ?? "object",
          type: object.type ?? "other",
          label: names.length > 0 ? names.join(", ") : objectLabel(objectId, object),
          more: Number.isInteger(object.more) && object.more > 0 ? object.more : 0,
          slots: objectSlots(objectId, object, heap),
        };
      }),
  };
}

function operationKind(action) {
  switch (action?.kind) {
    case "appear":
    case "grow":
    case "call":
      return MOTION_OPERATION.enter;
    case "disappear":
    case "shrink":
      return MOTION_OPERATION.exit;
    case "change":
      return MOTION_OPERATION.value;
    case "move":
      return MOTION_OPERATION.move;
    case "highlight":
      return MOTION_OPERATION.highlight;
    default:
      return MOTION_OPERATION.overlay;
  }
}

function operationFor(action, options) {
  const op = operationKind(action);
  return {
    id: action.id,
    op,
    effect: action.effect,
    targetKey: motionTargetKey(action.target),
    target: action.target,
    motion: action.motion,
    from: action.from,
    to: action.to,
    reason: action.reason,
    payload: action.payload,
    durationMs: motionDuration(op, options),
    action,
  };
}

function transitionOf(index, previousIndex, traceLength) {
  if (!Number.isInteger(previousIndex)) return MOTION_TRANSITION.initial;
  if (previousIndex === index) return MOTION_TRANSITION.hold;
  if (previousIndex < 0 || previousIndex >= traceLength) return MOTION_TRANSITION.seek;
  if (previousIndex === index - 1) return MOTION_TRANSITION.forward;
  if (previousIndex === index + 1) return MOTION_TRANSITION.backward;
  return MOTION_TRANSITION.seek;
}

/**
 * Build one position's motion plan from the trace and the shared cursor.
 *
 * A plan always carries the exact target state. Actions are present only for an
 * adjacent step, because a seek or reset must render the target directly rather
 * than replay a path the user did not take. Backward playback reverses the
 * original transition's verified actions; it never invents a reverse event.
 *
 * @param {Array} trace the trace events
 * @param {number} index the shared cursor position
 * @param {{
 *   source?: string,
 *   previousIndex?: number|null,
 *   reducedMotion?: boolean,
 *   speed?: number,
 * }} [options]
 * @returns {Object|null}
 */
export function planMotion(
  trace,
  index,
  { source = "", previousIndex = null, reducedMotion = false, speed = 1 } = {},
) {
  if (!Array.isArray(trace) || !Number.isInteger(index) || index < 0 || index >= trace.length) {
    return null;
  }
  const next = snapshotAt(trace, index);
  if (!next) return null;
  // `snapshotAt` borrows the visible state from the previous line event, so a
  // comparison's own operand heap has to be kept separately to print operands.
  const raw = trace[index];
  const state = stateOf(next);
  const line = Number.isInteger(next.line) ? next.line : null;
  const lineText =
    line === null ? null : (String(source).split(/\r?\n/)[line - 1] ?? "").trim() || null;
  const transition = transitionOf(index, previousIndex, trace.length);
  const timing = { reducedMotion, speed };

  let previousState = null;
  let actions = [];
  if (transition === MOTION_TRANSITION.forward) {
    const before = snapshotAt(trace, previousIndex);
    if (!before) return null;
    previousState = stateOf(before);
    actions = diffSteps(before, next, {
      source,
      consoleAfterReturn: consoleFollowsReturn(trace, index),
    });
  } else if (transition === MOTION_TRANSITION.backward) {
    const after = snapshotAt(trace, previousIndex);
    if (!after) return null;
    previousState = stateOf(after);
    const forward = diffSteps(next, after, {
      source,
      consoleAfterReturn: consoleFollowsReturn(trace, previousIndex),
    });
    actions = reverseActions(forward, stateOf(after));
  }

  const operations = actions.map((action) => operationFor(action, timing));
  const durationMs = operations.reduce(
    (longest, operation) => Math.max(longest, operation.durationMs),
    0,
  );

  return {
    index,
    step: next.step,
    event: next.event ?? null,
    compareEvent: raw?.event === "compare" ? raw : null,
    line,
    lineText,
    transition,
    previousIndex: Number.isInteger(previousIndex) ? previousIndex : null,
    mode: reducedMotion ? MOTION_MODE.reduced : MOTION_MODE.full,
    animate:
      (transition === MOTION_TRANSITION.forward ||
        transition === MOTION_TRANSITION.backward) &&
      !reducedMotion &&
      durationMs > 0,
    durationMs,
    state,
    previousState,
    // Cells the recording proves settled. A property of this position only:
    // the same index always recomputes the same cells, whatever the cursor did
    // before, so a seek or a backward step cannot keep a later step's marks.
    finalized: finalizedCells(state, trace),
    actions,
    stateActions: stateActions(actions),
    overlays: actions.filter((action) => action.effect === "overlay"),
    operations,
    nodes: motionNodes(state),
  };
}

/**
 * A tiny cancellation gate for the renderer. Requesting a position supersedes
 * every earlier ticket; a completed stale animation is ignored. The gate has no
 * timers and no trace state, so it can be tested without a browser.
 */
export function createMotionController() {
  let sequence = 0;
  let active = null;

  const isCurrent = (ticket) => Boolean(ticket) && active?.sequence === ticket.sequence;

  return {
    request(plan) {
      sequence += 1;
      active = { sequence, plan };
      return active;
    },
    isCurrent,
    complete(ticket) {
      if (!isCurrent(ticket)) return false;
      active = null;
      return true;
    },
    invalidate() {
      sequence += 1;
      active = null;
    },
    current() {
      return active;
    },
  };
}
