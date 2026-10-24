// Conservative recognition of the statement shapes the animation diff uses.
//
// This module reads *source syntax only*. It says "this statement has the shape
// of a swap" - never "these two cells swapped". Whether the values actually
// moved, and which cells they were, needs the before/after snapshots and is
// diff.js's job. A shape is a hint, and an unknown shape is a normal answer.
//
// The parser is a small hand-written scanner plus a structural pass. It does not
// use a regex to understand nesting, does not evaluate user code, and does not
// treat a token stream it cannot account for as a valid mutation:
//
//   * strings (including prefixes, triple quotes and escapes) and comments are
//     opaque, so `a["]"] = 1`, `a["#"] = 2` and a line that merely *mentions*
//     `a[i], a[j] = a[j], a[i]` inside a string are handled correctly;
//   * split points are chosen by bracket depth, so nested calls, subscripts and
//     parenthesised tuples are not broken apart;
//   * more than one top-level `=`, or any top-level `;`, is ambiguous and is
//     never partially recognized;
//   * a multi-line statement is resolved as a whole (the trace fires a line
//     event for continuation lines too), and if the boundaries cannot be
//     established safely the answer is `unknown` with a reason.
//
// Index expressions are evaluated with evaluate.js when the caller supplies an
// environment; its grammar is not broadened here. Bounds are not checked here:
// a shape reports the index, diff.js decides whether a cell of that list exists.
//
// Result (every key is always present):
//
//   {
//     kind,        // SHAPE_KINDS, or "unknown"
//     reason,      // null for a recognized shape, otherwise an UNKNOWN_REASON
//     statement,   // { text, startLine, endLine } or null
//     targets,     // references written on the left, or the receiver of a method
//     sources,     // references the statement copies from (swap and shift)
//     operator,    // "=", a Python augmented operator, "del", or the method name
//     args,        // method arguments as written, [] otherwise
//     direction,   // "left" | "right" for an adjacent shift, else null
//   }
//
// A reference is:
//
//   { text, base, canonical, tail, access: [
//       { kind: "attr", name } |
//       { kind: "subscript", text, value, literal, slice, canonical }
//   ] }
//
// `value` is the safe integer the subscript evaluates to (null when it cannot
// be evaluated), `literal` is "str" for a single string-literal key, and
// `canonical` is the token sequence, used to compare two references regardless
// of spacing.

import { evaluateExpression } from "./evaluate.js";

/** The statement shapes this module recognizes. */
export const SHAPE_KINDS = Object.freeze([
  "swap",
  "shift",
  "subscript-assign",
  "attribute-assign",
  "augmented",
  "del",
  "append",
  "insert",
  "pop",
]);

/** Why a statement has no recognized shape. A closed set; every unknown has one. */
export const UNKNOWN_REASON = Object.freeze({
  notAMutation: "not-a-mutation",
  unsupported: "unsupported",
  ambiguous: "ambiguous",
  malformed: "malformed",
  outsideStatement: "outside-statement",
});

const REASONS = new Set(Object.values(UNKNOWN_REASON));

const ASSIGNMENT = new Set([
  "=",
  "+=",
  "-=",
  "*=",
  "/=",
  "//=",
  "%=",
  "**=",
  "&=",
  "|=",
  "^=",
  ">>=",
  "<<=",
  "@=",
]);
const AUGMENTED = new Set([...ASSIGNMENT].filter((op) => op !== "="));
const METHOD_ARITY = { append: [1], insert: [2], pop: [0, 1] };

// Longest first, so `**=` never tokenizes as `*`, `*`, `=`.
const OPERATORS = [
  "**=", "//=", ">>=", "<<=",
  "==", "!=", "<=", ">=", "->", ":=", "**", "//", "<<", ">>",
  "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "@=",
  "+", "-", "*", "/", "%", "@", "&", "|", "^", "~", "<", ">", "=",
  "(", ")", "[", "]", "{", "}", ",", ".", ":", ";",
];
const PAIRS = { ")": "(", "]": "[", "}": "{" };
const CLOSES = { "(": ")", "[": "]", "{": "}" };
const STRING_PREFIX = "rRbBuUfF";

