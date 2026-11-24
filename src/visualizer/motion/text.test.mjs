import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_CELLED_LENGTH,
  MAX_TEXT_CARDS,
  MAX_TEXT_CELLS,
  textCards,
  textCells,
} from "./text.js";

const scalar = (name, value, extra = {}) => ({
  key: `variable:1:${name}`,
  name,
  frameId: 1,
  text: JSON.stringify(value),
  raw: { type: "str", value },
  valueType: "str",
  changed: false,
  highlighted: false,
  was: null,
  ...extra,
});

test("a string becomes indexed character cells", () => {
  const cells = textCells("hello");
  assert.equal(cells.length, 5);
  assert.equal(cells.hidden, 0);
  assert.deepEqual(
    cells.chars.map((cell) => [cell.index, cell.char, cell.glyph]),
    [
      [0, "h", "h"],
      [1, "e", "e"],
      [2, "l", "l"],
      [3, "l", "l"],
      [4, "o", "o"],
    ],
  );
});

test("whitespace gets a visible glyph, not a blank cell", () => {
  const cells = textCells("a b\tc\n");
  assert.deepEqual(
    cells.chars.map((cell) => cell.glyph),
    ["a", "␠", "b", "⇥", "c", "⏎"],
  );
});

test("emoji are counted as characters, not UTF-16 pieces", () => {
  const cells = textCells("a😀b");
  assert.equal(cells.length, 3);
  assert.deepEqual(
    cells.chars.map((cell) => cell.char),
    ["a", "😀", "b"],
  );
});

test("a long string is bounded and says how many characters are hidden", () => {
  const cells = textCells("x".repeat(MAX_TEXT_CELLS + 5));
  assert.equal(cells.chars.length, MAX_TEXT_CELLS);
  assert.equal(cells.hidden, 5);
  assert.equal(cells.length, MAX_TEXT_CELLS + 5);
});

test("only plain recorded strings become cards", () => {
  const result = textCards([
    scalar("one", "a"),
    scalar("empty", ""),
    scalar("long", "x".repeat(MAX_CELLED_LENGTH + 1)),
    scalar("cut", "abc", { raw: { type: "str", value: "abc", truncated: true } }),
    { ...scalar("num", "2"), raw: { type: "int", value: 2 }, valueType: "int" },
    scalar("ok", "hi"),
  ]);
  assert.deepEqual(
    result.cards.map((card) => card.name),
    ["ok"],
  );
  assert.equal(result.scalarKeys.size, 1);
  assert.equal(result.skipped, 0);
});

test("cards are capped and report how many string values stayed tiles", () => {
  const many = ["ab", "ac", "ad", "ae", "af"].map((value, i) => scalar(`s${i}`, value));
  const result = textCards(many);
  assert.equal(result.cards.length, MAX_TEXT_CARDS);
  assert.equal(result.skipped, many.length - MAX_TEXT_CARDS);
  assert.equal(result.scalarKeys.size, MAX_TEXT_CARDS);
});

test("a card keeps the tile's identity, change flags and key", () => {
  const result = textCards([
    scalar("word", "hello", { changed: true, highlighted: true, was: '"bye"' }),
  ]);
  const [card] = result.cards;
  assert.equal(card.key, "text:1:word");
  assert.equal(card.scalarKey, "variable:1:word");
  assert.equal(card.name, "word");
  assert.equal(card.length, 5);
  assert.equal(card.chars[4].key, "text:1:word:4");
  assert.equal(card.changed, true);
  assert.equal(card.highlighted, true);
  assert.equal(card.was, '"bye"');
});

test("the input tiles are never mutated", () => {
  const tiles = [scalar("word", "hello")];
  const before = JSON.stringify(tiles);
  textCards(tiles);
  assert.equal(JSON.stringify(tiles), before);
});
