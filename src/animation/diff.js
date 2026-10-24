// The diff core: one transition of a format-2 trace becomes a list of actions.
//
// Tasks 5a and 5b cover list/tuple state: object lifecycle, cell changes,
// append/delete, state-proven tail growth/shrinkage and verified swap/shift
// movement. Pop/insert shapes and truncation fallbacks belong to task 5c; dict,
// set and object contents belong to task 6. A transition this module cannot model honestly
// carries a highlight with a reason, or is classified as deferred by the tests;
// it is never silently skipped.
//
// What the diff may look at is fixed by docs/animation.md section 2: the two
// snapshots, the next event's recorded facts, and (for a return) whether recorded
// output follows it. It never runs Python, never reads the editor's text, never
// looks past the transition, and never invents a value.
//
// Two contracts live here and are pinned by diff.test.mjs:
//
//   * `stateOf` is the compared state of section 3, exactly: every frame's
//     frame_id, function, call_line and variables, and the whole heap. A frame's
//     own `line` is cursor metadata and is deliberately excluded, so moving the
//     cursor never looks like a data change.
//   * `applyState(s, diff(a, b))` equals `stateOf(b)`, and applying the reverse
//     to `stateOf(b)` equals `stateOf(a)`. Nothing is normalised, sorted or
//     dropped to make that true.
//
// Events that record no snapshot (`output`, `input`, `error`, the limit events)
// are not states of their own. `snapshotAt` gives them the last recorded state,
// so a print step shows the state it printed from instead of an empty program.

import { FALLBACK_REASON, canonicalValue, createAction, isStateAction } from "./actions.js";
import { resolveIndex } from "./evaluate.js";
import { lineShape } from "./lineShape.js";

/**
 * Events that end the search for a return's console destination: the next
 * control event means the returned value was not printed.
 */
const CONTROL_EVENTS = new Set([
  "call",
  "line",
  "return",
  "exception",
  "unwind",
  "error",
  "step_limit",
  "timeout",
  "output_limit",
]);

function hasRecordedState(event) {
  return event !== null && typeof event === "object" && Array.isArray(event.frames);
}

function isFrameSnapshot(frame) {
  return (
    frame !== null &&
    typeof frame === "object" &&
    Number.isInteger(frame.frame_id) &&
    typeof frame.function === "string" &&
    frame.variables !== null &&
    typeof frame.variables === "object" &&
    !Array.isArray(frame.variables)
  );
}

function copyFrame(frame) {
  return {
    frame_id: frame.frame_id,
    function: frame.function,
    call_line: frame.call_line ?? null,
    variables: { ...frame.variables },
  };
}

/** A trace value or a heap entry's arrays are copied one level; values are flat. */
function copyValue(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(copyValue);
  return { ...value };
}

function copyEntry(entry) {
  if (entry === null || typeof entry !== "object") return entry;
  const copy = { ...entry };
  if (Array.isArray(entry.items)) copy.items = entry.items.map(copyValue);
  if (Array.isArray(entry.entries)) {
    copy.entries = entry.entries.map((pair) => ({
      key: copyValue(pair.key),
      value: copyValue(pair.value),
    }));
  }
  if (Array.isArray(entry.attrs)) {
    copy.attrs = entry.attrs.map((attr) => ({ name: attr.name, value: copyValue(attr.value) }));
  }
  return copy;
}

function copyHeap(heap) {
  const copy = {};
  for (const [id, entry] of Object.entries(heap ?? {})) copy[id] = copyEntry(entry);
  return copy;
}

function isSequence(entry) {
  return entry !== null && typeof entry === "object" && (entry.type === "list" || entry.type === "tuple");
}

function isTruncated(entry) {
  return Number.isInteger(entry?.more) && entry.more > 0;
}

function isPrefixOf(shorter, longer) {
  if (shorter.length > longer.length) return false;
  return shorter.every((cell, index) => canonicalValue(cell) === canonicalValue(longer[index]));
}

function withoutCell(entry, index) {
  return [...entry.items.slice(0, index), ...entry.items.slice(index + 1)];
}

function isRemoval(oldEntry, newEntry, index) {
  if (newEntry.items.length !== oldEntry.items.length - 1) return false;
  return canonicalValue(withoutCell(oldEntry, index)) === canonicalValue(newEntry.items);
}

/**
 * The swap a recognized swap statement describes, when the snapshots agree.
 * Returns null without evidence, or "ambiguous" when the two cells hold equal
 * values so the swap cannot be seen (docs/animation.md section 8).
 */
