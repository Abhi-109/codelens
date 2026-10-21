// Unit and corpus-wide equivalence tests for the per-trace index.
//
// The reference functions below are deliberately the old linear scans. Every
// step of every vendored program is tested against them, so the index can only
// be faster, never different.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";

import { buildTraceIndex, getTraceIndex } from "./traceIndex.js";

const FIXTURES = JSON.parse(
  gunzipSync(readFileSync(new URL("./__fixtures__/traces.json.gz", import.meta.url))),
);
const CORPUS = JSON.parse(
  gunzipSync(readFileSync(new URL("./__fixtures__/corpus.json.gz", import.meta.url))),
);

const top = (event) => event?.frames?.[event.frames.length - 1] ?? null;

function referenceStateAt(trace, index) {
  for (let i = Math.min(index, trace.length - 1); i >= 0; i -= 1) {
    if (trace[i]?.frames) return trace[i];
  }
  return null;
}

function referenceNextState(trace, index) {
  for (let i = index + 1; i < trace.length; i += 1) {
    if (trace[i]?.frames) return trace[i];
  }
  return null;
}

function referenceSameFrame(trace, index, frameId) {
  for (let i = index + 1; i < trace.length; i += 1) {
    if (top(trace[i])?.frame_id === frameId) return trace[i];
  }
  return null;
}

function referencePreviousLine(trace, index) {
  for (let i = index - 1; i >= 0; i -= 1) {
    if (trace[i].event === "line") return trace[i].line;
  }
  return null;
}

function referencePreviousLineInFrame(trace, index, frameId) {
  for (let i = index - 1; i >= 0; i -= 1) {
    if (trace[i].event === "line" && trace[i].frame_id === frameId) return trace[i].line;
  }
  return null;
}

function referenceNextLine(trace, index) {
  for (let i = index + 1; i < trace.length; i += 1) {
    if (trace[i].event === "line" && trace[i].frames) return trace[i];
  }
  return null;
}

function referenceSeen(trace, index, line, frameId) {
  for (let i = 0; i < index; i += 1) {
    if (trace[i].event === "line" && trace[i].line === line && trace[i].frame_id === frameId) {
      return true;
    }
  }
  return false;
}

const ANCHORS = new Set(["line", "call", "return", "unwind"]);
const CONTROLS = new Set([...ANCHORS, "exception"]);

function referencePreviousAnchor(trace, index) {
  for (let i = index - 1; i >= 0; i -= 1) if (ANCHORS.has(trace[i].event)) return i;
  return -1;
}

function referencePreviousAnchorInFrame(trace, index, frameId) {
  for (let i = index - 1; i >= 0; i -= 1) {
    if (ANCHORS.has(trace[i].event) && trace[i].frame_id === frameId) return i;
  }
  return -1;
}

function referencePrinted(trace, index) {
  let out = "";
  for (let i = index + 1; i < trace.length; i += 1) {
    const event = trace[i];
    if (CONTROLS.has(event.event)) break;
    if (event.event === "output") out += event.text;
  }
  return out.replace(/\n$/, "");
}

function referencePrintedText(trace, index) {
  let out = "";
  for (let i = index + 1; i < trace.length; i += 1) {
    const event = trace[i];
    if (event.event === "line" || event.event === "call" || event.event === "return") break;
    if (event.event === "output") out += event.text;
  }
  return out.replace(/\n$/, "");
}

function referenceOutputAt(trace, index) {
  let out = "";
  const last = Math.min(Math.max(Number(index) || 0, 0), trace.length - 1);
  for (let i = 0; i <= last; i += 1) {
    if (trace[i]?.event === "output") out += trace[i].text ?? "";
  }
  return out;
}

function referenceSegments(trace, from, to) {
  const start = Math.max(Number(from) || 0, 0);
  const end = Math.min(Number.isFinite(Number(to)) ? Number(to) : trace.length - 1, trace.length - 1);
  const segments = [];
  let open = null;
  for (let i = start; i <= end; i += 1) {
    const event = trace[i];
    if (event?.event === "output") {
      if (!open) open = { at: i, line: event.line ?? null, text: "", events: [] };
      open.text += event.text ?? "";
      open.events.push(i);
    } else if (event?.event !== "input") {
      if (open) {
        segments.push(open);
        open = null;
      }
    }
  }
  if (open) segments.push(open);
  return segments;
}

function referenceOutcome(trace, index) {
  const event = trace[index];
  if (!event || event.event !== "exception") return "raised";
  let unwound = false;
  for (let i = index + 1; i < trace.length; i += 1) {
    const next = trace[i];
    if (next.event === "line" && next.frame_id === event.frame_id) return "handled";
    if (next.event === "unwind" && next.frame_id === event.frame_id) {
      unwound = true;
      continue;
    }
    if (next.event === "error") return "uncaught";
    if (unwound && next.event === "exception" && next.frame_id !== event.frame_id) {
      return "propagated";
    }
  }
  return "raised";
}

