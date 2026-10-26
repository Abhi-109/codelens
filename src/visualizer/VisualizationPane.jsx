import { useRef } from "react";
import { VIZ_BLURBS, VIZ_LABELS, VIZ_MODES } from "./vizMode.js";

/**
 * The canvas chooser and the drawing, in one pane.
 *
 * The toolbar is one row: a segmented control for the offered canvases on the
 * left, and an optional `tools` slot on the right for whatever that canvas
 * needs (the adaptive view's adapter menu). There is deliberately no heading
 * above it - the active tab says what the drawing is - and no second strip of
 * controls under it.
 *
 * The tab strip follows the ARIA tabs pattern — one tab stop, arrows to move,
 * Home and End to jump — and it owns its arrow keys, which the workspace's
 * global stepper already declines to touch while a `[role="tablist"]` has
 * focus.
 *
 * Choosing a tab changes presentation only. The step, the playing state and
 * the speed belong to the run, not to the canvas, so moving between them can
 * never move the program.
 *
 * @param {Object} props
 * @param {string} props.viz the active canvas id
 * @param {(viz: string) => void} props.onVizChange
 * @param {import("react").ReactNode} [props.tools] controls for the active canvas
 * @param {string|null} [props.hint] one short sentence on why this canvas was picked
 * @param {import("react").ReactNode} props.children the active canvas
 */
export default function VisualizationPane({ viz, onVizChange, tools = null, hint = null, children }) {
  const refs = useRef([]);
  // With one canvas there is no choice to offer, so the strip stays out of the
  // way rather than showing a single button that does nothing.
  const multi = VIZ_MODES.length > 1;

  const onKeyDown = (event) => {
    const from = VIZ_MODES.indexOf(viz);
    if (from < 0) return;
    const last = VIZ_MODES.length - 1;
    let to = -1;
    if (event.key === "ArrowRight") to = from === last ? 0 : from + 1;
    else if (event.key === "ArrowLeft") to = from === 0 ? last : from - 1;
    else if (event.key === "Home") to = 0;
    else if (event.key === "End") to = last;
    else return;
    event.preventDefault();
    onVizChange?.(VIZ_MODES[to]);
    refs.current[to]?.focus();
  };

  return (
    <div className="viz-pane">
      <div className="canvas-toolbar">
        {multi ? (
          <div className="seg" role="tablist" aria-label="Visualization" onKeyDown={onKeyDown}>
            {VIZ_MODES.map((id, i) => {
              const active = viz === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  id={`viz-tab-${id}`}
                  aria-selected={active}
                  aria-controls="viz-canvas"
                  tabIndex={active ? 0 : -1}
                  title={VIZ_BLURBS[id]}
                  ref={(node) => {
                    refs.current[i] = node;
                  }}
                  className={`seg-item${active ? " on" : ""}`}
                  onClick={() => onVizChange?.(id)}
                >
                  {VIZ_LABELS[id] ?? id}
                </button>
              );
            })}
          </div>
        ) : null}
        {tools ? <div className="canvas-tools">{tools}</div> : null}
      </div>
      {hint ? (
        <p className="viz-hint" title="Why this canvas was suggested">
          {hint}
        </p>
      ) : null}
      <div
        className="viz-body"
        id="viz-canvas"
        {...(multi ? { role: "tabpanel", "aria-labelledby": `viz-tab-${viz}` } : {})}
      >
        {children}
      </div>
    </div>
  );
}
