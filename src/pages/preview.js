// Builds the homepage's live-preview frames from a REAL recorded trace.
//
// Nothing here invents a value: every frame is derived by getStepView, the
// same function the visualizer's panels read, so the preview cannot show
// anything the execution graph and inspector would not show for the same
// step. Pure (no React, no worker), so node --test can prove it against the
// vendored corpus trace in preview.test.mjs.
//
//   buildPreviewFrames(source, trace) -> frame[]
//
// A frame is:
//   { index, line, code, changes, values, callStack, output }
// where `output` is everything the program had printed by that step.

import { getStepView } from "../tracer/stepView.js";

/** Trace events without a real source line are bookkeeping (the implicit
 *  `call <module>` at line 0); the preview skips those, exactly like the
 *  graph treats them. Documented so the drop is a decision, not an accident. */
function hasSourceLine(event) {
  return Number.isInteger(event?.line) && event.line > 0;
}

/** Everything printed by the program at or before `index`. */
function outputThrough(trace, index) {
  let out = "";
  for (let i = 0; i <= index; i += 1) {
    if (trace[i]?.event === "output") out += trace[i].text ?? "";
  }
  return out.replace(/\n$/, "");
}

/**
 * One frame per trace event that points at a real line of `source`.
 * Returns the frames in trace order; `frame.index` is the trace index so a
 * frame stays tied to the exact event it came from.
 */
export function buildPreviewFrames(source, trace) {
  if (!source || trace.length === 0) return [];
  const lines = new Set(source.split("\n").map((_, i) => i + 1));
  const frames = [];
  for (let i = 0; i < trace.length; i += 1) {
    const event = trace[i];
    if (!hasSourceLine(event)) continue;
    const view = getStepView(trace, i, source);
    if (!view.code || !lines.has(event.line)) continue;
    frames.push({
      index: i,
      line: event.line,
      code: view.code,
      changes: view.changes ?? [],
      values: view.values ?? {},
      callStack: view.callStack ?? [],
      output: outputThrough(trace, i),
    });
  }
  return frames;
}

/** The index of the next frame in a looping preview: `total` wraps to 0. */
export function nextFrameIndex(current, total) {
  if (total <= 0) return 0;
  return (current + 1) % total;
}

/** The index of the previous frame in a looping preview. */
export function previousFrameIndex(current, total) {
  if (total <= 0) return 0;
  return (current - 1 + total) % total;
}

/**
 * Splits a code line into segments, marking the identifiers that currently
 * hold a value in the trace. The preview colours those, so what glows in the
 * hero is exactly what the trace says exists right now - never a name the
 * highlighter guessed. Concatenating `segment.text` rebuilds the line.
 *
 *   markedLine("result = greet('Asha')", { result: "'Asha'" })
 *   -> [{ text: "result", name: "result" }, { text: " = ", name: null }, ...]
 */
export function markedLine(text, values = {}) {
  const segments = [];
  if (!text) return segments;
  const pattern = /[A-Za-z_]\w*/g;
  let last = 0;
  let match = pattern.exec(text);
  while (match !== null) {
    if (match.index > last) segments.push({ text: text.slice(last, match.index), name: null });
    const name = match[0];
    segments.push({ text: name, name: name in values ? name : null });
    last = match.index + name.length;
    match = pattern.exec(text);
  }
  if (last < text.length) segments.push({ text: text.slice(last), name: null });
  return segments;
}
