// Deterministic top-down geometry for the call tree. Pure: a tree (plus which
// subtrees the learner folded) in, boxes and connectors out, so `node --test`
// can assert there is never a stray pixel and never a moving one.
//
// The layout deliberately reads *nothing* about the current step. The whole
// tree is already known the moment the run finishes — arguments, return values
// and failures come from the complete trace — so a frame's box keeps the same
// x, y, width and height as execution advances. Only CSS classes change, which
// is what lets Stage 4 animate a state instead of sliding the diagram around.
//
// Shape: a classic tidy tree. Each node owns a horizontal slice of its row the
// width of its subtree; children divide that slice; the parent sits in the
// middle of theirs. Rows are one box tall plus a gap for the connector.

import { MODULE, textWidth, wrapText } from "./executionGraph.js";

/** Advance width of the 13px monospace node label. */
export const CHAR_W = 7.6;
export const LINE_H = 15;
export const PAD_X = 12;
export const PAD_Y = 9;
/** Horizontal breathing room between sibling subtrees — also fits edge labels. */
export const H_GAP = 34;
/** Vertical room between rows, for the parent-to-child connector. */
export const V_GAP = 44;
export const MIN_W = 128;
export const MAX_W = 244;
/** Outer padding kept around the drawing so fit-to-view never clips a border. */
export const BOUNDS_PAD = 16;

/** How many characters a wrapped label line may hold before it hard-splits. */
export const MAX_CHARS = Math.max(8, Math.floor((MAX_W - 2 * PAD_X) / CHAR_W));

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/**
 * The box a call gets: its wrapped label, whether a return-value line is
 * reserved under it, and the size that comes to.
 *
 * The return line is reserved whenever the *whole run* shows the frame
 * returning or unwinding — never "when the step arrives" — so a node's height
 * never changes under the learner's cursor.
 *
 * @param {Object} node from buildCallTree
 * @returns {{ lines: string[], value: string|null, w: number, h: number }}
 */
export function measureCallNode(node) {
  const label = String(node?.label ?? node?.function ?? "");
  const lines = wrapText(label, MAX_CHARS);
  // Reserve the second line only when the run really has something to say:
  // a value the frame handed back, or the exception that took it away. Both are
  // known from the whole trace, so the height never depends on the step.
  //
  // The module frame is the exception to the exception: it always "returns"
  // None, which is a fact about Python rather than about this program, so
  // printing it under `<module>` would only raise a question. Its *failures*
  // still show — those say something real about the run.
  const silentModule = node?.function === MODULE && !node.raised;
  const hasReturnLine =
    node?.returnIndex != null &&
    (Boolean(node.raised) || (node.returnText != null && !silentModule));
  const value = hasReturnLine ? returnTextFor(node) : null;
  const w = clamp(
    Math.max(MIN_W, textWidth(lines.reduce((a, b) => (a.length >= b.length ? a : b)), CHAR_W) + 2 * PAD_X),
    MIN_W,
    MAX_W,
  );
  const h = (lines.length + (hasReturnLine ? 1 : 0)) * LINE_H + 2 * PAD_Y;
  return { lines, value, w, h };
}

/** What a finished frame shows under its label: its result or its failure. */
function returnTextFor(node) {
  if (node.raised) return `✕ ${node.raisedType ?? "raised"}`;
  return node.returnText == null ? "" : `→ ${node.returnText}`;
}

/** The nodes whose boxes are drawn: the roots plus every unfolded child. */
export function visibleChildren(node, collapsed) {
  if (!node) return [];
  if (collapsed?.has?.(node.frameId)) return [];
  return node.children ?? [];
}

/**
 * Places the whole tree.
 *
 * @param {{ nodes: Array, roots: Array }} tree from buildCallTree
 * @param {{ collapsed?: Set<number> }} [options]
 * @returns {{
 *   boxes: Array<{id: number, x: number, y: number, w: number, h: number,
 *                 cx: number, cy: number, lines: string[], value: string|null,
 *                 depth: number, hidden: number, hasChildren: boolean}>,
 *   links: Array<{id: string, fromId: number, toId: number, points: Array<{x:number,y:number}>}>,
 *   width: number, height: number, ready: boolean,
 * }}
 */
