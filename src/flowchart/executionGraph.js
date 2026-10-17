// Builds an *execution graph* from a trace: a node for every source line that
// actually ran, keyed by the call it ran in, and an edge for every way control
// moved between them. Built from docs/trace-format.md output, so it shows what
// really happened — including recursion fanning out into a tree (each call has
// its own frame_id) and returns running back up as back-edges.
//
//   node id  = f<frame_id>l<line>   (so recursion gets distinct nodes)
//   edge     = { from, to, kind, count, steps }   kind is one of
//              "next"  a later line in the same call
//              "back"  an earlier line in the same call (a loop going round)
//              "call"  into a deeper call
//              "return" back out to the caller
//              "error" an exception unwinding out of a call
//
//   steps[i] = the node the token sits on at trace step i, so the UI can walk
//              the token through the graph as the learner steps.
//
// Pure: no React, no dagre — node --test covers it. The dagre pass lives in
// layoutExecutionGraph below.

import { graphlib, layout } from "@dagrejs/dagre";

const MODULE = "<module>";
/** Advance width of the 13px monospace label, plus a little slack. */
const CHAR_W = 7.6;
/** Labels stay to one or two short lines, so nodes stay small on screen. */
const MAX_CHARS = 22;
const MAX_LINES = 2;

// Box metrics, shared with the renderer so text lands in the right place.
// Kept small on purpose: the graph must stay compact enough to sit in a pane.
export const NODE = { PAD: 6, LINE_H: 15 };

/** Greedy word-wrap, hard-splitting a single overlong word, never empty. */
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

function sourceLine(source, line) {
  const text = (source.split("\n")[line - 1] ?? "").trim();
  return text || `line ${line}`;
}

/** Human label for a frame's function. */
export function functionLabel(name) {
  return name === MODULE ? MODULE : `${name}()`;
}

/**
 * Walks the trace and builds the execution graph.
 * @param {Array} trace the trace array from docs/trace-format.md
 * @param {string} [source] the user's code, for line text
 * @returns {{ nodes: Array, edges: Array, steps: Array<string|null> }}
 */
export function buildExecutionGraph(trace, source = "") {
  const list = Array.isArray(trace) ? trace : [];
  const nodes = new Map();
  const edges = new Map();
  const order = [];
  const steps = new Array(list.length).fill(null);
  const lastLine = new Map(); // frame_id -> its most recent line node
  let cursor = null;

  const id = (frameId, line) => `f${frameId}l${line}`;

  function ensureLine(event) {
    const nodeId = id(event.frame_id, event.line);
    if (!nodes.has(nodeId)) {
      nodes.set(nodeId, {
        id: nodeId,
        frameId: event.frame_id,
        function: event.function ?? MODULE,
        line: event.line,
        text: sourceLine(source, event.line),
      });
      order.push(nodeId);
    }
    return nodeId;
  }

  function addEdge(from, to, kind, arrival) {
    if (from == null || to == null || from === to) return;
    const edgeId = `${from}>${to}:${kind}`;
    let edge = edges.get(edgeId);
    if (!edge) {
      edge = { id: edgeId, from, to, kind, count: 0, firstStep: arrival, steps: [] };
      edges.set(edgeId, edge);
    }
    edge.count += 1;
    edge.steps.push(arrival);
  }

  function kindForLineStep(fromId, toId) {
    const from = nodes.get(fromId);
    const to = nodes.get(toId);
    if (from.frameId === to.frameId) return to.line < from.line ? "back" : "next";
    return "call";
  }

  // The next line/return/unwind event after `from` — where control lands.
  function nextAnchor(from) {
    for (let j = from + 1; j < list.length; j += 1) {
      const e = list[j];
      if (e.event === "line" || e.event === "return" || e.event === "unwind") return e;
    }
    return null;
  }

  for (let i = 0; i < list.length; i += 1) {
    const event = list[i];

    if (event.event === "line") {
      const toId = ensureLine(event);
      if (cursor) addEdge(cursor, toId, kindForLineStep(cursor, toId), i);
      cursor = toId;
      lastLine.set(event.frame_id, toId);
    } else if (event.event === "return" || event.event === "unwind") {
      const fromId = lastLine.get(event.frame_id) ?? cursor;
      const kind = event.event === "return" ? "return" : "error";
      const anchor = nextAnchor(i);
      let dest = null;
      if (anchor?.event === "line") dest = ensureLine(anchor);
      else if (anchor) dest = lastLine.get(anchor.frame_id) ?? null;
      if (fromId && dest) addEdge(fromId, dest, kind, anchor.index);
      cursor = fromId;
    }
    // output / input / call / exception / limits leave the cursor where it is
    steps[i] = cursor;
  }

  return { nodes: order.map((nodeId) => nodes.get(nodeId)), edges: [...edges.values()], steps };
}

