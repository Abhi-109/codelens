# Animation visualizer: progress

**Current phase:** 0 (Audit) — complete, awaiting owner review
**Last updated:** 2026-10-24

## Phase checklist
- [x] 0 Audit
- [ ] 1 Diff engine
- [ ] 2 Two-panel page + generic stage
- [ ] 3 List motion
- [ ] 4 Frames, recursion, objects
- [ ] 5 Skins
- [ ] 6 Hardening
- [ ] 7 Validation, polish, cleanup

## Current phase: tasks
| Task | Status | Commit |
|---|---|---|
| 0.1 Audit the real tracer, trace data, reuse surface and baseline; write `docs/animation-audit.md` | done | (this commit) |

## Decisions made
- 2026-10-24 — **No tracer change is needed for v1.** The format-2 trace plus the
  editor's source answers every question in spec §6–§7 (index markers via the frame's
  variables at the `line` event, line shape by parsing the source). `format_version`
  stays at 2. Reason: the audit found no missing field that the diff needs; every
  ambiguity is resolved by the executed line's text, and the remaining gaps (cell
  identity, return landing slots) are ones the spec already says to answer with
  `highlight` or omission. Recorded in `docs/animation-audit.md` §6.
- 2026-10-24 — **Keep full snapshots.** Measured worst case at browser limits is ~1.5 MB
  for 1500 events; deltas/checkpoints are not justified. Diff lazily per displayed step.
- 2026-10-24 — **Phase 1 can test against `src/tracer/__fixtures__/recognition.json.gz`**,
  which already holds 54 real traces including bubble/selection/insertion sort and binary
  search. No corpus change is needed for the diff golden tests.

## Open questions for the owner
1. Does "Step 4 / 12" count trace events or `line` events? (Recommendation: events.)
2. The spec says "45-program corpus"; the repo has 60 — confirm the spec number is stale.
3. Should a return value with no landing variable (e.g. `print(f(x))`) animate to the
   console, or stay on the returning frame?
4. Are sets acceptable as "bag of cells that appear/disappear, never move", given the
   tracer sorts them?

## Known issues and limits found
- A multi-line statement emits several `line` events with no state change (real trace:
  `result = greet(` / `"Asha",` / `)` gives three module line events before the call).
  The diff must emit zero actions for those steps and the caption must not repeat itself.
- 8.6% of consecutive state pairs in the corpus are byte-identical (mostly `return` events,
  where the returning frame is still on the stack), so "no action" is a normal outcome.
- List cells, dict entries and attributes have no ids. Swaps/shifts with duplicate values
  are invisible or ambiguous from snapshots alone; the executed line's shape is required.
- Sets serialize sorted, so index motion is meaningless for them.
- `__slots__` classes become `other` with a repr that embeds a memory address (not
  byte-deterministic, no fields). Names starting with `__` are hidden from `variables`.
- The corpus has no linked list, tree, hash table, sorting or search programs; those
  fixtures live out of band (recognition fixture) or must be added in Phase 5.
- The old page's counter shows `index + 1 / trace.length`, while `result.steps` counts line
  events only. The new page should pick one definition (open question 1).
- Pre-existing build warning: the main JS chunk is 662 KB (> Vite's 500 KB advisory). Not a
  gate failure; do not add a dependency to fix it.

## Next action
Wait for the owner's review of `docs/animation-audit.md`; after "go" on Phase 1, start
`src/animation/actions.js` plus the safe evaluator, with golden tests from the corpus and
recognition fixtures.
