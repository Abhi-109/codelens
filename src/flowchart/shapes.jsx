// SVG shape primitives for the flowchart graph (format version 2;
// docs/flowchart-format.md §4). Presentational only: no dagre, no trace.
// The parent (layout.js, then FlowchartGraph.jsx) decides each node's centre,
// size, and wrapped display lines; this file draws the five shape families and
// centres their text.
//
// Five families cover the eight kinds:
//   start / end / return   stadium (oval terminator)
//   io                     parallelogram
//   decision / loop        diamond
//   call                   rectangle with double side bars
//   process                plain rectangle
//
// Colours come from CSS classes (App.css) so the chart follows the theme.

const LINE_H = 16;

function poly(list) {
  return list.map(([x, y]) => `${x},${y}`).join(" ");
}

function NodeText({ lines }) {
  const start = -((lines.length - 1) * LINE_H) / 2;
  return (
    <text className="flow-text" textAnchor="middle" dominantBaseline="middle">
      {lines.map((line, i) => (
        <tspan key={i} x={0} y={start + i * LINE_H}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

/**
 * One flowchart node drawn as its kind's shape with its label (or raw code,
 * when the layout measured it that way) inside.
 * @param {Object} props
 * @param {Object} props.node a positioned node from layoutChart: x, y, width,
 *   height, displayLines, and the graph's own kind/label fields
 */
export function NodeShape({ node }) {
  const { kind, width, height, x, y } = node;
  const w = width / 2;
  const h = height / 2;
  const shapeClass = `flow-shape flow-shape-${kind}`;

  let shape;
  if (kind === "start" || kind === "end" || kind === "return") {
    shape = <rect className={shapeClass} x={-w} y={-h} width={width} height={height} rx={h} />;
  } else if (kind === "io") {
    const slant = Math.min(16, width * 0.12);
    shape = (
      <polygon
        className={shapeClass}
        points={poly([
          [-w + slant, -h],
          [w, -h],
          [w - slant, h],
          [-w, h],
        ])}
      />
    );
  } else if (kind === "decision" || kind === "loop") {
    shape = <polygon className={shapeClass} points={poly([[0, -h], [w, 0], [0, h], [-w, 0]])} />;
  } else if (kind === "call") {
    shape = (
      <>
        <rect className={shapeClass} x={-w} y={-h} width={width} height={height} rx={6} />
        <line className="flow-call-bar" x1={-w + 10} y1={-h} x2={-w + 10} y2={h} />
        <line className="flow-call-bar" x1={w - 10} y1={-h} x2={w - 10} y2={h} />
      </>
    );
  } else {
    shape = <rect className={shapeClass} x={-w} y={-h} width={width} height={height} rx={6} />;
  }

  return (
    <g className={`flow-node-g flow-node-${kind}`} transform={`translate(${x} ${y})`}>
      <title>{node.label}</title>
      {shape}
      <NodeText lines={node.displayLines ?? [node.label ?? ""]} />
    </g>
  );
}

/** An SVG path through dagre's edge points (a straight-segment polyline). */
function edgePath(edgePoints) {
  if (!Array.isArray(edgePoints) || edgePoints.length === 0) return "";
  const [first, ...rest] = edgePoints;
  return [`M ${first.x} ${first.y}`, ...rest.map((p) => `L ${p.x} ${p.y}`)].join(" ");
}

/** One edge: the arrow line plus its "Yes"/"No" label, when it has one. */
export function Edge({ edge, markerId }) {
  const d = edgePath(edge.points);
  if (!d) return null;
  return (
    <g className={`flow-edge${edge.back ? " flow-edge-back" : ""}`}>
      <path className="flow-edge-line" d={d} markerEnd={`url(#${markerId})`} />
      {edge.label != null && edge.labelX != null ? (
        <text
          className="flow-edge-label"
          x={edge.labelX}
          y={edge.labelY}
          textAnchor="middle"
          dominantBaseline="middle"
        >
          {edge.label}
        </text>
      ) : null}
    </g>
  );
}
