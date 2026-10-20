import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  centreOn,
  clampPan,
  computeFit,
  frameCard,
  panBy,
  viewBoxOf,
  zoomAt,
} from "../flowchart/viewport.js";

/**
 * The shared drawing surface every visualization mode sits on.
 *
 * All three canvases pan, zoom, fit and follow in exactly the same way, and
 * all three are *windows* onto one execution: this component owns no step, no
 * timer and no trace. It only frames a drawing the caller hands it, so mode
 * switching can never move the program.
 *
 * It is a function of four things and nothing else:
 *
 *   - `bounds`    the size of the drawing (from the mode's pure layout)
 *   - `subject`   the box to keep centred while Follow is on
 *   - `layoutKey` identity of the current layout — a zoom only counts for the
 *                 drawing it was made on, so a new run or a new mode re-frames
 *   - the pane size, measured before paint
 *
 * Anything the learner does by hand (zoom, pan, fit) is remembered against that
 * exact `layoutKey`; the moment the drawing genuinely changes, the view starts
 * over rather than showing the old framing against new geometry.
 *
 * @param {Object} props
 * @param {{width: number, height: number}} props.bounds size of the drawing
 * @param {{x:number,y:number,w:number,h:number}|null} props.subject box to centre on
 * @param {boolean} props.hasContent whether there is a drawing at all
 * @param {unknown} props.layoutKey identity of the current layout
 * @param {string} props.label accessible name for the SVG
 * @param {import("react").ReactNode} [props.empty] shown when there is nothing to draw
 * @param {string} [props.note] overrides `empty` when the code never ran
 * @param {import("react").ReactNode} [props.caption] one line under the drawing
 * @param {import("react").ReactNode} [props.tools] extra toolbar controls
 * @param {import("react").ReactNode} [props.legend] "How to read this" content
 * @param {(ctx: {transform: Object, pane: Object, focusOn: (box: Object) => void}) => import("react").ReactNode} props.children
 */
