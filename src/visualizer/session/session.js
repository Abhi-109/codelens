// The execution session: one run, one cursor, one selected call.
//
// Everything that describes *where the program is* lives here. Panels read it
// through selectors; they never keep a second index or a second step view. The
// presentation choices that must not move the run (the canvas and the inspector
// tab) are either carried through untouched by their own reducers or held in the
// components that own them.

import { errorStep } from "../../tracer/stepView.js";
import { AUTO_ADAPTER, isAdapterChoice } from "../adaptive.js";
import { DEFAULT_SPEED, isSpeed } from "../playback.js";
import { DEFAULT_VIZ, isVizMode } from "../vizMode.js";
import { clampStep, stepBy } from "../workspace.js";

export const SESSION_ACTION = {
  sourceSet: "source/set",
  editingSet: "editing/set",
  runStarted: "run/started",
  runSucceeded: "run/succeeded",
  runFailed: "run/failed",
  runCancelled: "run/cancelled",
  stepSet: "step/set",
  stepBy: "step/by",
  playbackSet: "playback/set",
  playbackToggle: "playback/toggle",
  speedSet: "speed/set",
  frameSelect: "frame/select",
  frameClear: "frame/clear",
  vizSelect: "viz/select",
  adapterSelect: "adapter/select",
};

const traceOf = (state) => (Array.isArray(state?.result?.trace) ? state.result.trace : []);

function stepAt(state, index) {
  const next = clampStep(index, traceOf(state).length);
  return next === state.index ? state : { ...state, index: next };
}

/** A fresh session, before any code has run. */
export function createInitialSession({ source = "", speed = DEFAULT_SPEED, viz = DEFAULT_VIZ } = {}) {
  return {
    source,
    result: null,
    flow: null,
    flowGraph: null,
    profile: null,
    recognition: null,
    runSource: null,
    running: false,
    editing: true,
    index: 0,
    playing: false,
    speed: isSpeed(speed) ? Number(speed) : DEFAULT_SPEED,
    selectedFrameId: null,
    viz: isVizMode(viz) ? viz : DEFAULT_VIZ,
    adapter: AUTO_ADAPTER,
  };
}

export function sessionReducer(state, action) {
  switch (action.type) {
    case SESSION_ACTION.sourceSet:
      return state.source === action.source ? state : { ...state, source: action.source ?? "" };
    case SESSION_ACTION.editingSet:
      return state.editing === Boolean(action.editing)
        ? state
        : { ...state, editing: Boolean(action.editing) };
    case SESSION_ACTION.runStarted:
      // The old trace stays on screen while the new one is prepared, but the
      // player and the call selection belong to the previous run and must stop.
      return { ...state, running: true, playing: false, selectedFrameId: null };
    case SESSION_ACTION.runSucceeded: {
      const result = action.result ?? null;
      const trace = Array.isArray(result?.trace) ? result.trace : [];
      // The tracer records a crashed run as status "error" with error_type;
      // an engine failure carries an `error` object instead.
      const failed = Boolean(result?.error) || result?.status === "error";
      const wanted = action.index ?? (failed ? errorStep(trace) : 0);
      return {
        ...state,
        result,
        flow: action.flow ?? null,
        flowGraph: action.flowGraph ?? null,
        profile: action.profile ?? null,
        recognition: action.recognition ?? null,
        runSource: state.source,
        running: false,
        editing: false,
        index: clampStep(wanted, trace.length),
        playing: false,
        selectedFrameId: null,
      };
    }
    case SESSION_ACTION.runFailed:
      return {
        ...state,
        result: action.result ?? {
          status: "engine_error",
          trace: [],
          output: "",
          error: { type: "EngineError", message: "The run could not start." },
        },
        flow: null,
        flowGraph: null,
        profile: null,
        recognition: null,
        runSource: state.source,
        running: false,
        // A failed engine must leave the editor usable for the next attempt.
        editing: true,
        index: 0,
        playing: false,
        selectedFrameId: null,
      };
    case SESSION_ACTION.runCancelled:
      // The source moved on while this run was in flight. Leave the previous
      // result on screen and let the Edited status explain why it is old.
      return state.running ? { ...state, running: false } : state;
    case SESSION_ACTION.stepSet:
      return stepAt(state, action.index);
    case SESSION_ACTION.stepBy:
      return stepAt(state, stepBy(state.index, traceOf(state).length, action.delta));
    case SESSION_ACTION.playbackSet:
      return state.playing === Boolean(action.playing)
        ? state
        : { ...state, playing: Boolean(action.playing) };
    case SESSION_ACTION.playbackToggle:
      return { ...state, playing: !state.playing };
    case SESSION_ACTION.speedSet:
      return isSpeed(action.speed)
        ? { ...state, speed: Number(action.speed) }
        : state;
    case SESSION_ACTION.frameSelect: {
      const frameId = action.frameId ?? null;
      return state.selectedFrameId === frameId
        ? state
        : { ...state, selectedFrameId: frameId };
    }
    case SESSION_ACTION.frameClear:
      return state.selectedFrameId === null ? state : { ...state, selectedFrameId: null };
    case SESSION_ACTION.vizSelect:
      return isVizMode(action.viz) && state.viz !== action.viz
        ? { ...state, viz: action.viz }
        : state;
    case SESSION_ACTION.adapterSelect:
      return isAdapterChoice(action.adapter) && state.adapter !== action.adapter
        ? { ...state, adapter: action.adapter }
        : state;
    default:
      return state;
  }
}

export const sessionActions = {
  setSource: (source) => ({ type: SESSION_ACTION.sourceSet, source }),
  setEditing: (editing) => ({ type: SESSION_ACTION.editingSet, editing }),
  startRun: () => ({ type: SESSION_ACTION.runStarted }),
  finishRun: ({
    result,
    flow = null,
    flowGraph = null,
    profile = null,
    recognition = null,
    index,
  } = {}) => ({
    type: SESSION_ACTION.runSucceeded,
    result,
    flow,
    flowGraph,
    profile,
    recognition,
    index,
  }),
  failRun: (result) => ({ type: SESSION_ACTION.runFailed, result }),
  cancelRun: () => ({ type: SESSION_ACTION.runCancelled }),
  setStep: (index) => ({ type: SESSION_ACTION.stepSet, index }),
  stepBy: (delta) => ({ type: SESSION_ACTION.stepBy, delta }),
  setPlaying: (playing) => ({ type: SESSION_ACTION.playbackSet, playing }),
  togglePlaying: () => ({ type: SESSION_ACTION.playbackToggle }),
  setSpeed: (speed) => ({ type: SESSION_ACTION.speedSet, speed }),
  selectFrame: (frameId) => ({ type: SESSION_ACTION.frameSelect, frameId }),
  clearFrame: () => ({ type: SESSION_ACTION.frameClear }),
  selectViz: (viz) => ({ type: SESSION_ACTION.vizSelect, viz }),
  selectAdapter: (adapter) => ({ type: SESSION_ACTION.adapterSelect, adapter }),
};
