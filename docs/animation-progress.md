# Animation visualizer: progress

**Current phase:** 1 (Diff engine) — tasks 1–4, 5a–5c and 6 of 8 done.
**Current milestone:** Motion-first visualizer — Stage 1 (numeric bars) done; Stage 2 awaits
approval. Task 7 Stages 1–3 remain complete; the diff engine's remaining `apply.js`/golden
work is separately scoped.
**Last updated:** 2026-10-25

## Phase checklist
- [x] 0 Audit
- [ ] 1 Diff engine (tasks 1–4, 5a–5c and 6 of 8 done)
- [x] 2 Two-panel page + generic stage
- [x] 3 List motion
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
| 1.5a List/tuple state diff: heap copying, lifecycle, cell changes, append/delete, state-proven tail growth/shrink, explicit supported/deferred classification | done | `75820cb` |
| 1.5b-swap Swap movement: one verified `move.swap` per pair, apply/reverse, duplicate-value and evidence fallbacks | done | `1c95b27` |
| 1.5b-shift Shift movement: one verified adjacent `move.shift`, destination-only apply, `change` inverse, evidence fallbacks | done | `6c8e2c7` |
| 1.5c Insert/pop shapes: verified `grow.insert`, bare `shrink.pop`, explicit `shrink.delete`, Python-normalized insert indices, conservative fallbacks | done | this commit |
| 1.6 Dict/set/object contents: keyed entry and attribute add/remove/change, non-sequence lifecycle, exact inverse with insertion order, deferred ambiguity | done | `f8edf2f` + `82f369f` + `34f1145` + docs commits |

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
  `pop` removes only the last cell, so a middle `pop(i)` is modelled as `delete`; task 5c
  implements that.
  A truncated list whose `more` or visible length changes gets a `highlight` on the object
  with `reason: "truncated"` and is classified deferred; visible cells may still `change`
  with that reason. A tuple cell mutation is `unsupported` and rejected by
  `applyState`/`reverseActions(actions, state)`.
- 2026-10-24 — **Task 5c keeps insert/pop evidence explicit and falls back conservatively.**
  A recognized insert emits `grow.insert` only when the resolved receiver, Python-normalized
  source index, length increase of one and exact prefix/suffix placement agree; negative
  indices count from the end and are clamped to `0..len`, and duplicate values are
  disambiguated by that source index. Bare `pop()` emits `shrink.pop` only when the last cell
  is removed; every explicit `pop(i)` emits `shrink.delete` at the resolved index, including
  the last cell. Delayed/nested calls stay `unknown`: a state-proven tail change uses the
  existing `unknown-shape` append/pop fallback, anything else is a highlight, and no
  intermediate mutation is invented. Truncated lists and tuple targets never claim an
  insert/delete. The corpus has no insert/pop source, so synthetic snapshot pairs provide the
  coverage and genuine insert/pop trace coverage remains deferred.
- 2026-10-24 — **Task 6 models non-sequence content by identity, not position.** Dictionary
  entries and object attributes are keyed by canonical key/name and carry `payload.index`
  only so insertion order can be restored exactly; set membership is keyed by value and its
  index is only the sorted serialization order, never movement. Removals are emitted from
  the highest old index down and additions from the lowest new index up, so forward and
  reverse application both preserve order. Surviving-key reordering, structural changes under
  `more`, an addition to an object already showing 30 attributes, and class changes stay
  deferred with a highlight rather than inventing a remove-and-reinsert or the identity of a
  hidden attribute. No tracer, trace-format, action-kind or UI change was needed.

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
- A change wholly hidden behind `more` can leave the visible snapshot identical, so an
  empty diff is not proof that the whole state is unchanged. The guard test classifies every
  fixture transition and compares exact state; it does not claim to see hidden contents.
- Dictionary/set/attribute removal, empty-container transitions and the ambiguous reorder,
  truncation and 30-attribute-cap cases do not occur in the corpus. They are covered by
  synthetic snapshot pairs, not by real traces.
