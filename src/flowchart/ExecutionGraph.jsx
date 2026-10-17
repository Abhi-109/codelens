import { useId, useMemo } from "react";
import { buildExecutionGraph, functionLabel, layoutExecutionGraph } from "./executionGraph.js";

const EDGE_KINDS = ["next", "back", "call", "return", "error"];
const PAD = 10;

function edgePath(points) {
  if (!Array.isArray(points) || points.length === 0) return "";
  const [first, ...rest] = points;
  return [`M ${first.x} ${first.y}`, ...rest.map((p) => `L ${p.x} ${p.y}`)].join(" ");
}

function GraphNode({ node, current, visited }) {
  const halfW = node.width / 2;
  const halfH = node.height / 2;
  const state = current ? "current" : visited ? "visited" : "ahead";
  return (
    <g className={`exec-node exec-node-${state}`} transform={`translate(${node.x} ${node.y})`}>
      <title>{`${functionLabel(node.function)} line ${node.line}: ${node.text}`}</title>
      <rect
        className="exec-node-box"
        x={-halfW}
        y={-halfH}
        width={node.width}
        height={node.height}
        rx={8}
      />
      <text className="exec-node-fn" x={-halfW + PAD} y={-halfH + 14}>
        {functionLabel(node.function)}
      </text>
      {node.displayLines.map((line, i) => (
        <text key={i} className="exec-node-text" x={-halfW + PAD} y={-halfH + 30 + i * 15}>
          {line}
        </text>
      ))}
    </g>
  );
}

function GraphEdge({ edge, markerId, index }) {
  const d = edgePath(edge.points);
  if (!d) return null;
  const traveled = edge.steps.length > 0 && edge.steps[0] <= index;
  const justTraveled = edge.steps.includes(index);
  const mid = edge.points[Math.floor(edge.points.length / 2)];
  const classes = [
    "exec-edge",
    `exec-edge-${edge.kind}`,
    traveled ? "exec-edge-traveled" : "",
    justTraveled ? "exec-edge-just" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <g className={classes}>
      <path className="exec-edge-line" d={d} markerEnd={`url(#${markerId}-${edge.kind})`} />
      {edge.count > 1 && mid ? (
        <text className="exec-edge-count" x={mid.x} y={mid.y - 4} textAnchor="middle">
          {edge.count}
        </text>
      ) : null}
    </g>
  );
}

/**
 * Draws the execution as a graph: a node for every line that ran (keyed by the
 * call it ran in), and edges for how control moved — including loop back-edges
 * and returns climbing back out. As `index` advances the visited path lights up
 * and a token slides to the current node, so the learner sees the movement and
 * the backtracking.
 *
 * @param {Object} props
 * @param {Array} props.trace the trace from docs/trace-format.md
 * @param {string} props.source the user's code, for line text
 * @param {number} props.index which trace step is current
 */
export default function ExecutionGraph({ trace, source, index }) {
  const graph = useMemo(() => buildExecutionGraph(trace, source), [trace, source]);
  const laid = useMemo(() => layoutExecutionGraph(graph), [graph]);
  const markerId = `exec-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  if (graph.nodes.length === 0) {
    return <p className="empty">Run your code to see it happen as a graph.</p>;
  }

  const currentNodeId = graph.steps[index] ?? null;
  const visited = new Set();
  for (let i = 0; i <= index && i < graph.steps.length; i += 1) {
    if (graph.steps[i]) visited.add(graph.steps[i]);
  }
  const currentNode = laid.nodes.find((node) => node.id === currentNodeId) ?? null;

  return (
    <div className="exec-graph">
      <svg
        viewBox={`0 0 ${laid.width} ${laid.height}`}
        role="img"
        aria-label="Execution graph"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          {EDGE_KINDS.map((kind) => (
            <marker
              key={kind}
              id={`${markerId}-${kind}`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path className={`exec-arrow exec-arrow-${kind}`} d="M 0 0 L 10 5 L 0 10 z" />
            </marker>
          ))}
        </defs>

        {laid.edges.map((edge, i) => (
          <GraphEdge key={edge.id ?? i} edge={edge} markerId={markerId} index={index} />
        ))}
        {laid.nodes.map((node) => (
          <GraphNode
            key={node.id}
            node={node}
            current={node.id === currentNodeId}
            visited={visited.has(node.id)}
          />
        ))}

        {currentNode ? (
          <g
            className="exec-token"
            style={{ transform: `translate(${currentNode.x}px, ${currentNode.y}px)` }}
          >
            <circle className="exec-token-dot" r={5} />
          </g>
        ) : null}
      </svg>

      <ul className="exec-legend">
        <li className="exec-legend-next">moves on</li>
        <li className="exec-legend-call">call</li>
        <li className="exec-legend-return">return</li>
        <li className="exec-legend-back">loop / back</li>
        <li className="exec-legend-error">error</li>
      </ul>
    </div>
  );
}