test("the shared index is reused for the same trace and replaced for a new run", () => {
  const { trace } = FIXTURES.fact;
  const first = getTraceIndex(trace);
  assert.equal(getTraceIndex(trace), first);
  assert.notEqual(getTraceIndex(trace.slice()), first, "a new run is a new array");
  assert.notEqual(buildTraceIndex(trace), first, "buildTraceIndex is not the cache");
  assert.equal(getTraceIndex(null).length, 0);
});

test("state lookup crosses output and input events that carry no stack", () => {
  const { trace } = FIXTURES.fact;
  const index = getTraceIndex(trace);
  assert.equal(index.stateAt(14)?.event, "return");
  assert.equal(index.stateAt(15), index.stateAt(14), "output keeps the previous state");
  assert.equal(index.stateAt(17)?.event, "return");
  assert.equal(index.nextState(14)?.step, 17, "the next stack-carrying event is the module return");
  assert.equal(index.stateAt(999)?.step, 17);
  assert.equal(index.stateAt(-1), null);
});

test("frames expose their call, parent, return and lifetime", () => {
  const { trace } = FIXTURES.fact;
  const index = getTraceIndex(trace);
  assert.equal(index.firstCallIndex(4), 9);
  const frame = index.frame(4);
  assert.equal(frame.function, "fact");
  assert.equal(frame.parentId, 3);
  assert.equal(frame.depth, 3);
  assert.equal(frame.returnIndex, 12);
  assert.equal(frame.lastTopIndex, 12);
  assert.equal(index.frame(3).parentId, 2);
  assert.equal(index.frame(1).parentId, null);
  assert.equal(index.sameFrameAfter(11, 4)?.step, 12);
  assert.equal(index.sameFrameAfter(12, 4), null, "the frame is gone after its return");
});

test("line lookup handles repeated loop lines and a starting position", () => {
  const { trace } = FIXTURES.loop;
  const index = getTraceIndex(trace);
  const allForLine = trace
    .map((event, i) => (event.event === "line" && event.line === 3 ? i : -1))
    .filter((i) => i >= 0);
  assert.ok(allForLine.length >= 2);
  assert.equal(index.firstLineIndex(3), allForLine[0]);
  assert.equal(index.firstLineIndex(3, allForLine[0] + 1), allForLine[1]);
  assert.equal(index.previousLineNumber(allForLine[1]), 2, "the line just before is the loop body line");
  assert.equal(index.previousLineInFrame(allForLine[1], 1), 2, "the loop body line just ran");
  assert.equal(index.previousLineInFrame(4, 1), 3, "before the body, the header ran");
});

test("output prefixes, segments and input prompts come from the same index", () => {
  const { trace } = FIXTURES.fact;
  const index = getTraceIndex(trace);
  assert.equal(index.outputAt(14), "");
  assert.equal(index.outputAt(15), "6");
  assert.equal(index.outputAt(16), "6\n");
  assert.deepEqual(
    index.outputSegments(0, 17).map((segment) => [segment.at, segment.text, segment.events]),
    [[15, "6\n", [15, 16]]],
  );

  const input = CORPUS["io-input"];
  assert.deepEqual(getTraceIndex(input.trace).inputs(), referenceInputs(input.trace));
  assert.ok(getTraceIndex(input.trace).inputs().some((entry) => entry.prompt.length > 0));
});

test("exception outcomes are classified from the trace, not guessed", () => {
  const caught = CORPUS["exception-custom"];
  const index = getTraceIndex(caught.trace);
  assert.deepEqual(
    index.exceptions().map((entry) => [entry.event, entry.outcome]),
    [
      ["exception", "propagated"],
      ["exception", "handled"],
    ],
  );
  for (let i = 0; i < caught.trace.length; i += 1) {
    if (caught.trace[i].event === "exception") {
      assert.equal(index.exceptionOutcome(i), referenceOutcome(caught.trace, i));
    }
  }
});

test("a long run keeps every lookup correct, including a safety-stop tail", () => {
  const trace = [];
  const frame = (line, value) => ({
    frame_id: 1,
    function: "<module>",
    call_line: null,
    line,
    variables: { x: { type: "int", value } },
  });
  for (let i = 0; i < 1500; i += 1) {
    const line = (i % 3) + 1;
    trace.push({
      step: i,
      event: "line",
      function: "<module>",
      frame_id: 1,
      line,
      frames: [frame(line, i)],
      heap: {},
    });
  }
  trace.push({ step: 1500, event: "step_limit", limit: 1500, message: "too many steps" });

  const index = getTraceIndex(trace);
  assert.equal(index.length, 1501);
  assert.equal(index.stateAt(1500)?.step, 1499);
  assert.equal(index.nextState(1499), null);
  assert.equal(index.previousLineNumber(1500), trace[1499].line);
  assert.equal(index.sameFrameAfter(1499, 1), null);
  assert.equal(index.outputAt(1500), "");
  assert.equal(index.frame(1).lastTopIndex, 1499);
});

