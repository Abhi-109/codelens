// The adaptive canvas must offer what the trace supports, keep the selection
// on the same cursor, and fall back to the validated generic scene with a
// reason when a manual or automatic choice is unavailable.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";

import { recognizeProgram } from "../tracer/recognition.js";
import { getStepView } from "../tracer/stepView.js";
import { getTraceIndex } from "../tracer/traceIndex.js";
import {
  ADAPTER_IDS,
  ADAPTER_STATE,
  adapterLabel,
  adapterOptions,
  autoAdapterId,
  buildAdaptiveScene,
  isAdapterChoice,
  requestedAdapterId,
  resolveAdaptiveView,
} from "./adaptive.js";

const PROGRAMS = JSON.parse(
  gunzipSync(readFileSync(new URL("../tracer/__fixtures__/recognition.json.gz", import.meta.url))),
).programs;

const recognitionCache = new Map();

function recognitionFor(name) {
  if (recognitionCache.has(name)) return recognitionCache.get(name);
  const program = PROGRAMS[name];
  const result = recognizeProgram({
    profile: program.profile,
    trace: program.trace,
    status: program.status,
  });
  recognitionCache.set(name, result);
  return result;
}

function contextAt(name, index) {
  const program = PROGRAMS[name];
  const trace = program.trace;
  return {
    stepView: getStepView(trace, index, program.source),
    trace,
    traceIndex: getTraceIndex(trace),
    source: program.source,
    profile: program.profile,
    recognition: recognitionFor(name),
    result: { status: program.status, trace },
  };
}

function firstContext(name, predicate) {
  const program = PROGRAMS[name];
  for (let index = 0; index < program.trace.length; index += 1) {
    const context = contextAt(name, index);
    if (predicate(context)) return context;
  }
  assert.fail(`no step of ${name} matched`);
}

function choice(options, id) {
  return options.choices.find((entry) => entry.id === id);
}

test("recognition labels the adapter used by Auto without a second classifier", () => {
  assert.equal(recognitionFor("bubble-sort").adapterId, "sorting");
  assert.equal(recognitionFor("merge-sort").adapterId, "sorting");
  assert.equal(recognitionFor("recursive-binary-search").adapterId, "recursion");
  assert.equal(recognitionFor("linear-break").adapterId, "generic");

  assert.equal(autoAdapterId({ adapterId: "sorting" }), "sorting");
  assert.equal(autoAdapterId({ adapterId: "not-registered" }), "generic");
  assert.equal(autoAdapterId(null), "generic");
  assert.equal(requestedAdapterId("auto", { adapterId: "searching" }), "searching");
  assert.equal(requestedAdapterId("generic", { adapterId: "sorting" }), "generic");
  assert.equal(isAdapterChoice("auto"), true);
  assert.equal(isAdapterChoice("tree"), false);
  assert.equal(adapterLabel("searching"), "Searching");
  assert.deepEqual(ADAPTER_IDS, ["auto", "generic", "recursion", "searching", "sorting"]);
});

test("a merge sort exposes both its sorting and recursion capabilities", () => {
  const context = firstContext("merge-sort", (candidate) => {
    const options = adapterOptions(candidate);
    return choice(options, "sorting").available && choice(options, "recursion").available;
  });
  const options = adapterOptions(context);

  assert.equal(options.recognitionId, "sorting");
  assert.equal(choice(options, "sorting").available, true);
  assert.equal(choice(options, "recursion").available, true);
  assert.equal(choice(options, "sorting").recognized, true);
  assert.equal(choice(options, "auto").target, "sorting");
});

test("a recursive binary search exposes recursion and searching together", () => {
  const context = firstContext("recursive-binary-search", (candidate) => {
    const options = adapterOptions(candidate);
    return choice(options, "recursion").available && choice(options, "searching").available;
  });
  const options = adapterOptions(context);

  assert.equal(options.recognitionId, "recursion");
  assert.equal(choice(options, "recursion").available, true);
  assert.equal(choice(options, "searching").available, true);
  assert.equal(choice(options, "searching").recognized, false);
});

test("generic is always offered and unsupported families say why", () => {
  const context = contextAt("linear-break", 0);
  const options = adapterOptions(context);

  assert.equal(options.recognitionId, "generic");
  assert.equal(choice(options, "generic").available, true);
  assert.equal(choice(options, "generic").reason, null);
  assert.equal(choice(options, "auto").available, true);
  assert.match(choice(options, "auto").reason, /specialized adapter|specialized pattern/i);
  for (const id of ["recursion", "searching", "sorting"]) {
    const entry = choice(options, id);
    assert.equal(entry.available, false, id);
    assert.equal(typeof entry.reason, "string");
    assert.ok(entry.reason.length > 0);
  }
});

test("Auto builds the recognized scene and every build is validated", () => {
  const context = firstContext("bubble-sort", (candidate) => {
    const built = buildAdaptiveScene("auto", candidate);
    return built.adapterId === "sorting" && built.validation.valid;
  });
  const built = buildAdaptiveScene("auto", context);

  assert.equal(built.choice, "auto");
  assert.equal(built.requestedAdapterId, "sorting");
  assert.equal(built.adapterId, "sorting");
  assert.equal(built.validation.valid, true, built.validation.errors.join("\n"));
  assert.equal(built.scene.meta.stepIndex, context.stepView.index);
  assert.equal(built.scene.sourceLine.line, context.stepView.line);
  assert.equal(built.fallbackReason, null);
  assert.equal(JSON.parse(JSON.stringify(built.scene)).kind, "visualization_scene");
});

