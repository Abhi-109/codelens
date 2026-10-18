import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { buildExecutionGraph, callFrames, nodeRuns, visibleRows } from "./executionGraph.js";
import { CARD, cardSlots, layoutRows } from "./layoutGraph.js";
import { cardBody, nodeRunIndex } from "./nodeBody.js";
import { decisionResult } from "./reasons.js";
import { stateAt } from "../tracer/stepView.js";
import { clampPan, computeFit, frameCard, viewBoxOf, zoomAt } from "./viewport.js";

const EDGE_KINDS = ["next", "back", "call", "return", "error"];
const ZOOM_STEP = 1.25;
const FOLLOW_MS = 260;
const IDENTITY = { scale: 1, x: 0, y: 0 };
const MODULE = "<module>";
/** How many runs to offer before summarising the rest. */
const MAX_RUN_CHOICES = 12;
/** How many call colours to cycle through. */
const CALL_COLOURS = 6;
/** Shared empty set, so "nothing opened by hand" is a stable value. */
const EMPTY_SET = new Set();

const ease = (p) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);

/** An orthogonal route with rounded corners, so edges read as wires, not zigzags. */
function edgePath(points, radius = 7) {
  if (!Array.isArray(points) || points.length === 0) return "";
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }
  const at = (point, towards, r) => {
    const dx = towards.x - point.x;
    const dy = towards.y - point.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: point.x + (dx / len) * r, y: point.y + (dy / len) * r };
  };
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const previous = points[i - 1];
    const point = points[i];
    const next = points[i + 1];
    const r = Math.min(radius, Math.hypot(point.x - previous.x, point.y - previous.y) / 2,
      Math.hypot(next.x - point.x, next.y - point.y) / 2);
    const from = at(point, previous, r);
    const to = at(point, next, r);
    d += ` L ${from.x} ${from.y} Q ${point.x} ${point.y} ${to.x} ${to.y}`;
  }
  const last = points[points.length - 1];
  return `${d} L ${last.x} ${last.y}`;
}

/** The baseline of a line of text inside a slot of height `slotH`. */
const baseline = (top, slotH) => top + slotH - 4;

/** Cuts text to the pixels available, so two labels on one line never collide. */
function fitText(text, px, charWidth = 6.4) {
  const value = String(text ?? "");
  if (px < charWidth * 3) return "";
  if (value.length * charWidth <= px) return value;
  const keep = Math.max(Math.floor(px / charWidth) - 1, 1);
  return `${value.slice(0, keep).trimEnd()}…`;
}

/**
 * One card: a line of code as it ran inside one call, with the values it used,
 * what this run changed, and where control goes next.
 */
function Card({ row, body, colour, badges, chip, onPick, call }) {
  const lines = row.codeLines;
  const slot = cardSlots(lines.length);
  const label = `line ${row.line} in ${row.function}: ${row.text}`;
  const left = CARD.PAD + 6;
  const inner = row.width - left * 2;
  const ran = body.ran > 1 ? `ran ${body.ran}×` : "";
  const called =
    body.advanced && call?.callLine != null ? `called from line ${call.callLine}` : "";
  const right = fitText(
    [...badges, ran, called, body.advanced ? `frame ${row.frameId}` : ""].filter(Boolean).join(" · "),
    inner * 0.66,
    5.8,
  );
  const callLabel = call?.label && call.label !== MODULE ? call.label : "the program";
  const where = fitText(
    `${callLabel} · line ${row.line}`,
    inner - (right ? right.length * 5.8 + 8 : 0),
    6.1,
  );
  const chipText = chip?.text ?? "";
  const action = fitText(row.action, inner - (chipText ? chipText.length * 6.2 + 10 : 0), 6.6);
  const state = body.current ? "current" : body.ahead ? "ahead" : "ran";
  return (
    <g
      className={`exec-card exec-card-${state} exec-call-${colour}${onPick ? " exec-clickable" : ""}`}
      transform={`translate(${row.x} ${row.y})`}
      tabIndex={0}
      role="button"
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onPick?.(row.id);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onPick?.(row.id);
        }
      }}
    >
      <title>{label}</title>
      <rect className="exec-card-box" width={row.width} height={row.height} rx={9} />
      <rect className="exec-card-colour" width={4} height={row.height} rx={2} />
      <text className="exec-card-where" x={left} y={baseline(slot.header, CARD.HEADER_H)}>
        {where}
      </text>
      {right ? (
        <text
          className="exec-card-badges"
          x={row.width - CARD.PAD}
          y={baseline(slot.header, CARD.HEADER_H)}
          textAnchor="end"
        >
          {right}
        </text>
      ) : null}
      {lines.map((text, i) => (
        <text
          key={i}
          className="exec-card-code"
          x={left}
          y={baseline(slot.code + i * CARD.CODE_H, CARD.CODE_H)}
        >
          {text}
        </text>
      ))}
      <text
        className="exec-card-action"
        x={left}
        y={baseline(slot.action, CARD.ACTION_H)}
      >
        {action}
      </text>
      {chipText ? (
        <text
          className={`exec-card-chip${chip.yes ? " exec-chip-yes" : " exec-chip-no"}`}
          x={row.width - CARD.PAD}
          y={baseline(slot.action, CARD.ACTION_H)}
          textAnchor="end"
        >
          {chipText}
        </text>
      ) : null}
      <text
        className={`exec-card-values${body.changed ? " exec-card-changed" : ""}`}
        x={left}
        y={baseline(slot.values, CARD.VALUE_H)}
      >
        {body.values}
      </text>
      <text className="exec-card-next" x={left} y={baseline(slot.foot, CARD.FOOT_H)}>
        {body.foot ? `next: ${body.foot}` : ""}
      </text>
    </g>
  );
}

