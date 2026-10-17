import { useId, useMemo } from "react";
import { layoutChart } from "./layout.js";
import { chartFor } from "./mapTrace.js";
import { Edge, NodeShape } from "./shapes.jsx";

/**
 * Draws one function's flowchart as a static SVG diagram: it picks the chart
 * for `functionName` (via mapTrace) and lays it out with dagre (via layout).
 * This stage draws the chart only — highlighting the running step, trail and
 * loop counters are a later stage. The chart is drawn from the code, so it is
 * useful before the learner presses Run.
 *
 * @param {Object} props
 * @param {Object} props.flow the flowchart graph (format version 2)
 * @param {string} props.functionName the frame to show; "<module>" maps to "<main>"
 * @param {boolean} [props.showCode] label boxes with their raw code
 */
export default function FlowchartGraph({ flow, functionName, showCode = false }) {
  const chart = chartFor(flow, functionName);
  const { nodes, edges, width, height } = useMemo(
    () => layoutChart(chart, { showCode }),
    [chart, showCode],
  );
  const markerId = `flow-arrow-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  if (flow?.error) {
    return (
      <p className="empty">
        The code has a syntax error on line {flow.error.line ?? "?"}, so there is no diagram
        yet.
      </p>
    );
  }
  if (!chart || nodes.length === 0) {
    return <p className="empty">Nothing to draw yet</p>;
  }

  return (
    <div className="flow-diagram">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Flowchart of ${chart.name}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <marker
            id={markerId}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path className="flow-arrow" d="M 0 0 L 10 5 L 0 10 z" />
          </marker>
        </defs>
        {edges.map((edge, i) => (
          <Edge key={i} edge={edge} markerId={markerId} />
        ))}
        {nodes.map((node) => (
          <NodeShape key={node.id} node={node} />
        ))}
      </svg>
    </div>
  );
}
