// The DOM-free half of the motion renderer: turn a Stage 1 plan into the
// persistent nodes the canvas draws, plus the flags that say what this step
// changed. The component owns only measurements and Web Animations.
//
// The view never supplies a value the plan does not already hold. An element
// that leaves the target state is kept as a ghost carrying the *previous*
// snapshot's data; an element in the target state always carries the current
// snapshot's data. That split is what lets an exit fade without the canvas
// briefly showing a made-up intermediate value.

import { showValue } from "../../tracer/values.js";
import { MOTION_OPERATION, motionNodes, motionTargetKey } from "./plan.js";

function flatten(nodes) {
  const map = new Map();
  if (!nodes) return map;
  for (const frame of nodes.frames) {
    map.set(frame.key, frame);
    for (const variable of frame.variables) map.set(variable.key, variable);
  }
  for (const object of nodes.objects) {
    map.set(object.key, object);
    for (const slot of object.slots) map.set(slot.key, slot);
  }
  return map;
}

function flagsFor(plan) {
  const entering = new Set();
  const exiting = new Set();
  const changed = new Set();
  const highlighted = new Set();
  const active = new Set();
  const moves = [];

  for (const operation of plan.operations) {
    const key = operation.targetKey;
    if (!key) continue;
    if (operation.op === MOTION_OPERATION.enter) entering.add(key);
    else if (operation.op === MOTION_OPERATION.exit) exiting.add(key);
    else if (operation.op === MOTION_OPERATION.value) changed.add(key);
    else if (operation.op === MOTION_OPERATION.highlight) highlighted.add(key);
    else if (operation.op === MOTION_OPERATION.move) {
      moves.push({
        key,
        objectId: operation.target?.objectId ?? null,
        indices: operation.action?.payload?.indices ?? null,
        motion: operation.motion,
        durationMs: operation.durationMs,
      });
    }

    // The operation's own cells, from the verified action only: both ends of a
    // recorded pair, or the one cell an insert, removal or change names.
    if (operation.op === MOTION_OPERATION.move) {
      const objectId = operation.target?.objectId;
      for (const index of operation.action?.payload?.indices ?? []) {
        active.add(motionTargetKey({ kind: "cell", objectId, index }));
      }
    } else if (operation.target?.kind === "cell") {
      active.add(key);
    }
  }

  return { entering, exiting, changed, highlighted, active, moves };
}

function variableView(variable, flags) {
  return {
    ...variable,
    entering: flags.entering.has(variable.key),
    changed: flags.changed.has(variable.key),
    highlighted: flags.highlighted.has(variable.key),
  };
}

function slotView(slot, flags) {
  return {
    ...slot,
    entering: flags.entering.has(slot.key),
    changed: flags.changed.has(slot.key),
    highlighted: flags.highlighted.has(slot.key),
    active: flags.active.has(slot.key),
  };
}

function frameView(frame, flags) {
  return {
    ...frame,
    entering: flags.entering.has(frame.key),
    highlighted: flags.highlighted.has(frame.key),
    variables: frame.variables.map((variable) => variableView(variable, flags)),
  };
}

function objectView(object, flags) {
  const slots = object.slots.map((slot) => slotView(slot, flags));
  return {
    ...object,
    entering: flags.entering.has(object.key),
    highlighted: flags.highlighted.has(object.key),
    slots,
  };
}

/**
 * One truthful line about what this step did, built only from the verified
 * actions and the snapshots both ends of the transition already carry.
 *
 * It never calls a change a swap: a swap is reported only when the diff proved
 * one (a `move` with the recorded index pair). A step that changed nothing in
 * the data says so instead of borrowing an event name.
 *
 * @param {Object|null} plan a plan from `planMotion`
 * @returns {{kind: string, text: string}|null}
 */
