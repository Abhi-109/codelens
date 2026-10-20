import assert from "node:assert/strict";
import { test } from "node:test";

import {
  closeComparison,
  compareSteps,
  initialComparison,
  openComparison,
  setComparisonEndpoint,
  swapComparison,
} from "./compare.js";

const int = (value) => ({ type: "int", value });
const str = (value) => ({ type: "str", value });
const ref = (id) => ({ type: "ref", id });

function frame(id, fn, variables = {}, callLine = null, line = 1) {
  return { frame_id: id, function: fn, line, call_line: callLine, variables };
}

function event(index, kind, { frames = [], heap = {}, line = 1, functionName = "<module>" } = {}) {
  return {
    step: index,
    event: kind,
    function: functionName,
    frame_id: frames.length ? frames[frames.length - 1].frame_id : null,
    line,
    frames,
    heap,
  };
}

function state(index, { variables = {}, heap = {}, id = 1, fn = "<module>", line = 1 } = {}) {
  return event(index, "line", {
    frames: [frame(id, fn, variables, null, line)],
    heap,
    line,
    functionName: fn,
  });
}

function row(report, name) {
  const found = report.variables.find((entry) => entry.name === name);
  assert.ok(found, `expected a comparison row for ${name}`);
  return found;
}

test("equal steps report no differences and keep the recorded values", () => {
  const trace = [state(0, { variables: { x: int(5), s: str("a") } })];
  const report = compareSteps(trace, 0, 0);
  assert.equal(report.available, true);
  assert.equal(report.equalIndices, true);
  assert.equal(report.summary.different, false);
  assert.deepEqual(
    report.variables.map((entry) => [entry.name, entry.status, entry.textA, entry.textB]),
    [
      ["s", "unchanged", '"a"', '"a"'],
      ["x", "unchanged", "5", "5"],
    ],
  );
  assert.equal(report.output.status, "unchanged");
  assert.equal(report.stack.status, "unchanged");
});

test("variables are classified as added, removed, changed and unchanged", () => {
  const trace = [
    state(0, { variables: { keep: int(1), change: int(1), gone: int(9) } }),
    state(1, { variables: { keep: int(1), change: int(2), added: int(3) } }),
  ];
  const report = compareSteps(trace, 0, 1);
  assert.equal(row(report, "keep").status, "unchanged");
  assert.equal(row(report, "change").status, "changed");
  assert.equal(row(report, "change").textA, "1");
  assert.equal(row(report, "change").textB, "2");
  assert.equal(row(report, "gone").status, "removed");
  assert.equal(row(report, "added").status, "added");
  assert.equal(report.summary.changedVariables, 3);
});

test("a different frame does not turn a missing local into a deletion", () => {
  const trace = [
    state(0, { id: 1, variables: { x: int(1) } }),
    state(1, { id: 2, fn: "fact", variables: { n: int(2) } }),
  ];
  const report = compareSteps(trace, 0, 1);
  assert.equal(row(report, "x").status, "unavailable");
  assert.equal(row(report, "n").status, "added");
  assert.equal(report.stack.status, "changed");
  assert.equal(report.stack.entered.length, 1);
  assert.equal(report.stack.entered[0].function, "fact");
  assert.deepEqual(
    report.variables.map((entry) => [entry.name, entry.scopeA, entry.scopeB]),
    [
      ["n", "global", "fact"],
      ["x", "global", "fact"],
    ],
  );
});

test("nested mutable objects and dict mutations are matched by the trace's own ids", () => {
  const beforeHeap = {
    o1: {
      type: "list",
      items: [int(1), ref("o2")],
    },
    o2: { type: "list", items: [int(2)] },
    o3: { type: "dict", entries: [{ key: str("k"), value: int(1) }] },
    o4: { type: "list", items: [int(7)] },
  };
  const afterHeap = {
    o1: {
      type: "list",
      items: [int(1), ref("o2")],
    },
    o2: { type: "list", items: [int(2), int(3)] },
    o3: { type: "dict", entries: [{ key: str("k"), value: int(2) }] },
  };
  const trace = [
    state(0, { variables: { a: ref("o1"), d: ref("o3"), old: ref("o4") }, heap: beforeHeap }),
    state(1, { variables: { a: ref("o1"), d: ref("o3") }, heap: afterHeap }),
  ];
  const report = compareSteps(trace, 0, 1);
  assert.equal(row(report, "a").status, "changed", "the nested list is part of a's value");
  assert.equal(report.objects.find((entry) => entry.id === "o2").status, "changed");
  assert.equal(report.objects.find((entry) => entry.id === "o3").status, "changed");
  assert.equal(report.objects.find((entry) => entry.id === "o4").status, "only-baseline");
  assert.match(report.objects.find((entry) => entry.id === "o2").textB, /2, 3/);
});

