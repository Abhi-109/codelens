// Contract tests for the browser-side validator/normaliser of
// tracer-poc/analyze.py output. A malformed response must never reach the
// visualizer as invented functions or a thrown exception.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PROGRAM_PROFILE_VERSION,
  normalizeProgramProfile,
  parseProgramProfile,
} from "./programProfile.js";

function validProfile() {
  return {
    profile_version: PROGRAM_PROFILE_VERSION,
    kind: "program_profile",
    language: "python",
    status: "ok",
    source: { lines: 8, characters: 96 },
    diagnostics: [],
    functions: [
      {
        id: "function:fact@1:0",
        name: "fact",
        qualified_name: "fact",
        kind: "function",
        async: false,
        class: null,
        parent_function_id: null,
        line: 1,
        column: 0,
        end_line: 3,
        end_column: 10,
        parameters: [
          {
            name: "n",
            kind: "positional",
            has_default: false,
            default: null,
            annotation: null,
            line: 1,
            column: 9,
            end_line: 1,
            end_column: 10,
          },
        ],
        decorators: [],
        call_ids: ["call:3:15"],
        return_ids: ["return:2:8", "return:3:4"],
        direct_self_recursion: true,
        call_count: 1,
        return_count: 2,
        has_return_value: true,
      },
    ],
    calls: [
      {
        id: "call:3:15",
        caller: "function:fact@1:0",
        name: "fact",
        target: "fact",
        attribute: false,
        receiver: null,
        resolution: "self",
        candidate_function_ids: ["function:fact@1:0"],
        resolved_function_id: "function:fact@1:0",
        self_recursion: true,
        arg_count: 1,
        keyword_count: 0,
        has_star_args: false,
        has_star_kwargs: false,
        line: 3,
        column: 15,
        end_line: 3,
        end_column: 24,
      },
    ],
    loops: [
      {
        id: "loop:4:4",
        kind: "for",
        function_id: "function:fact@1:0",
        depth: 1,
        parent_id: null,
        condition_id: null,
        condition: null,
        target: { kind: "Name", label: "i" },
        iterator: { kind: "Call", label: "range(3)" },
        line: 4,
        column: 4,
        end_line: 5,
        end_column: 12,
      },
    ],
    conditions: [
      {
        id: "condition:2:8:if",
        kind: "if",
        function_id: "function:fact@1:0",
        loop_depth: 0,
        expression: { kind: "Compare", label: "n <= 1" },
        operators: ["<="],
        line: 2,
        column: 8,
        end_line: 2,
        end_column: 14,
      },
    ],
    decisions: [
      {
        id: "decision:2:4:if",
        kind: "if",
        function_id: "function:fact@1:0",
        loop_depth: 0,
        condition_id: "condition:2:8:if",
        condition: { kind: "Compare", label: "n <= 1" },
        iterator: null,
        loop_id: null,
        line: 2,
        column: 4,
        end_line: 3,
        end_column: 13,
      },
    ],
    comparisons: [
      {
        id: "comparison:2:8:",
        function_id: "function:fact@1:0",
        loop_depth: 0,
        left: { kind: "Name", label: "n" },
        operators: ["<="],
        comparators: [{ kind: "Constant", label: "1" }],
        line: 2,
        column: 8,
        end_line: 2,
        end_column: 14,
      },
    ],
    mutations: [
      {
        id: "mutation:6:0:list_method:append",
        kind: "list_method",
        operation: "append",
        function_id: "module",
        loop_depth: 0,
        target: { kind: "Name", label: "items" },
        container: { kind: "Name", label: "items" },
        container_kind: "list",
        certainty: "method_name",
        line: 6,
        column: 0,
        end_line: 6,
        end_column: 12,
      },
    ],
    returns: [
      {
        id: "return:2:8",
        function_id: "function:fact@1:0",
        loop_depth: 0,
        has_value: true,
        value: { kind: "Constant", label: "1" },
        line: 2,
        column: 8,
        end_line: 2,
        end_column: 15,
      },
    ],
    container_operations: [
      {
        id: "operation:6:0:list_method:append",
        function_id: "module",
        operation: "append",
        kind: "mutation",
        container_kind: "list",
        loop_depth: 0,
        mutation_id: "mutation:6:0:list_method:append",
        target: { kind: "Name", label: "items" },
        line: 6,
        column: 0,
        end_line: 6,
        end_column: 12,
      },
    ],
    call_graph: {
      "function:fact@1:0": ["function:fact@1:0"],
      module: [],
    },
    recursion: {
      direct: ["function:fact@1:0"],
      mutual_candidates: [],
    },
    summary: { functions: 99 },
  };
}

test("normalizes a valid analyzer profile and recomputes deterministic counts", () => {
  const profile = normalizeProgramProfile(validProfile());
  assert.equal(profile.profile_version, PROGRAM_PROFILE_VERSION);
  assert.equal(profile.kind, "program_profile");
  assert.equal(profile.status, "ok");
  assert.deepEqual(profile.source, { lines: 8, characters: 96 });
  assert.equal(profile.functions.length, 1);
  assert.equal(profile.functions[0].parameters[0].name, "n");
  assert.equal(profile.calls[0].resolution, "self");
  assert.equal(profile.loops[0].depth, 1);
  assert.equal(profile.mutations[0].container_kind, "list");
  assert.equal(profile.summary.functions, 1);
  assert.equal(profile.summary.calls, 1);
  assert.equal(profile.summary.max_loop_depth, 1);
  assert.deepEqual(profile.summary.direct_recursive_functions, ["function:fact@1:0"]);
  assert.deepEqual(Object.keys(profile.call_graph), ["function:fact@1:0", "module"]);
});

