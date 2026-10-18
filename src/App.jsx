import { useEffect, useMemo, useRef, useState } from "react";
import { buildFlowchart, onEngineStatus, runTrace } from "./tracer/client";
import { CONCEPTS, isNewConcept } from "./tracer/explain";
import { countFor, flowFor, pathToLine, runsByLine } from "./tracer/flow";
import { namesById, objectChanges, slotEntries } from "./tracer/objects";
import { formatValue, showValue } from "./tracer/values";
import { changeLog, errorStep, getStepView, variableHistory } from "./tracer/stepView";
import { buildExecutionGraph } from "./flowchart/executionGraph.js";
import ExecutionGraph from "./flowchart/ExecutionGraph.jsx";
import "./App.css";

const MODULE = "<module>";

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
  {
    name: "Merge sort",
    code:
      "def merge_sort(arr):\n    if len(arr) <= 1:\n        return arr\n    mid = len(arr) // 2\n    left = merge_sort(arr[:mid])\n    right = merge_sort(arr[mid:])\n    return merge(left, right)\n\n\ndef merge(left, right):\n    result = []\n    i = 0\n    j = 0\n    while i < len(left) and j < len(right):\n        if left[i] <= right[j]:\n            result.append(left[i])\n            i += 1\n        else:\n            result.append(right[j])\n            j += 1\n    result.extend(left[i:])\n    result.extend(right[j:])\n    return result\n\n\ndata = [38, 27, 43, 3, 9, 82, 10]\nprint(merge_sort(data))\n",
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
  { id: "changes", label: "Changes" },
  { id: "stack", label: "Calls" },
  { id: "output", label: "Output" },
];

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

/** A small "?" that opens a one-paragraph beginner explanation, and never takes space. */
function SectionHelp({ title, children }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="help">
      <button
        type="button"
        className="help-dot"
        aria-label={`What is ${title}?`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        ?
      </button>
      {open ? (
        <>
          <span className="help-backdrop" onClick={() => setOpen(false)} />
          <span className="help-pop" role="note">
            {children}
          </span>
        </>
      ) : null}
    </span>
  );
}

/** A panel heading in plain language, with a one-line purpose underneath. */
function PanelHead({ title, hint, help }) {
  return (
    <div className="panel-head">
      <div className="panel-head-row">
        <h3>{title}</h3>
        {help ? <SectionHelp title={title}>{help}</SectionHelp> : null}
      </div>
      {hint ? <p className="panel-hint">{hint}</p> : null}
    </div>
  );
}

