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
import { stageResult } from "./stageResult.js";

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

/** How one recorded operator reads in a sentence, for a true and a false result. */
const COMPARE_WORDS = Object.freeze({
  ">": ["is greater than", "is not greater than"],
  ">=": ["is at least", "is less than"],
  "<": ["is less than", "is not less than"],
  "<=": ["is at most", "is greater than"],
  "==": ["equals", "does not equal"],
  "!=": ["does not equal", "equals"],
  is: ["is the same object as", "is not the same object as"],
  "is not": ["is not the same object as", "is the same object as"],
  in: ["is in", "is not in"],
  "not in": ["is not in", "is in"],
});

/**
 * The comparison this step recorded, or null.
 *
 * A `compare` event is the only evidence of which two values met: its operands,
 * operator and bool-or-null result come straight from the recording, and its
 * own heap resolves any operand that is a reference. The operand cells get the
 * gold comparison ring only when they still name a visible list or tuple
 * position in the state on screen; a cellless operand (a scalar, a set
 * membership, a dict value) highlights nothing rather than guessing a position.
 *
 * @param {Object|null} plan a plan from `planMotion`
 * @returns {{text: string, explanation: string, cells: string[]}|null}
 */
export function comparisonOf(plan) {
  const event = plan?.compareEvent;
  if (!event || event.event !== "compare") return null;
  const operands = Array.isArray(event.operands) ? event.operands : [];
  if (operands.length !== 2) return null;
  const heap = event.heap ?? {};
  const cells = [];
  for (const operand of operands) {
    const cell = operand?.cell;
    if (!cell || !Number.isInteger(cell.index) || cell.index < 0) continue;
    const object = plan.state?.heap?.[cell.object_id];
    if (!object || (object.type !== "list" && object.type !== "tuple")) continue;
    if (cell.index >= (object.items?.length ?? 0)) continue;
    cells.push(motionTargetKey({ kind: "cell", objectId: cell.object_id, index: cell.index }));
  }
  const left = showValue(operands[0]?.value, heap);
  const right = showValue(operands[1]?.value, heap);
  const verdict = typeof event.result === "boolean" ? (event.result ? " → True" : " → False") : "";
  const words = COMPARE_WORDS[event.operator];
  let explanation;
  if (typeof event.result === "boolean") {
    explanation = words
      ? `${left} ${words[event.result ? 0 : 1]} ${right}.`
      : `The comparison ${left} ${event.operator} ${right} is ${event.result ? "True" : "False"}.`;
  } else {
    explanation = `The comparison ${left} ${event.operator} ${right} produced no True or False.`;
  }
  return {
    text: `Compare ${left} ${event.operator} ${right}${verdict}`,
    explanation,
    cells,
  };
}

/**
 * The return this step recorded, or null.
 *
 * A return event carries the value the call handed back, and its action names
 * the frame. The frame is still on screen at that step, so the value can be
 * shown on it; the next step removes the frame and the caller's variable shows
 * where the value went.
 *
 * @param {Object|null} plan a plan from `planMotion`
 * @returns {{frameId: number|null, function: string|null, text: string|null}|null}
 */
export function returnOf(plan) {
  const recorded = plan?.returned;
  if (!recorded) return null;
  const value = recorded.value ?? null;
  return {
    frameId: recorded.frameId,
    function: recorded.function,
    text: value ? showValue(value, plan.state?.heap ?? {}) : null,
  };
}

/** The error facts the recorded event carries, or null. */
function errorOf(plan) {
  return plan?.recordedError ?? null;
}

/**
 * What a raised error means, from the trace's own lookahead.
 *
 * The distinction the learner needs is whether anything catches it: a matching
 * `except` block means the program continues, an unwind means it leaves this
 * frame, and no handler at all means the run ends. The wording matches the
 * explanation card, so the two panels cannot tell different stories.
 */
