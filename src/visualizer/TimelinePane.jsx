/**
 * The execution timeline: one row for every recorded trace step, with the line
 * it is on, what kind of event it is, the source, the live variables and a tail
 * of the output. Every row is a real trace index and clicking it uses the same
 * `jumpTo` every other view uses.
 *
 * Rows are virtualised by a fixed height, so a 1,500-step run keeps the same
 * small DOM as a short one. The current row is never hidden by the filter and
 * is scrolled into view when playback moves. Comparison lives in this pane but
 * has its own two endpoints; it never moves the playback step.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import StepComparison from "./StepComparison.jsx";
import { compareSteps } from "./compare.js";
import {
  TIMELINE_ROW_HEIGHT,
  filterTimelineRows,
  scrollTarget,
  timelineRows,
  visibleRange,
} from "./timeline.js";

const INITIAL_HEIGHT = 340;

export default function TimelinePane({
  trace,
  source,
  index,
  onJump,
  compareState,
  onOpenCompare,
  onCloseCompare,
  onChangeEndpoint,
  onSwapEndpoints,
  onUseCurrent,
}) {
  const rows = useMemo(() => timelineRows(trace, source), [trace, source]);
  const [onlyChanges, setOnlyChanges] = useState(false);
  const shown = useMemo(
    () => filterTimelineRows(rows, onlyChanges, index),
    [rows, onlyChanges, index],
  );
  // The scroll position belongs to one trace. Pairing it with the trace means
  // a new run reads as the top of the list without a state-setting effect.
  const [scroll, setScroll] = useState({ trace: null, top: 0 });
  const scrollTop = scroll.trace === trace ? scroll.top : 0;
  const [height, setHeight] = useState(INITIAL_HEIGHT);
  const scroller = useRef(null);

  const report = useMemo(
    () =>
      compareState.open
        ? compareSteps(trace, compareState.baseline, compareState.comparison)
        : null,
    [compareState.open, compareState.baseline, compareState.comparison, trace],
  );

  // A new trace starts at its own top; the old DOM offset means nothing. The
  // derived `scrollTop` above already treats the new trace as unpanned.
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [trace]);

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return undefined;
    // The pane can be display:none on narrow screens. A ResizeObserver reports
    // the real height when it comes back; a window resize alone would never
    // fire when only the tab changed.
    const measure = () => {
      const next = element.clientHeight;
      if (next > 0) setHeight(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [trace, compareState.open]);

  // Keep the highlighted row in view without moving the page around it. While
  // the pane is hidden there is no viewport to keep it in, so do not scroll or
  // report a position: the virtual window would then disagree with the DOM.
  useEffect(() => {
    const element = scroller.current;
    if (!element || element.clientHeight === 0) return;
    const position = shown.findIndex((row) => row.index === index);
    if (position < 0) return;
    const next = scrollTarget(position, element.scrollTop, element.clientHeight);
    if (next == null) return;
    if (next !== element.scrollTop) element.scrollTop = next;
    // The browser clamps scrollTop, and a pane may have kept its old offset.
    // Report what the DOM really has so the virtual window uses the same value.
    const actual = element.scrollTop;
    setScroll((current) =>
      current.trace === trace && current.top === actual
        ? current
        : { trace, top: actual },
    );
  }, [index, shown, trace, height]);

  const range = visibleRange(shown.length, scrollTop, height);
  const visible = shown.slice(range.start, range.end);

  return (
    <div className="viz-canvas tl-root" data-comparing={compareState.open ? "true" : undefined}>
      <div className="tl-controls">
        <p className="tl-summary">
          <strong>{trace.length}</strong> recorded step{trace.length === 1 ? "" : "s"}
          {onlyChanges ? ` · showing ${shown.length}` : ""}
        </p>
        <label className="tl-filter">
          <input
            type="checkbox"
            checked={onlyChanges}
            onChange={(event) => setOnlyChanges(event.target.checked)}
            disabled={trace.length === 0}
          />
          Only changes
        </label>
        <button
          type="button"
          className="tl-compare"
          aria-label={compareState.open ? "Close comparison" : "Compare steps"}
          aria-pressed={Boolean(compareState.open)}
          onClick={compareState.open ? onCloseCompare : onOpenCompare}
          disabled={trace.length === 0}
        >
          {compareState.open ? (
            <>
              <span className="viz-wide">Close comparison</span>
              <span className="viz-narrow">Close</span>
            </>
          ) : (
            <>
              <span className="viz-wide">Compare steps</span>
              <span className="viz-narrow">Compare</span>
            </>
          )}
        </button>
      </div>

      {compareState.open && report ? (
        <StepComparison
          trace={trace}
          index={index}
          state={compareState}
          report={report}
          onChange={onChangeEndpoint}
          onClose={onCloseCompare}
          onSwap={onSwapEndpoints}
          onUseCurrent={onUseCurrent}
          onJump={onJump}
        />
      ) : null}

      {trace.length === 0 ? (
        <p className="viz-empty">
          Run a program to see its recorded steps here. Each row will jump to the real
          trace step it names.
        </p>
      ) : (
        <div className="tl-table" role="table" aria-label="Execution timeline" aria-rowcount={shown.length + 1}>
          <div className="tl-head" role="row">
            <span role="columnheader">Step</span>
            <span role="columnheader" className="tl-line">
              Line
            </span>
            <span role="columnheader">Event</span>
            <span role="columnheader">Code</span>
            <span role="columnheader" className="tl-vars">
              Variables
            </span>
            <span role="columnheader" className="tl-output">
              Output
            </span>
          </div>
          <div
            className="tl-scroll"
            ref={scroller}
            onScroll={(event) =>
              setScroll({ trace, top: event.currentTarget.scrollTop })
            }
          >
            <div className="tl-spacer" style={{ height: shown.length * TIMELINE_ROW_HEIGHT }}>
              {visible.map((row, offset) => {
                const at = range.start + offset;
                const current = row.index === index;
                return (
                  <div
                    key={row.index}
                    role="row"
                    aria-rowindex={at + 2}
                    aria-selected={current}
                    className={`tl-row${current ? " current" : ""}`}
                    data-kind={row.kind}
                    style={{ transform: `translateY(${at * TIMELINE_ROW_HEIGHT}px)` }}
                    onClick={() => onJump(row.index)}
                  >
                    <span role="cell" className="tl-cell tl-step-cell">
                      <button
                        type="button"
                        className="tl-step"
                        onClick={(event) => {
                          event.stopPropagation();
                          onJump(row.index);
                        }}
                        aria-label={`Go to step ${row.step}`}
                        aria-current={current ? "step" : undefined}
                      >
                        {row.step}
                      </button>
                    </span>
                    <span role="cell" className="tl-cell tl-line">
                      {row.line ?? "—"}
                    </span>
                    <span role="cell" className="tl-cell" title={row.label}>
                      <span className={`tl-kind tl-kind-${row.kind}`}>{row.label}</span>
                    </span>
                    <span role="cell" className="tl-cell tl-code" title={row.codeTitle}>
                      {row.code}
                    </span>
                    <span
                      role="cell"
                      className="tl-cell tl-vars"
                      title={row.variablesText || "No variables in this step's snapshot"}
                    >
                      {row.variablesText || "—"}
                    </span>
                    <span role="cell" className="tl-cell tl-output" title={row.outputTitle}>
                      {row.output || "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