test("every step of every program matches the old linear scans", () => {
  const programs = Object.entries(CORPUS);
  let steps = 0;
  let frames = 0;
  let comparisons = 0;

  for (const [name, program] of programs) {
    const { trace } = program;
    const index = getTraceIndex(trace);
    const frameIds = [...new Set(trace.flatMap((event) => (event.frames ?? []).map((frame) => frame.frame_id)))];

    for (let i = 0; i < trace.length; i += 1) {
      steps += 1;
      const where = `${name} step ${i}`;
      assert.equal(index.stateAt(i), referenceStateAt(trace, i), `${where}: stateAt`);
      assert.equal(index.nextState(i), referenceNextState(trace, i), `${where}: nextState`);
      assert.equal(index.previousLineNumber(i), referencePreviousLine(trace, i), `${where}: previousLineNumber`);
      assert.equal(index.nextLineEvent(i), referenceNextLine(trace, i), `${where}: nextLineEvent`);
      assert.equal(index.previousAnchorIndex(i), referencePreviousAnchor(trace, i), `${where}: previousAnchor`);
      assert.equal(
        index.previousAnchorInFrame(i, top(index.stateAt(i))?.frame_id),
        referencePreviousAnchorInFrame(trace, i, top(index.stateAt(i))?.frame_id),
        `${where}: previousAnchorInFrame`,
      );
      assert.equal(index.printedAfter(i), referencePrinted(trace, i), `${where}: printedAfter`);
      assert.equal(index.printedTextAfter(i), referencePrintedText(trace, i), `${where}: printedTextAfter`);
      assert.equal(index.outputAt(i), referenceOutputAt(trace, i), `${where}: outputAt`);
      assert.deepEqual(index.outputSegments(0, i), referenceSegments(trace, 0, i), `${where}: segments`);
      assert.deepEqual(index.inputs(), referenceInputs(trace), `${where}: inputs`);
      assert.deepEqual(index.exceptions(), referenceExceptions(trace), `${where}: exceptions`);
      comparisons += 11;

      for (const frameId of frameIds) {
        assert.equal(
          index.sameFrameAfter(i, frameId),
          referenceSameFrame(trace, i, frameId),
          `${where}: sameFrameAfter ${frameId}`,
        );
        assert.equal(
          index.previousLineInFrame(i, frameId),
          referencePreviousLineInFrame(trace, i, frameId),
          `${where}: previousLineInFrame ${frameId}`,
        );
        comparisons += 2;
        frames += 1;
      }
      // A few real prior lines are enough to prove the lookup; checking every
      // prior line at every step would make the reference itself cubic.
      const priorLines = trace
        .slice(0, i)
        .filter((event) => event.event === "line")
        .slice(-3);
      for (const event of priorLines) {
        assert.equal(
          index.seenBefore(i, event.line, event.frame_id),
          referenceSeen(trace, i, event.line, event.frame_id),
          `${where}: seenBefore ${event.line}`,
        );
        comparisons += 1;
      }
    }
  }

  assert.ok(steps > 1200, `${steps} steps`);
  assert.ok(frames > 1000, `${frames} frame lookups`);
  assert.ok(comparisons > 10000, `${comparisons} comparisons`);
});

function referenceInputs(trace) {
  const entries = [];
  for (let i = 0; i < trace.length; i += 1) {
    if (trace[i]?.event !== "input") continue;
    const text = referenceOutputAt(trace, i);
    const at = text.lastIndexOf("\n");
    entries.push({
      index: i,
      value: trace[i].text ?? "",
      prompt: at < 0 ? text : text.slice(at + 1),
      line: trace[i].line ?? null,
    });
  }
  return entries;
}

function referenceExceptions(trace) {
  const entries = [];
  for (let i = 0; i < trace.length; i += 1) {
    const event = trace[i];
    if (event?.event === "exception") {
      entries.push({
        index: i,
        event: "exception",
        type: event.exception?.type ?? "Exception",
        message: event.exception?.message ?? "",
        line: event.line ?? null,
        function: event.function ?? null,
        outcome: referenceOutcome(trace, i),
      });
    } else if (event?.event === "error") {
      entries.push({
        index: i,
        event: "error",
        type: event.type ?? "Error",
        message: event.message ?? "",
        line: event.line ?? null,
        function: null,
        outcome: "uncaught",
      });
    }
  }
  return entries;
}
