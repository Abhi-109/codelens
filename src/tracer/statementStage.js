// The statement-level model behind the Adaptive canvas for ordinary Python
// steps: assignments, conditions and loops. It is built from the selected
// StepView, the source, and the real trace. The validator rebuilds it from the
// same inputs, so a renderer cannot show a branch, value or destination the
// trace did not record.
//
// The model is intentionally small. A condition's outcome comes from the next
// line event the trace actually ran; a for-loop's next item comes from the next
// recorded state; a print's text comes from the recorded output. Nothing here
// evaluates user code on its own.

import { blockEnd, insideOpenBracket, statementKind, substituteVars } from "./explain.js";
import { getTraceIndex } from "./traceIndex.js";
import { showValue } from "./values.js";

export const STATEMENT_STAGE_KINDS = Object.freeze([
  "branch",
  "loop",
  "assignment",
  "print",
  "output",
  "input",
  "call",
  "return",
  "complete",
  "error",
  "step",
]);

const KEYWORDS = new Set([
  "False",
  "None",
  "True",
  "and",
  "as",
  "assert",
  "break",
  "class",
  "continue",
  "def",
  "del",
  "elif",
  "else",
  "except",
  "finally",
  "for",
  "from",
  "global",
  "if",
  "import",
  "in",
  "is",
  "lambda",
  "nonlocal",
  "not",
  "or",
  "pass",
  "raise",
  "return",
  "try",
  "while",
  "with",
  "yield",
]);

const MAX_VALUES = 6;
const MAX_BODY_LINES = 3;

const STEP_LABELS = Object.freeze({
  def: "Function definition",
  "async-def": "Function definition",
  decorator: "Decorator",
  class: "Class definition",
  import: "Import",
  try: "Try block",
  except: "Exception handler",
  finally: "Cleanup block",
  with: "Context block",
  "async-with": "Context block",
  break: "Break",
  continue: "Continue",
  pass: "Pass",
  del: "Deletion",
  global: "Scope declaration",
  nonlocal: "Scope declaration",
  assert: "Assertion",
  yield: "Yield",
  match: "Match",
  case: "Case",
  await: "Await",
  lambda: "Lambda",
  expression: "Function call",
});

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isString(value) {
  return typeof value === "string";
}

function linesOf(source) {
  return isString(source) ? source.split("\n") : [];
}

function lineInfo(source, line) {
  const raw = linesOf(source)[line - 1] ?? "";
  const text = raw.trim();
  return { text, indent: raw.length - raw.trimStart().length };
}

function isCodeLine(text) {
  return text.length > 0 && !text.startsWith("#");
}

/** The first code line at or after a 1-based line number, or null. */
function firstCodeLine(source, from) {
  const lines = linesOf(source);
  for (let line = from; line <= lines.length; line += 1) {
    const { text } = lineInfo(source, line);
    if (isCodeLine(text)) return line;
  }
  return null;
}

function topFrame(state) {
  const frames = Array.isArray(state?.frames) ? state.frames : [];
  return frames.length > 0 ? frames[frames.length - 1] : null;
}

function frameIn(state, frameId) {
  const frames = Array.isArray(state?.frames) ? state.frames : [];
  return frames.find((frame) => frame.frame_id === frameId) ?? topFrame(state);
}

function variablesOf(view) {
  return frameIn(view?.before, view?.frameId ?? view?.frame?.frameId ?? null)?.variables ?? {};
}

function heapOf(view) {
  return isObject(view?.before?.heap) ? view.before.heap : isObject(view?.heap) ? view.heap : {};
}

function valueText(value, heap) {
  return showValue(value, heap);
}

function valuesOf(variables, heap, names) {
  const seen = new Set();
  const values = [];
  for (const name of names) {
    if (!isString(name) || seen.has(name) || !(name in variables)) continue;
    seen.add(name);
    values.push({ name, text: valueText(variables[name], heap) });
    if (values.length >= MAX_VALUES) break;
  }
  return values;
}

