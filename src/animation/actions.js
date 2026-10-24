// The action vocabulary of the animation diff.
//
// One transition of a format-2 trace becomes a list of actions (spec section 6
// of docs/animation-spec.md). This module owns the vocabulary and nothing else:
// the kinds, whether a kind mutates the snapshot or is a transient overlay, the
// canonical target paths, and the one deterministic id rule. The inference that
// decides *which* action a transition earns lives in diff.js; the rules are in
// docs/animation.md.
//
// Two properties matter here and are pinned by actions.test.mjs:
//
//   * ids are deterministic. They are derived from (step, kind, motion, target)
//     and nothing else - not from a counter, a clock, a random source, or the
//     order in which the diff happened to emit them. Recomputing a step after a
//     seek must produce the same ids, or the stage would re-key and re-animate
//     elements that did not change.
//   * every kind has exactly one effect. A "state" action mutates the compared
//     snapshot (and must therefore be reversible). An "overlay" action never
//     mutates it: it is a highlight, an edge annotation, printed text, a return
//     flight, or an error badge, and it never outlives its step.

/** The action kinds, in the order docs/animation-spec.md section 6 lists them. */
export const ACTION_KINDS = Object.freeze([
  "appear",
  "disappear",
  "change",
  "highlight",
  "move",
  "grow",
  "shrink",
  "connect",
  "disconnect",
  "call",
  "return",
  "print",
  "error",
]);

/** Kinds that change the compared snapshot. Applying them must be reversible. */
export const STATE_KINDS = Object.freeze([
  "appear",
  "disappear",
  "change",
  "move",
  "grow",
  "shrink",
  "call",
]);

/**
 * Kinds that never change the snapshot: they describe something the state
 * already implies. They are keyed to one step and reset when the cursor moves.
 */
export const OVERLAY_KINDS = Object.freeze([
  "highlight",
  "connect",
  "disconnect",
  "return",
  "print",
  "error",
]);

export const ACTION_EFFECT = Object.freeze({
  state: "state",
  overlay: "overlay",
});

/**
 * Why an inference fell back to a conservative action. The diff attaches one of
 * these whenever it cannot defensibly claim movement, and the report never
 * hides the case: see docs/animation.md section 11.
 */
export const FALLBACK_REASON = Object.freeze({
  duplicateValues: "duplicate-values",
  truncated: "truncated",
  unknownShape: "unknown-shape",
  indexUnavailable: "index-unavailable",
  unsupported: "unsupported",
});

/** The motion a kind may carry. Movement must name its shape; other kinds may not. */
export const MOTIONS = Object.freeze({
  move: Object.freeze(["swap", "shift"]),
  grow: Object.freeze(["append", "insert"]),
  shrink: Object.freeze(["pop", "delete"]),
});

/** Where an action points. A path is canonical within the run. */
export const TARGET_KINDS = Object.freeze([
  "variable",
  "cell",
  "entry",
  "attribute",
  "object",
  "frame",
  "console",
]);

const EFFECT_OF = new Map([
  ...STATE_KINDS.map((kind) => [kind, ACTION_EFFECT.state]),
  ...OVERLAY_KINDS.map((kind) => [kind, ACTION_EFFECT.overlay]),
]);

const REASONS = new Set(Object.values(FALLBACK_REASON));
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const OBJECT_ID = /^o[0-9]+$/;

function fail(message) {
  throw new TypeError(message);
}

function isFrameId(value) {
  return Number.isInteger(value) && value >= 0;
}

/**
 * Canonical JSON for a trace value: object keys sorted at every depth, array
 * order kept. The tracer happens to emit a stable key order today, but an id
 * must not depend on that accident.
 */
