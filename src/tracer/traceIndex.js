// Per-trace lookup tables for the questions every panel asks about one step.
//
// The trace is immutable once a run finishes (docs/trace-format.md), so the
// tables are built once and reused for every playback position. The cache is a
// WeakMap keyed by the trace array: a new run is a new array and gets a new
// index, with no manual invalidation to forget.
//
// Nothing here materialises a StepView. The index stores positions (and the
// output chunks' text) so memory grows with the trace, not with every possible
// selected frame.

const EMPTY_TRACE = [];

function topFrameOf(event) {
  const frames = event?.frames;
  return frames && frames.length > 0 ? frames[frames.length - 1] : null;
}

function isInteger(value) {
  return Number.isInteger(value);
}

/** First position whose value is > `value` in a sorted array. */
function upperBound(list, value) {
  let low = 0;
  let high = list.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (list[mid] <= value) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** First position whose value is >= `value` in a sorted array. */
function lowerBound(list, value) {
  let low = 0;
  let high = list.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (list[mid] < value) low = mid + 1;
    else high = mid;
  }
  return low;
}

function push(map, key, index) {
  const list = map.get(key);
  if (list) list.push(index);
  else map.set(key, [index]);
}

function createIndex(trace) {
  const list = Array.isArray(trace) ? trace : EMPTY_TRACE;
  const length = list.length;

  const stateIndices = [];
  const lineIndices = [];
  const lineStateIndices = [];
  const anchorIndices = []; // line / call / return / unwind
  const controlIndices = []; // the above, plus exception
  const printStopIndices = []; // line / call / return
  const outputIndices = [];
  const outputTexts = [];
  const inputIndices = [];
  const exceptionIndices = [];
  const errorIndices = [];

  const frameTop = new Map();
  const frameLine = new Map();
  const frameAnchor = new Map();
  const seenLine = new Map();
  const framesById = new Map();
  const linesByName = new Map();

  let lastState = -1;
  for (let i = 0; i < length; i += 1) {
    const event = list[i];
    if (!event) continue;

    if (event.frames) {
      lastState = i;
      stateIndices.push(i);
      const top = topFrameOf(event);
      if (top) {
        push(frameTop, top.frame_id, i);
        let info = framesById.get(top.frame_id);
        if (!info) {
          const stack = event.frames;
          info = {
            frameId: top.frame_id,
            function: top.function ?? "<module>",
            callLine: top.call_line ?? null,
            depth: Math.max(stack.length - 1, 0),
            parentId:
              stack.length > 1 ? stack[stack.length - 2].frame_id ?? null : null,
            firstIndex: i,
            firstTopIndex: i,
            lastTopIndex: i,
            returnIndex: null,
            returnText: null,
            unwindIndex: null,
          };
          framesById.set(top.frame_id, info);
        }
        info.lastTopIndex = i;
        if (event.event === "return" && top.frame_id === event.frame_id) {
          if (info.returnIndex === null) {
            info.returnIndex = i;
            info.returnText = event.return_value ?? null;
          }
        }
        if (event.event === "unwind" && top.frame_id === event.frame_id && info.unwindIndex === null) {
          info.unwindIndex = i;
        }
      }
    }

    if (event.event === "line") {
      lineIndices.push(i);
      if (event.frames) lineStateIndices.push(i);
      push(linesByName, event.line, i);
      if (event.frame_id != null) {
        push(frameLine, event.frame_id, i);
        const key = `${event.frame_id}\u0000${event.line}`;
        if (!seenLine.has(key)) seenLine.set(key, i);
      }
    }
    if (event.event === "line" || event.event === "call" || event.event === "return" || event.event === "unwind") {
      anchorIndices.push(i);
      if (event.frame_id != null) push(frameAnchor, event.frame_id, i);
    }
    if (event.event === "line" || event.event === "call" || event.event === "return" || event.event === "unwind" || event.event === "exception") {
      controlIndices.push(i);
    }
    if (event.event === "line" || event.event === "call" || event.event === "return") {
      printStopIndices.push(i);
    }
    if (event.event === "output") {
      outputIndices.push(i);
      outputTexts.push(event.text ?? "");
    }
    if (event.event === "input") inputIndices.push(i);
    if (event.event === "exception") exceptionIndices.push(i);
    if (event.event === "error") errorIndices.push(i);
  }

  // Map every step to its nearest state-carrying event at or before it. State
  // cover is usually every step, but output/input/limit events are not.
  const stateAt = new Int32Array(length);
  lastState = -1;
  for (let i = 0; i < length; i += 1) {
    if (list[i]?.frames) lastState = i;
    stateAt[i] = lastState;
  }

  let inputsCache = null;
  let exceptionsCache = null;

  function state(index) {
    const at = Math.min(Number(index), length - 1);
    if (!isInteger(at) || at < 0) return null;
    const found = stateAt[at];
    return found >= 0 ? list[found] : null;
  }

  function nextState(index) {
    const at = Number(index);
    if (!isInteger(at)) return null;
    const pos = upperBound(stateIndices, at);
    return pos < stateIndices.length ? list[stateIndices[pos]] : null;
  }

  function firstAfter(mapList, index) {
    if (!mapList) return -1;
    const pos = upperBound(mapList, index);
    return pos < mapList.length ? mapList[pos] : -1;
  }

  function lastBefore(mapList, index) {
    if (!mapList) return -1;
    const pos = lowerBound(mapList, index) - 1;
    return pos >= 0 ? mapList[pos] : -1;
  }

  function sameFrameAfter(index, frameId) {
    const at = Number(index);
    if (!isInteger(at)) return null;
    const found = firstAfter(frameTop.get(frameId), at);
    return found >= 0 ? list[found] : null;
  }

  function previousLineNumber(index) {
    const at = Number(index);
    if (!isInteger(at)) return null;
    const found = lastBefore(lineIndices, at);
    return found >= 0 ? list[found].line : null;
  }

  function previousLineInFrame(index, frameId) {
    const at = Number(index);
    if (!isInteger(at)) return null;
    const found = lastBefore(frameLine.get(frameId), at);
    return found >= 0 ? list[found].line : null;
  }

  function nextLineEvent(index) {
    const at = Number(index);
    if (!isInteger(at)) return null;
    const pos = upperBound(lineStateIndices, at);
    return pos < lineStateIndices.length ? list[lineStateIndices[pos]] : null;
  }

  function previousAnchorIndex(index) {
    return lastBefore(anchorIndices, Number(index));
  }

  function previousAnchorInFrame(index, frameId) {
    return lastBefore(frameAnchor.get(frameId), Number(index));
  }

  function nextControlIndex(index) {
    return firstAfter(controlIndices, Number(index));
  }

  function nextPrintStop(index) {
    return firstAfter(printStopIndices, Number(index));
  }

  function seenBefore(index, line, frameId) {
    if (!isInteger(Number(index))) return false;
    const at = seenLine.get(`${frameId}\u0000${line}`);
    return at != null && at < index;
  }

  function printedAfter(index) {
    let out = "";
    const stop = nextControlIndex(index);
    const end = stop >= 0 ? stop : length;
    for (let i = index + 1; i < end; i += 1) {
      if (list[i]?.event === "output") out += list[i].text ?? "";
    }
    return out.replace(/\n$/, "");
  }

  /** Everything printed after `index`, before control reaches a line/call/return. */
  function printedRawAfter(index) {
    let out = "";
    const stop = nextPrintStop(index);
    const end = stop >= 0 ? stop : length;
    for (let i = index + 1; i < end; i += 1) {
      if (list[i]?.event === "output") out += list[i].text ?? "";
    }
    return out;
  }

  function printedTextAfter(index) {
    return printedRawAfter(index).replace(/\n$/, "");
  }

  /**
   * The printed line a single output chunk belongs to, using only the chunks
   * written so far. print() writes text and its newline as separate chunks, so
   * the newline chunk is the end of the previous line, not a blank one; only a
   * line with no text before its newline (print("")) is really blank.
   * @returns {{ text: string, blank: boolean } | null}
   */
  function printedLineAt(index) {
    const event = list[index];
    if (!event || event.event !== "output") return null;
    let start = index;
    while (start > 0 && list[start - 1]?.event === "output") start -= 1;
    let before = "";
    for (let i = start; i < index; i += 1) before += list[i].text ?? "";
    const chunk = String(event.text ?? "");
    if (/[^\n]/.test(chunk)) {
      const at = before.lastIndexOf("\n");
      const text = (at >= 0 ? before.slice(at + 1) : before) + chunk.replace(/\n+$/, "");
      return { text, blank: text.length === 0 };
    }
    const at = before.lastIndexOf("\n");
    const text = at >= 0 ? before.slice(at + 1) : before;
    return { text, blank: text.length === 0 };
  }

  function outputCount(index) {
    return upperBound(outputIndices, index);
  }

  function outputAt(index) {
    const last = Math.min(Math.max(Number(index) || 0, 0), length - 1);
    let out = "";
    const count = outputCount(last);
    for (let i = 0; i < count; i += 1) out += outputTexts[i];
    return out;
  }

  function outputSegments(from, to) {
    const start = Math.max(Number(from) || 0, 0);
    const end = Math.min(Number.isFinite(Number(to)) ? Number(to) : length - 1, length - 1);
    const segments = [];
    if (!isInteger(start)) return segments;
    const first = lowerBound(outputIndices, start);
    let open = null;
    for (let p = first; p < outputIndices.length; p += 1) {
      const i = outputIndices[p];
      if (i > end) break;
      const event = list[i];
      const continues =
        open && i > start && (list[i - 1]?.event === "output" || list[i - 1]?.event === "input");
      if (!continues) {
        open = { at: i, line: event.line ?? null, text: "", events: [] };
        segments.push(open);
      }
      open.text += event.text ?? "";
      open.events.push(i);
    }
    return segments;
  }

  function firstLineIndex(line, from = 0) {
    return firstAfter(linesByName.get(line), Number(from) - 1);
  }

  function firstCallIndex(frameId) {
    return framesById.get(frameId)?.firstTopIndex ?? -1;
  }

  function exceptionOutcome(index) {
    const event = list[index];
    if (!event || event.event !== "exception") return "raised";
    let unwound = false;
    for (let i = index + 1; i < length; i += 1) {
      const next = list[i];
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

  function inputs() {
    if (inputsCache) return inputsCache;
    inputsCache = inputIndices.map((index) => ({
      index,
      value: list[index].text ?? "",
      prompt: promptOf(outputAt(index)),
      line: list[index].line ?? null,
    }));
    return inputsCache;
  }

  function exceptions() {
    if (exceptionsCache) return exceptionsCache;
    const entries = [];
    for (const index of exceptionIndices) {
      const event = list[index];
      entries.push({
        index,
        event: "exception",
        type: event.exception?.type ?? "Exception",
        message: event.exception?.message ?? "",
        line: event.line ?? null,
        function: event.function ?? null,
        outcome: exceptionOutcome(index),
      });
    }
    for (const index of errorIndices) {
      const event = list[index];
      entries.push({
        index,
        event: "error",
        type: event.type ?? "Error",
        message: event.message ?? "",
        line: event.line ?? null,
        function: null,
        outcome: "uncaught",
      });
    }
    entries.sort((a, b) => a.index - b.index);
    exceptionsCache = entries;
    return entries;
  }

  return {
    trace: list,
    length,
    stateAt: state,
    nextState,
    sameFrameAfter,
    previousLineNumber,
    previousLineInFrame,
    nextLineEvent,
    previousAnchorIndex,
    previousAnchorInFrame,
    nextControlIndex,
    printedAfter,
    printedTextAfter,
    printedRawAfter,
    printedLineAt,
    seenBefore,
    outputAt,
    outputSegments,
    outputIndices,
    firstLineIndex,
    firstCallIndex,
    exceptionOutcome,
    inputs,
    exceptions,
    errorIndex: () => (errorIndices.length > 0 ? errorIndices[0] : -1),
    frame: (frameId) => framesById.get(frameId) ?? null,
    frames: framesById,
    lines: linesByName,
  };
}

function promptOf(text) {
  const value = String(text ?? "");
  const at = value.lastIndexOf("\n");
  return at < 0 ? value : value.slice(at + 1);
}

const CACHE = new WeakMap();
const EMPTY_INDEX = createIndex([]);

/** Build a fresh index; exposed for tests and for callers that want ownership. */
export function buildTraceIndex(trace) {
  return createIndex(trace);
}

/** The shared index for a trace array. A new run's array gets a new index. */
export function getTraceIndex(trace) {
  if (!Array.isArray(trace)) return EMPTY_INDEX;
  let index = CACHE.get(trace);
  if (!index) {
    index = createIndex(trace);
    CACHE.set(trace, index);
  }
  return index;
}
