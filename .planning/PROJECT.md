# CodeLens

## What This Is

CodeLens is a browser-based Python learning workspace: a real tracer records what a program did, and several canvases explain it from that recording. It is for learners who want to see execution rather than infer it.

## Core Value

Every pixel must be backed by the recorded trace. AI may choose how to explain a run; it never decides what happened.

## Requirements

### Validated

- Real Python tracing in a Pyodide worker, with a shared execution cursor — shipped before Phase 7A
- Motion, Adaptive, Call tree, Control flow, Combined and Timeline canvases — shipped before Phase 7A
- Scalar values, returned values, printed output and completion state on the motion stage — Phase 6
- Data-structure labs on an authored operation model, separate from Python traces — Phase 4
- [x] REQ-7A-01: Deterministic concept detection from the AST profile plus recorded trace evidence
- [x] REQ-7A-02: A capability registry for every renderer this build actually has
- [x] REQ-7A-03: A versioned, validated visualization-plan schema with a safe generic fallback
- [x] REQ-7A-04: A pure deterministic planner with inspectable reasons
- [x] REQ-7A-05: Trace-aware integration that preserves the cursor, manual mode choice and every existing renderer
- [x] REQ-7A-06: An optional, validated AI provider boundary that cannot invent runtime facts or expose secrets
- [x] REQ-7A-07: Tests, browser regressions and documentation for the whole planner

### Out of Scope

- Replacing the tracer, trace schema, motion engine or two-panel workspace — they are the accuracy guarantee
- Generating JavaScript, React components or arbitrary animations from a model
- Treating the authored data-structure lab as a Python renderer
- Sending an API key to the browser
- Claiming BFS/DFS, binary search or sorting from names alone

## Context

The repository has a validated program profile (`tracer-poc/analyze.py` + `src/tracer/programProfile.js`) and an existing recognition layer (`src/tracer/recognition.js`). Phase 7A reuses both instead of adding a second parser. The deployment is a static Vite app on Vercel with no backend; AI planning therefore needs a same-origin endpoint supplied by the deployment, and the browser must never hold the key.

## Constraints

- **Accuracy**: the planner consumes trace facts; it never mutates or invents them.
- **Compatibility**: all six visualization modes, the shared cursor, playback, themes, mobile layout and reduced motion keep working.
- **Dependencies**: none added; the validator and provider use plain JavaScript and the platform `fetch`.
- **Security**: no secret in client code; user source is untrusted input to any model.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Reuse the AST profile and recognition instead of a new parser | One source of structural truth; no duplicate Python semantics | Implemented |
| Evidence strength is a closed set (observed / structural / derived / hypothesis), not a numeric score | A number without defined semantics would look scientific and mean nothing | Implemented |
| The plan carries no trace and no execution state | The trace and cursor remain the only runtime truth | Implemented |
| AI is a provider behind a same-origin endpoint, disabled when absent | A static deployment cannot safely hold a key in the browser | Implemented; endpoint deferred |
| Automatic selection applies only until the user picks a canvas | Manual choice must never be overridden | Implemented |

---
*Last updated: 2026-10-26 — Phase 7A complete*