/** A call that has already finished, folded into one row the learner can open. */
function FoldedCall({ row, onOpen }) {
  const note = row.raised
    ? "stopped with an error"
    : row.returned === null
      ? "returned nothing"
      : `returned ${row.returned}`;
  const title = `+ ${row.label} finished · ${row.count} line${row.count === 1 ? "" : "s"} · ${note}`;
  return (
    <g
      className={`exec-fold exec-call-${row.colour} exec-clickable`}
      transform={`translate(${row.x} ${row.y})`}
      tabIndex={0}
      role="button"
      aria-label={`${row.label} finished; open its ${row.count} lines`}
      onClick={(event) => {
        event.stopPropagation();
        onOpen?.(row.frameId);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen?.(row.frameId);
        }
      }}
    >
      <rect className="exec-fold-box" width={row.width} height={row.height} rx={9} />
      <rect className="exec-card-colour" width={4} height={row.height} rx={2} />
      <text className="exec-fold-title" x={CARD.PAD + 6} y={CARD.PAD + 13}>
        {fitText(title, row.width - (CARD.PAD + 6) * 2, 6.4)}
      </text>
      <text className="exec-fold-note" x={CARD.PAD + 6} y={CARD.PAD + 28}>
        click to open every line it ran
      </text>
    </g>
  );
}

/**
 * The execution graph: a card for every line that ran (keyed by the call it ran
 * in) and a wire for how control moved between them. Time flows down and a call
 * indents, so recursion becomes a staircase instead of a tower. Each card shows
 * the code, what the line does, the values that matter, and where control goes
 * next — all read from the trace at the selected step.
 *
 * @param {Object} props
 * @param {Array} props.trace the trace from docs/trace-format.md
 * @param {string} props.source the user's code, for line text and conditions
 * @param {number} props.index which trace step is current
 * @param {Object} [props.graph] buildExecutionGraph output, so the subtle rules
 *   here and in the inspector read the same graph
 * @param {(index: number) => void} [props.onJump] called when a card is clicked
 * @param {string} [props.note] what to say when there is nothing to draw
 * @param {"beginner"|"advanced"} [props.mode] how much detail a card carries
 */
