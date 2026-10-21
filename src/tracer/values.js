// Formats trace values (docs/trace-format.md section 4) as short, readable
// text. Shared by the UI and the plain-English explainer so both always say
// the same thing about a value.

/**
 * What a repeat visit to an object says. A container can hold itself
 * (`a = []; a.append(a)`), so the trace legitimately describes a cycle. Python
 * prints that as `[[...]]`; printing `[` forever would overflow the JS stack.
 */
function cycleMarker(object) {
  switch (object?.type) {
    case "dict":
      return "{…}";
    case "object":
      return `${object.class ?? "object"}(…)`;
    case "tuple":
      return "(…)";
    case "set":
      return "{…}";
    default:
      return "[…]";
  }
}

export function formatValue(value, heap, seen = new Set()) {
  if (!value) return "?";
  switch (value.type) {
    case "none":
      return "None";
    case "bool":
      return value.value ? "True" : "False";
    case "int":
      return String(value.value);
    case "float":
      // nan and inf have no JSON number, so the tracer records their repr.
      // Falling back to the number would print "undefined".
      return value.repr ?? String(value.value);
    case "str": {
      // A string the tracer cut short says so, rather than looking complete.
      const text = value.value ?? "";
      return JSON.stringify(value.truncated ? `${text}…` : text);
    }
    case "ref":
      return showValue(value, heap, seen);
    case "function":
      return `${value.name}()`;
    case "class":
      return `class ${value.name}`;
    case "module":
      return value.name;
    default:
      return value.repr ?? value.class ?? "?";
  }
}

/** ", … 27 more" when the tracer stopped listing items, otherwise "". */
function moreNote(object) {
  const more = Number(object?.more ?? 0);
  return Number.isFinite(more) && more > 0 ? `, … ${more} more` : "";
}

/** Describes the object a reference points at: a list, dict, or instance. */
export function describeObject(object, heap, seen = new Set()) {
  if (!object) return "?";
  const note = moreNote(object);
  if (object.type === "list" || object.type === "tuple" || object.type === "set") {
    const body = object.items.map((item) => showValue(item, heap, seen)).join(", ");
    const inner = `${body}${note}`;
    if (object.type === "tuple") {
      // A one-item tuple keeps Python's trailing comma: (1,) is not (1).
      return object.items.length === 1 && !note ? `(${body},)` : `(${inner})`;
    }
    if (object.type === "set") {
      if (object.items.length === 0 && !note) return "set()";
      const shown = `{${inner}}`;
      // frozenset and set subclasses keep their real name, as Python prints them.
      return object.class && object.class !== "set" ? `${object.class}(${shown})` : shown;
    }
    return `[${inner}]`;
  }
  if (object.type === "dict") {
    const body = object.entries
      .map(
        (entry) =>
          `${showValue(entry.key, heap, seen)}: ${showValue(entry.value, heap, seen)}`,
      )
      .join(", ");
    return `{${body}${note}}`;
  }
  if (object.type === "object") {
    const body = object.attrs
      .map((attr) => `${attr.name}=${showValue(attr.value, heap, seen)}`)
      .join(", ");
    return `${object.class}(${body}${note})`;
  }
  return object.repr ?? "?";
}

/** Turns any value from the trace into one short display string. */
export function showValue(value, heap, seen = new Set()) {
  if (value?.type === "ref") {
    const object = heap?.[value.id];
    if (!object) return "(not shown at this step)";
    // The trace can describe an object that contains itself. Mark this object
    // before descending, so a cycle becomes a visible marker instead of a
    // stack overflow.
    if (seen.has(value.id)) return cycleMarker(object);
    const next = new Set(seen);
    next.add(value.id);
    return describeObject(object, heap, next);
  }
  return formatValue(value, heap, seen);
}
