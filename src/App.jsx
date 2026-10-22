import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildFlowchart,
  buildFlowchartGraph,
  buildProgramProfile,
  onEngineStatus,
  runTrace,
} from "./tracer/client";
import { CONCEPTS, explainStep, isNewConcept } from "./tracer/explain";
import { namesById, objectChanges } from "./tracer/objects";
import { recognizeProgram } from "./tracer/recognition";
import { buildRunStory } from "./tracer/runStory.js";
import { changeLog, variableSeries } from "./tracer/stepView";
import { buildExecutionGraph } from "./flowchart/executionGraph.js";
import ControlFlowChart from "./flowchart/ControlFlowChart.jsx";
import AdaptiveView from "./visualizer/AdaptiveView.jsx";
import { AUTO_ADAPTER, adapterLabel, resolveAdaptiveView } from "./visualizer/adaptive.js";
import CombinedView from "./visualizer/CombinedView.jsx";
import Inspector from "./visualizer/Inspector.jsx";
import PlaybackBar from "./visualizer/PlaybackBar.jsx";
import RunStoryCard from "./visualizer/RunStoryCard.jsx";
import CallTree from "./visualizer/CallTree.jsx";
import TimelinePane from "./visualizer/TimelinePane.jsx";
import VisualizationPane from "./visualizer/VisualizationPane.jsx";
import {
  closeComparison,
  initialComparison,
  openComparison,
  setComparisonEndpoint,
  swapComparison,
} from "./visualizer/compare.js";
import { loadSpeed, playbackIntervalMs, saveSpeed } from "./visualizer/playback.js";
import {
  LEARNING_MODES,
  MODE_BLURBS,
  MODE_LABELS,
  DEFAULT_MODE,
  isLearningMode,
  loadMode,
  modeDetail,
  saveMode,
} from "./visualizer/learningMode.js";
import { createRunGate } from "./visualizer/runGate.js";
import { VIZ_LABELS, loadViz, saveViz } from "./visualizer/vizMode.js";
import { clampStep } from "./visualizer/workspace.js";
import { ExecutionSessionProvider } from "./visualizer/session/ExecutionSessionProvider.jsx";
import { useExecutionSession } from "./visualizer/session/useExecutionSession.js";
import { createInitialSession, sessionActions } from "./visualizer/session/session.js";
import {
  selectAdapter,
  selectOutput,
  selectProfile,
  selectRecognition,
  selectRunSource,
  selectSourceDirty,
  selectStepView,
  selectTrace,
  selectTraceIndex,
} from "./visualizer/session/selectors.js";
import { BrandLogo } from "./brand/BrandLogo.jsx";
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
const DEFAULT_COLUMNS = { left: 28, mid: 49 };
const MIN_LEFT = 18;
const MIN_MID = 26;
const MIN_RIGHT = 18;

// Below 1280px the canvas and the inspector take turns, chosen by this bar;
// from 1280px up all three columns are on screen together and it is hidden.
// "Code" is only reachable as a tab on phones, where the code column would
// otherwise have no room of its own.
const PANES = [
  { id: "code", label: "Code", phoneOnly: true },
  { id: "graph", label: "Visualize" },
  { id: "inspector", label: "Inspector" },
];

const clamp = (value, lo, hi) => Math.min(Math.max(value, lo), hi);

const STATUS_LABELS = {
  timeout: "Timeout",
  step_limit: "Step limit",
  output_limit: "Output limit",
  internal_error: "Internal error",
};

/** One honest execution state for the header, derived only from the run. */
function runStateOf({ running, engine, result, trace, sourceDirty }) {
  if (running) return { id: "running", label: "Running" };
  if (engine === "loading" && !result) return { id: "loading", label: "Loading Python" };
  if (engine === "failed") return { id: "error", label: "Engine failed" };
  if (sourceDirty) {
    return {
      id: "edited",
      label: "Source edited",
      title: "The source changed after this run. Run it again to update the canvas.",
    };
  }
  if (!result) return { id: "ready", label: "Ready" };
  if (result.error) {
    return {
      id: "error",
      label: result.error.type === "SyntaxError" ? "Syntax error" : "Runtime error",
    };
  }
  if (result.status && result.status !== "ok") {
    return {
      id: result.status,
      label: STATUS_LABELS[result.status] ?? result.status,
    };
  }
  if (trace.length === 0) return { id: "empty", label: "No steps" };
  return { id: "completed", label: "Completed" };
}

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
  return (
    <ExecutionSessionProvider
      initialState={createInitialSession({
        source: EXAMPLES[START_EXAMPLE].code,
        speed: loadSpeed(),
        viz: loadViz(),
      })}
    >
      <Workspace />
    </ExecutionSessionProvider>
  );
}

