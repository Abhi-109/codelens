// Recognition tests use real traces and real AST profiles.
//
// src/tracer/__fixtures__/recognition.json.gz is produced by
// tracer-poc/dump_recognition.py: a small set of search/sort/ambiguity
// programs run through tracer.py, plus a profile of every corpus program. The
// corpus traces themselves still come from corpus.json.gz, so these tests
// exercise the same traces the rest of the suite uses.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";

import {
  RECOGNITION_ADAPTERS,
  RECOGNITION_CONFIDENCE,
  recognizeProgram,
} from "./recognition.js";

const FIXTURE = JSON.parse(
  gunzipSync(readFileSync(new URL("./__fixtures__/recognition.json.gz", import.meta.url))),
);
const CORPUS = JSON.parse(
  gunzipSync(readFileSync(new URL("./__fixtures__/corpus.json.gz", import.meta.url))),
);

const EXPECTED_CORPUS = new Map([
  ["recursion", "recursion"],
  ["recursion-mutual", "recursion"],
  ["combo-recursion-list", "recursion"],
]);

function assertShape(result) {
  assert.ok(RECOGNITION_ADAPTERS.includes(result.adapterId), `adapter ${result.adapterId}`);
  assert.equal(typeof result.confidence, "number");
  assert.ok(result.confidence >= 0 && result.confidence <= 1);
  assert.ok(Array.isArray(result.evidence));
  assert.ok(result.evidence.length > 0, "every result has inspectable evidence");
  for (const item of result.evidence) {
    assert.ok(["profile", "trace"].includes(item.source), `evidence source ${item.source}`);
    assert.equal(typeof item.kind, "string");
    assert.equal(typeof item.detail, "string");
  }
  if (result.adapterId === "generic") {
    assert.equal(result.confidence, RECOGNITION_CONFIDENCE.generic);
    assert.equal(typeof result.unavailableReason, "string");
    assert.ok(result.unavailableReason.length > 0);
  } else {
    assert.equal(result.unavailableReason, null);
  }
}

function runProgram(entry) {
  return recognizeProgram({
    profile: entry.profile,
    trace: entry.trace,
    status: entry.status,
  });
}

function program(name) {
  const entry = FIXTURE.programs[name];
  assert.ok(entry, `missing recognition fixture program ${name}`);
  return entry;
}

function evidenceOf(result, kind) {
  return result.evidence.find((item) => item.kind === kind) ?? null;
}

test("every corpus program gets a deterministic, well-formed decision", () => {
  for (const [name, entry] of Object.entries(CORPUS)) {
    const profile = FIXTURE.corpus_profiles[name];
    assert.ok(profile, `missing corpus profile ${name}`);
    const input = { profile, trace: entry.trace, status: entry.result.status };
    const result = recognizeProgram(input);
    assertShape(result);
    assert.equal(
      result.adapterId,
      EXPECTED_CORPUS.get(name) ?? "generic",
      `${name} adapter`,
    );
    assert.deepEqual(recognizeProgram(input), result, `${name} is deterministic`);
  }
});

test("every synthetic fixture program is deterministic", () => {
  for (const [name, entry] of Object.entries(FIXTURE.programs)) {
    assert.deepEqual(runProgram(entry), runProgram(entry), `${name} is deterministic`);
  }
});

test("corpus recursion positives and ordinary call chains stay separate", () => {
  const direct = recognizeProgram({
    profile: FIXTURE.corpus_profiles.recursion,
    trace: CORPUS.recursion.trace,
  });
  assert.equal(direct.adapterId, "recursion");
  assert.equal(direct.confidence, RECOGNITION_CONFIDENCE.directRecursion);
  assert.ok(evidenceOf(direct, "direct_recursion"));
  assert.ok(evidenceOf(direct, "nested_recursive_frames"));
  assert.ok(evidenceOf(direct, "recursive_call_line"));

  const mutual = recognizeProgram({
    profile: FIXTURE.corpus_profiles["recursion-mutual"],
    trace: CORPUS["recursion-mutual"].trace,
  });
  assert.equal(mutual.adapterId, "recursion");
  assert.equal(mutual.confidence, RECOGNITION_CONFIDENCE.mutualRecursion);
  assert.ok(evidenceOf(mutual, "mutual_recursion_candidates"));
  assert.ok(evidenceOf(mutual, "nested_cycle_frames"));

  const chain = recognizeProgram({
    profile: FIXTURE.corpus_profiles["call-chain"],
    trace: CORPUS["call-chain"].trace,
  });
  assert.equal(chain.adapterId, "generic");
  assert.equal(evidenceOf(chain, "nested_recursive_frames"), null);
});

test("linear search evidence needs an indexed comparison and a changing index", () => {
  const result = runProgram(program("linear-index"));
  assert.equal(result.adapterId, "searching");
  assert.equal(result.confidence, RECOGNITION_CONFIDENCE.indexedLinearSearch);
  const structure = evidenceOf(result, "linear_search_structure");
  const access = evidenceOf(result, "indexed_container_access");
  const comparisons = evidenceOf(result, "indexed_comparison_repeated");
  const index = evidenceOf(result, "index_changed");
  assert.ok(structure && access && comparisons && index);
  assert.ok(comparisons.count >= 2);
  assert.ok(index.index_value_count >= 2);
  assert.equal(evidenceOf(result, "binary_bounds_narrowed"), null);
});