function namesIn(expression, variables) {
  if (!isString(expression)) return [];
  return [...new Set(expression.match(/[A-Za-z_]\w*/g) ?? [])].filter(
    (name) => !KEYWORDS.has(name) && name in variables,
  );
}

function changesOf(view) {
  return (view?.changes ?? []).map((change) => ({
    name: change.name,
    changeKind: change.kind,
    from: change.from ?? null,
    to: change.to ?? null,
    line: change.line ?? null,
  }));
}

function visits(trace, index, line, frameId) {
  let count = 0;
  for (let i = 0; i <= index && i < trace.length; i += 1) {
    const event = trace[i];
    if (event?.event === "line" && event.line === line && event.frame_id === frameId) count += 1;
  }
  return count;
}

/** The nearest for/while header that encloses a line, or null. */
function enclosingLoop(source, line) {
  if (!Number.isInteger(line)) return null;
  const { indent } = lineInfo(source, line);
  for (let candidate = line - 1; candidate >= 1; candidate -= 1) {
    const info = lineInfo(source, candidate);
    if (!isCodeLine(info.text)) continue;
    if (info.indent < indent) {
      if (/^(for|while)\b/.test(info.text)) {
        return {
          line: candidate,
          loopKind: info.text.startsWith("for") ? "for" : "while",
          statement: info.text,
        };
      }
      return null;
    }
  }
  return null;
}

function loopContextFor(view, source, trace) {
  const header = enclosingLoop(source, view?.line);
  if (!header || header.line === view.line) return null;
  return {
    line: header.line,
    loopKind: header.loopKind,
    statement: header.statement,
    iteration: visits(trace, view.index, header.line, view.frameId),
  };
}

function bodyOf(source, line, end) {
  const items = [];
  let total = 0;
  for (let candidate = line + 1; candidate <= end; candidate += 1) {
    const info = lineInfo(source, candidate);
    if (!isCodeLine(info.text)) continue;
    total += 1;
    if (items.length < MAX_BODY_LINES) items.push({ line: candidate, text: info.text });
  }
  return { body: items, bodyMore: Math.max(0, total - items.length) };
}

function branchStart(source, currentLine, indent) {
  let start = currentLine;
  for (let line = currentLine - 1; line >= 1; line -= 1) {
    const info = lineInfo(source, line);
    if (!isCodeLine(info.text)) continue;
    if (info.indent < indent) break;
    if (info.indent === indent && /^(?:if|elif)\b/.test(info.text)) start = line;
  }
  return start;
}

function branchChain(source, start, indent) {
  const nodes = [];
  let line = start;
  while (line != null) {
    const info = lineInfo(source, line);
    const kind = /^if\b/.test(info.text)
      ? "if"
      : /^elif\b/.test(info.text)
        ? "elif"
        : /^else\b/.test(info.text)
          ? "else"
          : null;
    if (!kind) break;
    const end = blockEnd(source, line, indent);
    nodes.push({ line, kind, text: info.text, end });
    const next = firstCodeLine(source, end + 1);
    if (next == null) break;
    const nextInfo = lineInfo(source, next);
    if (nextInfo.indent !== indent || !/^(?:elif|else)\b/.test(nextInfo.text)) break;
    line = next;
  }
  return nodes;
}

function expressionOf(text) {
  const match = String(text ?? "").match(/^(?:el)?if\s+(.+):$/);
  return match?.[1] ?? null;
}

