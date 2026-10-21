// Renderer-independent visualization scenes and their one pure validator.
//
// An adapter builds a plain, serializable object. This module answers only one
// question: can that object be shown without inventing state? It never imports
// React and never mutates the scene, the StepView, the trace, or the heap.
//
// Every reference is checked against the selected state (or an explicitly
// historical frame/object supplied by the caller). Displayed values are
// re-derived from the trace with the same helpers the visualizer already uses.

import { showValue } from "./values.js";
import { namesById, objectLabel, slotEntries } from "./objects.js";
import { paramsFor } from "./stepView.js";
import { validateStatementStage } from "./statementStage.js";

export const SCENE_VERSION = 1;
export const SCENE_KIND = "visualization_scene";
export const SCENE_STATUSES = Object.freeze(["ok", "partial", "unsupported"]);
export const SCENE_REGION_KINDS = Object.freeze([
  "source",
  "variables",
  "stack",
  "memory",
  "changes",
  "output",
  "context",
  "algorithm",
]);
export const SCENE_ITEM_KINDS = Object.freeze([
  "line",
  "event",
  "variable",
  "frame",
  "invocation",
  "object",
  "slot",
  "change",
  "output",
  "context",
]);
export const SCENE_INVOCATION_OUTCOMES = Object.freeze([
  "future",
  "running",
  "waiting",
  "returned",
  "raised",
  "unfinished",
]);
export const SCENE_EVIDENCE_SOURCES = Object.freeze([
  "profile",
  "trace",
  "adapter",
  "recognition",
]);

const ROOT_KEYS = new Set([
  "version",
  "kind",
  "adapterId",
  "status",
  "title",
  "subtitle",
  "capabilities",
  "sourceLine",
  "focus",
  "highlights",
  "regions",
  "changes",
  "stage",
  "accessibility",
  "evidence",
  "unsupportedReason",
  "meta",
]);

const REGION_KEYS = new Set(["id", "kind", "label", "items"]);
const REFERENCE_KEYS = new Set([
  "kind",
  "id",
  "line",
  "index",
  "slotKey",
  "historical",
  "tone",
]);
const META_KEYS = new Set([
  "stepIndex",
  "eventKind",
  "function",
  "frameId",
  "truncated",
  "requestedAdapterId",
  "recognition",
  "invocationCount",
  "shownInvocations",
  "omittedInvocations",
  "invocationLimit",
]);
const ITEM_KEYS = {
  line: new Set(["kind", "line", "text", "indent"]),
  event: new Set(["kind", "index", "eventKind", "line", "function", "frameId"]),
  variable: new Set([
    "kind",
    "frameId",
    "name",
    "text",
    "valueType",
    "refId",
    "isArg",
    "historical",
  ]),
  frame: new Set([
    "kind",
    "frameId",
    "function",
    "depth",
    "status",
    "callLine",
    "current",
    "historical",
  ]),
  invocation: new Set([
    "kind",
    "frameId",
    "parentFrameId",
    "function",
    "depth",
    "callLine",
    "firstIndex",
    "returnIndex",
    "unwindIndex",
    "returnValue",
    "outcome",
    "exceptionType",
    "exceptionMessage",
    "args",
    "active",
    "current",
    "historical",
    "baseCase",
    "hiddenChildren",
  ]),
  object: new Set(["kind", "objectId", "label", "objectType", "historical"]),
  slot: new Set([
    "kind",
    "objectId",
    "slotKey",
    "index",
    "text",
    "valueType",
    "refId",
    "historical",
  ]),
  change: new Set(["kind", "name", "changeKind", "from", "to", "line"]),
  output: new Set(["kind", "text", "eventIndex", "line"]),
  context: new Set(["kind", "name", "text", "line"]),
};
const CHANGE_KINDS = new Set([
  "new",
  "changed",
  "removed",
  "new-slot",
  "removed-slot",
  "slot",
]);
const REFERENCE_KINDS = new Set([
  "line",
  "frame",
  "object",
  "slot",
  "change",
  "event",
  "output",
]);
const TONES = new Set(["focus", "changed", "muted", "warning"]);
const CONTEXT_NAMES = new Set([
  "function",
  "event",
  "step",
  "status",
  "recognition",
  "return value",
  "printed",
  "selection",
]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isString(value) {
  return typeof value === "string";
}

function isInteger(value) {
  return Number.isInteger(value);
}

function push(errors, where, message) {
  errors.push(`${where}: ${message}`);
}

function checkKeys(value, allowed, errors, where) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) push(errors, where, `unknown field "${key}"`);
  }
}

function sourceLinesOf(context) {
  const source =
    typeof context?.source === "string"
      ? context.source
      : typeof context?.programSource === "string"
        ? context.programSource
        : "";
  return source.length > 0 ? source.split("\n") : [];
}