function swapEvidence(context, older, newer, id) {
  const parsed = context?.shape;
  if (parsed?.kind !== "swap" || parsed.targets.length !== 2) return null;
  const left = resolveCellRef(parsed.targets[0], context.heap, context.variables);
  const right = resolveCellRef(parsed.targets[1], context.heap, context.variables);
  if (left === null || right === null) return null;
  if (left.objectId !== id || right.objectId !== id) return null;
  const { index: i } = left;
  const { index: j } = right;
  if (i === j || i >= older.items.length || j >= older.items.length) return null;
  if (canonicalValue(newer.items[i]) !== canonicalValue(older.items[j])) return null;
  if (canonicalValue(newer.items[j]) !== canonicalValue(older.items[i])) return null;
  for (let index = 0; index < older.items.length; index += 1) {
    if (index === i || index === j) continue;
    if (canonicalValue(older.items[index]) !== canonicalValue(newer.items[index])) return null;
  }
  return canonicalValue(older.items[i]) === canonicalValue(older.items[j])
    ? "ambiguous"
    : { i, j };
}

/**
 * The adjacent shift a recognized copy statement describes, when the snapshots
 * agree. Returns null without evidence, or "ambiguous" when the source and
 * destination hold equal values so the copy cannot be seen. Indices are always
 * [source, destination]; the action targets the destination.
 */
function shiftEvidence(context, older, newer, id) {
  const parsed = context?.shape;
  if (
    parsed?.kind !== "shift" ||
    parsed.targets.length !== 1 ||
    parsed.sources.length !== 1
  ) {
    return null;
  }
  const destination = resolveCellRef(parsed.targets[0], context.heap, context.variables);
  const source = resolveCellRef(parsed.sources[0], context.heap, context.variables);
  if (destination === null || source === null) return null;
  if (destination.objectId !== id || source.objectId !== id) return null;
  const { index: dest } = destination;
  const { index: origin } = source;
  if (Math.abs(dest - origin) !== 1) return null;
  if (dest >= older.items.length || origin >= older.items.length) return null;
  // The source must survive, the destination must receive it, and nothing else
  // may move.
  if (canonicalValue(newer.items[origin]) !== canonicalValue(older.items[origin])) return null;
  if (canonicalValue(newer.items[dest]) !== canonicalValue(older.items[origin])) return null;
  for (let index = 0; index < older.items.length; index += 1) {
    if (index === origin || index === dest) continue;
    if (canonicalValue(older.items[index]) !== canonicalValue(newer.items[index])) return null;
  }
  return canonicalValue(older.items[origin]) === canonicalValue(older.items[dest])
    ? "ambiguous"
    : { origin, dest };
}

function isIndexPair(indices) {
  return (
    Array.isArray(indices) &&
    indices.length === 2 &&
    indices.every((index) => Number.isInteger(index) && index >= 0)
  );
}

/** The object a reference names, following attributes and ref-valued cells. */
function followReference(entry, access) {
  if (access?.kind === "attr") {
    if (entry?.type !== "object" || !Array.isArray(entry.attrs)) return null;
    const attr = entry.attrs.find((item) => item.name === access.name);
    return attr?.value?.type === "ref" ? attr.value.id : null;
  }
  if (entry?.type !== "list" && entry?.type !== "tuple") return null;
  const index = resolveIndex(access?.value, entry.items.length);
  if (index === null) return null;
  const value = entry.items[index];
  return value?.type === "ref" ? value.id : null;
}

function baseObjectId(ref, heap, variables) {
  const value = variables?.[ref?.base];
  const id = value?.type === "ref" ? value.id : null;
  return typeof id === "string" && heap[id] ? id : null;
}

function resolveObjectId(ref, heap, variables) {
  if (!ref) return null;
  let id = baseObjectId(ref, heap, variables);
  if (id === null) return null;
  for (const access of ref.access) {
    id = followReference(heap[id], access);
    if (id === null || !heap[id]) return null;
  }
  return id;
}

/** The parent object and resolved index of a cell reference, or null. */
function resolveCellRef(ref, heap, variables) {
  if (!ref || ref.tail !== "subscript" || ref.access.length === 0) return null;
  const last = ref.access[ref.access.length - 1];
  if (last.kind !== "subscript") return null;
  let id = baseObjectId(ref, heap, variables);
  if (id === null) return null;
  for (let i = 0; i < ref.access.length - 1; i += 1) {
    id = followReference(heap[id], ref.access[i]);
    if (id === null || !heap[id]) return null;
  }
  const entry = heap[id];
  if (!isSequence(entry)) return null;
  const index = resolveIndex(last.value, entry.items.length);
  return index === null ? null : { objectId: id, index };
}

