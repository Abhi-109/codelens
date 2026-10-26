# Animation visualizer: progress

**Current phase:** 1 (Diff engine) — tasks 1–4, 5a–5c and 6 of 8 done.
**Current milestone:** Motion-first visualizer — Stage 1 (numeric bars) done; Stage 2 awaits
approval. Task 7 Stages 1–3 remain complete; the diff engine's remaining `apply.js`/golden
work is separately scoped.
**Last updated:** 2026-10-26

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
- 2026-10-26 — **The call strip caps at the 24 most recent frames.** A runaway
  recursion records about a thousand frames; drawing every one produced 9,196 DOM
  nodes. The strip is context, not the subject, so it keeps the deepest calls and
  states how many it left out, while the Stack tab still lists the whole recorded
  stack. `MAX_VISIBLE_FRAMES` in `view.js`, with a unit test on the
  `recursive-deep` fixture and a browser check. The rest of the Phase 5 pass is
  recorded in `docs/phase5-checklist.md`.
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
The values, results and output pass is browser-validated (see Phase 6 notes below). The
remaining animation-spec work is unchanged: Phase 4 (frames, recursion, objects), Phase 5
(skins), Phase 6 (hardening) and Phase 7 (validation, polish, cleanup).

## Motion stage: values, results and output (Phase 6)
- **Root cause of the empty stage.** `MotionStage` drew only `view.objects`, which is the
  heap: lists, dicts, sets and objects. Scalars lived only in the compact call strip, so a
  scalar-only program fell through to `.motion-no-values` and the canvas said its values
  "stay in the call strip". Printed output and the returned value existed only in the
  Inspector, so `greet()` looked like an empty program after it ran.
