// Phase 7 searching adapter: real traces, real sequences, no invented indices.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { test } from "node:test";

import { DEFAULT_REGISTRY } from "./adapters.js";
import { recognizeProgram } from "./recognition.js";
import { validateScene } from "./scene.js";
import { SEARCHING_ADAPTER } from "./searchingAdapter.js";
import { getStepView } from "./stepView.js";
import { getTraceIndex } from "./traceIndex.js";

const RECOGNITION = JSON.parse(
  gunzipSync(readFileSync(new URL("./__fixtures__/recognition.json.gz", import.meta.url))),
);
const recognitionCache = new Map();

const SEARCH_FIXTURES = [
  "linear-index",
  "linear-item",
  "linear-first",
  "linear-last",
  "linear-missing",
  "linear-duplicates",
  "linear-empty",
  "linear-tuple",
  "linear-item-duplicates",
  "linear-dict",
  "linear-mixed",
  "linear-alias",
  "linear-break",
  "linear-flag",
  "linear-helper",
  "linear-enumerate",
  "linear-while",
  "linear-truncated",
  "binary-search",
  "binary-missing",
  "binary-one",
  "binary-one-missing",
  "binary-first",
  "binary-last",
  "binary-duplicates",
  "binary-empty",
  "recursive-binary-search",
];

function recognitionFor(name) {
  if (recognitionCache.has(name)) return recognitionCache.get(name);
  const entry = RECOGNITION.programs[name];
  const result = recognizeProgram({
    profile: entry.profile,
    trace: entry.trace,
    status: entry.status,
  });
  recognitionCache.set(name, result);
  return result;
}

function contextFor(name, index) {
  const entry = RECOGNITION.programs[name];
  return {
    stepView: getStepView(entry.trace, index, entry.source),
    trace: entry.trace,
    traceIndex: getTraceIndex(entry.trace),
    source: entry.source,
    profile: entry.profile,
    recognition: recognitionFor(name),
    result: { status: entry.status },
  };
}

function built(name, index, requested = "searching") {
  return DEFAULT_REGISTRY.build(requested, contextFor(name, index));
}

function firstStep(name, predicate) {
  const entry = RECOGNITION.programs[name];
  for (let index = 0; index < entry.trace.length; index += 1) {
    const view = getStepView(entry.trace, index, entry.source);
    if (predicate(view, index)) return index;
  }
  throw new Error(`no matching step in ${name}`);
}

function returnStep(name, functionName) {
  const entry = RECOGNITION.programs[name];
  for (let index = entry.trace.length - 1; index >= 0; index -= 1) {
    const view = getStepView(entry.trace, index, entry.source);
    if (view.kind === "return" && view.function === functionName) return index;
  }
  throw new Error(`no return step for ${functionName}`);
}

function topVar(view, name) {
  return view.frames?.at(-1)?.variables?.[name] ?? null;
}

function region(scene, id) {
  return scene.regions.find((item) => item.id === id) ?? null;
}

function slots(scene, id = "sequence") {
  return (region(scene, id)?.items ?? []).filter((item) => item.kind === "slot");
}

function objectItem(scene, id = "sequence") {
  return (region(scene, id)?.items ?? []).find((item) => item.kind === "object") ?? null;
}

function variables(scene) {
  return Object.fromEntries(
    (region(scene, "state")?.items ?? []).map((item) => [item.name, item.text]),
  );
}

function contextItem(scene, name) {
  return (region(scene, "context")?.items ?? []).find(
    (item) => item.kind === "context" && item.name === name,
  ) ?? null;
}

function assertValid(builtScene, where) {
  assert.equal(
    builtScene.validation.valid,
    true,
    `${where}: ${builtScene.validation.errors.join("\n")}`,
  );
}

test("indexed linear search shows the real list, index, target and outcome", () => {
  const step = firstStep(
    "linear-index",
    (view) => view.kind === "line" && view.line === 3 && topVar(view, "i")?.value === 1,
  );
  const builtScene = built("linear-index", step);
  assertValid(builtScene, "linear comparison");
  assert.equal(builtScene.adapterId, "searching");
  assert.equal(builtScene.scene.status, "ok");
  assert.equal(objectItem(builtScene.scene).objectType, "list");
  assert.deepEqual(
    slots(builtScene.scene).map((slot) => [slot.index, slot.text]),
    [[0, "4"], [1, "7"], [2, "1"], [3, "9"]],
  );
  assert.deepEqual(variables(builtScene.scene), { target: "7", i: "1" });
  assert.deepEqual(
    builtScene.scene.highlights.map((item) => [item.index, item.tone]),
    [[1, "focus"]],
  );

  const returned = built("linear-index", returnStep("linear-index", "linear_search"));
  assertValid(returned, "linear return");
  assert.equal(contextItem(returned.scene, "return value")?.text, "1");
  assert.match(returned.scene.accessibility.summary, /found at index 1/);
});