/**
 * The statement shape of the executed line, plus the names/heap it was read
 * from. The earlier event is the line that ran; its innermost frame owns the
 * index expressions. No source or line means no shape evidence.
 */
function shapeContext(prev, source) {
  if (!prev || typeof source !== "string" || !Number.isInteger(prev.line)) return null;
  const variables = prev.frames?.at(-1)?.variables ?? {};
  const env = {};
  for (const [name, value] of Object.entries(variables)) {
    if (value?.type === "int" && Number.isSafeInteger(value.value)) env[name] = value.value;
  }
  return { shape: lineShape(source, prev.line, { env }), variables, heap: prev.heap ?? {} };
}

function isShapeCell(context, ref, objectId, index) {
  if (!context || !ref) return false;
  const cell = resolveCellRef(ref, context.heap, context.variables);
  return cell !== null && cell.objectId === objectId && cell.index === index;
}

function cellChangeReason(context, objectId, index) {
  const shape = context?.shape;
  if (!shape || shape.kind === "unknown") return FALLBACK_REASON.unknownShape;
  // A verified swap/shift becomes one move; any cell change left over is a fallback.
  if (shape.kind === "swap" || shape.kind === "shift") return FALLBACK_REASON.unknownShape;
  if (shape.kind === "subscript-assign" || shape.kind === "augmented") {
    return isShapeCell(context, shape.targets[0], objectId, index)
      ? null
      : FALLBACK_REASON.unknownShape;
  }
  return FALLBACK_REASON.unknownShape;
}

function appendObjectId(context) {
  if (context?.shape?.kind !== "append") return null;
  return resolveObjectId(context.shape.targets[0], context.heap, context.variables);
}

function deleteCell(context) {
  if (context?.shape?.kind !== "del") return null;
  return resolveCellRef(context.shape.targets[0], context.heap, context.variables);
}

function findFrame(state, frameId) {
  return state.frames.find((frame) => frame.frame_id === frameId);
}

/**
 * The event at `index`, with the state it is shown against.
 *
 * An execution event carries its own `frames`/`heap`; an `output`, `input`,
 * `error` or limit event records none, so it is shown against the last state
 * recorded before it. That is what makes `print` a step that prints the state
 * it printed from, without re-running Python or inventing a snapshot.
 *
 * @param {Array} trace the trace's events, oldest first
 * @param {number} index the event index (the playback cursor)
 * @returns {Object|null} a snapshot: the event plus `frames` and `heap`
 */
export function snapshotAt(trace, index) {
  if (!Array.isArray(trace)) return null;
  if (!Number.isInteger(index) || index < 0 || index >= trace.length) return null;
  const event = trace[index];
  if (event === null || typeof event !== "object") return null;
  if (Array.isArray(event.frames)) return event;
  for (let i = index - 1; i >= 0; i -= 1) {
    const earlier = trace[i];
    if (hasRecordedState(earlier)) {
      return { ...event, frames: earlier.frames, heap: earlier.heap ?? {} };
    }
  }
  return { ...event, frames: [], heap: {} };
}

/**
 * The compared state of a snapshot (docs/animation.md section 3): the frame
 * stack and the heap, and nothing else. Both are copied, so applying actions can
 * never write into the trace or into a snapshot a caller still holds.
 *
 * @param {Object|null} snapshot a snapshot from `snapshotAt`, or null for "before the run"
 * @returns {{frames: Array, heap: Object}}
 */
export function stateOf(snapshot) {
  if (snapshot === null || snapshot === undefined) return { frames: [], heap: {} };
  const frames = (snapshot.frames ?? []).map(copyFrame);
  return { frames, heap: copyHeap(snapshot.heap) };
}

/**
 * The list/tuple part of one transition. State actions first, then the
 * highlights that explain a truncated or unsupported container.
 */
