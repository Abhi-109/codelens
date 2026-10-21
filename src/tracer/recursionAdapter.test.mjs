// Recursion scenes use the trace's own frames and events. These tests cover
// direct and mutual recursion, composite sorting/recursion, exceptional and
// truncated runs, the bounded tree, and every way an invocation can be forged.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";

import { DEFAULT_REGISTRY } from "./adapters.js";
import {
  RECURSION_MAX_INVOCATIONS,
  createRecursionAdapter,
} from "./recursionAdapter.js";
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

function corpusRecognition(name) {
  const key = `corpus:${name}`;
  if (recognitionCache.has(key)) return recognitionCache.get(key);
  const entry = CORPUS[name];
  const result = recognizeProgram({
    profile: RECOGNITION.corpus_profiles[name],
    trace: entry.trace,
    status: entry.result.status,
  });
  recognitionCache.set(key, result);
  return result;
}

function programRecognition(name) {
  const key = `program:${name}`;
  if (recognitionCache.has(key)) return recognitionCache.get(key);
  const entry = RECOGNITION.programs[name];
  const result = recognizeProgram({
    profile: entry.profile,
    trace: entry.trace,
    status: entry.status,
  });
  recognitionCache.set(key, result);
  return result;
}

function corpusContext(name, index, extra = {}) {
  const entry = CORPUS[name];
  return {
    stepView: getStepView(entry.trace, index, entry.source),
    trace: entry.trace,
    traceIndex: getTraceIndex(entry.trace),
    source: entry.source,
    profile: RECOGNITION.corpus_profiles[name],
    recognition: corpusRecognition(name),
    result: entry.result,
    ...extra,
  };
}

function programContext(name, index, extra = {}) {
  const entry = RECOGNITION.programs[name];
  return {
    stepView: getStepView(entry.trace, index, entry.source),
    trace: entry.trace,
    traceIndex: getTraceIndex(entry.trace),
    source: entry.source,
    profile: entry.profile,
    recognition: programRecognition(name),
    result: { status: entry.status },
    ...extra,
  };
}

function builtScene(kind, name, index) {
  const context = kind === "corpus" ? corpusContext(name, index) : programContext(name, index);
  return { context, built: DEFAULT_REGISTRY.build("recursion", context) };
}

function invocationItems(scene) {
  return scene.regions.find((region) => region.id === "invocations")?.items ?? [];
}

function clone(value) {
  return structuredClone(value);
}

function assertValid(built, where) {
  assert.equal(built.validation.valid, true, `${where}: ${built.validation.errors.join("\n")}`);
}

test("the default registry registers recursion beside the generic and sequence adapters", () => {
  assert.deepEqual(DEFAULT_REGISTRY.ids(), ["generic", "recursion", "searching", "sorting"]);
  assert.deepEqual(
    DEFAULT_REGISTRY.byCapability("recursion").map((adapter) => adapter.id),
    ["recursion"],
  );
  assert.deepEqual(
    DEFAULT_REGISTRY.byCapability("searching").map((adapter) => adapter.id),
    ["searching"],
  );
  assert.deepEqual(
    DEFAULT_REGISTRY.byCapability("sorting").map((adapter) => adapter.id),
    ["sorting"],
  );
  assert.equal(DEFAULT_REGISTRY.get("recursion").id, "recursion");
});

