// The geometry of the execution graph. No dagre, no React: a deterministic
// layout that reads like the run itself.
//
//   * time flows down. Row 1 is the first line that ran, row 2 the next, and so
//     on, so the graph is a timeline of the program.
//   * a call indents. A line running inside a function sits one step to the
//     right of its caller, so recursion becomes a staircase instead of a tower,
//     and a call's place in the stack is visible at a glance.
//   * one row per line per call. A loop reusing a line does not add rows; the
//     row carries how many times it ran, so a 100-round loop is still one row.
//   * a finished call folds into one summary row, so long runs stay navigable.
//
// Each row is a *card* with a fixed body, measured here so the renderer only has
// to draw: header, code, action, values, and where control goes next. Every card
// is the same width and reserves the same slots, so the timeline never shifts
// sideways while stepping and no two cards can overlap.
//
// Pure: node --test proves no two cards and no two labels overlap.

import { wrapText } from "./executionGraph.js";

/** Card metrics. Shared with the renderer so text lands where the box is. */
export const CARD = {
  WIDTH: 300,
  PAD: 8,
  HEADER_H: 20,
  CODE_H: 16,
  ACTION_H: 16,
  VALUE_H: 15,
  FOOT_H: 16,
  /** Vertical space between two cards: room for the arrow and its label. */
  GAP: 24,
  /** Horizontal step per call depth. */
  INDENT: 28,
  /** A folded call's single row. */
  SUMMARY_H: 38,
  CHAR_W: 7.6,
  /** Code lines kept per card; longer lines are cut with an ellipsis. */
  CODE_LINES: 3,
  CODE_CHARS: 36,
};

/** Slots every card reserves, filled or not, so heights never move. */
export const VALUE_LINES = 1;
export const FOOT_LINES = 1;

/** How many parallel vertical lanes long edges use down the right gutter. */
export const EDGE_LANES = 5;
const LANE_W = 9;
const GUTTER_PAD = 18;

/** The card's code lines, cut honestly with an ellipsis when they do not fit. */
export function codeLines(text) {
  const wrapped = wrapText(text, CARD.CODE_CHARS);
  if (wrapped.length <= CARD.CODE_LINES) return { lines: wrapped, cut: false };
  const lines = wrapped.slice(0, CARD.CODE_LINES);
  const last = lines[lines.length - 1];
  lines[lines.length - 1] = `${last.slice(0, Math.max(CARD.CODE_CHARS - 1, 1)).trimEnd()}…`;
  return { lines, cut: true };
}

/** The height of a card, from the only part of it that depends on the code. */
export function cardHeight(lines) {
  return (
    CARD.PAD * 2 +
    CARD.HEADER_H +
    lines * CARD.CODE_H +
    CARD.ACTION_H +
    VALUE_LINES * CARD.VALUE_H +
    FOOT_LINES * CARD.FOOT_H
  );
}

/** The y of each part inside a card, from its top edge. */
export function cardSlots(lines) {
  let y = CARD.PAD;
  const header = y;
  y += CARD.HEADER_H;
  const code = y;
  y += lines * CARD.CODE_H;
  const action = y;
  y += CARD.ACTION_H;
  const values = y;
  y += VALUE_LINES * CARD.VALUE_H;
  const foot = y;
  return { header, code, action, values, foot, height: cardHeight(lines) };
}

/**
 * Positions the visible rows in execution order and routes every edge.
 *
 * @param {{ rows: Array, anchors: Map<string, string> }} view from visibleRows
 * @param {Array} edges from buildExecutionGraph
 * @returns {{ rows: Array, edges: Array, byKey: Map<string, Object>, width: number, height: number }}
 */