function collectionActions(before, after, step, context) {
  const state = [];
  const overlays = [];
  const shape = shapeContext(context.prev, context.source);
  const ids = [...new Set([...Object.keys(before.heap), ...Object.keys(after.heap)])].sort();
  const cells = [];
  const structural = [];

  for (const id of ids) {
    const older = before.heap[id];
    const newer = after.heap[id];
    const olderSequence = isSequence(older);
    const newerSequence = isSequence(newer);

    if (olderSequence && !newerSequence) {
      state.push(createAction("disappear", { step, target: { kind: "object", objectId: id }, from: older }));
      continue;
    }
    if (!olderSequence && newerSequence) {
      state.push(createAction("appear", { step, target: { kind: "object", objectId: id }, to: newer }));
      continue;
    }
    if (!olderSequence || !newerSequence) continue;
    if (older.type !== newer.type) {
      overlays.push(
        createAction("highlight", {
          step,
          target: { kind: "object", objectId: id },
          reason: FALLBACK_REASON.unsupported,
        }),
      );
      continue;
    }

    if (isTruncated(older) || isTruncated(newer) || older.more !== newer.more) {
      if (older.type === "list" && newer.type === "list") {
        const common = Math.min(older.items.length, newer.items.length);
        for (let index = 0; index < common; index += 1) {
          if (canonicalValue(older.items[index]) !== canonicalValue(newer.items[index])) {
            cells.push(
              createAction("change", {
                step,
                target: { kind: "cell", objectId: id, index },
                from: older.items[index],
                to: newer.items[index],
                reason: FALLBACK_REASON.truncated,
              }),
            );
          }
        }
      }
      if (
        older.type !== "list" ||
        newer.type !== "list" ||
        older.more !== newer.more ||
        older.items.length !== newer.items.length
      ) {
        overlays.push(
          createAction("highlight", {
            step,
            target: { kind: "object", objectId: id },
            reason: older.type === "list" ? FALLBACK_REASON.truncated : FALLBACK_REASON.unsupported,
          }),
        );
      }
      continue;
    }

    if (older.type === "tuple") {
      if (canonicalValue(older.items) !== canonicalValue(newer.items)) {
        overlays.push(
          createAction("highlight", {
            step,
            target: { kind: "object", objectId: id },
            reason: FALLBACK_REASON.unsupported,
          }),
        );
      }
      continue;
    }

    const olderLength = older.items.length;
    const newerLength = newer.items.length;

    if (olderLength === newerLength) {
      const swap = swapEvidence(shape, older, newer, id);
      if (swap === "ambiguous") {
        overlays.push(
          createAction("highlight", {
            step,
            target: { kind: "object", objectId: id },
            reason: FALLBACK_REASON.duplicateValues,
          }),
        );
        continue;
      }
      if (swap !== null) {
        // One action per pair, keyed on the lower index for a stable id; the
        // payload keeps the source order the statement wrote.
        structural.push(
          createAction("move", {
            step,
            target: { kind: "cell", objectId: id, index: Math.min(swap.i, swap.j) },
            motion: "swap",
            payload: { indices: [swap.i, swap.j] },
          }),
        );
        continue;
      }
      const shift = shiftEvidence(shape, older, newer, id);
      if (shift === "ambiguous") {
        overlays.push(
          createAction("highlight", {
            step,
            target: { kind: "object", objectId: id },
            reason: FALLBACK_REASON.duplicateValues,
          }),
        );
        continue;
      }
      if (shift !== null) {
        structural.push(
          createAction("move", {
            step,
            target: { kind: "cell", objectId: id, index: shift.dest },
            motion: "shift",
            from: older.items[shift.dest],
            to: newer.items[shift.dest],
            payload: { indices: [shift.origin, shift.dest] },
          }),
        );
        continue;
      }
      for (let index = 0; index < olderLength; index += 1) {
        if (canonicalValue(older.items[index]) !== canonicalValue(newer.items[index])) {
          cells.push(
            createAction("change", {
              step,
              target: { kind: "cell", objectId: id, index },
              from: older.items[index],
              to: newer.items[index],
              reason: cellChangeReason(shape, id, index),
            }),
          );
        }
      }
      continue;
    }

    if (newerLength > olderLength) {
      const appended = appendObjectId(shape);
      if (
        appended === id &&
        newerLength === olderLength + 1 &&
        isPrefixOf(older.items, newer.items)
      ) {
        structural.push(
          createAction("grow", {
            step,
            target: { kind: "cell", objectId: id, index: olderLength },
            motion: "append",
            to: newer.items[olderLength],
          }),
        );
      } else if (isPrefixOf(older.items, newer.items)) {
        for (let index = olderLength; index < newerLength; index += 1) {
          structural.push(
            createAction("grow", {
              step,
              target: { kind: "cell", objectId: id, index },
              motion: "append",
              to: newer.items[index],
              reason: FALLBACK_REASON.unknownShape,
            }),
          );
        }
      } else {
        overlays.push(
          createAction("highlight", {
            step,
            target: { kind: "object", objectId: id },
            reason: FALLBACK_REASON.unknownShape,
          }),
        );
      }
      continue;
    }

    const deleted = deleteCell(shape);
    if (deleted !== null && deleted.objectId === id && isRemoval(older, newer, deleted.index)) {
      structural.push(
        createAction("shrink", {
          step,
          target: { kind: "cell", objectId: id, index: deleted.index },
          motion: "delete",
          from: older.items[deleted.index],
        }),
      );
    } else if (isPrefixOf(newer.items, older.items)) {
      for (let index = olderLength - 1; index >= newerLength; index -= 1) {
        structural.push(
          createAction("shrink", {
            step,
            target: { kind: "cell", objectId: id, index },
            motion: "pop",
            from: older.items[index],
            reason: FALLBACK_REASON.unknownShape,
          }),
        );
      }
    } else {
      overlays.push(
        createAction("highlight", {
          step,
          target: { kind: "object", objectId: id },
          reason: FALLBACK_REASON.unknownShape,
        }),
      );
    }
  }

  return { state: [...state, ...cells, ...structural], overlays };
}

