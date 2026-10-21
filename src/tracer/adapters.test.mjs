// The registry has to be boring: sorted, immutable, explicit about an unknown
// request, and unable to return a scene the validator has not accepted.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";

import {
  DEFAULT_REGISTRY,
  createAdapterRegistry,
} from "./adapters.js";
import { GENERIC_ADAPTER } from "./genericAdapter.js";
import { recognizeProgram } from "./recognition.js";
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

function clonedGenericScene(context, id, capabilities) {
  const scene = GENERIC_ADAPTER.build({ ...context, requestedAdapterId: id });
  return {
    ...scene,
    adapterId: id,
    capabilities,
    title: `${id} view`,
    meta: { ...scene.meta, requestedAdapterId: id },
  };
}

function adapter(id, capabilities, options = {}) {
  const {
    available = true,
    reason = null,
    build = (context) => clonedGenericScene(context, id, capabilities),
  } = options;
  return {
    id,
    label: `${id} view`,
    description: `${id} test adapter`,
    capabilities,
    availability: () => ({ available, reason }),
    build,
  };
}

test("registry ids and listings are deterministic", () => {
  const registry = createAdapterRegistry([
    adapter("z", ["sorting"]),
    adapter("a", ["searching"]),
    adapter("composite", ["sorting", "recursion"]),
  ]);
  assert.deepEqual(registry.ids(), ["a", "composite", "generic", "z"]);
  assert.deepEqual(
    registry.list().map((entry) => entry.id),
    ["a", "composite", "generic", "z"],
  );
  assert.equal(registry.get("a").id, "a");
  assert.equal(registry.get("missing"), null);
  assert.equal(registry.has("missing"), false);
  assert.deepEqual(createAdapterRegistry(registry.list()).ids(), registry.ids());

  assert.throws(
    () => createAdapterRegistry([adapter("same", ["sorting"]), adapter("same", ["sorting"])]),
    /duplicate adapter id/,
  );
  assert.throws(
    () => createAdapterRegistry([{ id: "bad", capabilities: ["sorting"] }]),
    /label/,
  );
});

test("recursion and sorting capabilities can coexist on one adapter", () => {
  const registry = createAdapterRegistry([
    adapter("composite", ["sorting", "recursion"]),
  ]);
  assert.deepEqual(
    registry.byCapability("sorting").map((entry) => entry.id),
    ["composite"],
  );
  assert.deepEqual(
    registry.byCapability("recursion").map((entry) => entry.id),
    ["composite"],
  );
  assert.deepEqual(
    registry.matching(["recursion", "sorting"]).map((entry) => entry.id),
    ["composite"],
  );

  const built = registry.build("composite", contextFor("recursion", 5));
  assert.equal(built.adapterId, "composite");
  assert.equal(built.validation.valid, true, built.validation.errors.join("\n"));
  assert.deepEqual(built.scene.capabilities, ["sorting", "recursion"]);
});

test("scene construction is deterministic", () => {
  const context = contextFor("list-mutation", 2);
  const first = DEFAULT_REGISTRY.build("generic", context);
  const second = DEFAULT_REGISTRY.build("generic", context);
  assert.deepEqual(second, first);
});

test("an unknown adapter request falls back to generic with a reason", () => {
  const built = DEFAULT_REGISTRY.build("missing", contextFor("list-mutation", 2));
  assert.equal(built.adapterId, "generic");
  assert.equal(built.requestedAdapterId, "missing");
  assert.match(built.fallbackReason, /not registered/);
  assert.equal(built.scene.meta.requestedAdapterId, "missing");
  assert.equal(built.validation.valid, true, built.validation.errors.join("\n"));
});

test("an unavailable adapter reports its own explanation", () => {
  const reason = "the trace does not contain enough comparisons";
  const registry = createAdapterRegistry([
    adapter("special", ["sorting"], { available: false, reason }),
  ]);
  const built = registry.build("special", contextFor("list-mutation", 2));
  assert.equal(built.adapterId, "generic");
  assert.equal(built.fallbackReason, reason);
  assert.equal(built.validation.valid, true, built.validation.errors.join("\n"));
});

test("a specialized scene cannot bypass validation", () => {
  const context = contextFor("list-mutation", 2);
  const broken = adapter("broken", ["sorting"], {
    build: (buildContext) => {
      const scene = clonedGenericScene(buildContext, "broken", ["sorting"]);
      scene.regions[0].items.push({ kind: "object", objectId: "o999", objectType: "list" });
      return scene;
    },
  });
  const thrown = adapter("thrown", ["sorting"], {
    build: () => {
      throw new Error("builder exploded");
    },
  });
  const registry = createAdapterRegistry([broken, thrown]);

  const invalid = registry.build("broken", context);
  assert.equal(invalid.adapterId, "generic");
  assert.match(invalid.fallbackReason, /could not build a valid scene/);
  assert.equal(invalid.validation.valid, true, invalid.validation.errors.join("\n"));

  const crashed = registry.build("thrown", context);
  assert.equal(crashed.adapterId, "generic");
  assert.match(crashed.fallbackReason, /builder exploded/);
  assert.equal(crashed.validation.valid, true, crashed.validation.errors.join("\n"));
});

test("recognition evidence is carried into a generic fallback, not recomputed", () => {
  const context = contextFor("list-mutation", 2);
  const recognition = {
    adapterId: "sorting",
    confidence: 0.95,
    evidence: [
      {
        source: "profile",
        kind: "ordering_comparison",
        detail: "test evidence",
        line: 4,
      },
    ],
    unavailableReason: null,
  };
  const built = DEFAULT_REGISTRY.build("sorting", { ...context, recognition });
  assert.equal(built.adapterId, "generic");
  assert.equal(built.scene.meta.recognition.adapterId, "sorting");
  assert.equal(built.scene.meta.recognition.confidence, 0.95);
  assert.ok(built.scene.evidence.some((item) => item.kind === "ordering_comparison"));
  assert.match(built.fallbackReason, /do not contain|outside|not available|not registered/);
  assert.equal(built.validation.valid, true, built.validation.errors.join("\n"));
});

test("the generic adapter is available for every corpus step", () => {
  let steps = 0;
  for (const [name, entry] of Object.entries(CORPUS)) {
    const recognition = recognitionFor(name);
    const traceIndex = getTraceIndex(entry.trace);
    for (let index = 0; index < entry.trace.length; index += 1) {
      const view = getStepView(entry.trace, index, entry.source);
      const built = DEFAULT_REGISTRY.build("generic", {
        stepView: view,
        trace: entry.trace,
        traceIndex,
        source: entry.source,
        profile: RECOGNITION.corpus_profiles[name],
        recognition,
        result: entry.result,
      });
      steps += 1;
      assert.equal(built.adapterId, "generic", `${name} step ${index}`);
      assert.equal(built.fallbackReason, null, `${name} step ${index}`);
      assert.equal(
        built.validation.valid,
        true,
        `${name} step ${index}: ${built.validation.errors.join("; ")}`,
      );
      assert.equal(built.scene.adapterId, "generic");
      assert.ok(built.scene.accessibility.label.length > 0);
    }
  }
  assert.ok(steps >= 1200, `${steps} steps checked`);
});
