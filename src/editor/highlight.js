// A small, dependency-free Python tokenizer for the editor's syntax layer.
//
// It is presentation only: it never parses Python and never decides what the
// program means. The worst it can do is colour a word differently. That is why
// it is allowed to be forgiving about incomplete code - the learner is typing,
// so the source is almost always unfinished.
//
// The contract is simple and tested: concatenating one line's tokens returns
// that line exactly, and the number of lines in equals the number of lines out.

const KEYWORDS = new Set([
  "and",
  "as",
  "assert",
  "async",
  "await",
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
  "match",
  "case",
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

const CONSTANTS = new Set(["True", "False", "None"]);

const BUILTINS = new Set([
  "abs",
  "all",
  "any",
  "bool",
  "dict",
  "enumerate",
  "filter",
  "float",
  "input",
  "int",
  "isinstance",
  "len",
  "list",
  "map",
  "max",
  "min",
  "open",
  "print",
  "range",
  "reversed",
  "round",
  "set",
  "sorted",
  "str",
  "sum",
  "super",
  "tuple",
  "type",
  "zip",
]);

const NUMBER = /^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*)(?:\.[\d_]*)?(?:[eE][+-]?\d+)?|\.[\d_]+(?:[eE][+-]?\d+)?)/;
const IDENT = /^[A-Za-z_]\w*/;
const OPERATOR = /[+\-*/%=<>!&|^~@:]/;
const PUNCT = /[()[\]{},.;]/;

function push(tokens, type, text) {
  if (!text) return;
  const last = tokens[tokens.length - 1];
  if (last && last.type === type) last.text += text;
  else tokens.push({ type, text });
}

function scanString(line, start) {
  const quote = line[start];
  let i = start + 1;
  while (i < line.length) {
    if (line[i] === "\\") {
      i += 2;
      continue;
    }
    if (line[i] === quote) return i + 1;
    i += 1;
  }
  return line.length;
}

/**
 * Tokenize Python source into one token array per line.
 *
 * Token types: `plain`, `keyword`, `constant`, `builtin`, `number`, `string`,
 * `comment`, `operator`, `punct`. Triple-quoted strings continue across lines.
 *
 * @param {string} source
 * @returns {Array<Array<{type: string, text: string}>>}
 */
export function highlightPython(source) {
  const text = typeof source === "string" ? source : "";
  const lines = text.split(/\r?\n/);
  let triple = null;

  return lines.map((line) => {
    const tokens = [];
    let i = 0;

    while (i < line.length) {
      const rest = line.slice(i);

      if (triple) {
        const end = line.indexOf(triple, i);
        if (end === -1) {
          push(tokens, "string", line.slice(i));
          i = line.length;
          continue;
        }
        push(tokens, "string", line.slice(i, end + triple.length));
        i = end + triple.length;
        triple = null;
        continue;
      }

      const ch = line[i];

      if (ch === "#") {
        push(tokens, "comment", line.slice(i));
        i = line.length;
        continue;
      }

      if (ch === '"' || ch === "'") {
        const three = line.slice(i, i + 3);
        if (three === ch.repeat(3)) {
          triple = three;
          push(tokens, "string", three);
          i += 3;
          continue;
        }
        const end = scanString(line, i);
        push(tokens, "string", line.slice(i, end));
        i = end;
        continue;
      }

      if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(line[i + 1] ?? ""))) {
        const match = NUMBER.exec(rest);
        const value = match ? match[0] : ch;
        push(tokens, "number", value);
        i += value.length;
        continue;
      }

      if (/[A-Za-z_]/.test(ch)) {
        const match = IDENT.exec(rest);
        const word = match ? match[0] : ch;
        if (KEYWORDS.has(word)) push(tokens, "keyword", word);
        else if (CONSTANTS.has(word)) push(tokens, "constant", word);
        else if (BUILTINS.has(word)) push(tokens, "builtin", word);
        else push(tokens, "plain", word);
        i += word.length;
        continue;
      }

      if (OPERATOR.test(ch)) {
        push(tokens, "operator", ch);
        i += 1;
        continue;
      }

      if (PUNCT.test(ch)) {
        push(tokens, "punct", ch);
        i += 1;
        continue;
      }

      push(tokens, "plain", ch);
      i += 1;
    }

    if (tokens.length === 0) tokens.push({ type: "plain", text: "" });
    return tokens;
  });
}

/** True when `type` is a token class the stylesheet knows how to colour. */
export function isTokenType(type) {
  return (
    type === "plain" ||
    type === "keyword" ||
    type === "constant" ||
    type === "builtin" ||
    type === "number" ||
    type === "string" ||
    type === "comment" ||
    type === "operator" ||
    type === "punct"
  );
}
