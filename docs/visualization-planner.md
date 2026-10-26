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
| Nested loops, no collection | Control flow (`flow`) | `nested_loop` |
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

AI is off by default and always optional. It answers one question — "would a
different canvas explain this run better?" — and it may only choose among the
renderers this build already has. It cannot add an event, a value, a return, an
output, a comparison, an exception, or a sorting/searching/traversal claim.

### Trust boundary

```
browser ──POST /api/plan──► server route ──► fixed provider URL
  │                            │
  │ no key, no upstream URL    │ key in env, prompt owned here
  │ validated answer only      │ bounded, validated, classified
  └────────────────────────────┘
```

The provider key is **server-only**. It is read from `process.env` by
`server/planner/config.js`, sent only in the upstream `Authorization` header and
never returned to the browser. A static bundle cannot keep a secret, so the
browser never holds one: it sends a same-origin request with no credential.

What the server refuses before it ever calls upstream:

| Check | Result |
|---|---|
| Method other than `POST` | 405 `rejected`, `Allow: POST` |
| `Origin` present and not the request's own host (or `null`) | 403 `rejected` |
| `Content-Type` not `application/json` | 415 `rejected` |
| Declared or actual body over 32 KB | 413 `oversized` |
| Body is not JSON | 400 `invalid_json` |
| Body fails the v1 schema | 400 `invalid_schema` + field detail |
| No `PLANNER_PROVIDER_KEY` | 503 `not_configured`, upstream untouched |
| Over 10 requests per client per 60 s | 429 `rate_limited` + `Retry-After` |
| Upstream slower than 6 s | 504 `timeout` |
| Upstream body over 16 KB | 502 `oversized` |
| Model names an unregistered renderer, an unknown concept, or a renderer whose evidence is absent | 502 `rejected` / `invalid_schema` + detail |

Every error body is `{ error: { code, detail? } }`. The upstream body, the key,
stack traces and file paths are never echoed. `cache-control: no-store` on every
response; no source or trace is logged or retained.

Rate limiting is a bounded in-memory window per server instance (500 client keys).
It is abuse mitigation, not authentication: it does not survive a cold start and
does not identify a user. Origin checks raise the cost of cross-site use; they are
not auth either. A public deployment that needs real access control must add it in
front of the route.

### The request

The browser sends facts, not instructions — the server owns the prompt
(`server/planner/prompt.js`). Schema v1, validated field by field:

```json
{
  "request_version": 1,
  "task": "choose_visualization",
  "source": "…at most 8000 chars…",
  "source_truncated": false,
  "concepts": [{ "id": "recursion", "strength": "observed", "evidence": ["trace.frames"] }],
  "trace": { "events": 21, "calls": 1, "returns": 1, "comparisons": 4, "exceptions": 0,
             "outputs": 2, "maxDepth": 1, "recursive": false, "hasFrames": true,
             "termination": "completed" },
  "renderers": [{ "id": "tree", "purpose": "…", "concepts": [], "requiredEvidence": ["call_events"] }],
  "deterministic": { "primary": "motion", "reasons": ["generic_values"] },
  "has_flow": true
}
```

`renderers` must deep-equal this build's registry; a widened capability list is
rejected, so the client cannot talk the server into a canvas that needs evidence
this run does not have. The full trace, the cursor, the step index and any secret
are absent by construction.

### The answer

The server returns the model's **selection**, not a materialised plan:

```json
{ "primary": "tree", "emphasis": ["calls", "values"], "explanation": "standard" }
```

`primary` is required; `concepts` appears only when the model picked some, and is
then the intersection the server validated. The browser re-validates with its own
full evidence and builds the plan (`provenance: "ai"`, reason `ai_selected`), so a
compromised or confused server still cannot produce an unsupported canvas.

### Configuration

| Name | Where | Purpose |
|---|---|---|
| `PLANNER_PROVIDER_KEY` | server env only | Upstream credential. Absent ⇒ `not_configured`. |
| `PLANNER_PROVIDER_URL` | server env only | One fixed endpoint. Never taken from a request. |
| `PLANNER_MODEL` | server env only | Model name for the chat completion. |
| `VITE_PLANNER_ENDPOINT` | public build env | Same-origin route, e.g. `/api/plan`. |
| `window.__CODELENS_PLANNER_ENDPOINT__` | public runtime | Same value, injected after load. |