function branchStage(view, source, trace, traceIndex) {
  const info = lineInfo(source, view.line);
  const start = /^if\b/.test(info.text)
    ? view.line
    : branchStart(source, view.line, info.indent);
  const nodes = branchChain(source, start, info.indent);
  const current = nodes.find((node) => node.line === view.line) ?? null;
  if (!current) return null;

  const nodeLines = new Set(nodes.map((node) => node.line));
  const latest = new Map();
  for (let i = 0; i <= view.index && i < trace.length; i += 1) {
    const event = trace[i];
    if (
      event?.event === "line" &&
      event.frame_id === view.frameId &&
      nodeLines.has(event.line)
    ) {
      latest.set(event.line, i);
    }
  }

  const observed = new Map();
  for (const node of nodes) {
    const eventIndex = latest.get(node.line);
    if (eventIndex === undefined) continue;
    const next = traceIndex.nextLineEvent(eventIndex);
    const inBody = Boolean(next && next.line >= node.line && next.line <= node.end);
    observed.set(node.line, {
      eventIndex,
      outcome: node.kind === "else" ? "else" : inBody ? "true" : "false",
    });
  }

  let lastTrue = -1;
  for (let i = 0; i < nodes.length; i += 1) {
    const seen = observed.get(nodes[i].line);
    if (seen && seen.outcome !== "false") lastTrue = i;
  }

  const nextLine = traceIndex.nextLineEvent(view.index)?.line ?? null;
  const nextNode = nodes.findIndex((node) => node.line === nextLine);
  const shown = new Map();
  for (const node of nodes) {
    const seen = observed.get(node.line);
    if (!seen) continue;
    shown.set(node.line, {
      state: seen.eventIndex === view.index ? "current" : "checked",
      outcome: seen.outcome,
    });
  }
  if (lastTrue >= 0) {
    for (let i = lastTrue + 1; i < nodes.length; i += 1) {
      if (!shown.has(nodes[i].line)) shown.set(nodes[i].line, { state: "unreached", outcome: null });
    }
  } else if (nextNode >= 0 && !shown.has(nodes[nextNode].line)) {
    shown.set(nodes[nextNode].line, { state: "next", outcome: null });
  }

  const variables = variablesOf(view);
  const heap = heapOf(view);
  const branches = nodes
    .filter((node) => shown.has(node.line))
    .map((node) => {
      const status = shown.get(node.line);
      const body = bodyOf(source, node.line, node.end);
      return {
        line: node.line,
        kind: node.kind,
        text: node.text,
        expression: node.kind === "else" ? null : expressionOf(node.text),
        display:
          node.kind === "else" || expressionOf(node.text) == null
            ? null
            : substituteVars(expressionOf(node.text), variables, heap),
        outcome: status.outcome,
        state: status.state,
        body: body.body,
        bodyMore: body.bodyMore,
        bodyState:
          status.outcome === "true" || status.outcome === "else"
            ? "taken"
            : status.outcome === "false"
              ? "skipped"
              : status.state,
      };
    });

  const currentStatus = shown.get(current.line);
  const expression = expressionOf(current.text);
  return {
    kind: "branch",
    label: "Condition",
    line: view.line,
    statement: current.text,
    expression,
    display: expression == null ? null : substituteVars(expression, variables, heap),
    outcome: currentStatus?.outcome ?? null,
    branches,
    iteration: null,
    loopKind: null,
    loopTarget: null,
    nextValue: null,
    nextLine,
    body: [],
    bodyMore: 0,
    values: expression == null ? [] : valuesOf(variables, heap, namesIn(expression, variables)),
    changes: [],
    printed: null,
    functionName: view.function ?? null,
    args: [],
    returnValue: null,
    error: null,
    loopContext: loopContextFor(view, source, trace),
  };
}

