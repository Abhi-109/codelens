// A plain-English map of what one run did, derived only from its trace.
//
// The canvas answers "what is true at this step". A beginner also needs the
// answer to "what is this program doing at all" — which lines repeat, how many
// times, with what values, and what comes out. Watching forty snapshots is
// supposed to produce that answer; for a beginner it usually does not, because
// a loop's rule is invisible in any single frame.
//
// So this module reads the same trace the visualizer replays and writes the
// story down: a handful of sections, each one sentence, each pointing at the
// step where it happens. Every number is counted from the trace — rounds are
// body executions, values are the values the trace recorded — never inferred
// from the source text or from a recognised pattern. A construct this module
// cannot describe honestly is left out, not guessed at.
//
// Pure: no React, no trace mutation, deterministic output.

import { explainStep } from "./explain.js";
import { changeLog } from "./stepView.js";
import { showValue } from "./values.js";

export const RUN_STORY_VERSION = 1;
export const RUN_STORY_KIND = "run_story";

const MODULE = "<module>";
const DEFINED_TYPES = new Set(["function", "class", "module"]);
const MAX_SECTIONS = 8;
const MAX_LIST = 6;

function isPlainName(name) {
  return typeof name === "string" && /^[A-Za-z_]\w*$/.test(name);
}

function topFrame(event) {
  const frames = event?.frames;
  return Array.isArray(frames) && frames.length > 0 ? frames[frames.length - 1] : null;
}

/** `1, 2, 3` — with a real ellipsis when the list is longer than we show. */
function listText(values) {
  if (!Array.isArray(values) || values.length === 0) return "";
  if (values.length <= MAX_LIST) return values.join(", ");
  return `${values.slice(0, 4).join(", ")}, … ${values[values.length - 1]}`;
}

/** `0 → 1 → 3 → … → 15` — the chain form used in the sentence and the card. */
function chainText(values) {
  if (!Array.isArray(values) || values.length === 0) return "";
  if (values.length <= MAX_LIST + 1) return values.join(" → ");
  return `${values.slice(0, 3).join(" → ")} → … → ${values[values.length - 1]}`;
}

function numericText(text) {
  if (typeof text !== "string" || text.trim() === "") return null;
  const number = Number(text.replace(/,/g, ""));
  return Number.isFinite(number) ? number : null;
}

/** A growth verb that is true for the recorded ends; neutral otherwise. */
function trendWord(values) {
  const first = numericText(values[0]);
  const last = numericText(values[values.length - 1]);
  if (first === null || last === null || first === last) return "changes";
  return last > first ? "grows" : "shrinks";
}

function lineRangeLabel(min, max) {
  if (min === null) return "This part";
  return min === max ? `Line ${min}` : `Lines ${min}–${max}`;
}

function textRange(min, max) {
  if (min === null) return "the statements here";
  return min === max ? `line ${min}` : `lines ${min}–${max}`;
}

/** The value of one local at one state-carrying step, ready to print. */
function variableAt(trace, step, name) {
  const event = trace[step];
  const frame = topFrame(event);
  const value = frame?.variables?.[name];
  if (value === undefined) return null;
  return { value, text: showValue(value, event.heap ?? {}) };
}

/**
 * Every frame in the run, with the line events that belong to it and the
 * variables it received. The module frame is included; it has no call line.
 */
function framesOf(trace) {
  const byId = new Map();
  const order = [];
  for (let i = 0; i < trace.length; i += 1) {
    const event = trace[i];
    if (event?.event !== "line") continue;
    const top = topFrame(event);
    if (!top || typeof top.frame_id !== "number") continue;
    let frame = byId.get(top.frame_id);
    if (!frame) {
      const stack = Array.isArray(event.frames) ? event.frames : [];
      frame = {
        frameId: top.frame_id,
        function: typeof top.function === "string" ? top.function : MODULE,
        callLine: top.call_line ?? null,
        callStep: null,
        returnStep: null,
        returnText: null,
        depth: Math.max(stack.length - 1, 0),
        parentFunction:
          stack.length > 1 ? stack[stack.length - 2]?.function ?? null : null,
        steps: [],
        lines: [],
        args: [],
        selfClass: null,
      };
      byId.set(top.frame_id, frame);
      order.push(frame);
    }
    frame.steps.push(i);
    frame.lines.push(typeof event.line === "number" ? event.line : null);
    if (frame.callStep === null && event.event === "line" && frame.depth >= 0) {
      // The first state of a frame is its arguments; locals appear later.
      const variables = top.variables ?? {};
      frame.args = Object.entries(variables)
        .filter(([name, value]) => name !== "self" && !DEFINED_TYPES.has(value?.type))
        .map(([name, value]) => ({ name, text: showValue(value, event.heap ?? {}) }));
      // The object's own class in the heap says which class `self` belongs to.
      // It is the only honest way to name the class a constructor call made.
      const self = variables.self;
      if (self?.type === "ref") {
        frame.selfClass = event.heap?.[self.id]?.class ?? null;
      }
    }
  }

  for (let i = 0; i < trace.length; i += 1) {
    const event = trace[i];
    if (!event || typeof event.frame_id !== "number") continue;
    const frame = byId.get(event.frame_id);
    if (!frame) continue;
    if (event.event === "call" && frame.callStep === null) {
      frame.callStep = i;
      frame.callLine = topFrame(event)?.call_line ?? frame.callLine;
    }
    if (event.event === "return" && frame.returnStep === null) {
      frame.returnStep = i;
      frame.returnText = event.return_value
        ? showValue(event.return_value, event.heap ?? {})
        : null;
    }
  }
  return order;
}

