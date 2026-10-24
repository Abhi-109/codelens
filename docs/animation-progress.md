# Animation visualizer: progress

**Current phase:** 1 (Diff engine) — task 1 of 8 done. Tasks 2–8 await approval, one at a
time.
**Last updated:** 2026-10-24

## Phase checklist
- [x] 0 Audit
- [ ] 1 Diff engine (task 1 of 8 done)
- [ ] 2 Two-panel page + generic stage
- [ ] 3 List motion
- [ ] 4 Frames, recursion, objects
- [ ] 5 Skins
- [ ] 6 Hardening
- [ ] 7 Validation, polish, cleanup

## Current phase: tasks
| Task | Status | Commit |
|---|---|---|
| 0.1 Audit the real tracer, trace data, reuse surface and baseline; write `docs/animation-audit.md` | done | `fd988ad` |
| 0.2 Record the owner's Phase 0 decisions; correct the stale corpus count in the spec | done | `334d210` |
| 1.1 Action vocabulary, canonical targets, deterministic ids, overlay reset helper, `docs/animation.md` skeleton | done | `8e4e4b9` + this commit |

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
- 2026-10-24 (owner) — **The step counter counts executable source-line steps**, not raw
  trace events. Internal events (call, return, output, exception, unwind) stay available
  for animation detail. **Dependency to record:** every selector and the playback cursor
  currently take an *event* index, and the diff engine must keep doing so (a return or an
  output chunk is its own step). The counter is therefore *derived* by mapping the event
  cursor to its `line`-event ordinal (the `lineIndices` table in `traceIndex.js` already
  has this). No tracer change and no renumbering are involved, so nothing outside the
  current phase; the derived counter lands in Phase 2's control strip.
- 2026-10-24 (owner) — **The corpus has 60 programs, not 45.** Section 10 of the spec is
  corrected to 60 and the correction is logged in the spec's decision log. The number was
  stale: `tracer-poc/corpus.py`, `corpus-golden.json` and `README.md` all say 60. The
  corpus itself is not modified, and no test count changes.
- 2026-10-24 (owner) — **Return values may travel to the console.** For `print(f(x))`, a
  supported return value animates toward the console without inventing a landing variable.
  Phase 1 may attach a console target to the `return` action only when the trace proves the
  relationship (recorded `output` events between the return and the next control event);
  otherwise the return animation is the simpler one and no destination is shown.
- 2026-10-24 (owner) — **Sets are unordered.** Their elements appear and disappear as
  cells; they are never animated as ordered positions, never receive index markers and
  never produce `move`/`shift` actions.
- 2026-10-24 (owner) — **Phase 1 approved with conditions**, all recorded here and in
  `docs/animation.md`: (1) `tracer-poc/dump_animation.py` is approved to generate a small
  real-trace fixture for linked list and chaining hash table, without touching the tracer,
  the corpus or the recognition fixture; (2) the reversibility contract separates
  snapshot-state mutations, transient overlays and event metadata, and tests forward/
  reverse state equivalence and the transient reset on backward playback and seek; (3)
  movement needs both source-shape and state evidence, otherwise a conservative
  `change`/`highlight`; (4) no trace is excluded silently — fallbacks are reported with a
  reason; (5) existing tests and the old visualizer are preserved, with no new dependency,
  tracer change, trace-format change or out-of-scope edit.

## Open questions for the owner
None open. All four Phase 0 questions were answered on 2026-10-24 and are recorded above;
the Phase 1 plan is waiting for approval, not for clarification.

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
- The old page's counter shows `index + 1 / trace.length` (raw events), while the owner's
  decision is to show executable source-line steps. The new stage must derive its counter
  from the event cursor; do not renumber the trace, and do not drop call/return/output
  steps that the animation needs.
- Sets are sorted by the tracer, so the diff must never look at their positions: elements
  appear and disappear only (decided 2026-10-24).
- Pre-existing build warning: the main JS chunk is 662 KB (> Vite's 500 KB advisory). Not a
  gate failure; do not add a dependency to fix it.

## Next action
Await approval to start Phase 1 task 2: `src/animation/evaluate.js`, the safe
index-expression evaluator (names, integer literals, `+ - * //`, parentheses) and its
tests. Tasks 3–8 are unchanged in the approved plan.
