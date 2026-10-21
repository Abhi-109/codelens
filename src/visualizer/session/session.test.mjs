import assert from "node:assert/strict";
import { test } from "node:test";

import { createInitialSession, sessionActions, sessionReducer } from "./session.js";

const int = (value) => ({ type: "int", value });

/** A four-step run whose top frame changes from `main` to `helper` and back. */
function step(i, event, { id = 1, fn = "<module>", line = 1, frames = null, error = null } = {}) {
  const stack =
    frames ??
    [{ frame_id: 1, function: "<module>", call_line: null, line, variables: { x: int(i) } }];
  return {
    step: i,
    event,
    function: fn,
    frame_id: id,
    line,
    frames: stack,
    heap: {},
    ...(error ? { error } : {}),
  };
}

const TRACE = [
  step(0, "call", { line: 0 }),
  step(1, "line", { line: 1 }),
  step(2, "line", { line: 2 }),
  step(3, "return", { line: 3 }),
];

function runSession(trace = TRACE) {
  const start = createInitialSession({ source: "x = 1\nx = 2\nx = 3\n" });
  return sessionReducer(start, sessionActions.finishRun({ result: { status: "ok", trace } }));
}

test("a fresh session has one cursor and no run", () => {
  const state = createInitialSession({ source: "print(1)\n", speed: 2, viz: "timeline" });
  assert.equal(state.index, 0);
  assert.equal(state.result, null);
  assert.equal(state.running, false);
  assert.equal(state.editing, true);
  assert.equal(state.playing, false);
  assert.equal(state.speed, 2);
  assert.equal(state.viz, "timeline");
  assert.equal(state.adapter, "auto");
  assert.equal(state.profile, null);
  assert.equal(state.recognition, null);
  assert.equal(state.selectedFrameId, null);
});

test("a run starts by stopping playback and dropping the previous call selection", () => {
  let state = runSession();
  state = sessionReducer(state, sessionActions.setStep(2));
  state = sessionReducer(state, sessionActions.setPlaying(true));
  state = sessionReducer(state, sessionActions.selectFrame(1));

  const started = sessionReducer(state, sessionActions.startRun());
  assert.equal(started.running, true);
  assert.equal(started.playing, false);
  assert.equal(started.selectedFrameId, null);
  assert.equal(started.index, 2, "the old step stays while the new run is prepared");
});

test("a successful run resets the cursor, selection, playback and editor mode", () => {
  let state = runSession();
  state = sessionReducer(state, sessionActions.setStep(3));
  state = sessionReducer(state, sessionActions.setPlaying(true));
  state = sessionReducer(state, sessionActions.selectFrame(1));

  const profile = { status: "ok", functions: [] };
  const recognition = { adapterId: "generic", confidence: 0.1, evidence: [] };
  const next = sessionReducer(
    state,
    sessionActions.finishRun({
      result: { status: "ok", trace: TRACE },
      flow: { nodes: [] },
      flowGraph: { nodes: [] },
      profile,
      recognition,
    }),
  );
  assert.equal(next.index, 0);
  assert.equal(next.running, false);
  assert.equal(next.editing, false);
  assert.equal(next.playing, false);
  assert.equal(next.selectedFrameId, null);
  assert.deepEqual(next.flow, { nodes: [] });
  assert.deepEqual(next.flowGraph, { nodes: [] });
  assert.equal(next.profile, profile);
  assert.equal(next.recognition, recognition);
});

test("a failed run clears the trace and leaves the editor usable", () => {
  const state = createInitialSession({ source: "print(1)\n" });
  const failed = sessionReducer(
    state,
    sessionActions.failRun({
      status: "engine_error",
      trace: [],
      output: "",
      error: { type: "EngineError", message: "boom" },
    }),
  );
  assert.equal(failed.result.status, "engine_error");
  assert.equal(failed.result.error.message, "boom");
  assert.equal(failed.index, 0);
  assert.equal(failed.running, false);
  assert.equal(failed.editing, true);
  assert.equal(failed.flow, null);
  assert.equal(failed.flowGraph, null);
  assert.equal(failed.profile, null);
  assert.equal(failed.recognition, null);
  assert.equal(failed.selectedFrameId, null);
});

test("step navigation clamps at both ends and recovers from a bad index", () => {
  let state = runSession();
  state = sessionReducer(state, sessionActions.setStep(99));
  assert.equal(state.index, 3);
  state = sessionReducer(state, sessionActions.stepBy(1));
  assert.equal(state.index, 3, "the last step does not run past the trace");
  state = sessionReducer(state, sessionActions.stepBy(-2));
  assert.equal(state.index, 1);
  state = sessionReducer(state, sessionActions.setStep(-10));
  assert.equal(state.index, 0);
  state = sessionReducer(state, sessionActions.stepBy(Number.NaN));
  assert.equal(state.index, 0, "a bad delta does not corrupt the cursor");
});

