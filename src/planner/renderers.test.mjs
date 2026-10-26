// The capability registry describes the canvases this build really offers.
// These tests fail if a hypothetical renderer is ever registered.

import assert from "node:assert/strict";
import { test } from "node:test";

import { VIZ_BLURBS, VIZ_LABELS, VIZ_MODES } from "../visualizer/vizMode.js";
import {
  RENDERER_CAPABILITIES,
  canRender,
  getRenderer,
  isRendererId,
  rendererIds,
  supportsConcept,
} from "./renderers.js";

test("every offered canvas has exactly one capability entry", () => {
  assert.deepEqual(rendererIds(), VIZ_MODES);
  const ids = RENDERER_CAPABILITIES.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length, "no duplicate ids");
  for (const entry of RENDERER_CAPABILITIES) {
    assert.ok(VIZ_MODES.includes(entry.id), entry.id);
    assert.equal(entry.name, VIZ_LABELS[entry.id]);
    assert.equal(entry.purpose, VIZ_BLURBS[entry.id]);
    assert.equal(entry.sharedCursor, true);
    assert.equal(entry.reducedMotion, true);
    assert.equal(entry.fallback, "motion");
    assert.equal(typeof entry.primary, "boolean");
    assert.equal(typeof entry.secondary, "boolean");
    assert.ok(Array.isArray(entry.requiredEvidence));
    assert.ok(Array.isArray(entry.limitations));
  }
});

test("unknown renderer ids are rejected everywhere", () => {
  for (const id of ["graph", "bfs", "canvas", "", null, 5, "Motion"]) {
    assert.equal(isRendererId(id), false, String(id));
    assert.equal(getRenderer(id), null, String(id));
    assert.equal(canRender(id, { trace: { events: 5 } }).ok, false);
    assert.deepEqual(canRender(id, {}).missing, ["unknown_renderer"]);
  }
});

test("capability checks name what is missing", () => {
  assert.deepEqual(canRender("motion", {}).missing, ["trace"]);
  assert.equal(canRender("motion", { trace: { events: 1 } }).ok, true);

  assert.deepEqual(canRender("tree", { trace: { events: 3 } }).missing, ["call_events"]);
  assert.equal(canRender("tree", { trace: { events: 3, calls: 1 } }).ok, true);

  assert.deepEqual(canRender("scene", { trace: { events: 3 } }).missing, ["trace_frames"]);
  assert.equal(canRender("scene", { trace: { events: 3, hasFrames: true } }).ok, true);

  assert.deepEqual(canRender("flow", { trace: { events: 3 } }).missing, ["source_flow"]);
  assert.equal(canRender("flow", { trace: { events: 3 }, hasFlow: true }).ok, true);

  assert.deepEqual(canRender("combined", { trace: { events: 3 } }).missing, [
    "call_events",
    "trace_frames",
  ]);
});

test("timeline is offered but never chosen automatically", () => {
  const timeline = getRenderer("timeline");
  assert.equal(timeline.primary, false);
  assert.equal(timeline.secondary, true);
});

test("concept support is explicit, and an empty list means generic", () => {
  assert.equal(supportsConcept("tree", "recursion"), true);
  assert.equal(supportsConcept("tree", "dict_mutation"), false);
  assert.equal(supportsConcept("motion", "anything"), true);
  assert.equal(supportsConcept("nope", "recursion"), false);
});