- **One generic, trace-driven layer.** `stageResult.js` is pure and takes the recorded
  trace plus the cursor: `outputAt` joins the recorded `output` chunks up to that cursor,
  `lastFunctionReturn` scans backwards for the most recent named function return (the
  module's implicit `None` is excluded), and `ending` is reported only at the final step,
  from the run result. `motionView(plan, { trace, result })` merges those facts with the
  existing diff facts; nothing is invented and no example is special-cased.
- **The stage hierarchy.** A returned-value tile (accent edge, names the function), compact
  scalar tiles (name, value, type, changed/highlighted mark), the existing collection cards,
  the one-sentence operation description, a bounded output area, and a final status line.
  The final status is a line rather than another card, and the return tile stays separate
  from printed output: `showValue` quotes a returned string (`"Hello, Asha"`) while output
  is the raw recorded text (`Hello, Asha\n`).
- **Scalars are values too.** Only the deepest (current) frame contributes tiles; the
  caller's variables remain context in the call strip. Primitive types are `int`, `float`,
  `str`, `bool`, `none` and `other`; functions, classes and modules are filtered out.
  Changed and highlighted variables lead, the strip caps at 12 and says how many remain,
  and a collection is never duplicated as a tile (references keep their object card).
- **Completion is not a result.** The module frame no longer wears the implicit `None` as a
  return arrow, and the step sentence reads "program finished". A caught exception still
  ends as Completed; an uncaught one is "Runtime error" with the recorded type and message;
  limits read Step limit, Timeout or Output limit. Both the tracer's raw `status: "error"`
  shape and an engine `error` object are understood, and a crashed run now opens on its
  failing step instead of step 0.
- **Backward and reset reconstruct from the recording.** Output is a prefix of the recorded
  chunks, so seeking backwards removes future output; step 0 clears output, the return tile
  and the final status. A new run replaces all three rather than adding to them.
- **Verification.** 16 new `stageResult` tests, scalar/return/output/switch/reduced-motion
  tests in `view.test.mjs`, a raw-tracer-error session test, and browser checks for the
  reported `greet()` program (return + output + Completed in the stage, not only the
  Inspector), backward seeking, reset, both themes and 390 px. Counts: 136 Python tests,
  762 JS tests, 181 browser checks. Screenshots inspected: `scalars.png`,
  `greet-final.png`, `greet-light.png`, `greet-mobile.png`, `swap-7.png`, `final.png`,
  `runaway-recursion.png` and `light.png`.
- **Deliberate limits.** The scalar strip shows the current call only and caps at 12; the
  Variables tab keeps the full recording. The output area scrolls past 9.5rem. Editing the
  source keeps the previous trace visible under "Source edited" (existing behavior); it is
  not a stale-value bug in this layer.

## Product experience notes (Phase 4: Learn, Docs, data-structure lab)
- **Learn is data, not markup.** Seven lessons across five sections live in
  `src/pages/lessons.js`; each has objectives, a runnable example id, checkpoints and a
  next-lesson link. `lessons.test.mjs` fails if a lesson loses any of those or names an
  example that is not in the registry. `Lesson.jsx` renders them through the shared
  `Prose.jsx` block renderer, so the prose cannot drift into one-off JSX.
- **Docs are data too.** `src/pages/docsContent.js` holds five pages (editor and playback,
  visualization modes, Inspect tabs, trace events and the shared cursor, Python support and
  limitations). Mode and Inspect lists are generated from `vizMode.js` and `workspace.js`, so
  a new mode without a doc line is a test failure rather than a silent omission.
- **One example registry.** `src/examples.js` gives every built-in program a stable id.
  `?example=<id>` loads that source without running it; an unknown id falls back to
  `recursion`. Lesson links use the same ids, so there is one place to edit a program.
- **The data-structure lab is an authored model, not a Python trace.** `model.js` applies one
  operation to a plain state and records frames; each frame is an independent snapshot plus
  one sentence and its marks. Back/Next/seek therefore draw a past frame directly and a later
  highlight cannot survive. The page says "not a Python trace" in a badge. Six structures:
  array (capacity doubles), linked list, stack, queue, BST (duplicate kept once) and a fixed
  graph (BFS/DFS from A). Errors leave the state unchanged and say why.
- **Deliberate limits, stated on the page:** no tree deletion, no graph editing or start-node
  choice, no manual array resize, no doubly linked lists or priority queues.
- **Verification.** `check:browser` grew a product-page section: every structure and
  operation, Back/Next/seek/reset, invalid input, capacity growth, play/pause, BST duplicate
  and in-order, BFS/DFS, lesson index → lesson → example loaded unrun, both themes, reduced
  motion at 390 px, Tab focus ring and arrow-key seeking, plus the console-clean check.
- **Counts at the end of this task:** 136 Python tests, 738 JS tests, 145 browser checks.
  The only build warning remains Vite's chunk-size advisory.

## Motion-first Stage 7 notes (comparison and swap presentation, browser-validated)
- **Two rings, two meanings.** A recorded comparison's operand cells now carry `is-compare`
  (`--warn`, the palette's amber) while a verified swap keeps `is-active` (`--accent`). A
  comparison is evidence, not a mutation: it adds no action, move, ghost or `is-active` cell.
  Both rings switch instantly, because the shared 140 ms colour fade outlasted a 4x swap and
  left moving cells unmarked for most of the trip; the settled green stays a separate inset
  ring and, when a cell is both active and proven final, the operation's colour is drawn as an
  outer ring around the green. The compare index label is gold only when the cell is not also
  settled.
- **One explanation, built from the same plan as the head.** `motionView.explanation` comes
  from `operationFeedback`, never from source text. A comparison uses the recorded operator,
  operands and boolean result (`4 is greater than 2.`); a non-boolean result gets "produced no
  True or False", and an unknown operator falls back to the recorded symbols. A swap says
  `4 and 2 exchange places.`; shift, insert, remove, change, call and return each get one
  sentence from the verified action. The array and the sentence are wrapped in `.motion-data`,
  so the sentence sits directly under the array instead of at the foot of the canvas.
- **Browser validation** used headless Chrome through a zero-dependency CDP harness (no npm
  dependency added), on the brief's bubble-sort program at 1440x960 and 720x900:
  - step 5 shows gold on 4 and 2, `Compare 4 > 2 → True`, `4 is greater than 2.`, and the
    array stays `[4,2,5,1,3]` with no transform; step 9 is the false comparison, gold on 4
    and 5, with no movement.
  - adjacent 6 -> 7 moves both cells along mirrored arcs (about 175 px apart) with the blue
    ring on the first frame, values attached to their cells on every sampled frame, the
    explanation present from the first frame, and no residual transform or ghost afterwards.
  - 4x speed reduced the move from 18 to 6 sampled frames and settled in about 180 ms.
    Next, Back and a slider seek mid-move left no transform, no stale ring and no stale
    sentence; Back reversed the swap and restored the pre-swap array. Backward playback
    (7 -> 6) animated the reverse swap with the same blue pair.
  - **Second interruption defect, found here and fixed.** R3 moved the measurement ahead of
    `cancelAll` inside one effect, but React runs the *previous* effect's cleanup first, and
    that cleanup still called `cancelAll`. So the next step's measurement ran on already
    cancelled elements and read layout slots, not live positions: a swap interrupted by an
    adjacent swap jumped to the full prior cell offset. The cleanup now only invalidates the
    controller; each effect cancels the previous set after measuring. Measured with two
    adjacent swaps of `[1,2,3]`: across the interruption the value at index 0 stayed at
    `788.6px` and the value at index 1 at `677.9px` (identical before and after, slot offset
    111px); the old code drew each value `57.7px` further on before reversing it.
  - **The interruption fix now has a repeatable regression test.** The CDP harness lives in
    `tools/browser-check/` (no npm dependency) and runs as `npm run check:browser`: it starts
    its own Vite server on a free port and headless Chrome, then drives the real app. The
    interruption check is self-calibrating rather than sleep-based — it polls the live
    transform until the swap has actually travelled, clicks Next mid-move, and requires each
    value's drawn `left` to move by less than half the distance still left to travel (at most
    one animation frame with the fix). It runs at 1x and 4x, plus mid-move Back against an
    undisturbed reference, a slider seek, and reset. 94 checks in total.
  - **Negative control:** re-adding `cancelAll()` to the effect cleanup makes exactly the four
    continuity checks fail (value 1 and 2, at 1x and 4x); restoring the fix makes all 94 pass.
    The harness is the only test that exercises this effect ordering: `npm run test:js` is
    node-only and the project has no jsdom, so a unit test could only inspect source text,
    which the brief rules out.
  - step 18 layers the blue outer ring over the green inset ring; step 22 keeps the settled
    index green while the two operands are gold; the final state is entirely green and
    `[1,2,3,4,5]`.
  - light and dark themes keep gold, blue and green distinct; reduced motion produced zero
    transforms but kept the static rings and the sentence; a 24-cell list stayed on one row
    and scrolled horizontally; long strings stayed inside their cells with the full text in
    `title`; the 720 px layout had no page overflow. No console errors were logged.
  - a long variable chip in the call strip could push the stage wider than its pane at
    720 px, adding an unnecessary horizontal scrollbar; the chip row and pill now shrink and
    the value ellipsizes inside the pill (full text remains in its title).
- **Limits unchanged:** a negative-index or dict-subscript operand still rings nothing, a
  raising comparison shows operands and no verdict, and chained comparisons / `yield` /
  `await` operands are still uncaptured. The browser checks were headless Chrome, not a
  physical device.
- Tests: `view.test.mjs` now has 34 tests (comparison cells, gold-vs-blue separation,
  explanations, malformed-cell refusal, backward/seek reconstruction); JS suite is **698**.

## Corpus coverage notes (Workstream B)
- **Eight programs added, for the gaps the existing 60 did not prove.** The corpus is now
  **68 programs across 34 categories**; the new ones are `scalars-only` (arithmetic, a branch
  and a loop with no collections), `nested-lists` (a list of lists changed from the inside),
  `list-duplicates` (duplicate values sorted, plus an empty list grown by one),
  `list-insert-pop` (`insert(0, …)`, `append`, `pop(0)`, `del a[1]`), `sort-orders` (an
  already-sorted and a reverse-sorted list), `dict-remove` (`del`, `pop`, update) and the
  `comparisons` category: `compare-custom-result` (a rich comparison returning a non-bool)
  and `compare-chained` (a chained comparison, deliberately uncaptured).
- **The new Python tests check the comparison claims, not just the shape.** A chained
  comparison produces no `compare` event; a custom result stays `result: null` and is never
  truth-tested; every operand cell holds exactly the operand value in the same snapshot.
  `test_corpus.py` is now **136** tests.
- **One explainer fix the new program exposed:** `list.pop(i)` and `dict.pop(key)` were
  described as "Takes the last item out of …". A `pop` with an argument now says "Takes one
  item out of …"; the bare `pop()` wording is unchanged.
- **Fixture counts moved exactly, not by a floor:** 122 programs (67 corpus + 55 recognition),
  3440 event steps, 3318 consecutive pairs, all 3440 supported, 0 deferred, all reasons 0.
  Every new program's transitions round trip forward and backward, so the diff engine's
  duplicate-value and reorder fallbacks stay honest without deferring a state action.
- **Docs now separate execution support from visual animation.** `docs/supported-python.md`
  lists the visual operations the canvas actually draws (swap, shift, insert/grow,
  pop/delete/shrink, change, compare, settled green) and says what happens when the evidence
  is not enough; it does not claim arbitrary Python support.
- **Browser checks grew from 94 to 101:** the existing checks plus a dictionary program (draws
  its dictionary and remaining entries, no list cells) and a scalar-only program (says there
  is nothing to draw, still shows variables and an explanation), with no console errors.

## Comparison capture notes (format 3, landed)
- The owner approved the design on 2026-10-25 with two decisions: a **dedicated `compare`
  event**, so a comparison has its own cursor position and can be shown before the mutation
  that follows, and the `format_version` 2 -> 3 bump **in the same commit** as the event, its
  schema documentation and its tests.
- `tracer-poc/comparisons.py` is now the tracer's own instrumentation rather than a POC:
  `run_trace` rewrites the tree with `instrument` and passes `tracer.compare` as the sink.
  `pyodide.worker.js` loads `/comparisons.py` and registers it in `sys.modules` before
  `tracer.py`, which imports it; `client.js` passes the source through the existing init
  message, so the browser path is the same one file the Python tests use.
- The event is `{step, event: "compare", function, frame_id, line, operator, operands,
  result, heap}`. It carries **no frames and no state snapshot**: a comparison changes no
  state, so the renderer keeps the previous line event's snapshot, and each event stays small
  in a long trace. `operands` are exactly two `{value, cell}` entries in evaluation order.
  `cell` is `{object_id, index}` only when the operand was a subscript on a container the
  trace already knows; the id is looked up without allocating a new one, so a temporary list
  inside a loop does not grow the id table.
- `result` is `true` or `false` only when the comparison produced that bool. It is `null` for
  a custom rich comparison's object result (the tracer checks `is True` / `is False`, which
  cannot run user code) and `null` when the comparison raised, in which case the operands and
  operator are still recorded and the exception follows as its own events.