/** Positions of every line that appears more than once, in visit order. */
function repeatedLines(frame) {
  const positions = new Map();
  frame.lines.forEach((line, index) => {
    if (typeof line !== "number" || line <= 0) return;
    const list = positions.get(line);
    if (list) list.push(index);
    else positions.set(line, [index]);
  });
  return [...positions.entries()]
    .filter(([, list]) => list.length >= 2)
    .map(([line, list]) => ({ line, list }))
    .sort((a, b) => a.list[0] - b.list[0]);
}

/**
 * One loop: its header line, the body lines between visits, and how many times
 * the body actually ran. `rounds` counts body executions, never line visits, so
 * a for loop's final exhausted check is not counted as a round.
 */
function describeLoop(trace, frame, line, positions) {
  const body = new Set();
  for (let k = 0; k < positions.length - 1; k += 1) {
    for (let p = positions[k] + 1; p < positions[k + 1]; p += 1) {
      const bodyLine = frame.lines[p];
      if (typeof bodyLine === "number" && bodyLine !== line) body.add(bodyLine);
    }
  }
  const singleLine = body.size === 0;
  const starts = [];
  const ends = [];

  if (singleLine) {
    // The header and the body share one line, so the next line cannot say
    // whether the body ran. Ask what the step did: a change, output, a call or
    // an exception after it is work. The exhausted check does none of those.
    for (let k = 0; k < positions.length; k += 1) {
      const at = positions[k];
      const from = frame.steps[at];
      const to = k + 1 < positions.length ? frame.steps[positions[k + 1]] : null;
      if (stepDidWork(trace, frame, from, to)) {
        starts.push(at);
        ends.push(at);
      }
    }
  } else {
    for (let k = 0; k < positions.length; k += 1) {
      const at = positions[k];
      const next = frame.lines[at + 1];
      if (typeof next === "number" && body.has(next)) {
        starts.push(at);
        const nextVisit = positions[k + 1];
        ends.push(nextVisit === undefined ? lastBodyRun(frame, at + 1, body) : nextVisit - 1);
      }
    }
  }

  if (starts.length === 0) return null;
  const bodyLines = [...body].filter((value) => typeof value === "number");
  const minBody = bodyLines.length > 0 ? Math.min(...bodyLines) : line;
  const maxBody = bodyLines.length > 0 ? Math.max(...bodyLines) : line;
  return {
    line,
    bodyLines,
    singleLine,
    rounds: starts.length,
    starts,
    ends,
    fromPos: starts[0],
    toPos: ends[ends.length - 1],
    minBody,
    maxBody,
  };
}

/** The last position of a run of body lines beginning at `from`. */
function lastBodyRun(frame, from, body) {
  let end = from;
  while (end + 1 < frame.lines.length && body.has(frame.lines[end + 1])) end += 1;
  return end;
}

/**
 * Did one visit to a single-line loop run its body? The header and the body
 * share a line, so the next line event cannot say. The state at the next line
 * event is the state after this line ran: a change means the body did
 * something. Output, input, a call or an exception counts too. A for loop's
 * final exhausted check changes nothing, so it is not a round.
 */
