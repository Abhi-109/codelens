/**
 * The inspector: one workspace beside the canvas that shows the same step six
 * different ways.
 *
 * Every section reads the single `getStepView` result handed in as `ctx`, so
 * the tabs cannot disagree about where the program is. The tab is held in its
 * own local state, which is the structural half of the promise that switching
 * what you are looking at never moves the step: there is no code path from a
 * tab click to the index at all.
 *
 * The tab list follows the ARIA tabs pattern - one tab stop for the whole
 * strip, arrow keys to move between tabs, Home and End to jump to the ends -
 * so it is usable without a pointer and announced correctly by a screen
 * reader.
 */

import { useRef, useState } from "react";
import { INSPECTOR_TABS, INSPECTOR_TAB_IDS, initialInspectorTab, selectInspectorTab } from "./workspace.js";
import { stepLabel, variableRows } from "./labels.js";
import {
  CallList,
  ChangeList,
  HeapObjects,
  PanelError,
  PanelHead,
  VariableRow,
  WatchHistory,
} from "./panelBits.jsx";

const tabId = (id) => `inspector-tab-${id}`;
const panelId = (id) => `inspector-panel-${id}`;

/* --- The six sections ---------------------------------------------------- */

function ExplainPanel({ ctx }) {
  const {
    result,
    view,
    line,
    callTitle,
    currentNode,
    previousEvent,
    nextEvent,
    nextReason,
    index,
    trace,
    jumpTo,
    concept,
    showConcept,
    dismissed,
    dismissConcept,
    detail,
  } = ctx;

  return (
    <>
      <PanelHead
        title="What's happening"
        hint="The step in plain English, and what comes next."
        help="Every step has three parts: what just happened, what is about to happen, and why this line runs now. Nothing here is written by hand - it is read from the one event the step is built from."
      />

      {result ? (
        <div className="explain-head">
          <span className="explain-label">Current step</span>
          <span className="explain-where">{`line ${line ?? "?"} · ${callTitle}`}</span>
        </div>
      ) : null}

      {result ? (
        <>
          {view.code ? <code className="step-code">{view.code.text}</code> : null}
          {currentNode?.action ? <p className="step-action">{currentNode.action}</p> : null}
          <div className="explain-part">
            <div className="explain-part-label">Just happened</div>
            <p className="explain-text just">{view.explanation.justHappened ?? "Nothing yet."}</p>
          </div>
          <div className="explain-part">
            <div className="explain-part-label">About to happen</div>
            <p className="explain-text about">{view.explanation.aboutToHappen}</p>
          </div>
          {view.explanation.why ? (
            <div className="explain-part">
              <div className="explain-part-label">Why this line runs now</div>
              <p className="explain-text why">{view.explanation.why}</p>
            </div>
          ) : null}
        </>
      ) : (
        <p className="explain-text about">
          Press Run and this will explain each step in plain English.
        </p>
      )}

      {showConcept && concept && !dismissed.has(view.explanation.concept) ? (
        <div className="concept-card">
          <strong>{concept.term}</strong>
          <span>{concept.blurb}</span>
          <button
            type="button"
            className="ghost"
            aria-label="Dismiss this card"
            onClick={() => dismissConcept(view.explanation.concept)}
          >
            ✕
          </button>
        </div>
      ) : null}

      {/* The old panel C, folded in: the same step seen as a path rather than
          as prose, with each row able to jump to the step it names. */}
      <div className={`flow-block${detail.structured ? " flow-structured" : ""}`}>
        <div className="flow-block-head">
          <h4>Control flow</h4>
          {detail.structured ? (
            <p className="panel-hint">Where control came from, where it is, and where it goes.</p>
          ) : null}
        </div>
        <ol className="flow-steps">
          <li className="flow-step past">
            <span className="flow-tag">before</span>
            <button
              type="button"
              className="flow-line"
              onClick={() => jumpTo(index - 1)}
              disabled={index === 0}
            >
              {previousEvent ? stepLabel(previousEvent) : "nothing yet"}
            </button>
            <p className="flow-why">{view.explanation.justHappened ?? "Nothing has run yet."}</p>
          </li>
          <li className="flow-step now">
            <span className="flow-tag">now</span>
            <span className="flow-line">{stepLabel(view.event)}</span>
            <p className="flow-why">{view.explanation.why ?? view.explanation.aboutToHappen}</p>
          </li>
          <li className="flow-step next">
            <span className="flow-tag">next</span>
            <button
              type="button"
              className="flow-line"
              onClick={() => jumpTo(index + 1)}
              disabled={!nextEvent}
            >
              {stepLabel(nextEvent)}
            </button>
            <p className="flow-why">{nextReason ?? "The run stops here."}</p>
          </li>
        </ol>
      </div>

      {result?.error ? (
        <p className="error-inline">
          <strong>{result.error.type}</strong> on line {result.error.line ?? "?"}:{" "}
          {result.error.message}
        </p>
      ) : null}

      {/* Advanced asks for execution metadata: the raw coordinates of this
          step, one line, never a second source of truth. */}
      {detail.showMeta && trace.length > 0 ? (
        <div className="meta-strip">
          <span className="meta-strip-label">Execution metadata</span>
          <dl className="meta-facts">
            <div>
              <dt>event</dt>
              <dd>{view.kind ?? "—"}</dd>
            </div>
            <div>
              <dt>line</dt>
              <dd>{line ?? "—"}</dd>
            </div>
            <div>
              <dt>function</dt>
              <dd>{view.function}</dd>
            </div>
            <div>
              <dt>depth</dt>
              <dd>{Math.max(view.frames.length - 1, 0)}</dd>
            </div>
            <div>
              <dt>step</dt>
              <dd>
                {index + 1} of {trace.length}
              </dd>
            </div>
          </dl>
        </div>
      ) : null}
    </>
  );
}

