// Deterministic, dependency-free layout for one flowchart chart (format
// version 2; tracer-poc/flowchart.py, docs/flowchart-format.md). Pure — a
// chart in, positioned nodes with wrapped text lines and edge polylines out —
// so `node --test` can cover it. The renderer only draws the result.
//
// It is a hand-rolled *layered* layout rather than a graph library, for two
// reasons that both matter here. It has no dependency to weigh the bundle
// down, and — more importantly — it is completely deterministic: the same
// chart always lands in exactly the same place, on every machine and every
// reload, so a learner who steps backwards sees the same diagram rather than a
// rearranged one.
//
//   1. Ranks   the longest path from the entry, ignoring the edges the format
//              itself calls `back`. A cycle the format did not mark is broken
//              by the iteration cap below rather than by hanging.
//   2. Order   a few barycentre sweeps inside each rank, to cut crossings.
//              Ties keep source order, which is what makes it stable.
//   3. Rows    each rank is one row: boxes side by side, the row centred.
//   4. Arrows  straight down for a step forward, straight across for two
//              boxes on the same row, and around the right-hand side for an
//              arrow that loops back — one private channel per back arrow, so
//              two `continue`s in nested loops never draw over each other.

import { wrapText } from "./executionGraph.js";

/** Advance width of the chart's 13px-ish label font. */
export const CHAR_W = 7.3;
export const LINE_H = 16;
export const PAD_X = 16;
export const PAD_Y = 12;
/** Horizontal breathing room between two boxes on the same row. */
export const NODE_SEP = 36;
/** Vertical room between two rows, for the arrow that joins them. */
export const RANK_SEP = 56;
/** Extra height reserved under every box when values and run counts are on. */
export const VALUE_H = 18;
export const MARGIN = 20;
/** How far apart the routed channels for loop-back arrows are. */
export const CHANNEL_GAP = 15;
/** How much room one routed channel needs, measured from the drawing's edge. */
export const CHANNEL_PAD = 16;

// Minimum box per node kind, plus the widest each kind wraps its text at.
// Diamonds need extra width because their text sits in the narrow middle.
const METRICS = {
  start: { width: 90, height: 36, maxChars: 16 },
  end: { width: 90, height: 36, maxChars: 16 },
  return: { width: 120, height: 40, maxChars: 22 },
  process: { width: 140, height: 44, maxChars: 26 },
  io: { width: 160, height: 46, maxChars: 24 },
  call: { width: 170, height: 46, maxChars: 24 },
  decision: { width: 160, height: 64, maxChars: 18, diamond: true },
  loop: { width: 170, height: 64, maxChars: 18, diamond: true },
};

/**
 * The box size and wrapped display lines for one node.
 * @param {Object} node a graph node
 * @param {boolean} [showCode] measure the raw code instead of the label
 * @param {boolean} [showValues] reserve the bottom row for values and run counts
 * @returns {{ width: number, height: number, displayLines: string[] }}
 */
export function measureNode(node, showCode = false, showValues = false) {
  const metric = METRICS[node?.kind] ?? METRICS.process;
  const lines = wrapText(showCode ? node.code : node.label, metric.maxChars);
  const longest = lines.reduce((n, l) => Math.max(n, l.length), 1);
  let width = Math.max(longest * CHAR_W + PAD_X * 2, metric.width);
  const height =
    Math.max(lines.length * LINE_H + PAD_Y * 2, metric.height) + (showValues ? VALUE_H : 0);
  if (metric.diamond) width = Math.max(width * 1.5, metric.width * 1.5);
  return { width: Math.round(width), height: Math.round(height), displayLines: lines };
}

