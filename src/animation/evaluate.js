// A safe evaluator for the small index expressions an executed line contains.
//
// The animation diff needs to know what `i`, `j + 1` or `mid - 1` meant at the
// moment a line was about to run, so it can put a label under the right cell.
// Evaluating an arbitrary expression from user code would be a security and
// honesty problem, so this module accepts one tiny grammar and nothing else:
//
//   expression := term (("+" | "-") term)*
//   term       := factor (("*" | "//") factor)*
//   factor     := "-" INT | INT | NAME | "(" expression ")"
//
// Names are resolved only from the environment the caller supplies, and only
// when it owns an integer under that name; nothing is read from globals,
// prototypes or the trace format. There is no dynamic code execution: no eval
// call and no Function constructor anywhere in this file (a test checks it).
//
// Integer arithmetic uses BigInt, so `//` is Python's floor division exactly and
// a product or sum can never be silently rounded by a double. A result outside
// JavaScript's safe integer range is refused with null rather than approximated.
//
// Evaluation is deliberately separate from list bounds. `evaluateExpression`
// answers "what integer is this?", including negative answers; `resolveIndex`
// answers "which cell of a list of this length is that?" using Python's negative
// index rule. Neither function knows about the other.

/** Hard limits, so a pathological line cannot make the evaluator expensive. */
export const EVALUATOR_LIMITS = Object.freeze({
  maxLength: 200,
  maxNestDepth: 24,
});

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE = -MAX_SAFE;

function isDigit(code) {
  return code >= 48 && code <= 57;
}

function isNameStart(code) {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;
}

function isNamePart(code) {
  return isNameStart(code) || isDigit(code);
}

/**
 * The tokens of an expression, or null when a character is outside the grammar.
 * Whitespace is spaces and tabs only: a fragment that spans lines is refused.
 */
function tokenize(text) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const code = text.charCodeAt(i);
    if (code === 32 || code === 9) {
      i += 1;
      continue;
    }
    if (isDigit(code)) {
      let end = i;
      while (end < text.length && isDigit(text.charCodeAt(end))) end += 1;
      tokens.push({ type: "int", value: BigInt(text.slice(i, end)) });
      i = end;
      continue;
    }
    if (isNameStart(code)) {
      let end = i;
      while (end < text.length && isNamePart(text.charCodeAt(end))) end += 1;
      tokens.push({ type: "name", value: text.slice(i, end) });
      i = end;
      continue;
    }
    const ch = text[i];
    if (ch === "+" || ch === "-" || ch === "*") {
      tokens.push({ type: "op", value: ch });
      i += 1;
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      tokens.push({ type: "op", value: "//" });
      i += 2;
      continue;
    }
    if (ch === "(" || ch === ")") {
      tokens.push({ type: ch, value: ch });
      i += 1;
      continue;
    }
    return null;
  }
  return tokens;
}

/** The environment's integer for `name`, or null. Own properties only. */
function lookup(env, name) {
  if (!env || typeof env !== "object") return null;
  if (!Object.hasOwn(env, name)) return null;
  const value = env[name];
  return Number.isSafeInteger(value) ? BigInt(value) : null;
}

/** Python's floor division for integers; null for division by zero. */
function floorDivide(a, b) {
  if (b === 0n) return null;
  let quotient = a / b;
  const remainder = a % b;
  // BigInt division truncates toward zero; Python rounds toward -infinity.
  if (remainder !== 0n && remainder > 0n !== b > 0n) quotient -= 1n;
  return quotient;
}

function parse(tokens, env) {
  let pos = 0;
  let depth = 0;

  const peek = () => (pos < tokens.length ? tokens[pos] : null);
  const isOp = (token, value) => token !== null && token.type === "op" && token.value === value;

  function factor() {
    const token = peek();
    if (token === null) return null;
    if (token.type === "int") {
      pos += 1;
      return token.value;
    }
    if (token.type === "name") {
      pos += 1;
      return lookup(env, token.value);
    }
    if (isOp(token, "-")) {
      // A negative integer literal, and nothing more: `-i` and `-(1)` are refused.
      const next = pos + 1 < tokens.length ? tokens[pos + 1] : null;
      if (next === null || next.type !== "int") return null;
      pos += 2;
      return -next.value;
    }
    if (token.type === "(") {
      if (depth >= EVALUATOR_LIMITS.maxNestDepth) return null;
      depth += 1;
      pos += 1;
      const value = expression();
      if (value === null) return null;
      const close = peek();
      if (close === null || close.type !== ")") return null;
      pos += 1;
      depth -= 1;
      return value;
    }
    return null;
  }

  function term() {
    let value = factor();
    if (value === null) return null;
    for (;;) {
      const token = peek();
      if (isOp(token, "*")) {
        pos += 1;
        const right = factor();
        if (right === null) return null;
        value *= right;
      } else if (isOp(token, "//")) {
        pos += 1;
        const right = factor();
        if (right === null) return null;
        const divided = floorDivide(value, right);
        if (divided === null) return null;
        value = divided;
      } else {
        return value;
      }
    }
  }

  function expression() {
    let value = term();
    if (value === null) return null;
    for (;;) {
      const token = peek();
      if (isOp(token, "+")) {
        pos += 1;
        const right = term();
        if (right === null) return null;
        value += right;
      } else if (isOp(token, "-")) {
        pos += 1;
        const right = term();
        if (right === null) return null;
        value -= right;
      } else {
        return value;
      }
    }
  }

  const value = expression();
  if (value === null || pos !== tokens.length) return null;
  return value;
}

/**
 * Evaluate one index expression.
 *
 * @param {unknown} text the expression, e.g. "j + 1"
 * @param {Object|null} [env] names to safe-integer values; nothing else is read
 * @returns {number|null} the integer, or null when the expression is outside the
 *   grammar, a name is missing or not an integer, a division by zero occurs, or
 *   the result is not a safe integer
 */
export function evaluateExpression(text, env = null) {
  try {
    if (typeof text !== "string" || text.length === 0) return null;
    if (text.length > EVALUATOR_LIMITS.maxLength) return null;
    const tokens = tokenize(text);
    if (tokens === null || tokens.length === 0) return null;
    const value = parse(tokens, env);
    if (value === null) return null;
    if (value > MAX_SAFE || value < MIN_SAFE) return null;
    return Number(value);
  } catch {
    // A hostile getter, a stack limit, a BigInt edge: the caller gets null,
    // never an exception. Invalid input is not an error condition here.
    return null;
  }
}

/**
 * Which cell of a container of `length` an integer index names, using Python's
 * rules: negative counts from the end, and anything outside is null.
 *
 * @param {unknown} index the evaluated integer
 * @param {unknown} length how many cells the container has
 * @returns {number|null} a non-negative cell index, or null when out of range
 */
export function resolveIndex(index, length) {
  if (!Number.isSafeInteger(index)) return null;
  if (!Number.isSafeInteger(length) || length < 0) return null;
  const at = index < 0 ? length + index : index;
  if (at < 0 || at >= length) return null;
  // `length + -0` can produce -0; a cell index is never negative zero.
  return at === 0 ? 0 : at;
}
