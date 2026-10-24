# Animation visualizer: progress

**Current phase:** 1 (Diff engine) — tasks 1–4 and task 5a of 8 done. Tasks 5b, 5c and 6–8
await approval, one at a time.
**Last updated:** 2026-10-24

## Phase checklist
- [x] 0 Audit
- [ ] 1 Diff engine (tasks 1–4 and 5a of 8 done)
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
| 1.1 Action vocabulary, canonical targets, deterministic ids, overlay reset helper, `docs/animation.md` skeleton | done | `8e4e4b9` + `0900dc3` |
| 1.2 Safe index-expression evaluator + separate bounds resolver | done | `044140e` + `9079d15` |
| 1.3 Statement-shape parser (`lineShape.js`) + tests | done | `abe932e` + `c9156f6` |
| 1.4 Diff core: snapshots, frames, calls, returns, print, error, variables, apply/reverse, six goldens | done | `6979804` |
| 1.4b Docs/test cleanup before task 5: deferral wording, error `phase`, exact coverage assertions | done | `c6b7b8f` |
| 1.5a List/tuple state diff: heap copying, lifecycle, cell changes, append/delete, state-proven tail growth/shrink, explicit supported/deferred classification | done | this commit |

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
- 2026-10-24 — **Task 5a keeps the grow/shrink inverse pairs bijective.**
  `grow.append` ↔ `shrink.pop` and `grow.insert` ↔ `shrink.delete`; `append` is tail-only and
  `pop` removes only the last cell, so a middle `pop(i)` will be modelled as `delete` in 5c.
  A truncated list whose `more` or visible length changes gets a `highlight` on the object
  with `reason: "truncated"` and is classified deferred; visible cells may still `change`
  with that reason. A tuple cell mutation is `unsupported` and rejected by
  `applyState`/`reverseActions(actions, state)`.

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
Await approval to start Phase 1 task 5b: movement inference (`swap`/`shift`) with source-shape
plus snapshot evidence, and the conservative fallbacks when the evidence is incomplete.
Task 5c (pop/insert shapes and truncation fallbacks) and tasks 6–8 are unchanged in the
approved plan.

## Task 1.5a notes (list/tuple state, not movement)
- `stateOf` now deep-copies the heap (entries and `items` arrays) as well as the frames, so
  applying or reversing actions can never mutate the trace. References stay references, so
  aliases still share one object.
- `diff.js` compares list/tuple entries by object id. It supports object lifecycle
  (`appear`/`disappear` on the object), equal-length cell `change`s, recognized
  `append`/`del` (`grow.append`, `shrink.delete`), and state-proven tail growth/shrink
  (`grow.append`/`shrink.pop` with `reason: "unknown-shape"`). Sort and reverse currently
  appear as cell changes with that reason; movement is task 5b.
- Tuples are lifecycle-only. A tuple whose cells differ gets one `highlight` on the object
  with `reason: "unsupported"` and no cell action; `applyState` and
  `reverseActions(actions, state)` reject a tuple cell mutation.
- Truncated lists never claim movement, growth or shrinkage. Visible cells may `change`
  with `reason: "truncated"`; a `more` or visible-length change gets an object `highlight`
  with `reason: "truncated"` and is classified deferred. An unknown non-tail structural
  change gets `highlight` `unknown-shape`/`unsupported`, never a guessed move.
- `applyState` accepts `grow.append`/`insert` and `shrink.pop`/`delete`; `append` is
  tail-only, `pop` is last-cell-only, and both motions invert bijectively. `reverseActions`
  takes the optional after-state to reject tuple-cell inverses. `move` is still refused
  until task 5b.
- Round trip measured with the exact section-3 state: 2933 event steps over 114 programs
  (114 run starts + 2819 consecutive pairs). **2896 event steps supported** forward and
  backward, of which **2782 are consecutive pairs**; **37 consecutive pairs deferred to
  task 6**. The deferred set is dict/set/object content and non-sequence lifecycle changes;
  no list transition is deferred for lack of an action. The classification test also round-trips every list/tuple
  object inside a deferred transition.
- Goldens added for `list-mutation` (sort, reverse, assignment, tail `del`), `list-basics`
  (append, lifecycle), `alias-shared`, `class-basic` (nested receiver append), `tuple-unpack`,
  `filter-list`, `bubble-truncated` and `merge-sort` (state-proven tail growth). Synthetic
  pairs cover `more` changes, visible-length truncation, tuple mutation, non-tail unknown
  structure, middle `del`, all four grow/shrink motions and invalid cell actions.
