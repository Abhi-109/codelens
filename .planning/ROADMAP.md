# Roadmap: CodeLens

## Overview

CodeLens records real Python execution and draws it. Phase 7A added the decision layer: deterministic concepts, renderer capabilities, a validated plan and optional AI assistance that can only recommend among real renderers. Phase 7B makes that optional assistance deployable through a server-side boundary and measures the quality of automatic selection.

## Phases

- [x] **Phase 7: Automatic visualization planner (7A)** - Detect concepts, validate a plan, select a real renderer from trace evidence, and optionally refine with AI.
- [x] **Phase 9: Secure AI planner activation (7B)** - A same-origin server route holds the provider credential, validates every request and response, and the planner gains a measured quality corpus.
- [x] **Phase 10: Data Structures Lab expansion** - Seven complete teaching structures, with a full hash table (four hash functions, four collision strategies, tombstones, resizing) and eleven seeded lessons.

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

### Phase 10: Data Structures Lab expansion
**Goal**: The authored lab covers seven structures completely, including a hash table whose hashing, collision handling, deletion and resizing are explicit, reversible and explained, with lessons that open a prepared dataset.
**Depends on**: the existing operation-model lab (Tier 1)
**Success Criteria** (what must be TRUE):
  1. Every structure the page lists offers the operations its lessons claim, and no operation changes state on an error.
  2. The hash table supports four hash functions and four collision strategies, with tombstones, load factor, automatic/manual resize and forced rehash.
  3. Any stored key can be read back after any sequence of operations, and every step is an independent snapshot (Back and seek are exact).
  4. The page states its deferred variants instead of implying them.
  5. Lessons link to a real structure and a real preset; `test:js`, `test:tracer`, `lint`, `build` and `check:browser` pass.
**Plans**: 1 plan

Plans:
- [x] 10-01: Shared frames, six extended structures, the hash engine, drawings, lessons, tests and docs

### Phase 11: Hash table learning enhancements + graph repair
**Goal**: The lab explains how each hash is actually computed, offers universal and Robin Hood hashing as real implementations, validates two predictions against the engine, and draws a graph whose layout is topological rather than a single circle.
**Depends on**: Phase 10 (the hash engine, frame contract and graph model)
**Success Criteria** (what must be TRUE):
  1. The calculation panel renders engine-produced steps only; every accumulation matches `rawHash()` and every index matches `bucketIndex()`.
  2. Universal hashing is a fifth hash function with reproducible parameters that survive rehashing; Robin Hood is a fifth strategy with displacement swaps, correct lookup and backward-shift deletion.
  3. Both prediction challenges return the engine's own answer, including duplicate updates and the threshold boundary.
  4. Graph layout is deterministic, topology-aware, non-overlapping, fits its viewport at 390 px, and never changes BFS/DFS order; traversal shows the active edge, queue/stack and order.
  5. Geometry tests and browser checks pass alongside `test:tracer`, `test:js`, `lint` and `build`.
**Plans**: 1 plan

Plans:
- [ ] 11-01: Five workstreams (A–E), one commit each

### Phase 12: Cuckoo hashing and incremental rehashing (deferred)
**Goal**: Two genuinely structural variants, each with its own state shape and reversible playback.
**Status**: Deferred, not started. Cuckoo hashing needs multiple candidate
locations, an eviction chain with cycle detection and a rebuild; incremental
rehashing needs old/new tables, a migration cursor, operations during migration
and reversible migration steps. Neither is implemented or implied by Phase 11.

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 7. Automatic visualization planner (7A) | 1/1 | Complete | 2026-10-26 |
| 9. Secure AI planner activation (7B) | 1/1 | Complete | 2026-10-26 |
| 10. Data Structures Lab expansion | 1/1 | Complete | 2026-10-29 |
| 11. Hash table learning enhancements + graph repair | 0/1 | In progress | — |
| 12. Cuckoo hashing and incremental rehashing | 0/0 | Deferred | — |
