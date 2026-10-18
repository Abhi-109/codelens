// Formats trace values (docs/trace-format.md section 4) as short, readable
// text. Shared by the UI and the plain-English explainer so both always say
// the same thing about a value.

/** Anything that can appear as a value: a plain value, or a container. */
const CONTAINERS = new Set(["list", "tuple", "set", "dict", "object"]);

/** Formats a value or a container, whichever is in front of us. */
function describeAny(value, heap) {
  if (value && CONTAINERS.has(value.type)) return describeObject(value, heap);
  return formatValue(value, heap);
}

export function formatValue(value, heap) {
  if (!value) return "?";
  switch (value.type) {
    case "none":
      return "None";
    case "bool":
      return value.value ? "True" : "False";
    case "int":
    case "float":
      return String(value.value);
    case "str": {
      // A string the tracer cut short says so, rather than looking complete.
      const text = value.value ?? "";
      return JSON.stringify(value.truncated ? `${text}…` : text);
    }
    case "ref": {
      const object = heap?.[value.id];
      // A reference whose object is not in this step's snapshot. Saying so is
      // honest; printing the trace's internal id (`o7`) is not a value.
      if (!object) return "(not shown at this step)";
      return describeAny(object, heap);
    }
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
export function describeObject(object, heap) {
  if (!object) return "?";
  const note = moreNote(object);
  if (object.type === "list" || object.type === "tuple" || object.type === "set") {
    return `[${object.items.map((item) => describeAny(item, heap)).join(", ")}${note}]`;
  }
  if (object.type === "dict") {
    const body = object.entries
      .map((entry) => `${describeAny(entry.key, heap)}: ${describeAny(entry.value, heap)}`)
      .join(", ");
    return `{${body}${note}}`;
  }
  if (object.type === "object") {
    const body = object.attrs
      .map((attr) => `${attr.name}=${describeAny(attr.value, heap)}`)
      .join(", ");
    return `${object.class}(${body}${note})`;
  }
  return object.repr ?? "?";
}

/** Turns any value from the trace into one short display string. */
export function showValue(value, heap) {
  if (value?.type === "ref") {
    const object = heap?.[value.id];
    return object ? describeObject(object, heap) : "(not shown at this step)";
  }
  return formatValue(value, heap);
}