// A number token has to be a real number. `1abc` is not one, and letting it
// through would hand the rest of the parser a token stream nobody wrote.
const NUMBER = /^(?:(?:[0-9][0-9_]*(?:\.[0-9_]*)?|\.[0-9][0-9_]*)(?:[eE][+-]?[0-9]+)?[jJ]?|0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+)$/;

function isDigit(ch) {
  return ch >= "0" && ch <= "9";
}

function isNameStart(ch) {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
}

function isNamePart(ch) {
  return isNameStart(ch) || isDigit(ch);
}

// --- 1. The logical statement that contains a line -------------------------

/** Track brackets, strings and comments across the lines of a source. */
function scanLine(text, state) {
  state.continued = false;
  state.escapeContinues = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (state.quote !== null) {
      const marker = state.quote;
      if (ch === "\\") {
        if (i === text.length - 1) {
          state.escapeContinues = true;
          i += 1;
          continue;
        }
        i += 2;
        continue;
      }
      if (marker.length === 3 ? text.startsWith(marker, i) : ch === marker) {
        i += marker.length;
        state.quote = null;
        continue;
      }
      i += 1;
      continue;
    }
    if (ch === "#") break;
    if (ch === "'" || ch === '"') {
      const triple = text.startsWith(ch.repeat(3), i);
      state.quote = triple ? ch.repeat(3) : ch;
      i += triple ? 3 : 1;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      state.depth += 1;
      i += 1;
      continue;
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      state.depth = Math.max(0, state.depth - 1);
      i += 1;
      continue;
    }
    if (ch === "\\" && i === text.length - 1) {
      state.continued = true;
      i += 1;
      continue;
    }
    i += 1;
  }
  // A plain string cannot span lines unless the newline itself was escaped.
  if (state.quote !== null && state.quote.length === 1 && !state.escapeContinues) {
    state.unterminated = true;
  }
}

function extractStatement(source, line) {
  const lines = String(source ?? "").split("\n");
  if (!Number.isInteger(line) || line < 1 || line > lines.length) {
    return { reason: UNKNOWN_REASON.outsideStatement };
  }
  const state = { depth: 0, quote: null, continued: false, escapeContinues: false, unterminated: false };
  let start = 0;
  for (let n = 1; n <= lines.length; n += 1) {
    const text = lines[n - 1];
    const atBoundary =
      state.depth === 0 && state.quote === null && !state.continued && !state.escapeContinues;
    state.continued = false;
    state.escapeContinues = false;
    if (atBoundary) {
      const trimmed = text.trim();
      if (trimmed === "" || trimmed.startsWith("#")) {
        if (n === line) return { reason: UNKNOWN_REASON.outsideStatement };
        start = 0;
        continue;
      }
      start = n;
    }
    if (n === line && state.quote !== null) {
      // A line event never fires inside a multi-line string.
      return { reason: UNKNOWN_REASON.outsideStatement };
    }
    scanLine(text, state);
    if (state.unterminated) return { reason: UNKNOWN_REASON.malformed };
    if (
      start > 0 &&
      n >= line &&
      state.depth === 0 &&
      state.quote === null &&
      !state.continued &&
      !state.escapeContinues
    ) {
      return {
        statement: { text: lines.slice(start - 1, n).join("\n"), startLine: start, endLine: n },
      };
    }
  }
  return { reason: UNKNOWN_REASON.malformed };
}

// --- 2. Tokens -------------------------------------------------------------

/** The end offset of a string literal starting at `i`, or 0 when there is none. */
function stringLiteralEnd(text, i) {
  let prefix = 0;
  while (prefix < 2 && i + prefix < text.length && STRING_PREFIX.includes(text[i + prefix])) {
    prefix += 1;
  }
  const at = i + prefix;
  const quote = text[at];
  if (quote !== "'" && quote !== '"') return 0;
  const marker = text.startsWith(quote.repeat(3), at) ? quote.repeat(3) : quote;
  let j = at + marker.length;
  while (j < text.length) {
    const ch = text[j];
    if (ch === "\\") {
      j += 2;
      continue;
    }
    if (marker.length === 3 ? text.startsWith(marker, j) : ch === marker) return j + marker.length;
    if (marker.length === 1 && ch === "\n") return 0; // an unterminated string
    j += 1;
  }
  return 0;
}

