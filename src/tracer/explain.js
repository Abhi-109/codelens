// The teaching layer: turns one trace event into a plain-English sentence a
// complete beginner can follow. Pure functions over the trace JSON (see
// docs/trace-format.md) — no AI, no network, so it works offline and can
// never invent an explanation that contradicts the trace.
//
//   explainStep(trace, index, source) -> { text, concept }
//
// `concept` is an id into CONCEPTS, used by the UI to show a short card the
// first time a concept appears in a run.

import { changedSlots, slotEntries } from "./objects.js";
import { getTraceIndex } from "./traceIndex.js";
import { showValue } from "./values.js";

/** Short glossary shown as concept cards. Every concept id a rule can emit must exist here. */
export const CONCEPTS = {
  variable: {
    term: "Variable",
    blurb:
      "A variable is a labelled box that holds a value. You pick the label (the name), and Python keeps track of what is inside.",
  },
  condition: {
    term: "Condition",
    blurb:
      "A condition is a question with a yes/no answer, like count >= 90. Python answers True or False and takes the branch that matches.",
  },
  loop: {
    term: "Loop",
    blurb:
      "A loop repeats a block of code. A for loop repeats once per item; a while loop repeats as long as its condition stays True.",
  },
  function: {
    term: "Function",
    blurb:
      "A function is a named recipe you can run again and again. Defining one just writes the recipe; nothing happens until it is called.",
  },
  "function-call": {
    term: "Function call",
    blurb:
      "Calling a function pauses the current line of code, runs the recipe, then comes back to where it was called from.",
  },
  return: {
    term: "Return value",
    blurb:
      "Returning hands a value back to whoever called the function, and the function's work is finished.",
  },
  list: {
    term: "List",
    blurb:
      "A list is an ordered box with numbered slots, starting at 0. You can add, remove, and change items.",
  },
  index: {
    term: "List index",
    blurb:
      "The number in square brackets picks one item out of a list. Slots are numbered from 0, so the first item is [0].",
  },
  recursion: {
    term: "Recursion",
    blurb:
      "Recursion is a function that calls itself. Each call gets its own fresh variables, and the calls pile up until one of them stops without calling again.",
  },
  dictionary: {
    term: "Dictionary",
    blurb:
      "A dictionary stores pairs of a key and a value, like a real dictionary: look up a word (key), get its meaning (value).",
  },
  class: {
    term: "Class",
    blurb:
      "A class is a blueprint for objects. Creating an object from it is like using the blueprint to build a real copy with its own data.",
  },
  print: {
    term: "Print",
    blurb:
      "Printing shows text on the screen for the person running the program. It does not change any variables.",
  },
  input: {
    term: "Input",
    blurb:
      "Input asks the person running the program to type something, and the program continues with whatever was typed.",
  },
  error: {
    term: "Error",
    blurb:
      "An error stops Python at the exact line that failed. The lines above it already ran and did their work.",
  },
  stopped: {
    term: "Safety stop",
    blurb:
      "CodeLens stops programs that run too long or print too much, so a small mistake like an endless loop cannot freeze your browser.",
  },
};

const MAX_TEXT = 70;

function short(text) {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
}

function sourceLine(source, lineNo) {
  const raw = source.split("\n")[lineNo - 1] ?? "";
  const text = raw.trim();
  return { text, indent: raw.length - raw.trimStart().length };
}

/** The first event after `index` that carries the full state. */
function nextState(trace, index) {
  return getTraceIndex(trace).nextState(index);
}

/** Has this source line already run in this frame before this step? */
function seenBefore(trace, index, line, frameId) {
  return getTraceIndex(trace).seenBefore(index, line, frameId);
}

function topVariables(state) {
  return state?.frames?.[state.frames.length - 1]?.variables ?? {};
}

function variableShow(variables, heap, name) {
  return showValue(variables[name], heap);
}

/** The shown value of `name.attr`, or null when the trace does not hold it. */
function attributeValue(variables, heap, path) {
  const match = String(path).match(/^([A-Za-z_]\w*)\.([A-Za-z_]\w*)$/);
  if (!match) return null;
  const root = variables[match[1]];
  if (root?.type !== "ref") return null;
  const attr = (heap?.[root.id]?.attrs ?? []).find((entry) => entry.name === match[2]);
  return attr ? showValue(attr.value, heap) : null;
}

/** Substitutes known variable names in a condition, so "count >= 90" reads "68 >= 90". */
export function substituteVars(text, variables, heap) {
  let out = text.replace(/[A-Za-z_]\w*/g, (name) => {
    if (!(name in variables)) return name;
    const shown = variableShow(variables, heap, name);
    return shown.length <= 12 ? shown : name;
  });
  return short(out);
}

/** The next `line` event that carries state, or null. */
function nextLineEvent(trace, index) {
  return getTraceIndex(trace).nextLineEvent(index);
}

/**
 * The last source line (1-based) of the block that belongs to a compound
 * statement header at `indent`. Blank lines and comments are skipped; the
 * block ends at the first real line that is not indented deeper.
 */
export function blockEnd(source, headerLine, indent) {
  const lines = source.split("\n");
  let end = headerLine;
  for (let n = headerLine; n < lines.length; n += 1) {
    const raw = lines[n];
    if (raw.trim() === "" || raw.trim().startsWith("#")) continue;
    if (raw.length - raw.trimStart().length <= indent) break;
    end = n + 1;
  }
  return end;
}

/**
 * Finds the `else:` of the branch chain a block belongs to: it is the first
 * real source line after the block, at the same indent as the header.
 */
