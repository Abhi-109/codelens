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
      "A condition is a question with a yes/no answer, like marks >= 90. Python answers True or False and takes the branch that matches.",
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
  for (let i = index + 1; i < trace.length; i += 1) {
    if (trace[i]?.frames) return trace[i];
  }
  return null;
}

/** Has this source line already run in this frame before this step? */
function seenBefore(trace, index, line, frameId) {
  for (let i = 0; i < index; i += 1) {
    const event = trace[i];
    if (event.event === "line" && event.line === line && event.frame_id === frameId) return true;
  }
  return false;
}

function topVariables(state) {
  return state?.frames?.[state.frames.length - 1]?.variables ?? {};
}

function variableShow(variables, heap, name) {
  return showValue(variables[name], heap);
}

/** Substitutes known variable names in a condition, so "marks >= 90" reads "68 >= 90". */
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
  for (let i = index + 1; i < trace.length; i += 1) {
    if (trace[i].event === "line" && trace[i].frames) return trace[i];
  }
  return null;
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
  let out = "";
  for (let i = index + 1; i < trace.length; i += 1) {
    const event = trace[i];
    if (event.event === "line" || event.event === "call" || event.event === "return") break;
    if (event.event === "output") out += event.text;
  }
  return short(out.replace(/\n$/, ""));
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
  if (!text) return { text: "The program moves on.", concept: null };

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

  // Loops.
  match = text.match(/^for\s+([A-Za-z_]\w*)\s+in\s+(.+):$/);
  if (match) {
    const [, name] = match;
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
    if (next && next.line <= end) {
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
    if (next.line <= end) {
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
      text: printed
        ? `This line prints ${printed} on the screen.`
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

  // Assignments.
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
    case "exception":
      return {
        text: `Python stops with ${event.exception?.type ?? "an error"}: ${event.exception?.message ?? "no message"}`,
        concept: "error",
      };
    case "unwind":
      return {
        text: `The error spreads outward, so ${event.function}() stops without finishing its work.`,
        concept: "error",
      };
    case "output": {
      const printed = short(event.text.replace(/\n$/, ""));
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

/** True when `concept` has not appeared in any step before `index`. */
export function isNewConcept(trace, index, source, concept) {
  if (!concept) return false;
  for (let i = 0; i < index; i += 1) {
    if (conceptAt(trace, i, source) === concept) return false;
  }
  return true;
}

// --- Why did execution come here? -------------------------------------------
// The panels answer "why is this line running now?" from the jump between the
// previous step that moved control and this one, so the answer comes from the
// recorded trace and can never contradict it.

const ANCHOR_EVENTS = new Set(["line", "call", "return", "unwind"]);

/** Index of the nearest earlier step that moved control, or -1. */
function previousAnchorIndex(trace, index) {
  for (let i = index - 1; i >= 0; i -= 1) {
    if (ANCHOR_EVENTS.has(trace[i].event)) return i;
  }
  return -1;
}

/** Index of the nearest earlier step in one frame, or -1. */
function previousInFrameIndex(trace, index, frameId) {
  for (let i = index - 1; i >= 0; i -= 1) {
    if (ANCHOR_EVENTS.has(trace[i].event) && trace[i].frame_id === frameId) return i;
  }
  return -1;
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
    if (same.line === event.line) return null;
    if (same.line > event.line) {
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
    if (event.function === "<module>") return null;
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

/**
 * What the step before this one actually did. A line that is still running —
 * because it called a function — must not be described as finished, so calls
 * and returns get their own wording instead of the line rule's prediction.
 */
function justHappened(trace, index, source) {
  if (index <= 0) return null;
  const event = trace[index];
  const previous = trace[index - 1];
  if (event.event === "call" && event.function !== "<module>") {
    const frame = event.frames?.[event.frames.length - 1];
    const at = frame?.call_line;
    return at != null ? `line ${at} called ${event.function}().` : `${event.function}() was called.`;
  }
  if (event.event === "return" && previous?.event === "line" && event.return_value) {
    return `line ${previous.line} handed back ${showValue(event.return_value, event.heap)} from ${event.function}().`;
  }
  return explainStep(trace, index - 1, source).text;
}