function numberEnd(text, i) {
  let j = i;
  while (j < text.length) {
    const ch = text[j];
    if (isNamePart(ch) || ch === ".") {
      j += 1;
      continue;
    }
    if ((ch === "+" || ch === "-") && (text[j - 1] === "e" || text[j - 1] === "E")) {
      j += 1;
      continue;
    }
    break;
  }
  return j;
}

function operatorAt(text, i) {
  for (const op of OPERATORS) {
    if (text.startsWith(op, i)) return op;
  }
  return null;
}

/** Tokens with offsets into `text`, or null when a character is outside the grammar. */
function tokenize(text) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f" || ch === "\v") {
      i += 1;
      continue;
    }
    if (ch === "#") {
      while (i < text.length && text[i] !== "\n") i += 1;
      continue;
    }
    const start = i;
    const stringEnd = stringLiteralEnd(text, i);
    if (stringEnd > i) {
      tokens.push({ type: "string", value: text.slice(i, stringEnd), start, end: stringEnd });
      i = stringEnd;
      continue;
    }
    if (isDigit(ch) || (ch === "." && isDigit(text[i + 1]))) {
      i = numberEnd(text, i);
      const value = text.slice(start, i);
      if (!NUMBER.test(value)) return null;
      tokens.push({ type: "number", value, start, end: i });
      continue;
    }
    if (isNameStart(ch)) {
      i += 1;
      while (i < text.length && isNamePart(text[i])) i += 1;
      tokens.push({ type: "name", value: text.slice(start, i), start, end: i });
      continue;
    }
    const op = operatorAt(text, i);
    if (op === null) return null;
    tokens.push({ type: "op", value: op, start, end: i + op.length });
    i += op.length;
  }
  return tokens;
}

// --- 3. Nesting ------------------------------------------------------------

/** Every token with its bracket depth; null when the brackets do not match. */
function annotate(tokens) {
  const stack = [];
  const out = [];
  for (const token of tokens) {
    if (token.type === "op" && (token.value === "(" || token.value === "[" || token.value === "{")) {
      out.push({ ...token, depth: stack.length });
      stack.push(token.value);
      continue;
    }
    if (token.type === "op" && (token.value === ")" || token.value === "]" || token.value === "}")) {
      if (stack.length === 0 || stack[stack.length - 1] !== PAIRS[token.value]) return null;
      stack.pop();
      out.push({ ...token, depth: stack.length });
      continue;
    }
    out.push({ ...token, depth: stack.length });
  }
  return stack.length === 0 ? out : null;
}

/** Split at separators that sit at exactly `depth`. */
function splitAt(tokens, value, depth, { allowTrailing = false } = {}) {
  const segments = [];
  let current = [];
  for (const token of tokens) {
    if (token.type === "op" && token.value === value && token.depth === depth) {
      segments.push(current);
      current = [];
      continue;
    }
    current.push(token);
  }
  segments.push(current);
  if (allowTrailing && segments.length > 1 && segments[segments.length - 1].length === 0) {
    segments.pop();
  }
  return segments;
}

/** The index of the bracket that closes the bracket at `open`, or -1. */
function findClose(tokens, open) {
  const token = tokens[open];
  if (!token || token.type !== "op") return -1;
  const close = CLOSES[token.value];
  if (!close) return -1;
  for (let i = open + 1; i < tokens.length; i += 1) {
    if (tokens[i].type === "op" && tokens[i].value === close && tokens[i].depth === token.depth) return i;
  }
  return -1;
}

