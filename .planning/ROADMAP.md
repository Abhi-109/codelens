# Roadmap: CodeLens

## Overview

CodeLens already records real Python execution and draws it. Phase 7A adds the missing decision layer: deterministic concepts, renderer capabilities, a validated plan, and optional AI assistance that can only recommend among real renderers.

## Phases

- [x] **Phase 7: Automatic visualization planner (7A)** - Detect concepts, validate a plan, select a real renderer from trace evidence, and optionally refine with AI.

## Phase Details

### Phase 7: Automatic visualization planner (7A)
**Goal**: Every supported run receives a validated, explainable visualization plan built from source structure and recorded trace facts; AI can improve the choice but never the facts.
**Depends on**: Phase 6 (values, results and output)
**Requirements**: REQ-7A-01, REQ-7A-02, REQ-7A-03, REQ-7A-04, REQ-7A-05, REQ-7A-06, REQ-7A-07
**Success Criteria** (what must be TRUE):
  1. A scalar-only run, a recursive run, a sorting run and a syntax error each receive a valid plan with a stated reason.
  2. Invalid plans and unknown renderer IDs are rejected and fall back to the motion canvas without losing the trace or cursor.
  3. Manual canvas selection still works and is never overwritten by a later plan.
  4. AI-disabled operation is complete; a configured provider cannot bypass validation, and a late response cannot apply to a newer run.
  5. All seven repository gates pass and the browser harness covers auto-selection, manual override, cursor sync and stale-plan prevention.
**Plans**: 1 plan

Plans:
- [x] 07-01: Seven dependency-ordered workstreams (A–G) with per-task verification

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 7. Automatic visualization planner (7A) | 1/1 | Complete | 2026-10-26 |
