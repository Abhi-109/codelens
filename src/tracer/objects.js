// Pure helpers for drawing heap objects (lists, dicts, instances) as
// diagrams. Shared by the UI; no React here so node --test can cover it.

import { formatValue } from "./values.js";

/**
 * Which names point at each object id, top frame first — the two names
 * that share one id are drawn on the same box ("a, b → o1"). Nested
 * objects get a path from their parent ("rex.tricks").
 * @param {Array} frames the trace's frames array, oldest first
 * @param {Object} [heap] the same event's heap, for nested paths
 * @returns {Map<string, string[]>}
 */
export function namesById(frames, heap) {
  const map = new Map();
  const add = (id, name) => {
    const list = map.get(id) ?? [];
    if (!list.includes(name)) list.push(name);
    map.set(id, list);
  };
  for (let i = (frames?.length ?? 0) - 1; i >= 0; i -= 1) {
    for (const [name, value] of Object.entries(frames[i].variables ?? {})) {
      if (value?.type !== "ref") continue;
      add(value.id, name);
    }
  }
  // Walk parents to name their children: "rex.tricks", "tricks[0]".
  const byId = heap ?? {};
  const queue = [...map.keys()];
  const seen = new Set();
  while (queue.length > 0) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const name of map.get(id) ?? []) {
      const object = byId[id];
      const children = [];
      if (object?.type === "object") {
        for (const attr of object.attrs ?? []) {
          if (attr.value?.type === "ref") children.push([attr.value.id, `${name}.${attr.name}`]);
        }
      } else if (object?.type === "list" || object?.type === "dict") {
        const items = object.items ?? object.entries ?? [];
        items.forEach((item, i) => {
          const target = object.type === "dict" ? item.value : item;
          if (target?.type !== "ref" || target.id === id) return; // no "a[0]" alias for itself
          // A dict child is reached by its key, not by its position, so the
          // path reads like the code the learner wrote: d["x"], not d[0].
          const path =
            object.type === "dict"
              ? `${name}[${formatValue(item.key, byId)}]`
              : `${name}[${i}]`;
          children.push([target.id, path]);
        });
      }
      for (const [childId, path] of children) {
        add(childId, path);
        queue.push(childId);
      }
    }
  }
  return map;
}

/**
 * Normalizes any heap object into drawable slots. The key identifies the
 * slot between steps (list index, dict key, attribute name); the label is
 * what the diagram prints above the value.
 */
export function slotEntries(object) {
  if (!object) return [];
  switch (object.type) {
    case "list":
    case "tuple":
      return object.items.map((value, i) => ({ key: i, label: i, value }));
    case "set":
      return object.items.map((value) => ({ key: JSON.stringify(value), label: null, value }));
    case "dict":
      return object.entries.map((entry) => ({
        key: JSON.stringify(entry.key),
        label: entry.key,
        value: entry.value,
      }));
    case "object":
      return object.attrs.map((attr) => ({ key: attr.name, label: attr.name, value: attr.value }));
    default:
      return [];
  }
}

/**
 * Slot keys whose value changed (or appeared) between two versions of one
 * object. Removed slots contribute their old keys, so the card still lights
 * up even though no surviving slot did the changing.
 */
export function changedSlots(before, after) {
  const changed = new Set();
  if (!after) return changed;
  const now = slotEntries(after);
  if (!before) {
    for (const entry of now) changed.add(entry.key);
    return changed;
  }
  const old = new Map(slotEntries(before).map((entry) => [entry.key, entry.value]));
  for (const entry of now) {
    if (JSON.stringify(old.get(entry.key)) !== JSON.stringify(entry.value)) changed.add(entry.key);
  }
  for (const key of old.keys()) {
    if (!now.some((entry) => entry.key === key)) changed.add(key);
  }
  // Growing past the display limit only shows up in `more`.
  if ((before.more ?? 0) !== (after.more ?? 0)) changed.add("more");
  return changed;
}

/**
 * A short, stable name for an object card. The number comes from the trace's
 * own object id (`o1` -> `#1`), so it never changes during a run and is not a
 * memory address. Beginner mode hides it; Advanced shows it.
 */
export function objectLabel(id, object) {
  const type = object?.class ?? object?.type ?? "object";
  const number = Number(String(id ?? "").replace(/\D/g, ""));
  return Number.isFinite(number) && number > 0 ? `${type} #${number}` : type;
}

/**
 * Every real reference the memory view draws: one per name pointing at an
 * object, and one per slot inside an object that points at another object.
 * Two names for one list produce two edges to the same target, which is what
 * makes the shared-object picture honest.
 * @returns {Array<{ key: string, kind: "variable"|"slot", frameId?: number, name?: string, objectId?: string, slotKey?: string|number, targetId: string }>}
 */
export function referenceEdges(frames, heap) {
  const byId = heap ?? {};
  const edges = [];
  for (let i = (frames?.length ?? 0) - 1; i >= 0; i -= 1) {
    const frame = frames[i];
    for (const [name, value] of Object.entries(frame.variables ?? {})) {
      if (value?.type !== "ref" || !byId[value.id]) continue;
      edges.push({
        key: `var:${frame.frame_id}:${name}`,
        kind: "variable",
        frameId: frame.frame_id,
        name,
        targetId: value.id,
      });
    }
  }
  for (const [id, object] of Object.entries(byId)) {
    for (const entry of slotEntries(object)) {
      if (entry.value?.type !== "ref" || !byId[entry.value.id]) continue;
      edges.push({
        key: `slot:${id}:${entry.key}`,
        kind: "slot",
        objectId: id,
        slotKey: entry.key,
        targetId: entry.value.id,
      });
    }
  }
  return edges;
}

/**
 * Which objects' contents changed between two heap snapshots.
 * @returns {Map<string, Set<string>>} object id → changed slot keys
 */
export function objectChanges(beforeHeap, afterHeap) {
  const changes = new Map();
  for (const [id, object] of Object.entries(afterHeap ?? {})) {
    const slots = changedSlots(beforeHeap?.[id], object);
    if (slots.size > 0) changes.set(id, slots);
  }
  return changes;
}