function stepDidWork(trace, frame, fromStep, toStep) {
  if (toStep === null) return false;
  for (let i = fromStep + 1; i <= toStep && i < trace.length; i += 1) {
    const event = trace[i];
    if (event?.event === "output" || event?.event === "input" || event?.event === "call" || event?.event === "exception") {
      return true;
    }
    const top = topFrame(event);
    if (top && top.frame_id === frame.frameId) {
      const before = JSON.stringify(topFrame(trace[fromStep])?.variables ?? {});
      if (JSON.stringify(top.variables ?? {}) !== before) return true;
      break;
    }
  }
  return false;
}

/** True when the source line is a loop header, not just a line that repeated. */
function isLoopHeader(source, line) {
  const text = String(source ?? "").split("\n")[line - 1] ?? "";
  const trimmed = text.trim();
  if (/^(async\s+)?(for|while)\b/.test(trimmed)) return true;
  // A comprehension is a loop written on one line.
  return /\bfor\s+[A-Za-z_]\w*\s+in\b/.test(trimmed);
}

/** Top-level (non-nested) loops in one frame, in execution order. */
function detectLoops(source, trace, frame) {
  const loops = [];
  let cursor = 0;
  for (const candidate of repeatedLines(frame)) {
    if (candidate.list[0] < cursor) continue; // nested inside the previous loop
    // Repeated lines are not loops. A decorator pair or a class body can repeat
    // a line too, so the claim needs the source to agree.
    if (!isLoopHeader(source, candidate.line)) continue;
    const loop = describeLoop(trace, frame, candidate.line, candidate.list);
    if (!loop) continue;
    loops.push(loop);
    cursor = loop.toPos + 1;
  }
  return loops;
}

/** Plain-name changes inside one frame's round, keyed by the name that changed. */
function changesInRound(changes, frame, fromPos, toPos) {
  const fromStep = frame.steps[fromPos];
  const toStep = frame.steps[toPos];
  return changes.filter(
    (change) =>
      isPlainName(change.name) &&
      change.index >= fromStep &&
      change.index <= toStep,
  );
}

/** Names whose every recorded change happened on the loop's own header line. */
function loopVariables(changes, frame, loop) {
  const byName = new Map();
  for (const change of changes) {
    if (!isPlainName(change.name)) continue;
    if (change.index < frame.steps[loop.fromPos] || change.index > frame.steps[loop.toPos]) {
      continue;
    }
    const entry = byName.get(change.name) ?? { count: 0, bodyChanges: 0 };
    entry.count += 1;
    if (change.line !== loop.line) entry.bodyChanges += 1;
    byName.set(change.name, entry);
  }
  return [...byName.entries()]
    .filter(([, entry]) => entry.bodyChanges === 0)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([name]) => name);
}

/**
 * The body value worth following: the name that changed in the most rounds and
 * took the most new values. A name that resets each round (a nested counter)
 * repeats values, so an accumulator that keeps growing wins.
 */
