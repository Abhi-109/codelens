// Dagre layout for one flowchart graph chart (format version 2;
// tracer-poc/flowchart.py, docs/flowchart-format.md). Pure — a chart in,
// positioned nodes with wrapped text lines and edge polylines out — so
// node --test can cover it. The renderer only draws the result, which keeps
// the layout engine swappable.

import { graphlib, layout } from "@dagrejs/dagre";

const CHAR_W = 7.3; // rough width of one character at the chart's font size
const LINE_H = 16;
const PAD_X = 16;
const PAD_Y = 12;
const EDGE_LABEL_H = 18;

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
 * Greedy word-wrap into lines of at most `maxChars`, hard-splitting any single
 * word that is itself too long, so no line can overflow its box.
 * @param {string} text
 * @param {number} maxChars
 * @returns {string[]} at least one line
 */
export function wrapText(text, maxChars) {
  const words = String(text ?? "").split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines = [];
  let line = "";
  for (const word of words) {
    if (line && line.length + 1 + word.length > maxChars) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.flatMap((l) =>
    l.length <= maxChars ? [l] : (l.match(new RegExp(`.{1,${maxChars}}`, "g")) ?? [l]),
  );
}

/**
 * The box size and wrapped display lines for one node.
 * @param {Object} node a graph node
 * @param {boolean} [showCode] measure the raw code instead of the label
 * @returns {{ width: number, height: number, displayLines: string[] }}
 */
export function measureNode(node, showCode = false) {
  const metric = METRICS[node.kind] ?? METRICS.process;
  const lines = wrapText(showCode ? node.code : node.label, metric.maxChars);
  const longest = lines.reduce((n, l) => Math.max(n, l.length), 1);
  let width = Math.max(longest * CHAR_W + PAD_X * 2, metric.width);
  const height = Math.max(lines.length * LINE_H + PAD_Y * 2, metric.height);
  if (metric.diamond) width = Math.max(width * 1.5, metric.width * 1.5);
  return { width: Math.round(width), height: Math.round(height), displayLines: lines };
}

/**
 * Lays one chart out top-to-bottom with dagre.
 * @param {Object} chart one chart from the graph (`functions[name]`)
 * @param {{ showCode?: boolean }} [options]
 * @returns {{ nodes: Array, edges: Array, width: number, height: number }}
 *   positioned nodes (x, y, width, height, displayLines) and edges with a
 *   `points` polyline plus labelX/labelY for edges that carry a label
 */
export function layoutChart(chart, { showCode = false } = {}) {
  const chartNodes = chart?.nodes;
  if (!Array.isArray(chartNodes) || chartNodes.length === 0) {
    return { nodes: [], edges: [], width: 0, height: 0 };
  }

  const graph = new graphlib.Graph({ multigraph: true });
  graph.setGraph({ rankdir: "TB", nodesep: 36, ranksep: 56, marginx: 16, marginy: 16 });
  graph.setDefaultEdgeLabel(() => ({}));

  const measured = new Map();
  for (const node of chartNodes) {
    const size = measureNode(node, showCode);
    measured.set(node.id, size);
    graph.setNode(node.id, { width: size.width, height: size.height });
  }

  const chartEdges = Array.isArray(chart.edges) ? chart.edges : [];
  chartEdges.forEach((edge, i) => {
    const attrs = { label: edge.label ?? "" };
    if (edge.label) {
      attrs.width = edge.label.length * CHAR_W + 10;
      attrs.height = EDGE_LABEL_H;
      attrs.labelpos = "c";
    }
    graph.setEdge(edge.from, edge.to, attrs, `e${i}`);
  });

  layout(graph);

  const nodes = chartNodes.map((node) => {
    const position = graph.node(node.id) ?? { x: 0, y: 0 };
    return { ...node, x: position.x, y: position.y, ...measured.get(node.id) };
  });

  const edges = chartEdges.map((edge, i) => {
    const laid = graph.edge(edge.from, edge.to, `e${i}`) ?? {};
    return {
      from: edge.from,
      to: edge.to,
      label: edge.label ?? null,
      back: Boolean(edge.back),
      points: laid.points ?? [],
      labelX: laid.x ?? null,
      labelY: laid.y ?? null,
    };
  });

  const meta = graph.graph() ?? {};
  return { nodes, edges, width: meta.width ?? 0, height: meta.height ?? 0 };
}
