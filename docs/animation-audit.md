# Animation visualizer: Phase 0 audit

**Date:** 2026-10-24
**Scope:** read-only inspection of the real repo. No source file was changed; this
document and `docs/animation-progress.md` are the only writes.
**Method:** every claim below comes from running `tracer-poc/tracer.py` over the real
corpus (`tracer-poc/corpus.py`, 60 programs) and the vendored recognition programs, plus
reading `src/`. Corpus runs use the corpus limits (`max_steps=400`, `max_seconds=1.0`);
browser-limit numbers use the app defaults (`max_steps=1500`, `max_seconds=5.0`).

---

## 1. What the tracer records today

`docs/trace-format.md` (version 2) is accurate. Restated from the code, because the
animation layer depends on the details:

| Event | Payload | Notes |
|---|---|---|
| `call` | `function`, `frame_id`, `line`, `frames`, `heap` | fires when the frame starts, before any line runs |
| `line` | same as `call` | fires **before** the line runs, so the snapshot is the state *before* it |
| `return` | same as `call` + `return_value`, `exit_kind: "normal"` | **the returning frame is still in `frames`** at this event |
| `exception` | same as `call` + `exception: {type, message}` | recorded per frame before it unwinds |
| `unwind` | same as `call` + `exception`, `exit_kind: "exception"` | one per frame an exception leaves |
| `output` | `text`, `frame_id`, `line` | one event per `write()`, i.e. `print(1)` is text then `"\n"` |
| `input` | `prompt`, `text`, `frame_id`, `line` | |
| `step_limit` / `timeout` / `output_limit` | `message`, `limit` | |
| `error` | `type`, `message`, `line`, `phase` | |

A snapshot (`frames` + `heap`) is attached to `call`, `line`, `return`, `exception` and
`unwind` only. Every event carries `step`, its index in `trace`. `result.steps` counts
**`line` events only**, so `steps` and `trace.length` are different numbers (see §9).

`frames` is oldest-first; each frame is
`{frame_id, function, call_line, line, variables}` and `variables` maps a name to a value.
The heap is keyed by `o1`, `o2`, … and only holds objects reachable from the current
frames. Values are inline scalars or `{"type": "ref", "id": "o1"}`.

### Excerpt A — `x = 10` then `x = x + 1`

Real trace of `x = 10\nx = x + 1\nprint(x)\n` (7 events, 3 line steps):

```
#0 call    line=0  <module> vars={}
#1 line    line=1  <module> vars={}
#2 line    line=2  <module> vars={"x":{"type":"int","value":10}}
#3 line    line=3  <module> vars={"x":{"type":"int","value":11}}
#4 output  line=3  text="11"
#5 output  line=3  text="\n"
#6 return  line=3  <module> ret={"type":"none"} vars={"x":{"type":"int","value":11}}
```