function loopStage(view, source, trace, traceIndex) {
  const info = lineInfo(source, view.line);
  const next = traceIndex.nextLineEvent(view.index);
  const end = blockEnd(source, view.line, info.indent);
  const inBody = Boolean(next && next.line >= view.line && next.line <= end);
  const after = traceIndex.nextState(view.index);
  const afterVars = frameIn(after, view.frameId)?.variables ?? {};
  const afterHeap = isObject(after?.heap) ? after.heap : {};
  const variables = variablesOf(view);
  const heap = heapOf(view);
  const body = bodyOf(source, view.line, end);
  const forMatch = info.text.match(/^for\s+([A-Za-z_]\w*)\s+in\s+(.+):$/);
  const whileMatch = info.text.match(/^while\s+(.+):$/);
  const target = forMatch?.[1] ?? null;
  const expression = forMatch?.[2] ?? whileMatch?.[1] ?? null;
  const nextValue =
    forMatch && inBody && target && target in afterVars
      ? valueText(afterVars[target], afterHeap)
      : null;

  return {
    kind: "loop",
    label: "Loop",
    line: view.line,
    statement: info.text,
    expression,
    display: expression == null ? null : substituteVars(expression, variables, heap),
    outcome: next == null ? null : forMatch ? (inBody ? "true" : "false") : inBody ? "true" : "false",
    branches: [],
    iteration: visits(trace, view.index, view.line, view.frameId),
    loopKind: forMatch ? "for" : whileMatch ? "while" : null,
    loopTarget: target,
    nextValue,
    nextLine: next?.line ?? null,
    body: body.body,
    bodyMore: body.bodyMore,
    values: valuesOf(variables, heap, Object.keys(variables)),
    changes: [],
    printed: null,
    functionName: view.function ?? null,
    args: [],
    returnValue: null,
    error: null,
    loopContext: null,
  };
}

function stepLabel(text) {
  return STEP_LABELS[statementKind(text)] ?? "Step";
}

function baseStage(view, traceIndex, kind, label, statement) {
  return {
    kind,
    label,
    line: view.line ?? null,
    statement: statement ?? view.code?.text ?? null,
    expression: null,
    display: null,
    outcome: null,
    branches: [],
    iteration: null,
    loopKind: null,
    loopTarget: null,
    nextValue: null,
    nextLine: traceIndex.nextLineEvent(view.index)?.line ?? null,
    body: [],
    bodyMore: 0,
    values: [],
    changes: [],
    printed: null,
    functionName: view.function ?? null,
    args: [],
    returnValue: null,
    error: null,
    loopContext: null,
    note: null,
  };
}

function assignmentStage(view, source, trace, traceIndex) {
  const stage = baseStage(view, traceIndex, "assignment", "Assignment", view.code?.text ?? null);
  stage.changes = changesOf(view);
  stage.loopContext = loopContextFor(view, source, trace);
  if (stage.changes.length === 0 || statementKind(stage.statement) !== "assign") {
    stage.label = "Value change";
  }
  return stage;
}

function printStage(view, source, trace, traceIndex) {
  const stage = baseStage(view, traceIndex, "print", "Output", view.code?.text ?? null);
  const produced =
    view.kind === "output" || traceIndex.printedRawAfter(view.index).length > 0;
  const printed =
    view.kind === "output"
      ? traceIndex.printedLineAt(view.index)?.text ?? ""
      : traceIndex.printedRawAfter(view.index).replace(/\n$/, "");
  stage.printed = produced ? printed : null;
  stage.loopContext = loopContextFor(view, source, trace);
  return stage;
}

function callStage(view, traceIndex) {
  const stage = baseStage(
    view,
    traceIndex,
    "call",
    view.function === "<module>" ? "Program starts" : "Function call",
    view.code?.text ?? null,
  );
  stage.args = (view.frame?.variables ?? [])
    .filter((variable) => variable.isArg)
    .map((variable) => ({ name: variable.name, text: variable.text }));
  return stage;
}

function returnStage(view, traceIndex) {
  const stage = baseStage(view, traceIndex, "return", "Return", view.code?.text ?? null);
  stage.returnValue = view.returnValue ?? null;
  return stage;
}

// The module frame "returns" None when Python finishes. That is a fact about
// Python, not a result of the learner's program, so completion gets its own
// stage rather than looking like a function handing back None.
function completionStage(view, traceIndex) {
  const stage = baseStage(view, traceIndex, "complete", "Program finished", null);
  stage.statement = null;
  return stage;
}

function errorStage(view, traceIndex) {
  const stage = baseStage(view, traceIndex, "error", "Error", view.code?.text ?? null);
  const exception = view.event?.exception;
  stage.error = isObject(exception)
    ? { type: String(exception.type ?? "Error"), message: String(exception.message ?? "") }
    : {
        type: String(view.event?.type ?? view.event?.event ?? "error"),
        message: String(view.event?.message ?? ""),
      };
  return stage;
}