test("factorial uses real frames, arguments, parent edges and return events", () => {
  const entry = CORPUS.recursion;
  const { context, built } = builtScene("corpus", "recursion", entry.trace.length - 1);
  assert.equal(built.adapterId, "recursion");
  assert.equal(built.fallbackReason, null);
  assertValid(built, "factorial");
  assert.equal(built.scene.status, "ok");
  assert.equal(built.scene.meta.invocationCount, 5);
  assert.equal(built.scene.meta.shownInvocations, 5);
  assert.equal(built.scene.meta.omittedInvocations, 0);

  const items = invocationItems(built.scene);
  assert.deepEqual(items.map((item) => item.frameId), [2, 3, 4, 5, 6]);
  assert.deepEqual(items.map((item) => item.args.map((arg) => arg.text)), [
    ["5"],
    ["4"],
    ["3"],
    ["2"],
    ["1"],
  ]);
  assert.deepEqual(items.map((item) => item.parentFrameId), [null, 2, 3, 4, 5]);
  assert.deepEqual(items.map((item) => item.returnValue), ["120", "24", "6", "2", "1"]);
  assert.ok(items.every((item) => item.function === "fact"));
  assert.ok(items.every((item) => item.outcome === "returned"));
  assert.ok(items.every((item) => item.historical === true && item.active === false));
  assert.deepEqual(items.filter((item) => item.baseCase).map((item) => item.frameId), [6]);
  for (const item of items) {
    assert.notEqual(item.returnIndex, null);
    assert.equal(context.trace[item.returnIndex].event, "return");
  }
});

test("the active invocation and its path follow the selected stack", () => {
  const entry = CORPUS.recursion;
  let index = -1;
  let view = null;
  for (let i = 0; i < entry.trace.length; i += 1) {
    const candidate = getStepView(entry.trace, i, entry.source);
    const active = candidate.callStack.filter((frame) => frame.function === "fact");
    if (active.length >= 3 && candidate.frameId === active[0].frameId) {
      index = i;
      view = candidate;
      break;
    }
  }
  assert.notEqual(index, -1, "the fixture has a deep active fact stack");
  const { built } = builtScene("corpus", "recursion", index);
  assertValid(built, "active path");
  const items = invocationItems(built.scene);
  const expected = view.callStack
    .filter((frame) => frame.function === "fact")
    .map((frame) => frame.frameId);
  assert.deepEqual(
    items
      .filter((item) => item.active)
      .map((item) => item.frameId)
      .sort((left, right) => left - right),
    expected.slice().sort((left, right) => left - right),
  );
  assert.equal(items.find((item) => item.current).frameId, view.frameId);
  assert.deepEqual(built.scene.focus, { kind: "frame", id: view.frameId });
  assert.deepEqual(
    built.scene.highlights.map((reference) => reference.id),
    expected,
  );
});

test("fibonacci represents all calls and marks returning base cases", () => {
  const entry = RECOGNITION.programs.fibonacci;
  const { context, built } = builtScene("program", "fibonacci", entry.trace.length - 1);
  assertValid(built, "fibonacci");
  assert.equal(built.adapterId, "recursion");
  assert.equal(built.scene.status, "ok");
  const items = invocationItems(built.scene);
  assert.equal(items.length, 15);
  assert.ok(items.every((item) => item.function === "fib"));
  const seen = new Set();
  for (const item of items) {
    assert.equal(seen.has(item.frameId), false);
    seen.add(item.frameId);
    if (item.parentFrameId !== null) assert.ok(seen.has(item.parentFrameId));
    if (item.returnValue !== null) {
      assert.notEqual(item.returnIndex, null);
      assert.equal(context.trace[item.returnIndex].event, "return");
    }
  }
  const bases = items.filter((item) => item.baseCase);
  assert.ok(bases.length >= 5);
  assert.ok(bases.every((item) => ["0", "1"].includes(item.args[0].text)));
  assert.ok(bases.every((item) => item.returnValue !== null && item.outcome === "returned"));
});

test("mutual recursion alternates actual frames and stops at a real base case", () => {
  const entry = CORPUS["recursion-mutual"];
  const { built } = builtScene("corpus", "recursion-mutual", entry.trace.length - 1);
  assertValid(built, "mutual recursion");
  assert.equal(built.adapterId, "recursion");
  assert.match(built.scene.subtitle, /mutual recursion/);
  const items = invocationItems(built.scene);
  assert.equal(items.length, 10);
  assert.deepEqual([...new Set(items.map((item) => item.function))].sort(), [
    "is_even",
    "is_odd",
  ]);
  const byId = new Map(items.map((item) => [item.frameId, item]));
  for (const item of items) {
    if (item.parentFrameId === null) continue;
    assert.notEqual(byId.get(item.parentFrameId).function, item.function);
  }
  assert.ok(items.filter((item) => item.baseCase).length >= 1);
  assert.ok(items.every((item) => item.returnValue === "True" || item.returnValue === "False"));
});