/**
 * The actions of one transition.
 *
 * @param {Object|null} prev the previous snapshot (null before the run starts)
 * @param {Object} next the snapshot the cursor is on
 * @param {{source?: string, consoleAfterReturn?: boolean}} [context]
 *   `consoleAfterReturn` is the recorded fact that output follows this return;
 *   `consoleFollowsReturn(trace, index)` answers it. Without it the return
 *   overlay names no destination.
 * @returns {Array} state actions first, then the step's overlays
 */
export function diffSteps(prev, next, context = {}) {
  if (prev !== null && prev !== undefined && !hasRecordedState(prev)) {
    throw new TypeError("diffSteps needs snapshots from snapshotAt, not a raw event");
  }
  if (!hasRecordedState(next) || !Number.isInteger(next.step) || next.step < 0) {
    throw new TypeError("diffSteps needs the next snapshot and its step");
  }
  const options = context ?? {};
  const step = next.step;
  const before = stateOf(prev);
  const after = stateOf(next);
  const actions = [];

  // The stack: a frame leaves, or a call adds one. A frame is identified by its
  // frame_id, so recursion gets one action per call even for the same function.
  const beforeIds = new Set(before.frames.map((frame) => frame.frame_id));
  const afterIds = new Set(after.frames.map((frame) => frame.frame_id));
  for (const frame of before.frames) {
    if (afterIds.has(frame.frame_id)) continue;
    actions.push(
      createAction("disappear", {
        step,
        target: { kind: "frame", frameId: frame.frame_id },
        from: frame,
      }),
    );
  }
  for (const frame of after.frames) {
    if (beforeIds.has(frame.frame_id)) continue;
    actions.push(
      createAction("call", {
        step,
        target: { kind: "frame", frameId: frame.frame_id },
        to: frame,
        // At a call event the frame's variables are exactly the bound arguments.
        payload: { function: frame.function, callLine: frame.call_line, args: frame.variables },
      }),
    );
  }

  // Variables of the frames that survive the transition. Values are compared
  // canonically: the tracer happens to emit sorted keys, but a change must not
  // depend on that accident.
  for (const frame of after.frames) {
    const older = findFrame(before, frame.frame_id);
    if (!older) continue;
    const target = (name) => ({ kind: "variable", frameId: frame.frame_id, name });
    for (const name of Object.keys(older.variables)) {
      if (Object.hasOwn(frame.variables, name)) continue;
      actions.push(createAction("disappear", { step, target: target(name), from: older.variables[name] }));
    }
    for (const name of Object.keys(frame.variables)) {
      if (!Object.hasOwn(older.variables, name)) {
        actions.push(createAction("appear", { step, target: target(name), to: frame.variables[name] }));
      } else if (canonicalValue(older.variables[name]) !== canonicalValue(frame.variables[name])) {
        actions.push(
          createAction("change", {
            step,
            target: target(name),
            from: older.variables[name],
            to: frame.variables[name],
          }),
        );
      }
    }
  }

  // List/tuple state: object lifecycle, cell changes, append/delete and
  // state-proven tail growth/shrinkage. Dictionaries, sets and object contents
  // stay task 6's job.
  const collections = collectionActions(before, after, step, {
    prev,
    source: options.source,
  });
  actions.push(...collections.state, ...collections.overlays);

  // Overlays describe what the event recorded. They never change the state, and
  // they are keyed to this step, so moving the cursor drops them.
  const consoleTarget = { kind: "console" };
  if (next.event === "output") {
    actions.push(
      createAction("print", {
        step,
        target: consoleTarget,
        payload: { text: typeof next.text === "string" ? next.text : "" },
      }),
    );
  } else if (next.event === "return") {
    const value = next.return_value ?? null;
    actions.push(
      createAction("return", {
        step,
        target: Number.isInteger(next.frame_id)
          ? { kind: "frame", frameId: next.frame_id }
          : consoleTarget,
        payload: {
          function: typeof next.function === "string" ? next.function : null,
          value,
          to: options.consoleAfterReturn === true ? "console" : null,
        },
      }),
    );
  } else if (next.event === "exception") {
    const error = next.exception ?? {};
    actions.push(
      createAction("error", {
        step,
        target: Number.isInteger(next.frame_id)
          ? { kind: "frame", frameId: next.frame_id }
          : consoleTarget,
        payload: {
          type: error.type ?? null,
          message: error.message ?? null,
          line: Number.isInteger(next.line) ? next.line : null,
        },
      }),
    );
  } else if (next.event === "error") {
    // A compile error has no frame; a runtime error already raised its badge on
    // the exception event, and this is the run's recorded outcome.
    actions.push(
      createAction("error", {
        step,
        target: consoleTarget,
        payload: {
          type: next.type ?? null,
          message: next.message ?? null,
          line: Number.isInteger(next.line) ? next.line : null,
          phase: next.phase ?? null,
        },
      }),
    );
  }
  // `unwind` repeats an exception that already has its badge, and `input`'s echo
  // is recorded as a following output event, so neither adds an overlay here.

  return actions;
}

