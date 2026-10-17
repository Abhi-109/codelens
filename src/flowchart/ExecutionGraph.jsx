import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  NODE,
  buildExecutionGraph,
  functionLabel,
  layoutExecutionGraph,
} from "./executionGraph.js";

const EDGE_KINDS = ["next", "back", "call", "return", "error"];
const MARGIN = 28;
const MIN_SCALE = 0.3;
const MAX_SCALE = 2.4;
const ZOOM_STEP = 1.25;
const FOLLOW_MS = 280;
const NO_OFFSET = { x: 0, y: 0 };

const clamp = (value, lo, hi) => Math.min(Math.max(value, lo), hi);

function edgePath(points) {
  if (!Array.isArray(points) || points.length === 0) return "";
  const [first, ...rest] = points;
  return [`M ${first.x} ${first.y}`, ...rest.map((p) => `L ${p.x} ${p.y}`)].join(" ");
}

// Where the window may sit so it never runs off the edge of the drawing.
function windowCentre(centre, extent, span) {
  if (span >= extent) return extent / 2;
  const half = span / 2;
  return clamp(centre, half, extent - half);
}

// Slides the viewport between steps instead of teleporting it. All state
// changes happen inside the animation frame, never synchronously on render.
function useAnimatedView(cx, cy, scale, duration) {
  const [view, setView] = useState({ cx, cy, scale });
  const from = useRef({ cx, cy, scale });
  const frame = useRef(0);

  useEffect(() => {
    const start = from.current;
    const began = performance.now();
    cancelAnimationFrame(frame.current);
    const tick = (now) => {
      const p = duration <= 0 ? 1 : Math.min(1, (now - began) / duration);
      const eased = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
      const next = {
        cx: start.cx + (cx - start.cx) * eased,
        cy: start.cy + (cy - start.cy) * eased,
        scale: start.scale + (scale - start.scale) * eased,
      };
      from.current = next;
      setView(next);
      if (p < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [cx, cy, scale, duration]);

  return view;
}

function GraphNode({ node, current, visited }) {
  const halfW = node.width / 2;
  const halfH = node.height / 2;
  const state = current ? "current" : visited ? "visited" : "ahead";
  const top = -halfH + NODE.PAD;
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
      <text className="exec-node-fn" x={-halfW + NODE.PAD} y={top + 11}>
        {functionLabel(node.function)}
      </text>
      {node.displayLines.map((text, i) => (
        <text
          key={i}
          className="exec-node-text"
          x={-halfW + NODE.PAD}
          y={top + NODE.HEADER_H + 11 + i * NODE.LINE_H}
        >
          {text}
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
 * call it ran in), and edges for how control moved — loop back-edges, calls,
 * and returns climbing back out. The viewport keeps the current node in sight
 * and slides as `index` advances, so nothing has to be scrolled by hand.
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

  const viewRef = useRef(null);
  const drag = useRef(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(null); // null means fit-to-width
  const [pan, setPan] = useState({ index: -1, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  // A step re-centres on the action, so any hand-pan belongs to that step only.
  const offset = pan.index === index ? pan : NO_OFFSET;

  const reduceMotion = useMemo(
    () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    [],
  );

  useEffect(() => {
    const element = viewRef.current;
    if (!element) return undefined;
    const measure = () => setBox({ w: element.clientWidth, h: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const hasGraph = graph.nodes.length > 0;
  const ready = hasGraph && box.w > 0 && box.h > 0;

  const fitScale = ready ? Math.min(1, (box.w - MARGIN * 2) / Math.max(laid.width, 1)) : 1;
  const scale = clamp(zoom ?? fitScale, MIN_SCALE, MAX_SCALE);
  const spanX = ready ? box.w / scale : 1;
  const spanY = ready ? box.h / scale : 1;

  const node = laid.nodes.find((n) => n.id === graph.steps[index]) ?? null;
  const centreX = windowCentre((node ? node.x : laid.width / 2) + offset.x, laid.width, spanX);
  const centreY = windowCentre((node ? node.y : laid.height / 2) + offset.y, laid.height, spanY);
  const view = useAnimatedView(centreX, centreY, scale, reduceMotion || dragging ? 0 : FOLLOW_MS);

  const spanXNow = box.w / view.scale;
  const spanYNow = box.h / view.scale;

  const currentNodeId = graph.steps[index] ?? null;
  const visited = new Set();
  for (let i = 0; i <= index && i < graph.steps.length; i += 1) {
    if (graph.steps[i]) visited.add(graph.steps[i]);
  }
  const currentNode = laid.nodes.find((n) => n.id === currentNodeId) ?? null;

  function zoomBy(factor) {
    setZoom(clamp((zoom ?? fitScale) * factor, MIN_SCALE, MAX_SCALE));
  }

  function resetView() {
    setZoom(null);
    setPan({ index, x: 0, y: 0 });
  }

  function onPointerDown(event) {
    if (!ready) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
    setDragging(true);
  }

  function onPointerMove(event) {
    if (!drag.current) return;
    setPan({
      index,
      x: drag.current.ox + (event.clientX - drag.current.x) / view.scale,
      y: drag.current.oy + (event.clientY - drag.current.y) / view.scale,
    });
  }

  function endDrag() {
    drag.current = null;
    setDragging(false);
  }

  return (
    <div className="exec-graph">
      <div
        className="exec-view"
        ref={viewRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {ready ? (
          <svg
            width={box.w}
            height={box.h}
            viewBox={`${view.cx - spanXNow / 2} ${view.cy - spanYNow / 2} ${spanXNow} ${spanYNow}`}
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label="Execution graph"
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
            {laid.nodes.map((item) => (
              <GraphNode
                key={item.id}
                node={item}
                current={item.id === currentNodeId}
                visited={visited.has(item.id)}
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
        ) : (
          <p className="empty exec-empty">
            {hasGraph ? null : "Run your code to see it happen as a graph."}
          </p>
        )}
      </div>

      {hasGraph ? (
        <div className="exec-tools">
          <button type="button" onClick={() => zoomBy(1 / ZOOM_STEP)} aria-label="Zoom out">
            −
          </button>
          <button type="button" onClick={() => zoomBy(ZOOM_STEP)} aria-label="Zoom in">
            +
          </button>
          <button type="button" onClick={resetView}>
            Reset view
          </button>
          <span className="exec-hint">Follows the current step — drag to look around</span>
        </div>
      ) : null}

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
