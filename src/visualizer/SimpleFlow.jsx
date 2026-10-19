import { useMemo } from "react";
import { countFor, flowFor, pathToLine, runsByLine } from "../tracer/flow";

/**
 * The original outline view: the format-1 flow summary rendered as nested
 * cards, one block per statement, branch and loop.
 *
 * It reads the same trace and the same `line` as every other surface, so it
 * stays in step with the workspace — it just draws the program as an outline
 * rather than as a diagram. It is offered as the "Simple view" alternative to
 * the Control Flow Graph so the older, plainer reading of the run is still
 * reachable rather than being quietly deleted.
 */

function FlowNode({ node, runs, activeSet }) {
  const active = activeSet.has(node);
  const count = countFor(node, runs);
  const badge = count > 0 ? <span className="flow-count">×{count}</span> : null;

  if (node.kind === "statement") {
    return (
      <div className={`flow-node flow-statement${active ? " flow-active" : ""}`}>
        <code>{node.text}</code>
        {badge}
      </div>
    );
  }

  if (node.kind === "branch") {
    return (
      <div className={`flow-node flow-branch${active ? " flow-active" : ""}`}>
        {node.arms.map((arm, i) => (
          <div key={i} className="flow-arm">
            <div className={`flow-arm-label${arm.test === null ? " flow-else" : ""}`}>
              {arm.test === null ? "else" : `if ${arm.test}`}
            </div>
            <div className="flow-body">
              {arm.body.length === 0 ? (
                <p className="empty">(nothing)</p>
              ) : (
                arm.body.map((child, j) => (
                  <FlowNode key={j} node={child} runs={runs} activeSet={activeSet} />
                ))
              )}
            </div>
          </div>
        ))}
        {badge}
      </div>
    );
  }

  return (
    <div className={`flow-node flow-loop${active ? " flow-active" : ""}`}>
      <div className="flow-loop-header">
        <span className="flow-loop-arrow">↻</span>
        <code>{node.header}</code>
        {badge}
      </div>
      <div className="flow-body">
        {node.body.length === 0 ? (
          <p className="empty">(nothing)</p>
        ) : (
          node.body.map((child, j) => (
            <FlowNode key={j} node={child} runs={runs} activeSet={activeSet} />
          ))
        )}
      </div>
    </div>
  );
}

/**
 * @param {Object} props
 * @param {Object|null} props.flow the format-1 flow summary from tracer.py
 * @param {string} props.functionName the frame to draw; falls back to `<module>`
 * @param {Array} props.trace the trace from docs/trace-format.md
 * @param {number|null} props.line the line running now
 */
export default function SimpleFlow({ flow, functionName, trace, line }) {
  const chart = flowFor(flow, functionName);
  const runs = useMemo(() => runsByLine(trace, functionName), [trace, functionName]);
  const activeSet = useMemo(
    () => new Set(pathToLine(chart?.nodes ?? [], line)),
    [chart, line],
  );

  if (flow?.error) {
    return (
      <p className="empty">
        The code has a syntax error on line {flow.error.line ?? "?"}, so there is no flowchart yet.
      </p>
    );
  }
  if (!chart || chart.nodes.length === 0) {
    return <p className="empty">Nothing to draw yet</p>;
  }
  return (
    <div className="flow">
      {chart.nodes.map((node, i) => (
        <FlowNode key={i} node={node} runs={runs} activeSet={activeSet} />
      ))}
    </div>
  );
}