export function layoutRows(view, edges = []) {
  const source = Array.isArray(view?.rows) ? view.rows : [];
  if (source.length === 0) {
    return { rows: [], edges: [], byKey: new Map(), width: 0, height: 0 };
  }

  const rows = [];
  const byKey = new Map();
  let y = 0;
  let widest = 0;

  source.forEach((row, rowIndex) => {
    const isCall = row.kind === "call";
    const measured = isCall ? { lines: [], cut: false } : codeLines(row.text);
    const height = isCall ? CARD.SUMMARY_H : cardHeight(measured.lines.length);
    const x = Math.max(row.depth ?? 0, 0) * CARD.INDENT;
    const laid = {
      ...row,
      rowIndex,
      x,
      y,
      width: CARD.WIDTH,
      height,
      codeLines: measured.lines,
      cut: measured.cut,
    };
    laid.cx = x + CARD.WIDTH / 2;
    laid.cy = y + height / 2;
    laid.bottom = y + height;
    laid.right = x + CARD.WIDTH;
    rows.push(laid);
    byKey.set(row.key, laid);
    widest = Math.max(widest, laid.right);
    y += height + CARD.GAP;
  });

  // The drawing keeps its trailing gap: the view is clamped to the drawing's
  // edges, and a card flush against the bottom of the pane looks cut off.
  const height = Math.max(y, 0);
  const width = widest + GUTTER_PAD + EDGE_LANES * LANE_W;
  const merged = mergeEdges(edges, view?.anchors, byKey);
  const routed = routeEdges(merged, byKey, width);

  return { rows, edges: routed, byKey, width, height };
}

/** Merges edges that run between the same two rows with the same reason. */
export function mergeEdges(edges, anchors, byKey) {
  const merged = new Map();
  for (const edge of edges ?? []) {
    const fromKey = anchors?.get(edge.from);
    const toKey = anchors?.get(edge.to);
    if (!fromKey || !toKey || fromKey === toKey) continue;
    if (!byKey.has(fromKey) || !byKey.has(toKey)) continue;
    const id = `${fromKey}>${toKey}:${edge.kind}`;
    let entry = merged.get(id);
    if (!entry) {
      entry = {
        id,
        from: fromKey,
        to: toKey,
        kind: edge.kind,
        count: 0,
        steps: [],
        fromNode: edge.from,
        toNode: edge.to,
      };
      merged.set(id, entry);
    }
    entry.count += edge.count;
    for (const step of edge.steps ?? []) entry.steps.push(step);
  }
  return [...merged.values()];
}

/** The point on `a`'s edge that faces `b`, so short arrows never cross a card. */
function facingPoint(a, b, goingDown) {
  const x = Math.min(Math.max(b.cx, a.x + 14), a.right - 14);
  return { x, y: goingDown ? a.bottom : a.y };
}

/** Squares off a path from one card to another, avoiding the cards themselves. */
function routeEdges(edges, byKey, width) {
  let lane = 0;
  return edges.map((edge) => {
    const from = byKey.get(edge.from);
    const to = byKey.get(edge.to);
    const down = to.y >= from.y;
    // Neighbours in the timeline: a short straight arrow is clearer than a detour.
    if (Math.abs(to.rowIndex - from.rowIndex) === 1) {
      return {
        ...edge,
        lane: null,
        straight: true,
        points: [facingPoint(from, to, down), facingPoint(to, from, !down)],
      };
    }
    const x = width - GUTTER_PAD / 2 - (lane % EDGE_LANES) * LANE_W - LANE_W / 2;
    const index = lane;
    lane += 1;
    return {
      ...edge,
      lane: index,
      straight: false,
      points: [
        facingPoint(from, to, down),
        { x, y: down ? from.bottom + 2 : from.y - 2 },
        { x, y: down ? to.y - 2 : to.bottom + 2 },
        facingPoint(to, from, !down),
      ],
      labelAt: { x, y: (from.cy + to.cy) / 2 },
    };
  });
}

/** The card drawn at a row key, or null. */
export function cardAt(layout, key) {
  return layout?.byKey?.get(key) ?? null;
}
