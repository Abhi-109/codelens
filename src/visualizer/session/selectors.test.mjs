import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";

import { createInitialSession, sessionActions, sessionReducer } from "./session.js";
import {
  selectOutput,
  selectRunSource,
  selectSourceDirty,
  selectStepIndex,
  selectStepView,
  selectTrace,
  selectTraceIndex,
} from "./selectors.js";

const FIXTURES = JSON.parse(
  gunzipSync(readFileSync(new URL("../../tracer/__fixtures__/traces.json.gz", import.meta.url))),
);

function sessionFor(source, trace) {
  return sessionReducer(
    createInitialSession({ source }),
    sessionActions.finishRun({ result: { status: "ok", trace } }),
  );
}

test("the selector and the reducer agree on one cursor", () => {
  const { source, trace } = FIXTURES.fact;
  let state = sessionFor(source, trace);
  state = sessionReducer(state, sessionActions.setStep(12));

  assert.equal(selectStepIndex(state), 12);
  assert.equal(selectStepView(state).index, 12);
  assert.equal(selectOutput(state).index, 12);
});

test("an out-of-range session index is clamped before any panel sees it", () => {
  const { source, trace } = FIXTURES.fact;
  const state = { ...sessionFor(source, trace), index: 9999 };
  const view = selectStepView(state);
  assert.equal(selectStepIndex(state), trace.length - 1);
  assert.equal(view.index, trace.length - 1);
  assert.equal(selectOutput(state).index, trace.length - 1);
});

test("an empty trace produces an empty, safe view", () => {
  const state = createInitialSession({ source: "print(1)\n" });
  assert.deepEqual(selectTrace(state), []);
  const view = selectStepView(state);
  assert.equal(view.index, 0);
  assert.equal(view.event, null);
  assert.equal(view.kind, null);
  assert.deepEqual(view.callStack, []);
  assert.equal(view.selectionLost, false);
  const output = selectOutput(state);
  assert.equal(output.index, 0);
  assert.equal(output.hasTrace, false);
  assert.deepEqual(output.pastSegments, []);
});

test("selecting an older call that is still running keeps the selected step", () => {
  const { source, trace } = FIXTURES.fact;
  const callIndex = trace.findIndex((event) => event.event === "call" && event.function === "fact");
  const callerId = trace[callIndex].frames[0].frame_id;

  let state = sessionFor(source, trace);
  state = sessionReducer(state, sessionActions.setStep(callIndex));
  state = sessionReducer(state, sessionActions.selectFrame(callerId));

  assert.equal(state.index, callIndex, "frame selection must not move the cursor");
  const view = selectStepView(state);
  assert.equal(view.index, callIndex);
  assert.equal(view.frame.frameId, callerId);
  assert.equal(view.selectionLost, false);
  assert.equal(view.frame.function, "<module>");
});

test("a selected call that has returned falls back and says the selection is lost", () => {
  const { source, trace } = FIXTURES.fact;
  const callIndex = trace.findIndex((event) => event.event === "call" && event.function === "fact");
  const innerId = trace[callIndex].frames[trace[callIndex].frames.length - 1].frame_id;
  // The output steps after the return carry no stack of their own, so the last
  // step is the first one that is unambiguously back in the module frame.
  const afterReturn = trace.length - 1;

  assert.ok(afterReturn > callIndex, "the fixture has a step after that call returned");

  let state = sessionFor(source, trace);
  state = sessionReducer(state, sessionActions.selectFrame(innerId));
  state = sessionReducer(state, sessionActions.setStep(afterReturn));

  const view = selectStepView(state);
  assert.equal(view.index, afterReturn);
  assert.equal(view.selectionLost, true);
  assert.notEqual(view.frame?.frameId, innerId);
  assert.equal(view.frame.frameId, view.frameId, "the fallback is the live top frame");
});

test("switching the view while another call is selected keeps the same step", () => {
  const { source, trace } = FIXTURES.fact;
  const callIndex = trace.findIndex((event) => event.event === "call" && event.function === "fact");
  const callerId = trace[callIndex].frames[0].frame_id;
  const atCall = sessionReducer(sessionFor(source, trace), sessionActions.setStep(callIndex));
  const selected = sessionReducer(atCall, sessionActions.selectFrame(callerId));
  const switched = sessionReducer(selected, sessionActions.selectViz("timeline"));

  const before = selectStepView(atCall);
  const after = selectStepView(switched);
  assert.equal(after.index, before.index);
  assert.equal(after.event, before.event);
  assert.equal(after.frameId, before.frameId);
  assert.equal(after.line, before.line);
  assert.equal(after.frame.frameId, callerId, "the selected lens is still the caller");
  assert.equal(after.selectionLost, false);
});

test("playback and view switches reuse the trace index instead of rebuilding it", () => {
  const { source, trace } = FIXTURES.mergeSort;
  let state = sessionFor(source, trace);
  const index = selectTraceIndex(state);
  for (const next of [0, 12, trace.length - 1, 3]) {
    state = sessionReducer(state, sessionActions.setStep(next));
    state = sessionReducer(state, sessionActions.selectViz("timeline"));
    assert.equal(selectTraceIndex(state), index, `step ${next} kept the index`);
  }
});

test("the shown run is marked dirty only while the source differs from it", () => {
  const { source, trace } = FIXTURES.fact;
  let state = sessionFor(source, trace);
  assert.equal(state.runSource, source);
  assert.equal(selectSourceDirty(state), false);

  state = sessionReducer(state, sessionActions.setSource(`${source}\nprint("new")\n`));
  assert.equal(selectSourceDirty(state), true, "the canvas still shows the old run");

  state = sessionReducer(state, sessionActions.setSource(source));
  assert.equal(selectSourceDirty(state), false, "returning to the run source clears it");
});

test("editing the source does not rewrite the source the shown run was read from", () => {
  const { source, trace } = FIXTURES.fact;
  let state = sessionFor(source, trace);
  state = sessionReducer(state, sessionActions.setStep(2));
  const before = selectStepView(state);

  state = sessionReducer(state, sessionActions.setSource("print('a different program')\n"));
  const after = selectStepView(state);

  assert.equal(selectRunSource(state), source);
  assert.equal(state.source, "print('a different program')\n");
  assert.equal(after.code.text, before.code.text);
  assert.equal(after.explanation.aboutToHappen, before.explanation.aboutToHappen);
});