/** Trim one pair of parentheses when it wraps the whole segment. */
function unwrap(tokens) {
  if (tokens.length < 2) return tokens;
  const first = tokens[0];
  if (first.type !== "op" || first.value !== "(" || first.depth !== 0) return tokens;
  const close = findClose(tokens, 0);
  if (close !== tokens.length - 1) return tokens;
  return tokens.slice(1, -1);
}

// --- 4. References ---------------------------------------------------------

function renderReference(base, access) {
  return `${base}${access
    .map((entry) => (entry.kind === "attr" ? `.${entry.name}` : `[${entry.text}]`))
    .join("")}`;
}

function referenceCanonical(base, access) {
  return `${base}${access
    .map((entry) => (entry.kind === "attr" ? `.${entry.name}` : `[${entry.canonical}]`))
    .join("")}`;
}

/**
 * Parse one reference (a name plus `.attr` and `[subscript]` accessors) from
 * `from`. Returns `{ ref, next }`, where `next` is the first unconsumed token,
 * or null when these tokens are not a reference.
 */
function parseReferenceAt(tokens, text, env, from) {
  const first = tokens[from];
  if (!first || first.type !== "name") return null;
  const access = [];
  let i = from + 1;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token.type === "op" && token.value === ".") {
      const name = tokens[i + 1];
      if (!name || name.type !== "name") return null;
      access.push({ kind: "attr", name: name.value });
      i += 2;
      continue;
    }
    if (token.type === "op" && token.value === "[") {
      const close = findClose(tokens, i);
      if (close < 0) return null;
      const inner = tokens.slice(i + 1, close);
      if (inner.length === 0) return null;
      const content = text.slice(token.end, tokens[close].start).trim();
      const literal = inner.length === 1 && inner[0].type === "string" ? "str" : null;
      access.push({
        kind: "subscript",
        text: content,
        value: literal === null ? evaluateExpression(content, env) : null,
        literal,
        slice: inner.some((t) => t.type === "op" && t.value === ":" && t.depth === token.depth + 1),
        canonical: inner.map((t) => `${t.type}:${t.value}`).join("\u0001"),
      });
      i = close + 1;
      continue;
    }
    break;
  }
  const last = access[access.length - 1];
  return {
    ref: {
      text: renderReference(first.value, access),
      base: first.value,
      canonical: referenceCanonical(first.value, access),
      tail: !last ? "name" : last.kind === "attr" ? "attr" : "subscript",
      access,
    },
    next: i,
  };
}

function parseWholeReference(tokens, text, env) {
  const parsed = parseReferenceAt(tokens, text, env, 0);
  return parsed && parsed.next === tokens.length ? parsed.ref : null;
}

function hasSlice(ref) {
  return ref !== null && ref.access.some((entry) => entry.kind === "subscript" && entry.slice);
}

/** A reference the swap/shift rules can reason about: one subscript, no attrs. */
function isSimpleCell(ref) {
  return (
    ref !== null &&
    ref.tail === "subscript" &&
    ref.access.length === 1 &&
    ref.access[0].kind === "subscript" &&
    !ref.access[0].slice
  );
}

// --- 5. Results ------------------------------------------------------------

function unknown(reason, statement = null) {
  return {
    kind: "unknown",
    reason: REASONS.has(reason) ? reason : UNKNOWN_REASON.unsupported,
    statement,
    targets: [],
    sources: [],
    operator: null,
    args: [],
    direction: null,
  };
}

function shape(kind, statement, fields = {}) {
  return {
    kind,
    reason: null,
    statement,
    targets: fields.targets ?? [],
    sources: fields.sources ?? [],
    operator: fields.operator ?? null,
    args: fields.args ?? [],
    direction: fields.direction ?? null,
  };
}

function argumentText(tokens, text) {
  if (tokens.length === 0) return "";
  return text.slice(tokens[0].start, tokens[tokens.length - 1].end).trim();
}

// --- 6. Shapes -------------------------------------------------------------