- Steps are untouched: `steps` still counts `line` events, and a `compare` event sits between
  the line event of the line that ran it and the next line event.
- Corpora: the corpus golden was regenerated (only `events` moved; every `steps`, `status`,
  output, error line and exception is unchanged), and `test_corpus.py` now validates compare
  events like any other event (operator from the closed set, exactly two operands, resolvable
  operand references, no snapshot, a real boolean or null result).
- Tests: 8 in `test_tracer.py` (`ComparisonEventTests`): the event's position between lines,
  the operands and cells matching the snapshot, the swap that follows a true comparison, a
  non-bool result left undecided, a raising comparison keeping its operands, chained
  comparisons not captured, operands evaluated once in order, membership/identity operators,
  and comparisons not consuming steps. Python suite is **133 tests**.
- **Renderer landed:** the vendored JS fixtures were regenerated at format 3, so every JS
  consumer now runs on the real compare events. `timeline.js` gives a compare row its
  `operands op operands → True/False` text, `explain.js` and `statementStage.js` describe the
  comparison from the event, and the motion canvas shows `compare 4 > 2 → True` in its step
  head while ringing the recorded operand cells. A compare step has no actions, so it moves
  nothing and cannot establish a settled position; backward playback and seeking recompute the
  same comparison from the same position. A cell is ringed only when its recorded
  `{object_id, index}` still names a visible list/tuple position; negative indices, non-integer
  (dict-key) indices and hidden positions highlight nothing.
