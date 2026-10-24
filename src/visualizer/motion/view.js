// The DOM-free half of the motion renderer: turn a Stage 1 plan into the
// persistent nodes the canvas draws, plus the flags that say what this step
// changed. The component owns only measurements and Web Animations.
//
// The view never supplies a value the plan does not already hold. An element
// that leaves the target state is kept as a ghost carrying the *previous*
// snapshot's data; an element in the target state always carries the current
// snapshot's data. That split is what lets an exit fade without the canvas
// briefly showing a made-up intermediate value.

import { MOTION_OPERATION, motionNodes } from "./plan.js";

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
  }

  return { entering, exiting, changed, highlighted, moves };
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
  return {
    ...object,
    entering: flags.entering.has(object.key),
    highlighted: flags.highlighted.has(object.key),
    slots: object.slots.map((slot) => slotView(slot, flags)),
  };
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
      if (node) ghosts.push({ key, kind: node.kind, node });
    }
  }

  return {
    index: plan.index,
    step: plan.step,
    event: plan.event,
    transition: plan.transition,
    animate: plan.animate,
    durationMs: plan.durationMs,
    mode: plan.mode,
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
