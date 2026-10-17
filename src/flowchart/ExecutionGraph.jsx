import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  NODE,
  buildExecutionGraph,
  functionLabel,
  layoutExecutionGraph,
  nodeRuns,
} from "./executionGraph.js";
import { decisionResult, edgeReason } from "./reasons.js";
import {
  centreOn,
  clampPan,
  computeFit,
  toScreen,
  viewBoxOf,
  zoomAt,
} from "./viewport.js";

const EDGE_KINDS = ["next", "back", "call", "return", "error"];
const ZOOM_STEP = 1.25;
const FOLLOW_MS = 260;
const IDENTITY = { scale: 1, x: 0, y: 0 };
/** Gap between a node edge and its tooltip, and the tooltip's width cap. */
const TIP_GAP = 10;
const TIP_MAX_W = 260;
const TIP_CHAR_W = 6.7;
/** How many runs to offer before summarising the rest. */
const MAX_RUN_CHOICES = 12;

const ease = (p) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);

function edgePath(points) {
  if (!Array.isArray(points) || points.length === 0) return "";
  const [first, ...rest] = points;
  return [`M ${first.x} ${first.y}`, ...rest.map((p) => `L ${p.x} ${p.y}`)].join(" ");
}

/** The opaque box. Handles hover, focus, the tooltip and click-to-jump. */
function NodeBox({ node, current, visited, badges, onOpenTip, onCloseTip, onPick }) {
  const halfW = node.width / 2;
  const halfH = node.height / 2;
  const state = current ? "current" : visited ? "visited" : "ahead";
  const label = `${functionLabel(node.function)} line ${node.line}: ${node.text}`;
  return (
    <g
      className={`exec-node exec-node-${state}${onPick ? " exec-clickable" : ""}`}
      transform={`translate(${node.x} ${node.y})`}
      tabIndex={0}
      role="button"
      aria-label={label}
      onMouseEnter={() => onOpenTip(node.id)}
      onMouseLeave={() => onCloseTip(node.id)}
      onFocus={() => onOpenTip(node.id)}
      onBlur={() => onCloseTip(node.id)}
      onClick={(event) => {
        event.stopPropagation();
        onPick?.(node.id);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onPick?.(node.id);
        }
      }}
    >
      <title>{label}</title>
      <rect
        className="exec-node-box"
        x={-halfW}
        y={-halfH}
        width={node.width}
        height={node.height}
        rx={7}
      />
      {badges.includes("you are here") ? (
        <text className="exec-here" x={-halfW} y={-halfH - 5}>
          you are here
        </text>
      ) : null}
    </g>
  );
}

/** The label layer, painted over the token so the token can never hide text. */
function NodeText({ node, current, visited }) {
  const halfW = node.width / 2;
  const halfH = node.height / 2;
  const state = current ? "current" : visited ? "visited" : "ahead";
  const top = -halfH + NODE.PAD;
  return (
    <g
      className={`exec-node exec-node-${state}`}
      transform={`translate(${node.x} ${node.y})`}
      aria-hidden="true"
    >
      {node.displayLines.map((text, i) => (
        <text
          key={i}
          className="exec-node-text"
          x={-halfW + NODE.PAD}
          y={top + 11 + i * NODE.LINE_H}
        >
          {text}
        </text>
      ))}
    </g>
  );
}

/**
 * The reasons layer: "came from"/"next" tags, the run count, and the real
 * values behind a decision once it has been passed.
 */
function NodeDecor({ node, badges, chip, runs }) {
  const halfW = node.width / 2;
  const halfH = node.height / 2;
  const others = badges.filter((badge) => badge !== "you are here");
  return (
    <g className="exec-decor" aria-hidden="true">
      {others.length > 0 ? (
        <text className="exec-tag" x={node.x} y={node.y - halfH - 5} textAnchor="middle">
          {others.join(" · ")}
        </text>
      ) : null}
      {runs > 1 ? (
        <text className="exec-runs" x={node.x + halfW - 3} y={node.y - halfH + 10} textAnchor="end">
          ×{runs}
        </text>
      ) : null}
      {chip ? (
        <text
          className={`exec-chip${chip.yes ? " exec-chip-yes" : " exec-chip-no"}`}
          x={node.x}
          y={node.y + halfH + 11}
          textAnchor="middle"
        >
          {chip.text}
        </text>
      ) : null}
    </g>
  );
}