- **Limits kept:** a `numbers[-1]` operand records its raw negative index, so the canvas does
  not ring that cell; a dict subscript has no positional cell to ring; a comparison that raises
  shows its operands and no verdict. Chained comparisons and operands containing
  `yield`/`yield from`/`await` are still not captured at all.

## Comparison capture notes (proof of concept, historical)
- Starting point: the trace has no comparison event and no operand record. `programProfile.js`
  has static comparison *sites* (line plus operand labels taken from the AST), and
  `sortingAdapter.js` turns those into highlights by reading the frame's variables at that
  line. That is exactly the source-text-plus-variables derivation the new brief rules out.
- `tracer-poc/comparisons.py` is the requested proof of concept, deliberately outside
  `tracer.py`, so **no trace-format change has happened**. `instrument(source)` rewrites a
  single `Compare` node into `__codelens_compare__("op", line, left, right)` and a subscript
  operand into `__codelens_cell__(container, index)`, which reads the element once and keeps
  where it came from. The helper returns the object the comparison really produced.
- Why the rewrite preserves semantics: operands stay left-to-right and once each; the
  comparison runs once through `operator` dispatch; the result object is returned unchanged,
  so a custom non-bool result is never truth-tested (only `is True` / `is False` are checked,
  and those cannot run user code); only a single comparison is wrapped, so `and`/`or` and
  chained comparisons keep their own short-circuit; exceptions propagate with type, message and
  user source line unchanged; every new node copies the location of the node it replaces, so
  the user `line`-event sequence is identical to the untouched program.