function swapShape(statement, segments, rhsTokens, env, operator) {
  if (operator !== "=") return unknown(UNKNOWN_REASON.malformed, statement);
  const text = statement.text;
  const targets = segments.map((segment) => parseWholeReference(segment, text, env));
  if (targets.some((ref) => ref === null)) return unknown(UNKNOWN_REASON.unsupported, statement);
  const [left, right] = targets;
  if (!isSimpleCell(left) || !isSimpleCell(right)) return unknown(UNKNOWN_REASON.unsupported, statement);
  if (left.base !== right.base) return unknown(UNKNOWN_REASON.unsupported, statement);
  if (left.canonical === right.canonical) return unknown(UNKNOWN_REASON.ambiguous, statement);

  const inner = unwrap(rhsTokens);
  // A parenthesised tuple keeps its contents one bracket deeper, so split at
  // the depth the first real token sits at.
  const innerDepth = inner.length > 0 ? inner[0].depth : 0;
  const parts = splitAt(inner, ",", innerDepth, { allowTrailing: true });
  if (parts.length !== 2) return unknown(UNKNOWN_REASON.unsupported, statement);
  const sources = parts.map((part) => parseWholeReference(part, text, env));
  if (sources.some((ref) => ref === null || !isSimpleCell(ref) || ref.base !== left.base)) {
    return unknown(UNKNOWN_REASON.unsupported, statement);
  }
  // A swap reverses the two cells; copying them in place is not a swap.
  if (sources[0].canonical !== right.canonical || sources[1].canonical !== left.canonical) {
    return unknown(UNKNOWN_REASON.unsupported, statement);
  }
  return shape("swap", statement, { targets, sources, operator: "=" });
}

function singleAssignmentShape(statement, segment, rhsTokens, env, operator) {
  const text = statement.text;
  const target = parseWholeReference(segment, text, env);
  if (target === null) return unknown(UNKNOWN_REASON.unsupported, statement);
  if (hasSlice(target)) return unknown(UNKNOWN_REASON.unsupported, statement);
  if (AUGMENTED.has(operator)) {
    return shape("augmented", statement, { targets: [target], operator });
  }
  if (target.tail === "name") return unknown(UNKNOWN_REASON.notAMutation, statement);
  if (target.tail === "attr") {
    return shape("attribute-assign", statement, { targets: [target], operator: "=" });
  }

  const source = parseWholeReference(rhsTokens, text, env);
  const cellCopy =
    isSimpleCell(target) && isSimpleCell(source) && source.base === target.base;
  const destination = target.access[target.access.length - 1];
  const origin = cellCopy ? source.access[0] : null;
  if (
    cellCopy &&
    Number.isInteger(destination.value) &&
    Number.isInteger(origin.value) &&
    Math.abs(destination.value - origin.value) === 1
  ) {
    return shape("shift", statement, {
      targets: [target],
      sources: [source],
      operator: "=",
      direction: destination.value > origin.value ? "right" : "left",
    });
  }
  return shape("subscript-assign", statement, {
    targets: [target],
    sources: cellCopy ? [source] : [],
    operator: "=",
  });
}

function deletionShape(statement, tokens, env) {
  const text = statement.text;
  const rest = tokens.slice(1);
  if (rest.length === 0) return unknown(UNKNOWN_REASON.malformed, statement);
  const parts = splitAt(rest, ",", 0);
  if (parts.some((part) => part.length === 0)) return unknown(UNKNOWN_REASON.malformed, statement);
  if (parts.length > 1) return unknown(UNKNOWN_REASON.unsupported, statement);
  const target = parseWholeReference(parts[0], text, env);
  if (target === null) return unknown(UNKNOWN_REASON.unsupported, statement);
  if (hasSlice(target)) return unknown(UNKNOWN_REASON.unsupported, statement);
  return shape("del", statement, { targets: [target], operator: "del" });
}