function elseAfterBlock(source, blockEndLine, indent) {
  const lines = source.split("\n");
  for (let n = blockEndLine; n < lines.length; n += 1) {
    const raw = lines[n];
    if (raw.trim() === "" || raw.trim().startsWith("#")) continue;
    const i = raw.length - raw.trimStart().length;
    if (i === indent && /^else:$/.test(raw.trim())) return n + 1;
    return null;
  }
  return null;
}

const ASSIGN_RE = /^([A-Za-z_]\w*)\s*=(?!=)\s*(.*)$/;
const AUGMENTED_RE = /^([A-Za-z_]\w*)\s*(\*\*|[-+*/%])=\s*(.+)$/;
const ITEM_ASSIGN_RE = /^([A-Za-z_]\w*)\[[^\]]+\]\s*=(?!=)\s*(.*)$/;
const SWAP_RE = /^([A-Za-z_]\w*)\[[^\]]+\],\s*\1\[[^\]]+\]\s*=/;
const CALL_RE = /^([A-Za-z_]\w*)\((.*)\)$/;
const METHOD_RE = /^([A-Za-z_]\w*)\.([A-Za-z_]\w*)\((.*)\)$/;
const DEF_PARAMS_RE = /^def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/;
const LIST_METHODS = new Set(["append", "insert", "pop", "remove", "extend", "sort", "reverse"]);

/**
 * The text a print() line writes, read from the output events that follow it
 * (they carry no stack of their own, so we gather them until control moves on).
 */
function printedText(trace, index) {
  const raw = getTraceIndex(trace).printedRawAfter(index);
  return { produced: raw.length > 0, text: short(raw.replace(/\n$/, "")) };
}

/** The one slot an item assignment changed, named and valued from the next state. */
function itemChange(trace, index, name, variables, beforeHeap) {
  const ref = variables?.[name];
  if (ref?.type !== "ref") return null;
  const after = nextState(trace, index);
  const afterObject = after?.heap?.[ref.id];
  if (!afterObject) return null;
  const changed = changedSlots(beforeHeap?.[ref.id], afterObject);
  if (changed.size === 0) return null;
  const key = [...changed][0];
  const values = new Map(slotEntries(afterObject).map((entry) => [entry.key, entry.value]));
  const slot = typeof key === "number" ? `${name}[${key}]` : `${name}[${JSON.stringify(key)}]`;
  return { slot, value: showValue(values.get(key), after.heap) };
}

/** True when this call is a function already running below it on the stack. */
function isRecursive(event) {
  return (event.frames ?? []).slice(0, -1).some((frame) => frame.function === event.function);
}