/** Ranks: longest path from the entry, over the edges that are not loop-backs. */
export function rankNodes(nodes, edges) {
  const rank = new Map(nodes.map((node) => [node.id, 0]));
  const preds = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges ?? []) {
    if (edge.back || edge.from === edge.to) continue;
    if (!rank.has(edge.from) || !rank.has(edge.to)) continue;
    preds.get(edge.to).push(edge.from);
  }
  // Relax at most once per node: enough for a tree or a DAG, and a hard stop
  // for the rare cycle the format failed to mark.
  for (let pass = 0; pass < nodes.length; pass += 1) {
    let changed = false;
    for (const node of nodes) {
      let best = 0;
      for (const from of preds.get(node.id)) best = Math.max(best, rank.get(from) + 1);
      if (best > rank.get(node.id)) {
        rank.set(node.id, best);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return rank;
}

/** Mean position of an id's neighbours on the other side, for the sweeps. */
function barycentre(id, neighbours, position) {
  const list = neighbours.get(id) ?? [];
  let total = 0;
  let n = 0;
  for (const other of list) {
    const at = position.get(other);
    if (at != null) {
      total += at;
      n += 1;
    }
  }
  return n > 0 ? total / n : (position.get(id) ?? 0);
}

/**
 * Reorders each row to reduce crossings: down, then up, a few times. The sort
 * is stable and only ever moves on the barycentre, so the source order of the
 * graph decides every tie — which is what makes the whole layout repeatable.
 *
 * It keeps its own row-position map, because it rewrites that map on every
 * sweep. Handing it the ranks would silently destroy them, and the routing
 * below would then be reading row order as if it were depth.
 */
function orderRows(rows, edges) {
  const known = new Set(rows.flat());
  const preds = new Map();
  const succs = new Map();
  for (const edge of edges ?? []) {
    if (edge.back) continue;
    if (!known.has(edge.from) || !known.has(edge.to)) continue;
    if (!preds.has(edge.to)) preds.set(edge.to, []);
    preds.get(edge.to).push(edge.from);
    if (!succs.has(edge.from)) succs.set(edge.from, []);
    succs.get(edge.from).push(edge.to);
  }
  const position = new Map();
  const reindex = () => {
    position.clear();
    rows.forEach((ids) => ids.forEach((id, i) => position.set(id, i)));
  };
  reindex();
  for (let pass = 0; pass < 3; pass += 1) {
    for (let r = 1; r < rows.length; r += 1) {
      rows[r].sort((a, b) => barycentre(a, preds, position) - barycentre(b, preds, position));
      reindex();
    }
    for (let r = rows.length - 2; r >= 0; r -= 1) {
      rows[r].sort((a, b) => barycentre(a, succs, position) - barycentre(b, succs, position));
      reindex();
    }
  }
}

/** `M x y L …` for a polyline, so the renderer never builds paths itself. */
export function pathOf(points) {
  if (!Array.isArray(points) || points.length < 2) return "";
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
}

/**
 * Lays one chart out top to bottom.
 * @param {Object} chart one chart from the graph (`functions[name]`)
 * @param {{ showCode?: boolean }} [options]
 * @returns {{ nodes: Array, edges: Array, width: number, height: number }}
 *   positioned nodes (x, y, width, height, displayLines) and edges with a
 *   `points` polyline plus labelX/labelY for edges that carry a label
 */
export function layoutChart(chart, { showCode = false, showValues = false } = {}) {
  const chartNodes = chart?.nodes;
  if (!Array.isArray(chartNodes) || chartNodes.length === 0) {
    return { nodes: [], edges: [], width: 0, height: 0 };
  }
  const chartEdges = Array.isArray(chart.edges) ? chart.edges : [];
  const rank = rankNodes(chartNodes, chartEdges);

  // Bucket by rank, keeping the graph's own source order as the starting order.
  const maxRank = chartNodes.reduce((best, node) => Math.max(best, rank.get(node.id)), 0);
  const rows = [];
  for (let r = 0; r <= maxRank; r += 1) rows.push([]);
  for (const node of chartNodes) rows[rank.get(node.id)].push(node.id);
  orderRows(rows, chartEdges);

  // Measure once — the size of a box depends on its label and never on the step.
  const measured = new Map();
  for (const node of chartNodes) measured.set(node.id, measureNode(node, showCode, showValues));

  // Row sizes first, so every row can then be centred on the widest one.
  const rowWidth = rows.map((ids) =>
    ids.reduce((sum, id, i) => sum + measured.get(id).width + (i > 0 ? NODE_SEP : 0), 0),
  );
  const widest = rowWidth.reduce((a, b) => Math.max(a, b), 0);
  const rowHeight = rows.map((ids) =>
    ids.reduce((tallest, id) => Math.max(tallest, measured.get(id).height), 0),
  );

  const position = new Map();
  let top = MARGIN;
  rows.forEach((ids, r) => {
    let left = MARGIN + (widest - rowWidth[r]) / 2;
    for (const id of ids) {
      const size = measured.get(id);
      position.set(id, {
        x: Math.round(left + size.width / 2),
        y: Math.round(top + rowHeight[r] / 2),
        width: size.width,
        height: size.height,
      });
      left += size.width + NODE_SEP;
    }
    top += rowHeight[r] + RANK_SEP;
  });

  let right = MARGIN;
  let bottom = MARGIN;
  for (const box of position.values()) {
    right = Math.max(right, box.x + box.width / 2);
    bottom = Math.max(bottom, box.y + box.height / 2);
  }

  // One private channel per looping-back arrow, out past the right-hand edge.
  const backEdges = chartEdges.filter(
    (edge) => Boolean(edge.back) || (rank.get(edge.to) ?? 0) <= (rank.get(edge.from) ?? 0),
  );
  const channelX = (i) => Math.round(right + CHANNEL_PAD + i * CHANNEL_GAP);
  const channelUsed = backEdges.length > 0 ? CHANNEL_PAD + backEdges.length * CHANNEL_GAP : 0;

  const nodes = chartNodes.map((node) => ({
    ...node,
    ...position.get(node.id),
    displayLines: measured.get(node.id).displayLines,
  }));

  const edges = [];
  chartEdges.forEach((edge, i) => {
    const from = position.get(edge.from);
    const to = position.get(edge.to);
    if (!from || !to) return;
    const back = Boolean(edge.back) || rank.get(edge.to) <= rank.get(edge.from);
    const label = edge.label ?? null;
    let points;
    let labelX = null;
    let labelY = null;

    if (back) {
      // Out of the right-hand side, down its own channel, back in on the right.
      const start = { x: Math.round(from.x + from.width / 2), y: Math.round(from.y) };
      const end = { x: Math.round(to.x + to.width / 2), y: Math.round(to.y) };
      const cx = channelX(i);
      points =
        from.id === to.id
          ? [start, { x: cx, y: start.y }, { x: cx, y: start.y + 1 }, end]
          : [start, { x: cx, y: start.y }, { x: cx, y: end.y }, end];
      labelX = Math.round(start.x + 26);
      labelY = Math.round(start.y - 9);
    } else if (rank.get(edge.to) > rank.get(edge.from)) {
      const start = { x: from.x, y: Math.round(from.y + from.height / 2) };
      const end = { x: to.x, y: Math.round(to.y - to.height / 2) };
      if (Math.abs(start.x - end.x) < 0.5) {
        points = [start, end];
      } else {
        const midY = Math.round(start.y + (end.y - start.y) / 2);
        points = [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end];
      }
      // Beside the first segment: left when the arrow leans left, right when it
      // goes straight down or leans right, so a Yes/No never covers the arrow.
      const side = end.x < start.x ? -1 : 1;
      labelX = Math.round(start.x + side * 24);
      labelY = Math.round(start.y + 15);
    } else {
      // Two boxes on the same row: straight across.
      const toRight = to.x >= from.x;
      const start = {
        x: Math.round(from.x + (toRight ? from.width : -from.width) / 2),
        y: Math.round(from.y),
      };
      const end = {
        x: Math.round(to.x + (toRight ? -to.width : to.width) / 2),
        y: Math.round(to.y),
      };
      points = [start, end];
      labelX = Math.round((start.x + end.x) / 2);
      labelY = Math.round(start.y - 9);
    }

    edges.push({
      from: edge.from,
      to: edge.to,
      label,
      back,
      points,
      labelX,
      labelY,
      key: `${edge.from}>${edge.to}#${i}`,
    });
  });

  return {
    nodes,
    edges,
    width: Math.round(right + MARGIN + channelUsed),
    height: Math.round(bottom + MARGIN),
  };
}
