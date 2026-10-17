// Unit tests for the graph viewport maths (src/flowchart/viewport.js).
//
//   node --test src/flowchart/viewport.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FIT_PADDING,
  MAX_SCALE,
  MIN_LEGIBLE_SCALE,
  centreOn,
  clampPan,
  computeFit,
  panBy,
  toScreen,
  viewBoxOf,
  zoomAt,
} from "./viewport.js";

const pane = (width, height) => ({ width, height });

test("computeFit centres a small chart without magnifying it", () => {
  const fit = computeFit({ width: 100, height: 100 }, pane(500, 400));
  assert.equal(fit.scale, 1);
  assert.equal(fit.x, 250 - 50);
  assert.equal(fit.y, 200 - 50);
});

test("computeFit shrinks a chart that can still fit legibly", () => {
  // 520x520 into a 500x500 pane: the whole chart fits at ~0.91, above the floor.
  const fit = computeFit({ width: 520, height: 520 }, pane(500, 500));
  const inner = 500 - FIT_PADDING * 2;
  assert.ok(Math.abs(fit.scale - inner / 520) < 1e-9);
  assert.ok(fit.scale < 1);
  // Centred: the chart's centre lands on the pane's centre.
  const centre = toScreen(fit, { x: 260, y: 260 });
  assert.ok(Math.abs(centre.x - 250) < 1e-9);
  assert.ok(Math.abs(centre.y - 250) < 1e-9);
});

test("computeFit fits the width and opens a very tall chart at its top", () => {
  const fit = computeFit({ width: 200, height: 2000 }, pane(400, 300));
  assert.equal(fit.scale, 1, "width fits at 100%, no need to shrink");
  // Centred across, but pinned to the top so the first line is on screen.
  const topLeft = toScreen(fit, { x: 0, y: 0 });
  assert.equal(topLeft.x, 100);
  assert.equal(topLeft.y, 0);
  const middle = toScreen(fit, { x: 100, y: 1000 });
  assert.equal(middle.x, 200);
  assert.equal(middle.y, 1000);
});

test("computeFit never goes below the legibility floor", () => {
  const fit = computeFit({ width: 4000, height: 3000 }, pane(400, 300));
  assert.equal(fit.scale, MIN_LEGIBLE_SCALE);
});

test("computeFit survives missing bounds and viewports", () => {
  assert.equal(computeFit(null, null).scale, 1);
  assert.ok(Number.isFinite(computeFit({ width: 0, height: 0 }, pane(10, 10)).x));
});

test("zoomAt keeps the chosen point pinned under the cursor", () => {
  const point = { x: 100, y: 50 };
  const zoomed = zoomAt({ scale: 1, x: 0, y: 0 }, point, 2);
  assert.equal(zoomed.scale, 2);
  const after = toScreen(zoomed, point);
  assert.ok(Math.abs(after.x - 100) < 1e-9);
  assert.ok(Math.abs(after.y - 50) < 1e-9);
});

test("zoomAt clamps to the scale limits but still pins the point", () => {
  const point = { x: 10, y: 10 };
  const zoomed = zoomAt({ scale: 1, x: 0, y: 0 }, point, 1000);
  assert.equal(zoomed.scale, MAX_SCALE);
  const after = toScreen(zoomed, point);
  assert.ok(Math.abs(after.x - 10) < 1e-9);
});

test("zoomAt is a no-op when it cannot change the scale", () => {
  const transform = { scale: MAX_SCALE, x: 5, y: 5 };
  assert.equal(zoomAt(transform, { x: 0, y: 0 }, 2), transform);
});

test("panBy shifts the translation only", () => {
  assert.deepEqual(panBy({ scale: 2, x: 0, y: 0 }, 10, -5), { scale: 2, x: 10, y: -5 });
});

test("centreOn puts the point in the middle of the pane", () => {
  const centred = centreOn({ scale: 2, x: 0, y: 0 }, { x: 30, y: 20 }, pane(200, 100));
  assert.deepEqual(centred, { scale: 2, x: 100 - 60, y: 50 - 40 });
});

test("viewBoxOf maps the transform to the visible rectangle", () => {
  // x = -100 at scale 2 means we start 50 graph units in; 400 / 2 = 200 wide.
  assert.equal(viewBoxOf({ scale: 2, x: -100, y: -50 }, pane(400, 300)), "50 25 200 150");
});

test("clampPan keeps part of the drawing on screen", () => {
  const far = clampPan({ scale: 1, x: -99999, y: -99999 }, { width: 200, height: 200 }, pane(400, 300));
  assert.ok(far.x <= 400);
  assert.ok(far.y <= 300);
  assert.ok(far.x >= 48 - 200);
  assert.ok(far.y >= 48 - 200);
});

test("clampPan leaves a chart that already fits alone", () => {
  const centred = centreOn({ scale: 1, x: 0, y: 0 }, { x: 50, y: 50 }, pane(400, 300));
  assert.deepEqual(clampPan(centred, { width: 100, height: 100 }, pane(400, 300)), centred);
});
