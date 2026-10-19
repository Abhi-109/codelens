import { useMemo, useState } from "react";
import { MODULE } from "./executionGraph.js";
import {
  chartOrder,
  executedNodes,
  jumpToNode,
  mapSteps,
  outgoingEdge,
  raisingNodeId,
  traversedEdges,
} from "./controlFlow.js";
import { layoutChart } from "./layout.js";
import { MAIN, chartList } from "./mapTrace.js";
import { Edge, NodeShape } from "./shapes.jsx";
import Canvas from "../visualizer/Canvas.jsx";
import SimpleFlow from "../visualizer/SimpleFlow.jsx";

const EMPTY_SET = new Set();

/**
 * The control flow graph: what the *code* decides, with the path this run
 * actually took lit up.
 *
 * The shapes and arrows come from the AST — they describe the program, not the
 * execution, and the diagram says so when the program has not run. Everything
 * about *execution* is read from the trace through `mapSteps`: which box the
 * token is on, which arrows it has travelled, and which branch a Yes/No really
 * took. A box the run never reached is drawn subdued and cannot be clicked,
 * because there is no step to jump to — and an exception draws no arrow the
 * trace never recorded, only the line it broke on.
 *
 * @param {Object} props
 * @param {Object|null} props.flow the flowchart graph (format version 2)
 * @param {Object|null} props.flowTree the older tree summary, for the simple view
 * @param {Array} props.trace the trace from docs/trace-format.md
 * @param {number} props.index which trace step is current
 * @param {(index: number) => void} props.onJump called when a box is clicked
 * @param {string} [props.note] what to say when the code never ran
 */