/**
 * Every step index at which each node is the current one, in order. Powers the
 * "ran N times" badge and the click-a-node run picker.
 * @param {{ steps: Array<string|null> }} graph from buildExecutionGraph
 * @returns {Map<string, number[]>}
 */
export function nodeRuns(graph) {
  const runs = new Map();
  (graph?.steps ?? []).forEach((id, i) => {
    if (!id) return;
    const list = runs.get(id) ?? [];
    list.push(i);
    runs.set(id, list);
  });
  return runs;
}

/** Trims a line and marks it as cut short. */
function ellipsize(text, maxChars) {
  const cut = text.length > maxChars - 1 ? text.slice(0, maxChars - 1) : text;
  return `${cut.trimEnd()}…`;
}

/**
 * Wraps a label to at most `maxLines` lines. Anything that will not fit is
 * folded into an ellipsis on the last line, so text is never clipped by the box.
 */
export function fitLines(text, maxChars = MAX_CHARS, maxLines = MAX_LINES) {
  const wrapped = wrapText(text, maxChars);
  if (wrapped.length <= maxLines) return { lines: wrapped, truncated: false };
  const lines = wrapped.slice(0, maxLines);
  lines[maxLines - 1] = ellipsize(lines[maxLines - 1], maxChars);
  return { lines, truncated: true };
}

/** The box size and (possibly truncated) label lines for one execution node. */
export function measureNode(node) {
  const { lines, truncated } = fitLines(node.text);
  const longest = lines.reduce((n, l) => Math.max(n, l.length), 1);
  const width = Math.min(Math.max(longest * CHAR_W + NODE.PAD * 2, 84), 200);
  const height = lines.length * NODE.LINE_H + NODE.PAD * 2;
  return { width: Math.round(width), height: Math.round(height), displayLines: lines, truncated };
}

/**
 * Positions an execution graph top-to-bottom with dagre. Ranks follow the
 * edges, so a call sits below its caller and a return points back upward.
 * @param {{ nodes: Array, edges: Array }} graph from buildExecutionGraph
 * @returns {{ nodes: Array, edges: Array, width: number, height: number }}
 */
export function layoutExecutionGraph(graph) {
  if (!graph || graph.nodes.length === 0) {
    return { nodes: [], edges: [], width: 0, height: 0 };
  }

  const g = new graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: "TB", nodesep: 14, ranksep: 18, marginx: 8, marginy: 8 });
  g.setDefaultEdgeLabel(() => ({}));

  const measured = new Map();
  for (const node of graph.nodes) {
    const size = measureNode(node);
    measured.set(node.id, size);
    g.setNode(node.id, { width: size.width, height: size.height });
  }
  graph.edges.forEach((edge, i) => {
    g.setEdge(edge.from, edge.to, {}, `e${i}`);
  });

  layout(g);

  const nodes = graph.nodes.map((node) => {
    const position = g.node(node.id) ?? { x: 0, y: 0 };
    return { ...node, x: position.x, y: position.y, ...measured.get(node.id) };
  });
  const edges = graph.edges.map((edge, i) => {
    const laid = g.edge(edge.from, edge.to, `e${i}`) ?? {};
    return { ...edge, points: laid.points ?? [] };
  });

  const meta = g.graph() ?? {};
  return { nodes, edges, width: meta.width ?? 0, height: meta.height ?? 0 };
}