function Workspace() {
  const { state: session, dispatch } = useExecutionSession();
  const {
    source,
    result,
    flow,
    flowGraph,
    index,
    playing,
    speed,
    running,
    editing,
    viz,
    selectedFrameId: selectedCall,
  } = session;
  // The learning mode is workspace-wide: it decides how much technical
  // detail every surface uses, and it is remembered between visits.
  const [mode, setModeState] = useState(() => loadMode());
  const [showTraceDetails, setShowTraceDetails] = useState(false);
  const [engine, setEngine] = useState("idle");
  const [showJson, setShowJson] = useState(false);
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const [columns, setColumns] = useState(loadColumns);
  const [resizing, setResizing] = useState(false);
  const [watched, setWatched] = useState(null);
  // Comparison mode owns only its two endpoints and whether it is open. The
  // playback step stays in `index`, so opening or changing a comparison can
  // never move the run.
  const [comparison, setComparison] = useState(initialComparison);
  const [showAfter, setShowAfter] = useState(false);
  const [inputsText, setInputsText] = useState("");
  const [dismissed, setDismissed] = useState(() => new Set());
  // On a phone the Run button lives behind the Code tab, so start there.
  const [pane, setPane] = useState(() => (window.innerWidth < 900 ? "code" : "graph"));

  const timer = useRef(null);
  // The gate rejects a run whose source was edited or whose successor started
  // while it was still waiting on the worker. The ref mirrors `source` so an
  // edit made during a run is visible to the async handler immediately.
  const runGate = useRef(createRunGate());
  const sourceRef = useRef(source);
  // Mirrors `index` for the playback timer, which must not be rebuilt on
  // every step just to see where the program has reached.
  const indexRef = useRef(0);
  const paneRefs = useRef([]);
  const layoutRef = useRef(null);
  const splitDrag = useRef(null);
  const currentLine = useRef(null);
  const codeView = useRef(null);

  useEffect(() => onEngineStatus(setEngine), []);

  useEffect(() => saveColumns(columns), [columns]);

  // Both preferences are written through a handler, so a blocked or missing
  // localStorage never stops the control working for this session - it just
  // stops being remembered.
  const setMode = (next) => {
    const chosen = isLearningMode(next) ? next : DEFAULT_MODE;
    setModeState(chosen);
    saveMode(chosen);
    // Textbook opens on the control-flow reading of the run, because that is
    // the vocabulary it teaches. From there the learner picks any canvas they
    // like and is never dragged back: this fires only on entering the mode,
    // never while already in it.
    if (chosen === "textbook" && mode !== "textbook") setViz("flow");
  };
  const setSource = (next) => {
    sourceRef.current = next;
    dispatch(sessionActions.setSource(next));
  };
  const setEditing = (next) => dispatch(sessionActions.setEditing(next));
  const setSpeed = (next) => {
    dispatch(sessionActions.setSpeed(next));
    saveSpeed(next);
  };
  // Choosing a canvas touches the canvas and nothing else — never the step,
  // never the playing state, never the speed.
  const setViz = (next) => {
    dispatch(sessionActions.selectViz(next));
    saveViz(next);
  };
  // The adapter choice is presentation too: it changes which validated scene
  // is drawn, never the cursor, playback or selected call.
  const setAdapter = (next) => dispatch(sessionActions.selectAdapter(next));

  const trace = selectTrace(session);
  const traceIndex = selectTraceIndex(session);
  const shownSource = selectRunSource(session);
  const graph = useMemo(() => buildExecutionGraph(trace, shownSource), [trace, shownSource]);
  const view = useMemo(
    () => selectStepView(session, { steps: graph.steps }),
    [session, graph],
  );
  const detail = useMemo(() => modeDetail(mode), [mode]);
  const log = useMemo(() => changeLog(trace), [trace]);
  // A program that reads the keyboard needs values to read. They are supplied
  // by hand, one per line, and passed to the tracer unchanged — if the program
  // asks for more than were given, the trace says so with a real EOFError.
  const usesInput = useMemo(() => /\binput\s*\(/.test(source), [source]);
  const inputs = useMemo(() => {
    const lines = inputsText.split("\n");
    while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    return lines;
  }, [inputsText]);
  const history = useMemo(
    () => (watched ? variableSeries(trace, watched) : []),
    [trace, watched],
  );

  const concept = view.explanation.concept ? CONCEPTS[view.explanation.concept] : null;
  const showConcept = useMemo(
    () => isNewConcept(trace, index, shownSource, view.explanation.concept),
    [trace, index, shownSource, view.explanation.concept],
  );

  const heapNames = useMemo(() => namesById(view.frames, view.heap), [view]);
  const objectChanged = useMemo(
    () => objectChanges(view.before?.heap, view.after?.heap),
    [view],
  );

  const output = useMemo(() => selectOutput(session), [session]);
  const outputText = output.pastText;
  const storedProfile = selectProfile(session);
  const storedRecognition = selectRecognition(session);
  const selectedAdapter = selectAdapter(session);
  const sourceDirty = selectSourceDirty(session);
  const adaptiveContext = useMemo(
    () => ({
      stepView: view,
      trace,
      traceIndex,
      source: shownSource,
      profile: storedProfile,
      recognition: storedRecognition,
      result,
    }),
    [view, trace, traceIndex, shownSource, storedProfile, storedRecognition, result],
  );
  // One build feeds both the header label and the canvas, so a Generic
  // fallback can never be announced as Sorting in the header.
  const adaptive = useMemo(
    () =>
      viz === "scene" && result
        ? resolveAdaptiveView(adaptiveContext, selectedAdapter)
        : null,
    [viz, result, adaptiveContext, selectedAdapter],
  );
  // The map of the whole run: derived from the trace only, so it cannot
  // describe a step the recorder did not take.
  const runStory = useMemo(
    () => (result && trace.length > 0 ? buildRunStory(trace, shownSource) : null),
    [result, trace, shownSource],
  );

  const example = EXAMPLES.find((entry) => entry.code === source) ?? null;
  const fileName = example ? `${example.name}.py` : "untitled.py";

  // The raw coordinates of this step, offered only through the Developer menu.
  // They come from the same view every panel reads, so they can never describe
  // a different moment than the one on screen.
  const traceFacts = useMemo(
    () => [
      { label: "event", value: view.kind ?? "—" },
      { label: "step", value: `${index + 1} of ${trace.length}` },
      { label: "line", value: view.line ?? "—" },
      { label: "function", value: view.function },
      { label: "frame id", value: view.frameId ?? "—" },
      // Depth is 0 for the module frame, so it is one less than the frame
      // count. The graph already reports it this way; reporting the count
      // here as "depth" put two different numbers behind one label.
      { label: "depth", value: String(Math.max(view.frames.length - 1, 0)) },
      { label: "graph node", value: view.nodeId ?? "—" },
      { label: "heap objects", value: String(Object.keys(view.before?.heap ?? {}).length) },
      { label: "printed so far", value: `${outputText.length} characters` },
    ],
    [view, index, trace.length, outputText],
  );

  const line = view.line;
  // One code panel: editable until a run, then read-only with the line lit up.
  const stepping = !editing && result !== null;
  // The line the program broke on, so the code pane can point at it.
  const errorLine = result?.error?.line ?? null;
  // The current step's call title always names the frame that is actually
  // running. Selecting an older call changes whose variables are shown, not
  // which call the explanation or canvas header is describing.
  const activeFrame = view.callStack.find((entry) => entry.frameId === view.frameId) ?? view.frame;
  const callTitle =
    activeFrame && activeFrame.function !== MODULE
      ? `${activeFrame.function} call #${activeFrame.callNumber}${
          activeFrame.args.length > 0
            ? `, ${activeFrame.args.map((arg) => `${arg.name} = ${arg.text}`).join(", ")}`
            : ""
        }`
      : "the top level";

  // Sections A and C read the same step view every other panel reads, so they
  // cannot drift: one event in, one description out.
  const currentNode = graph.nodes.find((node) => node.id === view.nodeId) ?? null;
  const previousEvent = index > 0 ? trace[index - 1] : null;
  const nextEvent = trace[index + 1] ?? null;
  const nextReason = nextEvent ? explainStep(trace, index + 1, shownSource).text : null;
  const olderCalls = Math.max(view.callStack.length - 1, 0);
  const runState = runStateOf({ running, engine, result, trace, sourceDirty });
  const canvasLabel = VIZ_LABELS[viz] ?? viz;
  const effectiveAdapter = adaptive?.built?.adapterId ?? "generic";
  const recognizedAdapter =
    adaptive?.options?.recognitionId ?? storedRecognition?.adapterId ?? "generic";
  const fallbackReason = adaptive?.built?.fallbackReason ?? null;
  const viewIndicator =
    result && viz === "scene"
      ? `${canvasLabel} · ${
          selectedAdapter === AUTO_ADAPTER ? "Auto" : "Manual"
        } → ${adapterLabel(effectiveAdapter)}`
      : `${canvasLabel}${viz === "scene" ? " · Auto" : ""}`;
  const viewTitle =
    viz === "scene" && result
      ? fallbackReason
        ? `Showing ${adapterLabel(effectiveAdapter)} because ${adapterLabel(
            recognizedAdapter,
          )} could not be used at this step: ${fallbackReason}`
        : `Showing ${adapterLabel(effectiveAdapter)} at this step`
      : "The canvas currently in use";

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
    dispatch(sessionActions.setPlaying(false));
    dispatch(sessionActions.setStep(clampStep(i, trace.length)));
  };

  // Comparison handlers touch only the comparison state. None of them calls
  // `jumpTo`, so choosing endpoints leaves the playback position alone.
  const startComparison = () => setComparison((state) => openComparison(state, index, trace.length));
  const stopComparison = () => setComparison((state) => closeComparison(state));
  const changeEndpoint = (which, value) =>
    setComparison((state) => setComparisonEndpoint(state, which, value, trace.length));
  const swapEndpoints = () => setComparison((state) => swapComparison(state));
  const useCurrentAsEndpoint = (which) => changeEndpoint(which, index);

  // Selecting a call only chooses whose variables to show. It never moves the
  // step: the stack panel is a lens on the current moment, not a time machine.
  const selectFrame = (frameId) => dispatch(sessionActions.selectFrame(frameId));

  // A call-tree box explicitly offers "go to where this call started", so this
  // one both selects the call and jumps. The two intents stay separate. Scene
  // items can pass the recorded start index directly.
  const jumpToCall = (frameId, firstIndex) => {
    dispatch(sessionActions.selectFrame(frameId));
    const at = Number.isInteger(firstIndex) ? firstIndex : traceIndex.firstCallIndex(frameId);
    if (at >= 0) jumpTo(at);
  };

  // Clicking a line of code jumps to the next step (at or after here) that runs it.
  const jumpToLine = (number) => {
    let at = traceIndex.firstLineIndex(number, index);
    if (at < 0) at = traceIndex.firstLineIndex(number);
    if (at >= 0) jumpTo(at);
  };

  async function handleRun() {
    const gate = runGate.current;
    const runSource = sourceRef.current;
    const run = gate.begin(runSource);
    dispatch(sessionActions.startRun());

    const cancelStale = () => dispatch(sessionActions.cancelRun());

    try {
      const [r, f, fg, p] = await Promise.all([
        runTrace(runSource, { inputs }),
        buildFlowchart(runSource),
        buildFlowchartGraph(runSource),
        // A profile failure must not discard a perfectly good trace: the
        // recognition step falls back to generic with an explicit reason.
        buildProgramProfile(runSource).catch(() => null),
      ]);
      if (!gate.isLatest(run)) return;
      if (!gate.isCurrent(run, sourceRef.current)) {
        cancelStale();
        return;
      }
      const recognized = recognizeProgram({ profile: p, trace: r?.trace, result: r });
      // A run that crashed opens on the step that failed, so the line that
      // broke is already lit up when the error message appears.
      dispatch(
        sessionActions.finishRun({
          result: r,
          flow: f,
          flowGraph: fg,
          profile: p,
          recognition: recognized,
        }),
      );
      setWatched(null);
      setComparison(initialComparison());
      setDismissed(new Set());
    } catch (error) {
      if (!gate.isLatest(run)) return;
      if (!gate.isCurrent(run, sourceRef.current)) {
        cancelStale();
        return;
      }
      dispatch(
        sessionActions.failRun({
          status: "engine_error",
          trace: [],
          output: "",
          error: { type: "EngineError", message: error?.message ?? String(error) },
        }),
      );
    }
  }

  // Keep the timer's view of the current step in step with React's.
  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  useEffect(() => {
    if (!playing || trace.length === 0) {
      clearInterval(timer.current);
      return undefined;
    }
    timer.current = setInterval(() => {
      // React state updaters may run twice, so nothing with a side effect
      // belongs inside one. The tick works it out for itself instead: advance
      // the step, or stop the player, both as ordinary calls made by the timer
      // that caused them. Reading the step through a ref also means the timer
      // keeps one steady cadence rather than being rebuilt on every step.
      const current = indexRef.current;
      if (current >= trace.length - 1) {
        dispatch(sessionActions.setPlaying(false));
        return;
      }
      dispatch(sessionActions.setStep(current + 1));
    }, playbackIntervalMs(speed));
    return () => clearInterval(timer.current);
  }, [playing, speed, trace.length, dispatch]);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === "Escape") {
        setGlossaryOpen(false);
        return;
      }
      const tag = event.target?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT") return;
      // Space on a focused button already performs that button's action. If the
      // workspace also toggled playback, one key press would do two things.
      if (event.key === " " && event.target?.closest?.("button, a[href], summary, [role='button']")) return;
      // A tab strip owns its arrow keys. Stealing them here would move the
      // program at the same moment as the tab, which is precisely the thing
      // this workspace must never do.
      if (event.target?.closest?.('[role="tablist"]')) return;
      if (event.key === "ArrowRight") {
        dispatch(sessionActions.stepBy(1));
      } else if (event.key === "ArrowLeft") {
        dispatch(sessionActions.stepBy(-1));
      } else if (event.key === " ") {
        event.preventDefault();
        dispatch(sessionActions.togglePlaying());
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [trace.length, dispatch]);

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

  // Everything the inspector reads, in one place. It is rebuilt every render
  // on purpose: the panels must never be handed a snapshot of an older step.
  const inspectorCtx = {
    result,
    view,
    trace,
    index,
    source,
    line,
    callTitle,
    currentNode,
    previousEvent,
    nextEvent,
    nextReason,
    jumpTo,
    concept,
    showConcept,
    dismissed,
    dismissConcept: (name) => setDismissed((set) => new Set(set).add(name)),
    detail,
    showAfter,
    setShowAfter,
    changeByName,
    watched,
    setWatched,
    history,
    olderCalls,
    selectedCall,
    selectFrame,
    clearSelectedCall: () => dispatch(sessionActions.clearFrame()),
    heap: view.heap,
    heapNames,
    objectChanged,
    output,
    log,
  };

  // Arrow keys belong to whichever tab strip the pointer is in: on a tab they
  // move the tab, and anywhere else they still step the program, as before.
  const onPaneKeyDown = (event) => {
    const from = PANES.findIndex((entry) => entry.id === event.target?.dataset?.paneid);
    if (from < 0) return;
    let to = -1;
    if (event.key === "ArrowRight") to = (from + 1) % PANES.length;
    else if (event.key === "ArrowLeft") to = (from - 1 + PANES.length) % PANES.length;
    else if (event.key === "Home") to = 0;
    else if (event.key === "End") to = PANES.length - 1;
    else return;
    event.preventDefault();
    setPane(PANES[to].id);
    paneRefs.current[to]?.focus();
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-line">
            <h1>
              <BrandLogo className="app-brand-logo" />
            </h1>
            <span className="brand-badge">Python</span>
          </div>
          <span className="file-name" title={fileName}>
            {fileName}
          </span>
        </div>
        <span className={`engine engine-${engine}`}>
          Runtime · {engine === "ready" ? "ready" : engine}
        </span>
        <span
          className={`run-status status-${runState.id}`}
          title={runState.title ?? undefined}
        >
          {runState.label}
        </span>
        <span className="view-indicator" title={viewTitle}>
          {viewIndicator}
        </span>
        <div className="top-actions">
          <button type="button" className="run" onClick={handleRun} disabled={running}>
            {running ? "Starting…" : "▶ Run"}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={handleRun}
            disabled={running || !result}
            title="Run the current source again from the first step"
          >
            ↻ Restart
          </button>
        </div>
        {/* The learning mode belongs to the whole workspace, not to one pane,
            so it lives in the bar that is on screen whichever pane you are in. */}
        <div className="state-toggle mode-switch" role="group" aria-label="Learning mode">
          {LEARNING_MODES.map((id) => (
            <button
              key={id}
              type="button"
              className={mode === id ? "on" : ""}
              aria-pressed={mode === id}
              title={MODE_BLURBS[id]}
              onClick={() => setMode(id)}
            >
              {MODE_LABELS[id]}
            </button>
          ))}
        </div>
        <span className="step-count">
          {trace.length > 0
            ? `${sourceDirty ? "Previous run · " : ""}Step ${index + 1} of ${trace.length}`
            : "Not run yet"}
        </span>
      </header>

      <main
        className={`layout${resizing ? " resizing" : ""}`}
        ref={layoutRef}
        data-tab={pane}
        style={{ "--col-left": `${columns.left}%`, "--col-mid": `${columns.mid}%` }}
      >
        <section className="pane code-pane panel" data-pane="code" id="pane-code">
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

          {usesInput ? (
            <label className="inputs">
              <span>Values for input(), one per line</span>
              <textarea
                value={inputsText}
                onChange={(event) => setInputsText(event.target.value)}
                rows={2}
                aria-label="Values for input(), one per line"
                spellCheck="false"
              />
            </label>
          ) : null}

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

        {/* On narrow windows the canvas and the inspector take turns, so the
            code column keeps its own tab. From 1280px up this bar is hidden
            and both are on screen together. It follows the same pattern as the
            inspector strip: one tab stop, arrows to move, Home and End to jump. */}
        <div className="tabs" role="tablist" aria-label="Workspace" onKeyDown={onPaneKeyDown}>
          {PANES.map(({ id, label, phoneOnly }, i) => {
            const active = pane === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                id={`pane-tab-${id}`}
                data-paneid={id}
                aria-selected={active}
                aria-controls={`pane-${id}`}
                tabIndex={active ? 0 : -1}
                ref={(node) => {
                  paneRefs.current[i] = node;
                }}
                className={`tab${active ? " on" : ""}${phoneOnly ? " tab-code" : ""}`}
                onClick={() => setPane(id)}
              >
                {label}
              </button>
            );
          })}
        </div>

        <section className="pane graph-pane" data-pane="graph" id="pane-graph">
          <VisualizationPane
            viz={viz}
            onVizChange={setViz}
            heading={<h3>Visualize</h3>}
          >
            <RunStoryCard story={runStory} index={index} onJump={jumpTo} />
            {viz === "scene" ? (
              <AdaptiveView
                adaptive={adaptive}
                trace={trace}
                result={result}
                adapter={selectedAdapter}
                onAdapterChange={setAdapter}
                onJumpLine={jumpToLine}
                onJumpCall={jumpToCall}
                onSelectFrame={selectFrame}
              />
            ) : viz === "flow" ? (
              <ControlFlowChart
                flow={flowGraph}
                flowTree={flow}
                trace={trace}
                source={source}
                index={index}
                onJump={jumpTo}
                note={
                  flowGraph?.error
                    ? "There is nothing to draw: the code has a syntax error, so it never ran."
                    : null
                }
              />
            ) : viz === "combined" ? (
              <CombinedView
                trace={trace}
                source={source}
                index={index}
                currentFrameId={view.frameId ?? null}
                onJumpCall={jumpToCall}
                onShowFlow={() => setViz("flow")}
                ctx={inspectorCtx}
                note={
                  flow?.error
                    ? "There is nothing to draw: the code has a syntax error, so it never ran."
                    : null
                }
              />
            ) : viz === "timeline" ? (
              <TimelinePane
                trace={trace}
                source={source}
                index={index}
                onJump={jumpTo}
                compareState={comparison}
                onOpenCompare={startComparison}
                onCloseCompare={stopComparison}
                onChangeEndpoint={changeEndpoint}
                onSwapEndpoints={swapEndpoints}
                onUseCurrent={useCurrentAsEndpoint}
              />
            ) : (
              <CallTree
                trace={trace}
                source={source}
                index={index}
                currentFrameId={view.frameId ?? null}
                onJumpCall={jumpToCall}
                onShowFlow={() => setViz("flow")}
                note={
                  flow?.error
                    ? "There is nothing to draw: the code has a syntax error, so it never ran."
                    : null
                }
              />
            )}
          </VisualizationPane>
        </section>

        <Splitter
          name="mid"
          onGrab={grabSplitter("mid")}
          onMove={moveSplitter}
          onRelease={releaseSplitter}
        />

        <section className="pane side-pane" data-pane="side" id="pane-inspector">
          <Inspector ctx={inspectorCtx} />
        </section>
      </main>

      <PlaybackBar
        trace={trace}
        index={index}
        playing={playing}
        speed={speed}
        onJump={jumpTo}
        onTogglePlay={() => dispatch(sessionActions.togglePlaying())}
        onSpeedChange={setSpeed}
        onOpenGlossary={() => setGlossaryOpen(true)}
        showJson={showJson}
        onShowJsonChange={setShowJson}
        result={result}
        traceFacts={traceFacts}
        showTraceDetails={showTraceDetails}
        onShowTraceDetailsChange={setShowTraceDetails}
      />

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
