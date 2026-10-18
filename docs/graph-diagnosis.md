# Execution-graph diagnosis: why it does not teach, and what to rebuild

Written before the graph was changed. Every number below is measured from the
real trace (`src/tracer/__fixtures__/traces.json.gz`), the real builder
(`src/flowchart/executionGraph.js`) and the real component, not estimated.

## Measurements

`node ..\graph-stats.mjs` (pane size taken from the real 1366x768 layout):

| program | events | nodes | edges | frames | rows | canvas | height/width | boxes on screen at fit |
|---|---|---|---|---|---|---|---|---|
| `fact(5)` | 18 | 8 | 10 | 4 | 8 | 195 x 358 | 1.84 | 8 of 8 |
| `merge sort` | 184 | 112 | 138 | 20 | 55 | 2205 x 2938 | 1.33 | **12 of 112** |

Rendered live at 1366x768 (graph pane is 592 x 653):

| | `fact(5)` | `merge sort` |
|---|---|---|
| drawn size **in the pane** | 180 x 522 | 1861 x 2484 |
| share of the pane width used | **30%** | 314% |
| node boxes visible at once | 12 | 12 |
| smallest box on screen | 84 px | 71 px |
| longest label | 1 line | 1 line |
| variables shown inside a node | **none** | **none** |
| node height | 27 px | 27 px |

## Root causes

### R1. A node is a code line and nothing else

`measureNode` fits `node.text` into at most 2 lines of 22 characters at 13px
(`MAX_CHARS = 22`, `MAX_LINES = 2`, `NODE.LINE_H = 15`), giving boxes 27-42px
tall. Whatever else the graph might want to say — what the line does, what the
values are, what changed, where control goes next — **has nowhere to go**. The
"graph does not explain the computation" and "variable names and values are
missing" complaints are not styling problems; the node model cannot carry the
information. Fixing this means giving a node a body with several labelled
fields, which also means a node must be allowed to be ~3-5x taller.

### R2. Ranked layout turns recursion depth into vertical repetition

`layoutExecutionGraph` hands the graph to dagre with `rankdir: "TB"`. Every
`call` edge becomes a rank, so a recursion chain of depth *d* is *d* stacked
ranks, each containing the same two boxes:

```
<module>  def fact(n):
<module>  print(fact(5))
fact      if n <= 1:          <- frame 1
fact      return n * fact(n-1)
fact      if n <= 1:          <- frame 2, same text
fact      return n * fact(n-1)
...                           5 times for fact(5), 500 times for fact(500)
```

`fact(5)` is a **195px wide, 358px tall ribbon in a 592px pane**: 70% of the
pane width is wasted while the interesting dimension overflows. This is exactly
the reported "long, repetitive, vertically stacked graph".

### R3. Nothing in the drawing says which call a box belongs to

Node ids are already per call (`f<frame_id>l<line>`), but the renderer draws no
frame boundary, no header, and no call signature. `fact(4)` and `fact(3)` are
interchangeable boxes whose only difference is position, so a learner cannot
see the call stack grow, cannot tell which instance is waiting for which, and
cannot read a return value. "Recursive calls create a long repetitive graph" is
this: repetition without identity.

### R4. The fit scale is pinned below legibility on any real program

`computeFit` clamps to `MIN_LEGIBLE_SCALE = 0.85`. For the merge sort the honest
fit is `min(592/2205, 653/2938) = 0.22`, so the clamp forces 0.85: the drawing
is 1874 x 2497 in a 592 x 653 pane and **12 of 112 boxes are visible**. Constant
zooming and panning is arithmetic, not user error. Nothing in the UI offers a
"reset to a readable view that follows the run" either — `−`, `+`, `Fit`,
`100%`, `Expand` exist, but no reset.

### R5. The legend documents colours, not the model

`.exec-legend` lists `you are here / next / Yes / No / call / return / loop /
error / xN`. It never says what a box is, that a box is one line *in one call*,
what the vertical axis is, or how to read a call/return pair. Colour names are
not teaching.

### R6. Values and changes exist only in the side panel

`getStepView` already computes before/after per step (`changes`, `hint`,
`values`), but the graph renders none of it. The node cannot show `n = 4`, and
nothing on the graph says `n` is about to become `3`. The information is in the
app; it is not where the learner is looking.

## What the tracer already gives us (no trace-format change needed)

Checked in `tracer-poc/tracer.py`; the format already supports everything the
redesign needs:

- Per event: `event` (`call` / `line` / `return` / `exception` / `unwind` /
  `output` / `input` / `error` / `step_limit` / `timeout` / `output_limit`),
  `step`, `line`, `function`, `frame_id`, `frames` (full stack with each frame's
  `variables`, `call_line`, `line`), and `heap`.
- Values: `none`, `bool`, `int` (with `big` + `repr`), `float` (with `repr` for
  `inf`/`nan`), `str` (with `truncated` when cut), `function`, `class`,
  `module`, `other` (with `class` + `repr`), `ref`.
- Heap objects: `list`, `tuple`, `set` (also frozenset, with `class`), `dict`
  (with `class` for subclasses), `object` (with `class` + `attrs`), each with
  `more` when items were cut.
- Limits: `max_steps=1500`, `max_seconds=5.0`, output cap.

So before/after, scope (frame) and changes are all derivable from the trace at
any step, in both directions. Two honesty gaps in the UI layer, not the tracer:

- `describeObject`/`showValue` silently drop `more`, so a 100-item list prints
  as if it were 30 items. It must say "showing first 30 items".
- `showValue` falls back to the raw id (`o1`) when a referenced object is not in
  the step's heap, which leaks internal names into the UI.

## Rebuild plan

1. **Node body (`measureNode` + renderer).** A node becomes: a header (line
   number + how often it ran), the code, a one-line plain-English *action*, up
   to three *values* relevant to that step, and *change* chips (`NEW`,
   `5 -> 10`). Height grows to fit its content; nothing is clipped.
2. **Deterministic time-ordered layout.** Drop dagre. `y` = order in which the
   node first ran (time flows down); `x` = a small indent per call depth, so a
   recursive chain becomes a staircase instead of a tower. Every call's nodes
   sit inside a labelled **call panel** (`fact(4)` · called from line 4), which
   gives each instance an identity and makes the stack visible.
3. **Collapse finished calls.** Frames that have already returned and are not
   on the current call chain collapse to one summary row, expandable by click,
   so a 112-node run stays navigable.
4. **A readable default view.** Open at 100% centred on the current step and
   follow it, instead of clamping a fit scale that cannot work. `Fit`,
   `Reset view` and a zoom readout stay.
5. **Beginner / Advanced / Textbook.** The existing "Simple view" control
   becomes this switch: Beginner = current call chain expanded, values and
   plain English, 100% view; Advanced = the whole timeline expanded, edge
   reasons, step numbers, run counts; Textbook = the existing flowchart, still
   reachable (never removed).
6. **Legend as a model.** Explain what a box is, what the vertical axis is, and
   how to read a call/return pair — with the colours as a footnote.
7. **Inspector** in five labelled sections (current step, variables, execution
   flow, calls and returns, output) fed by the same step view.
8. **Honesty + safety.** Say when a value is cut short, never print a raw id,
   and add an error boundary so a drawing bug cannot blank the app.