/**
 * Whether recorded output follows this return before the next control event -
 * the only evidence that lets a return value travel to the console
 * (docs/animation.md section 10). Without it the diff names no destination.
 *
 * @param {Array} trace the trace's events
 * @param {number} index the index of the `return` event
 * @returns {boolean}
 */
export function consoleFollowsReturn(trace, index) {
  if (!Array.isArray(trace) || !Number.isInteger(index)) return false;
  for (let i = index + 1; i < trace.length; i += 1) {
    const event = trace[i];
    const kind = event?.event;
    if (kind === "output") return true;
    if (kind === "input") continue;
    if (CONTROL_EVENTS.has(kind)) return false;
  }
  return false;
}

/** The actions that change the compared state; overlays are not state. */
export function stateActions(actions) {
  if (!Array.isArray(actions)) return [];
  return actions.filter(isStateAction);
}

/**
 * The actions that undo a step, in the order they must be applied.
 *
 * Overlays are **dropped**, not inverted: a flash, a print chunk or an error
 * badge describes the step it belongs to and has no "undo". State actions are
 * inverted by the table in docs/animation.md section 12, back to front, so two
 * actions on the same element undo in the right order. The step number is kept:
 * the inverse of step 12 belongs to step 12.
 *
 * @param {Array} actions
 * @param {{frames: Array, heap: Object}|null} [state] the state after the step, when the
 *   caller has it; it lets a cell action against a tuple be refused
 * @returns {Array} state actions whose application undoes the transition
 */
