// Concept detection is deterministic and evidence-labelled. These tests use the
// real AST profiles and real traces in the repository fixtures, plus a few tiny
// synthetic profiles for shapes the corpus does not contain (a bare `for item
// in items`, a name that sounds like an algorithm but proves nothing).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";

import { CONCEPT_IDS, EVIDENCE_KINDS, detectConcepts } from "./concepts.js";
import { PROGRAM_PROFILE_VERSION } from "../tracer/programProfile.js";
import { recognizeProgram } from "../tracer/recognition.js";

const FIXTURE = JSON.parse(
  gunzipSync(readFileSync(new URL("../tracer/__fixtures__/recognition.json.gz", import.meta.url))),
);
const CORPUS = JSON.parse(
  gunzipSync(readFileSync(new URL("../tracer/__fixtures__/corpus.json.gz", import.meta.url))),
);

function fromCorpus(name) {
  const entry = CORPUS[name];
  return detectConcepts({
    profile: FIXTURE.corpus_profiles[name],
    trace: entry?.trace ?? [],
    result: entry?.result ?? null,
  });
}

function fromProgram(name) {
  const entry = FIXTURE.programs[name];
  const recognition = recognizeProgram({ profile: entry.profile, trace: entry.trace });
  return detectConcepts({
    profile: entry.profile,
    trace: entry.trace,
    result: { status: entry.status },
    recognition,
  });
}

function ids(report) {
  return report.concepts.map((concept) => concept.id);
}

function strength(report, id) {
  return report.concepts.find((concept) => concept.id === id)?.strength ?? null;
}

function emptyProfile(extra = {}) {
  return {
    profile_version: PROGRAM_PROFILE_VERSION,
    kind: "program_profile",
    language: "python",
    status: "ok",
    loops: [],
    conditions: [],
    comparisons: [],
    mutations: [],
    returns: [],
    container_operations: [],
    functions: [],
    calls: [],
    call_graph: {},
    recursion: { direct: [], mutual_candidates: [] },
    ...extra,
  };
}

test("every corpus program produces a bounded, well-labelled report", () => {
  for (const name of Object.keys(FIXTURE.corpus_profiles)) {
    const report = fromCorpus(name);
    assert.ok(["ok", "empty", "syntax_error", "analysis_error", "invalid", "unsupported"].includes(report.status), name);
    for (const concept of report.concepts) {
      assert.ok(CONCEPT_IDS.includes(concept.id), `${name}: ${concept.id}`);
      assert.ok(EVIDENCE_KINDS.includes(concept.strength), `${name}: ${concept.strength}`);
      assert.ok(Array.isArray(concept.evidence) && concept.evidence.length <= 3, `${name}: evidence`);
      assert.ok(concept.evidence.every((ref) => typeof ref === "string" && ref.length <= 64), name);
    }
    const again = fromCorpus(name);
    assert.deepEqual(again.concepts, report.concepts, `${name} is deterministic`);
  }
});

test("a scalar program is a value-and-control run, not an algorithm", () => {
  const report = fromCorpus("scalars-only");
  assert.equal(report.status, "ok");
  assert.ok(ids(report).includes("scalars"));
  assert.ok(ids(report).includes("assignment"));
  assert.ok(ids(report).includes("branch"));
  assert.ok(ids(report).includes("loop"));
  assert.ok(ids(report).includes("comparison"));
  assert.ok(ids(report).includes("output"));
  assert.equal(strength(report, "comparison"), "observed");
  assert.ok(!ids(report).includes("search_like"));
  assert.ok(!ids(report).includes("sort_like"));
});

test("recursion is structural in the AST and observed in the trace", () => {
  const report = fromProgram("fibonacci");
  assert.equal(strength(report, "recursion"), "observed");
  assert.equal(strength(report, "return"), "observed");
  assert.equal(strength(report, "call"), "observed");
  assert.ok(report.trace.recursive);
});

test("structural recursion is reported even before a trace exists", () => {
  const report = detectConcepts({ profile: FIXTURE.corpus_profiles["recursion"] });
  assert.equal(report.status, "empty");
  assert.equal(strength(report, "recursion"), "structural");
  assert.equal(strength(report, "function"), "structural");
});

test("nested loops are distinguished from one loop", () => {
  const nested = fromCorpus("nested-loops");
  assert.ok(ids(nested).includes("loop"));
  assert.equal(strength(nested, "nested_loop"), "structural");
  assert.equal(nested.counts.maxLoopDepth, 2);

  const single = fromCorpus("for-loop");
  assert.ok(ids(single).includes("loop"));
  assert.ok(!ids(single).includes("nested_loop"));
});

test("a for loop over a named sequence is traversal; range is index iteration", () => {
  const traversal = detectConcepts({
    profile: emptyProfile({
      loops: [
        {
          id: "loop:1:0:2:10:for",
          kind: "for",
          depth: 1,
          target: { kind: "Name", label: "item" },
          iterator: { kind: "Name", label: "items" },
          line: 1,
          column: 0,
        },
      ],
    }),
    trace: [],
  });
  assert.ok(ids(traversal).includes("sequence_traversal"));
  assert.ok(!ids(traversal).includes("index_iteration"));

  const indexed = fromCorpus("for-loop");
  assert.ok(ids(indexed).includes("index_iteration"));
});