test("first, middle, last and missing linear targets come from the trace", () => {
  const cases = [
    ["linear-first", 0, "found at index 0"],
    ["linear-index", 1, "found at index 1"],
    ["linear-last", 3, "found at index 3"],
    ["linear-missing", null, "not found"],
  ];
  for (const [name, foundIndex, text] of cases) {
    const scene = built(name, returnStep(name, "linear_search")).scene;
    assert.match(scene.accessibility.summary, new RegExp(text));
    if (foundIndex === null) {
      assert.deepEqual(scene.highlights.filter((item) => item.tone === "focus"), []);
    } else {
      assert.ok(
        scene.highlights.some((item) => item.index === foundIndex && item.tone === "focus"),
      );
    }
  }
});

test("duplicate values are shown, and item iteration never invents one index", () => {
  const indexed = built(
    "linear-duplicates",
    firstStep(
      "linear-duplicates",
      (view) => view.kind === "line" && view.line === 3 && topVar(view, "i")?.value === 1,
    ),
  );
  assertValid(indexed, "duplicate indexed comparison");
  assert.deepEqual(
    slots(indexed.scene).map((slot) => slot.text),
    ["4", "7", "7", "9"],
  );
  assert.deepEqual(
    indexed.scene.highlights.map((item) => [item.index, item.tone]),
    [[1, "focus"]],
  );

  const item = built(
    "linear-item-duplicates",
    firstStep(
      "linear-item-duplicates",
      (view) => view.kind === "line" && view.line === 3 && topVar(view, "item")?.value === 7,
    ),
  );
  assertValid(item, "duplicate item comparison");
  assert.equal(item.scene.status, "partial");
  assert.match(item.scene.unsupportedReason, /occurs more than once/);
  assert.deepEqual(item.scene.highlights.filter((entry) => entry.tone === "focus"), []);
  assert.deepEqual(
    slots(item.scene).map((slot) => slot.text),
    ["4", "7", "7", "9"],
  );
});

test("empty lists and tuples are grounded in the real sequence object", () => {
  const empty = built("linear-empty", returnStep("linear-empty", "linear_search"));
  assertValid(empty, "empty linear search");
  assert.equal(objectItem(empty.scene).objectType, "list");
  assert.deepEqual(slots(empty.scene), []);
  assert.equal(contextItem(empty.scene, "return value")?.text, "-1");
  assert.match(empty.scene.accessibility.summary, /sequence is empty/i);

  const tuple = built("linear-tuple", returnStep("linear-tuple", "linear_search"));
  assertValid(tuple, "tuple linear search");
  assert.equal(objectItem(tuple.scene).objectType, "tuple");
  assert.deepEqual(
    slots(tuple.scene).map((slot) => slot.text),
    ["2", "4", "6"],
  );
  assert.match(tuple.scene.accessibility.summary, /found at index 2/);

  const binaryEmpty = built("binary-empty", returnStep("binary-empty", "binary_search"));
  assertValid(binaryEmpty, "empty binary search");
  assert.deepEqual(slots(binaryEmpty.scene), []);
  assert.match(binaryEmpty.scene.accessibility.summary, /not found/);
});

test("binary search shows recorded bounds, midpoint, range and every outcome shape", () => {
  const comparison = built(
    "binary-search",
    firstStep("binary-search", (view) => view.kind === "line" && view.line === 8),
  );
  assertValid(comparison, "binary comparison");
  assert.deepEqual(variables(comparison.scene), {
    target: "7",
    mid: "2",
    low: "0",
    high: "5",
  });
  assert.equal(
    comparison.scene.highlights.find((item) => item.tone === "focus")?.index,
    2,
  );
  assert.ok(comparison.scene.highlights.some((item) => item.index === 5 && item.tone === "muted"));

  const found = built("binary-search", returnStep("binary-search", "binary_search"));
  assert.equal(contextItem(found.scene, "return value")?.text, "3");
  assert.ok(found.scene.highlights.some((item) => item.index === 3 && item.tone === "focus"));

  const outcomes = [
    ["binary-missing", /not found/],
    ["binary-one", /found at index 0/],
    ["binary-one-missing", /not found/],
    ["binary-first", /found at index 0/],
    ["binary-last", /found at index 4/],
    ["binary-duplicates", /found at index \d/],
  ];
  for (const [name, pattern] of outcomes) {
    const scene = built(name, returnStep(name, "binary_search")).scene;
    assert.match(scene.accessibility.summary, pattern);
  }
});