export default function ExecutionGraph({
  trace,
  source,
  index,
  graph: given,
  onJump,
  note = null,
  mode = "beginner",
}) {
  const graph = useMemo(
    () => given ?? buildExecutionGraph(trace, source),
    [given, trace, source],
  );
  const calls = useMemo(() => callFrames(trace, source), [trace, source]);
  const runs = useMemo(() => nodeRuns(graph), [graph]);
  const usable = useMemo(() => nodeRunIndex(trace, graph), [trace, graph]);
  const nodesById = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph]);
  const colours = useMemo(() => {
    const map = new Map();
    for (const node of graph.nodes) {
      if (!map.has(node.frameId)) map.set(node.frameId, map.size % CALL_COLOURS);
    }
    return map;
  }, [graph]);

  const [box, setBox] = useState({ w: 0, h: 0 });
  const [manual, setManual] = useState(null); // { graph, size, transform } — a zoom or pan
  const [fitWanted, setFitWanted] = useState(false);
  const [follow, setFollow] = useState(true);
  const [fold, setFold] = useState(true);
  const [openState, setOpenState] = useState(() => ({ graph: null, set: EMPTY_SET }));
  const [expanded, setExpanded] = useState(false);
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
  const markerId = `exec-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  const stack = useMemo(
    () => (stateAt(trace, index)?.frames ?? []).map((entry) => entry.frame_id),
    [trace, index],
  );
  // Calls the learner has opened by hand. A new run starts with none open, which
  // is derived here rather than reset in an effect.
  const opened = openState.graph === graph ? openState.set : EMPTY_SET;
  const openCall = useCallback(
    (frameId) => {
      setOpenState((current) => {
        const set = new Set(current.graph === graph ? current.set : EMPTY_SET);
        set.add(frameId);
        return { graph, set };
      });
    },
    [graph],
  );
  const shown = useMemo(
    () => visibleRows(graph, { index, stack, calls, expanded: opened, fold }),
    [graph, index, stack, calls, opened, fold],
  );
  const laid = useMemo(() => layoutRows(shown, graph.edges), [shown, graph]);

  const currentNodeId = graph.steps[index] ?? null;
  const currentKey = shown.anchors.get(currentNodeId) ?? null;
  const currentCard = (currentKey && laid.byKey.get(currentKey)) || null;

  // Body of every visible card, from the trace at this step.
  const bodies = useMemo(() => {
    const map = new Map();
    for (const row of laid.rows) {
      if (row.kind !== "node") continue;
      map.set(row.key, cardBody(row, { graph, trace, source, index, mode, usable, nodesById }));
    }
    return map;
  }, [laid, graph, trace, source, index, mode, usable, nodesById]);

  const bounds = useMemo(() => ({ width: laid.width, height: laid.height }), [laid]);
  const pane = useMemo(() => ({ width: box.w, height: box.h }), [box.w, box.h]);
  const ready = graph.nodes.length > 0 && box.w > 0 && box.h > 0;

  // Size of the pane the graph is drawn inside. Measured before paint so the
  // first frame is already placed, not an empty box.
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

  // Home is the readable view: 100%, centred on the line running now. Fit shows
  // the whole run, which is only legible for short programs — so it is a choice,
  // never the default.
  const home = useMemo(() => {
    if (!ready) return null;
    if (!currentCard) return { ...IDENTITY };
    return frameCard({ ...IDENTITY }, currentCard, bounds, pane);
  }, [ready, currentCard, pane, bounds]);

  const derived = fitWanted ? computeFit(bounds, pane) : home;
  // A zoom or pan wins, but only for the chart *and* the pane size it was made
  // on: resizing the window re-places, as does a brand new run.
  const active =
    manual && manual.graph === laid && manual.size.w === box.w && manual.size.h === box.h
      ? manual.transform
      : null;
  const transform = active ?? derived ?? IDENTITY;

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

  // Follow the current card, keeping the zoom level. `dragging` is a ref on
  // purpose: releasing a drag must not yank the view back, so this only moves
  // when the step itself changes (or follow is switched on).
  useEffect(() => {
    if (!follow || !ready || dragging.current || !currentCard) return;
    const next = frameCard(transformRef.current, currentCard, bounds, pane);
    animateTo(next, reduceMotion ? 0 : FOLLOW_MS);
  }, [follow, ready, currentCard, pane, bounds, reduceMotion, animateTo]);

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
      setFitWanted(false);
      setManual({ graph: laid, size: boxRef.current, transform: clampPan(zoomed, bounds, pane) });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [ready, laid, bounds, pane]);

  const apply = (next) => {
    setFitWanted(false);
    setManual({ graph: laid, size: boxRef.current, transform: next });
  };

  function zoomBy(factor) {
    cancelAnimationFrame(frame.current);
    const point = { x: box.w / 2, y: box.h / 2 };
    apply(clampPan(zoomAt(transformRef.current, point, factor), bounds, pane));
  }

  function fitView() {
    cancelAnimationFrame(frame.current);
    setManual(null);
    setFitWanted(true);
  }

  /** Back to 100% on the line running now. */
  function resetView() {
    cancelAnimationFrame(frame.current);
    setManual(null);
    setFitWanted(false);
    setFollow(true);
  }

  function onPointerDown(event) {
    if (!ready) return;
    cancelAnimationFrame(frame.current);
    event.currentTarget.setPointerCapture(event.pointerId);
    dragState.current = { x: event.clientX, y: event.clientY, from: transformRef.current };
    dragging.current = true;
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

  // Badges tell the learner where they are, where they came from and where the
  // run goes next — the three questions a beginner asks first.
  const badges = useMemo(() => {
    const map = new Map();
    const add = (id, label) => {
      if (!id) return;
      const list = map.get(id) ?? [];
      if (!list.includes(label)) list.push(label);
      map.set(id, list);
    };
    if (graph.steps[index] !== graph.steps[index - 1]) add(graph.steps[index - 1], "from");
    if (graph.steps[index + 1] && graph.steps[index + 1] !== graph.steps[index]) {
      add(graph.steps[index + 1], "next");
    }
    return map;
  }, [graph, index]);

  const pickerNode = picker ? nodesById.get(picker.nodeId) ?? null : null;
  const currentLabel = currentNodeId
    ? `${nodesById.get(currentNodeId)?.function ?? ""} line ${nodesById.get(currentNodeId)?.line ?? ""}`
    : null;

  return (
    <div className={`exec-graph exec-${mode}${expanded ? " exec-expanded" : ""}`}>
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
            aria-label={`Execution graph. Step ${index + 1}: ${currentLabel ?? "no line"}.`}
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

            {/* Wires go under the cards, so a wire can never hide what a line says. */}
            <g className="exec-wires">
              {laid.edges.map((edge) => {
                const d = edgePath(edge.points);
                if (!d) return null;
                const current =
                  (edge.fromNode === currentNodeId && edge.toNode === graph.steps[index + 1]) ||
                  edge.steps.includes(index);
                return (
                  <g
                    key={edge.id}
                    className={`exec-edge exec-edge-${edge.kind}${
                      edge.fromNode === currentNodeId ? " exec-edge-leaving" : ""
                    }${current ? " exec-edge-just" : ""}`}
                  >
                    <path
                      className="exec-edge-line"
                      d={d}
                      markerEnd={`url(#${markerId}-${edge.kind})`}
                    />
                    {mode === "advanced" && edge.lane !== null ? (
                      <text
                        className="exec-edge-label"
                        x={edge.labelAt.x}
                        y={edge.labelAt.y}
                        textAnchor="middle"
                      >
                        {edge.count > 1 ? `${edge.kind} ×${edge.count}` : edge.kind}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </g>

            <g className="exec-cards">
              {laid.rows.map((row) =>
                row.kind === "call" ? (
                  <FoldedCall
                    key={row.key}
                    row={{ ...row, colour: colours.get(row.frameId) ?? 0 }}
                    onOpen={openCall}
                  />
                ) : (
                  <Card
                    key={row.key}
                    row={row}
                    colour={colours.get(row.frameId) ?? 0}
                    badges={badges.get(row.id) ?? []}
                    call={calls.get(row.frameId) ?? null}
                    body={
                      bodies.get(row.key) ?? {
                        current: row.id === currentNodeId,
                        ahead: false,
                        ran: 1,
                        values: "",
                        foot: "",
                        changed: false,
                        advanced: mode === "advanced",
                      }
                    }
                    chip={decisionResult(row, trace, graph, source, index)}
                    onPick={onJump ? pickNode : null}
                  />
                ),
              )}
            </g>
          </svg>
        ) : (
          <p className="empty exec-empty">
            {graph.nodes.length > 0 ? null : (note ?? "Run your code to see it happen as a graph.")}
          </p>
        )}

        {picker && pickerNode ? (
          <div className="exec-runs-pop" onPointerDown={(event) => event.stopPropagation()}>
            <div className="exec-runs-head">
              <span>line {pickerNode.line}</span>
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

      {graph.nodes.length > 0 ? (
        <div className="exec-tools">
          <button type="button" onClick={() => zoomBy(1 / ZOOM_STEP)} aria-label="Zoom out">
            −
          </button>
          <button type="button" onClick={() => zoomBy(ZOOM_STEP)} aria-label="Zoom in">
            +
          </button>
          <button type="button" onClick={fitView} title="Show the whole run at once">
            Fit
          </button>
          <button type="button" onClick={resetView} title="100%, on the line running now">
            Reset<span className="exec-wide"> view</span>
          </button>
          <label className="exec-toggle">
            <input
              type="checkbox"
              checked={follow}
              onChange={(event) => setFollow(event.target.checked)}
            />
            Follow
          </label>
          <label className="exec-toggle">
            <input
              type="checkbox"
              checked={fold}
              onChange={(event) => setFold(event.target.checked)}
            />
            Fold<span className="exec-wide"> finished calls</span>
          </label>
          <button type="button" onClick={() => setExpanded((value) => !value)}>
            {expanded ? "Close" : "Expand"}
          </button>

          <details className="exec-legend-menu" aria-label="How to read this graph">
            <summary>
              <span className="exec-wide">How to read this</span>
              <span className="exec-narrow" aria-hidden="true">
                ?
              </span>
            </summary>
            <div className="exec-legend-pop">
              <div className="exec-howto">
              <p>
                <strong>Each box is one line of code, as it ran in one call.</strong> The header
                names the function and the line; the box shows the values that line uses and where
                it goes next.
              </p>
              <p>
                <strong>Time flows down.</strong> The first line that ran is at the top, and the run
                continues downwards, so reading the boxes in order is reading the program.
              </p>
              <p>
                <strong>A call steps to the right.</strong> A line running inside a function is
                indented under the line that called it, and a finished call folds into one row you
                can click open — which is what keeps deep recursion readable.
              </p>
            </div>
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
            </div>
          </details>
        </div>
      ) : null}
    </div>
  );
}