`.env.example` lists them; `.env*` is git-ignored. Nothing secret may use a
`VITE_` prefix — those values are inlined into the bundle.

### Deployment (Vercel)

`api/plan.js` is a Vercel Node function and `vercel.json` caps it at 15 s. To turn
AI on:

1. Set the three `PLANNER_*` variables in the Vercel project (Production and
   Preview).
2. Set `VITE_PLANNER_ENDPOINT=/api/plan` for the build.
3. Deploy and confirm `POST /api/plan` answers `503 not_configured` when the key
   is removed — that is the honest "off" state, not an error page.

Without those steps the route still exists but reports `not_configured`, and the
deterministic planner is the whole product. That is a supported configuration.

### Client lifecycle

The deterministic plan is computed, validated and shown **first**; the AI request
starts after that and never blocks rendering.

- One in-flight request. A new run, an edit to the source, or unmounting aborts
  it (`AbortController`), so an answer cannot land on a run it does not describe.
- An answer is applied only for the same run and only while the learner has not
  picked a canvas. A manual pick is final for that run.
- A validated answer is cached by a key covering the endpoint and the whole
  request (source, concepts, trace summary, renderer list, deterministic plan);
  8 entries, oldest evicted. A different source or deployment misses.
- A deterministic **fallback** (`empty_trace`, `source_*`, `fallback`) is never
  overridden: the request is skipped entirely, because "the source did not
  compile" is a better reason than "a model chose this".
- Every failure is classified and silent in the UI. The deterministic canvas and
  its why-line stay; nothing scary is shown for an optional feature.

### Measured quality

`npm run check:planner` scores the planner against a hand-written expectation
table (`src/planner/quality.js`) over every recorded program: 122 cases
(68 corpus + 54 recognition), covering the 20 required behaviours. It reports
registered / evidence-supported / appropriate / fallback / unsupported-claim /
nondeterminism counts and fails the build if any case drifts. It also runs the
same corpus through the AI validator with a **scripted mock** — that measures the
validator and the rejection path, not any real model.

Latest run: 122/122 registered, 122/122 evidence-supported, 122/122 appropriate,
1 honest fallback (`error-syntax`), 0 unsupported claims, 0 nondeterminism.
The scripted AI accepts 122/122 and rejects 5 (4 deliberately wrong + the
fallback case), changing 0 plans — the deterministic planner already matched every
expectation, so the scripted comparison shows no improvement by construction.

**Not verified:** no provider credential and no deployed route were available in
this environment, so the live model path is implemented and mock-tested but not
observed against a real provider. Do not read the numbers above as model accuracy.

### Local development

With no route, AI is simply off. To drive the real client against the real
handler without a key:

```bash
CODELENS_PLANNER_DEV_MOCK=1 npm run dev
```

then set `window.__CODELENS_PLANNER_ENDPOINT__ = "/api/plan?case=tree"` in the
console. Scenarios: `tree`, `motion`, `invalid`, `error`, `timeout`, and
`name@delayMs` for a delayed answer. The dev plugin is `apply: "serve"` and
mounts nothing unless that variable is set, so it cannot reach production.


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
npm run test:js          # includes every planner and server test below
npm run check:planner    # the 122-case quality corpus
npm run check:browser    # real browser, real handler, mock upstream
```

Planner and boundary suites:

- `src/planner/{concepts,renderers,plan,planner,aiProvider,aiPlanner,quality}.test.mjs`
- `server/planner/{request,provider,handler,dev}.test.mjs`
- `api/plan.test.mjs`

The server suites inject `fetchImpl`, a rate limiter and the environment, so they
never touch the network and need no key. The browser harness starts Vite with
`CODELENS_PLANNER_DEV_MOCK=1` and drives the real handler over HTTP: valid answer,
invalid answer, upstream error, timeout, a stale answer for an older run, a manual
pin, an edit that cancels a request, cursor stability and the absence of a third
panel. It also confirms AI stays off when no endpoint is configured.

