---
phase: 09
plan: 01
status: complete
completed_at: 2026-10-26
requirements: [REQ-7B-01, REQ-7B-02, REQ-7B-03, REQ-7B-04, REQ-7B-05, REQ-7B-06, REQ-7B-07, REQ-7B-08]
---

# Phase 7B (GSD phase 9) — summary

## What shipped

The AI planner is now deployable through a server boundary that holds the
credential, and automatic selection is measured against a written expectation
table instead of asserted.

### Server boundary

- `server/planner/` is a pure core: `config.js` (env + all limits),
  `errors.js` (the 10-code taxonomy, shared with the client), `request.js`
  (strict v1 request schema, reusing `validatePlan`/`renderers.js`),
  `prompt.js` (server-owned prompt), `provider.js` (one fixed URL, bounded
  answer, timeout, cancellation), `rateLimit.js` (bounded in-memory window),
  `handler.js` (all decisions), `dev.js` (mock upstream + Vite middleware).
- `api/plan.js` is the Vercel adapter; `vercel.json` caps it at 15 s.
- The route refuses non-POST (405), cross-site `Origin` (403), non-JSON content
  type (415), bodies over 32 KB (413), malformed JSON (400), schema violations
  (400 + field detail), and unconfigured deployments (503 `not_configured`,
  no upstream call). Upstream failures map to `timeout`, `rate_limited`,
  `http_error`, `oversized`, `invalid_json`, `network`; an invalid plan is
  `rejected`/`invalid_schema` with a detail. No response contains the upstream
  body, the key, a stack trace or a path.
- Renderer capabilities in the request must deep-equal the real registry, so a
  client cannot widen what a canvas claims to support.
- The server returns the model's selection (`primary`, optional `concepts`,
  `emphasis`, `explanation`); the browser re-validates it against its own full
  evidence and builds the plan. One schema, one validator, one planner.

### Client

- Request v1 carries facts only: bounded source, concepts with evidence refs, a
  trace summary (now including `hasFrames`), the real renderer list, the
  deterministic baseline and `has_flow`. `untrusted_source` and `response_shape`
  moved to the server prompt.
- Deterministic plan first; the AI request never blocks rendering.
- One in-flight request per run, aborted by a new run, a source edit or unmount.
  Late answers are ignored by both the abort and the run gate.
- Cache keyed by endpoint plus the whole request (8 entries). A changed endpoint
  recreates the provider and misses the cache.
- A deterministic fallback (`empty_trace`, `source_*`, `fallback`) is never
  overridden: the request is skipped. Optional-AI failures are silent in the UI.
- Server-classified error codes are honoured by `aiProvider.request`.

### Planner quality

- New `nested_loop` concept rule usage: loops nested two deep without a
  collection open Control flow (`nested_loop`), with a new reason code.
- `src/planner/quality.js`: explicit expected canvas for all 122 recorded
  programs, the 20 required behaviours mapped to real cases, `evaluateCase`,
  `summarize`, and a scripted AI stand-in.
- `scripts/planner-eval.mjs` (`npm run check:planner`) fails on a missing
  expectation, an uncovered category, an unregistered/unsupported choice, an
  unsupported claim, or nondeterminism.

Measured (deterministic): 122/122 registered, 122/122 evidence-supported,
122/122 appropriate, 1 honest fallback (`error-syntax`), 0 unsupported claims,
0 nondeterministic. Scripted AI: 122/122 appropriate, 5 rejected (4 deliberately
wrong + the fallback case), 0 accepted changes. The scripted comparison shows
+0 because the deterministic planner already matched every expectation; the real
quality change in this phase is the `nested_loop` rule moving `nested-loops` and
`combo-nested-loop-call` from Motion to Control flow.

## Tests

- New server suites: `server/planner/{request,provider,handler,dev}.test.mjs`,
  `api/plan.test.mjs` (35 tests), all with injected env/fetch/limiter — no
  network, no key.
- New planner suite: `src/planner/quality.test.mjs`.
- Browser: `plannerAi()` drives the real handler over HTTP with
  `CODELENS_PLANNER_DEV_MOCK=1` — deterministic-first, valid refine, cursor
  unchanged, invalid/error/timeout, stale older run, manual pin, edit cancel, no
  third panel. `consoleIsClean` ignores only `/api/plan` URL messages, which are
  the intentional failure scenarios.

## Gates (real output)

| Gate | Result |
|---|---|
| `npm run test:tracer` | 136 tests OK |
| `npm run test:js` | 871 pass, 0 fail |
| `npm run lint` | clean |
| `npm run build` | OK (index 341.98 kB, visualizer 462.62 kB) |
| `npm run check:planner` | 122/122 appropriate, 0 unsupported claims |
| `npm run check:browser` | 212/212 checks passed |

`check:explain` and `test:pyodide` were not re-run: this phase changed no worker,
no `tracer.py` and no explanation code.

## Not verified

No provider credential and no deployed route were available in this environment.
The live model path is implemented, unit-tested and exercised through a mock
upstream, but it has never been observed against a real provider. The quality
numbers above describe the deterministic planner and the validator, not a model.

## Deviations

- The browser stale-run scenario disables the endpoint for the newer run, so the
  slow answer it is testing is genuinely the only one in flight.
- Rate limiting is per-instance in memory: abuse mitigation, documented as such,
  not authentication.