test("collections, dictionaries, sets and classes are detected from real runs", () => {
  const dict = fromCorpus("dict-basics");
  assert.ok(ids(dict).includes("dict_lookup"));
  assert.equal(strength(dict, "dict_mutation"), "structural");

  const list = fromCorpus("list-basics");
  assert.ok(ids(list).includes("list"));
  assert.equal(strength(list, "list"), "observed");

  const set = fromCorpus("set-basics");
  assert.ok(ids(set).includes("set"));

  const klass = fromCorpus("class-basic");
  assert.ok(ids(klass).includes("class"));
  assert.ok(ids(klass).includes("attribute_access"));
  assert.equal(strength(klass, "attribute_mutation"), "structural");
});

test("collection mutation and aliasing are visible in the recorded run", () => {
  const alias = fromCorpus("alias-shared");
  assert.ok(ids(alias).includes("list"));
  assert.equal(strength(alias, "collection_mutation"), "structural");
});

test("caught and uncaught exceptions are observed, never guessed", () => {
  const caught = fromCorpus("exception-custom");
  assert.equal(strength(caught, "exception_handling"), "observed");

  const uncaught = fromCorpus("error-division");
  assert.equal(strength(uncaught, "raise"), "observed");
  assert.equal(uncaught.status, "ok");
});

test("sorting and searching come from the recognizer, not from names or shapes", () => {
  const sorting = fromProgram("bubble-sort");
  assert.equal(strength(sorting, "sort_like"), "derived");
  assert.ok(ids(sorting).includes("collection_mutation"));

  const searching = fromProgram("binary-search");
  assert.equal(strength(searching, "search_like"), "derived");

  const falsePositive = detectConcepts({
    profile: emptyProfile({
      functions: [
        {
          id: "function:binary_search@1:0",
          name: "binary_search",
          qualified_name: "binary_search",
          kind: "function",
          line: 1,
          column: 0,
        },
      ],
      loops: [
        {
          id: "loop:2:0:3:8:for",
          kind: "for",
          depth: 1,
          target: { kind: "Name", label: "item" },
          iterator: { kind: "Name", label: "items" },
          line: 2,
          column: 0,
        },
      ],
    }),
    trace: [],
  });
  assert.ok(!ids(falsePositive).includes("search_like"), "a name is not a search");
  assert.ok(!ids(falsePositive).includes("sort_like"), "a loop is not a sort");
});

test("a search-shaped loop without runtime proof is only a hypothesis", () => {
  const report = detectConcepts({
    profile: emptyProfile({
      loops: [
        {
          id: "loop:2:0:4:8:for",
          kind: "for",
          depth: 1,
          target: { kind: "Name", label: "i" },
          iterator: { kind: "Call", label: "range(len(items))" },
          line: 2,
          column: 0,
        },
      ],
      comparisons: [
        {
          id: "comparison:3:8:3:22",
          loop_depth: 1,
          left: { kind: "Subscript", label: "items[i]" },
          operators: ["=="],
          comparators: [{ kind: "Constant", label: "target" }],
          line: 3,
          column: 8,
        },
      ],
      container_operations: [
        {
          id: "operation:3:8:3:16:index_read",
          operation: "index_read",
          kind: "container",
          container_kind: "index",
          loop_depth: 1,
          target: { kind: "Subscript", label: "items[i]" },
          line: 3,
          column: 8,
        },
      ],
    }),
    trace: [],
  });
  assert.equal(report.status, "empty");
  assert.equal(strength(report, "search_like"), "hypothesis");
});

test("a graph-like object is a hypothesis, never a BFS claim", () => {
  const trace = [
    {
      step: 0,
      event: "line",
      frames: [
        {
          frame_id: 1,
          function: "<module>",
          call_line: null,
          line: 1,
          variables: { g: { type: "ref", id: "o1" } },
        },
      ],
      heap: {
        o1: {
          type: "object",
          class: "Graph",
          attrs: [
            { name: "neighbors", value: { type: "ref", id: "o2" } },
            { name: "label", value: { type: "str", value: "g" } },
          ],
        },
      },
    },
  ];
  const report = detectConcepts({ profile: emptyProfile(), trace, result: { status: "completed" } });
  assert.equal(strength(report, "graph_like"), "hypothesis");
});

test("a syntax error and an empty program are useful results, not crashes", () => {
  const broken = fromCorpus("error-syntax");
  assert.equal(broken.status, "syntax_error");
  assert.deepEqual(broken.concepts, []);
  assert.ok(broken.diagnostics.length > 0);

  const empty = detectConcepts({ profile: emptyProfile(), trace: [] });
  assert.equal(empty.status, "empty");
  assert.deepEqual(empty.concepts, []);
  assert.equal(empty.diagnostics[0].code, "empty_trace");
});

test("garbage input never throws", () => {
  for (const input of [undefined, null, {}, { profile: 5, trace: "no" }, { profile: {}, trace: [null, 3] }]) {
    const report = detectConcepts(input);
    assert.equal(typeof report.status, "string");
    assert.ok(Array.isArray(report.concepts));
  }
});