/**
 * Build the statement stage for the selected StepView.
 *
 * @param {{stepView?: Object, trace?: Array, traceIndex?: Object, source?: string}} context
 * @returns {Object|null}
 */
export function buildStatementStage(context = {}) {
  const view = isObject(context.stepView) ? context.stepView : null;
  if (!view || !isObject(view.event)) return null;
  const trace = Array.isArray(context.trace) ? context.trace : [];
  const traceIndex = isObject(context.traceIndex) ? context.traceIndex : getTraceIndex(trace);
  const source = isString(context.source) ? context.source : "";
  const event = view.event;

  if (event.event === "output") return printStage(view, source, trace, traceIndex);
  if (event.event === "input") {
    const stage = baseStage(view, traceIndex, "input", "Input", view.code?.text ?? null);
    stage.printed = String(event.text ?? "") || null;
    return stage;
  }
  if (event.event === "call") return callStage(view, traceIndex);
  if (event.event === "return") {
    return event.function === "<module>"
      ? completionStage(view, traceIndex)
      : returnStage(view, traceIndex);
  }
  if (event.event === "exception" || event.event === "unwind" || event.event === "error") {
    return errorStage(view, traceIndex);
  }
  if (event.event !== "line") {
    const stopped = ["step_limit", "timeout", "output_limit"].includes(event.event);
    const stage = baseStage(
      view,
      traceIndex,
      "step",
      stopped ? "Stopped" : "Step",
      stopped ? null : view.code?.text ?? null,
    );
    stage.loopContext = loopContextFor(view, source, trace);
    return stage;
  }
  if (event.line === 0) {
    const stage = baseStage(view, traceIndex, "step", "Empty program", null);
    stage.note = "There are no statements to run.";
    return stage;
  }

  const info = lineInfo(source, view.line);
  if (/^(?:if|elif)\b/.test(info.text)) {
    return branchStage(view, source, trace, traceIndex);
  }
  if (/^else\b/.test(info.text)) {
    const start = branchStart(source, view.line, info.indent);
    const chain = branchChain(source, start, info.indent);
    if (
      chain.some((node) => node.line === view.line) &&
      chain.some((node) => node.kind === "if" || node.kind === "elif")
    ) {
      return branchStage(view, source, trace, traceIndex);
    }
  }
  if (/^(?:for|while)\b/.test(info.text)) {
    return loopStage(view, source, trace, traceIndex);
  }
  if (/^print\s*\(/.test(info.text)) {
    return printStage(view, source, trace, traceIndex);
  }
  const kind = statementKind(info.text);
  if (
    ["assign", "augmented", "item-assign", "attr-assign"].includes(kind) ||
    (view.changes ?? []).length > 0
  ) {
    return assignmentStage(view, source, trace, traceIndex);
  }
  if (/^return\b/.test(info.text)) return returnStage(view, traceIndex);
  if (/^raise\b/.test(info.text)) {
    return errorStage(view, traceIndex);
  }

  const stage = baseStage(
    view,
    traceIndex,
    "step",
    insideOpenBracket(source, view.line) ? "Expression" : stepLabel(info.text),
    info.text || null,
  );
  stage.loopContext = loopContextFor(view, source, trace);
  return stage;
}

function same(left, right) {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, i) => same(item, right[i]));
  }
  if (!isObject(left) || !isObject(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => Object.hasOwn(right, key) && same(left[key], right[key]));
}

/**
 * Re-derive the stage from the selected state and compare it field by field.
 * A scene cannot smuggle a made-up branch outcome, value or destination past
 * this check.
 */
export function validateStatementStage(stage, context = {}) {
  if (!isObject(stage)) return { valid: false, errors: ["stage must be an object"] };
  const expected = buildStatementStage(context);
  if (!expected) return { valid: false, errors: ["no statement stage is available for this step"] };
  if (!same(stage, expected)) {
    return { valid: false, errors: ["stage does not match the selected step"] };
  }
  return { valid: true, errors: [] };
}
