/**
 * The Combined view: the call tree beside whichever half of the step matters
 * right now — which calls are waiting, or what the program is holding.
 *
 * It composes the two canvases the workspace already has rather than
 * reimplementing either. The tree is the very same `<CallTree>`, and the panel
 * beside it is the inspector's own `StackPanel` / `VariablesPanel` fed the very
 * same `ctx` — one component, one step view, so the two halves can never
 * disagree about where the program is.
 *
 * This component owns no step, no timer and no trace: it draws what it is
 * handed. The subview is the only state here, and `selectCombinedSubview` is
 * the only way it changes — carrying everything else through untouched, which
 * is what makes it impossible for a panel switch to move the program.
 */

import { useRef, useState } from "react";
import CallTree from "./CallTree.jsx";
import { StackPanel, VariablesPanel } from "./Inspector.jsx";
import {
  COMBINED_SUBVIEWS,
  COMBINED_SUBVIEW_IDS,
  initialCombinedSubview,
  selectCombinedSubview,
} from "./workspace.js";

const tabId = (id) => `combined-tab-${id}`;
const panelId = (id) => `combined-panel-${id}`;

export default function CombinedView({
  trace,
  source,
  index,
  currentFrameId,
  onJumpCall,
  onShowFlow,
  note,
  ctx,
}) {
  const [pane, setPane] = useState(initialCombinedSubview);
  const subview = pane.subview;
  const refs = useRef([]);

  const choose = (id) => setPane((current) => selectCombinedSubview(current, id));

  const onKeyDown = (event) => {
    const from = COMBINED_SUBVIEW_IDS.indexOf(event.target?.dataset?.subview);
    if (from < 0) return;
    let to = -1;
    if (event.key === "ArrowRight") to = (from + 1) % COMBINED_SUBVIEW_IDS.length;
    else if (event.key === "ArrowLeft") to = (from - 1 + COMBINED_SUBVIEW_IDS.length) % COMBINED_SUBVIEW_IDS.length;
    else if (event.key === "Home") to = 0;
    else if (event.key === "End") to = COMBINED_SUBVIEW_IDS.length - 1;
    else return;
    event.preventDefault();
    choose(COMBINED_SUBVIEW_IDS[to]);
    refs.current[to]?.focus();
  };

  const Panel = subview === "variables" ? VariablesPanel : StackPanel;

  return (
    <div className="cmb">
      <div className="cmb-tree" role="region" aria-label="Call tree">
        <CallTree
          trace={trace}
          source={source}
          index={index}
          currentFrameId={currentFrameId}
          onJumpCall={onJumpCall}
          onShowFlow={onShowFlow}
          note={note}
        />
      </div>

      <div className="cmb-side">
        <div
          className="cmb-tabs"
          role="tablist"
          aria-label="Shown beside the call tree"
          onKeyDown={onKeyDown}
        >
          {COMBINED_SUBVIEWS.map((entry, i) => {
            const active = entry.id === subview;
            return (
              <button
                key={entry.id}
                type="button"
                role="tab"
                id={tabId(entry.id)}
                data-subview={entry.id}
                aria-selected={active}
                aria-controls={panelId(entry.id)}
                tabIndex={active ? 0 : -1}
                ref={(node) => {
                  refs.current[i] = node;
                }}
                className={`cmb-tab${active ? " on" : ""}`}
                onClick={() => choose(entry.id)}
              >
                {entry.label}
              </button>
            );
          })}
        </div>

        <div
          className="cmb-body"
          role="tabpanel"
          id={panelId(subview)}
          aria-labelledby={tabId(subview)}
          tabIndex={0}
          key={subview}
        >
          <Panel ctx={ctx} />
        </div>
      </div>
    </div>
  );
}
