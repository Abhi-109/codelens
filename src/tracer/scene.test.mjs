// The scene contract is only useful if it rejects a scene that looks plausible
// but points at state the trace does not contain. These tests use real corpus
// traces and real generic scenes, then break one reference at a time.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";

import { DEFAULT_REGISTRY } from "./adapters.js";
import { recognizeProgram } from "./recognition.js";
import { validateScene } from "./scene.js";
import { getStepView } from "./stepView.js";
import { getTraceIndex } from "./traceIndex.js";

const CORPUS = JSON.parse(
  gunzipSync(readFileSync(new URL("./__fixtures__/corpus.json.gz", import.meta.url))),
);
const RECOGNITION = JSON.parse(
  gunzipSync(readFileSync(new URL("./__fixtures__/recognition.json.gz", import.meta.url))),
);

const recognitionCache = new Map();

function recognitionFor(name) {
  if (recognitionCache.has(name)) return recognitionCache.get(name);
  const entry = CORPUS[name];
  const result = recognizeProgram({
    profile: RECOGNITION.corpus_profiles[name],
    trace: entry.trace,
    status: entry.result.status,
  });
  recognitionCache.set(name, result);
  return result;
}

function contextFor(name, index) {
  const entry = CORPUS[name];
  return {
    stepView: getStepView(entry.trace, index, entry.source),
    trace: entry.trace,
    traceIndex: getTraceIndex(entry.trace),
    source: entry.source,
    profile: RECOGNITION.corpus_profiles[name],
    recognition: recognitionFor(name),
    result: entry.result,
  };
}

function genericBuild(name, index, extra = {}) {
  return DEFAULT_REGISTRY.build("generic", { ...contextFor(name, index), ...extra });
}

function firstSceneWhere(predicate) {
  for (const [name, entry] of Object.entries(CORPUS)) {
    for (let index = 0; index < entry.trace.length; index += 1) {
      const built = genericBuild(name, index);
      if (predicate(built.scene, name, index)) return { name, index, ...built };
    }
  }
  assert.fail("no corpus scene matched the test predicate");
}

function clone(value) {
  return structuredClone(value);
}

function hasRegion(scene, kind) {
  return scene.regions.some((region) => region.kind === kind);
}

function slotItems(scene) {
  return scene.regions.flatMap((region) => region.items).filter((item) => item.kind === "slot");
}

test("a real generic scene validates and is serializable", () => {
  const built = genericBuild("list-mutation", 2);
  assert.equal(built.adapterId, "generic");
  assert.equal(built.validation.valid, true, built.validation.errors.join("\n"));
  assert.equal(built.fallbackReason, null);
  assert.equal(built.scene.status, "ok");
  assert.ok(built.scene.sourceLine);
  assert.ok(hasRegion(built.scene, "variables"));
  assert.ok(hasRegion(built.scene, "stack"));
  assert.ok(hasRegion(built.scene, "memory"));
  assert.ok(built.scene.changes.length > 0);
  assert.deepEqual(JSON.parse(JSON.stringify(built.scene)), built.scene);
});

test("malformed roots and unknown scene items fail closed", () => {
  const scene = genericBuild("list-mutation", 2).scene;
  const bad = [
    { ...scene, version: 99 },
    { ...scene, kind: "not_a_scene" },
    { ...scene, title: "" },
    { ...scene, status: "maybe" },
    { ...scene, unknownField: true },
    { ...scene, regions: [...scene.regions, { id: "bad", kind: "made-up", label: "Bad", items: [] }] },
    {
      ...scene,
      regions: [
        ...scene.regions,
        { id: "bad", kind: "algorithm", label: "Bad", items: [{ kind: "comparison" }] },
      ],
    },
  ];
  for (const candidate of bad) {
    const result = validateScene(candidate, contextFor("list-mutation", 2));
    assert.equal(result.valid, false, JSON.stringify(candidate).slice(0, 120));
    assert.ok(result.errors.length > 0);
  }
  assert.equal(validateScene(null, contextFor("list-mutation", 2)).valid, false);
});

test("source-line references must exist and match the source text", () => {
  const context = contextFor("list-mutation", 2);
  const scene = genericBuild("list-mutation", 2).scene;

  const missing = clone(scene);
  missing.sourceLine.line = 999;
  assert.equal(validateScene(missing, context).valid, false);

  const wrongText = clone(scene);
  wrongText.sourceLine.text = "invented code";
  assert.equal(validateScene(wrongText, context).valid, false);

  const badFocus = clone(scene);
  badFocus.focus = { kind: "line", line: 999 };
  assert.equal(validateScene(badFocus, context).valid, false);
});

test("frame and object references must exist in the selected state", () => {
  const context = contextFor("list-mutation", 2);
  const scene = genericBuild("list-mutation", 2).scene;

  const badFrame = clone(scene);
  badFrame.regions[0].items.push({ kind: "frame", frameId: 999 });
  assert.equal(validateScene(badFrame, context).valid, false);

  const badVariableFrame = clone(scene);
  badVariableFrame.regions[1].items.push({
    kind: "variable",
    frameId: 999,
    name: "missing",
    text: "1",
  });
  assert.equal(validateScene(badVariableFrame, context).valid, false);

  const badObject = clone(scene);
  badObject.regions[0].items.push({ kind: "object", objectId: "o999", objectType: "list" });
  assert.equal(validateScene(badObject, context).valid, false);

  const badSlotObject = clone(scene);
  badSlotObject.regions[0].items.push({
    kind: "slot",
    objectId: "o999",
    index: 0,
    text: "1",
  });
  assert.equal(validateScene(badSlotObject, context).valid, false);
});

