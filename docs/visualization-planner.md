# Visualization planner

Phase 7A adds a decision layer between the tracer and the canvases. It answers
one question — *which existing canvas explains this run best?* — and it answers
it from evidence the repository already has.

The rule the whole layer is built around:

> The tracer establishes what happened. The planner chooses how to explain it.
> AI may recommend a canvas; it may never add a fact.

## Four responsibilities

| Layer | Module | What it may say |
|---|---|---|
| Source analysis | `tracer-poc/analyze.py` → `src/tracer/programProfile.js` | Syntax shapes: functions, loops, conditions, mutations, containers. Never runs user code. |
| Execution tracing | `src/tracer/tracer.py` → the trace JSON (format 3) | What actually ran: values, calls, returns, comparisons, mutations, output, exceptions. |
| Visualization planning | `src/planner/` | A validated recommendation among the real canvases, with evidence references and reason codes. |
| Rendering | `src/visualizer/` | Draws the trace at the shared cursor. It does not read the plan. |

The plan carries no trace, no step and no animation. It cannot move the cursor,
start playback or invent an event.

## Data flow

```
source ──► analyze.py ──► program profile ─┐
                                           ├─► detectConcepts() ─► concept report
run ─────► tracer.py ──► trace ────────────┘          │
                                                      ▼
recognizeProgram(profile, trace) ───────────► planVisualization()
                                                      │
                                                      ▼
                                              validatePlan()  (schema v1)
                                                      │
                                     ┌────────────────┴───────────────┐
                                     ▼                                ▼
                          session.selectViz(primary)          VisualizationPane hint
                          (only while unpinned)               (one short why-line)
```

All of this happens once, when a run finishes. Cursor movement never replans and
never changes the canvas.

## Concepts and evidence

`src/planner/concepts.js` exports `detectConcepts({ profile, trace, result,
recognition })`. It returns:

```js
{
  status: "ok" | "empty" | "syntax_error" | "analysis_error" | "invalid" | "unsupported",
  concepts: [{ id, strength, evidence: ["profile.loops", "trace.compare"] }],
  counts: { functions, calls, loops, maxLoopDepth, conditions, comparisons, mutations, returns, containerOperations },
  trace: { events, calls, returns, comparisons, exceptions, outputs, maxDepth, recursive, hasFrames, ... },
  diagnostics: [{ code, severity }]
}
```

`strength` is a closed set with a defined meaning — not a score:

- **observed** — the trace shows it happened (a recursive frame, a comparison, an exception).
- **structural** — the AST has the shape (a loop, a nested loop, a class method).
- **derived** — the existing recognizer (`recognition.js`) concluded it from structure *and* runtime evidence (sorting, searching).
- **hypothesis** — a pattern worth mentioning that proves nothing (a search-shaped loop, a neighbour-shaped object).

A name is never evidence. `def binary_search` without indexed comparisons is not
a search. A list loop is not a search. A dict is not a graph algorithm. A
sort-shaped comparison/mutation pair is only a hypothesis until the recognizer
sees the real runtime evidence.

Invalid or incomplete source returns a status and diagnostics instead of
throwing. Empty source returns `empty` with any structural concepts it can still
see, and the planner falls back.

Known limits:

- The profile does not list plain scalar assignments, so `assignment` and
  `reassignment` are observed from trace variables, not parsed directly.
- Attribute *reads* are not recorded, so `attribute_access` is structural when a
  class/method or an attribute mutation exists.
- `graph_like` is a hypothesis based on observed object attributes named like
  neighbours/edges; it never claims BFS or DFS.
- Comprehensions, generators, decorators and async code are parsed by the
  profile but may produce no special concept; they fall back safely.

## Renderer capability registry

`src/planner/renderers.js` describes the six canvases already offered by
`src/visualizer/vizMode.js`. It does not introduce a second list of modes: the
ids are checked against `VIZ_MODES` and the labels/blurbs come from the same
module. `rendererIds()` returns exactly `VIZ_MODES`.

Each entry records:

- `primary` / `secondary` eligibility;
- supported event types and value shapes;
- `requiredEvidence` (`trace`, `trace_frames`, `call_events`, `source_flow`);
- supported concepts;
- limitations, shared-cursor support, reduced-motion support and fallback.

`canRender(id, { trace, hasFlow })` returns `{ ok, renderer, missing }`, so a
plan reason can name exactly what was absent. Unknown ids return
`missing: ["unknown_renderer"]`.

`timeline` is registered but not eligible as an automatic primary view: it lists
every step and explains less per step. The authored data-structure lab is **not**
registered — it runs on its own operation model, not on a Python trace.

## Plan schema (version 1)

`src/planner/plan.js` defines and validates the plan:

```js
{
  schema_version: 1,
  primary: "scene",              // a real renderer id
  fallback: "motion",            // must be the generic canvas
  provenance: "deterministic",   // or "ai"
  concepts: [{ id, strength, evidence: ["trace.compare"] }],
  emphasis: ["collections", "values"],
  explanation: "standard",       // brief | standard | detailed
  reasons: [{ code: "recognized_sorting", subject?: "scene" }]
}
```

Validation is strict and bounded:

- unknown fields, renderer ids, concepts, evidence strengths, evidence refs,
  emphasis rules, explanation levels and reason codes are rejected;
- duplicate concepts, empty or oversized reason lists, and plans over 8 KB are
  rejected;
- `fallback` must be `motion`;
- malformed input is never normalised into a valid plan.