export function canonicalValue(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") {
    const text = JSON.stringify(value);
    return text === undefined ? "null" : text;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(",")}]`;
  const keys = Object.keys(value).sort();
  const body = keys.map((key) => `${JSON.stringify(key)}:${canonicalValue(value[key])}`);
  return `{${body.join(",")}}`;
}

function checkTarget(target) {
  if (!target || typeof target !== "object") fail("an action needs a target");
  const kind = target.kind;
  if (!TARGET_KINDS.includes(kind)) fail(`unknown target kind: ${String(kind)}`);
  const allowed = new Set(["kind"]);
  if (kind === "variable") {
    if (!isFrameId(target.frameId)) fail("a variable target needs a frameId");
    if (!IDENTIFIER.test(target.name ?? "")) fail("a variable target needs a name");
    allowed.add("frameId");
    allowed.add("name");
  } else if (kind === "cell") {
    if (!OBJECT_ID.test(target.objectId ?? "")) fail("a cell target needs an objectId");
    if (!Number.isInteger(target.index) || target.index < 0) {
      fail("a cell target needs a non-negative index");
    }
    allowed.add("objectId");
    allowed.add("index");
  } else if (kind === "entry") {
    if (!OBJECT_ID.test(target.objectId ?? "")) fail("an entry target needs an objectId");
    if (!target.key || typeof target.key !== "object" || typeof target.key.type !== "string") {
      fail("an entry target needs a trace value as its key");
    }
    allowed.add("objectId");
    allowed.add("key");
  } else if (kind === "attribute") {
    if (!OBJECT_ID.test(target.objectId ?? "")) fail("an attribute target needs an objectId");
    if (typeof target.name !== "string" || target.name.length === 0) {
      fail("an attribute target needs a name");
    }
    allowed.add("objectId");
    allowed.add("name");
  } else if (kind === "object") {
    if (!OBJECT_ID.test(target.objectId ?? "")) fail("an object target needs an objectId");
    allowed.add("objectId");
  } else if (kind === "frame") {
    if (!isFrameId(target.frameId)) fail("a frame target needs a frameId");
    allowed.add("frameId");
  }
  for (const key of Object.keys(target)) {
    if (!allowed.has(key)) fail(`unexpected target field: ${key}`);
  }
}

/**
 * The canonical path of a target. Two targets that mean the same element always
 * produce the same string, so they produce the same id.
 */
export function targetPath(target) {
  checkTarget(target);
  switch (target.kind) {
    case "variable":
      return `f${target.frameId}.${target.name}`;
    case "cell":
      return `${target.objectId}[${target.index}]`;
    case "entry":
      return `${target.objectId}[${canonicalValue(target.key)}]`;
    case "attribute":
      return `${target.objectId}.${target.name}`;
    case "object":
      return target.objectId;
    case "frame":
      return `f${target.frameId}`;
    default:
      return "console";
  }
}

function checkMotion(kind, motion) {
  const allowed = MOTIONS[kind] ?? null;
  if (allowed === null) {
    if (motion !== null) fail(`${kind} actions cannot carry a motion`);
    return;
  }
  if (motion === null) fail(`${kind} actions must name a motion`);
  if (!allowed.includes(motion)) fail(`${kind} cannot have the motion ${String(motion)}`);
}

/**
 * One action, with its deterministic id.
 *
 * @param {string} kind one of ACTION_KINDS
 * @param {Object} spec
 * @param {number} spec.step the trace index this action belongs to
 * @param {Object} spec.target the element it acts on (TARGET_KINDS)
 * @param {string|null} [spec.motion] swap|shift|append|insert|pop|delete, per kind
 * @param {*} [spec.from] the value before the transition, when there is one
 * @param {*} [spec.to] the value after the transition, when there is one
 * @param {string|null} [spec.reason] a FALLBACK_REASON code, when the diff fell back
 * @param {Object|null} [spec.payload] kind-specific facts (never part of the id)
 * @returns {Readonly<Object>}
 */
export function createAction(
  kind,
  { step, target, motion = null, from = null, to = null, reason = null, payload = null } = {},
) {
  if (!ACTION_KINDS.includes(kind)) fail(`unknown action kind: ${String(kind)}`);
  if (!Number.isInteger(step) || step < 0) fail("an action needs a non-negative integer step");
  checkTarget(target);
  checkMotion(kind, motion);
  if (reason !== null && !REASONS.has(reason)) fail(`unknown fallback reason: ${String(reason)}`);
  if (payload !== null && (typeof payload !== "object" || Array.isArray(payload))) {
    fail("a payload must be a plain object or null");
  }
  const path = targetPath(target);
  const id = `${step}:${motion === null ? kind : `${kind}.${motion}`}:${path}`;
  return Object.freeze({
    id,
    step,
    kind,
    motion,
    effect: EFFECT_OF.get(kind),
    target: Object.freeze({ ...target }),
    path,
    from,
    to,
    reason,
    payload: payload === null ? null : Object.freeze({ ...payload }),
  });
}

/** True when this action changes the compared snapshot and must be reversible. */
export function isStateAction(action) {
  return action?.effect === ACTION_EFFECT.state;
}

/**
 * The overlay actions of exactly one step. Overlays are transient: they belong
 * to the step that produced them and are dropped the moment the cursor points
 * somewhere else. Backward playback and slider seeks therefore clear them by
 * construction, while a forward step installs only its own.
 *
 * @param {Array} actions a diff result, possibly accumulated across steps
 * @param {number} step the current step
 * @returns {Array} overlays whose step is the current one
 */
export function overlayActionsAt(actions, step) {
  if (!Array.isArray(actions)) return [];
  return actions.filter((action) => action?.effect === ACTION_EFFECT.overlay && action.step === step);
}