function GraphEdge({ edge, markerId, index, reason, nodesById }) {
  const d = edgePath(edge.points);
  if (!d) return null;
  const traveled = edge.steps.length > 0 && edge.steps[0] <= index;
  const justTraveled = edge.steps.includes(index);
  const mid = edge.points[Math.floor(edge.points.length / 2)] ?? nodesById.get(edge.from);
  const classes = [
    "exec-edge",
    `exec-edge-${edge.kind}`,
    traveled ? "exec-edge-traveled" : "",
    justTraveled ? "exec-edge-just" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const label = edge.count > 1 ? `${reason} ×${edge.count}` : reason;
  return (
    <g className={classes}>
      <path className="exec-edge-line" d={d} markerEnd={`url(#${markerId}-${edge.kind})`} />
      {mid ? (
        <text className="exec-edge-label" x={mid.x} y={mid.y - 4} textAnchor="middle">
          {label}
        </text>
      ) : null}
      {justTraveled && mid ? (
        <text className="exec-edge-step" x={mid.x} y={mid.y + 9} textAnchor="middle">
          step {index + 1}
        </text>
      ) : null}
    </g>
  );
}

/**
 * The execution graph: a node for every line that ran (keyed by the call it ran
 * in) and an edge for how control moved, labelled with the reason. The pane fits
 * the whole chart, zooms and pans without native scrollbars, follows the current
 * node, and jumps to the step you click.
 *
 * @param {Object} props
 * @param {Array} props.trace the trace from docs/trace-format.md
 * @param {string} props.source the user's code, for line text and conditions
 * @param {number} props.index which trace step is current
 * @param {Object} [props.graph] buildExecutionGraph output, so the node here is
 *   the very same node the step view reads
 * @param {(index: number) => void} [props.onJump] called when a node is clicked
 */
export default function ExecutionGraph({ trace, source, index, graph: given, onJump }) {
  const graph = useMemo(
    () => given ?? buildExecutionGraph(trace, source),
    [given, trace, source],
  );
  const laid = useMemo(() => layoutExecutionGraph(graph), [graph]);
  const bounds = useMemo(() => ({ width: laid.width, height: laid.height }), [laid]);
  const markerId = `exec-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  const [box, setBox] = useState({ w: 0, h: 0 });
  const [manual, setManual] = useState(null); // { graph, size, transform } — a zoom or pan
  const [follow, setFollow] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [tipId, setTipId] = useState(null);
  const [picker, setPicker] = useState(null); // { nodeId, runs }

  const viewRef = useRef(null);
  const dragState = useRef(null);
  const dragging = useRef(false);
  const frame = useRef(0);
  const transformRef = useRef(IDENTITY);
  const boxRef = useRef(box);

  const reduceMotion = useMemo(
    () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    [],
  );

  const nodesById = useMemo(
    () => new Map(laid.nodes.map((node) => [node.id, node])),
    [laid],
  );
  const runs = useMemo(() => nodeRuns(graph), [graph]);

  // Size of the pane the graph is drawn inside. Measured before paint so the
  // first frame is already the fitted graph, not an empty box.
  useLayoutEffect(() => {
    const element = viewRef.current;
    if (!element) return undefined;
    const measure = () => setBox({ w: element.clientWidth, h: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Expand is a full-screen overlay: Esc closes it and the page stays put.
  useEffect(() => {
    if (!expanded) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [expanded]);

  const hasGraph = graph.nodes.length > 0;
  const ready = hasGraph && box.w > 0 && box.h > 0;
  const pane = useMemo(() => ({ width: box.w, height: box.h }), [box.w, box.h]);

  // Fit-to-view is derived, so a new chart (or a resized pane) always refits.
  const fitted = useMemo(() => (ready ? computeFit(bounds, pane) : null), [ready, bounds, pane]);
  // A zoom or pan wins, but only for the chart *and* the pane size it was made
  // on: resizing the window refits, as does a brand new run.
  const active =
    manual && manual.graph === laid && manual.size.w === box.w && manual.size.h === box.h
      ? manual.transform
      : null;
  const transform = active ?? fitted ?? IDENTITY;

  useEffect(() => {
    transformRef.current = transform;
    boxRef.current = box;
  });

  const animateTo = useCallback(
    (target, duration) => {
      cancelAnimationFrame(frame.current);
      const from = { ...transformRef.current };
      const began = performance.now();
      const tick = (now) => {
        const p = duration <= 0 ? 1 : Math.min(1, (now - began) / duration);
        const t = ease(p);
        const next = {
          scale: from.scale + (target.scale - from.scale) * t,
          x: from.x + (target.x - from.x) * t,
          y: from.y + (target.y - from.y) * t,
        };
        transformRef.current = next;
        setManual({ graph: laid, size: boxRef.current, transform: next });
        if (p < 1) frame.current = requestAnimationFrame(tick);
      };
      frame.current = requestAnimationFrame(tick);
    },
    [laid],
  );

  const currentNodeId = graph.steps[index] ?? null;
  const currentNode = laid.nodes.find((node) => node.id === currentNodeId) ?? null;
  const visited = useMemo(() => {
    const seen = new Set();
    for (let i = 0; i <= index && i < graph.steps.length; i += 1) {
      if (graph.steps[i]) seen.add(graph.steps[i]);
    }
    return seen;
  }, [graph, index]);

  // Who to point at: here, where we came from, and (when the trace already
  // knows it) where control goes next.
  const badges = useMemo(() => {
    const map = new Map();
    const add = (id, label) => {
      if (!id) return;
      const list = map.get(id) ?? [];
      if (!list.includes(label)) list.push(label);
      map.set(id, list);
    };
    add(graph.steps[index], "you are here");
    if (graph.steps[index - 1] !== graph.steps[index]) add(graph.steps[index - 1], "came from");
    if (graph.steps[index + 1] && graph.steps[index + 1] !== graph.steps[index]) {
      add(graph.steps[index + 1], "next");
    }
    return map;
  }, [graph, index]);

  // Follow the current node, keeping the zoom level. `dragging` is a ref on
  // purpose: releasing a drag must not yank the view back to the node, so this
  // only re-centres when the step itself changes (or follow is switched on).
  useEffect(() => {
    if (!follow || !ready || dragging.current || !currentNode) return;
    const next = clampPan(centreOn(transformRef.current, currentNode, pane), bounds, pane);
    animateTo(next, reduceMotion ? 0 : FOLLOW_MS);
  }, [follow, ready, currentNode, pane, bounds, reduceMotion, animateTo]);

  // Wheel zoom needs a non-passive listener so the page never scrolls instead.
  useEffect(() => {
    const element = viewRef.current;
    if (!element || !ready) return undefined;
    const onWheel = (event) => {
      event.preventDefault();
      cancelAnimationFrame(frame.current);
      const rect = element.getBoundingClientRect();
      const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const zoomed = zoomAt(transformRef.current, point, Math.exp(-event.deltaY * 0.0015));
      setManual({ graph: laid, size: boxRef.current, transform: clampPan(zoomed, bounds, pane) });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [ready, laid, bounds, pane]);

  const apply = (next) => setManual({ graph: laid, size: boxRef.current, transform: next });

  const tipNode = tipId ? laid.nodes.find((node) => node.id === tipId) ?? null : null;
  let tip = null;
  if (tipNode && ready) {
    const centre = toScreen(transform, tipNode);
    const halfW = (tipNode.width / 2) * transform.scale;
    const halfH = (tipNode.height / 2) * transform.scale;
    const width = Math.min(TIP_MAX_W, Math.max(tipNode.text.length * TIP_CHAR_W, 96) + 20);
    let left = centre.x + halfW + TIP_GAP;
    if (left + width > box.w - 4) left = centre.x - halfW - TIP_GAP - width;
    tip = {
      node: tipNode,
      width,
      left: Math.max(4, Math.min(left, box.w - width - 4)),
      top: Math.max(4, Math.min(centre.y - halfH, box.h - 48)),
    };
  }

  function zoomBy(factor) {
    cancelAnimationFrame(frame.current);
    const point = { x: box.w / 2, y: box.h / 2 };
    apply(clampPan(zoomAt(transformRef.current, point, factor), bounds, pane));
  }

  function fitView() {
    cancelAnimationFrame(frame.current);
    setManual(null); // fall back to the derived fit
  }

  function actualSize() {
    cancelAnimationFrame(frame.current);
    const current = transformRef.current;
    const centre = {
      x: (box.w / 2 - current.x) / current.scale,
      y: (box.h / 2 - current.y) / current.scale,
    };
    apply(centreOn({ scale: 1, x: 0, y: 0 }, centre, pane));
  }

  function onPointerDown(event) {
    if (!ready) return;
    cancelAnimationFrame(frame.current);
    event.currentTarget.setPointerCapture(event.pointerId);
    dragState.current = { x: event.clientX, y: event.clientY, from: transformRef.current };
    dragging.current = true;
    setTipId(null);
  }

  function onPointerMove(event) {
    const drag = dragState.current;
    if (!drag) return;
    const next = {
      scale: drag.from.scale,
      x: drag.from.x + (event.clientX - drag.x),
      y: drag.from.y + (event.clientY - drag.y),
    };
    apply(clampPan(next, bounds, pane));
  }

  function endDrag() {
    dragState.current = null;
    dragging.current = false;
  }

  function openTip(id) {
    if (!dragState.current) setTipId(id);
  }

  function closeTip(id) {
    setTipId((current) => (current === id ? null : current));
  }

  function pickNode(id) {
    const list = runs.get(id) ?? [];
    if (list.length === 0) return;
    if (list.length === 1) {
      setPicker(null);
      onJump?.(list[0]);
      return;
    }
    setPicker((current) => (current?.nodeId === id ? null : { nodeId: id, runs: list }));
  }

  const pickerNode = picker ? nodesById.get(picker.nodeId) ?? null : null;

  return (
    <div className={`exec-graph${expanded ? " exec-expanded" : ""}`}>
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
            viewBox={viewBoxOf(transform, pane)}
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
              <GraphEdge
                key={edge.id ?? i}
                edge={edge}
                markerId={markerId}
                index={index}
                nodesById={nodesById}
                reason={edgeReason(
                  edge,
                  nodesById.get(edge.from),
                  nodesById.get(edge.to),
                  source,
                )}
              />
            ))}
            <g className="exec-boxes">
              {laid.nodes.map((node) => (
                <NodeBox
                  key={node.id}
                  node={node}
                  current={node.id === currentNodeId}
                  visited={visited.has(node.id)}
                  badges={badges.get(node.id) ?? []}
                  onOpenTip={openTip}
                  onCloseTip={closeTip}
                  onPick={onJump ? pickNode : null}
                />
              ))}
            </g>

            {/* The token travels on the graph, and the label layer paints over it. */}
            {currentNode ? (
              <circle className="exec-token" cx={currentNode.x} cy={currentNode.y} r={3.5} />
            ) : null}

            <g className="exec-texts">
              {laid.nodes.map((node) => (
                <NodeText
                  key={node.id}
                  node={node}
                  current={node.id === currentNodeId}
                  visited={visited.has(node.id)}
                />
              ))}
            </g>

            <g className="exec-decor-layer">
              {laid.nodes.map((node) => (
                <NodeDecor
                  key={node.id}
                  node={node}
                  badges={badges.get(node.id) ?? []}
                  chip={decisionResult(node, trace, graph, source, index)}
                  runs={(runs.get(node.id) ?? []).length}
                />
              ))}
            </g>
          </svg>
        ) : (
          <p className="empty exec-empty">
            {hasGraph ? null : "Run your code to see it happen as a graph."}
          </p>
        )}

        {tip ? (
          <div className="exec-tip" style={{ left: tip.left, top: tip.top, width: tip.width }}>
            <span className="exec-tip-where">
              {functionLabel(tip.node.function)} · line {tip.node.line}
            </span>
            <code>{tip.node.text}</code>
            <span className="exec-tip-runs">
              ran {(runs.get(tip.node.id) ?? []).length} time
              {(runs.get(tip.node.id) ?? []).length === 1 ? "" : "s"}
            </span>
          </div>
        ) : null}

        {picker && pickerNode ? (
          <div className="exec-runs-pop" onPointerDown={(event) => event.stopPropagation()}>
            <div className="exec-runs-head">
              <span>
                {functionLabel(pickerNode.function)} line {pickerNode.line}
              </span>
              <button type="button" className="ghost" onClick={() => setPicker(null)}>
                ✕
              </button>
            </div>
            <p className="panel-hint">This line ran {picker.runs.length} times. Jump to:</p>
            <ol className="exec-runs-list">
              {picker.runs.slice(0, MAX_RUN_CHOICES).map((run) => (
                <li key={run}>
                  <button
                    type="button"
                    className={run === index ? "on" : ""}
                    onClick={() => {
                      onJump?.(run);
                      setPicker(null);
                    }}
                  >
                    step {run + 1}
                    {run === index ? " (here)" : ""}
                  </button>
                </li>
              ))}
            </ol>
            {picker.runs.length > MAX_RUN_CHOICES ? (
              <p className="empty">+{picker.runs.length - MAX_RUN_CHOICES} more</p>
            ) : null}
          </div>
        ) : null}
      </div>

      {hasGraph ? (
        <div className="exec-tools">
          <button type="button" onClick={() => zoomBy(1 / ZOOM_STEP)} aria-label="Zoom out">
            −
          </button>
          <button type="button" onClick={() => zoomBy(ZOOM_STEP)} aria-label="Zoom in">
            +
          </button>
          <button type="button" onClick={fitView}>
            Fit
          </button>
          <button type="button" onClick={actualSize}>
            100%
          </button>
          <label className="exec-toggle">
            <input
              type="checkbox"
              checked={follow}
              onChange={(event) => setFollow(event.target.checked)}
            />
            Follow
          </label>
          <button type="button" onClick={() => setExpanded((value) => !value)}>
            {expanded ? "Close" : "Expand"}
          </button>

          <details className="exec-legend-menu">
            <summary>Legend</summary>
            <dl className="exec-legend">
              <dt className="exec-legend-here">you are here</dt>
              <dd>the line running now</dd>
              <dt className="exec-legend-next">next</dt>
              <dd>the next line in the same function</dd>
              <dt className="exec-legend-cond">Yes / No</dt>
              <dd>which way a condition went</dd>
              <dt className="exec-legend-call">call</dt>
              <dd>enters a function</dd>
              <dt className="exec-legend-return">return</dt>
              <dd>hands a result back to the caller</dd>
              <dt className="exec-legend-back">loop</dt>
              <dd>goes back to the top of a loop</dd>
              <dt className="exec-legend-error">error</dt>
              <dd>the run stopped here</dd>
              <dt className="exec-legend-runs">×N</dt>
              <dd>the line has run N times</dd>
            </dl>
          </details>
        </div>
      ) : null}
    </div>
  );
}