`fallbackPlan(reason, concepts)` always produces a valid motion plan, even when
handed junk concepts. An invalid plan is discarded, the motion canvas keeps the
trace, cursor, output, returns and exceptions.

`explanation` is validated for forward compatibility; the existing learning mode
still controls how much detail the workspace shows.

## Deterministic rules

`planVisualization({ analysis, recognition, hasFlow })` is pure and stable for
identical input. In order:

| Condition | Canvas | Reason code |
|---|---|---|
| Recognizer says sorting | Adaptive (`scene`) | `recognized_sorting` |
| Recognizer says searching | Adaptive (`scene`) | `recognized_searching` |
| Recursion **observed** in the trace | Call tree (`tree`) | `observed_recursion` |
| Nested calls **observed**, with a collection | Combined (`combined`) | `nested_calls_with_collections` |
| Nested calls **observed** | Call tree (`tree`) | `nested_calls` |
| ≥2 conditions, no functions, no collections | Control flow (`flow`) | `branch_heavy` |
| Any collection concept | Motion (`motion`) | `collection_motion` |
| Everything else | Motion (`motion`) | `generic_values` |
| Empty trace / syntax error / invalid profile | Motion (`motion`) | `empty_trace`, `source_*` |
| Chosen canvas lacks required evidence | Motion (`motion`) | `renderer_missing_evidence` |

Structural recursion without a recorded recursive frame does not open the call
tree. A sort-shaped hypothesis without recognition stays on Motion. The planner
never calls the network, reads secrets, mutates the trace or touches the cursor.

## Lifecycle integration

In `src/App.jsx`, after `finishRun`:

1. `detectConcepts` runs on the run's profile and trace.
2. `planVisualization` validates a plan.
3. The plan is stored for the why-line.
4. The primary canvas is selected **only if the learner has not picked a canvas
   in this session**. A manual pick sets a ref that later plans never override.
5. If a provider endpoint is configured, the AI request starts after the
   deterministic canvas is already visible. A late, validated answer may replace
   the plan only for the same run and only while unpinned.

Starting a new run clears the previous plan, so a rerun or example switch cannot
reuse it. Editing the source hides the why-line (`sourceDirty`).

The why-line is one sentence in the existing canvas toolbar area; it is not a
new panel and it disappears when the learner picks another canvas.

## Optional AI provider

AI is off by default. There is no backend in this repository (the deployment is
a static Vite app on Vercel), so the browser cannot hold a provider key. The
integration is a narrow, tested boundary; it becomes operational only when the
deployment supplies a same-origin endpoint.

Configuration (public, never a secret):

- build time: `VITE_PLANNER_ENDPOINT=/api/plan`
- runtime injection: `window.__CODELENS_PLANNER_ENDPOINT__ = "/api/plan"`

The endpoint must accept `POST application/json` with the request from
`buildAiRequest` and return:

```json
{
  "primary": "tree",
  "concepts": ["recursion"],
  "emphasis": ["calls", "values"],
  "explanation": "standard"
}
```

Only `primary` is required. Unknown fields are rejected. `concepts` must be a
subset of the concepts the deterministic detector found; the model cannot add a
concept or change its evidence strength. The plan's provenance and
`ai_selected` reason are set by the client, not by the model.

`src/planner/aiProvider.js` handles transport: 4 s default timeout, caller
cancellation, response-size cap (8 KB), and classified errors
(`not_configured`, `cancelled`, `timeout`, `network`, `rate_limited`,
`http_error`, `oversized`, `invalid_json`, `invalid_schema`, `rejected`).
`src/planner/aiPlanner.js` validates the answer against the registry and the
detected concepts, and caches valid plans in a bounded 8-entry cache keyed by
the full request (source + concepts + renderer list). A different source misses
the cache.

Every failure — including a late response for an older run — leaves the
deterministic plan and the trace untouched. The request contains bounded source
(8 KB), concept ids/evidence refs and a trace *summary*; it does not contain the
full trace, secrets or unrelated files. User source is labelled untrusted; a
comment that says "ignore your instructions" is data, not an instruction.

**Deployment blocker:** to enable AI in production, the deployment must add a
server route that holds the credential and forwards the validated request. No
such route exists in this repository, so AI-assisted planning is implemented and
unit-tested but not operational in the shipped static build. The deterministic
path is complete without it.

## Adding a renderer safely

1. Add the id, label and blurb to `src/visualizer/vizMode.js` and a real canvas
   in `VisualizationPane`'s switch.
2. Add one capability entry in `src/planner/renderers.js` with its events,
   shapes, required evidence, concepts and limitations.
3. If it should be chosen automatically, add a rule and a reason code in
   `src/planner/planner.js` and `src/planner/plan.js`.
4. Add unit tests for `canRender`, the plan rule and fallback, and a browser
   check if the canvas has new interactive behaviour.

Never register a renderer that does not exist, and never let the data-structure
lab stand in for a Python trace renderer.

## Running the tests

```bash
node --test src/planner/concepts.test.mjs src/planner/renderers.test.mjs \
  src/planner/plan.test.mjs src/planner/planner.test.mjs \
  src/planner/aiProvider.test.mjs src/planner/aiPlanner.test.mjs
```

They are part of `npm run test:js`. The browser harness
(`npm run check:browser`) additionally verifies automatic selection, the
why-line, manual override, cursor preservation, stale-plan replacement and the
AI-disabled build.