test("item iteration is searching without inventing an index value", () => {
  const result = runProgram(program("linear-item"));
  assert.equal(result.adapterId, "searching");
  assert.equal(result.confidence, RECOGNITION_CONFIDENCE.iteratedLinearSearch);
  assert.ok(evidenceOf(result, "container_iteration"));
  assert.equal(evidenceOf(result, "index_changed"), null);
  assert.equal(
    result.evidence.some((item) => Object.hasOwn(item, "index_value_count")),
    false,
  );
});

test("binary search requires observed narrowing bounds", () => {
  const result = runProgram(program("binary-search"));
  assert.equal(result.adapterId, "searching");
  assert.equal(result.confidence, RECOGNITION_CONFIDENCE.binarySearch);
  assert.ok(evidenceOf(result, "binary_search_structure"));
  assert.ok(evidenceOf(result, "binary_bounds_narrowed"));
  const narrowed = evidenceOf(result, "binary_bounds_narrowed");
  assert.equal(narrowed.bounds.length, 2);
  assert.ok(narrowed.index_value_count >= 2);
});

test("sorting needs element comparisons and real list changes", () => {
  for (const name of [
    "bubble-sort",
    "bubble-duplicates",
    "selection-sort",
    "insertion-sort",
    "merge-sort",
  ]) {
    const result = runProgram(program(name));
    assert.equal(result.adapterId, "sorting", `${name} adapter`);
    assert.ok(evidenceOf(result, "ordering_comparison"));
    assert.ok(evidenceOf(result, "sequence_mutation"));
    assert.ok(evidenceOf(result, "comparison_executed"));
    const changed = evidenceOf(result, "sequence_changed");
    assert.ok(changed, `${name} has a changed sequence`);
    assert.ok(changed.count >= 1);
  }
  assert.equal(
    runProgram(program("insertion-sort")).confidence,
    RECOGNITION_CONFIDENCE.sortingSingleSidedComparison,
  );
});

test("already-sorted input has no mutation evidence, so it stays generic", () => {
  const result = runProgram(program("bubble-sorted"));
  assert.equal(result.adapterId, "generic");
  assert.match(result.unavailableReason, /no visible change/i);
  assert.equal(evidenceOf(result, "sequence_changed"), null);
});

test("built-in ordering is not presented as traced comparisons", () => {
  const direct = runProgram(program("builtin-sort"));
  assert.equal(direct.adapterId, "generic");
  assert.match(direct.unavailableReason, /built-in/i);
  assert.ok(evidenceOf(direct, "builtin_ordering"));

  for (const name of ["list-mutation", "lambda-key"]) {
    const result = recognizeProgram({
      profile: FIXTURE.corpus_profiles[name],
      trace: CORPUS[name].trace,
    });
    assert.equal(result.adapterId, "generic", name);
    assert.match(result.unavailableReason, /built-in/i);
  }
});

test("plain loops, dictionary iteration, and lookalikes stay generic", () => {
  for (const name of [
    "plain-loop",
    "dict-iteration",
    "count-matches",
    "filter-list",
    "max-scan",
    "call-chain",
  ]) {
    const result = runProgram(program(name));
    assert.equal(result.adapterId, "generic", `${name} adapter`);
    assert.ok(result.unavailableReason.length > 0);
  }
});

test("empty, malformed, syntax-error, and truncated inputs do not throw", () => {
  const binary = program("binary-search");

  const empty = recognizeProgram({ profile: binary.profile, trace: [] });
  assert.equal(empty.adapterId, "generic");
  assert.match(empty.unavailableReason, /empty/i);

  const syntax = recognizeProgram({
    profile: FIXTURE.corpus_profiles["error-syntax"],
    trace: CORPUS["error-syntax"].trace,
  });
  assert.equal(syntax.adapterId, "generic");
  assert.match(syntax.unavailableReason, /syntax_error/i);

  const malformedProfile = recognizeProgram({
    profile: "{not json",
    trace: binary.trace,
  });
  assert.equal(malformedProfile.adapterId, "generic");
  assert.match(malformedProfile.unavailableReason, /not usable/i);

  const unsupported = recognizeProgram({
    profile: {
      profile_version: 999,
      kind: "program_profile",
      language: "python",
      status: "ok",
    },
    trace: binary.trace,
  });
  assert.equal(unsupported.adapterId, "generic");
  assert.match(unsupported.unavailableReason, /not usable/i);

  const malformedTrace = recognizeProgram({
    profile: binary.profile,
    trace: [null, {}, { event: "line", line: 1, frames: null }],
  });
  assert.equal(malformedTrace.adapterId, "generic");
  assert.match(malformedTrace.unavailableReason, /no execution state/i);

  const truncated = recognizeProgram({
    profile: binary.profile,
    trace: binary.trace.slice(0, 4),
    status: "step_limit",
  });
  assert.equal(truncated.adapterId, "generic");
  assert.ok(truncated.unavailableReason.length > 0);

  assert.equal(recognizeProgram().adapterId, "generic");
});

test("a result object is accepted as the trace source", () => {
  const entry = program("linear-index");
  const direct = recognizeProgram({
    profile: entry.profile,
    trace: entry.trace,
    status: entry.status,
  });
  const viaResult = recognizeProgram({
    profile: entry.profile,
    result: { trace: entry.trace, status: entry.status },
  });
  assert.deepEqual(viaResult, direct);
});