function explainLine(event, trace, index, source) {
  const variables = topVariables(event);
  const { text, indent } = sourceLine(source, event.line);
  if (!text) {
    return {
      text:
        event.line === 0
          ? "There are no statements to run."
          : "The program moves on.",
      concept: null,
    };
  }

  // def / class: writing a recipe or a blueprint; nothing runs yet.
  let match = text.match(/^def\s+([A-Za-z_]\w*)/);
  if (match) {
    return {
      text: `Defines a function named ${match[1]}. Nothing happens until someone calls it.`,
      concept: "function",
    };
  }
  match = text.match(/^class\s+([A-Za-z_]\w*)/);
  if (match) {
    return {
      text: `Defines a class named ${match[1]}: a blueprint for objects. Nothing happens until an object is made from it.`,
      concept: "class",
    };
  }
  match = text.match(/^async\s+def\s+([A-Za-z_]\w*)/);
  if (match) {
    return {
      text: `Defines an async function named ${match[1]}. It runs when the program awaits it.`,
      concept: "function",
    };
  }
  if (/^@[A-Za-z_]\w*/.test(text)) {
    const decorator = text.slice(1).replace(/\(.*$/, "");
    return {
      text: `Decorates the function below with ${decorator}, so it is wrapped before anyone calls it.`,
      concept: "function",
    };
  }
  match = text.match(/^from\s+([\w.]+)\s+import\s+(.+)$/);
  if (match) {
    return {
      text: `Takes ${short(match[2])} from ${match[1]}, so the program can use it by name.`,
      concept: null,
    };
  }
  match = text.match(/^import\s+(.+)$/);
  if (match) {
    return { text: `Loads the ${short(match[1])} module and makes it available.`, concept: null };
  }

  // Loops.
  match = text.match(/^for\s+([A-Za-z_]\w*)\s+in\s+(.+):$/);
  if (match) {
    const [, name] = match;
    const next = nextLineEvent(trace, index);
    const end = blockEnd(source, event.line, indent);
    // The next line only counts as another round when it is inside this loop's
    // body. A final for event is followed by the line after the loop, and the
    // loop variable still exists there, so its presence proves nothing.
    if (!next || next.line < event.line || next.line > end) {
      return { text: `The loop has no more items, so it stops here.`, concept: "loop" };
    }
    const after = nextState(trace, index);
    const afterVars = topVariables(after);
    if (!(name in afterVars)) {
      return { text: `The loop found no more items, so it stops here.`, concept: "loop" };
    }
    if (!(name in variables)) {
      return {
        text: `The loop starts: ${name} is now ${variableShow(afterVars, after?.heap, name)}.`,
        concept: "loop",
      };
    }
    return {
      text: `Next round of the loop: ${name} becomes ${variableShow(afterVars, after?.heap, name)}.`,
      concept: "loop",
    };
  }
  match = text.match(/^while\s+(.+):$/);
  if (match) {
    const condition = substituteVars(match[1], variables, event.heap);
    const next = nextLineEvent(trace, index);
    const end = blockEnd(source, event.line, indent);
    const first = !seenBefore(trace, index, event.line, event.frame_id);
    // Same-line suites (`while x: step()`) have their body on the loop's own
    // line, so `>=` is the correct lower bound here.
    if (next && next.line >= event.line && next.line <= end) {
      return {
        text: first
          ? `The while loop checks its condition: ${condition} is True, so the loop begins.`
          : `The while loop checks again: ${condition} is True, so another round begins.`,
        concept: "loop",
      };
    }
    return {
      text: first
        ? `The while loop checks its condition: ${condition} is False, so the loop never runs.`
        : `The while loop checks ${condition} one last time; the loop ends here.`,
      concept: "loop",
    };
  }

  // Branches.
  match = text.match(/^(?:el)?if\s+(.+):$/);
  if (match) {
    const condition = substituteVars(match[1], variables, event.heap);
    const next = nextLineEvent(trace, index);
    if (!next) {
      return { text: `Checks ${condition}, but the program ends before using the answer.`, concept: "condition" };
    }
    const end = blockEnd(source, event.line, indent);
    if (next.line >= event.line && next.line <= end) {
      return { text: `${condition} is True, so this branch runs.`, concept: "condition" };
    }
    // The block was skipped. Python either tries an else branch right after
    // it, or carries on past the whole chain.
    if (elseAfterBlock(source, end, indent)) {
      return { text: `${condition} is False, so the else branch runs instead.`, concept: "condition" };
    }
    return { text: `${condition} is False, so this branch is skipped.`, concept: "condition" };
  }
  if (/^else:$/.test(text)) {
    return {
      text: "The earlier conditions were all False, so this branch runs instead.",
      concept: "condition",
    };
  }

  // Statements that move control without producing a value.
  if (/^break\b/.test(text)) {
    return { text: "Leaves the nearest loop now.", concept: "loop" };
  }
  if (/^continue\b/.test(text)) {
    return {
      text: "Skips the rest of this loop round and starts the next one.",
      concept: "loop",
    };
  }
  if (/^pass\b/.test(text)) {
    return { text: "Does nothing. It keeps this block valid.", concept: null };
  }
  if (/^raise\b/.test(text)) {
    const raised = text.replace(/^raise\s*/, "").trim();
    return {
      text: raised ? `Raises ${short(raised)}.` : "Raises the current exception again.",
      concept: "error",
    };
  }
  if (/^try\s*:/.test(text)) {
    return {
      text: "Starts a protected block: if a line inside raises, Python looks for a matching except.",
      concept: "error",
    };
  }
  match = text.match(/^except(?:\s+(.+?))?\s*:/);
  if (match) {
    const kind = (match[1] ?? "an exception").replace(/\s+as\s+\w+$/, "").trim();
    return {
      text: `Catches ${kind}, so the program can continue instead of stopping.`,
      concept: "error",
    };
  }
  if (/^finally\s*:/.test(text)) {
    return {
      text: "Runs this cleanup block whether the try block finished or failed.",
      concept: "error",
    };
  }
  match = text.match(/^yield\s+from\s+(.+)$/);
  if (match) {
    return {
      text: `Hands every value from ${short(match[1])} to the caller, one at a time.`,
      concept: "loop",
    };
  }
  match = text.match(/^yield(?:\s+(.+))?$/);
  if (match) {
    const produced = match[1] ? substituteVars(match[1], variables, event.heap) : null;
    return {
      text: produced ? `Produces ${produced} and pauses here until the next value is asked for.` : "Pauses here, handing nothing back.",
      concept: "return",
    };
  }
  match = text.match(/^del\s+(.+)$/);
  if (match) {
    const target = match[1].trim();
    return {
      text: target.includes("[") ? `Deletes one item: ${short(target)}.` : `Deletes the name ${short(target)}.`,
      concept: target.includes("[") ? "list" : "variable",
    };
  }

  // Returning a value (the return event right after confirms what is handed back).
  match = text.match(/^return(?:\s+(.+))?$/);
  if (match) {
    return {
      text: match[1]
        ? `This line finishes the function and hands back ${short(match[1])}.`
        : "This line finishes the function; it gives back nothing.",
      concept: "return",
    };
  }

  // Printing and asking for input.
  if (/^print\s*\(/.test(text)) {
    const printed = printedText(trace, index);
    return {
      text: printed.produced
        ? printed.text
          ? `This line prints ${printed.text} on the screen.`
          : "This line prints a blank line."
        : "This line shows something on the screen.",
      concept: "print",
    };
  }
  if (/(^|=)\s*input\s*\(/.test(text)) {
    return { text: "This line asks the person running the program to type something.", concept: "input" };
  }

  // List item changes.
  if (SWAP_RE.test(text)) {
    return {
      text: `Swaps two neighbouring items inside ${text.match(SWAP_RE)[1]}.`,
      concept: "list",
    };
  }
  match = text.match(ITEM_ASSIGN_RE);
  if (match) {
    const change = itemChange(trace, index, match[1], variables, event.heap);
    return {
      text: change
        ? `Sets one item inside ${match[1]}: ${change.slot} is now ${change.value}.`
        : `Changes one item inside ${match[1]}.`,
      concept: "index",
    };
  }

  // list.append and other list methods.
  match = text.match(METHOD_RE);
  if (match) {
    const [, receiver, method, args] = match;
    if (LIST_METHODS.has(method) && variables[receiver]?.type === "ref") {
      if (method === "append" || method === "extend") {
        const argText = args in variables ? variableShow(variables, event.heap, args) : short(args);
        return {
          text: `Adds ${argText} to the end of ${receiver}.`,
          concept: "list",
        };
      }
      if (method === "pop") {
        return { text: `Takes the last item out of ${receiver}.`, concept: "list" };
      }
      return { text: `Runs ${method}() on the list ${receiver}.`, concept: "list" };
    }
    return { text: `Calls the method ${method}() on ${receiver}.`, concept: "function-call" };
  }
  // A method on a dotted or indexed receiver, such as self.items.append(x).
  match = text.match(/^([^()]+)\.([A-Za-z_]\w*)\((.*)\)$/);
  if (match) {
    return {
      text: `Calls the method ${match[2]}() on ${short(match[1])}.`,
      concept: "function-call",
    };
  }

  // Assignments.
  match = text.match(/^([A-Za-z_]\w*\.[A-Za-z_]\w*)\s*=(?!=)\s*(.*)$/);
  if (match) {
    const [, target, rhs] = match;
    const after = nextState(trace, index);
    const afterVars = topVariables(after);
    const now = attributeValue(afterVars, after?.heap, target);
    const shown = now ?? (rhs ? substituteVars(rhs, variables, event.heap) : null);
    return {
      text: shown ? `Sets ${target} to ${shown}.` : `Sets ${target}.`,
      concept: "variable",
    };
  }
  match = text.match(/^([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)+)\s*=(?!=)\s*(.+)$/);
  if (match) {
    const names = match[1].split(",").map((part) => part.trim());
    const provided = match[2].split(",").map((part) => part.trim());
    const after = nextState(trace, index);
    const afterVars = topVariables(after);
    const shown = names.every((name) => name in afterVars)
      ? names.map((name) => `${name} = ${variableShow(afterVars, after?.heap, name)}`)
      : [];
    const swapped =
      names.length === provided.length &&
      names.every((name, i) => provided[names.length - 1 - i] === name);
    if (swapped) {
      return {
        text: `Swaps ${names.join(" and ")}${shown.length ? `: ${shown.join(", ")}` : ""}.`,
        concept: "variable",
      };
    }
    return {
      text: `Unpacks ${short(match[2])} into ${names.join(" and ")}${shown.length ? `: ${shown.join(", ")}` : ""}.`,
      concept: "variable",
    };
  }
  match = text.match(/^([A-Za-z_]\w*(?:\[[^\]]+\]){2,})\s*=(?!=)\s*(.*)$/);
  if (match) {
    const [, target, rhs] = match;
    const value = rhs ? substituteVars(rhs, variables, event.heap) : null;
    return {
      text: value ? `Sets ${short(target)} to ${value}.` : `Sets ${short(target)}.`,
      concept: "index",
    };
  }
  match = text.match(AUGMENTED_RE);
  if (match) {
    const [, name, op, rhs] = match;
    const after = nextState(trace, index);
    const afterVars = topVariables(after);
    const now = name in afterVars ? variableShow(afterVars, after?.heap, name) : null;
    const amount = rhs in variables ? variableShow(variables, event.heap, rhs) : short(rhs);
    const phrase =
      op === "+" ? `Adds ${amount} to ${name}`
      : op === "-" ? `Subtracts ${amount} from ${name}`
      : op === "*" ? `Multiplies ${name} by ${amount}`
      : op === "/" ? `Divides ${name} by ${amount}`
      : op === "%" ? `Works out ${name} modulo ${amount}`
      : `Raises ${name} to the power of ${amount}`;
    return {
      text: now !== null ? `${phrase}; it is now ${now}.` : `${phrase}.`,
      concept: "variable",
    };
  }
  match = text.match(ASSIGN_RE);
  if (match) {
    const [, name, rhs] = match;
    const call = rhs.match(CALL_RE);
    if (call) {
      const after = nextState(trace, index);
      const afterVars = topVariables(after);
      const now = name in afterVars ? variableShow(afterVars, after?.heap, name) : null;
      return {
        text: `Calls ${call[1]}() and ${now !== null ? `keeps the answer (${now})` : "keeps the answer"} in ${name}.`,
        concept: "function-call",
      };
    }
    const after = nextState(trace, index);
    const afterVars = topVariables(after);
    if (!(name in afterVars)) {
      return { text: `Sets ${name}.`, concept: "variable" };
    }
    const now = variableShow(afterVars, after?.heap, name);
    const value = afterVars[name];
    const literalConcept = /^\[/.test(rhs)
      ? "list"
      : /^\{/.test(rhs) || (value?.type === "ref" && after?.heap?.[value.id]?.type === "dict")
        ? "dictionary"
        : null;
    if (!(name in variables)) {
      return { text: `${name} is created with the value ${now}.`, concept: literalConcept ?? "variable" };
    }
    const before = variableShow(variables, event.heap, name);
    return {
      text: before === now ? `${name} is set to ${now} again.` : `${name} changes from ${before} to ${now}.`,
      concept: "variable",
    };
  }

  // A plain function call.
  match = text.match(CALL_RE);
  if (match) {
    return { text: `Calls the function ${match[1]}().`, concept: "function-call" };
  }

  // A line inside a multi-line literal or call.
  if (insideOpenBracket(source, event.line)) {
    return { text: "Evaluates this part of the expression.", concept: null };
  }

  return { text: `Runs this line: ${text}`, concept: null };
}

/** Explains a call event by naming the function and showing the values it received. */
function explainCall(event, source) {
  if (event.function === "<module>") {
    return { text: "The program starts running, from the very top.", concept: null };
  }
  const variables = topVariables(event);
  const defLine = source.split("\n").find((line) => line.trim().startsWith(`def ${event.function}(`));
  const params = defLine?.match(DEF_PARAMS_RE)?.[2];
  if (!params) return { text: `Calls the function ${event.function}().`, concept: "function-call" };
  const names = params
    .split(",")
    .map((p) => p.trim().split("=")[0].replace(/^\*+/, ""))
    .filter((p) => p && p !== "self");
  const shown = names
    .filter((name) => name in variables)
    .map((name) => `${name} = ${variableShow(variables, event.heap, name)}`);
  return {
    text: shown.length
      ? `Calls ${event.function}() with ${shown.join(", ")}.`
      : `Calls the function ${event.function}().`,
    concept: isRecursive(event) ? "recursion" : "function-call",
  };
}

function explainReturn(event) {
  if (event.function === "<module>") {
    return { text: "The program finishes. That is the whole run!", concept: null };
  }
  if (!event.return_value) {
    return { text: `${event.function}() finishes without handing back a value.`, concept: "return" };
  }
  return {
    text: `${event.function}() hands back ${showValue(event.return_value, event.heap)}.`,
    concept: "return",
  };
}

function explainEvent(event, trace, index, source) {
  switch (event.event) {
    case "call":
      return explainCall(event, source);
    case "line":
      return explainLine(event, trace, index, source);
    case "return":
      return explainReturn(event);
    case "exception": {
      const type = event.exception?.type ?? "an error";
      const message = event.exception?.message ?? "no message";
      const outcome = getTraceIndex(trace).exceptionOutcome(index);
      if (outcome === "handled") {
        return {
          text: `Python raises ${type}: ${message}. A matching except block catches it, so the program can continue.`,
          concept: "error",
        };
      }
      if (outcome === "propagated") {
        return {
          text: `Python raises ${type}: ${message}. No handler caught it here, so it passes outward to the caller.`,
          concept: "error",
        };
      }
      return {
        text: `Python stops with ${type}: ${message}`,
        concept: "error",
      };
    }
    case "unwind":
      return {
        text: `The error spreads outward, so ${event.function}() stops without finishing its work.`,
        concept: "error",
      };
    case "compare":
      return explainCompare(event);
    case "output": {
      const chunk = String(event.text ?? "");
      const printed = short(
        getTraceIndex(trace).printedLineAt(index)?.text ?? event.text.replace(/\n$/, ""),
      );
      if (/^\n+$/.test(chunk)) {
        return {
          text: printed
            ? `This finishes the printed line: ${printed}`
            : "This finishes a blank line.",
          concept: "print",
        };
      }
      return {
        text: printed ? `The program prints: ${printed}` : "The program prints a blank line.",
        concept: "print",
      };
    }
    case "input":
      return {
        text: event.prompt
          ? `You are asked "${event.prompt}" and type ${short(event.text)}.`
          : `You type ${short(event.text)}.`,
        concept: "input",
      };
    case "step_limit":
      return {
        text: "The program took too many steps and was stopped — it is probably stuck in an endless loop.",
        concept: "stopped",
      };
    case "timeout":
      return { text: "The program ran too long and was stopped.", concept: "stopped" };
    case "output_limit":
      return { text: "The program printed too much and was stopped.", concept: "stopped" };
    case "error":
      return {
        text: `The program could not run: ${event.type ?? "error"} — ${event.message ?? ""}`.trim(),
        concept: "error",
      };
    default:
      return { text: `Step ${index + 1}.`, concept: null };
  }
}

/**
 * One comparison, in the trace's own words: the two values, the operator, and
 * the outcome the comparison really produced. When the trace recorded no plain
 * True or False (a custom comparison returning something else, or one that
 * raised) the sentence says so rather than guessing an answer.
 */
function explainCompare(event) {
  const left = short(showValue(event.operands?.[0]?.value, event.heap));
  const right = short(showValue(event.operands?.[1]?.value, event.heap));
  const pair = `${left} ${event.operator ?? "?"} ${right}`;
  if (event.result === true || event.result === false) {
    return {
      text: `Python compares ${pair} and gets ${event.result ? "True" : "False"}.`,
      concept: "condition",
    };
  }
  return {
    text: `Python compares ${pair}, and the comparison gives no plain True or False to record.`,
    concept: "condition",
  };
}

/**
 * Explains one step of a run.
 * @param {Array} trace the trace array from docs/trace-format.md
 * @param {number} index which step to explain
 * @param {string} source the user's code, used to read line text
 * @returns {{ text: string, concept: string | null }}
 */
export function explainStep(trace, index, source = "") {
  const event = trace[index];
  if (!event) return { text: "Run your code to see what happens, step by step.", concept: null };
  try {
    return explainEvent(event, trace, index, source);
  } catch {
    return { text: "This step ran, but no explanation is available for it yet.", concept: null };
  }
}

/** The concept of the current step, or null. */
export function conceptAt(trace, index, source = "") {
  return explainStep(trace, index, source).concept;
}

/** First step at which each concept appears, per trace and source. */
const CONCEPT_FIRST = new WeakMap();

function firstConceptSteps(trace, source) {
  const cached = CONCEPT_FIRST.get(trace);
  if (cached && cached.source === source) return cached.first;
  const first = new Map();
  for (let i = 0; i < trace.length; i += 1) {
    const concept = explainStep(trace, i, source).concept;
    if (concept && !first.has(concept)) first.set(concept, i);
  }
  CONCEPT_FIRST.set(trace, { source, first });
  return first;
}

/** True when `concept` has not appeared in any step before `index`. */
export function isNewConcept(trace, index, source, concept) {
  if (!concept) return false;
  const list = Array.isArray(trace) ? trace : [];
  if (list.length === 0) return true;
  const first = firstConceptSteps(list, source);
  const at = first.get(concept);
  return at === undefined || at >= index;
}

// --- Why did execution come here? -------------------------------------------
// The panels answer "why is this line running now?" from the jump between the
// previous step that moved control and this one, so the answer comes from the
// recorded trace and can never contradict it.

/** Index of the nearest earlier step that moved control, or -1. */
function previousAnchorIndex(trace, index) {
  return getTraceIndex(trace).previousAnchorIndex(index);
}

/** Index of the nearest earlier step in one frame, or -1. */
function previousInFrameIndex(trace, index, frameId) {
  return getTraceIndex(trace).previousAnchorInFrame(index, frameId);
}

/**
 * One plain sentence for why control is at this step: the branch that was
 * decided, the loop that came round, or the call that just started or returned.
 * @returns {string | null}
 */
export function explainTransition(trace, index, source = "") {
  const event = trace[index];
  if (!event) return null;

  if (event.event === "line") {
    const anchorIndex = previousAnchorIndex(trace, index);
    const anchor = anchorIndex >= 0 ? trace[anchorIndex] : null;
    if (anchor?.event === "call" && anchor.frame_id === event.frame_id) {
      if (event.function === "<module>") return "The program starts and runs this first line.";
      return `${event.function}() was just called, so its first line runs now.`;
    }
    if (anchor?.event === "return" || anchor?.event === "unwind") {
      if (anchor.function === "<module>") return "The program's last line finished.";
      return `The call to ${anchor.function}() finished, so the ${event.function}() code carries on here.`;
    }
    const sameIndex = previousInFrameIndex(trace, index, event.frame_id);
    if (sameIndex < 0) return "This is the first line that runs.";
    const same = trace[sameIndex];
    if (same.line === event.line) {
      // Something on this very line called out and has come back: the line
      // never stopped running, so say that rather than nothing at all.
      return `Line ${event.line} is still running: the value it called for has come back.`;
    }
    if (same.line > event.line) {
      const loopLine = sourceLine(source, event.line).text;
      if (/^for\b/.test(loopLine)) {
        return `The loop body finished, so Python returned to line ${event.line} to look for the next item.`;
      }
      if (/^while\b/.test(loopLine)) {
        return `The loop body finished, so Python returned to line ${event.line} to check the condition again.`;
      }
      return `The loop body finished, so Python jumped back up to line ${event.line} for the next round.`;
    }
    if (same.line + 1 === event.line) {
      return "The previous line finished, so Python moved on to the next line.";
    }
    // A jump forward over one or more lines: the previous line's own rule
    // already names the decision that sent us here.
    return explainStep(trace, sameIndex, source).text;
  }

  if (event.event === "call") {
    if (event.function === "<module>") return "This is where the program starts.";
    const frame = event.frames?.[event.frames.length - 1];
    const at = frame?.call_line;
    return at != null
      ? `line ${at} calls ${event.function}(), so Python starts that function here.`
      : `${event.function}() is called, so Python starts that function here.`;
  }

  if (event.event === "return") {
    if (event.function === "<module>") return "The last line finished, so the program ends.";
    return `${event.function}() reached a return, so its result goes back and the caller carries on.`;
  }

  // A comparison is part of the line above it that is still running: the line
  // event was recorded first, then this value-level step inside it.
  if (event.event === "compare") {
    return event.line != null
      ? `Line ${event.line} is still running: Python works out this comparison before it decides what to do next.`
      : "Python works out a comparison here before it carries on.";
  }

  // From here on there is no branch to explain — control is here because the
  // line printed, asked, failed or was stopped. Say which, in plain words.
  if (event.event === "output") {
    const chunk = String(event.text ?? "");
    const printed = short(getTraceIndex(trace).printedLineAt(index)?.text ?? "");
    if (/^\n+$/.test(chunk)) {
      return printed ? `This finishes the printed line: ${printed}.` : "This finishes a blank line.";
    }
    return printed
      ? `Line ${event.line ?? "?"} prints ${printed}, so this text appears now.`
      : "The program prints this text, then carries on.";
  }
  if (event.event === "input") {
    return `Line ${event.line ?? "?"} asked for a value, so the program waits for it here.`;
  }
  if (event.event === "exception") {
    const type = event.exception?.type ?? "an error";
    return event.line != null
      ? `Line ${event.line} raised ${type}, so control leaves that line here.`
      : `${type} was raised, so control leaves this line here.`;
  }
  if (event.event === "unwind") {
    return event.function === "<module>"
      ? "The error reached the end of the program, so the run stops."
      : `The error passed out of ${event.function}(), so that frame closes without a result.`;
  }
  if (event.event === "error") {
    return event.phase === "parse"
      ? "Python rejected the code before anything ran, so this is where the program ends."
      : "The run ended with this error, so nothing after it happened.";
  }
  if (event.event === "step_limit") {
    return `The run reached its limit of ${event.limit ?? "the"} steps, so tracing stopped here.`;
  }
  if (event.event === "timeout") {
    return "The run reached its time limit, so tracing stopped here.";
  }
  if (event.event === "output_limit") {
    return `The run reached its limit of ${event.limit ?? "the"} printed characters, so tracing stopped here.`;
  }

  return null;
}

/**
 * The explanation card's reading of one step, in three labelled parts:
 * what the previous step did, what the highlighted line is about to do, and
 * why control came here. This is the single wording behind the card, tested as
 * a unit so the panels can never disagree about the same step.
 * @returns {{ justHappened: string|null, aboutToHappen: string, why: string|null, concept: string|null }}
 */
export function explainStepView(trace, index, source = "") {
  const event = trace[index];
  if (!event) {
    return {
      justHappened: null,
      aboutToHappen: "Run your code to see what happens, step by step.",
      why: null,
      concept: null,
    };
  }
  const about = explainStep(trace, index, source);
  return {
    justHappened: justHappened(trace, index, source),
    aboutToHappen: about.text,
    why: explainTransition(trace, index, source),
    concept: about.concept,
  };
}

// --- Statement kinds and short actions ---------------------------------------
// The execution graph labels every node with a *short* verb phrase — "Set total",
// "Call fact(4)", "Check n <= 1" — where the explanation card writes a whole
// sentence. The label comes from the event type plus the kind of statement the
// source line is, never from what the program is "about", so it works for any
// program. Every rule has a fallback: an unknown line still gets a real label
// (its own opening words), and nothing here throws.

/** The kinds a line can be. Every one has an action rule (or falls back). */
export const STATEMENT_KINDS = [
  "def",
  "async-def",
  "decorator",
  "class",
  "import",
  "if",
  "elif",
  "else",
  "for",
  "while",
  "return",
  "yield",
  "break",
  "continue",
  "pass",
  "del",
  "raise",
  "try",
  "except",
  "finally",
  "with",
  "async-with",
  "global",
  "nonlocal",
  "assert",
  "match",
  "case",
  "await",
  "augmented",
  "item-assign",
  "attr-assign",
  "assign",
  "print",
  "lambda",
  "expression",
  "other",
];

const KIND_RULES = [
  [/^async\s+def\b/, "async-def"],
  [/^@/, "decorator"],
  [/^def\b/, "def"],
  [/^class\b/, "class"],
  [/^(?:from\s+[\w.]+\s+)?import\b/, "import"],
  [/^elif\b/, "elif"],
  [/^if\b/, "if"],
  [/^else\b/, "else"],
  [/^for\b/, "for"],
  [/^while\b/, "while"],
  [/^return\b/, "return"],
  [/^yield\b/, "yield"],
  [/^break\b/, "break"],
  [/^continue\b/, "continue"],
  [/^pass\b/, "pass"],
  [/^del\b/, "del"],
  [/^raise\b/, "raise"],
  [/^try\b/, "try"],
  [/^except\b/, "except"],
  [/^finally\b/, "finally"],
  [/^async\s+with\b/, "async-with"],
  [/^with\b/, "with"],
  [/^global\b/, "global"],
  [/^nonlocal\b/, "nonlocal"],
  [/^assert\b/, "assert"],
  [/^match\b/, "match"],
  [/^case\b/, "case"],
  [/^await\b/, "await"],
  [/^lambda\b/, "lambda"],
];

/** The bare name a statement defines or targets, when there is one. */
function nameIn(text, re) {
  return text.match(re)?.[1] ?? null;
}

/**
 * The kind of statement a line is, from its text alone. Used to pick the short
 * action label and the "not supported yet" note; unknown lines are "other".
 * @param {string} text the trimmed source line
 * @returns {string} one of STATEMENT_KINDS
 */
/**
 * True when a 1-based line starts inside a bracket opened on an earlier line.
 * That makes the line part of one expression, not a statement of its own.
 * Brackets inside strings and comments are ignored.
 */
export function insideOpenBracket(source, line) {
  const lines = String(source ?? "").split("\n");
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = 0; i < Math.min(line - 1, lines.length); i += 1) {
    const text = lines[i];
    for (let j = 0; j < text.length; j += 1) {
      const char = text[j];
      if (quote) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (quote.length === 3 ? text.startsWith(quote, j) : char === quote) {
          if (quote.length === 3) j += 2;
          quote = null;
        }
        continue;
      }
      if (char === "#") break;
      if (char === "'" || char === '"') {
        const triple = text.startsWith(char.repeat(3), j);
        quote = triple ? char.repeat(3) : char;
        if (triple) j += 2;
      } else if (char === "(" || char === "[" || char === "{") {
        depth += 1;
      } else if (char === ")" || char === "]" || char === "}") {
        depth = Math.max(0, depth - 1);
      }
    }
    if (quote && quote.length === 1) quote = null; // no single-line string crosses a newline
    escaped = false;
  }
  return depth > 0;
}

export function statementKind(text) {
  const line = String(text ?? "").trim();
  if (!line) return "other";
  for (const [re, kind] of KIND_RULES) {
    if (re.test(line)) return kind;
  }
  if (/^\w+\s*(\*\*|[-+*/%])=(?!=)/.test(line)) return "augmented";
  // Annotated assignment (x: int = 1) and plain assignment, including tuples.
  if (/^[\w.]+(?:\[[^\]]*\])?\s*:\s*[^=]+=[^=]/.test(line)) return "assign";
  if (/^(?:\w+|\([^)]*\))(?:\s*\[[^\]]*\])?(?:\s*\.\s*\w+|\s*\[[^\]]*\])*\s*=(?!=)/.test(line)) {
    if (/^\w+\s*\.\s*\w+\s*=(?!=)/.test(line)) return "attr-assign";
    if (/^\w+\s*\[/.test(line)) return "item-assign";
    return "assign";
  }
  // Several targets at once (a, b = 1, 2  /  x[0], x[1] = x[1], x[0]).
  if (/^[^()=]+(?:,\s*[^()=]+)+\s*=(?!=)/.test(line)) return "assign";
  if (/^print\s*\(/.test(line)) return "print";
  if (/^[\w.]+\s*\(.*\)\s*$/.test(line)) return "expression";
  return "other";
}

/** Cuts a label to `max` characters, on a word boundary when there is one. */
function brief(text, max = 34) {
  const value = String(text ?? "").replace(/\s+/g, " ").trim();
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** A short verb phrase for a line, from its statement kind. */
function actionForLine(text, kind) {
  switch (kind) {
    case "def":
      return `Define ${nameIn(text, /^def\s+(\w+)/) ?? "a function"}()`;
    case "async-def":
      return `Define async ${nameIn(text, /^async\s+def\s+(\w+)/) ?? "function"}()`;
    case "decorator":
      return `Decorate the function below`;
    case "class":
      return `Define class ${nameIn(text, /^class\s+(\w+)/) ?? ""}`.trim();
    case "import": {
      const from = text.match(/^from\s+([\w.]+)/)?.[1];
      const what = text.match(/^import\s+([\w.]+)/)?.[1];
      return `Import ${from ?? what ?? "a module"}`;
    }
    case "if":
    case "elif":
      return `Check ${brief(text.replace(/^(?:el)?if\s+/, "").replace(/:\s*$/, ""), 30)}`;
    case "else":
      return "Take the other branch";
    case "for": {
      const target = text.match(/^for\s+(.+?)\s+in\s+/)?.[1] ?? "each item";
      return `Loop over ${brief(target, 24)}`;
    }
    case "while":
      return `Check the loop condition`;
    case "return": {
      const value = text.match(/^return(?:\s+(.+))?$/)?.[1];
      return value ? `Return ${brief(value, 26)}` : "Return, with no value";
    }
    case "yield":
      return "Produce the next value";
    case "break":
      return "Break out of the loop";
    case "continue":
      return "Skip to the next round";
    case "pass":
      return "Do nothing here";
    case "del":
      return `Delete ${nameIn(text, /^del\s+([\w.]+)/) ?? "a name"}`;
    case "raise":
      return "Raise an error";
    case "try":
      return "Try these lines";
    case "except":
      return "Handle the error";
    case "finally":
      return "Run the cleanup";
    case "with":
    case "async-with":
      return `Open ${brief(nameIn(text, /^(?:async\s+)?with\s+([\w.]+)/) ?? "a resource", 26)}`;
    case "global":
      return `Use the global ${brief(text.replace(/^global\s+/, ""), 20)}`;
    case "nonlocal":
      return `Use the outer ${brief(text.replace(/^nonlocal\s+/, ""), 20)}`;
    case "assert":
      return `Check ${brief(text.replace(/^assert\s+/, ""), 28)}`;
    case "match":
      return `Match ${brief(text.replace(/^match\s+/, "").replace(/:\s*$/, ""), 24)}`;
    case "case":
      return "Match this case";
    case "await":
      return `Wait for ${brief(text.replace(/^await\s+/, ""), 24)}`;
    case "lambda":
      return "Define a small function";
    case "augmented":
      return brief(text.replace(/:\s*$/, ""), 30);
    case "assign": {
      const left = text.split("=")[0].trim();
      const names = left.split(",").map((part) => part.trim()).filter(Boolean);
      if (names.length > 1) return `Set ${brief(names.join(", "), 26)}`;
      return `Set ${brief(left, 26)}`;
    }
    case "item-assign":
      return `Change one item in ${nameIn(text, /^(\w+)/) ?? "the data"}`;
    case "attr-assign":
      return `Set ${brief(text.split("=")[0].trim(), 26)}`;
    case "print":
      return "Print to the screen";
    case "expression":
      return `Call ${brief(nameIn(text, /^([\w.]+)\s*\(/) ?? "a function", 26)}()`;
    default:
      return `Run ${brief(text, 30)}`;
  }
}

/**
 * The short label an execution-graph node carries: a verb phrase such as
 * "Set total", "Call fact(4)" or "Check n <= 1". Derived from the event type
 * and the statement kind only — never from an example's names.
 * @returns {string}
 */
export function explainAction(event, trace, index, source = "") {
  try {
    if (!event) return "Start of the run";
    switch (event.event) {
      case "call":
        return event.function === "<module>"
          ? "Start the program"
          : `Call ${event.function}()`;
      case "return":
        return event.function === "<module>" ? "Finish the program" : `${event.function}() returns`;
      case "line": {
        const { text } = sourceLine(source, event.line);
        if (!text) return "Move on to the next line";
        return actionForLine(text, statementKind(text));
      }
      case "exception":
        return `Stop: ${event.exception?.type ?? "error"}`;
      case "unwind":
        return `${event.function ?? "This call"}() stops early`;
      case "output":
        return "Print to the screen";
      case "input":
        return "Read what was typed";
      case "error":
        return "The program could not run";
      case "step_limit":
      case "timeout":
      case "output_limit":
        return "Stopped to stay safe";
      default:
        return `Step ${index + 1}`;
    }
  } catch {
    return "Run this step";
  }
}

/**
 * What the step before this one actually did. A line that is still running —
 * because it called a function — must not be described as finished, so calls
 * and returns get their own wording instead of the line rule's prediction.
 */
function justHappened(trace, index, source) {
  if (index <= 0) return null;
  const event = trace[index];
  const previous = trace[index - 1];
  if (event.event === "step_limit") {
    return "The run hit the step limit before the next line, so it stopped here.";
  }
  if (event.event === "timeout") {
    return "The run hit the time limit before the next step, so it stopped here.";
  }
  if (event.event === "output_limit") {
    return "The output was cut off at the character limit, so the run stopped here.";
  }
  if (event.event === "call" && event.function !== "<module>") {
    const frame = event.frames?.[event.frames.length - 1];
    const at = frame?.call_line;
    return at != null ? `line ${at} called ${event.function}().` : `${event.function}() was called.`;
  }
  if (
    event.event === "return" &&
    event.function !== "<module>" &&
    previous?.event === "line" &&
    event.return_value
  ) {
    return `line ${previous.line} handed back ${showValue(event.return_value, event.heap)} from ${event.function}().`;
  }
  if (event.event === "exception" && previous?.event === "line") {
    const outcome = getTraceIndex(trace).exceptionOutcome(index);
    const type = event.exception?.type ?? "an exception";
    if (outcome === "handled") {
      return `line ${previous.line} raised ${type}, and a matching except block caught it.`;
    }
    if (outcome === "propagated") {
      return `line ${previous.line} raised ${type}, and it passed outward to the caller.`;
    }
    // The line is highlighted *and* just started: it did not finish its work.
    return `line ${previous.line} started running, and this is where it stopped.`;
  }
  return explainStep(trace, index - 1, source).text;
}
