// Strings as character cells.
//
// The trace records a string as one inline value; it has no object id and no
// per-character identity. So a character cell here is presentation only: the
// characters of the recorded value, in order, with their index. It never
// claims a position was compared or changed unless an action names the
// variable. A string the tracer truncated is never expanded, because its
// missing characters are unknown.

export const MAX_TEXT_CELLS = 32;
export const MAX_TEXT_CARDS = 3;
export const MAX_CELLED_LENGTH = 60;

/** Visible stand-ins for characters that would otherwise be blank. */
export const CHARACTER_GLYPH = Object.freeze({
  " ": "␠",
  "\n": "⏎",
  "\r": "␍",
  "\t": "⇥",
});

/** The characters of a recorded string, bounded, with their indices. */
export function textCells(value, max = MAX_TEXT_CELLS) {
  const characters = Array.from(String(value ?? ""));
  const shown = characters.slice(0, max);
  return {
    length: characters.length,
    chars: shown.map((char, index) => ({
      index,
      char,
      glyph: CHARACTER_GLYPH[char] ?? char,
    })),
    hidden: Math.max(0, characters.length - shown.length),
  };
}

/**
 * Which scalar tiles become character cards.
 *
 * A single character stays a tile (a card would be one cell and more chrome
 * than value). Long strings stay a tile too: the trace's own truncation marker
 * and `showValue` already tell that story honestly, and a 200-cell card would
 * push the program's real data off the stage. The cap is on how many cards are
 * drawn, not on how many strings exist; `skipped` says how many were left as
 * ordinary tiles.
 *
 * @param {Array} scalars tiles from `motionView`
 * @param {{maxCards?: number}} [options]
 * @returns {{cards: Array, skipped: number, scalarKeys: Set<string>}}
 */
export function textCards(scalars, { maxCards = MAX_TEXT_CARDS } = {}) {
  const cards = [];
  const scalarKeys = new Set();
  let eligible = 0;

  for (const tile of scalars ?? []) {
    if (tile?.valueType !== "str") continue;
    const raw = tile.raw;
    if (!raw || raw.type !== "str" || raw.truncated) continue;
    if (typeof raw.value !== "string") continue;
    const length = Array.from(raw.value).length;
    if (length < 2 || length > MAX_CELLED_LENGTH) continue;

    eligible += 1;
    if (cards.length >= maxCards) continue;

    const key = `text:${tile.frameId}:${tile.name}`;
    const cells = textCells(raw.value);
    cards.push({
      key,
      scalarKey: tile.key,
      name: tile.name,
      frameId: tile.frameId,
      valueType: "str",
      text: tile.text,
      length: cells.length,
      chars: cells.chars.map((cell) => ({ ...cell, key: `${key}:${cell.index}` })),
      hidden: cells.hidden,
      changed: Boolean(tile.changed),
      highlighted: Boolean(tile.highlighted),
      was: tile.was ?? null,
    });
    scalarKeys.add(tile.key);
  }

  return { cards, skipped: Math.max(0, eligible - cards.length), scalarKeys };
}