- Left unsupported on purpose: chained comparisons, comparisons whose operands contain
  `yield` / `yield from` / `await`, and slices or multi-dimensional subscripts as cells. A
  comparison that raises reports its operands and operator with `result: None` instead of
  inventing an outcome.
- Tests: 14 in `test_comparisons.py`. Each runs the program twice - as written and
  instrumented - and requires identical output, identical values left in scope and the same
  exception type, message and user line. Focused cases: ordinary/identity/membership
  operators, side-effecting operands and indices (evaluated once, in order), a multi-line
  comparison's start line, short-circuit and chained-comparison guards, an exception from the
  comparison itself, a custom `__gt__` returning a non-bool whose `__bool__` must never run,
  several comparisons on one line, an eight-program corpus, and a `sys.settrace` check that the
  user `line` events are unchanged. Python suite is **125 tests**.
- **Proposed, not taken:** emit a `compare` event
  `{step, event, function, frame_id, line, operator, operands, result}` from the tracer, bump
  `format_version` to 3, document it in `docs/trace-format.md`, then map it in `diff.js` /
  `plan.js` to an active-operand highlight and a "compare 5 > 2" label. That is a
  trace-format change, so it waits for the owner's go-ahead (spec §13).

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

## Motion-first Stage 6 notes (animation refinements)
- Audit first, as asked. `MotionStage.jsx` already measured the live rects before cancelling
  (the R3 fix) and then FLIPped cells with one shared easing, a 12 px vertical arc for both
  swap cells, and `view.durationMs` as the single length; the controller superseded stale
  tickets and every effect cancelled the previous animation set. Nothing kept a second
  source of truth: the cursor still owned the state.
- `src/visualizer/motion/choreography.js` is the new pure part: three role curves (move,
  fade, enter), the arc size, and `moveKeyframes(dx, dy, { arc })`. The first keyframe is
  always the measured offset and the last is always `translate(0, 0)`, so an interrupted move
  continues from where the eye last saw it and every move lands exactly on its layout slot.
- Swap paths are coordinated by direction, not by algorithm: the bow is perpendicular to
  travel, so the cell moving right passes above the row and the one moving left passes below
  it, with one duration and one easing for both. The bow is capped at half the distance and
  at 10 px, and a move under 0.5 px is not animated at all.
- Easing is one curve per role. Movement decelerates and never overshoots (a cell bouncing
  past its slot reads as a bug), fades use the even curve, entrances use the grow curve, and
  the value pulse takes the fade curve.
- Colour changes get their own 140 ms ease-out transition on border, ring, fill and the index
  label, so the blue operation ring and the settled green fade instead of flashing.
  `prefers-reduced-motion` turns that off, and `planMotion` already zeroes every duration and
  drops every ghost, so reduced motion still moves nothing.