export function reverseActions(actions, state = null) {
  if (!Array.isArray(actions)) return [];
  const reversed = [];
  for (let i = actions.length - 1; i >= 0; i -= 1) {
    const action = actions[i];
    if (!isStateAction(action)) continue;
    if (state && action.target?.kind === "cell" && state.heap?.[action.target.objectId]?.type === "tuple") {
      throw new TypeError("cannot reverse a tuple-cell mutation");
    }
    const common = { step: action.step, target: action.target, reason: action.reason ?? null };
    switch (action.kind) {
      case "appear":
        reversed.push(createAction("disappear", { ...common, from: action.to }));
        break;
      case "change":
        reversed.push(createAction("change", { ...common, from: action.to, to: action.from }));
        break;
      case "call":
        reversed.push(createAction("disappear", { ...common, from: action.to }));
        break;
      case "disappear":
        if (action.target.kind === "frame") {
          const frame = action.from;
          if (!isFrameSnapshot(frame)) throw new TypeError("a frame disappearance must carry the frame");
          reversed.push(
            createAction("call", {
              ...common,
              to: frame,
              payload: {
                function: frame.function,
                callLine: frame.call_line ?? null,
                args: frame.variables,
              },
            }),
          );
        } else {
          reversed.push(createAction("appear", { ...common, to: action.from }));
        }
        break;
      case "grow": {
        if (action.target.kind !== "cell") throw new TypeError("a grow action must target a cell");
        if (action.to === null || action.to === undefined) {
          throw new TypeError("a grow action must carry the new value in to");
        }
        const motion = action.motion === "append" ? "pop" : action.motion === "insert" ? "delete" : null;
        if (motion === null) throw new TypeError(`cannot reverse a grow.${String(action.motion)} action`);
        reversed.push(createAction("shrink", { ...common, motion, from: action.to }));
        break;
      }
      case "shrink": {
        if (action.target.kind !== "cell") throw new TypeError("a shrink action must target a cell");
        if (action.from === null || action.from === undefined) {
          throw new TypeError("a shrink action must carry the removed value in from");
        }
        const motion = action.motion === "pop" ? "append" : action.motion === "delete" ? "insert" : null;
        if (motion === null) throw new TypeError(`cannot reverse a shrink.${String(action.motion)} action`);
        reversed.push(createAction("grow", { ...common, motion, to: action.from }));
        break;
      }
      case "move": {
        const indices = action.payload?.indices;
        if (!isIndexPair(indices)) {
          throw new TypeError("a move action needs its index pair in payload.indices");
        }
        if (action.motion === "swap") {
          // A swap is its own inverse; the pair is applied exactly once.
          reversed.push(
            createAction("move", {
              step: action.step,
              target: action.target,
              motion: "swap",
              payload: { indices: [...indices] },
            }),
          );
          break;
        }
        if (action.motion !== "shift") {
          throw new TypeError(`cannot reverse a move.${String(action.motion)} action yet`);
        }
        const [origin, dest] = indices;
        if (Math.abs(dest - origin) !== 1) {
          throw new TypeError("a move.shift needs adjacent source and destination indices");
        }
        if (action.target?.kind !== "cell") throw new TypeError("a move action must target a cell");
        if (action.target.index !== dest) {
          throw new TypeError("a move.shift targets its destination cell");
        }
        if (action.from === null || action.from === undefined) {
          throw new TypeError("a move.shift must carry the overwritten value in from");
        }
        if (action.to === null || action.to === undefined) {
          throw new TypeError("a move.shift must carry the copied value in to");
        }
        // A shift is undone by restoring the overwritten destination, never by
        // copying in the opposite direction: the source was never changed.
        reversed.push(
          createAction("change", {
            step: action.step,
            target: action.target,
            from: action.to,
            to: action.from,
          }),
        );
        break;
      }
      default:
        // Every state kind in the vocabulary is handled above; a new kind must
        // teach apply/reverse before it can be emitted.
        throw new TypeError(`cannot reverse a ${action.kind} action yet`);
    }
  }
  return reversed;
}

/**
 * Apply state actions to a compared state, without mutating it.
 *
 * Overlays are ignored: they never change the snapshot. A state kind this
 * module does not emit yet is refused rather than silently skipped, so a
 * half-applied state can never pass for a correct one.
 *
 * @param {{frames: Array, heap: Object}|Object} state a state from `stateOf`
 * @param {Array} actions
 * @returns {{frames: Array, heap: Object}}
 */