function VariablesPanel({ ctx }) {
  const {
    view,
    showAfter,
    setShowAfter,
    changeByName,
    watched,
    setWatched,
    history,
    jumpTo,
    detail,
  } = ctx;
  const rows = variableRows(view, showAfter);
  const previews = view.changes.filter((change) => change.kind === "new");
  const defined = view.frame?.defined ?? [];

  return (
    <>
      <PanelHead
        title="Variables"
        hint="What the program remembers right now."
        help="Each name is a labelled box. The list shows the values just before the highlighted line runs. Click a name to see how it changed over time."
      />

      <div className="state-toggle">
        <button type="button" className={showAfter ? "" : "on"} onClick={() => setShowAfter(false)}>
          Before this line
        </button>
        <button type="button" className={showAfter ? "on" : ""} onClick={() => setShowAfter(true)}>
          After this line
        </button>
      </div>

      {detail.showScope && view.frame ? (
        <p className="scope-line">
          scope: {view.frame.function === "<module>" ? "the whole program" : view.frame.function}
          {view.frame.function === "<module>" ? "" : ` call #${view.frame.callNumber}`} · frame{" "}
          {view.frame.frameId} · depth {view.frame.depth}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="empty">No variables yet.</p>
      ) : (
        <ul className="vars">
          {rows.map((entry) => (
            <VariableRow
              key={entry.name}
              entry={entry}
              change={changeByName.get(entry.name)}
              watched={watched === entry.name}
              showTypes={detail.showTypes}
              onWatch={() => setWatched((name) => (name === entry.name ? null : entry.name))}
            />
          ))}
        </ul>
      )}

      {previews.length > 0 ? (
        <p className="preview">
          After this line: {previews.map((change) => `${change.name} = ${change.to}`).join(", ")}
        </p>
      ) : null}
      {view.shared.map((note) => (
        <p key={note.id} className="shared-note">
          {note.text}
        </p>
      ))}
      {watched ? (
        <WatchHistory
          name={watched}
          entries={history}
          index={ctx.index}
          onJump={jumpTo}
          onClose={() => setWatched(null)}
        />
      ) : null}
      {defined.length > 0 ? <p className="defined">Defined here: {defined.join(", ")}</p> : null}
    </>
  );
}

function StackPanel({ ctx }) {
  const { view, olderCalls, selectedCall, jumpToCall, clearSelectedCall } = ctx;
  return (
    <>
      <PanelHead
        title="Calls and returns"
        hint="Which call is running now, and which are waiting for it."
        help="Each time a function runs, Python gives it its own fresh set of variables. The newest call is on top; when it finishes, its result goes back to the line that asked for it, and the call below carries on."
      />
      <CallList
        callStack={view.callStack}
        selectedId={view.frame?.frameId ?? null}
        onSelect={jumpToCall}
      />
      {olderCalls > 0 ? (
        <p className="preview">
          {olderCalls} older call{olderCalls === 1 ? " is" : "s are"} waiting for this one to
          finish.
        </p>
      ) : null}
      {selectedCall !== null && selectedCall !== view.frameId ? (
        <p className="preview">
          Showing an older call's variables.{" "}
          <button type="button" className="ghost" onClick={clearSelectedCall}>
            back to current
          </button>
        </p>
      ) : null}
    </>
  );
}

