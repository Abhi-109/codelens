// Unit tests for the variable-history chart geometry (src/tracer/history.js).
//
//   node --test src/tracer/history.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";

import { chartGeometry, isNumericSeries } from "./history.js";

const entry = (index, number, value = String(number)) => ({ index, number, value, line: index });

test("a series is plotable only when every entry is a finite number", () => {
  assert.equal(isNumericSeries([entry(0, 1), entry(2, 3.5)]), true);
  assert.equal(isNumericSeries([entry(0, 1), { index: 2, number: null, value: "ten" }]), false);
  assert.equal(isNumericSeries([entry(0, Number.NaN)]), false);
  assert.equal(isNumericSeries([]), false);
  assert.equal(isNumericSeries(null), false);
});

test("x follows the real step, not the entry's position in the list", () => {
  const chart = chartGeometry([entry(0, 0), entry(10, 10)], 5, 11);
  assert.deepEqual(
    chart.points.map((point) => [point.x, point.y]),
    [
      [10, 102],
      [250, 10],
    ],
  );
  assert.equal(chart.currentX, 130);
  assert.equal(chart.zeroY, 102);
  assert.equal(chart.min, 0);
  assert.equal(chart.max, 10);
});

test("one repeated value still draws through the middle instead of dividing by zero", () => {
  const chart = chartGeometry([entry(0, 5), entry(4, 5)], 2, 5);
  assert.equal(chart.points[0].y, 56);
  assert.equal(chart.points[1].y, 56);
  assert.equal(chart.zeroY, null);
  assert.equal(chart.min, 5);
  assert.equal(chart.max, 5);
});

test("a series that crosses zero marks the zero line", () => {
  const chart = chartGeometry([entry(0, -5), entry(4, 5)], 4, 5);
  assert.equal(chart.zeroY, 56);
});

test("a non-numeric history has no points to draw", () => {
  const chart = chartGeometry([entry(0, null), entry(1, null)], 1, 2);
  assert.deepEqual(chart.points, []);
  assert.equal(chart.currentX, null);
});