test("recursive binary search remains both a searching and a recursion view", () => {
  const step = firstStep(
    "recursive-binary-search",
    (view) => view.kind === "line" && view.line === 5,
  );
  const searching = built("recursive-binary-search", step, "searching");
  const recursion = built("recursive-binary-search", step, "recursion");
  assertValid(searching, "recursive binary searching");
  assertValid(recursion, "recursive binary recursion");
  assert.equal(searching.adapterId, "searching");
  assert.equal(recursion.adapterId, "recursion");
  assert.equal(searching.scene.meta.recognition.adapterId, "recursion");
  assert.deepEqual(searching.scene.capabilities, ["searching"]);
  assert.deepEqual(
    DEFAULT_REGISTRY.byCapability("searching").map((adapter) => adapter.id),
    ["searching"],
  );
  assert.deepEqual(
    DEFAULT_REGISTRY.byCapability("recursion").map((adapter) => adapter.id),
    ["recursion"],
  );
});

test("mixed, aliased and truncated search data is explicit", () => {
  const mixed = built("linear-mixed", returnStep("linear-mixed", "linear_search"));
  assertValid(mixed, "mixed search");
  assert.equal(mixed.scene.status, "partial");
  assert.match(mixed.scene.unsupportedReason, /mixed value types/);
  assert.deepEqual(
    slots(mixed.scene).map((slot) => slot.text),
    ["1", "\"a\"", "2"],
  );

  const alias = built("linear-alias", returnStep("linear-alias", "linear_search"));
  assertValid(alias, "aliased search");
  const label = objectItem(alias.scene).label;
  assert.match(label, /alias/);
  assert.match(label, /values/);

  const truncated = built(
    "linear-truncated",
    firstStep("linear-truncated", (view) => view.kind === "line" && view.line === 3),
  );
  assertValid(truncated, "truncated search");
  assert.equal(truncated.scene.status, "partial");
  assert.match(truncated.scene.unsupportedReason, /truncated: 5 more/);
  assert.equal(slots(truncated.scene).length, 30);
  assert.equal(slots(truncated.scene).some((slot) => slot.index >= 30), false);
});

test("break, flag, helper and enumerate shapes stay generic with a reason", () => {
  for (const name of [
    "linear-break",
    "linear-flag",
    "linear-helper",
    "linear-enumerate",
  ]) {
    const fallback = built(name, 2, "searching");
    assert.equal(fallback.adapterId, "generic", name);
    assert.match(fallback.fallbackReason, /do not contain a trace-backed/, name);
    assertValid(fallback, `${name} fallback`);
  }
});

test("a while-loop linear search is traced without inventing a return", () => {
  const scene = built(
    "linear-while",
    returnStep("linear-while", "linear_search"),
  );
  assertValid(scene, "while loop search");
  assert.deepEqual(
    slots(scene.scene).map((slot) => slot.text),
    ["4", "7", "1", "9"],
  );
  assert.match(scene.scene.accessibility.summary, /found at index 3/);
});

test("unsupported containers fall back to generic with a reason", () => {
  for (const name of ["linear-dict", "count-matches", "max-scan", "plain-loop"]) {
    const fallback = built(name, 0, "searching");
    assert.equal(fallback.adapterId, "generic", name);
    assert.ok(fallback.fallbackReason.length > 0, name);
    assertValid(fallback, `${name} fallback`);
  }
});

test("every step of every search fixture is valid and deterministic", () => {
  let specialized = 0;
  for (const name of SEARCH_FIXTURES) {
    const entry = RECOGNITION.programs[name];
    for (let index = 0; index < entry.trace.length; index += 1) {
      const context = contextFor(name, index);
      const direct = SEARCHING_ADAPTER.build(context);
      const directValidation = validateScene(direct, {
        ...context,
        adapterId: "searching",
      });
      assert.equal(
        directValidation.valid,
        true,
        `${name} step ${index} direct: ${directValidation.errors.join("\n")}`,
      );

      const registry = DEFAULT_REGISTRY.build("searching", context);
      assertValid(registry, `${name} step ${index}`);
      if (registry.adapterId === "searching") {
        specialized += 1;
        assert.equal(registry.scene.adapterId, "searching");
        assert.equal(registry.scene.meta.stepIndex, index);
      }
    }

    const sample = Math.min(3, entry.trace.length - 1);
    assert.deepEqual(
      DEFAULT_REGISTRY.build("searching", contextFor(name, sample)),
      DEFAULT_REGISTRY.build("searching", contextFor(name, sample)),
      `${name} is deterministic`,
    );
  }
  assert.ok(specialized > 100, `only ${specialized} specialized search steps`);
});

test("a forged searching scene is rejected, never weakened", () => {
  const context = contextFor(
    "linear-index",
    firstStep(
      "linear-index",
      (view) => view.kind === "line" && view.line === 3 && topVar(view, "i")?.value === 1,
    ),
  );
  const scene = structuredClone(SEARCHING_ADAPTER.build(context));
  const sequence = scene.regions.find((item) => item.id === "sequence");
  sequence.items.find((item) => item.kind === "slot").text = "999";
  const validation = validateScene(scene, { ...context, adapterId: "searching" });
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.length > 0);
});
