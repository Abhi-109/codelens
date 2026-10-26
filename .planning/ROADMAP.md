# Roadmap: CodeLens

## Overview

CodeLens records real Python execution and draws it. Phase 7A added the decision layer: deterministic concepts, renderer capabilities, a validated plan and optional AI assistance that can only recommend among real renderers. Phase 7B makes that optional assistance deployable through a server-side boundary and measures the quality of automatic selection.

## Phases

- [x] **Phase 7: Automatic visualization planner (7A)** - Detect concepts, validate a plan, select a real renderer from trace evidence, and optionally refine with AI.
- [x] **Phase 9: Secure AI planner activation (7B)** - A same-origin server route holds the provider credential, validates every request and response, and the planner gains a measured quality corpus.

## Phase Details

### Phase 7: Automatic visualization planner (7A)
**Goal**: Every supported run receives a validated, explainable visualization plan built from source structure and recorded trace facts; AI can improve the choice but never the facts.
**Depends on**: Phase 6 (values, results and output)
**Requirements**: REQ-7A-01 … REQ-7A-07
**Plans**: 1 plan

Plans:
- [x] 07-01: Seven dependency-ordered workstreams (A–G) with per-task verification

### Phase 9: Secure AI planner activation (7B)
**Goal**: AI planning is reachable through a server-side route that never exposes a credential, validates the bounded request and the model's answer with the existing plan schema, and leaves the deterministic planner as the reliable baseline — with the selection quality of both measured on an explicit corpus.
**Depends on**: Phase 7 (planner, registry, plan schema, client AI boundary)
**Requirements**: REQ-7B-01 … REQ-7B-08
**Success Criteria** (what must be TRUE):
  1. A server route in `api/plan.js` answers with the existing selection schema, and `npm run test:js` proves it rejects bad methods, origins, sizes, JSON, schemas, unknown renderers and unconfigured credentials without leaking secrets.
  2. The browser holds only a public endpoint URL; no provider key exists in `VITE_*` variables or client code.
  3. Deterministic planning is unchanged when AI is off, and every AI failure or late answer leaves the deterministic plan, trace, cursor and manual choice intact.
  4. A corpus of 68 recorded programs plus the recognition programs has explicit expected canvases; the deterministic planner matches all of them and the evaluation harness reports the AI-versus-deterministic comparison from mocks.
  5. All seven gates pass and the browser suite exercises a mock endpoint (valid, invalid, error, timeout, stale) through the real client path.
**Plans**: 1 plan

Plans:
- [x] 09-01: Seven workstreams (A–G) with per-task verification

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 7. Automatic visualization planner (7A) | 1/1 | Complete | 2026-10-26 |
| 9. Secure AI planner activation (7B) | 1/1 | Complete | 2026-10-26 |