export default function Canvas({
  bounds,
  subject = null,
  hasContent = false,
  layoutKey = null,
  label,
  empty = null,
  note = null,
  caption = null,
  tools = null,
  legend = null,
  children,
}) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [manual, setManual] = useState(null); // { key, size, transform } — a zoom or pan
  const [fitWanted, setFitWanted] = useState(false);
  const [follow, setFollow] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const viewRef = useRef(null);
  const dragState = useRef(null);
  const dragging = useRef(false);
  const frame = useRef(0);
  const transformRef = useRef(IDENTITY);
  const boxRef = useRef(box);

  // Read once at mount and then kept in step, so turning reduced motion on
  // mid-session does not need a reload to take effect.
  const [reduceMotion, setReduceMotion] = useState(
    () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  );
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query || typeof query.addEventListener !== "function") return undefined;
    const onChange = () => setReduceMotion(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const sized = box.w > 0 && box.h > 0;
  const ready = hasContent && sized;

  // Size of the pane the drawing sits inside. Measured before paint so the
  // first frame is already placed rather than an empty box.
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

  const pane = useMemo(() => ({ width: box.w, height: box.h }), [box.w, box.h]);

  // Home is the readable view: 100%, centred on the subject. Fit shows the
  // whole drawing, which is only legible for small diagrams — so it is a
  // choice, never the default.
  const home = useMemo(() => {
    if (!ready) return null;
    if (!subject) return { ...IDENTITY };
    return frameCard({ ...IDENTITY }, subject, bounds, pane);
  }, [ready, subject, pane, bounds]);

  const derived = fitWanted ? computeFit(bounds, pane) : home;
  const active =
    manual && manual.key === layoutKey && manual.size.w === box.w && manual.size.h === box.h
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
      // Each run supersedes the last: cancelling first means a learner who
      // steps quickly never accumulates queued movements, and the view always
      // starts from where it actually is.
      const tick = (now) => {
        const p = duration <= 0 ? 1 : Math.min(1, (now - began) / duration);
        const t = ease(p);
        const next = {
          scale: from.scale + (target.scale - from.scale) * t,
          x: from.x + (target.x - from.x) * t,
          y: from.y + (target.y - from.y) * t,
        };
        transformRef.current = next;
        setManual({ key: layoutKey, size: boxRef.current, transform: next });
        if (p < 1) frame.current = requestAnimationFrame(tick);
      };
      frame.current = requestAnimationFrame(tick);
    },
    [layoutKey],
  );

  // Follow the subject, keeping the zoom level. `dragging` is a ref on
  // purpose: releasing a drag must not yank the view back, so this only moves
  // when the subject itself changes (or Follow is switched on).
  useEffect(() => {
    if (!follow || !ready || dragging.current || !subject) return;
    const next = frameCard(transformRef.current, subject, bounds, pane);
    animateTo(next, reduceMotion ? 0 : FOLLOW_MS);
  }, [follow, ready, subject, bounds, pane, reduceMotion, animateTo]);

  /** Bring a keyboard-focused box to the middle without changing the step. */
  const focusOn = useCallback(
    (box) => {
      if (!ready || !box) return;
      cancelAnimationFrame(frame.current);
      const point = {
        x: Number.isFinite(box.cx) ? box.cx : (box.x ?? 0) + (box.width ?? 0) / 2,
        y: Number.isFinite(box.cy) ? box.cy : (box.y ?? 0) + (box.height ?? 0) / 2,
      };
      const next = clampPan(centreOn(transformRef.current, point, pane), bounds, pane);
      setFitWanted(false);
      setManual({ key: layoutKey, size: boxRef.current, transform: next });
    },
    [ready, bounds, pane, layoutKey],
  );

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
      setManual({ key: layoutKey, size: boxRef.current, transform: clampPan(zoomed, bounds, pane) });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [ready, layoutKey, bounds, pane]);

  const apply = (next) => {
    setFitWanted(false);
    setManual({ key: layoutKey, size: boxRef.current, transform: next });
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

  /** Back to 100% on the subject the program is on now. */
  function resetView() {
    cancelAnimationFrame(frame.current);
    setManual(null);
    setFitWanted(false);
    setFollow(true);
  }

  function onKeyDown(event) {
    if (!ready) return;
    const nudge = event.shiftKey ? 160 : 48;
    if (event.key === "0") {
      event.preventDefault();
      event.stopPropagation();
      resetView();
      return;
    }
    if (event.key.toLowerCase() === "f") {
      event.preventDefault();
      event.stopPropagation();
      fitView();
      return;
    }
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      event.stopPropagation();
      zoomBy(ZOOM_STEP);
      return;
    }
    if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      event.stopPropagation();
      zoomBy(1 / ZOOM_STEP);
      return;
    }
    let dx = 0;
    let dy = 0;
    if (event.key === "ArrowLeft") dx = nudge;
    else if (event.key === "ArrowRight") dx = -nudge;
    else if (event.key === "ArrowUp") dy = nudge;
    else if (event.key === "ArrowDown") dy = -nudge;
    else return;
    event.preventDefault();
    event.stopPropagation();
    apply(clampPan(panBy(transformRef.current, dx, dy), bounds, pane));
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

  return (
    <div className={`viz-canvas${expanded ? " viz-expanded" : ""}`}>
      <div
        className="viz-view"
        ref={viewRef}
        tabIndex={ready ? 0 : -1}
        role="group"
        aria-label={`${label}. Use arrow keys to pan and plus or minus to zoom.`}
        onKeyDown={onKeyDown}
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
            role="group"
            aria-label={label}
          >
            {/* The render prop is called here, not a ref read; focusOn only touches
                refs from the focus event it is passed to. */}
            {/* oxlint-disable-next-line react/refs */}
            {children({ transform, pane, focusOn })}
          </svg>
        ) : hasContent ? (
          // Sized but not yet painted; never show a "nothing here" message for
          // a drawing that exists.
          <span className="viz-empty viz-pending" aria-hidden="true" />
        ) : (
          <div className="viz-empty">{note ? <p className="viz-note">{note}</p> : empty}</div>
        )}
      </div>

      {hasContent && caption ? <div className="viz-caption">{caption}</div> : null}

      {hasContent ? (
        <div className="viz-tools">
          <button type="button" onClick={() => zoomBy(1 / ZOOM_STEP)} aria-label="Zoom out">
            −
          </button>
          <button type="button" onClick={() => zoomBy(ZOOM_STEP)} aria-label="Zoom in">
            +
          </button>
          <button type="button" onClick={fitView} title="Show the whole diagram at once">
            Fit
          </button>
          <button type="button" onClick={resetView} title="100%, on the step running now">
            Reset<span className="viz-wide"> view</span>
          </button>
          <label className="viz-toggle">
            <input
              type="checkbox"
              checked={follow}
              onChange={(event) => setFollow(event.target.checked)}
            />
            Follow
          </label>
          {tools}
          <button type="button" onClick={() => setExpanded((value) => !value)}>
            {expanded ? "Close" : "Expand"}
          </button>
          {legend ? (
            <details className="viz-legend-menu" aria-label="How to read this diagram">
              <summary>
                <span className="viz-wide">How to read this</span>
                <span className="viz-narrow" aria-hidden="true">
                  ?
                </span>
              </summary>
              <div className="viz-legend-pop">{legend}</div>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const IDENTITY = { scale: 1, x: 0, y: 0 };
const ZOOM_STEP = 1.25;
const FOLLOW_MS = 260;

const ease = (p) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);