function accumulatorName(trace, changes, frame, loop, excluded) {
  const byName = new Map();
  for (const change of changes) {
    if (!isPlainName(change.name) || change.name === excluded) continue;
    if (change.line === loop.line) continue;
    if (change.index < frame.steps[loop.fromPos] || change.index > frame.steps[loop.toPos]) {
      continue;
    }
    const entry = byName.get(change.name) ?? { rounds: new Set(), values: new Set() };
    if (change.to !== null) entry.values.add(change.to);
    entry.rounds.add(change.index);
    byName.set(change.name, entry);
  }
  const ranked = [...byName.entries()]
    .map(([name, entry]) => ({ name, distinct: entry.values.size, rounds: entry.rounds.size }))
    .sort((a, b) => b.distinct - a.distinct || b.rounds - a.rounds || a.name.localeCompare(b.name));
  if (ranked.length === 0) return null;
  // Prefer a name that reads as one value over a container, which would make
  // the chain a wall of brackets.
  const scalar = ranked.find((entry) => {
    const first = variableAt(trace, frame.steps[loop.starts[0]], entry.name);
    return first === null || !/^[[{]/.test(first.text);
  });
  return (scalar ?? ranked[0]).name;
}

function valueChain(trace, frame, loop, name) {
  if (!name) return null;
  const first = variableAt(trace, frame.steps[loop.starts[0]], name);
  if (!first) return null;
  const values = [first.text];
  const changes = changeLog(trace);
  for (let k = 0; k < loop.starts.length; k += 1) {
    const inRound = changesInRound(changes, frame, loop.starts[k], loop.ends[k]).filter(
      (change) => change.name === name,
    );
    const last = inRound[inRound.length - 1];
    if (last && last.to !== null && last.to !== values[values.length - 1]) {
      values.push(last.to);
    }
  }
  return values.length > 1 ? { name, values, text: chainText(values) } : null;
}

/**
 * A one-line loop has no separate body state, so the value the loop variable
 * took is the set of values it held inside the loop. Only used when that count
 * matches the round count, which is the only case where the two agree.
 */
function singleLineSeries(trace, frame, loop, name) {
  if (!name) return null;
  const values = [];
  for (let position = loop.fromPos; position <= loop.toPos; position += 1) {
    const at = variableAt(trace, frame.steps[position], name);
    if (at === null || values.includes(at.text)) continue;
    values.push(at.text);
  }
  return values.length === loop.rounds
    ? { name, values, text: listText(values) }
    : null;
}

/**
 * The loop variable's value in each round, read at the round's body rather than
 * at the header: a for loop assigns the variable before its first body line
 * runs, so the header state still belongs to the previous round.
 */
function valueSeries(trace, frame, loop, name) {
  if (!name) return null;
  const values = [];
  for (const end of loop.ends) {
    const at = variableAt(trace, frame.steps[end], name);
    if (at === null) continue;
    if (at.text !== values[values.length - 1]) values.push(at.text);
  }
  return values.length > 1 ? { name, values, text: listText(values) } : null;
}

function outputBetween(trace, fromStep, toStep) {
  let text = "";
  for (let i = fromStep; i <= toStep && i < trace.length; i += 1) {
    if (trace[i]?.event === "output" && typeof trace[i].text === "string") {
      text += trace[i].text;
    }
  }
  return text;
}

/** One sentence naming what a setup line did, using the tested explanation. */
function stepSentence(trace, index, source) {
  const event = trace[index];
  const line = event?.line ?? null;
  const explanation = explainStep(trace, index, source);
  const text = typeof explanation?.text === "string" ? explanation.text.trim() : "";
  if (text === "") return null;
  return line === null ? text : `Line ${line}: ${text}`;
}

/** The printed text as one short line, for a section chip. */
function printedSummary(output) {
  const lines = String(output ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (lines.length === 0) return "";
  const text = listText(lines);
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}

/** The classes a program defines, so a constructor call can be named honestly. */
function classNamesOf(source) {
  const names = new Set();
  for (const match of String(source ?? "").matchAll(/^\s*class\s+([A-Za-z_]\w*)/gm)) {
    names.add(match[1]);
  }
  return names;
}

/** `__init__` and friends are the inside of a call, not a separate story. */
function isDunder(name) {
  return /^__\w+__$/.test(name);
}

function helperText(frame) {
  return frame.function === MODULE ? "" : `inside \`${frame.function}\``;
}

/** One repeat section: the section a beginner needs most. */
function repeatSection(trace, frame, loop, changes) {
  const loopVar = loopVariables(changes, frame, loop)[0] ?? null;
  const accumulator = accumulatorName(trace, changes, frame, loop, loopVar);
  const values = loop.singleLine
    ? singleLineSeries(trace, frame, loop, loopVar)
    : valueSeries(trace, frame, loop, loopVar);
  const chain = valueChain(trace, frame, loop, accumulator);
  const loopMin = Math.min(loop.line, loop.minBody);
  const loopMax = Math.max(loop.line, loop.maxBody);
  const subject = textRange(loopMin, loopMax);
  const rounds = loop.rounds;
  const times = rounds === 1 ? "once" : `${rounds} times`;
  const verb = loopMin === loopMax ? "runs" : "run";

  let text = helperText(frame) === ""
    ? `${capitalize(subject)} ${verb} ${times}.`
    : `Inside \`${frame.function}\`, ${subject} ${verb} ${times}.`;

  if (values) {
    text += ` \`${values.name}\` takes ${listText(values.values)} — one value each round.`;
  }
  if (chain) {
    text += ` \`${chain.name}\` ${trendWord(chain.values)} ${chain.text}.`;
  }
  if (!values && !chain) {
    text += " The same statements run in the same order each round.";
  }

  const id = `repeat-${frame.frameId}-${loop.line}`;
  return {
    id,
    kind: "repeat",
    label: lineRangeLabel(loopMin, loopMax),
    title: rounds === 1 ? "Runs once" : `Repeats ${rounds} times`,
    text,
    frame: frame.function,
    jump: frame.steps[loop.starts[0]],
    from: frame.steps[loop.fromPos],
    to: frame.steps[loop.toPos],
    line: loop.line,
    rounds,
    // One jump per round, so the card can move a round at a time instead of
    // asking for a click per line.
    roundJumps: loop.starts.map((position) => frame.steps[position]),
    chain,
    values,
  };
}

function capitalize(text) {
  return text.length === 0 ? text : text[0].toUpperCase() + text.slice(1);
}

function argsText(args) {
  const named = (args ?? []).filter((arg) => isPlainName(arg.name));
  return named.map((arg) => `\`${arg.name}\` = ${arg.text}`).join(", ");
}

/** The object-creation section for one class, built from its `__init__` calls. */
function creationSection(trace, name, inits) {
  const first = inits[0];
  const before = trace
    .slice(0, first.callStep)
    .map((event, index) => ({ event, index }))
    .reverse()
    .find(({ event }) => event?.event === "line" && event.frame_id === 1);
  const line = first.callLine ?? before?.event?.line ?? null;
  const count = inits.length;
  // With more than one creation, a single example would imply every object got
  // the same values; show the argument that actually varies instead.
  const varying = count > 1
    ? first.args
        .map((arg) => {
          const seen = new Set(
            inits
              .map((frame) => frame.args.find((entry) => entry.name === arg.name)?.text)
              .filter((text) => typeof text === "string"),
          );
          return { name: arg.name, distinct: seen.size, values: [...seen] };
        })
        .filter((arg) => arg.distinct > 1)
        .sort((a, b) => b.distinct - a.distinct)[0]
    : null;
  const argText = varying
    ? `\`${varying.name}\` = ${listText(varying.values)}`
    : argsText(first.args);
  return {
    id: `create-${name}`,
    kind: "call",
    label: line === null ? name : `Line ${line}`,
    title:
      count === 1
        ? `Creates ${/[AEIOU]/.test(name[0]) ? "an" : "a"} \`${name}\``
        : `Creates ${count} \`${name}\` objects`,
    text:
      `${line === null ? "It" : `Line ${line}`} creates ${count === 1 ? "a" : count} \`${name}\` object${count === 1 ? "" : "s"}` +
      `${argText ? ` with ${argText}` : ""}.`,
    frame: MODULE,
    line,
    jump: before?.index ?? first.callStep,
    from: before?.index ?? first.callStep,
    to: first.returnStep ?? first.steps.slice(-1)[0],
  };
}

/** A call section: who was called, how often, with what, and what came back. */
function callSection(group, classNames) {
  const first = group[0];
  if (!first || first.callStep === null) return null;
  const name = first.function;
  const count = group.length;
  const argText = argsText(first.args);

  // The class body frame is not a call the learner made; `__init__` is the
  // inside of the creation, which gets its own section below.
  if (classNames.has(name)) return null;
  const recursive = group.some((frame) => frame.parentFunction === name);
  const returns = group
    .map((frame) => frame.returnText)
    .filter((text) => typeof text === "string" && text !== "");
  const distinctReturns = [...new Set(returns)];
  const returnOrder = [...group].sort(
    (a, b) => (a.returnStep ?? Number.MAX_SAFE_INTEGER) - (b.returnStep ?? Number.MAX_SAFE_INTEGER),
  );
  const orderedReturns = returnOrder
    .map((frame) => frame.returnText)
    .filter((text) => typeof text === "string" && text !== "");
  const callLines = [...new Set(group.map((frame) => frame.callLine).filter((value) => typeof value === "number"))];
  const oneLine = callLines.length === 1 ? callLines[0] : null;

  if (recursive) {
    const params = first.args.filter((arg) => isPlainName(arg.name));
    const series = params
      .map((param) => ({
        name: param.name,
        values: group
          .map((frame) => frame.args.find((arg) => arg.name === param.name)?.text)
          .filter((text) => typeof text === "string"),
      }))
      .map((entry) => ({ ...entry, distinct: new Set(entry.values).size }))
      .sort((a, b) => b.distinct - a.distinct)[0];
    const varying =
      series && series.distinct > 1
        ? `, with \`${series.name}\` = ${listText(series.values)}`
        : "";
    let text = `\`${name}\` is called ${count} times, each time one level deeper${varying}.`;
    if (distinctReturns.length > 1) {
      text += ` The answers come back up as ${chainText(orderedReturns)}.`;
    }
    return {
      id: `call-${name}`,
      kind: "call",
      label: oneLine === null ? "Recursion" : `Line ${oneLine}`,
      title: `Calls itself ${count} times`,
      text,
      frame: MODULE,
      jump: first.callStep,
      from: first.callStep,
      to: group[group.length - 1].returnStep ?? group[group.length - 1].steps.slice(-1)[0],
      line: first.callLine,
      ...(distinctReturns.length > 1
        ? { chain: { name: "returns", values: orderedReturns, text: chainText(orderedReturns) } }
        : {}),
    };
  }

  if (count === 1) {
    const returned = distinctReturns.length > 0 ? `, and it returns ${distinctReturns[0]}` : "";
    return {
      id: `call-${name}`,
      kind: "call",
      label: oneLine === null ? name : `Line ${oneLine}`,
      title: `Calls \`${name}\``,
      text: `${oneLine === null ? "It" : `Line ${oneLine}`} calls \`${name}\`${argText ? ` with ${argText}` : ""}${returned}.`,
      frame: MODULE,
      line: first.callLine,
      jump: first.callStep,
      from: first.callStep,
      to: first.returnStep ?? first.steps.slice(-1)[0],
    };
  }

  const varyingArg = first.args
    .map((arg) => {
      const seen = new Set(
        group
          .map((frame) => frame.args.find((entry) => entry.name === arg.name)?.text)
          .filter((text) => typeof text === "string"),
      );
      return { name: arg.name, distinct: seen.size, values: [...seen] };
    })
    .filter((arg) => arg.distinct > 1)
    .sort((a, b) => b.distinct - a.distinct)[0];

  const caller = oneLine === null ? "The program" : `Line ${oneLine}`;
  let text = `${caller} calls \`${name}\` ${count} times`;
  text += varyingArg ? `, with \`${varyingArg.name}\` = ${listText(varyingArg.values)}` : "";
  text += ".";
  if (distinctReturns.length > 1) {
    text += ` It returns ${listText(distinctReturns)} in turn.`;
  }
  return {
    id: `call-${name}`,
    kind: "call",
    label: oneLine === null ? name : `Line ${oneLine}`,
    title: `Calls \`${name}\` ${count} times`,
    text,
    frame: MODULE,
    line: first.callLine,
    jump: first.callStep,
    from: first.callStep,
    to: first.returnStep ?? first.steps.slice(-1)[0],
    ...(varyingArg ? { values: { name: varyingArg.name, values: varyingArg.values, text: listText(varyingArg.values) } } : {}),
  };
}

/** Sections for the straight-line case: no repeats, no calls to explain. */
function straightSection(trace, source, moduleFrame) {
  if (moduleFrame.steps.length === 0) return [];
  const sentences = [];
  const seen = new Set();
  for (const index of moduleFrame.steps) {
    const line = trace[index]?.line;
    if (seen.has(line)) continue; // a comprehension revisits one line per item
    seen.add(line);
    const sentence = stepSentence(trace, index, source);
    if (sentence) sentences.push(sentence);
    if (sentences.length >= 4) break;
  }
  // Printed text is recorded *after* the print line's event, so the window has
  // to reach the end of the trace, not just the last line event.
  const output = outputBetween(trace, moduleFrame.steps[0], trace.length - 1);
  const lines = moduleFrame.lines.filter((line) => typeof line === "number");
  return [
    {
      id: "run",
      kind: "run",
      label: lineRangeLabel(Math.min(...lines), Math.max(...lines)),
      title: "Straight through",
      text: sentences.length > 0 ? sentences.join(" ") : "This run takes a single pass through the code.",
      frame: MODULE,
      jump: moduleFrame.steps[0],
      from: moduleFrame.steps[0],
      to: moduleFrame.steps[moduleFrame.steps.length - 1],
      ...(output === "" ? {} : { output, outputSummary: printedSummary(output) }),
    },
  ];
}

/** The sentence for the run's ending: output, a result, or a real error. */
function finishSection(trace, source, moduleFrame, afterStep) {
  const remaining = moduleFrame.steps.filter((index) => index > afterStep);
  const sentences = [];
  const seen = new Set();
  for (const index of remaining) {
    const line = trace[index]?.line;
    if (seen.has(line)) continue;
    seen.add(line);
    const sentence = stepSentence(trace, index, source);
    if (sentence) sentences.push(sentence);
    if (sentences.length >= 3) break;
  }
  const output = remaining.length > 0 ? outputBetween(trace, remaining[0], trace.length - 1) : "";
  if (sentences.length === 0 && output === "") return null;
  const lines = remaining
    .map((index) => trace[index]?.line)
    .filter((line) => typeof line === "number");
  return {
    id: "finish",
    kind: "finish",
    label: lines.length > 0 ? lineRangeLabel(Math.min(...lines), Math.max(...lines)) : "The rest",
    title: output === "" ? "The end" : "The result",
    text: sentences.length > 0 ? sentences.join(" ") : "The program ends here.",
    frame: MODULE,
    jump: remaining.length > 0 ? remaining[0] : afterStep,
    from: remaining.length > 0 ? remaining[0] : afterStep,
    to: moduleFrame.steps[moduleFrame.steps.length - 1],
    ...(output === "" ? {} : { output, outputSummary: printedSummary(output) }),
  };
}

function errorSection(trace, source, lastEvent) {
  const line = lastEvent.line ?? null;
  const type = typeof lastEvent.type === "string" ? lastEvent.type : "Error";
  const message = typeof lastEvent.message === "string" ? lastEvent.message : "";
  const detail = message === "" ? type : `${type}: ${message}`;
  const label = line === null ? "The run" : `Line ${line}`;
  if (lastEvent.phase === "compile") {
    return {
      id: "error",
      kind: "error",
      label,
      title: "It never ran",
      text: `Python could not run this code at all: \`${detail}\`.`,
      frame: MODULE,
      jump: 0,
      from: 0,
      to: trace.length - 1,
    };
  }
  return {
    id: "error",
    kind: "error",
    label,
    title: type,
    text:
      line === null
        ? `The run stops with \`${detail}\`.`
        : `Line ${line} stops the run with \`${detail}\`.`,
    frame: MODULE,
    jump: Math.max(trace.length - 1, 0),
    from: Math.max(trace.length - 1, 0),
    to: trace.length - 1,
  };
}

function limitSection(trace, lastEvent) {
  const limit = lastEvent.event;
  const title =
    limit === "step_limit"
      ? "Stopped at the step limit"
      : limit === "timeout"
        ? "Stopped at the time limit"
        : "Stopped at the output limit";
  const message = typeof lastEvent.message === "string" && lastEvent.message !== ""
    ? lastEvent.message
    : "The run was stopped by a safety limit.";
  return {
    id: "limit",
    kind: "limit",
    label: "The run",
    title,
    text: `${message} The trace ends here, so anything after this point was not recorded.`,
    frame: MODULE,
    jump: Math.max(trace.length - 1, 0),
    from: Math.max(trace.length - 1, 0),
    to: trace.length - 1,
  };
}

/**
 * The whole story of one run.
 * @param {Array} trace the trace array from docs/trace-format.md
 * @param {string} source the submitted source, for the setup sentences
 * @returns {Object} a `run_story` with ordered sections and no invented facts
 */
export function buildRunStory(trace, source = "") {
  const list = Array.isArray(trace) ? trace : [];
  const steps = list.length;
  const story = {
    version: RUN_STORY_VERSION,
    kind: RUN_STORY_KIND,
    steps,
    sections: [],
    summary: "No steps were recorded.",
  };
  if (steps === 0) return story;

  const lastEvent = list[steps - 1];
  if (lastEvent?.event === "error" && lastEvent.phase === "compile") {
    story.sections = [errorSection(list, source, lastEvent)];
    story.summary = "Python could not run this code.";
    return story;
  }

  const frames = framesOf(list);
  const moduleFrame = frames.find((frame) => frame.function === MODULE) ?? null;
  const changes = changeLog(list);

  const sections = [];
  const classNames = classNamesOf(source);
  const callGroups = [];
  for (const frame of frames) {
    if (frame.function === MODULE || frame.callStep === null) continue;
    // Comprehension frames are the Python compiler's own helpers, not calls the
    // learner wrote, and a constructor's dunders are the inside of one call.
    if (frame.function.startsWith("<") || isDunder(frame.function)) continue;
    const group = callGroups.find((entry) => entry.function === frame.function);
    if (group) group.frames.push(frame);
    else callGroups.push({ function: frame.function, frames: [frame] });
  }
  // An object is created by the `__init__` call; `self` in that frame names the
  // class the object was made from, so a subclass is never reported as its base.
  const creations = new Map();
  for (const frame of frames) {
    if (frame.function !== "__init__" || frame.callStep === null) continue;
    const name = frame.selfClass;
    if (!name || !classNames.has(name)) continue;
    const group = creations.get(name) ?? [];
    group.push(frame);
    creations.set(name, group);
  }
  for (const [name, inits] of creations) {
    sections.push(creationSection(list, name, inits));
  }

  for (const group of callGroups) {
    // A function called many times has one call section; the repeats inside it
    // belong to that call and would otherwise be repeated once per call.
    const section = callSection(group.frames, classNames);
    if (section) sections.push(section);
  }

  for (const frame of frames) {
    if (frame.function !== MODULE && frame.function.startsWith("<")) continue;
    const calls = callGroups.find((group) => group.function === frame.function)?.frames.length ?? 0;
    const recursive = frame.depth > 1;
    // A loop in a function called many times runs once per call; the call
    // section already counts those calls, so do not claim a single round count.
    if (frame.function !== MODULE && (calls > 1 || recursive)) continue;
    for (const loop of detectLoops(source, list, frame)) {
      const section = repeatSection(list, frame, loop, changes);
      if (section) sections.push(section);
    }
  }

  sections.sort((a, b) => a.from - b.from || a.to - b.to);
  const kept = sections.length > MAX_SECTIONS ? trimSections(sections) : sections;

  const storySections = [];
  if (moduleFrame) {
    const firstStart = kept.length > 0 ? Math.min(...kept.map((section) => section.from)) : null;
    if (firstStart !== null && firstStart > moduleFrame.steps[0]) {
      // The line that makes a call is the call section's opening line, so it
      // belongs there rather than in the setup sentence.
      const setupSteps = moduleFrame.steps.filter(
        (index) =>
          index < firstStart &&
          !(kept[0].kind === "call" && list[index]?.line === kept[0].line),
      );
      const sentences = setupSteps
        .slice(0, 3)
        .map((index) => stepSentence(list, index, source))
        .filter(Boolean);
      if (sentences.length > 0) {
        const lines = setupSteps
          .map((index) => list[index]?.line)
          .filter((line) => typeof line === "number");
        storySections.push({
          id: "start",
          kind: "start",
          label: lineRangeLabel(Math.min(...lines), Math.max(...lines)),
          title:
            kept[0].kind === "repeat"
              ? "Before the repetition"
              : kept[0].kind === "call"
                ? "Before the calls"
                : "It starts here",
          text: sentences.join(" "),
          frame: MODULE,
          jump: setupSteps[0],
          from: setupSteps[0],
          to: setupSteps[setupSteps.length - 1],
        });
      }
    }
  }

  storySections.push(...kept);

  if (kept.length === 0 && moduleFrame) {
    storySections.push(...straightSection(list, source, moduleFrame));
  }

  if (lastEvent?.event === "error") {
    storySections.push(errorSection(list, source, lastEvent));
  } else if (lastEvent?.event === "step_limit" || lastEvent?.event === "timeout" || lastEvent?.event === "output_limit") {
    storySections.push(limitSection(list, lastEvent));
  } else if (moduleFrame && kept.length > 0) {
    const lastTo = Math.max(...kept.map((section) => section.to));
    const finish = finishSection(list, source, moduleFrame, lastTo);
    if (finish && !finish.output && kept[kept.length - 1].kind === "repeat") {
      finish.title = "After the loop";
    }
    if (finish) storySections.push(finish);
  }

  if (storySections.length === 0 && moduleFrame) {
    storySections.push(...straightSection(list, source, moduleFrame));
  }

  const ordered = storySections
    .slice(0, MAX_SECTIONS)
    .sort((a, b) => a.from - b.from || a.to - b.to);
  story.sections = ordered;
  story.summary =
    ordered.length === 0
      ? "No steps were recorded."
      : `${ordered.length} parts: ${ordered.map((section) => section.title).join("; ")}.`;
  return story;
}

/**
 * Keep the most informative sections when a run has more than the card can
 * show: repeats and the error win, then calls, then setup and the ending.
 */
function trimSections(sections) {
  const rank = { error: 0, repeat: 1, limit: 1, call: 2, start: 3, finish: 3, run: 3 };
  const kept = [...sections]
    .sort((a, b) => (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9))
    .slice(0, MAX_SECTIONS)
    .sort((a, b) => a.from - b.from || a.to - b.to);
  return kept;
}

/**
 * The section a step belongs to, most specific first.
 * @param {Object} story a run story
 * @param {number} index a trace index
 * @returns {Object|null}
 */
export function sectionAt(story, index) {
  const sections = Array.isArray(story?.sections) ? story.sections : [];
  if (sections.length === 0) return null;
  const containing = sections.filter(
    (section) => typeof section.from === "number" && index >= section.from && index <= section.to,
  );
  if (containing.length > 0) {
    return containing.reduce((best, section) =>
      section.to - section.from < best.to - best.from ? section : best,
    );
  }
  const before = sections.filter((section) => section.from <= index);
  return before.length > 0 ? before[before.length - 1] : sections[0];
}
