// SVG shape primitives for the flowchart graph (format version 2;
// docs/flowchart-format.md §4). Presentational only: no layout, no trace.
// The parent (layout.js, then ControlFlowChart.jsx) decides each node's centre,
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
    <text className="cfg-text" textAnchor="middle" dominantBaseline="middle">
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
 *
 * `state` is presentational only — the layout and the trace decide it, never
 * this file — and it is the CSS class the drawing's whole colour story hangs
 * from: `cfg-running`, `cfg-executed`, `cfg-unmapped`, `cfg-raising`.
 *
 * @param {Object} props
 * @param {Object} props.node a positioned node from layoutChart: x, y, width,
 *   height, displayLines, and the graph's own kind/label fields
 * @param {string} [props.state] presentational state class suffix
 * @param {string} [props.readout] the accessible name, already written out
 * @param {boolean} [props.reachable] false when the box cannot be clicked
 * @param {() => void} [props.onActivate] called on click or Enter/Space
 */
export function NodeShape({ node, state = "", readout, reachable = true, onActivate }) {
  const { kind, width, height, x, y } = node;
  const w = width / 2;
  const h = height / 2;
  const shapeClass = `cfg-shape cfg-shape-${kind}`;

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
        <line className="cfg-call-bar" x1={-w + 10} y1={-h} x2={-w + 10} y2={h} />
        <line className="cfg-call-bar" x1={w - 10} y1={-h} x2={w - 10} y2={h} />
      </>
    );
  } else {
    shape = <rect className={shapeClass} x={-w} y={-h} width={width} height={height} rx={6} />;
  }

  const classes = ["cfg-node", `cfg-node-${kind}`, state ? `cfg-${state}` : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <g
      className={classes}
      transform={`translate(${x} ${y})`}
      role={reachable && onActivate ? "button" : undefined}
      tabIndex={reachable && onActivate ? 0 : undefined}
      aria-label={reachable && onActivate ? readout : undefined}
      onClick={reachable && onActivate ? onActivate : undefined}
      onKeyDown={
        reachable && onActivate
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onActivate();
              }
            }
          : undefined
      }
    >
      <title>{readout ?? node.label}</title>
      {shape}
      <NodeText lines={node.displayLines ?? [node.label ?? ""]} />
    </g>
  );
}

const ARROW = 7;

/**
 * One edge: the arrow line, its head, and its "Yes"/"No" label when it has one.
 *
 * The head is drawn rather than left to an SVG `<marker>`, so it takes the
 * same colour as the line it belongs to — the arrow that was taken reads as
 * taken at a glance, not just its middle.
 */
export function Edge({ edge, state = "" }) {
  if (!Array.isArray(edge.points) || edge.points.length < 2) return null;
  const [first, ...rest] = edge.points;
  const d = [`M ${first.x} ${first.y}`, ...rest.map((p) => `L ${p.x} ${p.y}`)].join(" ");
  const classes = ["cfg-edge", edge.back ? "cfg-edge-back" : "", state ? `cfg-${state}` : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <g className={classes}>
      <path className="cfg-edge-line" d={d} />
      <polygon className="cfg-arrow" points={arrowHead(edge.points)} />
      {edge.label != null && edge.labelX != null ? (
        <text
          className="cfg-edge-label"
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

/** A small triangle sitting on the last segment, pointing the way it goes. */
function arrowHead(points) {
  const end = points[points.length - 1];
  const before = points[points.length - 2];
  const angle = Math.atan2(end.y - before.y, end.x - before.x);
  const tip = { x: end.x, y: end.y };
  const base = { x: end.x - Math.cos(angle) * ARROW, y: end.y - Math.sin(angle) * ARROW };
  const wing = { x: -Math.sin(angle) * ARROW * 0.45, y: Math.cos(angle) * ARROW * 0.45 };
  return [
    `${tip.x},${tip.y}`,
    `${base.x + wing.x},${base.y + wing.y}`,
    `${base.x - wing.x},${base.y - wing.y}`,
  ].join(" ");
}