- Pre-existing build warning: the main JS chunk is 662 KB (> Vite's 500 KB advisory). Not a
  gate failure; do not add a dependency to fix it.

## Next action
Stage 5 R1–R4 are in: labeled cells replace the bars, verified operations ring the cells they
touch, the interrupted-move measurement order is fixed, and the canvas now uses its width with
a single step head (line, operation, source). The R3 measurement fix and the R4 layout both
still need a real browser check; this environment has no browser automation. Comparison
visualisation has no trace data; the smallest viable design for capturing operands and outcomes
is reported and awaits a separate architectural decision. Nothing is pushed.

## Motion-first Stage 6 notes (persistent settled positions)
- **The trace has no field that says "this position is final".** No event carries intent,
  and a state alone cannot prove it: "this cell has not changed lately" is not evidence, and
  "the tail happens to be in order" is true of arrays that still move. The smallest reliable
  way to expose it turned out not to be a schema change at all: a complete trace already
  records the run's own outcome.
- `src/visualizer/motion/finality.js` is that rule, pure and applied per cursor position,
  never accumulated. A position is marked only when all of these hold: the run ended cleanly
  (its last event is a `return`); the list's last recorded contents are untruncated; those
  contents are nondecreasing (finite numbers, big ints excluded); the trace rearranged the
  list in place (two consecutive snapshots of equal length with a different value, so an
  untouched or merely grown list is never coloured); and the cell's current value already
  equals the value that same position ends with, with that match reaching in from an end of
  the row. A lone equal value in a still-moving middle is not marked.
- The rule is algorithm-agnostic. A bubble sort's settled tail, an insertion sort's settled
  head and a selection sort's settled head all fall out of the same boundary match; no loop
  variable, source line, algorithm name or "recently moved" heuristic is read. On the real
  bubble trace the first proven step is 14 (`[2, 4, 1, 3, 5]`) with only index 4 settled,
  then step 24 with `[2, 3, 4]`, then step 29 with all five. `builtin-sort`, which rewrites
  in place, settles all three cells at its last visible step.
- The operation keeps the accent. `is-active` is still the verified swap's two blue cells
  (`--accent`); settled cells take `--ok` green on the border, an inset ring and the index
  label, so the two meanings share one ring shape in two colours. When a swap is itself the
  operation that puts a value in place - which is exactly the first proven bubble swap - the
  cell carries both: blue ring over green index. That overlap is real and is tested.
- Reconstruction needs no bookkeeping: a plan recomputes `finalized` from the state at its
  own index, so backward steps, seeks and reset cannot keep a later step's cells, and there
  is no accumulator to clear.
- Tests: 11 in `finality.test.mjs` and 2 in `view.test.mjs`, all on real fixtures
  (`bubble-sort`, `bubble-duplicates`, `bubble-negative`, `insertion-sort`, `selection-sort`,
  `builtin-sort`, `bubble-sorted`, `bubble-truncated`, `list-basics`, `list-mutation`,
  `merge-sort`, `sort-mixed`) plus one clearly-marked synthetic step-limit trace, because no
  fixture pairs a list with a limit event. The suite checks: every marked cell holds the
  value its position ends with; marks only grow while the list is visible; the last visible
  step settles every cell; the shape is always a prefix-plus-suffix; duplicates settle by
  position; a failed run, a truncated list, an unsorted outcome, an untouched list and a
  grown-only list are never marked; the same index proves the same cells however it was
  reached; reset shows none; and only a list's cells can settle. JS suite is **679 tests**.
- Known limits, deliberately conservative: an already-sorted input (`bubble-sorted`) shows no
  green, because the trace never rearranged it and so proves nothing about a settled
  position; a list built only by appends (`merge-sort`'s merged result) shows no green;
  string, mixed-type and truncated outcomes are never verified. A tracer-emitted per-step
  finality fact would show those too, but that is a trace-format change and was not made.
- No tracer, trace-format, action-vocabulary, diff, cursor, dependency or other-canvas
  change. Untouched programs keep uncoloured cells.

## Motion-first Stage 5 notes (canvas focus and step head, R4)
- Layout cause, fixed at both levels: `.motion-object` was still `flex: 0 1 300px`, so a
  sequence could never use more than a 300 px basis even after the cells replaced the bars;
  every list also kept the card border, padding and type pill. A list/tuple now gets
  `is-sequence`: full row width, no border or padding, no type pill, and its name stays as a
  single quiet label.
- The cells themselves now grow: `flex: 1 1 0` with `64–220 px` bounds and a larger value
  (14 px) and index (11 px), so a short array fills the row evenly and a long one scrolls
  without wrapping. `.motion-objects` uses `align-content: safe center`, so the row sits in
  the canvas instead of at its top corner.
- The head is now one step block: `line N`, the verified operation, and the trimmed source
  line. The "Live state" kicker and the pill styling are gone; a verified mutation is accent
  bold text, a plain step is quiet text. The source snippet is hidden below 720 px.
- Variable-only changes are demoted to a neutral `step`; a data change still wins the headline
  when both happen in one step, so `j 2 → 3` is never the primary explanation. The variable
  chip remains in the call strip with its change flash. A step with no operations says
  `no data change`.
- Comparison handling is unchanged and honest: no operand highlighting, no result derived from
  the array. A bubble-sort comparison line is tested to produce no active cell and no mutation
  label. The head layout leaves room for a comparison element beside the operation.
- Tests: three new (`view.test.mjs` line/snippet passthrough and the comparison-line guard,
  `plan.test.mjs` real-fixture `line`/`lineText`). JS suite is **666 tests**.

## Motion-first Stage 5 notes (animation hardening, R3)
- Inspected, as asked: interruption on fast playback, seeking and reset, reverse swaps and
  reduced motion.
- One defect found and fixed. `MotionStage` cancelled the running animations *before* reading
  the FLIP source rects, and kept the earlier plan's layout rects in `positions`. So an
  interrupted move snapped back to its layout slot, then restarted from the previous step's
  start: a visible backwards jump exactly when playback advances quickly. It now reads the live
  rects first (they include the running transform), keeps the last rect of detached elements so
  an exit ghost still fades from where it really was, then cancels and reads the layout targets.
- No duration, easing, arc height, operation precedence or per-algorithm logic changed. Reverse
  swaps, seeks/resets and reduced motion already behaved correctly: a seek or reset renders the
  target with `animate` false, and reduced motion drops every ghost.
- Existing tests already cover reverse plans, seek/reset, reduced motion and stale controller
  tickets. The measurement order is inside a DOM layout effect, and the suite is node-only with
  no jsdom dependency, so this fix has no regression test; it is code-reviewed and still needs
  a browser check. JS suite stays at **663 tests**.

## Motion-first Stage 5 notes (verified operation highlighting, R2)
- `flagsFor` now also builds an `active` set, exposed per slot as `active` and in the DOM as
  `is-active`. It is derived only from verified actions: both indices in a `move` payload
  (swap and shift), and the one cell an `enter` (grow), `exit` (shrink) or `value` action
  names. Nothing reads the line text, the event name or neighbouring cells, so a
  comparison-looking line marks nothing.
- A removal's cell is already gone from the target state, so the affected element there is the
  leaving ghost: `motionView` marks that ghost `active` and it gets the same ring.
- The ring is deliberately not the change flash: a value change is both `is-changed` (accent
  fill) and `is-active` (accent ring), while a swap is only ringed because a swap is a move,
  not a value rewrite.
- Tests: four in `view.test.mjs`, all real fixtures. A bubble-sort swap names exactly its two
  cells forward and on the inverse plan; an insertion-sort shift names origin and destination;
  `list-basics` append, the `list-mutation` delete ghost and its cell change name one each; a
  no-op bubble-sort line names none, and every fixture step is checked so no active key exists
  without a verified action naming it. JS suite is **663 tests**.

## Motion-first Stage 5 notes (array cells, R1)
- The numeric bars are gone: `src/visualizer/motion/bars.js`, `numericBars`, the `bars` field on
  an object view, the `BarRow` component, and the `.motion-bars` / `.motion-bar*` / `is-bars`
  styles are all deleted. A list and a tuple now share one representation.
- A sequence is a single non-wrapping row of equal boxes. Each box holds the value, and the
  index sits directly below it; `flex: 1 1 0` keeps boxes equal while they fit, `56–160 px`
  bounds keep one long value readable, and `overflow-x: auto` scrolls a long sequence instead
  of wrapping it. An empty sequence draws no boxes and keeps the object card's empty note.
- Values keep `showValue` text, the `data-type` colours, the `ref` badge and stable
  `cell:<objectId>:<index>` keys, so the existing verified swap/shift FLIP still finds the
  same node. The full value is now also in the cell's `title`.
- Tests: six in `view.test.mjs`. Real traces cover positional keys, text and value types for
  bubble-sort, a nested reference in `alias-dict-in-list`, duplicate values in
  `bubble-duplicates`, and a verified swap exchanging values between the same two positional
  cells. Booleans, None and nested labels are checked on the projection because no fixture
  stores them inside a list. JS suite is **659 tests**.
- The old Stage 1 numeric-bar note below is historical and no longer describes the canvas.

## Motion-first Stage 4 notes (verified operation feedback, Commit B)
- `view.js` exports `operationFeedback(plan)`; `motionView` adds it as `feedback`. It is derived
  only from the plan's verified operations and the two snapshots (`state`, `previousState`):
  swap (payload index pair plus the values in the state the animation starts from), shift
  (origin → destination plus the copied value), insert/append (index and value), remove/pop
  (index and value), cell/variable/attribute/entry value change (`old → new`), `call f`,
  `return value`, and a neutral `no recorded change` when nothing in the data changed.
- Precedence is swap → shift → insert → remove → change → call → return → neutral, so a step
  that both calls and binds arguments is reported as the call, and a step with a verified swap
  never falls through to a generic change.
- No comparison is reported: the vocabulary has no comparison action, and a `change` is only
  called a swap when the diff proved one.
- Backward playback reports the same swap pair, because a swap is its own inverse and
  `reverseActions` restores the payload. Backward shifts arrive as `change` actions, which is
  what the reversed action actually is.
- The stage head now renders this text in place of the raw trace event name; mutation kinds take
  the accent chip, neutral steps render as plain text. The cursor, keys, durations, seeking,
  reset and reduced motion are unchanged.
- Tests in `view.test.mjs` use real fixtures for every kind: bubble-sort swap forward and
  backward, insertion-sort shift, list-basics append, list-mutation delete and cell change, a
  variable change, a function-basic call and return, and a real no-op step. JS suite is
  **658 tests**.
- Known limit: the corpus has no `list.insert` or `list.pop` fixture, so the `insert`/`pop`
  wording itself is not covered by a real-trace test (append and delete are).

## Motion-first Stage 4 notes (canvas scale, Commit A)
- The visual problems were layout, not projection: `.motion-objects` was
  `repeat(auto-fill, minmax(240px, 1fr))`, which reserves four or five columns for a single
  list and pins it to the first ~250 px, and `.motion-bars` was capped at
  `clamp(128px, 24vh, 220px)`. Both are gone.
- Objects are now a wrapping flex row that fills the stage. A numeric object gets
  `is-bars`, spans 100% of the row, stretches to the stage height, and drops the card border and
  surface so the stage is the only frame. Other collections keep their card at a 300 px basis.
- Bars fill the width with a 44 px floor and a 110 px ceiling, so short arrays centre as a group
  and long arrays scroll horizontally instead of collapsing. Labels are 13 px values and 11 px
  indices, and the baseline uses `--border-strong`.
- Calls are a compact wrapping strip of function name, call line and variable chips instead of
  bordered cards above the data. Every frame keeps its stable key and the current frame keeps
  its emphasis, so recursion depth is still visible.
- No projection, key, action, timing or reduced-motion change. `SWAP_LIFT`, durations, cursor
  and reverse playback are untouched.

## Motion-first Stage 1 notes (numeric bars, superseded by Stage 5)
- `src/visualizer/motion/bars.js` is the pure projection. It returns `null` unless every slot
  is `int`/`float` with a finite value, so empty, mixed, boolean, reference and unsupported
  collections keep the existing cells. The domain always contains zero (`min(0, …)` /
  `max(0, …)`), and one `from`/`size`/`zero` formula covers positives, negatives, mixed signs,
  equal values and all-zero lists without dividing by zero. It reads slot values and never
  mutates the snapshot.
- `view.js` attaches `bars` to list/tuple objects only. The bar cells keep the exact
  `cell:<objectId>:<index>` slot keys, and `MotionStage` registers each bar column under that
  key, so the existing verified swap/shift FLIP animates the same element the cell view moved.
  No new cursor, action or animation state exists.
- Swaps now take a 12 px vertical arc between the two recorded rects. It is still a
  transform-only WAAPI animation with the existing duration and the existing reduced-motion
  path (which skips all motion). Shift, insert, delete and value changes are unchanged.
- Comparisons are not inferred. The verified vocabulary has no comparison action; `highlight`
  is still emitted only for the existing conservative fallback reasons, and bars render it as
  a static accent.
- Spec threshold updated: bars apply to any non-empty all-numeric list/tuple, not only 8+
  numbers; recorded in the spec decision log.
- Tests in `view.test.mjs` cover positives, zero, equal values, negatives, mixed signs,
  floats, empty/single, boolean/mixed/reference refusal, key stability, real bubble swaps,
  real insertion shifts, seek equality, and non-numeric collections. JS suite is **654 tests**.
- Known limits: a removed cell still ghosts as the small `[i] value` chip rather than a bar;
  very wide values truncate visually and keep the full text in `title`; no browser validation
  was performed for this stage.
- Browser follow-up: the value label now sits on its own bar's top edge (inside the plot)
  instead of in one row above the tallest bar, where short bars' numbers floated far from
  their column. Covers positives, negatives (label above the baseline) and zero, with 18 px
  reserved above the plot for the tallest bar's label.

## Task 7 Stage 3 notes (two-panel workspace, inspector drawer)
- The redesign brief called this Stage B. `.layout` is now three tracks — `var(--col-left, 34%)`,
  a 7px splitter, `minmax(0, 1fr)` — instead of five. The two extra tracks (`--col-mid` and a
  368px inspector column) were never filled by anything, which is why the stage lost about
  375px at desktop widths and why the stale 1199px tab rules fired there.
- Only the left splitter remains. `codelens.columns` stores `{ left }` in the 28–42% range; a
  saved pixel `right` is ignored rather than reinterpreted as a boundary of a different unit.
- The six inspector sections are mounted once, inside the right panel, as one native
  `<details class="inspect-drawer">` under the stage. It is open by default and starts folded
  in Motion; the inspector stays mounted, so the chosen section and its scroll survive a fold.
  This is the approved Task 7 amendment in spec §2 (2026-10-24), not the original "no tabs"
  sentence: the inspector is reachable inside the single right panel instead of in a third
  column, capped at 320px/36vh so the stage keeps the room above it.
- Motion is the canvas now: `.motion-stage` uses `--code-bg` and an inset hairline instead of a
  border, because `MotionStage.jsx` measures ghosts from that element's border box. A slot no
  longer draws a frame or a background of its own — only a changed slot does — and the
  `--shadow-sm` on frames/objects is gone, so the object card is the only nested card. Objects
  auto-fill at 240px instead of 210px, so two structures sit side by side in the wider panel.
- `RunStoryCard` takes `compact`; in Motion the run map starts folded but is still a
  `<details>` the reader can open, and changing canvas re-applies the default. The map itself,
  and every mode that shows it, are unchanged.
- Mobile: the ≤899px bar is the two-pane switcher again — Code and Visual Animation, with
  `data-pane="visual"` replacing the old `graph`/`side` pair. The 1199px block is deleted, so
  the desktop keeps both panels side by side down to 900px. The bar's `display: flex` moved
  into the 899px block; without it the base `display: none` won and the switcher disappeared on
  phones. ARIA ids follow the new pane ids.
- shadcn was inspected through the MCP and **nothing was installed**: no registry is configured
  (`components.json`, `src/lib`, Tailwind and TS are all absent) and every candidate is a
  `.tsx` + Tailwind component, so each would need a rewrite against the token CSS plus a
  dependency. The existing CSS-grid splitter, ARIA tab strips and native `<details>` do the
  same jobs.
- Six files changed: `src/App.css`, `src/visualizer/workspace.css`, `src/App.jsx`,
  `src/visualizer/RunStoryCard.jsx`, `src/visualizer/motion/motion.css` and this file. No
  tracer, trace-format, action-vocabulary, diff, `MotionStage`, state-management, dependency or
  default-canvas change; the six modes, playback, cursor and both themes are untouched.
- Gates at this commit: tracer **111 tests OK**, JS suite **648 pass / 0 fail**, oxlint clean,
  `vite build` succeeds (707.52 kB main chunk, the known advisory). No browser check was
  possible here, so the grid, the drawer and the phone switcher are verified in CSS and JSX
  only, not rendered.

## Task 7 Stage 2 notes (real action integration)
- `src/visualizer/motion/view.js` turns a Stage 1 plan into the DOM-free renderer model:
  persistent frames, variables, object cards and slots, plus `entering`, `exiting`,
  `changed`, `highlighted` and `moves` flags. Current nodes always carry the exact target
  snapshot; exit ghosts carry the recorded previous node only, and only when the plan is a
  real adjacent animation. Seeks, resets, holds and reduced motion expose no ghosts.
- `MotionStage.jsx` draws those nodes with stable React keys and uses Web Animations for
  enter, exit, value pulse, FLIP card/frame moves and verified list movements. List swaps use
  `payload.indices`; shifts use the action's adjacent pair; insert/delete reindexing uses the
  action's recorded index. The renderer never infers a move from equal values and never
  invents list-cell identity: positional keys may change value while keeping their key.
- The canvas consumes the shared event cursor and the Stage 1 controller. Every new effect
  cancels the previous animations and supersedes its ticket; completion only settles the
  controller and never dispatches to the session. Rapid stepping, backward steps, seeks and
  resets therefore leave the cursor owned by the workspace.
- Reduced motion is honored twice: `planMotion` zeroes durations, and the component skips
  all Web Animations and ghosts, drawing the exact target directly. `useReducedMotion` keeps
  the OS preference live.
- `Motion` is a sixth entry in the existing canvas switcher (`vizMode.js`), and every prior
  canvas and inspector remains reachable. No two-panel refactor, tracer change, trace-format
  change, action-vocabulary change, dependency or default-canvas change was made.
- Real-trace tests in `view.test.mjs` cover every live action target and ghost across the
  13-program matrix, a real bubble swap, a real list append and delete, a dictionary value
  change, real call/return frames, real object lifecycle, and reduced motion. The single
  highlight test is marked synthetic because no fixture currently emits that fallback action;
  the plan and nodes still come from a real trace. JS suite is **648 tests**.
- Browser smoke check on `List.py` in the dev server: selecting Motion showed the real
  `fruits` cards, step forward created the expected cell/value nodes, three steps 50 ms apart
  advanced one step each and settled with no dangling animations, Last/First rendered the
  target directly, and emulated reduced motion produced zero animations and zero ghosts.
  (Synchronous clicks on the same button still advance once because the existing playback
  handler closes over the current index; that is unchanged and outside this task.)

## Task 7 Stage 1 notes (motion plan and playback foundation)
- `src/visualizer/motion/plan.js` turns one shared cursor position into a pure plan. The
  target state comes only from `snapshotAt`/`stateOf`; the previous state and actions come
  only from `diffSteps`. Adjacent forward steps, adjacent backward steps, seeks, resets and
  holds are distinguished, and only adjacent steps expose actions for motion.
- Stable node keys use trace identity where it exists: object id, canonical dict key, set
  member value, attribute name and frame id. List/tuple cells are keyed by position because
  the trace records no cell identity; a value change keeps the same positional key and no
  value-to-cell identity is invented.
- Actions map to generic `enter`, `exit`, `value`, `move`, `highlight` and `overlay`
  operations. No algorithm names, list-sort branches or fake intermediate states exist in the
  motion layer. Operations retain the original action, target, reason and payload.
- `motionDuration` scales a fixed 80–280 ms range by the existing speed choices; reduced
  motion sets every duration to zero and marks the plan reduced. `createMotionController`
  supersedes older requests and ignores completion from a stale animation. Seeking/reset/
  hold plans carry the exact target state with no actions, so they render directly.
- Tested against real traces from 13 corpus/recognition programs, all steps forward and all
  adjacent steps backward: exact target state, forward/reverse action equality, unique node
  keys, real move/change/shrink/enter mapping, seek/reset/hold, reduced motion, speed, stale
  completion and trace immutability. This is model-level coverage only; no DOM-test
  dependency was added. JS suite is **640 tests**.

## Task 1.6 notes (dict, set and object contents)
- `diff.js` adds keyed content diffing for dictionaries, sets and objects plus whole-entry
  lifecycle for all three. Dictionary entries and object attributes are matched by canonical
  key/name; set members by value. Add is `appear`, remove is `disappear`, value/attribute
  change is `change`, all on the existing `entry`/`attribute`/`object` targets. No new action
  kind or trace field was added.
- Removals are emitted from the highest old index down, then changes, then additions from the
  lowest new index up. The `appear`/`disappear` payload index restores insertion order; a set's
  index is only its sorted serialization order. Forward and reverse application both produce
  the exact section-3 state, including `more`, `class` and key order.
- Deferred with a highlight: reordering surviving dictionary entries or attributes,
  structural changes under `more`, an object addition while 30 attributes are visible, and
  class changes. A wholly hidden change with identical visible content produces no action;
  the documentation states that an empty list is not proof of no state change.
- Measured on the 114 corpus and recognition programs: 2933 event steps, 2819 consecutive
  pairs, **2933 supported, 0 deferred** (Task 5 baseline: 2896 supported, 37 deferred). All
  37 former `task-6` pairs now round trip exactly. Real traces pin dictionary add/change
  (`dict-basics`), set add (`set-basics`), attribute add and object lifecycle (`class-basic`)
  and attribute change (`combo-class-loop-dict`); dictionary/object lifecycle disappearance
  is observed in `comprehension`, `function-star-args`, `exception-custom` and
  `recognition/linear-dict`. Entry/attribute removals, empty containers, mixed transitions,
  ambiguity and malformed actions are synthetic; the focused lifecycle test is synthetic but
  the corpus also exercises both directions. The JS suite is **632 tests** and all four gates
  pass.

## Task 1.5 audit-fix notes (docs and tests only; superseded by task 6)
- At that point `docs/animation.md` §9–§12 stated that dict/set/object content and
  non-sequence lifecycle changes were deferred to task 6 and might produce no action for the
  deferred change. It no longer claims every unmodelled change yields a reasoned action, that an
  empty result proves the whole state unchanged, that the suite prints a report, or that
  every non-round-tripping transition carries a highlight. The per-program report belongs to
  task 8.
- The classification test now applies and reverses the frame/variable actions of every
  deferred transition and compares exact `frames` with `isDeepStrictEqual`. It checks every
  list/tuple object on either side, including lifecycle, before any deferral handling;
  deferred non-sequence objects are counted as task 6 rather than claimed to round-trip.
- Four focused tests pin existing behavior: a swap written high-first, a negative-index
  swap, insert/append/pop through attribute and subscript receivers, and the two-step timing
  of `print(a.pop())` (no state action at the output step; one conservative `shrink.pop` at
  the next state step).
- Counts unchanged: 2933 event steps, 2819 pairs (2782 supported), 37 deferred (`task-6`).
  JS test count is **622**. No runtime file, tracer, trace format, action vocabulary, UI or
  dependency changed.

## Task 1.5c notes (insert/pop shapes)
- `diff.js` imports the existing `evaluateExpression` and carries the frame's integer
  environment through `shapeContext`. Insert positions use Python's `list.insert` rules:
  a negative index counts from the end, then the result is clamped to `0..length`. Both
  literal and variable indices are evaluated, including negative and out-of-range values.
- A recognized `insert` emits exactly one `grow.insert` only when the resolved receiver,
  resolved index, `newer.length === older.length + 1`, and exact prefix/suffix placement all
  agree. Duplicate values are disambiguated by the source index, not value matching; an alias
  still yields one action keyed by object id.
- A recognized bare `pop()` emits `shrink.pop` only when the last cell was removed. Every
  explicit `pop(i)` emits `shrink.delete` at the resolved index, including the last cell;
  its inverse is `grow.insert` at that same index.
- Evidence mismatch or an unresolved index never invents an insert/delete. A state-proven
  tail change uses the existing `unknown-shape` `grow.append`/`shrink.pop` fallback; other
  structural changes are highlights. `print(a.pop())`, `x = a.pop()` and nested calls stay
  `unknown` because `lineShape` requires the call to be the whole statement.
- Truncated lists and tuple targets never claim an insert/delete; the truncation branch and
  tuple branch run before the list structural inference. Malformed insert/delete actions,
  out-of-range indices, missing `to`/`from` and tuple mutations are refused by apply/reverse.
- Synthetic snapshot pairs cover normalized indices, duplicates, aliases, bare and explicit
  pop (including last/only cells), empty lists, evidence mismatches, unresolved indices,
  tuples, dictionaries, sets, truncation, delayed nested calls and malformed actions. The
  corpus and recognition fixtures contain no insert/pop source, so genuine trace coverage
  remains deferred.
- Counts unchanged: 2933 event steps, 2896 supported, 2819 pairs (2782 supported), 37
  deferred. JS test count is **618**. No change to the tracer, trace format, action
  vocabulary, `lineShape.js`, `evaluate.js`, UI or dependencies.

## Task 1.5b-shift notes (movement, adjacent shifts)
- `diff.js` emits one `move.shift` for an adjacent copy only when the shape, resolved
  indices and snapshots agree: the destination receives the source's previous value, the
  source is unchanged, and every other cell is unchanged. The action targets the
  destination, carries `payload.indices = [source, destination]`, `from` the overwritten
  destination value and `to` the copied value. Forward application updates only the
  destination.
- Equal source/destination values get one object `highlight` with `duplicate-values` and no
  state action. Unproven values or extra cell changes stay cell `change`s with
  `unknown-shape`.
- `reverseActions` emits one `change` on the destination, `from` the copied value and `to`
  the overwritten value; it never shifts in the opposite direction. Malformed shifts (wrong
  target, non-adjacent or out-of-range indices, missing indices/from/to, tuple) are refused
  by both functions.
- Tests pin synthetic right and left shifts, the conservative cases, all 7 real
  insertion-sort shifts (one pinned golden and exact round trips), and malformed actions.
  The exhaustive property accepts both motions and still requires exact full-state equality.
  Counts unchanged: 2933 event steps, 2896 supported, 2819 pairs (2782 supported), 37
  deferred.
- JS test count is **608**. No change to the tracer, trace format, action vocabulary,
  `lineShape.js`, UI or dependencies.

## Task 1.5b-swap notes (movement, swap only)
- `diff.js` emits exactly one `move.swap` per verified pair. Evidence requires the
  recognized swap shape, both indices resolving to the same list object, the snapshots
  exchanging exactly those two cells, and no other cell changing. The action targets the
  lower index (stable id) and carries `payload.indices` in the order the statement wrote
  them; applying it exchanges both values exactly once.
- Equal values at the two cells prove nothing visible: the step gets one object `highlight`
  with `reason: "duplicate-values"` and no state action. Unresolved indices, non-matching
  values, truncated lists and unknown shapes stay on the existing `change`/`highlight`
  fallbacks; a leftover swap cell change now always says `unknown-shape`.
- `applyState` rejects malformed pairs (missing indices, same cell, out of range, target not
  the lower index, tuple, non-list). `reverseActions` returns the same swap action, so both
  directions apply once. `move.shift` was still refused until 5b part 2.
- Tests pin a synthetic verified swap, the conservative cases (unproven values, equal
  values, unresolved index), real bubble/selection swaps, and malformed pairs. The
  exhaustive property accepts `move.swap`, requires its index pair and lower-index target,
  and still rejects `move.shift`. Classification counts are unchanged: 2933 event steps,
  2896 supported, 2819 pairs (2782 supported), 37 deferred.
- JS test count is **603**. No change to the tracer, trace format, action vocabulary,
  `lineShape.js`, UI or dependencies.

## Task 1.5a notes (list/tuple state, not movement)
- `stateOf` now deep-copies the heap (entries and `items` arrays) as well as the frames, so
  applying or reversing actions can never mutate the trace. References stay references, so
  aliases still share one object.
- `diff.js` compares list/tuple entries by object id. It supports object lifecycle
  (`appear`/`disappear` on the object), equal-length cell `change`s, recognized
  `append`/`del` (`grow.append`, `shrink.delete`), and state-proven tail growth/shrink
  (`grow.append`/`shrink.pop` with `reason: "unknown-shape"`). Sort and reverse appear as
  cell changes with that reason, because those lines carry no movement shape; swap movement
  landed in 5b part 1.
- Tuples are lifecycle-only. A tuple whose cells differ gets one `highlight` on the object
  with `reason: "unsupported"` and no cell action; `applyState` and
  `reverseActions(actions, state)` reject a tuple cell mutation.
- Truncated lists never claim movement, growth or shrinkage. Visible cells may `change`
  with `reason: "truncated"`; a `more` or visible-length change gets an object `highlight`
  with `reason: "truncated"` and is classified deferred. An unknown non-tail structural
  change gets `highlight` `unknown-shape`/`unsupported`, never a guessed move.
- `applyState` accepts `grow.append`/`insert` and `shrink.pop`/`delete`; `append` is
  tail-only, `pop` is last-cell-only, and both motions invert bijectively. `reverseActions`
  takes the optional after-state to reject tuple-cell inverses. `move.swap` is applied in
  5b part 1; `move.shift` followed in part 2.
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
  previous value, not a reverse shift. Swap and shift are now both implemented.
- JS test count was 600 at this commit. Tracer, trace format, action vocabulary, `lineShape.js`,
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