function errorFeedback(plan) {
  if (!plan) return null;
  if (plan.event === "exception") {
    const error = errorOf(plan);
    const type = error?.type ?? "an error";
    const message = error?.message ?? "";
    const named = message ? `${type}: ${message}` : type;
    if (plan.exceptionOutcome === "handled") {
      return {
        kind: "error",
        text: `Raises ${type}`,
        explanation: `Python raises ${named}. A matching except block catches it, so the program can continue.`,
      };
    }
    if (plan.exceptionOutcome === "propagated") {
      return {
        kind: "error",
        text: `Raises ${type}`,
        explanation: `Python raises ${named}. No handler caught it here, so it passes outward to the caller.`,
      };
    }
    if (plan.exceptionOutcome === "uncaught") {
      return {
        kind: "error",
        text: `Raises ${type}`,
        explanation: `Python raises ${named}. Nothing catches it, so the run ends with this error.`,
      };
    }
    return {
      kind: "error",
      text: `Raises ${type}`,
      explanation: `Python raises ${named}.`,
    };
  }
  if (plan.event === "unwind") {
    const name = plan.eventFunction;
    return {
      kind: "error",
      text: name ? `Error leaves ${name}` : "Error spreads",
      explanation:
        name && name !== "<module>"
          ? `The error passes out of ${name}(), so that call stops without finishing its work.`
          : "The error reaches the end of the program.",
    };
  }
  if (plan.event === "error") {
    const error = errorOf(plan);
    const type = error?.type ?? "an error";
    const message = error?.message ?? "";
    return {
      kind: "error",
      text: error?.phase === "compile" ? `Cannot run: ${type}` : `Stops: ${type}`,
      explanation:
        error?.phase === "compile"
          ? `Python rejected the code before anything ran${message ? `: ${message}` : ""}.`
          : `The run ended with ${type}${message ? `: ${message}` : ""}.`,
    };
  }
  return null;
}

function flagsFor(plan) {
  const entering = new Set();
  const exiting = new Set();
  const changed = new Set();
  const highlighted = new Set();
  const active = new Set();
  const compare = new Set();
  const settled = new Set();
  const moves = [];

  // A comparison changes no state, so it has no action to carry its operand
  // cells. The recorded cells are evidence all the same: ring them in the
  // comparison's own color, but never report a mutation or a move.
  for (const key of comparisonOf(plan)?.cells ?? []) compare.add(key);

  // Settled cells are not an operation: no action produced them, and they
  // survive every later step where the recording still proves them. They are
  // keyed exactly like the slots they mark.
  for (const group of plan.finalized ?? []) {
    for (const index of group.indices ?? []) {
      settled.add(motionTargetKey({ kind: "cell", objectId: group.objectId, index }));
    }
  }

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

  return { entering, exiting, changed, highlighted, active, compare, settled, moves };
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
    // A recorded comparison's operand: gold, and never a mutation flag.
    compare: flags.compare.has(slot.key),
    // Proven by the recording, not by this step's actions, so a swap that
    // starts now never clears a position settled earlier.
    settled: flags.settled.has(slot.key),
  };
}

/* A runaway recursion records about a thousand frames. The call stack is
 * context, not the subject, so it keeps the most recent calls and says how
 * many it left out; the Inspector still lists every recorded frame. */
export const MAX_VISIBLE_FRAMES = 8;

/* A scalar-only program still has values worth seeing. The current call's
 * primitive variables become compact tiles; collections keep their object
 * cards, and functions, classes and modules are context rather than data. */
export const MAX_VISIBLE_SCALARS = 12;
const SCALAR_TYPES = new Set(["int", "float", "str", "bool", "none", "other"]);

