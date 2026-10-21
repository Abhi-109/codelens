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
import { scopeLabel, stepLabel, variableRows } from "./labels.js";
import {
  CallList,
  ChangeList,
  MemoryGraph,
  PanelError,
  PanelHead,
  VariableRow,
  VariableTable,
  WatchHistory,
} from "./panelBits.jsx";

const tabId = (id) => `inspector-tab-${id}`;
const panelId = (id) => `inspector-panel-${id}`;

/* --- The six sections ---------------------------------------------------- */

function ChangeValue({ change }) {
  if (change.kind === "new" || change.kind === "new-slot") {
    return (
      <>
        <span className="explain-change-tag">new</span>
        <span className="explain-change-to">{change.to}</span>
      </>
    );
  }
  if (change.kind === "removed" || change.kind === "removed-slot") {
    return (
      <>
        <span className="explain-change-from">{change.from}</span>
        <span className="explain-change-tag">removed</span>
      </>
    );
  }
  return (
    <>
      <span className="explain-change-from">{change.from}</span>
      <span className="explain-change-arrow" aria-hidden="true">
        →
      </span>
      <span className="explain-change-to">{change.to}</span>
    </>
  );
}

function ExplainChanges({ view }) {
  if (view.kind !== "line" && view.kind !== "call") return null;
  const changes = Array.isArray(view.changes) ? view.changes : [];
  const label = view.kind === "line" ? "Changes when this line runs" : "Values passed in";

  if (changes.length === 0) {
    if (view.kind !== "line") return null;
    return (
      <div className="explain-part">
        <div className="explain-part-label">{label}</div>
        <p className="explain-changes-empty">
          {view.after
            ? "No variable or container values change on this line."
            : "The trace has no later state for this line, so its changes are unavailable."}
        </p>
      </div>
    );
  }

  return (
    <div className="explain-part">
      <div className="explain-part-label">{label}</div>
      <ul className="explain-changes" aria-label="Value changes at this step">
        {changes.map((change, i) => (
          <li key={`${change.name}:${change.kind}:${i}`} className="explain-change">
            <span className="explain-change-name">{change.name}</span>
            <ChangeValue change={change} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ExplainPanel({ ctx }) {
  const {
    result,
    view,
    line,
    callTitle,
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
        hint="What happened, what changed, and what comes next."
        help="The explanation is read from the one trace event this step is built from. Open the reasoning below for control flow; the Advanced mode adds raw execution metadata."
      />

      {result ? (
        <div className="explain-head">
          <span className="explain-label">Step {index + 1}</span>
          <span className="explain-where">{`line ${line ?? "?"} · ${callTitle}`}</span>
        </div>
      ) : null}

      {result ? (
        <>
          <div className="explain-part">
            <div className="explain-part-label">Just happened</div>
            <p className="explain-text just">{view.explanation.justHappened ?? "Nothing yet."}</p>
          </div>
          <div className="explain-part">
            <div className="explain-part-label">Next</div>
            <p className="explain-text about">{view.explanation.aboutToHappen}</p>
          </div>
          <ExplainChanges view={view} />
        </>
      ) : (
        <p className="explain-text about">
          Press Run and this will explain each step in plain English.
        </p>
      )}

      {showConcept && concept && !dismissed.has(view.explanation.concept) ? (
        <details className="concept-card">
          <summary>New idea · {concept.term}</summary>
          <p>{concept.blurb}</p>
          <button
            type="button"
            className="ghost"
            onClick={() => dismissConcept(view.explanation.concept)}
          >
            Hide
          </button>
        </details>
      ) : null}

      {view.explanation.why || detail.structured ? (
        <details className="explain-more">
          <summary>Why this line runs now</summary>
          {view.explanation.why ? (
            <p className="explain-text why">{view.explanation.why}</p>
          ) : null}

          {/* The old panel C, folded in: the same step seen as a path rather
              than as prose, with each row able to jump to the step it names. */}
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
        </details>
      ) : null}

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

/**
 * Exported so the Combined view can draw the *same* variables panel beside the
 * call tree. It is one component reading one `ctx`, not a second
 * implementation that could drift from the inspector's.
 */
export function VariablesPanel({ ctx }) {
  const {
    view,
    trace,
    index,
    showAfter,
    setShowAfter,
    changeByName,
    watched,
    setWatched,
    history,
    jumpTo,
    detail,
  } = ctx;
  const [layout, setLayout] = useState("boxes");
  const rows = variableRows(view, showAfter);
  const previews = view.changes.filter(
    (change) => change.kind === "new" || change.kind === "removed",
  );
  const defined = view.frame?.defined ?? [];
  const scope = scopeLabel(view.frame);

  return (
    <>
      <PanelHead
        title="Variables"
        hint="What the program remembers right now."
        help="Each name is a labelled box. The list shows the values just before the highlighted line runs. Click a name to see how it changed over time."
      />

      <div className="vars-controls">
        <div className="state-toggle" role="group" aria-label="Variable layout">
          <button
            type="button"
            className={layout === "boxes" ? "on" : ""}
            aria-pressed={layout === "boxes"}
            onClick={() => setLayout("boxes")}
          >
            Boxes
          </button>
          <button
            type="button"
            className={layout === "table" ? "on" : ""}
            aria-pressed={layout === "table"}
            onClick={() => setLayout("table")}
          >
            Table
          </button>
        </div>
        <div className="state-toggle" role="group" aria-label="State shown">
          <button type="button" className={showAfter ? "" : "on"} onClick={() => setShowAfter(false)}>
            Before this line
          </button>
          <button type="button" className={showAfter ? "on" : ""} onClick={() => setShowAfter(true)}>
            After this line
          </button>
        </div>
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
      ) : layout === "table" ? (
        <VariableTable
          rows={rows}
          changeByName={changeByName}
          watched={watched}
          onWatch={(name) => setWatched((current) => (current === name ? null : name))}
          showTypes={detail.showTypes}
          scope={scope}
        />
      ) : (
        <ul className="vars boxes">
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
          After this line:{" "}
          {previews
            .map((change) =>
              change.kind === "removed"
                ? `${change.name} is removed (was ${change.from})`
                : `${change.name} = ${change.to}`,
            )
            .join(", ")}
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
          index={index}
          total={trace.length}
          onJump={jumpTo}
          onClose={() => setWatched(null)}
        />
      ) : null}
      {defined.length > 0 ? <p className="defined">Defined here: {defined.join(", ")}</p> : null}
    </>
  );
}

/** Exported for the Combined view, for the same reason as VariablesPanel. */
export function StackPanel({ ctx }) {
  const { view, olderCalls, selectedCall, selectFrame, clearSelectedCall } = ctx;
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
        onSelect={selectFrame}
      />
      {olderCalls > 0 ? (
        <p className="preview">
          {olderCalls} older call{olderCalls === 1 ? " is" : "s are"} waiting for this one to
          finish.
        </p>
      ) : null}
      {view.selectionLost ? (
        <p className="preview">
          That call has finished, so its variables are gone. Showing the call that is
          running now.
        </p>
      ) : selectedCall !== null && selectedCall !== view.frameId ? (
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
  const { heap, heapNames, objectChanged, view, detail, selectFrame } = ctx;
  const ids = Object.keys(heap ?? {});
  return (
    <>
      <PanelHead
        title="Memory"
        hint="The stack, and the lists and objects it points at."
        help="A name can point at the same list as another name. Small values - numbers, short strings, True and False - stay in the stack boxes; lists, dictionaries and objects live in the heap. An arrow means 'this name is holding that object'. They are drawn from the trace, so a name never points at something the program did not create."
      />
      {ids.length === 0 && view.callStack.length === 0 ? (
        <p className="empty">Run your code to see the stack and the objects it holds.</p>
      ) : (
        <MemoryGraph
          frames={view.frames}
          stack={view.callStack}
          heap={heap}
          names={heapNames}
          changes={objectChanged}
          showIds={detail.showTypes}
          selectedId={view.frame?.frameId ?? null}
          onSelectFrame={selectFrame}
          shared={view.shared}
        />
      )}
    </>
  );
}

const OUTCOME_LABELS = {
  handled: "Handled",
  propagated: "Moved to caller",
  uncaught: "Uncaught",
  raised: "Raised",
};

function OutputRuns({ segments, onJump, future = false }) {
  return segments.map((segment) => (
    <button
      key={segment.at}
      type="button"
      className="output-chunk"
      onClick={() => onJump(segment.at)}
      title={`Step ${segment.at + 1}${segment.line ? `, line ${segment.line}` : ""}`}
      aria-label={`Jump to step ${segment.at + 1}, which printed: ${
        segment.text.replace(/\s+/g, " ").trim().slice(0, 80) || "(whitespace)"
      }`}
      data-future={future ? "true" : undefined}
    >
      {segment.text}
    </button>
  ));
}

function InputLog({ entries, onJump, future = false }) {
  return (
    <ul className="input-log" aria-label={future ? "Later input" : "Input supplied"}>
      {entries.map((entry) => (
        <li key={entry.index}>
          <button type="button" className="ghost" onClick={() => onJump(entry.index)}>
            Step {entry.index + 1}
            {entry.line ? ` · line ${entry.line}` : ""}
          </button>
          <span className="input-prompt">{entry.prompt || "(no prompt)"}</span>
          <span aria-hidden="true">→</span>
          <code>{entry.value}</code>
        </li>
      ))}
    </ul>
  );
}

function ErrorLog({ entries, onJump }) {
  return (
    <ul className="error-log">
      {entries.map((entry) => (
        <li key={`${entry.event}-${entry.index}-${entry.type}`}>
          <button
            type="button"
            className="ghost"
            onClick={() => onJump(entry.index)}
            disabled={entry.index == null}
          >
            {entry.index == null ? "No step" : `Step ${entry.index + 1}`}
          </button>
          <strong>{entry.type}</strong>
          {entry.line ? <span>line {entry.line}</span> : null}
          <span className="error-message">{entry.message || "(no message recorded)"}</span>
          <span className="cmp-outcome" data-outcome={entry.outcome}>
            {OUTCOME_LABELS[entry.outcome] ?? entry.outcome}
          </span>
          {entry.recorded === false ? (
            <span className="cmp-note">reported by the run, no separate trace event</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function OutputPanel({ ctx }) {
  const { output, jumpTo } = ctx;
  const futureChars = output.futureText.length;
  return (
    <>
      <PanelHead
        title="Output"
        hint="What the program printed, up to this step."
        help="Only output at or before the highlighted step is shown in the console. Output that comes later is folded away under a clear 'not run yet' heading. Input prompts and values and any errors are listed separately, and every row jumps to the trace step it came from."
      />

      <div className="output-console" aria-label="Output printed up to the current step">
        {output.pastSegments.length > 0 ? (
          <OutputRuns segments={output.pastSegments} onJump={jumpTo} />
        ) : (
          <span className="empty">(nothing printed yet)</span>
        )}
      </div>

      {output.futureSegments.length > 0 ? (
        <details className="output-later">
          <summary>
            Later output — not run yet ({output.futureSegments.length} printed run
            {output.futureSegments.length === 1 ? "" : "s"}, {futureChars} characters)
          </summary>
          <div className="output-console later" aria-label="Later recorded output">
            <OutputRuns segments={output.futureSegments} onJump={jumpTo} future />
          </div>
        </details>
      ) : null}

      {output.inputs.length > 0 ? (
        <section className="output-section" aria-labelledby="output-input-title">
          <h4 id="output-input-title">Input supplied</h4>
          <InputLog entries={output.inputs} onJump={jumpTo} />
        </section>
      ) : null}

      {output.futureInputs.length > 0 ? (
        <details className="output-later">
          <summary>Later input ({output.futureInputs.length})</summary>
          <InputLog entries={output.futureInputs} onJump={jumpTo} future />
        </details>
      ) : null}

      {output.errors.length > 0 ? (
        <section className="output-section" aria-labelledby="output-error-title">
          <h4 id="output-error-title">Errors</h4>
          <ErrorLog entries={output.errors} onJump={jumpTo} />
        </section>
      ) : null}

      {output.futureErrors.length > 0 ? (
        <details className="output-later">
          <summary>Later errors ({output.futureErrors.length})</summary>
          <ErrorLog entries={output.futureErrors} onJump={jumpTo} />
        </details>
      ) : null}
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
