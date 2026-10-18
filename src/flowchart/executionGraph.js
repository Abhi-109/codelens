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
// Each node also carries what the *learner* needs, all of it read from the
// trace: which call it belongs to (frameId, depth), what the line does in a few
// words (action, from explainAction), and when it ran (firstStep, lastStep,
// runs). Values and changes are per-step, so the renderer reads them through
// getStepView for the step a node was last current on.
//
// Pure: no React. node --test covers it; layoutGraph.js does the geometry.

import { explainAction, statementKind } from "../tracer/explain.js";
import { showValue } from "../tracer/values.js";
import { paramsFor } from "../tracer/stepView.js";

export const MODULE = "<module>";
/** Advance width of the 13px monospace label, plus a little slack. */
const CHAR_W = 7.6;

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

/** Rough width of a string in the 13px monospace label font. */
export function textWidth(text, charWidth = CHAR_W) {
  return String(text ?? "").length * charWidth;
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

  function ensureLine(event, index) {
    const nodeId = id(event.frame_id, event.line);
    if (!nodes.has(nodeId)) {
      const text = sourceLine(source, event.line);
      nodes.set(nodeId, {
        id: nodeId,
        frameId: event.frame_id,
        function: event.function ?? MODULE,
        line: event.line,
        text,
        stepKind: statementKind(text),
        action: explainAction(event, list, index, source),
        /** How many frames deep this line ran: the <module> body is 0. */
        depth: Math.max((event.frames?.length ?? 1) - 1, 0),
        firstStep: index,
        lastStep: index,
        runs: 1,
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
      const toId = ensureLine(event, i);
      const node = nodes.get(toId);
      if (node.lastStep !== i) {
        node.runs += 1;
        node.lastStep = i;
      }
      if (cursor) addEdge(cursor, toId, kindForLineStep(cursor, toId), i);
      cursor = toId;
      lastLine.set(event.frame_id, toId);
    } else if (event.event === "return" || event.event === "unwind") {
      const fromId = lastLine.get(event.frame_id) ?? cursor;
      const kind = event.event === "return" ? "return" : "error";
      const anchor = nextAnchor(i);
      let dest = null;
      if (anchor?.event === "line") dest = ensureLine(anchor, anchor.step ?? list.indexOf(anchor));
      else if (anchor) dest = lastLine.get(anchor.frame_id) ?? null;
      if (fromId && dest) addEdge(fromId, dest, kind, anchor.step ?? i);
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

/**
 * What each call was, in the learner's words: the arguments it was given, the
 * line that called it, and what it handed back. Built from the trace only.
 * @param {Array} trace the trace array from docs/trace-format.md
 * @param {string} [source] the user's code, for parameter names
 * @returns {Map<number, Object>} keyed by frame_id
 */
export function callFrames(trace, source = "") {
  const list = Array.isArray(trace) ? trace : [];
  const frames = new Map();
  for (let i = 0; i < list.length; i += 1) {
    const event = list[i];
    const stack = event?.frames;
    const top = stack?.[stack.length - 1];
    if (!top) continue;
    let info = frames.get(top.frame_id);
    if (!info) {
      const params = top.function === MODULE ? [] : paramsFor(source, top.function);
      const variables = top.variables ?? {};
      info = {
        frameId: top.frame_id,
        function: top.function ?? MODULE,
        callLine: top.call_line ?? null,
        depth: Math.max(stack.length - 1, 0),
        firstIndex: i,
        lastIndex: i,
        firstLine: null,
        returnIndex: null,
        returnText: null,
        args: params
          .filter((name) => name in variables)
          .map((name) => ({ name, text: showValue(variables[name], event.heap) })),
      };
      frames.set(top.frame_id, info);
    }
    info.lastIndex = i;
    if (event.event === "line" && event.frame_id === top.frame_id && info.firstLine === null) {
      info.firstLine = event.line;
    }
    if (event.event === "return" && event.frame_id === top.frame_id) {
      if (info.returnIndex === null) {
        info.returnIndex = i;
        info.returnText = event.return_value ? showValue(event.return_value, event.heap) : null;
      }
    }
    if (event.event === "unwind" && event.frame_id === top.frame_id && info.returnIndex === null) {
      info.returnIndex = i;
      info.returnText = null;
      info.raised = true;
    }
  }
  for (const info of frames.values()) {
    if (info.function === MODULE) {
      info.label = MODULE;
    } else if (isClassBody(source, info)) {
      // `class Dog:` runs as a frame of its own. Calling it `Dog()` would read
      // like an instance being built, so say what it really is.
      info.classBody = true;
      info.label = `${info.function} (class body)`;
    } else {
      info.label = `${info.function}(${info.args.map((arg) => arg.text).join(", ")})`;
    }
  }
  return frames;
}

/** True when a frame is the body of `class Name:` rather than a call to it. */
function isClassBody(source, info) {
  if (info.firstLine === null || !info.function) return false;
  const text = (source ?? "").split("\n")[info.firstLine - 1] ?? "";
  return new RegExp(`^\\s*class\\s+${info.function}\\b`).test(text);
}

/**
 * The rows the graph shows at one step: the nodes in execution order, with the
 * calls that have already finished folded into one summary row each (unless
 * they are on the current call stack or the learner expanded them).
 *
 * @param {Object} graph from buildExecutionGraph
 * @param {{ index?: number, stack?: number[], calls?: Map, expanded?: Set<number>, fold?: boolean }} [options]
 * @returns {{ rows: Array<Object>, anchors: Map<string, string> }}
 */
export function visibleRows(graph, options = {}) {
  const { index = 0, stack = [], calls = null, expanded = null, fold = true } = options;
  const nodes = graph?.nodes ?? [];
  const rows = [];
  const anchors = new Map();
  const onStack = new Set(stack);
  const open = expanded instanceof Set ? expanded : new Set(expanded ?? []);
  const countPerFrame = new Map();
  for (const node of nodes) {
    countPerFrame.set(node.frameId, (countPerFrame.get(node.frameId) ?? 0) + 1);
  }
  const folded = new Map();

  for (const node of nodes) {
    const info = calls?.get(node.frameId) ?? null;
    const finished = info?.returnIndex != null && info.returnIndex < index;
    const hide = fold && finished && !onStack.has(node.frameId) && !open.has(node.frameId);
    if (!hide) {
      const key = `n:${node.id}`;
      rows.push({ key, kind: "node", ...node });
      anchors.set(node.id, key);
      continue;
    }
    let key = folded.get(node.frameId);
    if (!key) {
      key = `c:${node.frameId}`;
      folded.set(node.frameId, key);
      rows.push({
        key,
        kind: "call",
        frameId: node.frameId,
        function: node.function,
        label: info?.label ?? functionLabel(node.function),
        depth: node.depth,
        firstStep: info?.firstIndex ?? node.firstStep,
        count: countPerFrame.get(node.frameId) ?? 1,
        returned: info?.returnText ?? null,
        raised: Boolean(info?.raised),
      });
    }
    anchors.set(node.id, key);
  }

  return { rows, anchors };
}