test("array indices and displayed values are re-derived from the trace", () => {
  const context = contextFor("list-mutation", 2);
  const scene = genericBuild("list-mutation", 2).scene;
  const slot = slotItems(scene).find((item) => Number.isInteger(item.index));
  assert.ok(slot, "the fixture has an indexed slot");

  const badIndex = clone(scene);
  const badIndexSlot = slotItems(badIndex).find(
    (item) => item.objectId === slot.objectId && item.index === slot.index,
  );
  badIndexSlot.index = 999;
  assert.equal(validateScene(badIndex, context).valid, false);

  const badText = clone(scene);
  const badTextSlot = slotItems(badText).find(
    (item) => item.objectId === slot.objectId && item.index === slot.index,
  );
  badTextSlot.text = "9999";
  assert.equal(validateScene(badText, context).valid, false);

  const badType = clone(scene);
  const badTypeSlot = slotItems(badType).find(
    (item) => item.objectId === slot.objectId && item.index === slot.index,
  );
  badTypeSlot.valueType = "str";
  assert.equal(validateScene(badType, context).valid, false);
});

test("changes, output and event state cannot be invented", () => {
  const context = contextFor("list-mutation", 2);
  const scene = genericBuild("list-mutation", 2).scene;

  const badChange = clone(scene);
  badChange.changes[0].to = "invented";
  assert.equal(validateScene(badChange, context).valid, false);

  const badEvent = clone(scene);
  const event = badEvent.regions
    .flatMap((region) => region.items)
    .find((item) => item.kind === "event");
  event.eventKind = "return";
  assert.equal(validateScene(badEvent, context).valid, false);

  const output = firstSceneWhere((candidate) => hasRegion(candidate, "output"));
  const outputContext = contextFor(output.name, output.index);
  const badOutput = clone(output.scene);
  const outputItem = badOutput.regions
    .flatMap((region) => region.items)
    .find((item) => item.kind === "output");
  outputItem.text = "invented output";
  assert.equal(validateScene(badOutput, outputContext).valid, false);
});

test("partial, unsupported, syntax-error and exception scenes stay explicit", () => {
  const limited = genericBuild("limit-steps", 0);
  assert.equal(limited.validation.valid, true, limited.validation.errors.join("\n"));
  assert.equal(limited.scene.status, "partial");
  assert.match(limited.scene.unsupportedReason, /step_limit/);

  const emptyView = getStepView([], 0, "");
  const empty = DEFAULT_REGISTRY.build("generic", {
    stepView: emptyView,
    trace: [],
    traceIndex: getTraceIndex([]),
    source: "",
  });
  assert.equal(empty.validation.valid, true, empty.validation.errors.join("\n"));
  assert.equal(empty.scene.status, "unsupported");
  assert.ok(empty.scene.unsupportedReason);

  for (const name of ["error-syntax", "error-division", "exception-caught"]) {
    const built = genericBuild(name, 0);
    assert.equal(built.validation.valid, true, `${name}: ${built.validation.errors.join("\n")}`);
    assert.equal(built.scene.adapterId, "generic");
  }
});

test("historical references need an explicit declaration", () => {
  const context = contextFor("recursion", 5);
  const scene = genericBuild("recursion", 5).scene;
  const current = scene.regions
    .find((region) => region.kind === "stack")
    ?.items.map((item) => item.frameId) ?? [];
  const historical = [...context.traceIndex.frames.keys()].find((id) => !current.includes(id));
  assert.ok(historical != null, "the recursion fixture has a returned frame");

  const marked = clone(scene);
  marked.regions[0].items.push({ kind: "frame", frameId: historical, historical: true });
  assert.equal(validateScene(marked, context).valid, true);

  const unmarked = clone(scene);
  unmarked.regions[0].items.push({ kind: "frame", frameId: historical });
  assert.equal(validateScene(unmarked, context).valid, false);
});

test("building and validating never mutate the trace, StepView or scene", () => {
  const entry = CORPUS["list-mutation"];
  const traceBefore = JSON.stringify(entry.trace);
  const view = getStepView(entry.trace, 2, entry.source);
  const viewBefore = JSON.stringify(view);
  const context = {
    stepView: view,
    trace: entry.trace,
    traceIndex: getTraceIndex(entry.trace),
    source: entry.source,
    profile: RECOGNITION.corpus_profiles["list-mutation"],
    recognition: recognitionFor("list-mutation"),
    result: entry.result,
  };

  const built = DEFAULT_REGISTRY.build("generic", context);
  const sceneBefore = JSON.stringify(built.scene);
  validateScene(built.scene, { ...context, adapterId: "generic" });

  assert.equal(JSON.stringify(entry.trace), traceBefore);
  assert.equal(JSON.stringify(view), viewBefore);
  assert.equal(JSON.stringify(built.scene), sceneBefore);
});
