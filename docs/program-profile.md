# Program profile (version 1)

`tracer-poc/analyze.py` parses user Python with the standard-library `ast` module
and returns a deterministic, JSON-compatible **static profile**. It never
executes, imports, evaluates, or compiles the user's source. `src/tracer/programProfile.js`
validates and normalises that response in the browser.

The profile is analysis metadata. It is separate from the execution trace
(`docs/trace-format.md`), carries no runtime values, and cannot prove that a
function implements binary search, sorting, or any other algorithm.

## Top-level shape

| Field | Meaning |
|---|---|
| `profile_version` | Always `1` for this contract |
| `kind` | `"program_profile"` |
| `language` | `"python"` |
| `status` | `ok`, `syntax_error`, or `analysis_error` |
| `source` | `{lines, characters}` only; source text is not stored |
| `diagnostics` | Structured failures, never a thrown exception |
| `functions` | Function, method, and nested-function definitions |
| `calls` | Every call expression, with its caller and source range |
| `call_graph` | Caller id -> candidate callee ids |
| `recursion` | `{direct: [ids], mutual_candidates: [[ids]]}` |
| `loops` | `for` / `async for` / `while`, depth, and nesting |
| `conditions` | Conditions with their expression summary and operators |
| `decisions` | `if`, `elif`, `while`, `for`, `assert`, `match`, conditional expressions |
| `comparisons` | Comparison nodes, operands, operators, and source ranges |
| `mutations` | Statically identifiable list/dict/index/slice/attribute writes |
| `returns` | Return statements and whether they carry a value |
| `container_operations` | Literal/access/mutation operations, in source order |
| `summary` | Counts plus the recursion lists |

Every event-shaped object has `line`, `column`, `end_line`, `end_column` where
the AST provides them. Function ids look like
`function:<qualified name>@<line>:<column>`; other ids are built from the event
kind, the full source range (start and end), and a stable suffix, so nested
expressions such as `f()()` keep unique ids. A missing source location is
`null`, not a guessed position.

## Functions and calls

A function object contains `id`, `name`, `qualified_name`, `kind`, `async`,
`class`, `parent_function_id`, its source range, parameters, decorators,
`call_ids`, `return_ids`, `direct_self_recursion`, and counts. Parameters keep
their kind (`positional_only`, `positional`, `vararg`, `keyword_only`, `kwarg`),
default summary, annotation summary, and source range.

A call object contains `caller` (`"module"` for top-level code), `name`,
`target`, `attribute`, `receiver`, `resolution`, `candidate_function_ids`,
`resolved_function_id`, `self_recursion`, argument/keyword counts, star-argument
flags, and its source range.

`resolution` is deliberately conservative:

- `self` — a direct name match or a likely `self.method` self-call.
- `name_candidate` / `method_candidate` — one or more syntax-level matches.
- `unresolved` — dynamic, aliased, or otherwise unknowable call target.

`call_graph` edges are candidate relationships, not proof. Mutual recursion is
reported only when candidate edges form a cycle.

## Control flow and mutations

- `loops[].depth` is syntactic nesting depth; `parent_id` names the enclosing
  loop.
- `conditions[].operators` preserves source order (for example `["<", "<"]` for
  a chained comparison).
- `decisions` includes `elif` as its own decision, and links to `loop_id` or
  `condition_id` where relevant.
- `mutations[].certainty` is `syntax` for an assignment/delete target and
  `method_name` for a recognised method such as `append` or `update`; inferred
  in-place operations such as a known list `+=` and dict `|=` use `inferred`.
- `container_kind` is only committed when the syntax or a nearby literal
  assignment supports it; otherwise it is `unknown` or `attribute`.

The profile does not execute or evaluate any expression, does not infer types
from imports or runtime values, and does not claim an algorithm. Attribute and
dynamic calls can remain unresolved; calls to names with more than one possible
definition remain candidates.

## Failure shape

Syntax errors return `status: "syntax_error"` with an empty analysis and a
diagnostic such as:

```json
{"code":"syntax_error","message":"invalid syntax","severity":"error",
 "line":1,"column":4,"end_line":1,"end_column":5}
```

Unexpected analyser failures return `status: "analysis_error"` with an
`analysis_error` or `parse_error` diagnostic. Neither path raises for user input.

## Browser integration

`src/tracer/client.js` exposes:

```js
buildProgramProfile(source) // Promise<raw analyzer profile>
```

It uses the existing Pyodide worker and request id protocol (`type: "analyze"`),
and caches responses per source. The worker imports `analyze.py` beside
`tracer.py` and `flowchart.py`; analysis is synchronous inside the worker, just
like flowchart generation, so it serialises with runs but never touches the main
thread. No normal execution path calls it yet.

`src/tracer/programProfile.js` exports:

```js
parseProgramProfile(value)     // object or JSON text, never throws
normalizeProgramProfile(value) // object-in, object-out alias
PROGRAM_PROFILE_VERSION        // 1
```

The parser drops malformed entries rather than inventing them. Malformed JSON,
missing/unsupported versions, wrong kinds or languages, unknown statuses, and
syntax/analysis errors become a normalised profile with diagnostics and empty
analysis lists. `ok` profiles have their summary recomputed from the normalised
lists; comparison operator order is preserved; call-graph keys and recursion
lists are sorted deterministically; unknown top-level fields (including a
mistakenly attached `trace`) are ignored.

Combining this profile with actual runtime evidence is the job of
`src/tracer/recognition.js`; its adapter rules and confidence values are in
[recognition.md](recognition.md).