export function layoutCallTree(tree, options = {}) {
  const collapsed = options.collapsed ?? new Set();
  const roots = tree?.roots ?? [];
  const all = tree?.nodes ?? [];

  if (all.length === 0) {
    return { boxes: [], links: [], width: 0, height: 0, ready: false };
  }

  // 1. Measure every box once — this part depends only on labels and on
  //    whether the run ever returned a value.
  const measured = new Map();
  let maxH = 0;
  for (const node of all) {
    const box = measureCallNode(node);
    measured.set(node.frameId, box);
    maxH = Math.max(maxH, box.h);
  }
  const rowH = maxH + V_GAP;

  // 2. Subtree widths, children before parents (reverse pre-order).
  const subtreeW = new Map();
  const widthOf = (node) => measured.get(node.frameId).w;
  for (let i = all.length - 1; i >= 0; i -= 1) {
    const node = all[i];
    const kids = visibleChildren(node, collapsed);
    let sum = 0;
    kids.forEach((kid, k) => {
      sum += subtreeW.get(kid.frameId) ?? widthOf(kid);
      if (k > 0) sum += H_GAP;
    });
    subtreeW.set(node.frameId, kids.length === 0 ? widthOf(node) : Math.max(widthOf(node), sum));
  }

  // 3. Place, roots first, an explicit stack so a 700-deep chain is fine.
  const boxes = [];
  const links = [];
  const rowY = (depth) => BOUNDS_PAD + depth * rowH;
  const pending = [...roots].reverse().map((node) => ({ node, left: BOUNDS_PAD, depth: 0 }));

  while (pending.length > 0) {
    const { node, left, depth } = pending.pop();
    const measuredBox = measured.get(node.frameId);
    const span = subtreeW.get(node.frameId) ?? measuredBox.w;
    const x = left + (span - measuredBox.w) / 2;
    const y = rowY(depth);
    const box = {
      id: node.frameId,
      x,
      y,
      w: measuredBox.w,
      h: measuredBox.h,
      cx: x + measuredBox.w / 2,
      cy: y + measuredBox.h / 2,
      lines: measuredBox.lines,
      value: measuredBox.value,
      depth,
      hidden: collapsed.has(node.frameId) ? node.children.length : 0,
      hasChildren: node.children.length > 0,
      raised: Boolean(node.raised),
      returnIndex: node.returnIndex,
      firstIndex: node.firstIndex,
      function: node.function,
      label: node.label,
      parentId: node.parentId,
    };
    boxes.push(box);

    const kids = visibleChildren(node, collapsed);
    if (kids.length > 0) {
      let sum = 0;
      kids.forEach((kid, k) => {
        sum += subtreeW.get(kid.frameId) ?? widthOf(kid);
        if (k > 0) sum += H_GAP;
      });
      let cursor = left + (span - sum) / 2;
      const next = [];
      for (const kid of kids) {
        const kidW = subtreeW.get(kid.frameId) ?? widthOf(kid);
        next.push({ node: kid, left: cursor, depth: depth + 1 });
        links.push({
          id: `${node.frameId}>${kid.frameId}`,
          fromId: node.frameId,
          toId: kid.frameId,
          points: linkPoints(
            { cx: box.cx, bottom: box.y + box.h },
            { cx: cursor + widthOf(kid) / 2, top: rowY(depth + 1) },
          ),
        });
        cursor += kidW + H_GAP;
      }
      // Pushed in reverse so they pop left to right: `boxes` comes out in
      // pre-order, which is both the drawing order and the reading order.
      for (let i = next.length - 1; i >= 0; i -= 1) pending.push(next[i]);
    }
  }

  let width = 0;
  let height = 0;
  for (const box of boxes) {
    width = Math.max(width, box.x + box.w);
    height = Math.max(height, box.y + box.h);
  }

  return {
    boxes,
    links,
    width: width + BOUNDS_PAD,
    height: height + BOUNDS_PAD,
    ready: true,
  };
}

/** Parent bottom → child top, with a right-angle jog when they are offset. */
function linkPoints(from, to) {
  const start = { x: from.cx, y: from.bottom };
  const end = { x: to.cx, y: to.top };
  if (Math.abs(start.x - end.x) < 0.5) return [start, end];
  const midY = start.y + (end.y - start.y) / 2;
  return [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end];
}

/** `M x y L …` for a connector polyline, or null when there is nothing to draw. */
export function linkPath(points) {
  if (!Array.isArray(points) || points.length < 2) return null;
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
}