test("recursive binary search is a recursion tree, not an invented search", () => {
  const entry = RECOGNITION.programs["recursive-binary-search"];
  const { built } = builtScene(
    "program",
    "recursive-binary-search",
    entry.trace.length - 1,
  );
  assertValid(built, "recursive binary search");
  assert.equal(built.adapterId, "recursion");
  assert.deepEqual(built.scene.capabilities, ["recursion"]);
  const items = invocationItems(built.scene);
  assert.equal(items.length, 4);
  assert.ok(items.every((item) => item.function === "search"));
  const base = items.find((item) => item.baseCase);
  assert.ok(base, "the missing target reaches the low > high base case");
  assert.equal(base.returnValue, "-1");
  assert.equal(base.args[1].text, "4");
  assert.ok(
    built.scene.regions.every((region) =>
      ["algorithm", "source", "context"].includes(region.kind),
    ),
  );
});

test("merge sort keeps recursion available while recognition reports sorting", () => {
  const entry = RECOGNITION.programs["merge-sort"];
  const { built } = builtScene("program", "merge-sort", entry.trace.length - 1);
  assertValid(built, "merge sort");
  assert.equal(built.adapterId, "recursion");
  assert.equal(built.scene.meta.recognition.adapterId, "sorting");
  assert.deepEqual(built.scene.capabilities, ["recursion"]);
  const items = invocationItems(built.scene);
  assert.ok(items.length > 1);
  assert.ok(items.every((item) => item.function === "merge_sort"));
  assert.equal(items.some((item) => item.function === "combine"), false);
  assert.deepEqual(
    DEFAULT_REGISTRY.byCapability("sorting").map((adapter) => adapter.id),
    ["sorting"],
  );
});

test("a caught exception inside recursion is not reported as an unwind", () => {
  const entry = RECOGNITION.programs["recursive-caught"];
  const { built } = builtScene("program", "recursive-caught", entry.trace.length - 1);
  assertValid(built, "caught recursive exception");
  assert.equal(built.adapterId, "recursion");
  assert.equal(built.scene.status, "ok");
  const items = invocationItems(built.scene);
  assert.equal(items.length, 3);
  assert.ok(
    items.every(
      (item) =>
        item.function === "safe" &&
        item.outcome === "returned" &&
        item.unwindIndex === null &&
        item.returnValue === "0" &&
        item.exceptionType === null &&
        item.exceptionMessage === null,
    ),
  );
  assert.equal(items.filter((item) => item.baseCase).length, 1);
});

test("exceptions during recursion use unwind events and never invent returns", () => {
  const entry = RECOGNITION.programs["recursive-exception"];
  const { built } = builtScene("program", "recursive-exception", entry.trace.length - 1);
  assertValid(built, "recursive exception");
  assert.equal(built.adapterId, "recursion");
  assert.equal(built.scene.status, "ok");
  const items = invocationItems(built.scene);
  assert.equal(items.length, 4);
  assert.ok(
    items.every(
      (item) =>
        item.function === "countdown" &&
        item.outcome === "raised" &&
        item.returnIndex === null &&
        item.unwindIndex !== null &&
        item.returnValue === null &&
        item.exceptionType === "ZeroDivisionError" &&
        item.exceptionMessage === "division by zero" &&
        item.baseCase === false,
    ),
  );
});