- Rapid playback, reverse playback and seeks: mechanism unchanged, now stated where it
  matters. Every effect cancels the previous set before starting its own, so at most one plan
  is in flight, a burst of steps replaces animations instead of queueing them, and a stale
  `finished` cannot settle the controller. A seek or reset is still rendered directly with
  `animate: false` (spec §6/§8); the jump is the recorded target state rather than a stale
  transform, because the whole set was cancelled first.
- Tests: 9 in `choreography.test.mjs`, on real bubble-sort plans plus measured-offset
  geometry: exact start/end offsets, no animation for sub-pixel moves, mirrored swap bows of
  equal magnitude, the bow cap, the three role curves, one duration for both swap cells at
  0.5x/1x/2x/4x with an 80 ms floor, the same verified pair forward and backward, direct
  rendering for seek/reset/reduced motion, and the plan state still equal to the recorded
  target. JS suite is **688 tests**.
- **Not visually validated.** This environment has no browser automation and the suite is
  node-only, so the curves, the arcs and the colour transitions are verified in the model
  only. The manual checks are listed under "Next action".

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
  no jsdom dependency, so this fix has no regression test. Browser-checked later in Stage 7:
  the in-effect order was right, but the effect cleanup still cancelled first, so an adjacent
  swap still snapped; see the second interruption defect in the Stage 7 notes.

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

## Task 7 Stage 6 notes (landing and site pages)
- The landing hero now shows the product instead of decorating it: one framed preview with
  the recorded code on the left and Values / Call stack / Output on the right, separated by
  hairlines rather than nested cards. A value takes the accent only when the trace's own
  `changes` names it, so the hero cannot imply a change that did not happen.
- Removed the dark-mode wave lines, the drifting connector dashes, the floating preview, the
  gradient headline and the pill eyebrow. The headline is flat ink plus one flat accent line,
  and the eyebrow is a mono label beside the brand mark.
- Tokens: `--hero-grad-from`/`--hero-grad-to` and `--hero-wash-b` are gone; one quiet
  `--hero-wash-a` bloom remains. Nothing else in the product used them.
- Shared chrome tightened: `.btn` now uses `min-height: var(--control-md)` so buttons line up
  with the shell's icon buttons, which also take the control height; page titles are 28px.
- The feature strip gained one honest sentence per feature (the titles and the `soon` flag
  the tests pin are unchanged), and the language cards lost their pill badges and filled
  in-card button: a mono status label, an accent "Start with Python" line, and a live border.
- Docs now lays five links on one row at desktop, Learn caps its lesson list at 760px, and
  About is a 2x2 grid. The About copy's corpus count was stale (45/32); it now says 68
  programs across 34 categories, which is what the fixture holds.
- Verified with headless Chrome at 1440x960 and 720px in both themes: no horizontal overflow,
  hero copy and preview aligned, the preview's changed value highlights at the recorded step,
  and no console errors. `npm run test:js` (705 pass), `npm run lint`, `npm run build` pass.

## Task 7 Stage 5 notes (general Python in the motion canvas)
- Call depth is now printed on every nested frame (`depth 1`, `depth 2`, ...), from the
  frame's position in the recorded stack. The deepest frame stays the current one, so a
  recursive descent is readable without a separate call-tree canvas.
- A `return` step prints the value the call handed back (`→ 42`) on the frame that returned,
  and the headline reads `return 42`. Both come from the recorded `return_value`; nothing is
  inferred from the caller's state.
- A raised error now has its own headline and sentence, and the sentence distinguishes what
  happened next: a matching `except` block catches it, no handler caught it here so it passes
  outward, or nothing catches it and the run ends. `unwind` names the frame it leaves, and the
  final `error` step names the type and says the run ended. The wording matches the
  explanation card.
- These overlay facts (`returned`, `recordedError`, `exceptionOutcome`, `eventFunction`) are
  carried on the plan from the **recorded event**, not from the transition's actions. A seek
  has no actions, so reading them from actions made a seeked return or exception go blank.
  The regression is pinned by a test that plans with `previousIndex: null`.
