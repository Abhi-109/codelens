// Why the graph is drawn the way it is: what each edge means, which way a
// condition actually went, and the real values behind a decision chip.
//
// Pure: it reads the trace and the source only, so node --test can prove the
// graph's labels come from the run and not from a guess.

import { blockEnd, substituteVars } from "../tracer/explain.js";
import { stateAt } from "../tracer/stepView.js";

/** A line whose first move is a yes/no decision: if, elif, while or for. */
const DECISION_RE = /^(?:el)?if\s+.*:\s*$|^while\s+.*:\s*$|^for\s+.*:\s*$/;

/** True when a node's line is a condition/loop header. */
export function isDecision(text) {
  return DECISION_RE.test((text ?? "").trim());
}

function lineIndent(source, line) {
  const raw = (source ?? "").split("\n")[line - 1] ?? "";
  return raw.length - raw.trimStart().length;
}

/**
 * The word for an edge: "next", "Yes"/"No" after a condition, "call",
 * "return", "loop" or "error".
 * @param {{ kind: string }} edge from buildExecutionGraph
 * @param {Object} from the node the edge starts at
 * @param {Object} to the node it ends at
 * @param {string} source the user's code
 */
export function edgeReason(edge, from, to, source = "") {
  switch (edge?.kind) {
    case "call":
      return "call";
    case "return":
      return "return";
    case "back":
      return "loop";
    case "error":
      return "error";
    default:
      break;
  }
  if (!isDecision(from?.text)) return "next";
  const end = blockEnd(source, from.line, lineIndent(source, from.line));
  const enters =
    Boolean(to) && to.frameId === from.frameId && to.line > from.line && to.line <= end;
  return enters ? "Yes" : "No";
}

/**
 * The result chip for a decision node: the condition with the real values it
 * read, and whether it was True or False. Null for non-decision nodes and for
 * decisions that have not run yet at `index`.
 * @returns {{ text: string, yes: boolean } | null}
 */
export function decisionResult(node, trace, graph, source = "", index = Infinity) {
  const text = (node?.text ?? "").trim();
  // A `for` header is not a yes/no question in the same way, so it gets no chip.
  if (!node || !isDecision(text) || /^for\s/.test(text)) return null;
  let at = -1;
  for (let i = Math.min(index, (graph?.steps?.length ?? 0) - 1); i >= 0; i -= 1) {
    if (graph.steps[i] === node.id) {
      at = i;
      break;
    }
  }
  if (at < 0) return null;
  const state = stateAt(trace, at);
  const frame = state?.frames?.[state.frames.length - 1];
  const variables = frame?.variables ?? {};
  const question = text.replace(/^(?:(?:el)?if|while)\s+/, "").replace(/:\s*$/, "");
  const condition = substituteVars(question, variables, state?.heap);
  const nextId = graph.steps[at + 1] ?? null;
  const next = graph.nodes.find((entry) => entry.id === nextId) ?? null;
  const yes = edgeReason({ kind: "next" }, node, next, source) === "Yes";
  return { text: `${condition} is ${yes ? "True" : "False"}`, yes };
}