export function applyState(state, actions) {
  const current = stateOf(state);
  for (const action of actions ?? []) {
    if (!isStateAction(action)) continue;
    const target = action.target ?? {};
    switch (action.kind) {
      case "call": {
        const frame = action.to;
        if (!isFrameSnapshot(frame)) throw new TypeError("a call action must carry the frame in to");
        if (findFrame(current, frame.frame_id)) {
          throw new TypeError(`frame ${frame.frame_id} is already on the stack`);
        }
        current.frames.push(copyFrame(frame));
        break;
      }
      case "appear": {
        if (target.kind === "object") {
          if (current.heap[target.objectId]) {
            throw new TypeError(`object ${target.objectId} is already in the heap`);
          }
          if (action.to === null || typeof action.to !== "object") {
            throw new TypeError("an object appearance must carry the entry in to");
          }
          current.heap[target.objectId] = copyEntry(action.to);
          break;
        }
        const frame = findFrame(current, target.frameId);
        if (!frame || target.kind !== "variable") {
          throw new TypeError("an appear action must target a variable or an object");
        }
        frame.variables[target.name] = action.to;
        break;
      }
      case "change": {
        if (target.kind === "cell") {
          const entry = current.heap[target.objectId];
          if (!entry || (entry.type !== "list" && entry.type !== "tuple")) {
            throw new TypeError("a cell change must target a list or tuple cell");
          }
          if (entry.type === "tuple") throw new TypeError("cannot mutate tuple cells");
          if (!Number.isInteger(target.index) || target.index < 0 || target.index >= entry.items.length) {
            throw new TypeError(`cell ${target.index} is outside ${target.objectId}`);
          }
          entry.items[target.index] = copyValue(action.to);
          break;
        }
        const frame = findFrame(current, target.frameId);
        if (!frame || target.kind !== "variable" || !Object.hasOwn(frame.variables, target.name)) {
          throw new TypeError("a change action must target a variable that exists or a cell");
        }
        frame.variables[target.name] = action.to;
        break;
      }
      case "disappear": {
        if (target.kind === "frame") {
          const at = current.frames.findIndex((frame) => frame.frame_id === target.frameId);
          if (at < 0) throw new TypeError(`frame ${target.frameId} is not on the stack`);
          current.frames.splice(at, 1);
          break;
        }
        if (target.kind === "object") {
          if (!current.heap[target.objectId]) {
            throw new TypeError(`object ${target.objectId} is not in the heap`);
          }
          delete current.heap[target.objectId];
          break;
        }
        const frame = findFrame(current, target.frameId);
        if (!frame || target.kind !== "variable" || !Object.hasOwn(frame.variables, target.name)) {
          throw new TypeError("a disappear action must target a variable or an object");
        }
        delete frame.variables[target.name];
        break;
      }
      case "move": {
        if (target.kind !== "cell") throw new TypeError("a move action must target a cell");
        const entry = current.heap[target.objectId];
        if (!entry) throw new TypeError(`object ${target.objectId} is not in the heap`);
        if (entry.type === "tuple") throw new TypeError("cannot move tuple cells");
        if (entry.type !== "list") throw new TypeError("a move action must target a list");
        const indices = action.payload?.indices;
        if (!isIndexPair(indices)) {
          throw new TypeError("a move action needs its index pair in payload.indices");
        }
        if (action.motion === "swap") {
          const [i, j] = indices;
          if (i === j) throw new TypeError("a move.swap cannot swap a cell with itself");
          if (i >= entry.items.length || j >= entry.items.length) {
            throw new TypeError(`cells ${i} and ${j} are outside ${target.objectId}`);
          }
          if (target.index !== Math.min(i, j)) {
            throw new TypeError("a move.swap targets the lower of its two indices");
          }
          [entry.items[i], entry.items[j]] = [entry.items[j], entry.items[i]];
          break;
        }
        if (action.motion === "shift") {
          const [origin, dest] = indices;
          if (Math.abs(dest - origin) !== 1) {
            throw new TypeError("a move.shift needs adjacent source and destination indices");
          }
          if (dest >= entry.items.length || origin >= entry.items.length) {
            throw new TypeError(`cells ${origin} and ${dest} are outside ${target.objectId}`);
          }
          if (target.index !== dest) {
            throw new TypeError("a move.shift targets its destination cell");
          }
          if (action.from === null || action.from === undefined) {
            throw new TypeError("a move.shift must carry the overwritten value in from");
          }
          if (action.to === null || action.to === undefined) {
            throw new TypeError("a move.shift must carry the copied value in to");
          }
          // Only the destination changes; the source keeps its value.
          entry.items[dest] = copyValue(action.to);
          break;
        }
        throw new TypeError(`a move.${String(action.motion)} action is not supported yet`);
      }
      case "grow":
      case "shrink": {
        if (target.kind !== "cell") throw new TypeError(`a ${action.kind} action must target a cell`);
        const entry = current.heap[target.objectId];
        if (!entry) throw new TypeError(`object ${target.objectId} is not in the heap`);
        if (entry.type === "tuple") throw new TypeError("cannot mutate tuple cells");
        if (entry.type !== "list") throw new TypeError(`a ${action.kind} action must target a list`);
        if (!Number.isInteger(target.index) || target.index < 0) {
          throw new TypeError(`cell ${target.index} is outside ${target.objectId}`);
        }
        if (action.kind === "grow") {
          if (action.to === null || action.to === undefined) {
            throw new TypeError("a grow action must carry the new value in to");
          }
          if (action.motion === "append") {
            if (target.index !== entry.items.length) {
              throw new TypeError("a grow.append must append at the end of the list");
            }
            entry.items.push(copyValue(action.to));
          } else if (action.motion === "insert") {
            if (target.index > entry.items.length) {
              throw new TypeError(`cell ${target.index} is outside ${target.objectId}`);
            }
            entry.items.splice(target.index, 0, copyValue(action.to));
          } else {
            throw new TypeError(`a grow action needs the append or insert motion`);
          }
        } else {
          if (action.from === null || action.from === undefined) {
            throw new TypeError("a shrink action must carry the removed value in from");
          }
          if (target.index >= entry.items.length) {
            throw new TypeError(`cell ${target.index} is outside ${target.objectId}`);
          }
          if (action.motion !== "pop" && action.motion !== "delete") {
            throw new TypeError("a shrink action needs the pop or delete motion");
          }
          if (action.motion === "pop" && target.index !== entry.items.length - 1) {
            throw new TypeError("a shrink.pop must remove the last cell");
          }
          entry.items.splice(target.index, 1);
        }
        break;
      }
      default:
        throw new TypeError(`applyState cannot apply a ${action.kind} action yet`);
    }
  }
  return current;
}
