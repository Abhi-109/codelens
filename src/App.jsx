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

// Output and input events don't carry the stack; use the last event that did.
function stateAt(trace, index) {
  for (let i = Math.min(index, trace.length - 1); i >= 0; i -= 1) {
    if (trace[i]?.frames) return trace[i];
  }
  return null;
}

function VariableBoxes({ variables, heap, changed }) {
  const names = Object.keys(variables ?? {});
  if (names.length === 0) return <p className="empty">No variables yet</p>;
  return (
    <div className="boxes">
      {names.map((name) => {
        const value = variables[name];
        const isRef = value.type === "ref";
        return (
          <div key={name} className={`box${changed?.has(name) ? " changed" : ""}`}>
            <div className="box-name">{name}</div>
            <div className="box-value">
              {isRef ? (
                <span className="ref-pointer">
                  → {value.id}
                </span>
              ) : (
                formatValue(value, heap)
              )}
            </div>
          </div>
        );
      })}
    </div>
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

export default function App() {
  const [source, setSource] = useState(EXAMPLES[3].code);
  const [result, setResult] = useState(null);
  const [flow, setFlow] = useState(null);
  const [simpleView, setSimpleView] = useState(false);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [engine, setEngine] = useState("idle");
  const [running, setRunning] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const timer = useRef(null);

  useEffect(() => onEngineStatus(setEngine), []);

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

  async function handleRun() {
    setPlaying(false);
    setRunning(true);
    try {
      const [r, f] = await Promise.all([runTrace(source), buildFlowchart(source)]);
      setResult(r);
      setFlow(f);
      setIndex(0);
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
      if (event.target.tagName === "TEXTAREA") return;
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

  const frames = state?.frames ?? [];
  const line = current?.line ?? state?.line ?? null;

  return (
    <div className="app">
      <header>
        <h1>CodeLens</h1>
        <span className={`engine engine-${engine}`}>
          Python engine: {engine === "ready" ? "ready" : engine}
        </span>
      </header>

      <div className="columns">
        <section className="panel editor">
          <div className="panel-title">
            Your Python code
            <select
              value=""
              onChange={(event) => {
                const example = EXAMPLES.find((e) => e.name === event.target.value);
                if (example) setSource(example.code);
              }}
            >
              <option value="">Load an example…</option>
              {EXAMPLES.map((example) => (
                <option key={example.name} value={example.name}>
                  {example.name}
                </option>
              ))}
            </select>
          </div>
          <textarea
            value={source}
            onChange={(event) => setSource(event.target.value)}
            spellCheck="false"
            rows={12}
          />
          <div className="actions">
            <button type="button" className="run" onClick={handleRun} disabled={running}>
              {running ? "Starting…" : "▶ Run"}
            </button>
            <label>
              <input
                type="checkbox"
                checked={showJson}
                onChange={(event) => setShowJson(event.target.checked)}
              />
              Show raw trace JSON
            </label>
          </div>
        </section>

        <section className="panel viewer">
          <div className="panel-title">
            {result ? (
              <>
                Step {index + 1} of {trace.length}
                <span className={`status status-${result.status}`}>{result.status}</span>
              </>
            ) : (
              "Run your code to see it step by step"
            )}
          </div>

          <div className="code-view">
            {source.split("\n").map((text, i) => (
              <div
                key={i}
                className={`code-line${line === i + 1 ? " current" : ""}`}
              >
                <span className="ln">{i + 1}</span>
                <span>{text || " "}</span>
              </div>
            ))}
          </div>

          {current && (
            <div className={`event event-${current.event}`}>
              <strong>{current.event}</strong>
              {current.function ? ` in ${current.function}()` : ""}
              {current.exception ? ` — ${current.exception.type}: ${current.exception.message}` : ""}
              {current.return_value ? ` → ${formatValue(current.return_value, current.heap)}` : ""}
            </div>
          )}

          <div className="explain">
            <div className="explain-label">What happens here</div>
            <p className="explain-text">{explanation.text}</p>
            {showConcept && concept && (
              <div className="concept-card">
                <strong>{concept.term}</strong>
                <span>{concept.blurb}</span>
              </div>
            )}
          </div>

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
            />
            <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>
              <option value={0.5}>0.5×</option>
              <option value={1}>1×</option>
              <option value={2}>2×</option>
              <option value={4}>4×</option>
            </select>
          </div>

          <div className="split">
            <div>
              <h3>Variables</h3>
              <VariableBoxes
                variables={state?.frames?.[frames.length - 1]?.variables}
                heap={state?.heap}
                changed={changed}
              />
              <HeapObjects heap={state?.heap} names={heapNames} changes={objectChanged} />
            </div>
            <div>
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
            </div>
          </div>

          <div className="flow-head">
            <h3>
              Execution graph
              {frames.length > 0 && (
                <span className="flow-of"> — {frames[frames.length - 1].function}()</span>
              )}
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
            <Flowchart
              flow={flow}
              functionName={frames[frames.length - 1]?.function ?? "<module>"}
              trace={trace}
              line={line}
            />
          ) : (
            <ExecutionGraph trace={trace} source={source} index={index} />
          )}

          <h3>Output</h3>
          <pre className="output">{output || <span className="empty">(nothing printed yet)</span>}</pre>

          {result?.error && (
            <div className="error">
              <strong>{result.error.type}</strong> on line {result.error.line ?? "?"}:{" "}
              {result.error.message}
            </div>
          )}

          <details className="glossary">
            <summary>Glossary</summary>
            {Object.entries(CONCEPTS).map(([id, entry]) => (
              <div key={id} className="glossary-item">
                <strong>{entry.term}</strong>
                <span>{entry.blurb}</span>
              </div>
            ))}
          </details>

          {showJson && <pre className="json">{JSON.stringify(result, null, 2)}</pre>}
        </section>
      </div>
    </div>
  );
}
