// Phase 7 sorting adapter: real list objects, traced changes, honest partials.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { test } from "node:test";

import { DEFAULT_REGISTRY } from "./adapters.js";
import { recognizeProgram } from "./recognition.js";
import { validateScene } from "./scene.js";
import { SORTING_ADAPTER } from "./sortingAdapter.js";
import { getStepView } from "./stepView.js";
import { getTraceIndex } from "./traceIndex.js";

const RECOGNITION = JSON.parse(
  gunzipSync(readFileSync(new URL("./__fixtures__/recognition.json.gz", import.meta.url))),
);
const recognitionCache = new Map();

const SORT_FIXTURES = [
  "bubble-sort",
  "bubble-sorted",
  "bubble-duplicates",
  "bubble-reverse",
  "bubble-negative",
  "bubble-empty",
  "bubble-single",
  "bubble-alias",
  "bubble-truncated",
  "selection-sort",
  "insertion-sort",
  "merge-sort",
  "merge-sort-duplicates",
  "merge-sort-empty",
  "sort-mixed",
  "builtin-sort",
  "builtin-sorted",
  "plain-loop",
  "dict-iteration",
  "filter-list",
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

function built(name, index, requested = "sorting") {
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

function lastSpecialized(name) {
  const entry = RECOGNITION.programs[name];
  for (let index = entry.trace.length - 1; index >= 0; index -= 1) {
    if (built(name, index).adapterId === "sorting") return index;
  }
  throw new Error(`no specialized step in ${name}`);
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

function values(scene, id = "sequence") {
  return slots(scene, id).map((slot) => slot.text);
}

function assertValid(builtScene, where) {
  assert.equal(
    builtScene.validation.valid,
    true,
    `${where}: ${builtScene.validation.errors.join("\n")}`,
  );
}

test("exchange sort tracks the real list, adjacent comparison and swap changes", () => {
  const comparison = built(
    "bubble-sort",
    firstStep(
      "bubble-sort",
      (view) =>
        view.kind === "line" &&
        view.line === 4 &&
        topVar(view, "i")?.value === 0 &&
        topVar(view, "j")?.value === 2,
    ),
  );
  assertValid(comparison, "exchange comparison");
  assert.equal(comparison.adapterId, "sorting");
  assert.equal(comparison.scene.title, "Exchange sort");
  assert.deepEqual(values(comparison.scene), ["2", "4", "5", "1", "3"]);
  assert.deepEqual(variables(comparison.scene), { i: "0", j: "2" });
  assert.deepEqual(
    comparison.scene.highlights.map((item) => [item.index, item.tone]),
    [[2, "focus"], [3, "focus"]],
  );

  const swap = built(
    "bubble-sort",
    firstStep("bubble-sort", (view) => view.kind === "line" && view.line === 5),
  );
  assertValid(swap, "exchange swap");
  assert.equal(swap.scene.changes.length, 2);
  assert.ok(swap.scene.changes.every((item) => item.kind === "change"));

  const final = built("bubble-sort", lastSpecialized("bubble-sort"));
  assert.deepEqual(values(final.scene), ["1", "2", "3", "4", "5"]);
  assert.match(final.scene.subtitle, /recorded suffix/);
});

test("selection and insertion show the indices and shifts the trace proves", () => {
  const selected = built(
    "selection-sort",
    firstStep("selection-sort", (view) => view.kind === "line" && view.line === 5),
  );
  assertValid(selected, "selection comparison");
  assert.equal(selected.scene.title, "Selection sort");
  assert.equal(variables(selected.scene).smallest, "0");
  assert.equal(variables(selected.scene).j, "1");
  assert.deepEqual(
    selected.scene.highlights.map((item) => item.index),
    [0, 1],
  );
  assert.deepEqual(values(built("selection-sort", lastSpecialized("selection-sort")).scene), [
    "1",
    "2",
    "3",
    "4",
    "5",
  ]);

  const skipped = built(
    "insertion-sort",
    firstStep(
      "insertion-sort",
      (view) => view.kind === "line" && view.line === 5 && topVar(view, "j")?.value === -1,
    ),
  );
  assertValid(skipped, "insertion short-circuit");
  assert.equal(skipped.scene.title, "Insertion sort");
  assert.equal(variables(skipped.scene).j, "-1");
  assert.equal(variables(skipped.scene).key, "2");
  assert.deepEqual(skipped.scene.highlights.filter((item) => item.tone === "focus"), []);

  const compared = built(
    "insertion-sort",
    firstStep(
      "insertion-sort",
      (view) => view.kind === "line" && view.line === 5 && topVar(view, "j")?.value >= 0,
    ),
  );
  assertValid(compared, "insertion comparison");
  assert.ok(
    compared.scene.highlights.some(
      (item) => item.tone === "focus" && item.index === Number(variables(compared.scene).j),
    ),
  );

  const shifted = built(
    "insertion-sort",
    firstStep(
      "insertion-sort",
      (view) => view.kind === "line" && view.line === 6 && topVar(view, "j")?.value >= 0,
    ),
  );
  assertValid(shifted, "insertion shift");
  assert.ok(shifted.scene.changes.length > 0);
  assert.ok(shifted.scene.changes.some((item) => item.name.includes("values[")));
  assert.deepEqual(values(built("insertion-sort", lastSpecialized("insertion-sort")).scene), [
    "1",
    "2",
    "3",
    "4",
    "5",
  ]);
});

test("divide-and-conquer sorting keeps recursion available and shows real runs", () => {
  const step = firstStep(
    "merge-sort",
    (view) => view.kind === "line" && view.line === 14,
  );
  const sorting = built("merge-sort", step, "sorting");
  const recursion = built("merge-sort", step, "recursion");
  assertValid(sorting, "combine comparison sorting");
  assertValid(recursion, "combine comparison recursion");
  assert.equal(sorting.adapterId, "sorting");
  assert.equal(recursion.adapterId, "recursion");
  assert.equal(sorting.scene.title, "Divide-and-conquer sort");
  assert.equal(sorting.scene.meta.recognition.adapterId, "sorting");
  assert.ok(region(sorting.scene, "sequence-left"));
  assert.ok(region(sorting.scene, "sequence-right"));
  assert.ok(
    sorting.scene.highlights.some((item) => item.kind === "slot" && item.tone === "focus"),
  );

  const baseReturn = built(
    "merge-sort",
    firstStep(
      "merge-sort",
      (view) =>
        view.kind === "return" && view.function === "merge_sort" && view.line === 3,
    ),
  );
  assertValid(baseReturn, "base case return");
  assert.doesNotMatch(baseReturn.scene.accessibility.summary, /combined prefix/);

  const final = built("merge-sort", lastSpecialized("merge-sort"));
  assert.deepEqual(values(final.scene), ["3", "9", "10", "27", "38", "43", "82"]);
  assert.ok(region(final.scene, "sequence-left"));
  assert.ok(region(final.scene, "sequence-right"));
  assert.match(final.scene.accessibility.summary, /combined prefix/);
  assert.match(final.scene.accessibility.summary, /does not claim the whole input is sorted/);

  const duplicates = built("merge-sort-duplicates", lastSpecialized("merge-sort-duplicates"));
  assert.deepEqual(values(duplicates.scene), ["1", "2", "3", "3"]);

  const empty = built("merge-sort-empty", lastSpecialized("merge-sort-empty"));
  assertValid(empty, "empty divide-and-conquer sort");
  assert.deepEqual(values(empty.scene), []);
  assert.equal(empty.scene.status, "ok");
  assert.deepEqual(
    DEFAULT_REGISTRY.byCapability("sorting").map((adapter) => adapter.id),
    ["sorting"],
  );
});

test("already-sorted, reverse, negative, empty, single and duplicate inputs stay real", () => {
  const expected = [
    ["bubble-sorted", ["1", "2", "3", "4", "5"]],
    ["bubble-reverse", ["1", "2", "3", "4", "5"]],
    ["bubble-negative", ["-3", "-1", "0", "2"]],
    ["bubble-duplicates", ["1", "2", "3", "3"]],
    ["bubble-empty", []],
    ["bubble-single", ["7"]],
  ];
  for (const [name, valuesExpected] of expected) {
    const scene = built(name, lastSpecialized(name)).scene;
    assert.deepEqual(values(scene), valuesExpected, name);
    assert.ok(["ok", "partial"].includes(scene.status), name);
  }
});

test("aliases and truncated lists are tracked by object and never filled in", () => {
  const alias = built(
    "bubble-alias",
    firstStep(
      "bubble-alias",
      (view) => view.kind === "line" && view.line === 6 && topVar(view, "j")?.value === 1,
    ),
  );
  assertValid(alias, "aliased sort");
  const label = objectItem(alias.scene).label;
  assert.match(label, /alias/);
  assert.match(label, /numbers/);
  assert.deepEqual(values(alias.scene), ["1", "3", "2"]);
  assert.ok(alias.scene.changes.some((item) => item.name.includes("alias")));

  const truncated = built("bubble-truncated", lastSpecialized("bubble-truncated"));
  assertValid(truncated, "truncated sort");
  assert.equal(truncated.scene.status, "partial");
  assert.match(truncated.scene.unsupportedReason, /truncated: 5 more/);
  assert.equal(slots(truncated.scene).length, 30);
  assert.equal(slots(truncated.scene).some((slot) => slot.index >= 30), false);
});

test("mixed types are partial, and built-in ordering falls back to generic", () => {
  const mixed = built(
    "sort-mixed",
    firstStep("sort-mixed", (view) => view.kind === "line" && view.line === 3),
  );
  assertValid(mixed, "mixed sort");
  assert.equal(mixed.scene.status, "partial");
  assert.match(mixed.scene.unsupportedReason, /mixed value types/);
  assert.deepEqual(values(mixed.scene), ["3", "\"a\"", "2"]);
  assert.deepEqual(
    mixed.scene.highlights.map((item) => item.index),
    [0, 1],
  );

  const mixedEnd = built("sort-mixed", RECOGNITION.programs["sort-mixed"].trace.length - 1);
  assert.equal(mixedEnd.adapterId, "sorting");
  assert.equal(mixedEnd.scene.status, "partial");
  assert.match(mixedEnd.scene.unsupportedReason, /mixed value types/);

  const beforeList = built("sort-mixed", 0);
  assert.equal(beforeList.adapterId, "generic");
  assert.ok(beforeList.fallbackReason.length > 0);

  for (const name of ["builtin-sort", "builtin-sorted", "plain-loop", "dict-iteration", "filter-list"]) {
    const fallback = built(name, 2, "sorting");
    assert.equal(fallback.adapterId, "generic", name);
    assert.ok(fallback.fallbackReason.length > 0, name);
    assert.equal(region(fallback.scene, "sequence"), null, name);
    assertValid(fallback, `${name} fallback`);
  }
});

test("every step of every sorting fixture is valid and deterministic", () => {
  let specialized = 0;
  for (const name of SORT_FIXTURES) {
    const entry = RECOGNITION.programs[name];
    for (let index = 0; index < entry.trace.length; index += 1) {
      const context = contextFor(name, index);
      const direct = SORTING_ADAPTER.build(context);
      const directValidation = validateScene(direct, {
        ...context,
        adapterId: "sorting",
      });
      assert.equal(
        directValidation.valid,
        true,
        `${name} step ${index} direct: ${directValidation.errors.join("\n")}`,
      );

      const registry = DEFAULT_REGISTRY.build("sorting", context);
      assertValid(registry, `${name} step ${index}`);
      if (registry.adapterId === "sorting") {
        specialized += 1;
        assert.equal(registry.scene.adapterId, "sorting");
        assert.equal(registry.scene.meta.stepIndex, index);
      }
    }

    const sample = Math.min(4, entry.trace.length - 1);
    assert.deepEqual(
      DEFAULT_REGISTRY.build("sorting", contextFor(name, sample)),
      DEFAULT_REGISTRY.build("sorting", contextFor(name, sample)),
      `${name} is deterministic`,
    );
  }
  assert.ok(specialized > 150, `only ${specialized} specialized sorting steps`);
});

test("a forged sorting scene is rejected, never weakened", () => {
  const context = contextFor(
    "bubble-sort",
    firstStep("bubble-sort", (view) => view.kind === "line" && view.line === 4),
  );
  const scene = structuredClone(SORTING_ADAPTER.build(context));
  const sequence = scene.regions.find((item) => item.id === "sequence");
  sequence.items.find((item) => item.kind === "slot").index = 999;
  const validation = validateScene(scene, { ...context, adapterId: "sorting" });
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.length > 0);
});