export function operationFeedback(plan) {
  if (!plan) return null;
  const operations = Array.isArray(plan.operations) ? plan.operations : [];
  // `from` values exist in the state the animation starts from; `to` values in
  // the target state. Reading each from its own heap keeps a newly created
  // object printable instead of "(not shown at this step)".
  const before = plan.previousState?.heap ?? plan.state?.heap ?? {};
  const after = plan.state?.heap ?? before;
  const fromText = (value) => (value ? showValue(value, before) : "?");
  const toText = (value) => (value ? showValue(value, after) : "?");
  const find = (predicate) => operations.find(predicate) ?? null;

  const swap = find(
    (operation) =>
      operation.op === MOTION_OPERATION.move &&
      operation.motion === "swap" &&
      operation.action?.payload?.indices?.length === 2,
  );
  if (swap) {
    const [left, right] = swap.action.payload.indices;
    const items = plan.previousState?.heap?.[swap.action.target.objectId]?.items;
    return {
      kind: "swap",
      text: items
        ? `swap [${left}] ${fromText(items[left])} ↔ [${right}] ${fromText(items[right])}`
        : `swap [${left}] ↔ [${right}]`,
    };
  }

  const shift = find(
    (operation) => operation.op === MOTION_OPERATION.move && operation.motion === "shift",
  );
  if (shift) {
    const [origin, destination] = shift.action.payload.indices;
    return {
      kind: "shift",
      text: `shift [${origin}] ${toText(shift.action.to)} → [${destination}]`,
    };
  }

  const grew = find(
    (operation) => operation.op === MOTION_OPERATION.enter && operation.action?.kind === "grow",
  );
  if (grew) {
    const verb = grew.action.motion === "append" ? "append" : "insert";
    return {
      kind: "insert",
      text: `${verb} [${grew.action.target.index}] ${toText(grew.action.to)}`,
    };
  }

  const shrank = find(
    (operation) => operation.op === MOTION_OPERATION.exit && operation.action?.kind === "shrink",
  );
  if (shrank) {
    const verb = shrank.action.motion === "pop" ? "pop" : "remove";
    return {
      kind: "remove",
      text: `${verb} [${shrank.action.target.index}] ${fromText(shrank.action.from)}`,
    };
  }

  // A local variable is bookkeeping, not the operation being taught: it stays
  // in the call strip and never becomes the headline. A real data change wins
  // even when the same step also assigned a loop counter.
  const changed = find(
    (operation) =>
      operation.op === MOTION_OPERATION.value && operation.target?.kind !== "variable",
  );
  if (changed) {
    const target = changed.action?.target ?? {};
    const from = fromText(changed.action?.from);
    const to = toText(changed.action?.to);
    if (target.kind === "cell") {
      return { kind: "change", text: `[${target.index}] ${from} → ${to}` };
    }
    if (target.kind === "attribute") {
      return { kind: "change", text: `${target.name} ${from} → ${to}` };
    }
    if (target.kind === "entry") {
      return { kind: "change", text: `${showValue(target.key, after)} ${from} → ${to}` };
    }
    return { kind: "change", text: `${from} → ${to}` };
  }

  const called = find(
    (operation) => operation.op === MOTION_OPERATION.enter && operation.action?.kind === "call",
  );
  if (called) {
    return { kind: "call", text: `call ${called.action.payload?.function ?? "function"}` };
  }

  const returned = find((operation) => operation.action?.kind === "return");
  if (returned) {
    const value = returned.action.payload?.value;
    return { kind: "return", text: value ? `return ${toText(value)}` : "return" };
  }

  const frameLeft = find(
    (operation) => operation.op === MOTION_OPERATION.exit && operation.target?.kind === "frame",
  );
  if (frameLeft) {
    const name = frameLeft.action?.from?.function;
    return { kind: "return", text: name ? `return from ${name}` : "call ends" };
  }

  // Nothing proven to describe: a plain line step, or a step that only moved a
  // bookkeeping variable. The head still shows which line ran.
  return { kind: "neutral", text: operations.length > 0 ? "step" : "no data change" };
}

/**
 * The drawable model for one plan.
 *
 * `ghosts` are only the elements that left the target state. They carry the
 * previous snapshot's node, never the target's, and are rendered above the
 * target so a removed element can animate away without changing layout.
 *
 * @param {Object|null} plan a plan from `planMotion`
 * @returns {Object|null}
 */
export function motionView(plan) {
  if (!plan) return null;
  const previousNodes = plan.previousState ? motionNodes(plan.previousState) : null;
  const previous = flatten(previousNodes);
  const flags = flagsFor(plan);

  // A seek, reset, hold or reduced-motion presentation renders the exact
  // target directly. Only a real adjacent animation may show a removed node.
  const ghosts = [];
  if (plan.animate) {
    for (const key of flags.exiting) {
      const node = previous.get(key);
      if (node) ghosts.push({ key, kind: node.kind, node, active: flags.active.has(key) });
    }
  }

  return {
    index: plan.index,
    step: plan.step,
    event: plan.event,
    line: plan.line ?? null,
    lineText: plan.lineText ?? null,
    transition: plan.transition,
    animate: plan.animate,
    durationMs: plan.durationMs,
    mode: plan.mode,
    feedback: operationFeedback(plan),
    frames: plan.nodes.frames.map((frame) => frameView(frame, flags)),
    objects: plan.nodes.objects.map((object) => objectView(object, flags)),
    ghosts,
    moves: flags.moves,
    entering: [...flags.entering],
    exiting: [...flags.exiting],
    changed: [...flags.changed],
    highlighted: [...flags.highlighted],
  };
}
