---
phase: 07
plan: 01
status: complete
requirements: [REQ-7A-01, REQ-7A-02, REQ-7A-03, REQ-7A-04, REQ-7A-05, REQ-7A-06, REQ-7A-07]
---

# 07-01 Summary: Automatic visualization planner (7A)

## What shipped

| Workstream | Files | Result |
|---|---|---|
| A. Concepts | `src/planner/concepts.js`, `concepts.test.mjs` | 29 closed concept ids with `observed / structural / derived / hypothesis` evidence refs, bounded trace summary, safe invalid/empty/syntax handling |
| B. Capabilities | `src/planner/renderers.js`, `renderers.test.mjs` | One entry per real `VIZ_MODES` canvas, `canRender` names missing evidence, unknown ids rejected, timeline not auto-selected, data-structure lab excluded |
| C. Schema | `src/planner/plan.js`, `plan.test.mjs` | Plan v1, strict bounded validator (unknown fields/ids/concepts/evidence/emphasis/explanation/reasons rejected), guaranteed-valid motion fallback |
| D. Planner | `src/planner/planner.js`, `planner.test.mjs` | Pure deterministic selection with reason codes and a one-line `describePlan` |
| E. Integration | `src/App.jsx`, `src/visualizer/VisualizationPane.jsx`, `src/visualizer/workspace.css`, `tools/browser-check/run.mjs` | Plan per run, auto-select only while unpinned, why-line, cursor/playback/output/returns untouched, 195 browser checks |
| F. AI | `src/planner/aiProvider.js`, `src/planner/aiPlanner.js` + tests | Same-origin POST, 4 s timeout, cancellation, 8 KB cap, classified errors, schema/registry/concept validation, 8-entry cache, stale-run guard, no secret in the browser |
| G. Release | `package.json`, `README.md`, `docs/visualization-planner.md`, `docs/roadmap.md`, `docs/animation-progress.md` | Gates green, docs synced |

## Gates (real output, final tree)

- `npm run test:tracer` — Ran 136 tests, OK
- `npm run test:js` — tests 823, pass 823, fail 0
- `npm run lint` — clean (oxlint)
- `npm run build` — built; index 341.98 kB, visualizer 462.00 kB
- `npm run check:explain` — 238 steps across 10 examples, every step explained
- `npm run test:pyodide` — all examples trace and profile correctly inside Pyodide
- `npm run check:browser` — 195/195 checks passed

## Decisions

- Reused `analyze.py` → `programProfile.js` and `recognition.js`; no second Python parser.
- Evidence strength is four words, never a number.
- The plan carries no trace and no cursor; it is not a second execution model.
- Auto-selection stops permanently once the learner picks a canvas in the session.
- `secondary` renderer lists and AI-supplied reason codes were deliberately omitted (unused surface); `explanation` is validated but the learning mode remains the consumer.

## Known limitation

AI-assisted planning is implemented and unit-tested but not operational in the shipped static build: there is no server route to hold the provider credential, so the endpoint is off unless the deployment supplies one. Documented in `docs/visualization-planner.md`; not faked.
