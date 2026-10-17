import { useEffect, useMemo, useRef, useState } from "react";
import { buildFlowchart, onEngineStatus, runTrace } from "./tracer/client";
import { CONCEPTS, explainStep, isNewConcept } from "./tracer/explain";
import { countFor, flowFor, pathToLine, runsByLine } from "./tracer/flow";
import { namesById, objectChanges, slotEntries } from "./tracer/objects";
import { formatValue } from "./tracer/values";
import ExecutionGraph from "./flowchart/ExecutionGraph.jsx";
import "./App.css";

const EXAMPLES = [
  {
    name: "Variables",
    code: 'name = "Asha"\nage = 12\nheight = 1.52\nis_student = True\nnothing = None\nprint(name, age)\n',
  },
  {
    name: "if / else",
    code: 'marks = 68\nif marks >= 90:\n    grade = "A"\nelif marks >= 60:\n    grade = "B"\nelse:\n    grade = "C"\nprint(grade)\n',
  },
  {
    name: "for loop",
    code: "total = 0\nfor n in range(1, 6):\n    total = total + n\nprint(total)\n",
  },
  {
    name: "Recursion",
    code: "def fact(n):\n    if n <= 1:\n        return 1\n    return n * fact(n - 1)\n\n\nprint(fact(5))\n",
  },
  {
    name: "List",
    code: 'fruits = ["apple", "banana"]\nfruits.append("cherry")\nprint(fruits[2])\n',
  },
  {
    name: "Class",
    code:
      "class Dog:\n    def __init__(self, name):\n        self.name = name\n        self.tricks = []\n\n    def learn(self, trick):\n        self.tricks.append(trick)\n\n\nrex = Dog('Rex')\nrex.learn('sit')\nprint(rex.tricks)\n",
  },
];

const START_EXAMPLE = 3; // Recursion — the best demo of the execution graph.

// Column widths are percentages; each side keeps a minimum so nothing collapses.
const COLS_KEY = "codelens.columns";
const DEFAULT_COLUMNS = { left: 30, mid: 44 };
const MIN_LEFT = 18;
const MIN_MID = 26;
const MIN_RIGHT = 18;

// Below 1280px the columns become tabs. "Code" is only reachable as a tab on
// phones; from 900px up the code column is always on screen.
const TABS = [
  { id: "code", label: "Code", phoneOnly: true },
  { id: "graph", label: "Graph" },
  { id: "variables", label: "Variables" },
  { id: "stack", label: "Stack" },
  { id: "output", label: "Output" },
];

// Variables holding a function, class or module are not values — they are
// summarised on one muted line instead of taking a box each.
const DEFINED_TYPES = new Set(["function", "class", "module"]);

const clamp = (value, lo, hi) => Math.min(Math.max(value, lo), hi);

function loadColumns() {
  try {
    const raw = JSON.parse(localStorage.getItem(COLS_KEY));
    if (raw && Number.isFinite(raw.left) && Number.isFinite(raw.mid)) {
      return { left: clamp(raw.left, MIN_LEFT, 90), mid: clamp(raw.mid, MIN_MID, 90) };
    }
  } catch {
    // localStorage can be missing or blocked; fall back to the defaults.
  }
  return { ...DEFAULT_COLUMNS };
}

function saveColumns(columns) {
  try {
    localStorage.setItem(COLS_KEY, JSON.stringify(columns));
  } catch {
    // Remembering the split is a nicety, not a requirement.
  }
}

// Output and input events don't carry the stack; use the last event that did.
function stateAt(trace, index) {
  for (let i = Math.min(index, trace.length - 1); i >= 0; i -= 1) {
    if (trace[i]?.frames) return trace[i];
  }
  return null;
}