The change `10 → 11` is only visible on the **next** `line` event (#3), because #2 shows
the state before `x = x + 1` runs. A diff engine that pairs consecutive *state* events
(`#2 → #3`) sees it; a diff that pairs a `line` with the event of the same index does not.

### Excerpt B — a list append

Real trace of `a = [1, 2]\na.append(3)\nprint(a)\n`:

```
#2 line line=2 vars={"a":{"type":"ref","id":"o1"}}
        heap={"o1":{"type":"list","items":[1, 2]}}
#3 line line=3 vars={"a":{"type":"ref","id":"o1"}}
        heap={"o1":{"type":"list","items":[1, 2, 3]}}
```

Same object id before and after. The append is a `grow` at index 2, and because the id is
stable the stage can animate the list in place instead of replacing it.

### Excerpt C — a recursive call

Real trace of `def fact(n): …` called with `fact(3)` (trimmed to the informative events,
`vars` is the top frame's):

```
#2  line   L6 <module>          vars={"fact":function}
#3  call   L1 fact  fid=2 depth=2 vars={"n":3}
#4  line   L2 fact  fid=2 depth=2 vars={"n":3}
#5  line   L4 fact  fid=2 depth=2 vars={"n":3}
#6  call   L1 fact  fid=3 depth=3 vars={"n":2}
...
#11 line   L3 fact  fid=4 depth=4 vars={"n":1}
#12 return L3 fact  fid=4 depth=4 ret=1      (frames: module, fid=2, fid=3, fid=4)
#13 return L4 fact  fid=3 depth=3 ret=2      (frames: module, fid=2, fid=3)
#14 return L4 fact  fid=2 depth=2 ret=6      (frames: module, fid=2)
#15 output L6 text="6"
```

`frame_id` increments per call (never reused within a run), so the three `fact` frames are
distinguishable. The `call` event already contains the bound arguments (`n: 3`), and the
`return` event contains the value while the frame is still on the stack.

---

## 2. Identity and aliasing

* `_Values._object_id` keys by `id(obj)` and keeps a strong reference (`_keep`), so a
  Python object cannot be garbage-collected and have its `id()` reused. Within one run an
  object's id is stable from its first appearance to the end of the trace, and a new
  object never inherits a dead object's id.
* `frame_id` is assigned once per call and is unique within the run.
* Aliasing is preserved, across variables **and across frames**. Real trace of
  `numbers = [1, 2]\nalias = numbers\nalias.append(3)\nnumbers[0] = 9`:

  ```
  #3 line vars={"numbers":{"ref":"o1"},"alias":{"ref":"o1"}}
          heap={"o1":{"type":"list","items":[1,2]}}
  #5 line vars={"numbers":{"ref":"o1"},"alias":{"ref":"o1"}}
          heap={"o1":{"type":"list","items":[9,2,3]}}
  ```

  and in `class Dog`, `self` in `learn()` and `rex` in the module are both `o1`; the
  attribute `self.tricks` is `o2` from both frames. Two names for one object can therefore
  share one card, as §7 of the spec requires.
* Rebinding is honest: `a = [3, 1]; b = a; a = [7]` gives `a → o2`, `b → o1`, and `o1`
  keeps its old contents. No "same id, new contents" lie.
* **Not recorded:** identity of list cells, dict entries or attributes. Only values and
  positions exist. This is the root of every ambiguity in §3.
* **Not recorded:** the object itself for an `other` value. A class with `__slots__`
  serializes as `{"type":"other","class":"P","repr":"<__main__.P object at 0x…>"}` — its
  fields are invisible, and the repr embeds an address (so such a trace is not
  byte-identical across runs, although the corpus itself is deterministic). Names
  beginning with `__` are dropped from `variables` by the tracer.

---

## 3. What a snapshot diff can prove, and what it cannot

All excerpts below are real: A and B are the `line` events immediately before and after
the mutating statement.

| Mutation | Before → after (real) | Diff verdict |
|---|---|---|
| append | `[1,2,3] → [1,2,3,4]` | visible: grow at 3 |
| insert | `[1,2,3] → [1,9,2,3]` | visible: grow at 1 |
| pop (end) | `[1,2,3] → [1,2]` | visible: shrink at 2 |
| delete front | `[1,2,3] → [2,3]` | visible: shrink at 0 |
| index assign | `[1,2,3] → [1,9,3]` | visible: change at 1 |
| swap, distinct | `[9,1,2] → [1,9,2]`, `i=0 j=1` | visible: two changes, no growth |
| swap, equal values | `[9,8,8] → [9,8,8]`, `i=1 j=2` | **invisible**: byte-identical snapshot |
| swap, repeated endpoints | `[1,2,1] → [1,2,1]`, `i=0 j=2` | **invisible** |
| shift right `a[j+1]=a[j]` | `[0,1,2] → [0,0,2]`, `j=0` | visible: change at 1 — but indistinguishable from `a[1] = 0` |
| shift left `a[j]=a[j+1]` | `[1,2,3] → [2,2,3]` | same ambiguity |
| dict set (new key) | entries `a,b` → `a,b,c` | visible: grow at the end (insertion order is preserved) |
| dict set (existing) | `a:1,b:2` → `a:9,b:2` | visible: change of one value, order stable |
| dict delete | `a:1,b:2` → `b:2` | visible: shrink at 0 |
| attribute set | attrs `[] → [x:1] → [x:1,y:2]`; `x:1 → x:3` | visible: grow / change on the object card |
| set add | `{1,2} → {0,1,2}` | visible, but see the ordering caveat below |
| bind / rebind | `a:o1 → a:o2` | visible: reference change; `appear`/`disappear` of the object |

**Ambiguous pairs that need the executed line's shape** (spec §6 says to use it, and the
audit confirms it is required, not optional):

1. Two-element swap vs. two index assignments. `[9,1,2] → [1,9,2]` is a swap when the line
   is `a[i], a[j] = a[j], a[i]`, and two assignments when the line is two separate
   statements. The snapshots are identical; only the source distinguishes them.
2. Shift vs. index assignment. `a[j+1] = a[j]` produces the same snapshot as
   `a[1] = 0` would. Line shape decides.
3. Which duplicate element disappeared. Real trace of `a = [1, 2, 1]; x = a.pop()`:
   `[1,2,1] → [1,2]`. Pure value diff can say "index 0 or index 2", and the smallest-
   movement rule would answer 2 — right here, but only because `pop()` defaults to the end.
   `a.pop(0)` on `[1,2]` gives `[2]`, and a value diff cannot tell "removed the first 1"
   from "removed the last 2" beyond the smallest-movement heuristic. The argument in the
   line text is the evidence.
4. Insert with duplicate values. `a.insert(1, 2)` on `[1,2,1]` gives `[1,2,2,1]`; inserting
   at index 2 gives the same list. The line's argument is the only proof.
5. A swap that is a no-op (`i == j`, or equal values at the endpoints) leaves no snapshot
   evidence at all. The honest output is `highlight`, never `move`.

**Sets are ordered by value, not by history.** The tracer serializes sets sorted
(`{1,2}` + `add(0)` becomes `[0,1,2]`), so a naive index diff would show every cell moving
right. Sets must be diffed as a bag of values (appear/disappear), never by index.

**Everything else is derivable.** Dict entries keep insertion order, so a new key is a
`grow` at the end and an update is a `change` in place. Object attributes are serialized in
`__dict__` order and behave the same way.

---

## 4. Is a snapshot enough to rebuild the stage, and are all directions identical?

**Completeness: yes, for the stage, given `(trace, source)`.** A snapshot contains every
frame with its locals (except `__*` names), every reachable container/object, its scalar
values and references, and truncation markers (`more`, `truncated`, `other`). The console
is rebuilt from the `output`/`input` events up to the cursor (`outputAt` already does
this). Nothing on the planned stage needs to re-run Python. Two documented gaps are the
source text itself (the trace does not carry it; the page keeps `runSource`) and anything
beyond the caps (30 items, 120 chars, 150 heap objects).

**Forward, backward and jump are identical today.** The session reducer keeps exactly one
`index`; `getStepView`, `outputView`, `traceIndex` and the scene builders are pure
functions of `(trace, index, source)` and cache by trace identity, not by direction. To
verify rather than assume, I walked four corpus traces (`recursion`, `list-mutation`,
`dict-basics`, `alias-shared`) forward, backward and in a jump order and compared the full
JSON of `getStepView` at every position: **82 views compared, 0 mismatches**. The existing
test "back and forward are exact inverses in the middle of a trace"
(`src/visualizer/workspace.test.mjs:82`) pins the cursor arithmetic.

That property must survive the new renderer: today there are no animations, so no visual
state can lag the cursor. Once the stage animates, "same index ⇒ same picture" has to be
re-established by an explicit test (spec Phase 3).

**Reading a step needs three conventions**, all already encoded in `traceIndex.js`:

* `line` snapshots are *before* the line. Highlight is right; numbers are previous.
* `return` keeps the returning frame on the stack, so `return → next state` is where the
  frame disappears. Do not emit a `disappear` for it on the return event itself.
* `output`/`input`/limit events carry no snapshot; use the nearest state at or before the
  cursor (`stateAt`).

**One surprise worth designing for:** a statement written over several lines emits several
`line` events, and the state does not change between some of them. Real trace of

```python
result = greet(
    "Asha",
)
```

```
#2 line L4 <module> vars={"greet": …}
#3 line L5 <module> vars={"greet": …}   ← same statement, no state change
#4 line L4 <module> vars={"greet": …}   ← again
#5 call L1 greet  vars={"name": "Asha"}
```

Across the corpus, 95 of 1108 consecutive state pairs (8.6%) are byte-identical (mostly
returns: 76/125; every `unwind`, 7/7; 6/11 exceptions; 6/889 line events). The diff engine
will legitimately produce zero actions for those steps, and the caption/step counter must
stay honest rather than repeat an event.

---

## 5. Trace size for the corpus

Measured with `json.dumps(..., separators=(",", ":"))`:

| Set | Programs | Events | Line steps | Raw JSON |
|---|---|---|---|---|
| whole corpus (corpus limits 400 / 1.0 s) | 60 | 1,415 | 889 | **424,834 B (~415 KB)** |
| same corpus, gzipped | 60 | — | — | 14,488 B (~14 KB) |

Largest corpus programs (bytes): `limit-steps` 102 KB (400 steps), `limit-output` 20.7 KB,
`recursion-mutual` 20.6 KB, `combo-class-loop-dict` 17.9 KB. Half the corpus is under 3 KB.

At the **browser** limits (1500 steps / 5 s), measured worst cases:

| Program | Status | Steps | Events | Bytes |
|---|---|---|---|---|
| infinite counter | `step_limit` | 1500 | 1502 | 383 KB |
| 32-item list then a spin loop | `step_limit` | 1500 | 1502 | **1.50 MB** |
| bubble sort, 30 random items | `completed` | 1178 | 1182 | 1.28 MB |
| linked list, 31 nodes | `completed` | 159 | 227 | 593 KB |

**Full-snapshot storage is acceptable for v1.** The hard ceiling is 1500 events × one
snapshot each, with containers capped at 30 items and 150 heap objects; the observed worst
case is ~1.5 MB of JSON (about 2–15 % of that if ever gzipped). Do **not** add deltas or a
format change. Do keep the pipeline lazy: build a step's actions when it is shown (and
memoise per index), rather than precomputing 1500 diffs per render.