function scalarTiles(plan, flags, previous) {
  const frames = plan?.nodes?.frames ?? [];
  const current = frames[frames.length - 1] ?? null;
  if (!current) return { scalars: [], scalarsHidden: 0 };
  const tiles = current.variables
    .filter((variable) => SCALAR_TYPES.has(variable.valueType))
    .map((variable) => ({
      key: variable.key,
      name: variable.name,
      text: variable.text,
      valueType: variable.valueType,
      typeName:
        variable.valueType === "none"
          ? "None"
          : (variable.value?.class ?? variable.valueType),
      changed: flags.changed.has(variable.key),
      highlighted: flags.highlighted.has(variable.key),
      // The previous snapshot is the only honest source for a before value.
      was: flags.changed.has(variable.key) ? (previous.get(variable.key)?.text ?? null) : null,
    }));
  // This step's own variables come first, then the rest in recorded order.
  const ordered = [
    ...tiles.filter((tile) => tile.changed || tile.highlighted),
    ...tiles.filter((tile) => !(tile.changed || tile.highlighted)),
  ];
  return {
    scalars: ordered.slice(0, MAX_VISIBLE_SCALARS),
    scalarsHidden: Math.max(0, ordered.length - MAX_VISIBLE_SCALARS),
  };
}

function frameView(frame, flags, returned, currentLine) {
  // The module frame's implicit None is completion, not a returned value.
  const ownsReturn =
    returned !== null &&
    frame.function !== "<module>" &&
    (returned.frameId !== null
      ? returned.frameId === frame.frameId
      : returned.function === frame.function);
  return {
    ...frame,
    // A call is entering, running, suspended while a child runs, or handing a
    // value back. Only the last one gets the return fact; the rest are proven
    // by the recorded stack alone.
    state: ownsReturn ? "returning" : frame.current ? "active" : "waiting",
    activeLine: frame.current && Number.isInteger(currentLine) ? currentLine : null,
    entering: flags.entering.has(frame.key),
    highlighted: flags.highlighted.has(frame.key),
    returned: ownsReturn ? returned : null,
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

/* Objects that point at one another are a shape, not separate cards. A chain
 * of single references is a linked list; one root with at most two children
 * and no cycles is a tree; anything else that references itself is a graph.
 * The classification reads only reference values the trace recorded; it never
 * guesses a structure from a variable or function name. */
const VALUE_NAMES = new Set(["value", "val", "data", "key", "item", "label", "name"]);

function referenceSlots(object) {
  return (object?.slots ?? []).filter(
    (slot) => slot.kind === "attribute" && Boolean(slot.refId),
  );
}

function nodeValueSlot(object) {
  const plain = (object?.slots ?? []).filter(
    (slot) => slot.kind === "attribute" && !slot.refId,
  );
  return (
    plain.find((slot) => VALUE_NAMES.has(String(slot.name).toLowerCase())) ??
    plain[0] ??
    null
  );
}

function hasCycle(ids, outgoing) {
  const state = new Map();
  const visit = (id) => {
    const at = state.get(id);
    if (at === 1) return true;
    if (at === 2) return false;
    state.set(id, 1);
    for (const edge of outgoing.get(id) ?? []) {
      if (visit(edge.to)) return true;
    }
    state.set(id, 2);
    return false;
  };
  return ids.some((id) => visit(id));
}

function breadthFirst(rootId, outgoing) {
  const levels = [];
  const seen = new Set([rootId]);
  let frontier = [rootId];
  while (frontier.length > 0) {
    levels.push(frontier);
    const next = [];
    for (const id of frontier) {
      for (const edge of outgoing.get(id) ?? []) {
        if (seen.has(edge.to)) continue;
        seen.add(edge.to);
        next.push(edge.to);
      }
    }
    frontier = next;
  }
  return { levels, seen };
}

/**
 * The node-link shape the recorded references prove, or null.
 *
 * Only opaque objects (class instances) become nodes: a list or dict is a
 * value container, and its own card already shows it. Every edge is a real
 * reference attribute. When no such shape is present, the generic cards are
 * the honest rendering and nothing here replaces them.
 *
 * @param {Array} objects the `objectView` list from a plan
 * @param {Object|null} plan the plan, for this step's active references
 * @returns {Object|null}
 */
export function structureOf(objects, plan = null) {
  const all = objects ?? [];
  const candidates = all.filter((object) => object.type === "object");
  const byId = new Map(candidates.map((object) => [object.objectId, object]));
  const allById = new Map(all.map((object) => [object.objectId, object]));
  if (candidates.length < 2) return null;

  const outgoing = new Map(candidates.map((object) => [object.objectId, []]));
  const incoming = new Map(candidates.map((object) => [object.objectId, []]));
  const addEdge = (from, to, role) => {
    const edge = { from, to, role };
    outgoing.get(from).push(edge);
    incoming.get(to).push(edge);
  };
  // A list that only exists to hold a node's neighbours is drawn as edges, so
  // its own card would be redundant.
  const auxiliaryIds = new Set();
  for (const object of candidates) {
    for (const slot of referenceSlots(object)) {
      const target = allById.get(slot.refId);
      if (!target) continue;
      // A node's adjacency list is one more reference the trace recorded: the
      // attribute points at a real list, and that list's cells point at nodes.
      if (target.type === "list" || target.type === "tuple") {
        for (const cell of target.slots ?? []) {
          if (byId.has(cell.refId)) addEdge(object.objectId, cell.refId, slot.name);
        }
        auxiliaryIds.add(target.objectId);
        continue;
      }
      if (!byId.has(slot.refId)) continue;
      addEdge(object.objectId, slot.refId, slot.name);
    }
  }
  const edgeCount = [...outgoing.values()].reduce((total, list) => total + list.length, 0);
  if (edgeCount === 0) return null;

  const activeRefs = new Set();
  for (const operation of plan?.operations ?? []) {
    const value = operation.action?.to;
    if (value?.type === "ref" && value.id) activeRefs.add(value.id);
  }

  const nodes = new Map(
    candidates.map((object) => {
      const value = nodeValueSlot(object);
      return [
        object.objectId,
        {
          key: object.key,
          objectId: object.objectId,
          label: object.label,
          value: value?.text ?? object.objectType,
          valueType: value?.valueType ?? "other",
          // The chosen value is already the headline; repeating it as an
          // attribute would make the node read twice.
          attrs: (object.slots ?? [])
            .filter((slot) => !slot.refId && slot !== value)
            .map((slot) => ({ name: slot.name, text: slot.text, valueType: slot.valueType })),
          links: outgoing.get(object.objectId).map((edge) => {
            const destination = byId.get(edge.to);
            return nodeValueSlot(destination)?.text ?? destination.label;
          }),
          active:
            activeRefs.has(object.objectId) ||
            Boolean(object.entering) ||
            Boolean(object.highlighted) ||
            (object.slots ?? []).some((slot) => slot.changed || slot.highlighted),
          changed: (object.slots ?? []).some((slot) => slot.changed),
          entering: Boolean(object.entering),
          role: null,
          depth: 0,
        },
      ];
    }),
  );

  const ids = candidates.map((object) => object.objectId);
  const roots = ids.filter((id) => incoming.get(id).length === 0);
  const maxOut = Math.max(...ids.map((id) => outgoing.get(id).length));
  const maxIn = Math.max(...ids.map((id) => incoming.get(id).length));
  const cycle = hasCycle(ids, outgoing);
  const reachableFrom = (root) => breadthFirst(root, outgoing).seen.size === ids.length;
  const disconnected = (root) =>
    ids.filter((id) => !breadthFirst(root, outgoing).seen.has(id));

  let kind = "graph";
  let order = [];
  let levels = [];
  let cyclic = false;

  if (maxOut <= 1) {
    kind = "linked-list";
    let head = roots[0] ?? ids[0];
    const seen = new Set();
    while (head && !seen.has(head)) {
      seen.add(head);
      order.push(nodes.get(head));
      const next = outgoing.get(head)[0];
      head = next?.to ?? null;
    }
    // A cycle back to the head is still a chain; a tail pointing anywhere else
    // is not followed twice, because the recording does not prove an order for
    // the nodes that remain.
    cyclic = cycle && seen.size === ids.length;
    for (const id of ids) {
      if (!seen.has(id)) order.push(nodes.get(id));
    }
  } else if (maxOut <= 2 && maxIn <= 1 && roots.length === 1 && !cycle && reachableFrom(roots[0])) {
    kind = "tree";
    const walk = (id, depth, role) => {
      const node = nodes.get(id);
      node.depth = depth;
      node.role = role;
      if (!levels[depth]) levels[depth] = [];
      levels[depth].push(node);
      const children = outgoing.get(id);
      // Attribute order is the recorded order: left before right.
      children.forEach((edge, index) => walk(edge.to, depth + 1, edge.role ?? `child ${index + 1}`));
    };
    walk(roots[0], 0, "root");
  } else {
    kind = "graph";
    const seen = new Set();
    for (const root of [...roots, ...ids]) {
      if (seen.has(root)) continue;
      const walk = breadthFirst(root, outgoing);
      for (const id of walk.seen) seen.add(id);
      walk.levels.forEach((level, depth) => {
        if (!levels[depth]) levels[depth] = [];
        for (const id of level) {
          if (levels.some((row) => row.some((node) => node.objectId === id))) continue;
          const node = nodes.get(id);
          node.depth = depth;
          node.role = depth === 0 ? "root" : null;
          levels[depth].push(node);
        }
      });
    }
  }

  const hidden = disconnected(roots[0] ?? ids[0]).length;
  return {
    kind,
    title: kind === "linked-list" ? "Linked list" : kind === "tree" ? "Tree" : "Graph",
    objectIds: ids,
    auxiliaryIds: [...auxiliaryIds],
    nodes: [...nodes.values()],
    order,
    levels,
    cyclic,
    note:
      hidden > 0
        ? `${hidden} node${hidden === 1 ? "" : "s"} not reachable from the displayed head`
        : null,
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
  // A raised error is the step's meaning, whatever else it changed.
  const error = errorFeedback(plan);
  if (error) return error;
  // A recorded comparison is a real step of its own, so it gets its own
  // headline even though it produced no state action.
  const comparison = comparisonOf(plan);
  if (comparison) {
    return { kind: "compare", text: comparison.text, explanation: comparison.explanation };
  }
  const operations = Array.isArray(plan.feedbackOperations)
    ? plan.feedbackOperations
    : Array.isArray(plan.operations)
      ? plan.operations
      : [];
  // `from` values exist in the state the step started from; `to` values in the
  // target state. Reading each from its own heap keeps a newly created object
  // printable instead of "(not shown at this step)".
  const before =
    plan.feedbackPreviousState?.heap ?? plan.previousState?.heap ?? plan.state?.heap ?? {};
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
    const items =
      (plan.feedbackPreviousState?.heap ?? plan.previousState?.heap)?.[
        swap.action.target.objectId
      ]?.items;
    return {
      kind: "swap",
      text: items
        ? `Swap [${left}] ${fromText(items[left])} ↔ [${right}] ${fromText(items[right])}`
        : `Swap [${left}] ↔ [${right}]`,
      explanation: items
        ? `${fromText(items[left])} and ${fromText(items[right])} exchange places.`
        : `The cells at indices ${left} and ${right} exchange places.`,
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
      explanation: `The value at index ${origin} moves to index ${destination}.`,
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
      explanation: `The value ${toText(grew.action.to)} enters at index ${grew.action.target.index}.`,
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
      explanation: `The value ${fromText(shrank.action.from)} leaves index ${shrank.action.target.index}.`,
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
      return {
        kind: "change",
        text: `[${target.index}] ${from} → ${to}`,
        explanation: `The value at index ${target.index} changed from ${from} to ${to}.`,
      };
    }
    if (target.kind === "attribute") {
      return {
        kind: "change",
        text: `${target.name} ${from} → ${to}`,
        explanation: `${target.name} changed from ${from} to ${to}.`,
      };
    }
    if (target.kind === "entry") {
      return {
        kind: "change",
        text: `${showValue(target.key, after)} ${from} → ${to}`,
        explanation: `${showValue(target.key, after)} changed from ${from} to ${to}.`,
      };
    }
    return {
      kind: "change",
      text: `${from} → ${to}`,
      explanation: `The value changed from ${from} to ${to}.`,
    };
  }

  const called = find(
    (operation) => operation.op === MOTION_OPERATION.enter && operation.action?.kind === "call",
  );
  if (called) {
    const name = called.action.payload?.function ?? "function";
    return {
      kind: "call",
      text: `call ${name}`,
      explanation: `${name}() starts running.`,
    };
  }

  const returned = plan.returned;
  if (returned) {
    // The top-level script always hands back an implicit None. Calling that a
    // return value would read as a result the learner never asked for.
    if (returned.function === "<module>") {
      return {
        kind: "return",
        text: "program finished",
        explanation: "The script reaches its end, so the run is complete.",
      };
    }
    const value = returned.value ? showValue(returned.value, plan.state?.heap ?? {}) : null;
    return {
      kind: "return",
      text: value ? `return ${value}` : "return",
      explanation: value ? `The call hands back ${value}.` : "The call finishes.",
    };
  }

  const frameLeft = find(
    (operation) => operation.op === MOTION_OPERATION.exit && operation.target?.kind === "frame",
  );
  if (frameLeft) {
    const name = frameLeft.action?.from?.function;
    return {
      kind: "return",
      text: name ? `return from ${name}` : "call ends",
      explanation: name ? `${name}() finishes.` : "The call finishes.",
    };
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
 * @param {{trace?: Array, result?: Object|null}} [stage] the run behind the plan
 * @returns {Object|null}
 */
export function motionView(plan, stage = null) {
  if (!plan) return null;
  const previousNodes = plan.previousState ? motionNodes(plan.previousState) : null;
  const previous = flatten(previousNodes);
  const flags = flagsFor(plan);
  const feedback = operationFeedback(plan);
  const returned = returnOf(plan);
  const scalars = scalarTiles(plan, flags, previous);
  const result = stageResult(stage?.trace, plan.index, stage?.result ?? null);
  const objects = plan.nodes.objects.map((object) => objectView(object, flags));

  // A seek, reset, hold or reduced-motion presentation renders the exact
  // target directly. Only a real adjacent animation may show a removed node.
  const ghosts = [];
  if (plan.animate) {
    for (const key of flags.exiting) {
      const node = previous.get(key);
      if (node) ghosts.push({ key, kind: node.kind, node, active: flags.active.has(key) });
    }
  }

  const frames = plan.nodes.frames;
  const shown = frames.length > MAX_VISIBLE_FRAMES ? frames.slice(-MAX_VISIBLE_FRAMES) : frames;

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
    feedback,
    comparison: comparisonOf(plan),
    explanation: feedback?.explanation ?? null,
    // The first position has no mutation to show, but it is still the moment
    // the program began. Say that instead of leaving the canvas blank.
    intro:
      plan.index === 0
        ? {
            title: "Execution starts",
            detail: plan.lineText
              ? `The program begins at: ${plan.lineText}`
              : "The recording begins here. The first recorded change appears on the next step.",
          }
        : null,
    frames: shown.map((frame) => frameView(frame, flags, returned, plan.line)),
    framesHidden: frames.length - shown.length,
    scalars: scalars.scalars,
    scalarsHidden: scalars.scalarsHidden,
    lastReturn: result.lastReturn,
    output: result.output,
    ending: result.ending,
    objects,
    // A recorded shape (chain, tree, graph) is drawn as one composition; its
    // objects are not repeated as separate cards.
    structure: structureOf(objects, plan),
    ghosts,
    moves: flags.moves,
    entering: [...flags.entering],
    exiting: [...flags.exiting],
    changed: [...flags.changed],
    highlighted: [...flags.highlighted],
  };
}