/** One line of code, with the run markers, a result hint and hover values. */
function CodeLine({ number, text, current, justRan, error, hint, values, onJump }) {
  const parts = [];
  const pattern = /[A-Za-z_]\w*/g;
  let last = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const name = match[0];
    parts.push(
      name in values ? (
        <span key={match.index} className="code-ident" title={`${name} = ${values[name]}`}>
          {name}
        </span>
      ) : (
        name
      ),
    );
    last = match.index + name.length;
  }
  parts.push(text.slice(last));

  return (
    <button
      type="button"
      className={`code-line${current ? " current" : ""}${justRan ? " just-ran" : ""}${
        error ? " code-error" : ""
      }`}
      onClick={onJump}
      title={error ? "This line is where the program went wrong" : "Jump to a step that runs this line"}
    >
      <span className="code-mark" aria-hidden="true">
        {error ? "✕" : current ? "▶" : justRan ? "•" : ""}
      </span>
      <span className="ln">{number}</span>
      <span className="code-text">
        {parts}
        {hint ? (
          <span className="code-hint" title="the result of this line">
            → {hint}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function VariableRow({ entry, change, onChange, watched, onWatch }) {
  // An argument is already explained by its "argument" tag; no NEW/after noise.
  // A slot change inside a list or object is shown on the object itself.
  const badged =
    change && change.kind !== "slot" && change.kind !== "new-slot" && !change.arg;
  return (
    <li className={`var-row${badged ? " changed" : ""}`}>
      <button type="button" className="var-name" onClick={onWatch} aria-pressed={watched}>
        {entry.name}
      </button>
      <span className="var-eq">=</span>
      <span className="var-value">{entry.text}</span>
      {entry.isArg ? <span className="tag">argument</span> : null}
      {badged ? (
        <span className={`tag tag-${change.kind}`}>{change.kind === "new" ? "NEW" : "CHANGED"}</span>
      ) : null}
      {badged && change.kind === "changed" ? (
        <span className="var-delta">
          was {change.from} (line {change.line})
        </span>
      ) : null}
      {badged ? (
        <span className="var-after">
          after this line: {change.to}
        </span>
      ) : null}
      {watched && onChange ? (
        <button type="button" className="var-jump" onClick={() => onChange(entry.name)}>
          history
        </button>
      ) : null}
    </li>
  );
}

function WatchHistory({ name, entries, index, onJump, onClose }) {
  return (
    <div className="watch">
      <div className="watch-head">
        <strong>{name}</strong> over time
        <button type="button" className="ghost" onClick={onClose}>
          ✕
        </button>
      </div>
      <ol className="watch-list">
        {entries.map((entry) => (
          <li key={entry.index}>
            <button
              type="button"
              className={`watch-step${entry.index === index ? " on" : ""}`}
              onClick={() => onJump(entry.index)}
            >
              step {entry.index + 1}
            </button>
            <span className="var-value">{entry.value}</span>
            <span className="watch-line">{entry.line ? `line ${entry.line}` : entry.function}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ChangeList({ log, index, onJump }) {
  const shown = log.filter((entry) => entry.index <= index).slice(-40).reverse();
  if (shown.length === 0) return <p className="empty">Nothing has changed yet.</p>;
  return (
    <ol className="changes">
      {shown.map((entry, i) => (
        <li key={`${entry.index}-${entry.name}-${i}`}>
          <button type="button" className="change-jump" onClick={() => onJump(entry.index)}>
            step {entry.index + 1}
          </button>
          <span className="change-name">{entry.name}</span>
          <span className="change-values">
            {entry.from === null ? "" : `${entry.from} → `}
            <strong>{entry.to}</strong>
          </span>
          <span className="watch-line">{entry.line ? `line ${entry.line}` : ""}</span>
        </li>
      ))}
    </ol>
  );
}

function CallList({ callStack, selectedId, onSelect }) {
  if (callStack.length === 0) return <p className="empty">Nothing is running yet.</p>;
  return (
    <ol className="calls">
      {callStack.map((frame, i) => (
        <li
          key={frame.frameId}
          className={`call${frame.frameId === selectedId ? " on" : ""}${i === 0 ? " top" : ""}`}
        >
          <button type="button" className="call-main" onClick={() => onSelect(frame.frameId)}>
            <span className="call-name">
              {frame.function === MODULE ? "top level (the whole program)" : frame.function}
              {frame.function === MODULE ? "" : ` call #${frame.callNumber}`}
            </span>
            {frame.args.length > 0 ? (
              <span className="call-args">
                {frame.args.map((arg) => `${arg.name} = ${arg.text}`).join(", ")}
              </span>
            ) : null}
            <span className="call-where">
              {frame.callLine
                ? `called from line ${frame.callLine}`
                : frame.line
                  ? `on line ${frame.line}`
                  : "the program starts here"}
            </span>
            {frame.returnValue !== null ? (
              <span className="call-return">returned {frame.returnValue}</span>
            ) : null}
          </button>
        </li>
      ))}
    </ol>
  );
}

function SlotLabel({ label, heap }) {
  if (label === null || label === undefined) return null;
  const text = typeof label === "object" ? formatValue(label, heap) : String(label);
  return <div className="slot-label">{text}</div>;
}

function SlotValue({ value, heap }) {
  return <span>{showValue(value, heap)}</span>;
}

/** The lists, dicts and objects the program remembers, with changed slots lit. */
function HeapObjects({ heap, names, changes }) {
  const ids = Object.keys(heap ?? {});
  if (ids.length === 0) return null;
  return (
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
              <span className="object-names">
                {labels.length > 0 ? labels.join(" and ") : `${typeLabel}`}
              </span>
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
              {object.more ? <div className="slot slot-more">+{object.more} more</div> : null}
              {slots.length === 0 ? <div className="slot slot-empty">empty</div> : null}
            </div>
          </div>
        );
      })}
    </div>
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

/** The variables list, switched between the before and after state. */
function variableRows(view, showAfter) {
  const rows = (view.frame?.variables ?? []).map((entry) => ({ ...entry }));
  if (!showAfter) return rows;
  const byName = new Map(rows.map((row) => [row.name, row]));
  for (const change of view.changes) {
    if (change.kind === "slot") continue;
    const row = byName.get(change.name);
    if (row) row.text = change.to;
    else rows.push({ name: change.name, text: change.to, isArg: Boolean(change.arg) });
  }
  return rows;
}

export default function App() {
  const [source, setSource] = useState(EXAMPLES[START_EXAMPLE].code);
  const [result, setResult] = useState(null);
  const [flow, setFlow] = useState(null);
  const [viewMode, setViewMode] = useState("beginner");
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
  const [selectedCall, setSelectedCall] = useState(null);
  const [watched, setWatched] = useState(null);
  const [showAfter, setShowAfter] = useState(false);
  const [dismissed, setDismissed] = useState(() => new Set());
  // On a phone the Run button lives behind the Code tab, so start there.
  const [tab, setTab] = useState(() => (window.innerWidth < 900 ? "code" : "graph"));

  const timer = useRef(null);
  const layoutRef = useRef(null);
  const splitDrag = useRef(null);
  const currentLine = useRef(null);
  const codeView = useRef(null);

  useEffect(() => onEngineStatus(setEngine), []);

  useEffect(() => saveColumns(columns), [columns]);

  const trace = useMemo(() => result?.trace ?? [], [result]);
  const graph = useMemo(() => buildExecutionGraph(trace, source), [trace, source]);
  const view = useMemo(
    () => getStepView(trace, index, source, { frameId: selectedCall, steps: graph.steps }),
    [trace, index, source, selectedCall, graph],
  );
  const log = useMemo(() => changeLog(trace), [trace]);
  const history = useMemo(
    () => (watched ? variableHistory(trace, watched) : []),
    [trace, watched],
  );

  const concept = view.explanation.concept ? CONCEPTS[view.explanation.concept] : null;
  const showConcept = useMemo(
    () => isNewConcept(trace, index, source, view.explanation.concept),
    [trace, index, source, view.explanation.concept],
  );

  const heapNames = useMemo(() => namesById(view.frames, view.before?.heap), [view]);
  const objectChanged = useMemo(
    () => objectChanges(view.before?.heap, view.after?.heap),
    [view],
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

  const line = view.line;
  // One code panel: editable until a run, then read-only with the line lit up.
  const stepping = !editing && result !== null;
  // The line the program broke on, so the code pane can point at it.
  const errorLine = result?.error?.line ?? null;
  const callTitle =
    view.frame && view.frame.function !== MODULE
      ? `${view.frame.function} call #${view.frame.callNumber}${
          view.frame.args.length > 0
            ? `, ${view.frame.args.map((arg) => `${arg.name} = ${arg.text}`).join(", ")}`
            : ""
        }`
      : "the top level";

  // Keep the lit-up line in view without ever scrolling the page.
  useEffect(() => {
    if (!stepping) return;
    if (currentLine.current) {
      currentLine.current.scrollIntoView({ block: "nearest", inline: "nearest" });
    } else if (codeView.current) {
      // Nothing is running yet, so start the reader at the top of the program.
      codeView.current.scrollTop = 0;
    }
  }, [stepping, line]);

  const jumpTo = (i) => {
    setPlaying(false);
    setIndex(Math.max(0, Math.min(i, Math.max(trace.length - 1, 0))));
  };

  // Clicking a call selects its own variables and jumps to where it started.
  const jumpToCall = (frameId) => {
    setSelectedCall(frameId);
    const at = trace.findIndex(
      (event) => event.frames?.[event.frames.length - 1]?.frame_id === frameId,
    );
    if (at >= 0) jumpTo(at);
  };

  // Clicking a line of code jumps to the next step (at or after here) that runs it.
  const jumpToLine = (number) => {
    let at = -1;
    for (let i = index; i < trace.length; i += 1) {
      if (trace[i].event === "line" && trace[i].line === number) {
        at = i;
        break;
      }
    }
    if (at < 0) at = trace.findIndex((e) => e.event === "line" && e.line === number);
    if (at >= 0) jumpTo(at);
  };

  async function handleRun() {
    setPlaying(false);
    setRunning(true);
    try {
      const [r, f] = await Promise.all([runTrace(source), buildFlowchart(source)]);
      setResult(r);
      setFlow(f);
      // A run that crashed opens on the step that failed, so the line that
      // broke is already lit up when the error message appears.
      setIndex(r?.error ? errorStep(r.trace) : 0);
      setEditing(false);
      setSelectedCall(null);
      setWatched(null);
      setDismissed(new Set());
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

  const changeByName = useMemo(() => {
    const map = new Map();
    for (const change of view.changes) map.set(change.name, change);
    return map;
  }, [view]);

  const rows = variableRows(view, showAfter);
  const defined = view.frame?.defined ?? [];
  const previews = view.changes.filter((change) => change.kind === "new");

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
            <div className="code-view readonly" ref={codeView}>
              {source.split("\n").map((text, i) => (
                <div key={i} ref={line === i + 1 ? currentLine : null}>
                  <CodeLine
                    number={i + 1}
                    text={text}
                    current={line === i + 1}
                    justRan={view.previousLine === i + 1 && line !== i + 1}
                    error={errorLine === i + 1}
                    hint={line === i + 1 ? view.hint : null}
                    values={view.values}
                    onJump={() => jumpToLine(i + 1)}
                  />
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
          <div className="explain-head">
            <div className="explain-label">What's happening</div>
            <span className="explain-where">
              {result ? (
                <>
                  line {line ?? "?"} · {callTitle}
                </>
              ) : null}
            </span>
          </div>

          {result ? (
            <>
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
                onClick={() =>
                  setDismissed((set) => new Set(set).add(view.explanation.concept))
                }
              >
                ✕
              </button>
            </div>
          ) : null}

          {result?.error ? (
            <p className="error-inline">
              <strong>{result.error.type}</strong> on line {result.error.line ?? "?"}:{" "}
              {result.error.message}
            </p>
          ) : null}
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
              {result && <span className="flow-of"> — {callTitle}</span>}
            </h3>
            <div className="state-toggle flow-view" role="group" aria-label="How much detail to show">
              <button
                type="button"
                className={viewMode === "beginner" ? "on" : ""}
                onClick={() => setViewMode("beginner")}
                title="Plain English, values and changes, nothing technical"
              >
                Beginner
              </button>
              <button
                type="button"
                className={viewMode === "advanced" ? "on" : ""}
                onClick={() => setViewMode("advanced")}
                title="The same graph with trace details: frames, run counts, wire labels"
              >
                Advanced
              </button>
              <button
                type="button"
                className={viewMode === "textbook" ? "on" : ""}
                onClick={() => setViewMode("textbook")}
                title="The textbook flowchart for the function you are inside"
              >
                Textbook
              </button>
            </div>
          </div>
          {viewMode === "textbook" ? (
            <div className="pane-scroll">
              <Flowchart flow={flow} functionName={view.function} trace={trace} line={line} />
            </div>
          ) : (
            <ExecutionGraph
              trace={trace}
              source={source}
              graph={graph}
              index={index}
              mode={viewMode}
              onJump={jumpTo}
              note={
                flow?.error
                  ? "There is nothing to draw: the code has a syntax error, so it never ran."
                  : null
              }
            />
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
              <PanelHead
                title="Variables"
                hint="What the program remembers right now."
                help="Each name is a labelled box. The list shows the values just before the highlighted line runs. Click a name to see how it changed over time."
              />
              <div className="state-toggle">
                <button
                  type="button"
                  className={showAfter ? "" : "on"}
                  onClick={() => setShowAfter(false)}
                >
                  Before this line
                </button>
                <button
                  type="button"
                  className={showAfter ? "on" : ""}
                  onClick={() => setShowAfter(true)}
                >
                  After this line
                </button>
              </div>
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
                      onWatch={() => setWatched((name) => (name === entry.name ? null : entry.name))}
                    />
                  ))}
                </ul>
              )}
              {previews.length > 0 ? (
                <p className="preview">
                  After this line:{" "}
                  {previews.map((change) => `${change.name} = ${change.to}`).join(", ")}
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
                  onJump={jumpTo}
                  onClose={() => setWatched(null)}
                />
              ) : null}
              {defined.length > 0 ? (
                <p className="defined">Defined here: {defined.join(", ")}</p>
              ) : null}
              <div className="object-wrap">
                <HeapObjects heap={view.before?.heap} names={heapNames} changes={objectChanged} />
              </div>
            </section>

            <section className="panel" data-card="changes">
              <PanelHead
                title="Changes"
                hint="Every value the program changed, newest first. Click a step to jump to it."
                help="This is the story of the run: which variable changed, from what, to what, and on which line."
              />
              <ChangeList log={log} index={index} onJump={jumpTo} />
            </section>

            <section className="panel" data-card="stack">
              <PanelHead
                title="Function calls"
                hint="Where the program is right now."
                help="Each time a function runs, Python gives it its own fresh set of variables. The newest call is on top; when it finishes, we return to the one below."
              />
              <CallList
                callStack={view.callStack}
                selectedId={view.frame?.frameId ?? null}
                onSelect={jumpToCall}
              />
              {selectedCall !== null && selectedCall !== view.frameId ? (
                <p className="preview">
                  Showing an older call's variables.{" "}
                  <button type="button" className="ghost" onClick={() => setSelectedCall(null)}>
                    back to current
                  </button>
                </p>
              ) : null}
            </section>

            <section className="panel" data-card="output">
              <PanelHead
                title="Output"
                hint="What the program printed."
                help="print() shows text here. It never changes a variable."
              />
              <pre className="output">
                {output || <span className="empty">(nothing printed yet)</span>}
              </pre>
            </section>
          </div>
        </section>
      </main>

      <footer className="controls-bar">
        <div className="controls">
          <button type="button" onClick={() => jumpTo(0)} disabled={!trace.length}>
            ⏮
          </button>
          <button
            type="button"
            onClick={() => jumpTo(index - 1)}
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
            onClick={() => jumpTo(index + 1)}
            disabled={!trace.length}
          >
            Next ▶
          </button>
          <button
            type="button"
            onClick={() => jumpTo(trace.length - 1)}
            disabled={!trace.length}
          >
            ⏭
          </button>
          <input
            type="range"
            min={0}
            max={Math.max(trace.length - 1, 0)}
            value={index}
            onChange={(event) => jumpTo(Number(event.target.value))}
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