test("choosing Generic keeps the selected step and draws the generic scene", () => {
  const context = firstContext("bubble-sort", (candidate) => {
    const built = buildAdaptiveScene("sorting", candidate);
    return built.adapterId === "sorting";
  });
  const generic = buildAdaptiveScene("generic", context);
  const sorting = buildAdaptiveScene("sorting", context);

  assert.equal(generic.adapterId, "generic");
  assert.equal(sorting.adapterId, "sorting");
  assert.equal(generic.scene.meta.stepIndex, context.stepView.index);
  assert.equal(sorting.scene.meta.stepIndex, context.stepView.index);
  assert.equal(generic.scene.sourceLine.line, context.stepView.line);
});

test("an unavailable manual choice falls back to generic with the adapter's reason", () => {
  const context = contextAt("bubble-sort", 0);
  const built = buildAdaptiveScene("searching", context);

  assert.equal(built.adapterId, "generic");
  assert.match(built.fallbackReason, /search/i);
  assert.equal(built.validation.valid, true, built.validation.errors.join("\n"));
  assert.equal(built.scene.meta.stepIndex, context.stepView.index);
});

test("an empty trace produces an explicit unsupported scene, not a guessed one", () => {
  const built = buildAdaptiveScene("auto", {
    stepView: getStepView([], 0, ""),
    trace: [],
    source: "",
    profile: null,
    recognition: null,
    result: { status: "error", trace: [], error: { type: "SyntaxError", message: "bad" } },
  });

  assert.equal(built.adapterId, "generic");
  assert.equal(built.scene.status, "unsupported");
  assert.match(built.scene.unsupportedReason, /no execution step/i);
  assert.equal(built.validation.valid, true, built.validation.errors.join("\n"));
});

test("scene output is deterministic for the same step", () => {
  const context = firstContext("merge-sort", (candidate) => {
    const built = buildAdaptiveScene("sorting", candidate);
    return built.adapterId === "sorting";
  });
  const first = buildAdaptiveScene("sorting", context);
  const second = buildAdaptiveScene("sorting", context);

  assert.deepEqual(first.scene, second.scene);
  assert.deepEqual(first.scene.highlights, second.scene.highlights);
});

test("an early step says the recognized program lacks step evidence, not that it is unsupported", () => {
  const context = contextAt("merge-sort", 0);
  const options = adapterOptions(context);
  const auto = choice(options, "auto");
  const sorting = choice(options, "sorting");

  assert.equal(options.recognitionId, "sorting");
  assert.equal(sorting.available, false);
  assert.equal(sorting.state, ADAPTER_STATE.waiting);
  assert.equal(auto.state, ADAPTER_STATE.waiting);
  assert.match(auto.reason, /recognized as Sorting/);
  assert.match(auto.reason, /this selected step/);
  assert.match(auto.reason, /Generic/);

  const built = buildAdaptiveScene("auto", context);
  assert.equal(built.adapterId, "generic");
  assert.match(built.fallbackReason, /sorting function|real list/);
  assert.equal(built.scene.meta.stepIndex, 0, "the fallback draws the selected step");
});

test("an unsupported program is not described as waiting for step evidence", () => {
  const options = adapterOptions(contextAt("linear-break", 0));
  const auto = choice(options, "auto");

  assert.equal(auto.state, ADAPTER_STATE.unsupported);
  assert.doesNotMatch(auto.reason, /recognized as/);
  assert.match(auto.reason, /specialized/i);
});

test("a manual adapter preference survives steps where it must fall back", () => {
  const program = PROGRAMS["merge-sort"];
  const early = contextAt("merge-sort", 0);
  const middle = firstContext("merge-sort", (candidate) => {
    const built = buildAdaptiveScene("sorting", candidate);
    return built.adapterId === "sorting";
  });
  const late = contextAt("merge-sort", program.trace.length - 1);

  const earlyBuild = buildAdaptiveScene("sorting", early);
  const middleBuild = buildAdaptiveScene("sorting", middle);
  const lateBuild = buildAdaptiveScene("sorting", late);

  assert.equal(earlyBuild.requestedAdapterId, "sorting");
  assert.equal(earlyBuild.adapterId, "generic");
  assert.equal(middleBuild.requestedAdapterId, "sorting");
  assert.equal(middleBuild.adapterId, "sorting");
  assert.equal(lateBuild.requestedAdapterId, "sorting");
  assert.equal(lateBuild.adapterId, "generic");
  assert.equal(earlyBuild.scene.meta.stepIndex, 0);
  assert.equal(middleBuild.scene.meta.stepIndex, middle.stepView.index);
});

test("the shared resolver returns the chooser and one validated build for a step", () => {
  const context = contextAt("bubble-sort", 12);
  const resolved = resolveAdaptiveView(context, "auto");

  assert.equal(resolved.options.recognitionId, "sorting");
  assert.ok(resolved.built);
  assert.equal(resolved.built.validation.valid, true);
  assert.equal(resolved.built.scene.meta.stepIndex, 12);
});