- `docs/animation.md` section 12 now corrects the `move.shift` inverse: a shift-copy
  overwrites the destination, so its inverse is a `change` restoring the destination's
  previous value, not a reverse shift. This is documented now; the `move` itself remains
  task 5b.
- JS test count is **600**. Tracer, trace format, action vocabulary, `lineShape.js`,
  `evaluate.js`, corpus, UI, old visualizer and dependencies are unchanged.

## Task 1.4b notes (docs/tests only, no behavior change)
- `docs/animation.md` now states in the status block, §10, §11 and §12 that heap-only
  transitions are deliberately unmodelled in task 4 and belong to tasks 5–6; no section
  claims the animation layer is complete before then.
- §5/§10 reconcile the error contract with `diff.js`: an `exception` badge carries
  `{ type, message, line }`; the terminal `error` overlay carries the run's
  `{ type, message, line, phase }` (`compile`, `runtime` or `tracer`), copied from the event.
- The corpus coverage test now pins the fixtures' exact partition (114 programs, 2933
  transitions: 2654 heap-stable round-tripped, 279 deferred) instead of `> 500`/`> 100`
  floors. The `list-mutation` deferral test pins the four heap-only steps (3–6) and their
  recorded list contents, so it fails if it stops exercising a real list transition. It is
  marked temporary until task 5.
- The filler `FALLBACK_REASON.unsupported === "unsupported"` assertion is gone; the
  apply/reverse refusal test now checks `move`, `grow` and `shrink` explicitly.
- No runtime file, action vocabulary, trace format, tracer, corpus, UI or dependency
  changed. JS test count is unchanged.

## Task 1.4 notes
- `diff.js` diffs **state only**: the frame stack, each frame's variables, and the
  console/return/error facts an event records. `call` adds a frame once (no second
  `appear`); a returning frame stays until the next state-bearing event, where its
  `disappear` carries the frame in `from`; `print`, `return` and `error` are overlays.
- Events that record no snapshot (`output`, `input`, `error`, limit events) are shown
  against the last recorded state via `snapshotAt`, so a print step does not look like an
  empty program. `input` adds no overlay because the tracer echoes it as an `output`.
- A return names the console only when `consoleFollowsReturn(trace, i)` proves recorded
  output follows before the next control event; `unwind` repeats an exception that already
  has its badge and adds nothing.
- Round trip measured with the exact section-3 state: 2933 transitions over 114 programs,
  **2654 heap-stable transitions** pass forward and backward; the 279 heap transitions are
  counted and excluded until tasks 5–6, and the test fails if any of them gains a cell,
  entry, attribute or object action before then. Six golden programs pin the action lists
  (assign-only, if-elif-else, for-loop, function-print-return, error-division, recursion).
- `applyState`/`reverseActions` refuse `move`/`grow`/`shrink` rather than skipping them, so
  no half-applied state can pass for a correct one.
- Decision: **no placeholder action for heap changes.** The reason set in `actions.js` is
  closed and has no "deferred" code, and a highlight on every list step would be noise; the
  gap is documented and counted instead. Adding the reason belongs to task 5, where the real
  collection diff makes it unnecessary.

## Task 1.3 notes
- `lineShape.js` recognizes syntax only: swap, shift, subscript assign, attribute assign,
  augmented assign, `del`, `append`/`insert`/`pop`, and an explicit `unknown` with a reason
  from a closed set. It never claims a value moved; `diff.js` will require snapshot evidence.
- Shift is claimed only when **both** indices evaluate and are adjacent; `a[j + 1] = a[j]`
  is `right`, `a[j] = a[j + 1]` is `left`. Without an environment, or when the indices are
  not adjacent, the same statement is a `subscript-assign`.
- Chained assignments and top-level `;` are `ambiguous` so no fragment is recognized
  partially; strings, comments and bracket depth decide every split point, so a lookup
  table or an f-string cannot fake a swap.
- Real-corpus check (665 distinct statements in the corpus and recognition fixtures):
  `unknown/not-a-mutation` 630, `append` 9, `subscript-assign` 7, `swap` 7,
  `attribute-assign` 6, `unknown/unsupported` 4, `del` 1, `shift` 1 — the four
  `unsupported` statements are the documented `setdefault(...).append(...)` chain and the
  two tuple assignments in `tuple-unpack`.
- Fixed while verifying: a bogus number literal (`1abc`) used to tokenize as a number and
  could report a supported mutation for invalid syntax; number tokens are now validated and
  an unreadable character is `unsupported`.
