// Which recorded cells the trace proves are settled.
//
// The trace records state, not intent: no event says "the algorithm has
// finished this position". Intent cannot be read out of a state either - "this
// cell has not changed lately" is not evidence, and "the last few cells happen
// to be in order" is true of plenty of arrays that still move.
//
// What a *complete* recording does contain is its outcome. So a position is
// treated as final only when every one of these holds, and each is checkable
// from the recording alone:
//
//   1. the run ended cleanly (its last event is a `return`), so the last state
//      is the program's real outcome rather than a limit or an exception;
//   2. the sequence is a list whose final recorded contents were not truncated,
//      so the outcome of every position is actually visible;
//   3. those final contents are nondecreasing (all finite numbers), so the
//      outcome is a sorted order;
//   4. the trace shows the list was rearranged in place: two consecutive
//      snapshots of the same length with a different value somewhere. An
//      untouched list, or one that only grew, therefore never gets coloured -
//      that is what keeps ordinary programs' lists unmarked;
//   5. the cell's current value equals the value that same position ends with,
//      and that match reaches in from an end of the row (a prefix or a suffix).
//      A lone equal value in a still-moving middle is a coincidence, not a
//      settled boundary.
//
// Nothing here reads a loop variable, a source line or an algorithm name: an
// insertion sort's sorted prefix and a bubble sort's sorted suffix fall out of
// the same rule, and so does a selection sort's prefix.
//
// The result is a pure function of one cursor position, so stepping back or
// seeking recomputes exactly that position's cells and cannot keep a later
// step's highlights.

import { canonicalValue } from "../../animation/actions.js";

const CACHE = new WeakMap();

/** A finite number a Python `<` can order, or null when the value cannot be. */
function finiteNumber(value) {
  if (value?.type !== "int" && value?.type !== "float") return null;
  // A big integer is serialized as a string precisely because it does not fit;
  // ordering it here would be an approximation, so it is left unverified.
  if (value.big === true) return null;
  const number = Number(value.value);
  return Number.isFinite(number) ? number : null;
}

function nondecreasing(items) {
  let previous = null;
  for (const item of items) {
    const number = finiteNumber(item);
    if (number === null) return false;
    if (previous !== null && number < previous) return false;
    previous = number;
  }
  return true;
}

function sameItems(left, right) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (canonicalValue(left[index]) !== canonicalValue(right[index])) return false;
  }
  return true;
}

function truncated(object) {
  return Number.isInteger(object?.more) && object.more > 0;
}

/**
 * The outcome evidence for one whole trace, cached per trace.
 *
 * `objects` answers, per list object id, what the run ended with and whether
 * the recording ever rearranged it in place. `completed` is true only when the
 * trace finished normally, so a limit or an exception exposes no outcomes.
 *
 * @param {Array} trace the trace events
 * @returns {{completed: boolean, objects: Map<string, Object>}}
 */
export function sequenceOutcomes(trace) {
  const events = Array.isArray(trace) ? trace : [];
  const cached = CACHE.get(events);
  if (cached) return cached;

  const objects = new Map();
  for (const event of events) {
    const heap = event?.heap;
    if (!heap || typeof heap !== "object") continue;
    for (const [objectId, object] of Object.entries(heap)) {
      if (object?.type !== "list" || !Array.isArray(object.items)) continue;
      let record = objects.get(objectId);
      if (!record) {
        record = { items: null, sorted: false, rearranged: false, previous: null };
        objects.set(objectId, record);
      }
      if (truncated(object)) continue;
      const items = object.items;
      if (
        record.previous &&
        record.previous.length === items.length &&
        !sameItems(record.previous, items)
      ) {
        record.rearranged = true;
      }
      record.previous = items;
      record.items = items;
    }
  }

  for (const record of objects.values()) {
    record.sorted = record.items !== null && record.items.length > 0 && nondecreasing(record.items);
    delete record.previous;
  }

  const outcome = {
    completed: events.length > 0 && events[events.length - 1]?.event === "return",
    objects,
  };
  CACHE.set(events, outcome);
  return outcome;
}

/**
 * The indices of one list's cells whose value the run is known to end with.
 *
 * @param {Object} object a heap entry from the state being drawn
 * @param {Object|null} outcome this object's outcome from `sequenceOutcomes`
 * @returns {number[]} ascending indices; empty when nothing is proven
 */
export function finalIndices(object, outcome) {
  if (!outcome?.sorted || truncated(object)) return [];
  const items = object?.items;
  const final = outcome.items;
  if (!Array.isArray(items) || !Array.isArray(final)) return [];
  if (items.length === 0 || items.length !== final.length) return [];

  const matches = (index) => canonicalValue(items[index]) === canonicalValue(final[index]);

  const head = [];
  while (head.length < items.length && matches(head.length)) head.push(head.length);
  const tail = [];
  for (let index = items.length - 1; index >= head.length; index -= 1) {
    if (!matches(index)) break;
    tail.push(index);
  }
  return [...head, ...tail.reverse()];
}

/**
 * Every cell the current state proves settled, grouped by object.
 *
 * @param {{heap: Object}} state a state from `stateOf`
 * @param {Array} trace the trace events
 * @returns {Array<{objectId: string, indices: number[]}>}
 */
export function finalizedCells(state, trace) {
  const evidence = sequenceOutcomes(trace);
  if (!evidence.completed) return [];
  const heap = state?.heap ?? {};
  const cells = [];
  for (const [objectId, object] of Object.entries(heap)) {
    if (object?.type !== "list") continue;
    const outcome = evidence.objects.get(objectId);
    if (!outcome?.rearranged) continue;
    const indices = finalIndices(object, outcome);
    if (indices.length > 0) cells.push({ objectId, indices });
  }
  return cells;
}
