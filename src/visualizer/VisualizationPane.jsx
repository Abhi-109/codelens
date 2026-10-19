import { useRef } from "react";
import { VIZ_BLURBS, VIZ_LABELS, VIZ_MODES } from "./vizMode.js";

/**
 * The canvas chooser: one strip of tabs over whichever drawing is active.
 *
 * It sits in the same pane as the drawing, so the three canvases are one thing
 * to look at rather than three places to go. The tab strip follows the ARIA
 * tabs pattern — one tab stop, arrows to move, Home and End to jump — and it
 * owns its arrow keys, which the workspace's global stepper already declines
 * to touch while a `[role="tablist"]` has focus.
 *
 * Choosing a tab changes presentation only. The step, the playing state and
 * the speed belong to the run, not to the canvas, so moving between them can
 * never move the program.
 *
 * @param {Object} props
 * @param {string} props.viz the active canvas id
 * @param {(viz: string) => void} props.onVizChange
 * @param {import("react").ReactNode} [props.heading] the pane heading beside the tabs
 * @param {import("react").ReactNode} props.children the active canvas
 */
export default function VisualizationPane({ viz, onVizChange, heading = null, children }) {
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
      <div className="flow-head viz-head">
        {heading}
        {multi ? (
          <div className="viz-tabs" role="tablist" aria-label="Visualization" onKeyDown={onKeyDown}>
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
                  className={`viz-tab${active ? " on" : ""}`}
                  onClick={() => onVizChange?.(id)}
                >
                  {VIZ_LABELS[id] ?? id}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
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