test("deep, truncated and capped recursion scenes are explicit", () => {
  const entry = RECOGNITION.programs["recursive-deep"];
  const full = builtScene("program", "recursive-deep", entry.trace.length - 1);
  assertValid(full.built, "deep recursion");
  assert.equal(full.built.scene.status, "ok");
  assert.equal(invocationItems(full.built.scene).length, 26);
  assert.equal(full.built.scene.meta.invocationCount, 26);

  const cut = entry.trace.length - 30;
  const truncatedTrace = entry.trace.slice(0, cut);
  const truncatedContext = {
    ...programContext("recursive-deep", truncatedTrace.length - 1),
    trace: truncatedTrace,
    traceIndex: getTraceIndex(truncatedTrace),
    result: { status: "step_limit" },
  };
  const truncated = DEFAULT_REGISTRY.build("recursion", truncatedContext);
  assertValid(truncated, "truncated recursion");
  assert.equal(truncated.adapterId, "recursion");
  assert.equal(truncated.scene.status, "partial");
  assert.match(truncated.scene.unsupportedReason, /step_limit/);
  assert.ok(invocationItems(truncated.scene).some((item) => item.active));
  assert.ok(invocationItems(truncated.scene).every((item) => item.baseCase === false));

  const cappedContext = programContext("recursive-deep", entry.trace.length - 1);
  const cappedAdapter = createRecursionAdapter({ limit: 5 });
  const capped = cappedAdapter.build({ ...cappedContext, requestedAdapterId: "recursion" });
  const validation = validateScene(capped, { ...cappedContext, adapterId: "recursion" });
  assert.equal(validation.valid, true, validation.errors.join("\n"));
  assert.equal(capped.status, "partial");
  assert.match(capped.unsupportedReason, /21 recursive invocations omitted/);
  assert.equal(capped.meta.invocationLimit, 5);
  assert.equal(capped.meta.shownInvocations, 5);
  assert.equal(capped.meta.omittedInvocations, 21);
  assert.equal(invocationItems(capped).length, 5);
  assert.ok(invocationItems(capped).some((item) => item.hiddenChildren > 0));
  assert.equal(invocationItems(capped).some((item) => item.baseCase), false);
  assert.equal(RECURSION_MAX_INVOCATIONS, 200);
});

test("empty, syntax-error and ordinary call chains fall back to generic", () => {
  const emptyView = getStepView([], 0, "");
  const empty = DEFAULT_REGISTRY.build("recursion", {
    stepView: emptyView,
    trace: [],
    traceIndex: getTraceIndex([]),
    source: "",
  });
  assert.equal(empty.adapterId, "generic");
  assert.match(empty.fallbackReason, /no execution step|empty/i);
  assertValid(empty, "empty trace");

  const syntax = builtScene("corpus", "error-syntax", 0);
  assert.equal(syntax.built.adapterId, "generic");
  assert.match(syntax.built.fallbackReason, /syntax_error/);
  assertValid(syntax.built, "syntax error");

  for (const [kind, name] of [
    ["corpus", "call-chain"],
    ["program", "call-chain"],
  ]) {
    const { context, built } = builtScene(kind, name, 0);
    assert.equal(built.adapterId, "generic");
    assert.match(built.fallbackReason, /no direct or mutual recursion/);
    assertValid(built, name);
    const direct = createRecursionAdapter().build({
      ...context,
      requestedAdapterId: "recursion",
    });
    assert.equal(direct.status, "unsupported");
    assert.match(direct.unsupportedReason, /no direct or mutual recursion/);
    assert.deepEqual(invocationItems(direct), []);
    const directValidation = validateScene(direct, { ...context, adapterId: "recursion" });
    assert.equal(directValidation.valid, true, directValidation.errors.join("\n"));
  }
});

test("a mutual candidate without an observed cycle stays generic", () => {
  const entry = RECOGNITION.programs["call-chain"];
  const context = programContext("call-chain", entry.trace.length - 1);
  const profile = clone(context.profile);
  const first = profile.functions.find((fn) => fn.name === "first");
  const second = profile.functions.find((fn) => fn.name === "second");
  assert.ok(first && second);
  profile.recursion = {
    direct: [],
    mutual_candidates: [[first.id, second.id]],
  };
  const recognition = {
    adapterId: "recursion",
    confidence: 1,
    evidence: [],
    unavailableReason: null,
  };
  const built = DEFAULT_REGISTRY.build("recursion", { ...context, profile, recognition });
  assert.equal(built.adapterId, "generic");
  assert.match(built.fallbackReason, /no repeated recursive invocation/);
  assertValid(built, "candidate without a cycle");
});