function methodShape(statement, tokens, env) {
  const text = statement.text;
  // Look for `receiver . name ( ... )` where the call is the whole statement.
  // A call that is only part of an expression (`a.pop(0) + 1`, a chained
  // `f().append(x)`) is never turned into a partial shape.
  for (let i = 1; i + 2 < tokens.length; i += 1) {
    const dot = tokens[i];
    const name = tokens[i + 1];
    const open = tokens[i + 2];
    if (dot.type !== "op" || dot.value !== "." || dot.depth !== 0) continue;
    if (name.type !== "name") continue;
    if (open.type !== "op" || open.value !== "(" || open.depth !== 0) continue;
    if (findClose(tokens, i + 2) !== tokens.length - 1) continue;
    const receiver = parseWholeReference(tokens.slice(0, i), text, env);
    if (receiver === null) return unknown(UNKNOWN_REASON.unsupported, statement);
    if (hasSlice(receiver)) return unknown(UNKNOWN_REASON.unsupported, statement);
    const inner = tokens.slice(i + 3, tokens.length - 1);
    const parts = inner.length === 0 ? [] : splitAt(inner, ",", 1, { allowTrailing: true });
    if (parts.some((part) => part.length === 0)) return unknown(UNKNOWN_REASON.malformed, statement);
    const method = name.value;
    const arities = METHOD_ARITY[method];
    if (!arities) return null;
    if (!arities.includes(parts.length)) return unknown(UNKNOWN_REASON.unsupported, statement);
    return shape(method, statement, {
      targets: [receiver],
      operator: method,
      args: parts.map((part) => argumentText(part, text)),
    });
  }
  return null;
}

function recognize(statement, tokens, env) {
  if (tokens.length === 0) return unknown(UNKNOWN_REASON.outsideStatement, statement);
  // More than one statement on a line cannot be recognized partially.
  if (tokens.some((t) => t.type === "op" && t.value === ";" && t.depth === 0)) {
    return unknown(UNKNOWN_REASON.ambiguous, statement);
  }
  const assignments = tokens.filter((t) => t.type === "op" && ASSIGNMENT.has(t.value) && t.depth === 0);
  if (assignments.length > 1) return unknown(UNKNOWN_REASON.ambiguous, statement);

  if (assignments.length === 1) {
    const opToken = assignments[0];
    const at = tokens.indexOf(opToken);
    const left = tokens.slice(0, at);
    const right = tokens.slice(at + 1);
    if (left.length === 0 || right.length === 0) return unknown(UNKNOWN_REASON.malformed, statement);
    const segments = splitAt(left, ",", 0);
    if (segments.some((segment) => segment.length === 0)) {
      return unknown(UNKNOWN_REASON.malformed, statement);
    }
    if (segments.length > 2) return unknown(UNKNOWN_REASON.unsupported, statement);
    if (segments.length === 2) return swapShape(statement, segments, right, env, opToken.value);
    return singleAssignmentShape(statement, segments[0], right, env, opToken.value);
  }

  if (tokens[0].type === "name" && tokens[0].value === "del") {
    return deletionShape(statement, tokens, env);
  }
  return methodShape(statement, tokens, env) ?? unknown(UNKNOWN_REASON.notAMutation, statement);
}

/**
 * The shape of the statement that contains `line`.
 *
 * @param {string} source the source the run was made from
 * @param {number} line the 1-based line of the trace event
 * @param {{ env?: Object|null }} [options] names to safe integers, for index expressions
 * @returns {Object} the shape result described at the top of this file
 */
export function lineShape(source, line, { env = null } = {}) {
  try {
    const extracted = extractStatement(source, line);
    if (!extracted.statement) return unknown(extracted.reason ?? UNKNOWN_REASON.outsideStatement);
    const statement = extracted.statement;
    // A character outside the token grammar is something the parser does not
    // model (non-ASCII identifiers, an operator it has no token for), not a
    // malformed statement: the brackets and strings were already checked.
    const tokens = tokenize(statement.text);
    if (tokens === null) return unknown(UNKNOWN_REASON.unsupported, statement);
    const annotated = annotate(tokens);
    if (annotated === null) return unknown(UNKNOWN_REASON.malformed, statement);
    return recognize(statement, annotated, env);
  } catch {
    return unknown(UNKNOWN_REASON.malformed);
  }
}
