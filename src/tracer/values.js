// Formats trace values (docs/trace-format.md section 4) as short, readable
// text. Shared by the UI and the plain-English explainer so both always say
// the same thing about a value.

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
    case "str":
      return JSON.stringify(value.value);
    case "ref": {
      const object = heap?.[value.id];
      if (!object) return value.id;
      const inner = formatValue(object, heap);
      return `${inner} (${value.id})`;
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

/** Describes the object a reference points at: a list, dict, or instance. */
export function describeObject(object, heap) {
  if (!object) return "?";
  if (object.type === "list" || object.type === "tuple" || object.type === "set") {
    return `[${object.items.map((item) => formatValue(item, heap)).join(", ")}]`;
  }
  if (object.type === "dict") {
    const body = object.entries
      .map((entry) => `${formatValue(entry.key, heap)}: ${formatValue(entry.value, heap)}`)
      .join(", ");
    return `{${body}}`;
  }
  if (object.type === "object") {
    const body = object.attrs
      .map((attr) => `${attr.name}=${formatValue(attr.value, heap)}`)
      .join(", ");
    return `${object.class}(${body})`;
  }
  return object.repr ?? "?";
}

/** Turns any value from the trace into one short display string. */
export function showValue(value, heap) {
  if (value?.type === "ref") {
    const object = heap?.[value.id];
    return object ? describeObject(object, heap) : value.id;
  }
  return formatValue(value, heap);
}