test("invented invocation state is rejected by the validator", () => {
  const { context, built } = builtScene("corpus", "recursion", CORPUS.recursion.trace.length - 1);
  assertValid(built, "factorial baseline");
  const scene = clone(built.scene);
  const items = invocationItems(scene);
  const leaf = items.find((item) => item.baseCase);
  assert.ok(leaf);

  const badFrame = clone(scene);
  invocationItems(badFrame)[1].frameId = 999;
  assert.equal(validateScene(badFrame, context).valid, false);

  const badParent = clone(scene);
  invocationItems(badParent)[1].parentFrameId = null;
  assert.equal(validateScene(badParent, context).valid, false);

  const badFunction = clone(scene);
  invocationItems(badFunction)[0].function = "invented";
  assert.equal(validateScene(badFunction, context).valid, false);

  const badReturn = clone(scene);
  invocationItems(badReturn)[0].returnValue = "999";
  assert.equal(validateScene(badReturn, context).valid, false);

  const badArgs = clone(scene);
  invocationItems(badArgs)[0].args[0].text = "999";
  assert.equal(validateScene(badArgs, context).valid, false);

  const badOutcome = clone(scene);
  invocationItems(badOutcome)[0].outcome = "future";
  assert.equal(validateScene(badOutcome, context).valid, false);

  const badBase = clone(scene);
  invocationItems(badBase)[0].baseCase = true;
  assert.equal(validateScene(badBase, context).valid, false);

  const badHidden = clone(scene);
  invocationItems(badHidden)[0].hiddenChildren = -1;
  assert.equal(validateScene(badHidden, context).valid, false);

  const badUnknown = clone(scene);
  invocationItems(badUnknown)[0].invented = true;
  assert.equal(validateScene(badUnknown, context).valid, false);

  const badCount = clone(scene);
  badCount.meta.shownInvocations += 1;
  assert.equal(validateScene(badCount, context).valid, false);
});

test("recursive scenes are deterministic and do not mutate their inputs", () => {
  const context = corpusContext("recursion", 17);
  const traceBefore = JSON.stringify(context.trace);
  const viewBefore = JSON.stringify(context.stepView);
  const first = DEFAULT_REGISTRY.build("recursion", context);
  const second = DEFAULT_REGISTRY.build("recursion", context);
  const sceneBefore = JSON.stringify(first.scene);
  validateScene(first.scene, { ...context, adapterId: "recursion" });
  assert.deepEqual(second, first);
  assert.equal(JSON.stringify(context.trace), traceBefore);
  assert.equal(JSON.stringify(context.stepView), viewBefore);
  assert.equal(JSON.stringify(first.scene), sceneBefore);
});

test("every step of every recursive fixture builds a valid recursion scene", () => {
  const fixtures = [
    ["corpus", "recursion"],
    ["corpus", "recursion-mutual"],
    ["corpus", "combo-recursion-list"],
    ["program", "fibonacci"],
    ["program", "recursive-binary-search"],
    ["program", "recursive-exception"],
    ["program", "recursive-caught"],
    ["program", "recursive-deep"],
    ["program", "merge-sort"],
  ];
  let steps = 0;
  for (const [kind, name] of fixtures) {
    const entry = kind === "corpus" ? CORPUS[name] : RECOGNITION.programs[name];
    for (let index = 0; index < entry.trace.length; index += 1) {
      const context = kind === "corpus" ? corpusContext(name, index) : programContext(name, index);
      const built = DEFAULT_REGISTRY.build("recursion", context);
      steps += 1;
      assert.equal(built.adapterId, "recursion", `${name} step ${index}`);
      assert.equal(built.fallbackReason, null, `${name} step ${index}`);
      assertValid(built, `${name} step ${index}`);
      assert.ok(invocationItems(built.scene).length > 0, `${name} step ${index}`);
      for (const item of invocationItems(built.scene)) {
        assert.ok(context.traceIndex.frame(item.frameId), `${name} step ${index} frame`);
      }
    }
  }
  assert.ok(steps >= 500, `${steps} recursion steps checked`);
});