function currentFramesOf(view) {
  const frames = Array.isArray(view?.frames) ? view.frames : [];
  return new Map(frames.map((frame) => [frame.frame_id, frame]));
}

function currentStackOf(view) {
  const stack = Array.isArray(view?.callStack) ? view.callStack : [];
  return new Map(stack.map((frame) => [frame.frameId, frame]));
}

function currentHeapOf(view) {
  return isObject(view?.heap) ? view.heap : {};
}

function sameNullable(left, right) {
  return (left ?? null) === (right ?? null);
}

/**
 * Validate one scene against the state it claims to describe.
 *
 * @param {Object} scene
 * @param {{
 *   stepView?: Object,
 *   trace?: Array,
 *   traceIndex?: Object,
 *   source?: string,
 *   profile?: Object,
 *   recognition?: Object,
 *   adapterId?: string,
 *   result?: Object,
 *   historicalFrameIds?: Iterable<number>,
 *   historicalObjectIds?: Iterable<string>,
 *   historicalHeap?: Object
 * }} [context]
 * @returns {{ valid: boolean, errors: string[], scene: Object|null }}
 */
export function validateScene(scene, context = {}) {
  const errors = [];
  if (!isObject(scene)) {
    return { valid: false, errors: ["scene: must be an object"], scene: null };
  }

  const view = isObject(context?.stepView) ? context.stepView : null;
  const sourceLines = sourceLinesOf(context);
  const trace = Array.isArray(context?.trace)
    ? context.trace
    : Array.isArray(context?.traceIndex?.trace)
      ? context.traceIndex.trace
      : [];
  const traceIndex = isObject(context?.traceIndex) ? context.traceIndex : null;
  const currentFrames = currentFramesOf(view);
  const currentStack = currentStackOf(view);
  const currentHeap = currentHeapOf(view);
  const historicalFrames = new Set(context?.historicalFrameIds ?? []);
  for (const frameId of traceIndex?.frames?.keys?.() ?? []) historicalFrames.add(frameId);
  const historicalObjects = new Set(context?.historicalObjectIds ?? []);
  const historicalHeap = isObject(context?.historicalHeap) ? context.historicalHeap : null;
  const names = namesById(Array.isArray(view?.frames) ? view.frames : [], currentHeap);

  // Invocation items describe calls from the whole run, so they are collected
  // before validation: parent edges and base cases need the represented set.
  const invocationItems = [];
  const itemLists = Array.isArray(scene.changes) ? [scene.changes] : [];
  if (Array.isArray(scene.regions)) {
    for (const region of scene.regions) {
      if (!isObject(region) || !Array.isArray(region.items)) continue;
      itemLists.push(region.items);
    }
  }
  for (const items of itemLists) {
    for (const item of items) {
      if (isObject(item) && item.kind === "invocation") invocationItems.push(item);
    }
  }
  const invocationFrameCounts = new Map();
  const representedFrameIds = new Set();
  const representedChildCounts = new Map();
  for (const item of invocationItems) {
    if (!isInteger(item.frameId)) continue;
    invocationFrameCounts.set(item.frameId, (invocationFrameCounts.get(item.frameId) ?? 0) + 1);
    representedFrameIds.add(item.frameId);
  }
  for (const item of invocationItems) {
    if (!isInteger(item.frameId) || !isInteger(item.parentFrameId)) continue;
    representedChildCounts.set(
      item.parentFrameId,
      (representedChildCounts.get(item.parentFrameId) ?? 0) + 1,
    );
  }

  function checkLine(line, where, { text = undefined, indent = undefined } = {}) {
    if (!isInteger(line) || line < 1 || line > sourceLines.length) {
      push(errors, where, `source line ${String(line)} does not exist`);
      return null;
    }
    const raw = sourceLines[line - 1];
    if (text !== undefined && text !== raw.trim()) {
      push(errors, where, `text does not match source line ${line}`);
    }
    if (indent !== undefined && indent !== raw.length - raw.trimStart().length) {
      push(errors, where, `indent does not match source line ${line}`);
    }
    return raw;
  }

  function getCurrentFrame(frameId, where) {
    const frame = currentFrames.get(frameId);
    if (!frame) {
      push(errors, where, `frame ${String(frameId)} is not in the selected state`);
    }
    return frame ?? null;
  }

  function getFrame(frameId, historical, where) {
    const frame = currentFrames.get(frameId);
    if (frame) return { frame, historical: false, stack: currentStack.get(frameId) ?? null };
    if (!historical) {
      push(errors, where, `frame ${String(frameId)} is not in the selected state`);
      return null;
    }
    if (!historicalFrames.has(frameId)) {
      push(errors, where, `historical frame ${String(frameId)} is not in the trace`);
      return null;
    }
    const info = traceIndex?.frame?.(frameId) ?? null;
    if (!info) {
      push(errors, where, `historical frame ${String(frameId)} has no recorded details`);
      return null;
    }
    return { frame: null, historical: true, info };
  }

  function getObject(objectId, historical, where) {
    if (!isString(objectId) || objectId.length === 0) {
      push(errors, where, "objectId must be a non-empty string");
      return null;
    }
    const current = currentHeap[objectId];
    if (current) return { object: current, heap: currentHeap, historical: false };
    if (!historical) {
      push(errors, where, `object ${objectId} is not in the selected state`);
      return null;
    }
    if (!historicalObjects.has(objectId)) {
      push(errors, where, `historical object ${objectId} is not declared`);
      return null;
    }
    const object = historicalHeap?.[objectId];
    if (!object) {
      push(errors, where, `historical object ${objectId} has no recorded contents`);
      return null;
    }
    return { object, heap: historicalHeap, historical: true };
  }

  function checkSlotReference(item, where) {
    const found = getObject(item.objectId, item.historical === true, where);
    if (!found) return null;
    const entries = slotEntries(found.object);
    let entry = null;
    if (item.index !== undefined) {
      if (!["list", "tuple"].includes(found.object.type)) {
        push(errors, where, "index is only valid for a list or tuple slot");
      }
      if (!isInteger(item.index) || item.index < 0 || item.index >= entries.length) {
        push(errors, where, `slot index ${String(item.index)} does not exist`);
      } else {
        entry = entries.find((candidate) => candidate.key === item.index) ?? null;
      }
    } else if (item.slotKey !== undefined) {
      entry = entries.find((candidate) => candidate.key === item.slotKey) ?? null;
      if (!entry) push(errors, where, `slot ${String(item.slotKey)} does not exist`);
    } else {
      push(errors, where, "slot needs an index or slotKey");
    }
    return { ...found, entry };
  }

  function checkChange(item, where) {
    if (!CHANGE_KINDS.has(item.changeKind)) {
      push(errors, where, `unknown change kind ${String(item.changeKind)}`);
    }
    if (!isString(item.name) || item.name.length === 0) {
      push(errors, where, "change name must be a non-empty string");
    }
    if (item.from !== null && !isString(item.from)) {
      push(errors, where, "change from must be a string or null");
    }
    if (item.to !== null && !isString(item.to)) {
      push(errors, where, "change to must be a string or null");
    }
    if (item.line !== null && item.line !== undefined) {
      checkLine(item.line, where);
    }
    const match = (view?.changes ?? []).some(
      (change) =>
        change.name === item.name &&
        change.kind === item.changeKind &&
        change.from === item.from &&
        change.to === item.to &&
        sameNullable(change.line, item.line),
    );
    if (!match) push(errors, where, "change is not in the selected StepView");
  }

  function checkOutput(item, where) {
    if (!isString(item.text)) {
      push(errors, where, "output text must be a string");
      return;
    }
    const expected =
      typeof context?.output === "string"
        ? context.output
        : traceIndex?.outputAt
          ? traceIndex.outputAt(view?.index ?? 0)
          : null;
    if (expected === null) {
      push(errors, where, "output cannot be checked without a trace index");
    } else if (item.text !== expected) {
      push(errors, where, "output text does not match the trace at this step");
    }
    if (item.eventIndex !== undefined) {
      if (!isInteger(item.eventIndex) || item.eventIndex < 0 || item.eventIndex >= trace.length) {
        push(errors, where, `output event ${String(item.eventIndex)} does not exist`);
      } else if (trace[item.eventIndex]?.event !== "output") {
        push(errors, where, `event ${item.eventIndex} is not an output event`);
      } else if (view && item.eventIndex > view.index) {
        push(errors, where, "output event is after the selected step");
      }
    }
    if (item.line !== null && item.line !== undefined) checkLine(item.line, where);
  }

  function checkContextItem(item, where) {
    if (!CONTEXT_NAMES.has(item.name)) {
      push(errors, where, `unknown context name ${String(item.name)}`);
      return;
    }
    if (!isString(item.text)) {
      push(errors, where, "context text must be a string");
      return;
    }
    const expected = {
      function: view?.function ?? null,
      event: view?.kind ?? "none",
      step: view ? String(view.index) : null,
      status: context?.result?.status ?? context?.status ?? null,
      recognition: context?.recognition?.adapterId ?? "generic",
      "return value": view?.returnValue ?? null,
      printed: view?.printed ?? null,
      selection: view?.selectionLost ? "lost" : "current",
    }[item.name];
    if (expected === null) {
      push(errors, where, `context value "${item.name}" is not available at this step`);
    } else if (item.text !== String(expected)) {
      push(errors, where, `context value "${item.name}" does not match the StepView`);
    }
    if (item.line !== null && item.line !== undefined) checkLine(item.line, where);
  }

  function exceptionForUnwind(frameId, unwindIndex) {
    if (unwindIndex === null || unwindIndex === undefined) return null;
    let found = null;
    for (let i = 0; i < unwindIndex; i += 1) {
      const event = trace[i];
      if (event?.event === "exception" && event.frame_id === frameId) {
        found = {
          type: event.exception?.type ?? null,
          message: event.exception?.message ?? null,
        };
      }
    }
    return found;
  }

  function expectedOutcomeOf(info, active) {
    if (!view) return null;
    if (view.index < info.firstIndex) return "future";
    if (info.returnIndex !== null && view.index >= info.returnIndex) return "returned";
    if (info.unwindIndex !== null && view.index >= info.unwindIndex) return "raised";
    if (active) return info.frameId === view.frameId ? "running" : "waiting";
    return "unfinished";
  }

  function expectedArgsOf(info) {
    const event = trace[info.firstIndex];
    const top = event?.frames?.[event.frames.length - 1];
    if (!top || top.frame_id !== info.frameId) return [];
    const variables = top.variables ?? {};
    return paramsFor(sourceLines.join("\n"), info.function)
      .filter((name) => name in variables)
      .map((name) => ({ name, text: showValue(variables[name], event.heap) }));
  }

  function checkInvocation(item, where) {
    if (!view) {
      push(errors, where, "an invocation scene needs a selected step");
      return;
    }
    if (!isInteger(item.frameId)) {
      push(errors, where, "frameId must be an integer");
      return;
    }
    const info = traceIndex?.frame?.(item.frameId) ?? null;
    if (!info) {
      push(errors, where, `frame ${String(item.frameId)} is not in the trace`);
      return;
    }
    if ((invocationFrameCounts.get(item.frameId) ?? 0) > 1) {
      push(errors, where, `frame ${String(item.frameId)} appears more than once`);
    }
    if (item.function !== info.function) {
      push(errors, where, "function does not match the trace");
    }
    if (item.depth !== info.depth) {
      push(errors, where, "depth does not match the trace");
    }
    if (!sameNullable(item.callLine, info.callLine)) {
      push(errors, where, "call line does not match the trace");
    }
    if (item.callLine !== null && item.callLine !== undefined) {
      checkLine(item.callLine, where);
    }
    if (item.firstIndex !== info.firstIndex) {
      push(errors, where, "firstIndex does not match the trace");
    }
    if (!sameNullable(item.returnIndex, info.returnIndex)) {
      push(errors, where, "returnIndex does not match the trace");
    }
    if (!sameNullable(item.unwindIndex, info.unwindIndex)) {
      push(errors, where, "unwindIndex does not match the trace");
    }
    if (item.returnIndex !== null && item.returnIndex !== undefined) {
      const event = trace[item.returnIndex];
      if (event?.event !== "return" || event.frame_id !== item.frameId) {
        push(errors, where, `event ${String(item.returnIndex)} is not this frame's return`);
      }
    }
    if (item.unwindIndex !== null && item.unwindIndex !== undefined) {
      const event = trace[item.unwindIndex];
      if (event?.event !== "unwind" || event.frame_id !== item.frameId) {
        push(errors, where, `event ${String(item.unwindIndex)} is not this frame's unwind`);
      }
    }

    const returnEvent = info.returnIndex === null ? null : trace[info.returnIndex];
    const expectedReturn =
      returnEvent?.return_value ? showValue(returnEvent.return_value, returnEvent.heap) : null;
    if (!sameNullable(item.returnValue, expectedReturn)) {
      push(errors, where, "return value does not match the return event");
    }

    const active = currentStack.has(item.frameId);
    const current = view.frameId === item.frameId;
    if (item.active !== active) {
      push(errors, where, "active flag does not match the selected stack");
    }
    if (item.current !== current) {
      push(errors, where, "current flag does not match the selected frame");
    }
    if (item.historical !== !active) {
      push(errors, where, "historical flag does not match the selected stack");
    }

    const expectedOutcome = expectedOutcomeOf(info, active);
    if (!SCENE_INVOCATION_OUTCOMES.includes(item.outcome)) {
      push(errors, where, `unknown invocation outcome ${String(item.outcome)}`);
    } else if (item.outcome !== expectedOutcome) {
      push(errors, where, "outcome does not match the selected step");
    }

    const exception = exceptionForUnwind(item.frameId, info.unwindIndex);
    if (!sameNullable(item.exceptionType, exception?.type ?? null)) {
      push(errors, where, "exception type does not match the trace");
    }
    if (!sameNullable(item.exceptionMessage, exception?.message ?? null)) {
      push(errors, where, "exception message does not match the trace");
    }

    const expectedArgs = expectedArgsOf(info);
    if (!Array.isArray(item.args)) {
      push(errors, where, "args must be an array");
    } else if (item.args.length !== expectedArgs.length) {
      push(errors, where, "args do not match the call's captured arguments");
    } else {
      item.args.forEach((arg, i) => {
        const argWhere = `${where}.args[${i}]`;
        if (!isObject(arg)) {
          push(errors, argWhere, "argument must be an object");
          return;
        }
        checkKeys(arg, new Set(["name", "text"]), errors, argWhere);
        if (arg.name !== expectedArgs[i].name) {
          push(errors, argWhere, "argument name does not match the call");
        }
        if (arg.text !== expectedArgs[i].text) {
          push(errors, argWhere, "argument text does not match the call");
        }
      });
    }

    if (item.parentFrameId === null) {
      if (info.parentId !== null && representedFrameIds.has(info.parentId)) {
        push(errors, where, "represented parent invocation is missing");
      }
    } else if (!isInteger(item.parentFrameId)) {
      push(errors, where, "parentFrameId must be an integer or null");
    } else if (item.parentFrameId === item.frameId) {
      push(errors, where, "an invocation cannot be its own parent");
    } else if (item.parentFrameId !== info.parentId) {
      push(errors, where, "parentFrameId does not match the trace");
    } else if (!representedFrameIds.has(item.parentFrameId)) {
      push(errors, where, "parentFrameId is not a represented invocation");
    }

    if (!isInteger(item.hiddenChildren) || item.hiddenChildren < 0) {
      push(errors, where, "hiddenChildren must be a non-negative integer");
    }
    if (typeof item.baseCase !== "boolean") {
      push(errors, where, "baseCase must be a boolean");
    } else if (item.baseCase) {
      if (info.returnIndex === null || info.unwindIndex !== null) {
        push(errors, where, "a base case must have a normal return event");
      }
      if (expectedOutcome !== "returned") {
        push(errors, where, "a base case must already have returned at this step");
      }
      if ((representedChildCounts.get(item.frameId) ?? 0) > 0) {
        push(errors, where, "a base case cannot have represented children");
      }
      if (item.hiddenChildren !== 0) {
        push(errors, where, "a base case cannot have hidden children");
      }
    }
  }

  function checkItem(item, where) {
    if (!isObject(item)) {
      push(errors, where, "item must be an object");
      return;
    }
    if (!SCENE_ITEM_KINDS.includes(item.kind)) {
      push(errors, where, `unknown item kind ${String(item.kind)}`);
      return;
    }
    checkKeys(item, ITEM_KEYS[item.kind], errors, where);
    switch (item.kind) {
      case "line":
        if (!isString(item.text)) push(errors, where, "line text must be a string");
        if (!isInteger(item.indent) || item.indent < 0) {
          push(errors, where, "line indent must be a non-negative integer");
        }
        checkLine(item.line, where, { text: item.text, indent: item.indent });
        break;
      case "event": {
        if (!view || item.index !== view.index) {
          push(errors, where, "event index is not the selected step");
        }
        if (item.eventKind !== (view?.kind ?? "none")) {
          push(errors, where, "event kind does not match the selected step");
        }
        if (!sameNullable(item.line, view?.line)) {
          push(errors, where, "event line does not match the selected step");
        }
        if (item.function !== (view?.function ?? null)) {
          push(errors, where, "event function does not match the selected step");
        }
        if (item.frameId !== undefined && item.frameId !== (view?.frameId ?? null)) {
          push(errors, where, "event frame does not match the selected step");
        }
        if (item.line !== null && item.line !== undefined) checkLine(item.line, where);
        break;
      }
      case "variable": {
        if (item.historical === true) {
          push(errors, where, "historical variables are not supported by this contract");
          break;
        }
        const frame = getCurrentFrame(item.frameId, where);
        if (!frame) break;
        const value = frame.variables?.[item.name];
        if (!value) {
          push(errors, where, `variable ${String(item.name)} is not in the frame`);
          break;
        }
        const expected = showValue(value, currentHeap);
        if (item.text !== expected) {
          push(errors, where, `variable ${item.name} text does not match the trace`);
        }
        if (item.valueType !== undefined && item.valueType !== value.type) {
          push(errors, where, `variable ${item.name} type does not match the trace`);
        }
        if (value.type === "ref") {
          if (item.refId !== undefined && item.refId !== null && item.refId !== value.id) {
            push(errors, where, `variable ${item.name} reference does not match the trace`);
          }
          if (item.refId && !currentHeap[item.refId]) {
            push(errors, where, `variable ${item.name} references a missing object`);
          }
        } else if (item.refId !== undefined && item.refId !== null) {
          push(errors, where, `variable ${item.name} is not a reference`);
        }
        break;
      }
      case "frame": {
        const found = getFrame(item.frameId, item.historical === true, where);
        if (!found) break;
        if (found.historical) {
          if (item.current === true) push(errors, where, "historical frame marked current");
          if (item.function !== undefined && item.function !== found.info.function) {
            push(errors, where, "frame function does not match the trace");
          }
          if (item.depth !== undefined && item.depth !== found.info.depth) {
            push(errors, where, "frame depth does not match the trace");
          }
          if (item.callLine !== undefined && !sameNullable(item.callLine, found.info.callLine)) {
            push(errors, where, "frame call line does not match the trace");
          }
        } else {
          const stack = found.stack;
          if (item.current !== undefined && item.current !== Boolean(stack?.isTop)) {
            push(errors, where, "frame current flag does not match the selected state");
          }
          if (item.function !== undefined && item.function !== found.frame.function) {
            push(errors, where, "frame function does not match the selected state");
          }
          if (item.depth !== undefined && item.depth !== stack?.depth) {
            push(errors, where, "frame depth does not match the selected state");
          }
          if (item.status !== undefined && item.status !== stack?.status) {
            push(errors, where, "frame status does not match the selected state");
          }
          if (item.callLine !== undefined && !sameNullable(item.callLine, found.frame.call_line)) {
            push(errors, where, "frame call line does not match the selected state");
          }
        }
        if (item.callLine !== null && item.callLine !== undefined) {
          checkLine(item.callLine, where);
        }
        break;
      }
      case "invocation":
        checkInvocation(item, where);
        break;
      case "object": {
        const found = getObject(item.objectId, item.historical === true, where);
        if (!found) break;
        const type = found.object.type ?? found.object.class ?? "object";
        if (item.objectType !== undefined && item.objectType !== type) {
          push(errors, where, "object type does not match the trace");
        }
        if (!found.historical) {
          const labels = names.get(item.objectId) ?? [];
          const expected =
            labels.length > 0 ? labels.join(", ") : objectLabel(item.objectId, found.object);
          if (item.label !== undefined && item.label !== expected) {
            push(errors, where, "object label does not match the trace");
          }
        }
        break;
      }
      case "slot": {
        const found = checkSlotReference(item, where);
        if (!found?.entry) break;
        if (!isString(item.text)) {
          push(errors, where, "slot text must be a string");
          break;
        }
        const expected = showValue(found.entry.value, found.heap);
        if (item.text !== expected) {
          push(errors, where, "slot text does not match the trace");
        }
        if (item.valueType !== undefined && item.valueType !== found.entry.value?.type) {
          push(errors, where, "slot type does not match the trace");
        }
        if (found.entry.value?.type === "ref") {
          if (item.refId !== undefined && item.refId !== null && item.refId !== found.entry.value.id) {
            push(errors, where, "slot reference does not match the trace");
          }
          if (item.refId && !found.heap[item.refId]) {
            push(errors, where, "slot references a missing object");
          }
        } else if (item.refId !== undefined && item.refId !== null) {
          push(errors, where, "slot is not a reference");
        }
        break;
      }
      case "change":
        checkChange(item, where);
        break;
      case "output":
        checkOutput(item, where);
        break;
      case "context":
        checkContextItem(item, where);
        break;
      default:
        break;
    }
  }

  function checkReference(reference, where) {
    if (!isObject(reference)) {
      push(errors, where, "reference must be an object");
      return;
    }
    if (!REFERENCE_KINDS.has(reference.kind)) {
      push(errors, where, `unknown reference kind ${String(reference.kind)}`);
      return;
    }
    checkKeys(reference, REFERENCE_KEYS, errors, where);
    if (reference.tone !== undefined && !TONES.has(reference.tone)) {
      push(errors, where, `unknown tone ${String(reference.tone)}`);
    }
    switch (reference.kind) {
      case "line":
        checkLine(reference.line, where);
        break;
      case "frame":
        getFrame(reference.id, reference.historical === true, where);
        break;
      case "object":
        getObject(reference.id, reference.historical === true, where);
        break;
      case "slot":
        checkSlotReference(
          {
            objectId: reference.id,
            index: reference.index,
            slotKey: reference.slotKey,
            historical: reference.historical,
          },
          where,
        );
        break;
      case "change":
        if (!(view?.changes ?? []).some((change) => change.name === reference.id)) {
          push(errors, where, `change ${String(reference.id)} is not in the selected StepView`);
        }
        if (reference.line !== null && reference.line !== undefined) {
          checkLine(reference.line, where);
        }
        break;
      case "event":
        if (!view || reference.id !== view.index) {
          push(errors, where, "event reference is not the selected step");
        }
        break;
      case "output":
        if (reference.eventIndex !== undefined) {
          if (
            !isInteger(reference.eventIndex) ||
            reference.eventIndex < 0 ||
            reference.eventIndex >= trace.length ||
            trace[reference.eventIndex]?.event !== "output"
          ) {
            push(errors, where, "output reference is not an output event");
          }
        }
        if (reference.line !== null && reference.line !== undefined) {
          checkLine(reference.line, where);
        }
        break;
      default:
        break;
    }
  }

  if (scene.version !== SCENE_VERSION) {
    push(errors, "scene", `version must be ${SCENE_VERSION}`);
  }
  if (scene.kind !== SCENE_KIND) push(errors, "scene", `kind must be "${SCENE_KIND}"`);
  if (!isString(scene.adapterId) || scene.adapterId.length === 0) {
    push(errors, "scene", "adapterId must be a non-empty string");
  }
  if (context?.adapterId && scene.adapterId !== context.adapterId) {
    push(errors, "scene", `adapterId does not match "${context.adapterId}"`);
  }
  if (!SCENE_STATUSES.includes(scene.status)) {
    push(errors, "scene", `status must be one of ${SCENE_STATUSES.join(", ")}`);
  }
  if (!isString(scene.title) || scene.title.length === 0) {
    push(errors, "scene", "title must be a non-empty string");
  }
  if (scene.subtitle !== null && !isString(scene.subtitle)) {
    push(errors, "scene", "subtitle must be a string or null");
  }
  if (!Array.isArray(scene.capabilities) || scene.capabilities.length === 0) {
    push(errors, "scene", "capabilities must be a non-empty array");
  } else {
    const seen = new Set();
    for (const capability of scene.capabilities) {
      if (!isString(capability) || capability.length === 0) {
        push(errors, "scene", "capabilities must contain non-empty strings");
      } else if (seen.has(capability)) {
        push(errors, "scene", `duplicate capability "${capability}"`);
      }
      seen.add(capability);
    }
  }
  if (scene.sourceLine !== null) {
    if (!isObject(scene.sourceLine)) {
      push(errors, "scene", "sourceLine must be an object or null");
    } else {
      checkKeys(scene.sourceLine, new Set(["line", "text", "indent"]), errors, "scene.sourceLine");
      if (!isString(scene.sourceLine.text)) {
        push(errors, "scene.sourceLine", "text must be a string");
      }
      if (!isInteger(scene.sourceLine.indent) || scene.sourceLine.indent < 0) {
        push(errors, "scene.sourceLine", "indent must be a non-negative integer");
      }
      checkLine(scene.sourceLine.line, "scene.sourceLine", {
        text: scene.sourceLine.text,
        indent: scene.sourceLine.indent,
      });
    }
  }
  if (scene.focus !== null) checkReference(scene.focus, "scene.focus");
  if (!Array.isArray(scene.highlights)) {
    push(errors, "scene", "highlights must be an array");
  } else {
    scene.highlights.forEach((reference, i) => checkReference(reference, `scene.highlights[${i}]`));
  }
  if (!Array.isArray(scene.regions)) {
    push(errors, "scene", "regions must be an array");
  } else {
    const regionIds = new Set();
    scene.regions.forEach((region, r) => {
      const where = `scene.regions[${r}]`;
      if (!isObject(region)) {
        push(errors, where, "region must be an object");
        return;
      }
      checkKeys(region, REGION_KEYS, errors, where);
      if (!isString(region.id) || region.id.length === 0) {
        push(errors, where, "region id must be a non-empty string");
      } else if (regionIds.has(region.id)) {
        push(errors, where, `duplicate region id "${region.id}"`);
      } else {
        regionIds.add(region.id);
      }
      if (!SCENE_REGION_KINDS.includes(region.kind)) {
        push(errors, where, `unknown region kind ${String(region.kind)}`);
      }
      if (!isString(region.label) || region.label.length === 0) {
        push(errors, where, "region label must be a non-empty string");
      }
      if (!Array.isArray(region.items)) {
        push(errors, where, "items must be an array");
      } else {
        region.items.forEach((item, i) => checkItem(item, `${where}.items[${i}]`));
      }
    });
  }
  if (!Array.isArray(scene.changes)) {
    push(errors, "scene", "changes must be an array");
  } else {
    scene.changes.forEach((item, i) => checkItem(item, `scene.changes[${i}]`));
  }
  if (!isObject(scene.accessibility)) {
    push(errors, "scene", "accessibility must be an object");
  } else {
    checkKeys(scene.accessibility, new Set(["label", "summary"]), errors, "scene.accessibility");
    if (!isString(scene.accessibility.label) || scene.accessibility.label.length === 0) {
      push(errors, "scene.accessibility", "label must be a non-empty string");
    }
    if (!isString(scene.accessibility.summary)) {
      push(errors, "scene.accessibility", "summary must be a string");
    }
  }
  if (!Array.isArray(scene.evidence)) {
    push(errors, "scene", "evidence must be an array");
  } else {
    scene.evidence.forEach((item, i) => {
      const where = `scene.evidence[${i}]`;
      if (!isObject(item)) {
        push(errors, where, "evidence must be an object");
        return;
      }
      if (!SCENE_EVIDENCE_SOURCES.includes(item.source)) {
        push(errors, where, `unknown evidence source ${String(item.source)}`);
      }
      if (!isString(item.kind) || item.kind.length === 0) {
        push(errors, where, "evidence kind must be a non-empty string");
      }
      if (!isString(item.detail)) push(errors, where, "evidence detail must be a string");
    });
  }
  if (!isObject(scene.meta)) {
    push(errors, "scene", "meta must be an object");
  } else {
    checkKeys(scene.meta, META_KEYS, errors, "scene.meta");
    if (scene.meta.stepIndex !== null) {
      if (!isInteger(scene.meta.stepIndex) || scene.meta.stepIndex !== view?.index) {
        push(errors, "scene.meta", "stepIndex does not match the selected step");
      }
    }
    if (!sameNullable(scene.meta.eventKind, view?.kind ?? null)) {
      push(errors, "scene.meta", "eventKind does not match the selected step");
    }
    if (!sameNullable(scene.meta.function, view?.function ?? null)) {
      push(errors, "scene.meta", "function does not match the selected step");
    }
    if (!sameNullable(scene.meta.frameId, view?.frameId ?? null)) {
      push(errors, "scene.meta", "frameId does not match the selected step");
    }
    if (typeof scene.meta.truncated !== "boolean") {
      push(errors, "scene.meta", "truncated must be a boolean");
    }
    if (!isString(scene.meta.requestedAdapterId) || scene.meta.requestedAdapterId.length === 0) {
      push(errors, "scene.meta", "requestedAdapterId must be a non-empty string");
    }
    if (scene.meta.recognition !== null) {
      if (!isObject(scene.meta.recognition)) {
        push(errors, "scene.meta", "recognition must be an object or null");
      } else {
        checkKeys(
          scene.meta.recognition,
          new Set(["adapterId", "confidence", "unavailableReason"]),
          errors,
          "scene.meta.recognition",
        );
        if (!isString(scene.meta.recognition.adapterId)) {
          push(errors, "scene.meta.recognition", "adapterId must be a string");
        }
        if (
          typeof scene.meta.recognition.confidence !== "number" ||
          scene.meta.recognition.confidence < 0 ||
          scene.meta.recognition.confidence > 1
        ) {
          push(errors, "scene.meta.recognition", "confidence must be between 0 and 1");
        }
        if (
          scene.meta.recognition.unavailableReason !== null &&
          !isString(scene.meta.recognition.unavailableReason)
        ) {
          push(errors, "scene.meta.recognition", "unavailableReason must be a string or null");
        }
      }
    }

    const countKeys = [
      "invocationCount",
      "shownInvocations",
      "omittedInvocations",
      "invocationLimit",
    ];
    const presentCountKeys = countKeys.filter((key) => scene.meta[key] !== undefined);
    if (invocationItems.length > 0 && presentCountKeys.length !== countKeys.length) {
      push(errors, "scene.meta", "invocation scenes must report the invocation counts");
    } else if (presentCountKeys.length > 0 && presentCountKeys.length !== countKeys.length) {
      push(errors, "scene.meta", "invocation counts must be provided together");
    } else if (presentCountKeys.length === countKeys.length) {
      const countsValid = countKeys.every((key) => {
        if (isInteger(scene.meta[key]) && scene.meta[key] >= 0) return true;
        push(errors, "scene.meta", `${key} must be a non-negative integer`);
        return false;
      });
      if (countsValid) {
        if (scene.meta.invocationLimit < 1) {
          push(errors, "scene.meta", "invocationLimit must be at least 1");
        }
        if (scene.meta.shownInvocations !== invocationItems.length) {
          push(errors, "scene.meta", "shownInvocations does not match the rendered invocations");
        }
        if (
          scene.meta.shownInvocations + scene.meta.omittedInvocations !==
          scene.meta.invocationCount
        ) {
          push(errors, "scene.meta", "shown and omitted invocations must add up to the total");
        }
        if (scene.meta.omittedInvocations > 0) {
          if (scene.status === "ok") {
            push(errors, "scene.meta", "omitted invocations require a partial scene");
          }
          if (scene.meta.truncated !== true) {
            push(errors, "scene.meta", "omitted invocations must mark the scene truncated");
          }
        }
      }
    }
  }
  if (scene.unsupportedReason !== null && !isString(scene.unsupportedReason)) {
    push(errors, "scene", "unsupportedReason must be a string or null");
  }
  if (scene.status === "ok" && scene.unsupportedReason !== null) {
    push(errors, "scene", "an ok scene cannot have an unsupportedReason");
  }
  if (scene.status !== "ok" && (!isString(scene.unsupportedReason) || scene.unsupportedReason.length === 0)) {
    push(errors, "scene", "a partial or unsupported scene needs a reason");
  }
  if (scene.stage !== undefined) {
    const check = validateStatementStage(scene.stage, context);
    if (!check.valid) {
      check.errors.forEach((message) => push(errors, "scene.stage", message));
    }
  }
  checkKeys(scene, ROOT_KEYS, errors, "scene");

  return { valid: errors.length === 0, errors, scene };
}