function MemoryPanel({ ctx }) {
  const { heap, heapNames, objectChanged } = ctx;
  const ids = Object.keys(heap ?? {});
  return (
    <>
      <PanelHead
        title="Memory"
        hint="The lists, dicts and objects the program is holding."
        help="A name can point at the same list as another name. These are the objects themselves, separate from the variables panel: the variables show names, this shows what the names are holding."
      />
      {ids.length === 0 ? (
        <p className="empty">No objects yet.</p>
      ) : (
        <div className="object-wrap">
          <HeapObjects heap={heap} names={heapNames} changes={objectChanged} />
        </div>
      )}
    </>
  );
}

function OutputPanel({ ctx }) {
  const { output } = ctx;
  return (
    <>
      <PanelHead
        title="Output"
        hint="What the program printed."
        help="print() shows text here. It never changes a variable."
      />
      <pre className="output">
        {output || <span className="empty">(nothing printed yet)</span>}
      </pre>
    </>
  );
}

function HistoryPanel({ ctx }) {
  const { log, index, jumpTo } = ctx;
  return (
    <>
      <PanelHead
        title="Change history"
        hint="Every change so far, newest first."
        help="Every value this program has held, in the order it changed. Click a row to jump back to the step that made the change."
      />
      <p className="panel-hint">Click a step to jump to it.</p>
      <ChangeList log={log} index={index} onJump={jumpTo} />
    </>
  );
}

const PANELS = {
  explain: ExplainPanel,
  variables: VariablesPanel,
  stack: StackPanel,
  memory: MemoryPanel,
  output: OutputPanel,
  history: HistoryPanel,
};

/* --- The shell ----------------------------------------------------------- */

export default function Inspector({ ctx }) {
  const [pane, setPane] = useState(initialInspectorTab);
  const tab = pane.tab;
  const refs = useRef([]);

  const choose = (id) => setPane((current) => selectInspectorTab(current, id));

  const onKeyDown = (event) => {
    const from = INSPECTOR_TAB_IDS.indexOf(event.target?.dataset?.tabid);
    if (from < 0) return;
    let to = -1;
    if (event.key === "ArrowRight") to = (from + 1) % INSPECTOR_TAB_IDS.length;
    else if (event.key === "ArrowLeft") to = (from - 1 + INSPECTOR_TAB_IDS.length) % INSPECTOR_TAB_IDS.length;
    else if (event.key === "Home") to = 0;
    else if (event.key === "End") to = INSPECTOR_TAB_IDS.length - 1;
    else return;
    event.preventDefault();
    choose(INSPECTOR_TAB_IDS[to]);
    refs.current[to]?.focus();
  };

  const Panel = PANELS[tab] ?? PANELS.explain;

  return (
    <div className="inspector" data-section={tab}>
      <div
        className="inspector-tabs"
        role="tablist"
        aria-label="Inspector sections"
        onKeyDown={onKeyDown}
      >
        {INSPECTOR_TABS.map((entry, i) => {
          const active = entry.id === tab;
          return (
            <button
              key={entry.id}
              type="button"
              role="tab"
              id={tabId(entry.id)}
              data-tabid={entry.id}
              aria-selected={active}
              aria-controls={panelId(entry.id)}
              tabIndex={active ? 0 : -1}
              ref={(node) => {
                refs.current[i] = node;
              }}
              className={`inspector-tab${active ? " on" : ""}`}
              onClick={() => choose(entry.id)}
            >
              {entry.label}
            </button>
          );
        })}
      </div>

      <div
        className="inspector-body"
        role="tabpanel"
        id={panelId(tab)}
        aria-labelledby={tabId(tab)}
        tabIndex={0}
        key={tab}
      >
        <PanelError>
          <Panel ctx={ctx} />
        </PanelError>
      </div>
    </div>
  );
}