test("output added between two steps is kept exactly and never reordered", () => {
  const trace = [
    state(0, { variables: {} }),
    event(1, "output", { frames: [frame(1, "<module>")], line: 1 }),
    { ...event(2, "output", { frames: [frame(1, "<module>")], line: 1 }), text: "A" },
    { ...event(3, "output", { frames: [frame(1, "<module>")], line: 1 }), text: "B\n" },
  ];
  const report = compareSteps(trace, 2, 3);
  assert.equal(report.output.status, "added");
  assert.equal(report.output.addedText, "B\n");
  assert.equal(report.output.baselineText, "A");
  assert.equal(report.output.comparisonText, "AB\n");
  assert.equal(report.summary.different, true);
});

test("reversed endpoints swap what was added and what was removed", () => {
  const trace = [
    state(0, { variables: {} }),
    { ...event(1, "output", { frames: [frame(1, "<module>")], line: 1 }), text: "A" },
    state(2, { variables: { x: int(1) } }),
  ];
  const forward = compareSteps(trace, 0, 2);
  const reverse = compareSteps(trace, 2, 0);
  assert.equal(forward.output.status, "added");
  assert.equal(reverse.output.status, "removed");
  assert.equal(row(forward, "x").status, "added");
  assert.equal(row(reverse, "x").status, "removed");
});

test("an incomplete or empty trace says so instead of guessing", () => {
  const incomplete = [{ step: 0, event: "output", text: "hello\n" }];
  const report = compareSteps(incomplete, 0, 0);
  assert.equal(report.available, false);
  assert.match(report.reason, /does not record program state/);
  assert.equal(report.variables.length, 0);
  const empty = compareSteps([], 0, 0);
  assert.equal(empty.available, false);
  assert.match(empty.reason, /No execution steps/);
});

test("out-of-range and non-numeric endpoints are unavailable, not clamped silently", () => {
  const trace = [state(0, { variables: { x: int(1) } })];
  for (const [a, b] of [[-1, 0], [0, 9], [0, 1.5], ["0", 0]]) {
    const report = compareSteps(trace, a, b);
    assert.equal(report.available, false, `${a}, ${b}`);
    assert.ok(report.reason);
  }
});

test("the same trace and endpoints produce the same report every time", () => {
  const trace = [
    state(0, { variables: { x: int(1) }, heap: { o1: { type: "list", items: [int(1)] } } }),
    state(1, { variables: { x: int(2) }, heap: { o1: { type: "list", items: [int(2)] } } }),
  ];
  assert.deepEqual(compareSteps(trace, 0, 1), compareSteps(trace, 0, 1));
});

test("comparison state carries the playback step through and changes one endpoint", () => {
  const workspace = { ...initialComparison(), index: 7, playing: true };
  const opened = openComparison(workspace, 7, 10);
  assert.equal(opened.index, 7, "opening comparison did not move playback");
  assert.equal(opened.playing, true);
  assert.deepEqual(
    { open: opened.open, baseline: opened.baseline, comparison: opened.comparison },
    { open: true, baseline: 6, comparison: 7 },
  );

  const changed = setComparisonEndpoint(opened, "baseline", 2, 10);
  assert.equal(changed.index, 7);
  assert.equal(changed.comparison, 7);
  assert.equal(changed.baseline, 2);
  assert.equal(setComparisonEndpoint(changed, "baseline", 99, 10).baseline, 9);
  assert.equal(setComparisonEndpoint(changed, "nope", 3, 10), changed);

  const swapped = swapComparison(changed);
  assert.equal(swapped.baseline, 7);
  assert.equal(swapped.comparison, 2);
  assert.equal(swapped.index, 7);

  const closed = closeComparison(swapped);
  assert.equal(closed.open, false);
  assert.equal(closed.index, 7);
  assert.equal(closed.baseline, 7);
});
