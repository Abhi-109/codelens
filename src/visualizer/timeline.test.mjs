import assert from "node:assert/strict";
import { test } from "node:test";

import {
  TIMELINE_ROW_HEIGHT,
  filterTimelineRows,
  scrollTarget,
  timelineRows,
  visibleRange,
} from "./timeline.js";

const int = (value) => ({ type: "int", value });

function frame(id, fn, variables = {}, line = 1) {
  return { frame_id: id, function: fn, line, call_line: null, variables };
}

function event(index, kind, { id = 1, fn = "<module>", line = 1, variables = {}, text } = {}) {
  const carriesState = kind !== "output" && kind !== "input";
  return {
    step: index,
    event: kind,
    function: fn,
    frame_id: id,
    line,
    ...(carriesState ? { frames: [frame(id, fn, variables, line)], heap: {} } : {}),
    ...(text === undefined ? {} : { text }),
  };
}

const SOURCE = "x = 1\nif x:\n    y = 2\nfor i in [1]:\n    x = i\n";

test("one row per real trace step, with the recorded line and event", () => {
  const trace = [
    event(0, "call", { line: 0 }),
    event(1, "line", { line: 1 }),
    event(2, "line", { line: 2, variables: { x: int(1) } }),
    event(3, "line", { line: 3, variables: { x: int(1) } }),
  ];
  const rows = timelineRows(trace, SOURCE);
  assert.equal(rows.length, trace.length);
  assert.deepEqual(
    rows.map((row) => [row.index, row.step, row.line, row.event]),
    [
      [0, 1, null, "call"],
      [1, 2, 1, "line"],
      [2, 3, 2, "line"],
      [3, 4, 3, "line"],
    ],
  );
  assert.equal(rows[0].label, "start");
  assert.equal(rows[1].kind, "mutation", "line 1 creates x");
  assert.equal(rows[2].kind, "branch");
  assert.equal(rows[2].code, "if x:");
});

test("event types are distinguishable and derived from the trace", () => {
  const trace = [
    event(0, "call", { fn: "fact", id: 2, line: 2 }),
    event(1, "line", { fn: "fact", id: 2, line: 2, variables: { n: int(2) } }),
    event(2, "output", { line: 2, text: "hi\n" }),
    event(3, "input", { line: 2, text: "Asha" }),
    event(4, "return", { fn: "fact", id: 2, line: 3 }),
    {
      ...event(5, "exception", { fn: "fact", id: 2, line: 3 }),
      exception: { type: "ZeroDivisionError", message: "division by zero" },
    },
    { ...event(6, "error", { line: 3 }), type: "ZeroDivisionError", message: "division by zero" },
  ];
  const rows = timelineRows(trace, SOURCE);
  assert.equal(rows[0].kind, "call");
  assert.match(rows[0].label, /fact/);
  assert.equal(rows[2].kind, "output");
  assert.equal(rows[2].code, "hi");
  assert.equal(rows[3].kind, "input");
  assert.equal(rows[3].code, "input() → Asha");
  assert.equal(rows[4].kind, "return");
  assert.equal(rows[5].kind, "error");
  assert.equal(rows[5].label, "ZeroDivisionError");
  assert.equal(rows[6].kind, "error");
  assert.match(rows[6].code, /ZeroDivisionError: division by zero/);
});

test("a comparison row shows the operands, operator and answer from the trace", () => {
  const trace = [
    event(0, "line", { line: 2 }),
    {
      ...event(1, "compare", { line: 2, variables: { x: int(1) } }),
      operator: ">=",
      operands: [{ cell: null, value: int(1) }, { cell: null, value: int(2) }],
      result: false,
    },
    {
      // A comparison that produced no plain bool says only what it compared.
      ...event(2, "compare", { line: 2 }),
      operator: "==",
      operands: [{ cell: null, value: int(1) }, { cell: null, value: int(2) }],
      result: null,
    },
  ];
  const rows = timelineRows(trace, SOURCE);
  assert.equal(rows[1].kind, "compare");
  assert.equal(rows[1].label, "compare");
  assert.equal(rows[1].code, "1 >= 2 → False");
  assert.equal(rows[1].line, 2);
  assert.equal(rows[1].notable, true, "a compare step is worth seeing with only-changes on");
  assert.equal(rows[2].code, "1 == 2");
});

test("the output column is a real tail of what had been printed", () => {
  const trace = [
    event(0, "line", { line: 1 }),
    event(1, "output", { line: 1, text: "Hello" }),
    event(2, "output", { line: 1, text: ", world\n" }),
  ];
  const rows = timelineRows(trace, SOURCE);
  assert.equal(rows[1].output, "Hello");
  assert.equal(rows[2].output, "Hello, world");
  assert.equal(rows[2].printedLength, "Hello, world\n".length);
  assert.equal(rows[2].outputTitle, "Hello, world\n");
});

test("only-changes keeps the current row even when it changed nothing", () => {
  const rows = [
    { index: 0, notable: false },
    { index: 1, notable: true },
    { index: 2, notable: false },
    { index: 3, notable: true },
  ];
  assert.deepEqual(
    filterTimelineRows(rows, true, 2).map((row) => row.index),
    [1, 2, 3],
  );
  assert.equal(filterTimelineRows(rows, false, 2), rows);
});

test("the virtual window covers the viewport and both overscan edges", () => {
  const range = visibleRange(1500, TIMELINE_ROW_HEIGHT * 100, TIMELINE_ROW_HEIGHT * 10);
  assert.equal(range.start, 94);
  assert.equal(range.end, 116);
  assert.equal(range.topPad, TIMELINE_ROW_HEIGHT * 94);
  assert.equal(
    range.topPad + (range.end - range.start) * TIMELINE_ROW_HEIGHT + range.bottomPad,
    TIMELINE_ROW_HEIGHT * 1500,
  );
  assert.deepEqual(visibleRange(0, 0, 300), {
    start: 0,
    end: 0,
    topPad: 0,
    bottomPad: 0,
  });
  assert.equal(visibleRange(4, 0, 300).end, 4, "a short trace draws every row");
});

test("auto-scroll only moves a row that is outside the measured viewport", () => {
  assert.equal(scrollTarget(2, 0, TIMELINE_ROW_HEIGHT * 10), 0, "visible row stays put");
  assert.equal(
    scrollTarget(10, 0, TIMELINE_ROW_HEIGHT * 10),
    TIMELINE_ROW_HEIGHT,
    "row below the fold moves to the bottom edge",
  );
  assert.equal(
    scrollTarget(2, TIMELINE_ROW_HEIGHT * 5, TIMELINE_ROW_HEIGHT * 10),
    TIMELINE_ROW_HEIGHT * 2,
    "row above the fold moves to the top edge",
  );
  assert.equal(scrollTarget(2, 40, 0), null, "a hidden pane has no target");
  assert.equal(scrollTarget(2, 40, -20), null, "a negative height is not a viewport");
});

test("an empty trace has no rows and a single-step trace has exactly one", () => {
  assert.deepEqual(timelineRows([], SOURCE), []);
  const one = timelineRows([event(0, "call", { line: 0 })], SOURCE);
  assert.equal(one.length, 1);
  assert.equal(one[0].step, 1);
  assert.equal(one[0].line, null);
});

test("rows are deterministic for the same trace and source", () => {
  const trace = [
    event(0, "line", { line: 1 }),
    event(1, "line", { line: 2, variables: { x: int(1) } }),
  ];
  assert.deepEqual(timelineRows(trace, SOURCE), timelineRows(trace, SOURCE));
});
