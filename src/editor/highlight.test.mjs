import assert from "node:assert/strict";
import test from "node:test";

import { highlightPython, isTokenType } from "./highlight.js";

const textOf = (line) => line.map((token) => token.text).join("");
const typesOf = (line, word) =>
  line.filter((token) => token.text === word).map((token) => token.type);

test("one token array per line, concatenating back to the source", () => {
  const source = "total = 0\nfor n in range(1, 6):\n    total = total + n\nprint(total)\n";
  const lines = highlightPython(source);
  assert.equal(lines.length, source.split("\n").length);
  assert.equal(lines.map(textOf).join("\n"), source);
});

test("keywords, builtins and constants get their own classes", () => {
  const [line] = highlightPython("for n in range(3): print(True)");
  assert.ok(typesOf(line, "for").includes("keyword"));
  assert.ok(typesOf(line, "in").includes("keyword"));
  assert.ok(typesOf(line, "range").includes("builtin"));
  assert.ok(typesOf(line, "print").includes("builtin"));
  assert.ok(typesOf(line, "True").includes("constant"));
});

test("a comment is one token and stops the line", () => {
  const [line] = highlightPython("x = 1  # not a print(3)");
  const comment = line.find((token) => token.type === "comment");
  assert.equal(comment.text, "# not a print(3)");
  assert.equal(line[line.length - 1], comment);
});

test("inside a string, comment and keyword markers stay string text", () => {
  const [line] = highlightPython('message = "if # print"');
  const strings = line.filter((token) => token.type === "string");
  assert.equal(strings.length, 1);
  assert.equal(strings[0].text, '"if # print"');
  assert.ok(!line.some((token) => token.type === "comment"));
  assert.ok(!line.some((token) => token.type === "keyword"));
});

test("an escaped quote does not end a string", () => {
  const [line] = highlightPython('s = "he said \\"hi\\"" + 1');
  const strings = line.filter((token) => token.type === "string");
  assert.equal(strings[0].text, '"he said \\"hi\\""');
  assert.ok(typesOf(line, "1").includes("number"));
});

test("an unterminated string runs to the end of its line without throwing", () => {
  const [line] = highlightPython('s = "unfinished');
  assert.equal(textOf(line), 's = "unfinished');
  assert.equal(line[line.length - 1].type, "string");
});

test("triple-quoted strings continue across lines", () => {
  const lines = highlightPython('s = """one\ntwo\nthree""" + 1');
  assert.equal(lines.length, 3);
  assert.equal(lines[0].filter((t) => t.type === "string")[0].text, '"""one');
  assert.equal(lines[1].filter((t) => t.type === "string")[0].text, "two");
  assert.equal(textOf(lines[2]), 'three""" + 1');
  assert.ok(typesOf(lines[2], "1").includes("number"));
});

test("numbers keep decimals, hex and underscores", () => {
  const [line] = highlightPython("a = 0xFF + 1_000 + 3.14 + .5");
  const numbers = line.filter((token) => token.type === "number").map((t) => t.text);
  assert.deepEqual(numbers, ["0xFF", "1_000", "3.14", ".5"]);
});

test("empty and whitespace-only sources still return their lines", () => {
  assert.deepEqual(highlightPython(""), [[{ type: "plain", text: "" }]]);
  assert.equal(highlightPython("   \n\n").length, 3);
});

test("every token type is one the stylesheet can colour", () => {
  const lines = highlightPython('def f(x):\n    return x + 1  # ok\ns = "a"');
  for (const line of lines) {
    for (const token of line) assert.ok(isTokenType(token.type), token.type);
  }
});