- A scalar-only step says where its values are ("Scalar values stay in the call strip above")
  instead of leaving the canvas with a bare sentence.
- A seek or a hold plans no animation, and the headline used to be derived from those (empty)
  actions: jumping straight to a swap said "no data change", which is a false statement about
  the recording. The plan now also carries `feedbackOperations`, a description-only diff of
  the recorded step before the target, and the headline reads from it. The animation still
  plans nothing on a seek; only the sentence changes. `view.test.mjs` pins a seeked swap and
  a seeked step that really did change nothing.
- Tests in `view.test.mjs` cover the returning frame and its value, a `None` return, stack
  depth and the single current frame, caught vs propagated vs uncaught wording, unwind and
  final error wording, the seeked case, and scalar-only state. JS suite is **705 tests**.

## Task 7 Stage 4 notes (premium workspace: tokens, shell, editor, stage)- Palette retuned to charcoal (`--bg #0e1014`) and warm paper (`--bg #f7f7f4`); the old
  navy/lavender pair read as a different product. Every changed pair is measured by
  `styles/contrast.test.mjs`, including the new gold below.
- Execution colour now has one meaning each: blue acts (`--accent`), **gold compares**
  (`--compare`), green is proven settled (`--ok`), red failed (`--danger`). The motion canvas
  stops borrowing `--warn` for a comparison.
- A ring and a text label need different golds on paper: `--compare` (dark gold, 4.5:1) is
  the word "Compare", `--compare-ring` (brighter gold, 3:1) is the ring on an operand cell.
  On charcoal one gold clears both, so the two tokens share a value there.
- Motion is now the first canvas and `DEFAULT_VIZ`, because it is the only canvas that draws
  the recorded data at every step. A saved choice still wins, so returning visitors keep
  theirs; the tests assert the new intent rather than being loosened.
- Playback moved from the page footer into the animation panel, under the stage and above
  the inspector, so the transport sits with the thing it moves. Run and restart moved to the
  left of the workspace toolbar, directly above the code panel they act on.
- The run story is always folded at the top of the canvas (it stays openable), which gives
  every canvas back the ~60px it was spending on a second header.
- The code panel no longer wraps: lines are `white-space: pre` and scroll horizontally, so a
  long line cannot pretend Python's indentation is shallower than it is. The editor and the
  executed-lines view fill the pane; examples stay at the foot.
- The animation stage keeps a 180px floor, so an open inspector can never squeeze a canvas
  to a sliver; the inspector itself is capped at `min(260px, 30vh)` and scrolls.
- Motion cells are 112px tall with 20px values, the frame strip separates calls with a quiet
  rule, and the reference marker is plain text rather than a pill.
- Verified with `npm run test:js` (698 pass), `npm run lint`, `npm run build`, and headless
  Chrome at 1440x960 in both themes: stage 570px, inspector folded to 31px, playback 44px
  inside the panel, no horizontal page overflow, every canvas renders at its full height.

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

## Phase 7A notes: automatic visualization planner
- A decision layer now sits between the trace and the canvases: `src/planner/`
  detects evidence-labelled concepts, checks real renderer capabilities, validates a
  versioned plan and picks one canvas with a reason code. The renderer still draws only
  the recorded trace, and the plan carries no trace, step or animation.
- Evidence strength is a closed set (`observed`, `structural`, `derived`, `hypothesis`),
  never a numeric confidence. A name or a loop shape alone never proves an algorithm;
  sorting/searching come from the existing recognizer, which needs runtime evidence.
- Auto-selection happens once per run and only until the learner picks a canvas; a manual
  pick is never overwritten. Cursor, playback, output, returns and exceptions are
  untouched, and the only UI addition is one why-line under the existing chooser.
- AI planning is an optional same-origin provider (`VITE_PLANNER_ENDPOINT` /
  `window.__CODELENS_PLANNER_ENDPOINT__`). No key reaches the browser. The repository has
  no server route, so AI is implemented and unit-tested but off in the static build; the
  deterministic path is complete without it.
- Gates: 136 Python tests, 823 JS tests, lint, production build, `check:explain`,
  `test:pyodide`, 195/195 browser checks. Docs: `docs/visualization-planner.md`.