export default function ControlFlowChart({ flow, flowTree, trace, index, onJump, note }) {
  const [followRun, setFollowRun] = useState(true);
  const [pinned, setPinned] = useState(null);
  const [showCode, setShowCode] = useState(false);
  const [simpleView, setSimpleView] = useState(false);

  const steps = useMemo(() => mapSteps(flow, trace), [flow, trace]);
  const ran = steps.length > 0;
  const keys = useMemo(() => chartList(flow), [flow]);
  const ranKeys = useMemo(() => chartOrder(steps), [steps]);

  // The chart to draw: the one the token is in while following the run, the
  // one the learner pinned otherwise, and the module chart when neither knows.
  const runningKey = followRun ? lastChartKey(steps, index) : null;
  const activeKey = runningKey ?? pinned ?? (ranKeys[0] ?? MAIN);
  const chart = flow?.functions?.[activeKey] ?? null;

  const laid = useMemo(() => layoutChart(chart, { showCode }), [chart, showCode]);

  const reached = useMemo(() => (ran ? executedNodes(steps, activeKey) : EMPTY_SET), [steps, activeKey, ran]);
  const walked = useMemo(
    () => (ran ? traversedEdges(steps, activeKey) : EMPTY_SET),
    [steps, activeKey, ran],
  );

  const here = steps[index] ?? null;
  const onThisChart = here?.chartKey === activeKey;
  const currentNodeId = onThisChart ? here?.nodeId ?? null : null;
  const raisingId = onThisChart ? raisingNodeId(steps, index) : null;
  const out = onThisChart ? outgoingEdge(chart, steps, index) : null;
  const outKey = out ? `${out.edge.from}>${out.edge.to}` : null;

  const currentBox = useMemo(() => {
    const box = laid.nodes.find((node) => node.id === currentNodeId);
    return box ? { cx: box.x, cy: box.y } : null;
  }, [laid, currentNodeId]);

  if (flow?.error) {
    return (
      <div className="cfg-pane">
        <p className="empty">
          The code has a syntax error on line {flow.error.line ?? "?"}, so there is no diagram yet.
        </p>
      </div>
    );
  }

  if (!chart || laid.nodes.length === 0) {
    return (
      <div className="cfg-pane">
        <p className="viz-hint">
          {note ?? "The code has no statements to draw yet."}
        </p>
      </div>
    );
  }

  if (simpleView) {
    return (
      <div className="cfg-pane">
        <FunctionStrip
          keys={keys}
          active={activeKey}
          ranKeys={ranKeys}
          followRun={followRun}
          onFollow={setFollowRun}
          onPick={(key) => {
            setPinned(key);
            setFollowRun(false);
          }}
        />
        <SimpleFlow
          flow={flowTree}
          functionName={activeKey === MAIN ? MODULE : activeKey}
          trace={trace}
          line={here?.line ?? null}
        />
        <div className="viz-tools">
          <Toggle
            checked
            onChange={setSimpleView}
            label="Simple view"
            title="The block outline instead of the flowchart shapes"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="cfg-pane">
      <FunctionStrip
        keys={keys}
        active={activeKey}
        ranKeys={ranKeys}
        followRun={followRun}
        onFollow={setFollowRun}
        onPick={(key) => {
          setPinned(key);
          setFollowRun(false);
        }}
      />

      <Canvas
        bounds={{ width: laid.width, height: laid.height }}
        subject={currentBox}
        hasContent={laid.nodes.length > 0}
        layoutKey={laid}
        label={describe(activeKey, here, ran)}
        empty={<p className="viz-hint">Run your code to see the path it took through the shapes.</p>}
        note={note}
        caption={caption(ran, here, activeKey, out, chart, steps)}
        tools={
          <>
            <Toggle checked={showCode} onChange={setShowCode} label="Show code" />
            <Toggle
              checked={simpleView}
              onChange={setSimpleView}
              label="Simple view"
              title="The block outline instead of the flowchart shapes"
            />
          </>
        }
        legend={<Legend />}
      >
        {() => (
          <>
            {laid.edges.map((edge) => {
              const key = `${edge.from}>${edge.to}`;
              const state = key === outKey ? "current" : walked.has(key) ? "taken" : "";
              return <Edge key={edge.key} edge={edge} state={state} />;
            })}

            {laid.nodes.map((node) => {
              const reachedHere = reached.has(node.id);
              const isCurrent = node.id === currentNodeId;
              const isRaising = node.id === raisingId;
              const state = isRaising
                ? "raising"
                : isCurrent
                  ? "running"
                  : ran && !reachedHere
                    ? "unreached"
                    : ran
                      ? "executed"
                      : "";
              return (
                <NodeShape
                  key={node.id}
                  node={node}
                  state={state}
                  readout={readoutFor(node, { ran, reachedHere, isCurrent, isRaising })}
                  reachable={ran && reachedHere}
                  onActivate={
                    ran && reachedHere
                      ? () => {
                          const at = jumpToNode(steps, activeKey, node.id);
                          if (at != null) onJump?.(at);
                        }
                      : undefined
                  }
                />
              );
            })}
          </>
        )}
      </Canvas>
    </div>
  );
}

/** The chart the token was last in at or before `index`, or null if none. */
function lastChartKey(steps, index) {
  for (let i = Math.min(index, steps.length - 1); i >= 0; i -= 1) {
    if (steps[i]?.chartKey) return steps[i].chartKey;
  }
  return null;
}

function Toggle({ checked, onChange, label, title }) {
  return (
    <label className="viz-toggle" title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** Which chart to draw, with the ones the run entered marked. */
function FunctionStrip({ keys, active, ranKeys, followRun, onFollow, onPick }) {
  if (keys.length <= 1) return null;
  const ran = new Set(ranKeys);
  return (
    <div className="cfg-fns">
      <div className="cfg-fn-tabs" role="tablist" aria-label="Function">
        {keys.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={key === active}
            className={`cfg-fn${key === active ? " on" : ""}${ran.has(key) ? " cfg-fn-ran" : ""}`}
            title={ran.has(key) ? `${key} — this run went through it` : `${key} — not called by this run`}
            onClick={() => onPick(key)}
          >
            {key === MAIN ? "the program" : key}
          </button>
        ))}
      </div>
      <label className="viz-toggle" title="Keep showing the chart the program is in right now">
        <input type="checkbox" checked={followRun} onChange={(e) => onFollow(e.target.checked)} />
        Follow run
      </label>
    </div>
  );
}

/** What one box says about itself, in one sentence. */
function readoutFor(node, { ran, reachedHere, isCurrent, isRaising }) {
  const where = isRaising
    ? "the exception was raised here"
    : isCurrent
      ? "the program is here now"
      : !ran
        ? "the program has not run yet"
        : reachedHere
          ? "this run went through it"
          : "this run never reached it";
  const act = ran && reachedHere ? " Jump to the step it ran on." : "";
  return `${node.label}. ${where}.${act}`;
}

/** The whole drawing's accessible name: which chart, and where the run is. */
function describe(chartKey, here, ran) {
  const name = chartName(chartKey);
  if (!ran) return `Control flow of ${name}. The program has not run yet.`;
  if (!here) return `Control flow of ${name}. Step recorded.`;
  // Line 0 is the tracer's own marker for "the module is being entered", not a
  // line of the learner's code — printing it would only look like a mistake.
  const line = Number.isFinite(here.line) && here.line > 0 ? ` Line ${here.line}.` : "";
  return `Control flow of ${name}. Step ${here.index + 1}.${line}`;
}

/**
 * One line under the drawing, saying only what the trace supports.
 *
 * "This run stops here" was doing too much work before: it also covered the
 * moment the token *left* the chart — stepped into another function, returned,
 * or unwound — which reads as "the program finished" when it plainly had not.
 * The wording now follows the next real event, or says nothing it cannot back.
 */
function caption(ran, here, chartKey, out, chart, steps) {
  if (!ran) {
    return (
      <span className="viz-caption-note">
        Not run yet — the shapes come from your code. Nothing is highlighted until you run it.
      </span>
    );
  }
  if (!here) {
    return <span className="viz-caption-note">This step has nothing to point at.</span>;
  }
  if (here.chartKey == null) {
    return (
      <span className="viz-caption-note">
        Step {here.index + 1} is {article(here.event)} {here.event} event, so it does not land on a
        box.
      </span>
    );
  }
  if (here.chartKey !== chartKey) {
    return (
      <span className="viz-caption-note">
        The program is in a different function right now — turn on <em>Follow run</em> to go there.
      </span>
    );
  }
  const target = out ? (chart?.nodes ?? []).find((n) => n.id === out.edge.to) : null;
  if (out && target) {
    return (
      <span className="viz-caption-note">
        Next: {out.edge.label ? <strong>{out.edge.label}</strong> : "on"} → {target.label}
      </span>
    );
  }
  const next = steps?.[here.index + 1];
  if (!next) return <span className="viz-caption-note">This run ends here.</span>;
  if (next.chartKey == null) {
    return (
      <span className="viz-caption-note">
        Next: {article(next.event)} {next.event} event — the token is leaving this box.
      </span>
    );
  }
  if (next.chartKey !== chartKey) {
    return (
      <span className="viz-caption-note">
        Next: the token leaves this chart and goes into {chartName(next.chartKey)}.
      </span>
    );
  }
  if (next.event === "call") {
    return <span className="viz-caption-note">Next: the program makes a call.</span>;
  }
  if (next.event === "return") {
    return <span className="viz-caption-note">Next: the function returns.</span>;
  }
  if (next.nodeId === here.nodeId) {
    return (
      <span className="viz-caption-note">
        Next: {article(next.event)} {next.event} event on this same box.
      </span>
    );
  }
  return <span className="viz-caption-note">This run stops here.</span>;
}

const chartName = (key) => (key === MAIN ? "the program" : key);

const article = (word) => (String(word ?? "").match(/^[aeiou]/) ? "an" : "a");

function Legend() {
  return (
    <>
      <p className="viz-howto">
        <strong>The shape says what a box does.</strong> Ovals start and end, rectangles are steps,
        diamonds ask a question, the double-sided box is a call, and the leaning box reads or shows
        something.
      </p>
      <dl className="viz-legend">
        <dt className="cfg-legend cfg-running">running</dt>
        <dd>where the program is right now</dd>
        <dt className="cfg-legend cfg-executed">went through</dt>
        <dd>a box this run actually reached</dd>
        <dt className="cfg-legend cfg-unreached">never reached</dt>
        <dd>this run did not get here, so there is nothing to click</dd>
        <dt className="cfg-legend cfg-raising">exception</dt>
        <dd>the line the exception was raised on</dd>
      </dl>
    </>
  );
}