---

## 6. What is missing for the animation the spec asks for

| Need (spec §6–§7) | Available today | Missing |
|---|---|---|
| Index markers (`i`, `j + 1`, `mid`) | the executed line number, the source text, and the frame's variables *at the line event* — enough to resolve `i`, `j`, `mid` and simple arithmetic | no columns or AST in the trace; a safe evaluator and a tiny statement parser must live in JS. Multi-line statements (§4) make "the line" ambiguous: `"Asha",` is a line event too, and must produce no marker. |
| Compared cells | the two index variables and the values on both sides of the cursor | no recorded comparison *result*; derive from the next `line` event (which branch/loop body ran) and the before/after values, never invent it |
| Which object a marker belongs to | the line text and the frame variables | if the line names two containers (`if a[i] == b[i]`), the target is ambiguous — show markers only where the statement parser names one container |
| Return value at the call site | `return_value`, the returning frame's `frame_id` and `call_line`, and the caller's state on the *next* line event | no caller snapshot between "call returned" and "next statement started", and no record of which slot the value lands in. For `x = f()` the landing is the next diff; for `print(f())` there is no landing slot at all (real trace: `fact(3)` returns `6`, module vars never change — only the output events carry it). A "value flies back" animation is honest only up to the call site; landing must be inferred from the next diff, and omitted when there is none. |
| The executed line's structure (swap/shift/insert shape) | line number + source text + variables | no token/column data, no AST; the JS side must parse the statement's target/subscript shape itself. `augmented` (`a[i] += 1`), `del`, tuple targets and chained subscripts all need explicit handling; anything unparsed falls back to `change`/`highlight`. |
| Call frames | `frames` with args bound at `call`, depth, `call_line` | no frame depth cap; a deep recursion trace grows with depth (the tracer's own recursion limit bounds it) |
| Console | cumulative output text and the individual chunks | nothing |

No tracer change is required for any of this. That is the central audit finding: **the
format-2 trace plus the editor's source is sufficient for v1**, so `format_version` does
not need to change and §13 of the spec's "stop and ask" case about the trace format is not
triggered.

---

## 7. Reuse surface

**Reuse unchanged (pure logic, already tested):**

* `tracer-poc/tracer.py`, `corpus.py`, `corpus-golden.json`, `test_*.py` — the tracer is
  not touched by v1.
* `src/tracer/client.js`, `pyodide.worker.js` — session/worker plumbing and the run gate.
* `src/tracer/traceIndex.js` — per-trace lookup tables (`stateAt`, `nextLineEvent`,
  `outputAt`, `printedAfter`, `firstLineIndex`, `frame`). Built for exactly this
  single-cursor model.
* `src/tracer/values.js`, `objects.js` (`slotEntries`, `changedSlots`, `namesById`) — value
  formatting and slot enumeration are the diff's raw material.
* `src/visualizer/output.js`, `playback.js` (speed + storage helpers), `runGate.js`,
  `workspace.js` (`clampStep`, `stepBy`), `session/session.js` + `selectors.js` (one
  `index`, one reducer) — keep the reducer and drop the presentation-only fields when the
  new page owns playback.
* `src/styles/tokens.css`, `src/theme.js`, the shell and the router — both themes and the
  page frame already exist; `prefers-reduced-motion` is already handled in `index.css`,
  `App.css`, `Canvas.jsx` and the landing page, so the pattern to follow is in the repo.
* Tests: `test:tracer` (111), the corpus/stepView/traceIndex/values/objects/output/
  playback/runGate/workspace/session suites, and the no-hardcoding test. The last one
  scans `src/tracer` and `src/flowchart` only — **add `src/animation` to its `DIRS` in
  Phase 1** so the new layer is held to the same rule.

**Reuse with adaptation:** `PlaybackBar.jsx` (transport icons, slider, speed — but its
Glossary and Developer menus are outside the two-panel spec and must not come along);
`App.jsx`'s `CodeLine` editor rendering (line numbers, current/just-ran marks, hints);
the splitter + `localStorage` pattern in `App.jsx`; the "examples" menu.

**Replaced by the new page (kept until Phase 7, per spec §10):** the three-column
workspace in `App.jsx` (code / canvas / inspector + mobile tab bar), `Inspector.jsx`,
`VisualizationPane.jsx` and its five canvases, `CallTree.jsx`, `ControlFlowChart.jsx`,
`TimelinePane.jsx`, `CombinedView.jsx`, `StepComparison.jsx`/`compare.js`,
`RunStoryCard.jsx`. `SceneView.jsx` + the adapter scene model
(`src/tracer/scene.js`, `genericAdapter`, `sortingAdapter`, `searchingAdapter`,
`recursionAdapter`, `statementStage`) are a **card layout**, not a positioned stage: the
new `src/animation/scene.js` is a different artifact. Reuse their *evidence and
recognition* work (sort/search/recursion detection, honest fallbacks) in Phase 5, not
their renderer.

**Fixtures for the programs the corpus does not have.** The corpus has no linked list,
tree, hash table, bubble/selection/insertion sort or binary search program.
`src/tracer/__fixtures__/recognition.json.gz` already holds 54 **real** traces with
sources — `bubble-sort` (43 events), `selection-sort` (54), `insertion-sort` (51),
`binary-search` (24), `recursive-binary-search` (31), `bubble-duplicates` (30), plus
merge sort and recursion variants. Phase 1's golden action tests can use these without
changing the corpus or the golden file. Linked list / tree / hash table fixtures do not
exist yet and must be added when Phase 5 needs them (that is a corpus + golden + README
change, to be reviewed then).

---

## 8. Baseline

All four gates, run on a clean tree at `f3e79fb` (`set -o pipefail`, real output):

```
npm run test:tracer
  Ran 111 tests in 1.435s — OK                                 exit 0

npm run test:js
  ℹ tests 526  ℹ pass 526  ℹ fail 0  ℹ cancelled 0            exit 0
  ℹ skipped 0  ℹ todo 0

npm run lint
  Found 0 warnings and 0 errors.                               exit 0
  Finished in 215ms on 142 files with 104 rules.

npm run build
  ✓ 108 modules transformed.                                   exit 0
  dist/assets/index-CnPJb737.js  661.97 kB │ gzip: 189.85 kB
  ✓ built in 2.52s
  (!) Some chunks are larger than 500 kB after minification.
```

**No pre-existing failures.** One pre-existing warning: the 662 KB JS chunk exceeds Vite's
500 KB advisory. It is not a gate failure; the animation work should not make it worse by
adding a library (and adding one is a stop-and-ask anyway).

Not run (opt-in, need a real Pyodide download): `npm run test:pyodide`,
`npm run check:explain`. Nothing in Phase 0 changes the worker, `tracer.py` or the
explanation layer, so they are unchanged by this audit.

---

## 9. Smallest sequence of changes that satisfies the spec

The phase plan in `docs/animation-phase-prompts.md` is already the minimum. Expressed as
modules, with the audit's findings folded in:

1. **Phase 1 — diff engine, no UI.** New `src/animation/` with
   `actions.js` (the §6 vocabulary and stable ids), `evaluate.js` (safe index-expression
   evaluator: names, ints, `+ - * //`, parentheses; no calls/attributes; never throws),
   `lineShape.js` (parse the executed statement: tuple target, subscripts, `insert`/`pop`
   calls, `del`, augmented assign; returns "unknown" honestly), `diff.js`
   (`diffSteps(prev, next, context) → actions`), and `docs/animation.md`. **No tracer
   change.** Test against the corpus fixture plus the recognition fixture; add property
   tests (apply ⇒ B, reverse ⇒ A) over every program; add the duplicate-value cases from
   §3 as golden "must fall back to highlight" tests. Add `src/animation` to the
   no-hardcoding scan.
2. **Phase 2 — two-panel page + generic stage.** New page next to the old one (flag or
   temporary route), `src/animation/scene.js` (snapshot → positioned elements, stable keys
   from object ids and slot names), a renderer for variable chips, lists, dicts, frames and
   the console, and a compact control strip. Reuse `client.js`, `runGate.js`, the session
   reducer, `traceIndex.js`, `values.js`, `output.js`. Fades and highlights only.
3. **Phase 3 — list motion.** Swap, shift, insert, delete, markers, compare, bars, using
   Phase 1's actions; interruptible animations, reduced-motion fallback, forward/backward/
   jump identity tests.
4. **Phase 4 — frames, recursion, objects.** Call slide-in, return-to-call-site (with the
   §6 limitation made visible, never invented), object cards with shared ids and arrows,
   deep-recursion compaction.
5. **Phase 5 — skins.** Bars, linked list, tree, chaining hash buckets, each with an
   evidence chip and a switch-off; new fixtures for linked list / tree / hash table.
6. **Phase 6 — hardening.** Limits surfaced as truncated/failed with the reason, fullscreen,
   splitter persistence, mobile stacking, keyboard, both themes, stale-session handling,
   `aria-live` caption.
7. **Phase 7 — validation and cleanup.** Run the §14 checklist end to end, compare old and
   new, then delete the retired visualizer code (it stays in git history).

Deliberately **not** in the smallest path: any tracer change, any trace-format bump, any
dependency, any delta/checkpoint storage, any work on the five existing canvases.

---

## 10. Open questions for the owner

Asked because the spec is silent or the repo has drifted; none of them blocks Phase 0.

1. **What does "Step 4 / 12" count?** The cursor indexes every event (`trace.length`),
   while `result.steps` counts `line` events only, and `print(x)` is two `output` events.
   The existing bar shows `index + 1 / trace.length`. Recommendation: keep one cursor over
   all events (every selector already takes it) and label it "Step i / N" of the trace.
2. **The spec says "the 45-program corpus" (§10); the repo now has 60**, and
   `README.md`/`corpus.py` say 60. Confirm the intent is "the whole corpus" and that the
   number in the spec is simply stale (I will not edit the spec without you).
3. **Return values with no landing slot.** For `print(f(x))` the recorded value has no
   caller variable. Do you want the value animated to the console when the call is an
   argument of `print` (evidence: the `output` events that follow), or only shown on the
   frame that returns? I will not invent a destination.
4. **Sets.** Because the tracer sorts sets, index-level motion is meaningless for them. Is
   "a bag of cells that appear/disappear, never moves" acceptable for v1? (This is the only
   truthful option without an insertion-order record.)