test("playback and speed are session preferences, not cursor moves", () => {
  let state = runSession();
  state = sessionReducer(state, sessionActions.setStep(2));
  state = sessionReducer(state, sessionActions.setPlaying(true));
  assert.equal(state.playing, true);
  assert.equal(state.index, 2);

  const toggled = sessionReducer(state, sessionActions.togglePlaying());
  assert.equal(toggled.playing, false);
  assert.equal(toggled.index, 2);

  const faster = sessionReducer(state, sessionActions.setSpeed(4));
  assert.equal(faster.speed, 4);
  assert.equal(faster.index, 2);

  const bad = sessionReducer(state, sessionActions.setSpeed(99));
  assert.equal(bad.speed, 1, "an unknown speed keeps the current one");
  assert.equal(bad.index, 2);
});

test("selecting a frame changes no cursor, playback or speed state", () => {
  let state = runSession();
  state = sessionReducer(state, sessionActions.setStep(2));
  state = sessionReducer(state, sessionActions.setPlaying(true));
  state = sessionReducer(state, sessionActions.setSpeed(2));

  const selected = sessionReducer(state, sessionActions.selectFrame(1));
  assert.equal(selected.selectedFrameId, 1);
  assert.equal(selected.index, 2);
  assert.equal(selected.playing, true);
  assert.equal(selected.speed, 2);

  const cleared = sessionReducer(selected, sessionActions.clearFrame());
  assert.equal(cleared.selectedFrameId, null);
  assert.equal(cleared.index, 2);
  assert.equal(cleared.playing, true);
});

test("switching views leaves the step, selection and playback untouched", () => {
  let state = runSession();
  state = sessionReducer(state, sessionActions.setStep(2));
  state = sessionReducer(state, sessionActions.setPlaying(true));
  state = sessionReducer(state, sessionActions.selectFrame(1));

  const switched = sessionReducer(state, sessionActions.selectViz("timeline"));
  assert.equal(switched.viz, "timeline");
  assert.equal(switched.index, 2);
  assert.equal(switched.selectedFrameId, 1);
  assert.equal(switched.playing, true);

  const unknown = sessionReducer(switched, sessionActions.selectViz("not-a-view"));
  assert.equal(unknown.viz, "timeline");
  assert.equal(unknown.index, 2);
});

test("choosing a scene adapter leaves the step, selection and playback alone", () => {
  let state = runSession();
  state = sessionReducer(state, sessionActions.setStep(2));
  state = sessionReducer(state, sessionActions.setPlaying(true));
  state = sessionReducer(state, sessionActions.selectFrame(1));

  const sorting = sessionReducer(state, sessionActions.selectAdapter("sorting"));
  assert.equal(sorting.adapter, "sorting");
  assert.equal(sorting.index, 2);
  assert.equal(sorting.selectedFrameId, 1);
  assert.equal(sorting.playing, true);

  const auto = sessionReducer(sorting, sessionActions.selectAdapter("auto"));
  assert.equal(auto.adapter, "auto");
  assert.equal(auto.index, 2);

  const unknown = sessionReducer(auto, sessionActions.selectAdapter("not-an-adapter"));
  assert.equal(unknown.adapter, "auto");
  assert.equal(unknown.index, 2);
});

test("editing the source does not move the cursor or forget the selection", () => {
  let state = runSession();
  state = sessionReducer(state, sessionActions.setStep(2));
  state = sessionReducer(state, sessionActions.selectFrame(1));

  const edited = sessionReducer(state, sessionActions.setSource("print(2)\n"));
  assert.equal(edited.source, "print(2)\n");
  assert.equal(edited.index, 2);
  assert.equal(edited.selectedFrameId, 1);
});

test("an empty trace keeps the cursor at zero and every step action safe", () => {
  let state = createInitialSession();
  state = sessionReducer(state, sessionActions.stepBy(1));
  assert.equal(state.index, 0);
  state = sessionReducer(state, sessionActions.setStep(12));
  assert.equal(state.index, 0);

  const finished = sessionReducer(
    state,
    sessionActions.finishRun({ result: { status: "ok", trace: [] } }),
  );
  assert.equal(finished.index, 0);
  assert.equal(finished.result.trace.length, 0);
});

test("a crashed run opens on the exception step without being told", () => {
  const trace = [
    step(0, "line", { line: 1 }),
    step(1, "exception", { line: 2, error: { type: "ValueError", message: "bad" } }),
    step(2, "return", { line: 2 }),
  ];
  const state = sessionReducer(
    createInitialSession(),
    sessionActions.finishRun({
      result: { status: "error", trace, error: { type: "ValueError", message: "bad" } },
    }),
  );
  assert.equal(state.index, 1);
  assert.equal(state.editing, false);
});

test("cancelling a stale run keeps the previous result on screen", () => {
  let state = runSession();
  const previous = state.result;
  state = sessionReducer(state, sessionActions.setStep(2));
  state = sessionReducer(state, sessionActions.setSource("print('new')\n"));
  state = sessionReducer(state, sessionActions.startRun());

  const cancelled = sessionReducer(state, sessionActions.cancelRun());
  assert.equal(cancelled.running, false);
  assert.equal(cancelled.result, previous, "the old run is not replaced with an error");
  assert.equal(cancelled.source, "print('new')\n");
  assert.equal(cancelled.index, 2, "the old cursor is still valid for the old trace");

  const idle = sessionReducer(cancelled, sessionActions.cancelRun());
  assert.equal(idle, cancelled, "cancelling an idle session changes nothing");
});