function VariableBoxes({ variables, heap, changed }) {
  const names = Object.keys(variables ?? {});
  const values = names.filter((name) => !DEFINED_TYPES.has(variables[name]?.type));
  const defined = names.filter((name) => DEFINED_TYPES.has(variables[name]?.type));

  if (names.length === 0) return <p className="empty">No variables yet</p>;

  return (
    <>
      {values.length === 0 ? (
        <p className="empty">No values yet</p>
      ) : (
        <div className="boxes">
          {values.map((name) => {
            const value = variables[name];
            return (
              <div key={name} className={`box${changed?.has(name) ? " changed" : ""}`}>
                <div className="box-name">{name}</div>
                <div className="box-value">
                  {value.type === "ref" ? (
                    <span className="ref-pointer">→ {value.id}</span>
                  ) : (
                    formatValue(value, heap)
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {defined.length > 0 ? <p className="defined">Defined: {defined.join(", ")}</p> : null}
    </>
  );
}

function SlotLabel({ label, heap }) {
  if (label === null || label === undefined) return null;
  const text = typeof label === "object" ? formatValue(label, heap) : String(label);
  return <div className="slot-label">{text}</div>;
}

function SlotValue({ value, heap }) {
  if (value?.type === "ref") {
    return <span className="ref-pointer">→ {value.id}</span>;
  }
  return formatValue(value, heap);
}

function HeapObjects({ heap, names, changes }) {
  const ids = Object.keys(heap ?? {});
  if (ids.length === 0) return null;
  return (
    <>
      <h3>Objects</h3>
      <div className="objects">
        {ids.map((id) => {
          const object = heap[id];
          const changed = changes?.get(id);
          const labels = names.get(id) ?? [];
          const slots = slotEntries(object);
          const typeLabel = object.class ?? object.type;
          return (
            <div key={id} className={`object-card${changed ? " changed" : ""}`}>
              <div className="object-head">
                <span className="object-names">{labels.length > 0 ? labels.join(", ") : id}</span>
                <span className="ref-pointer">→ {id}</span>
                <span className="object-type">{typeLabel}</span>
              </div>
              <div className="slots">
                {slots.map((entry) => (
                  <div
                    key={entry.key}
                    className={`slot${changed?.has(entry.key) ? " changed" : ""}`}
                  >
                    <SlotLabel label={entry.label} heap={heap} />
                    <div className="slot-value">
                      <SlotValue value={entry.value} heap={heap} />
                    </div>
                  </div>
                ))}
                {object.more ? (
                  <div className="slot slot-more">+{object.more} more</div>
                ) : null}
                {slots.length === 0 ? <div className="slot slot-empty">empty</div> : null}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function FlowNode({ node, runs, activeSet }) {
  const active = activeSet.has(node);
  const count = countFor(node, runs);
  const badge = count > 0 ? <span className="flow-count">×{count}</span> : null;

  if (node.kind === "statement") {
    return (
      <div className={`flow-node flow-statement${active ? " flow-active" : ""}`}>
        <code>{node.text}</code>
        {badge}
      </div>
    );
  }

  if (node.kind === "branch") {
    return (
      <div className={`flow-node flow-branch${active ? " flow-active" : ""}`}>
        {node.arms.map((arm, i) => (
          <div key={i} className="flow-arm">
            <div className={`flow-arm-label${arm.test === null ? " flow-else" : ""}`}>
              {arm.test === null ? "else" : `if ${arm.test}`}
            </div>
            <div className="flow-body">
              {arm.body.length === 0 ? (
                <p className="empty">(nothing)</p>
              ) : (
                arm.body.map((child, j) => (
                  <FlowNode key={j} node={child} runs={runs} activeSet={activeSet} />
                ))
              )}
            </div>
          </div>
        ))}
        {badge}
      </div>
    );
  }

  return (
    <div className={`flow-node flow-loop${active ? " flow-active" : ""}`}>
      <div className="flow-loop-header">
        <span className="flow-loop-arrow">↻</span>
        <code>{node.header}</code>
        {badge}
      </div>
      <div className="flow-body">
        {node.body.length === 0 ? (
          <p className="empty">(nothing)</p>
        ) : (
          node.body.map((child, j) => (
            <FlowNode key={j} node={child} runs={runs} activeSet={activeSet} />
          ))
        )}
      </div>
    </div>
  );
}

function Flowchart({ flow, functionName, trace, line }) {
  const chart = flowFor(flow, functionName);
  const runs = useMemo(() => runsByLine(trace, functionName), [trace, functionName]);
  const activeSet = useMemo(
    () => new Set(pathToLine(chart?.nodes ?? [], line)),
    [chart, line],
  );

  if (flow?.error) {
    return (
      <p className="empty">
        The code has a syntax error on line {flow.error.line ?? "?"}, so there is no flowchart yet.
      </p>
    );
  }
  if (!chart || chart.nodes.length === 0) {
    return <p className="empty">Nothing to draw yet</p>;
  }
  return (
    <div className="flow">
      {chart.nodes.map((node, i) => (
        <FlowNode key={i} node={node} runs={runs} activeSet={activeSet} />
      ))}
    </div>
  );
}

function Splitter({ name, onGrab, onMove, onRelease }) {
  return (
    <div
      className="splitter"
      data-split={name}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize column"
      onPointerDown={onGrab}
      onPointerMove={onMove}
      onPointerUp={onRelease}
      onPointerCancel={onRelease}
    />
  );
}

export default function App() {
  const [source, setSource] = useState(EXAMPLES[START_EXAMPLE].code);
  const [result, setResult] = useState(null);
  const [flow, setFlow] = useState(null);
  const [simpleView, setSimpleView] = useState(false);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [engine, setEngine] = useState("idle");
  const [running, setRunning] = useState(false);
  const [editing, setEditing] = useState(true);
  const [showJson, setShowJson] = useState(false);
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const [columns, setColumns] = useState(loadColumns);
  const [resizing, setResizing] = useState(false);
  const [tab, setTab] = useState("graph");

  const timer = useRef(null);
  const layoutRef = useRef(null);
  const splitDrag = useRef(null);
  const currentLine = useRef(null);

  useEffect(() => onEngineStatus(setEngine), []);

  useEffect(() => saveColumns(columns), [columns]);

  const trace = useMemo(() => result?.trace ?? [], [result]);
  const current = trace[index] ?? null;
  const state = useMemo(() => stateAt(trace, index), [trace, index]);
  const previous = useMemo(() => stateAt(trace, Math.max(index - 1, 0)), [trace, index]);
  const explanation = useMemo(() => explainStep(trace, index, source), [trace, index, source]);
  const concept = explanation.concept ? CONCEPTS[explanation.concept] : null;
  const showConcept = useMemo(
    () => isNewConcept(trace, index, source, explanation.concept),
    [trace, index, source, explanation.concept],
  );

  const changed = useMemo(() => {
    if (!state || !previous || state === previous) return null;
    const now = state.frames?.[state.frames.length - 1]?.variables ?? {};
    const before = previous.frames?.[previous.frames.length - 1]?.variables ?? {};
    const names = new Set();
    for (const name of Object.keys(now)) {
      if (JSON.stringify(now[name]) !== JSON.stringify(before[name])) names.add(name);
    }
    return names;
  }, [state, previous]);

  const heapNames = useMemo(() => namesById(state?.frames, state?.heap), [state]);
  const objectChanged = useMemo(
    () => objectChanges(previous?.heap, state?.heap),
    [state, previous],
  );

  const output = useMemo(
    () =>
      trace
        .slice(0, index + 1)
        .filter((event) => event.event === "output")
        .map((event) => event.text)
        .join(""),
    [trace, index],
  );

  const frames = state?.frames ?? [];
  const line = current?.line ?? state?.line ?? null;
  const functionName = frames[frames.length - 1]?.function ?? "<module>";
  // One code panel: editable until a run, then read-only with the line lit up.
  const stepping = !editing && result !== null;

  // Keep the lit-up line in view without ever scrolling the page.
  useEffect(() => {
    if (!stepping) return;
    currentLine.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [stepping, line]);

  async function handleRun() {
    setPlaying(false);
    setRunning(true);
    try {
      const [r, f] = await Promise.all([runTrace(source), buildFlowchart(source)]);
      setResult(r);
      setFlow(f);
      setIndex(0);
      setEditing(false);
    } catch (error) {
      setResult({
        status: "engine_error",
        trace: [],
        output: "",
        error: { type: "EngineError", message: error.message },
      });
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => {
    if (!playing || trace.length === 0) {
      clearInterval(timer.current);
      return undefined;
    }
    timer.current = setInterval(() => {
      setIndex((i) => {
        if (i >= trace.length - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, 800 / speed);
    return () => clearInterval(timer.current);
  }, [playing, speed, trace.length]);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === "Escape") {
        setGlossaryOpen(false);
        return;
      }
      const tag = event.target?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT") return;
      if (event.key === "ArrowRight") {
        setIndex((i) => Math.min(i + 1, trace.length - 1));
      } else if (event.key === "ArrowLeft") {
        setIndex((i) => Math.max(i - 1, 0));
      } else if (event.key === " ") {
        event.preventDefault();
        setPlaying((p) => !p);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [trace.length]);

  function grabSplitter(which) {
    return (event) => {
      const rect = layoutRef.current?.getBoundingClientRect();
      if (!rect) return;
      splitDrag.current = { which, x: event.clientX, width: rect.width, ...columns };
      event.currentTarget.setPointerCapture(event.pointerId);
      setResizing(true);
    };
  }

  function moveSplitter(event) {
    const drag = splitDrag.current;
    if (!drag) return;
    const delta = ((event.clientX - drag.x) / drag.width) * 100;
    if (drag.which === "left") {
      const left = clamp(drag.left + delta, MIN_LEFT, 100 - drag.mid - MIN_RIGHT);
      setColumns((c) => ({ ...c, left }));
    } else {
      const mid = clamp(drag.mid + delta, MIN_MID, 100 - drag.left - MIN_RIGHT);
      setColumns((c) => ({ ...c, mid }));
    }
  }

  function releaseSplitter() {
    splitDrag.current = null;
    setResizing(false);
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>CodeLens</h1>
        <span className={`engine engine-${engine}`}>
          Python engine: {engine === "ready" ? "ready" : engine}
        </span>
        <span className="step-count">
          {trace.length > 0 ? `Step ${index + 1} of ${trace.length}` : "Not run yet"}
        </span>
      </header>

      <main
        className={`layout${resizing ? " resizing" : ""}`}
        ref={layoutRef}
        data-tab={tab}
        style={{ "--col-left": `${columns.left}%`, "--col-mid": `${columns.mid}%` }}
      >
        <section className="pane code-pane panel" data-pane="code">
          <div className="pane-head">
            <h3>Your Python code</h3>
            {stepping && (
              <button type="button" className="ghost" onClick={() => setEditing(true)}>
                ✎ Edit
              </button>
            )}
          </div>

          {stepping ? (
            <div className="code-view readonly">
              {source.split("\n").map((text, i) => (
                <div
                  key={i}
                  ref={line === i + 1 ? currentLine : null}
                  className={`code-line${line === i + 1 ? " current" : ""}`}
                >
                  <span className="ln">{i + 1}</span>
                  <span>{text || " "}</span>
                </div>
              ))}
            </div>
          ) : (
            <textarea
              value={source}
              onChange={(event) => setSource(event.target.value)}
              spellCheck="false"
              aria-label="Your Python code"
            />
          )}

          <div className="pane-foot">
            <select
              value=""
              aria-label="Load an example"
              onChange={(event) => {
                const example = EXAMPLES.find((e) => e.name === event.target.value);
                if (example) {
                  setSource(example.code);
                  setEditing(true);
                }
              }}
            >
              <option value="">Examples…</option>
              {EXAMPLES.map((example) => (
                <option key={example.name} value={example.name}>
                  {example.name}
                </option>
              ))}
            </select>
            <button type="button" className="run" onClick={handleRun} disabled={running}>
              {running ? "Starting…" : "▶ Run"}
            </button>
          </div>
        </section>

        <Splitter
          name="left"
          onGrab={grabSplitter("left")}
          onMove={moveSplitter}
          onRelease={releaseSplitter}
        />

        <div className="explain" data-pane="teach">
          <div className="explain-label">What happens here</div>
          <p className="explain-text">
            {result
              ? explanation.text
              : "Press Run and this will explain each step in plain English."}
          </p>
          {showConcept && concept && (
            <div className="concept-card">
              <strong>{concept.term}</strong>
              <span>{concept.blurb}</span>
            </div>
          )}
          {result?.error && (
            <p className="error-inline">
              <strong>{result.error.type}</strong> on line {result.error.line ?? "?"}:{" "}
              {result.error.message}
            </p>
          )}
        </div>

        <div className="tabs" role="tablist" aria-label="Panels">
          {TABS.map(({ id, label, phoneOnly }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`tab${tab === id ? " on" : ""}${phoneOnly ? " tab-code" : ""}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <section className="pane graph-pane" data-pane="graph">
          <div className="flow-head">
            <h3>
              Execution graph
              {frames.length > 0 && <span className="flow-of"> — {functionName}()</span>}
            </h3>
            <label className="flow-view">
              <input
                type="checkbox"
                checked={simpleView}
                onChange={(event) => setSimpleView(event.target.checked)}
              />
              Simple view
            </label>
          </div>
          {simpleView ? (
            <div className="pane-scroll">
              <Flowchart
                flow={flow}
                functionName={functionName}
                trace={trace}
                line={line}
              />
            </div>
          ) : (
            <ExecutionGraph trace={trace} source={source} index={index} />
          )}
        </section>

        <Splitter
          name="mid"
          onGrab={grabSplitter("mid")}
          onMove={moveSplitter}
          onRelease={releaseSplitter}
        />

        <section className="pane side-pane" data-pane="side">
          <div className="side-scroll">
            <section className="panel" data-card="variables">
              <h3>Variables</h3>
              <VariableBoxes
                variables={frames[frames.length - 1]?.variables}
                heap={state?.heap}
                changed={changed}
              />
              <HeapObjects heap={state?.heap} names={heapNames} changes={objectChanged} />
            </section>

            <section className="panel" data-card="stack">
              <h3>Call stack</h3>
              {frames.length === 0 ? (
                <p className="empty">Empty</p>
              ) : (
                <div className="stack">
                  {[...frames].reverse().map((frame) => (
                    <div key={frame.frame_id} className="frame">
                      <span className="frame-name">{frame.function}()</span>
                      <span className="frame-line">line {frame.line}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="panel" data-card="output">
              <h3>Output</h3>
              <pre className="output">
                {output || <span className="empty">(nothing printed yet)</span>}
              </pre>
            </section>
          </div>
        </section>
      </main>

      <footer className="controls-bar">
        <div className="controls">
          <button type="button" onClick={() => setIndex(0)} disabled={!trace.length}>
            ⏮
          </button>
          <button
            type="button"
            onClick={() => setIndex((i) => Math.max(i - 1, 0))}
            disabled={!trace.length}
          >
            ◀ Back
          </button>
          <button
            type="button"
            className="play"
            onClick={() => setPlaying((p) => !p)}
            disabled={!trace.length}
          >
            {playing ? "⏸ Pause" : "▶ Play"}
          </button>
          <button
            type="button"
            onClick={() => setIndex((i) => Math.min(i + 1, trace.length - 1))}
            disabled={!trace.length}
          >
            Next ▶
          </button>
          <button type="button" onClick={() => setIndex(trace.length - 1)} disabled={!trace.length}>
            ⏭
          </button>
          <input
            type="range"
            min={0}
            max={Math.max(trace.length - 1, 0)}
            value={index}
            onChange={(event) => setIndex(Number(event.target.value))}
            disabled={!trace.length}
            aria-label="Step"
          />
          <select
            value={speed}
            onChange={(event) => setSpeed(Number(event.target.value))}
            aria-label="Playback speed"
          >
            <option value={0.5}>0.5×</option>
            <option value={1}>1×</option>
            <option value={2}>2×</option>
            <option value={4}>4×</option>
          </select>
        </div>

        <div className="bar-actions">
          <button type="button" className="ghost" onClick={() => setGlossaryOpen(true)}>
            Glossary
          </button>
          <details className="dev-menu">
            <summary>Developer</summary>
            <div className="dev-pop">
              <label className="dev-check">
                <input
                  type="checkbox"
                  checked={showJson}
                  onChange={(event) => setShowJson(event.target.checked)}
                />
                Show raw trace JSON
              </label>
              {showJson && <pre className="json">{JSON.stringify(result, null, 2)}</pre>}
            </div>
          </details>
        </div>
      </footer>

      {glossaryOpen && (
        <div className="drawer-backdrop" onClick={() => setGlossaryOpen(false)}>
          <aside
            className="drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Glossary"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="drawer-head">
              <h2>Glossary</h2>
              <button type="button" className="ghost" onClick={() => setGlossaryOpen(false)}>
                ✕ Close
              </button>
            </div>
            <div className="drawer-body">
              {Object.entries(CONCEPTS).map(([id, entry]) => (
                <div key={id} className="glossary-item">
                  <strong>{entry.term}</strong>
                  <span>{entry.blurb}</span>
                </div>
              ))}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