test("accepts JSON text and is deterministic across repeated normalization", () => {
  const text = JSON.stringify(validProfile());
  const first = parseProgramProfile(text);
  const second = parseProgramProfile(text);
  assert.deepEqual(first, second);
  assert.deepEqual(normalizeProgramProfile(validProfile()), first);
  assert.deepEqual(parseProgramProfile(first), first);
});

test("malformed JSON becomes a safe invalid profile", () => {
  const profile = parseProgramProfile("{not json");
  assert.equal(profile.status, "invalid");
  assert.equal(profile.diagnostics[0].code, "malformed_json");
  assert.deepEqual(profile.functions, []);
  assert.deepEqual(profile.calls, []);
  assert.equal(profile.summary.functions, 0);
});

test("missing and unsupported versions are reported without throwing", () => {
  const missing = normalizeProgramProfile({ status: "ok" });
  assert.equal(missing.status, "invalid");
  assert.equal(missing.diagnostics[0].code, "missing_profile_version");

  const unsupported = normalizeProgramProfile({
    ...validProfile(),
    profile_version: 99,
  });
  assert.equal(unsupported.status, "unsupported");
  assert.equal(unsupported.diagnostics[0].code, "unsupported_profile_version");
  assert.deepEqual(unsupported.functions, []);
});

test("missing optional fields default safely and malformed entries are dropped", () => {
  const profile = normalizeProgramProfile({
    profile_version: 1,
    kind: "program_profile",
    language: "python",
    status: "ok",
    functions: [
      null,
      { id: "function:missing-name" },
      {
        id: "function:kept@1:0",
        name: "kept",
        parameters: [{ name: "value", kind: "positional" }],
      },
    ],
  });
  assert.equal(profile.status, "ok");
  assert.equal(profile.functions.length, 1);
  assert.equal(profile.functions[0].name, "kept");
  assert.equal(profile.functions[0].qualified_name, "kept");
  assert.equal(profile.functions[0].parameters[0].kind, "positional");
  assert.deepEqual(profile.calls, []);
  assert.deepEqual(profile.loops, []);
  assert.deepEqual(profile.recursion, { direct: [], mutual_candidates: [] });
  assert.ok(profile.diagnostics.some((entry) => entry.code === "invalid_function"));
  assert.equal(profile.source.lines, null);
  assert.equal(profile.source.characters, null);
});

test("syntax errors stay safe and do not expose partial functions", () => {
  const profile = normalizeProgramProfile({
    ...validProfile(),
    status: "syntax_error",
    diagnostics: [
      {
        code: "syntax_error",
        message: "invalid syntax",
        severity: "error",
        line: 2,
        column: 4,
      },
    ],
    functions: [validProfile().functions[0]],
  });
  assert.equal(profile.status, "syntax_error");
  assert.deepEqual(profile.functions, []);
  assert.deepEqual(profile.calls, []);
  assert.equal(profile.diagnostics[0].code, "syntax_error");
  assert.equal(profile.diagnostics[0].line, 2);
});

test("analysis errors are preserved as diagnostics with no runtime data", () => {
  const profile = normalizeProgramProfile({
    profile_version: 1,
    kind: "program_profile",
    language: "python",
    status: "analysis_error",
    source: { lines: 1, characters: 5 },
    diagnostics: [{ code: "parse_error", message: "boom" }],
  });
  assert.equal(profile.status, "analysis_error");
  assert.equal(profile.diagnostics[0].code, "parse_error");
  assert.equal(profile.summary.functions, 0);
  assert.equal(profile.call_graph && Object.keys(profile.call_graph).length, 0);
});

test("normalization keeps comparison operator order and ignores trace data", () => {
  const input = {
    ...validProfile(),
    comparisons: [
      {
        id: "comparison:1:0",
        function_id: "module",
        operators: ["in", "<"],
        left: { kind: "Name", label: "a" },
        comparators: [{ kind: "Name", label: "b" }],
      },
    ],
    call_graph: { z: ["b", "a"], a: [] },
    recursion: {
      direct: ["z", "a"],
      mutual_candidates: [["z", "a"]],
    },
    trace: [{ event: "line" }],
    events: [],
  };
  const profile = normalizeProgramProfile(input);
  assert.deepEqual(profile.comparisons[0].operators, ["in", "<"]);
  assert.deepEqual(Object.keys(profile.call_graph), ["a", "z"]);
  assert.deepEqual(profile.call_graph.z, ["a", "b"]);
  assert.deepEqual(profile.recursion.direct, ["a", "z"]);
  assert.equal("trace" in profile, false);
  assert.equal("events" in profile, false);
});

test("non-object input never throws", () => {
  for (const input of [null, undefined, 1, [], true]) {
    const profile = parseProgramProfile(input);
    assert.equal(profile.status, "invalid");
    assert.deepEqual(profile.functions, []);
    assert.ok(profile.diagnostics.length > 0);
  }
});
