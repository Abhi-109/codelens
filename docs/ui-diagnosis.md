# UI diagnosis: making every panel teach, and keeping the panels in sync

Written before any code changed in this task. Everything below is checked
against the real code (`src/App.jsx`, `src/tracer/explain.js`) and against
real traces produced by `tracer-poc/tracer.py`. The traces used are in the
"Evidence" section.

> **Partly superseded.** The graph panel this diagnosis measured
> (`src/flowchart/ExecutionGraph.jsx`) has been retired and replaced by the
> call tree, control flow and combined canvases (see
> [roadmap.md](roadmap.md)); its "Graph panel" findings below are kept as
> history. The convention itself — one current step driving every panel —
> still holds, and now drives those three canvases as well.

## The one convention

Every panel reads the same step through one meaning of "current step":

> **The highlighted line is the line about to run.**
> The variables panel shows the state **before** that line runs, and always
> says what the line is about to do (`After this line: mid will be 3`).
> The explanation card has two labelled parts — **Just happened** (the
> previous step, with before → after) and **About to happen** (the
> highlighted line and its predicted result, read from the next step in the
> trace) — plus **Why this line runs now** (the jump that brought us here).

This is exactly what `docs/trace-format.md` §5 means by "one-step lag": a
`line` event fires *before* its line runs, so its `variables` show the state
before the line takes effect. The trace format is not changed; the UI is
changed to honour it instead of contradicting it.

The convention is enforced in `src/tracer/stepView.js` (pure) and tested in
`src/tracer/stepView.test.mjs`: for every step of real traces, the highlighted
line, the variables, the stack, the graph node and the explanation all come
from the same index.

## Panel by panel

### 1. Code panel (`src/App.jsx`, "Your Python code")

- **What it is for:** show the program, and point at the line that is running
  now so the graph and the explanation have an anchor.
- **Why a beginner is confused today:**
  - Long lines and trailing comments are clipped at the right edge:
    `.code-line { white-space: pre; min-width: max-content }` inside
    `.code-view { overflow: auto }` (App.css 297–321) means a wide line only
    becomes readable by scrolling sideways, with no cue that there is more.
  - Nothing on the highlighted line says what the line will produce. The green
    bar (`.code-line.current`) says "here", not "here, and this will happen".
  - Nothing marks the line that *just* ran, so "where did we come from" is
    invisible.
  - Hovering a variable name in the code does nothing, even though the trace
    already knows that name's value at this step.
- **User finding 7 is confirmed:** clipping is real (`white-space: pre` plus
  `overflow: auto`), and there is no per-line result hint.

### 2. Graph panel (`src/flowchart/ExecutionGraph.jsx`)

- **What it is for:** show the *route* the program took — which lines ran and
  why control moved between them — so recursion and loops stop being magic.
- **Why a beginner is confused today:**
  - **Edges are unlabelled.** `GraphEdge` draws a coloured path and, when
    `count > 1`, a bare number (`exec-edge-count`). The only clue is colour,
    and the legend is colour-only too (`.exec-legend`: "moves on / call /
    return / loop / error"). A beginner cannot tell "next line" from "loop
    back into this block".
  - **Nothing says where we came from or where we go next.** The token shows
    the current node, but there is no "you are here", no "came from", and no
    "next".
  - **A decision node carries no verdict.** For `if len(arr) <= 1:` the graph
    shows the box; it never shows that the answer was `False` because
    `len(arr)` was `7`. That reason only exists in the explanation text.
  - **Clicking a node does nothing.** `NodeBox` handles hover/focus only, so
    the natural gesture — "take me to where this line ran" — is dead.
  - **The header names the function, not the call.** `flow-of` shows
    `merge_sort()`; in recursion there are three live `merge_sort` frames and
    no way to tell which one the token is in or what `arr` is.
- **User findings 4 and 5 are confirmed.**

### 3. Explanation card (`src/tracer/explain.js` → `explainStep`)

- **What it is for:** the main teaching element: turn the current step into one
  plain sentence a complete beginner can follow.
- **Why a beginner is confused today:**
  - It explains the **result** of the highlighted line ("mid is created with
    the value 3"), while the variables panel shows the state **before** the
    line, so `mid` is missing. The two panels look like they disagree.
  - It has no "what just happened" part, so the previous line's effect vanishes
    the moment you step on.
  - It has no "why did we come here" part, so `if len(arr) <= 1: False` →
    jumping to `line 4` looks arbitrary.
  - Concept cards appear once, but cannot be dismissed, and the vocabulary is
    missing `recursion` and `list index` even though both are taught by
    example.
- **User findings 1 and 3 are confirmed.** Evidence below.

### 4. Variables panel (`src/App.jsx`, "Variables")

- **What it is for:** show what the program remembers right now, and what just
  changed.
- **Why a beginner is confused today:**
  - **`arr` shows as `o1`.** `VariableBoxes` renders a `ref` as
    `<span className="ref-pointer">→ {value.id}</span>` (App.jsx 110–114), so
    the most common value in the examples — a list — is hidden behind an
    internal id. `showValue()` in `src/tracer/values.js` already renders the
    real list; the panel just does not use it.
  - **No before/after and no CHANGED/NEW mark.** `changed` is a `Set` used only
    to add a `.changed` class that plays a flash animation. The old value and
    the line responsible are never shown.
  - **"Two names for one list" is drawn but never explained.** `HeapObjects`
    prints `arr, data → o1`; nothing says those are two names for one list.
  - **The `<h3>Variables</h3>` heading does not say what the panel is for.**
- **User findings 2, 3 and 6 are confirmed.**

### 5. Objects sub-panel (`src/App.jsx`, "Objects")

- **What it is for:** show container contents as slots so a learner can see a
  list's numbered boxes.
- **Why a beginner is confused today:** it is a *second* place that repeats the
  variables, headed by an id (`→ o1`), and its heading says even less than
  "Variables". It should be folded into the variables panel as the readable
  value of a list/dict, not a separate jargon box.

### 6. Function calls panel (`src/App.jsx`, "Call stack")

- **What it is for:** show which function is running now and how we got there.
- **Why a beginner is confused today:**
  - The words "Call stack" and "<module>()" are jargon that is never explained.
  - Frames show `merge_sort()` and `line 7` but **no arguments**, so three
    recursion frames look identical.
  - Frames are not selectable, so you cannot ask "what were *this* call's own
    variables?".
  - A finished call's return value is only in the explanation, never here.
- **User finding 5 is confirmed.**

### 7. Output panel

- **What it is for:** show what the program printed.
- **Why a beginner is confused today:** it is fine, but it is the only panel
  that prints text and `print` explanations are vague ("This line shows
  something on the screen") without naming the value.

### 8. Structure of the right-hand column

- **What it is for:** a stack of small boxes next to the graph.
- **Why a beginner is confused today:** the order is Variables → Call stack →
  Output, with **no "Changes" list** and no one-line purpose under any heading.
  The user has to guess what each box is for (user finding 6). There is no
  "?" to open a short beginner explanation.

## The panels disagree: evidence

Real trace from `tracer-poc/tracer.py` for the merge-sort program shipped as an
example in this task (`merge_sort` + `merge`, 142 line events). At step index 7:

```
[  6] line merge_sort line=2  'if len(arr) <= 1:'
        frame#2 merge_sort@2 {'arr': ref o1}
[  7] line merge_sort line=4  'mid = len(arr) // 2'
        frame#2 merge_sort@4 {'arr': ref o1}          <-- no `mid` yet
[  8] line merge_sort line=5  'left = merge_sort(arr[:mid])'
        frame#2 merge_sort@5 {'arr': ref o1, 'mid': 3} <-- mid appears only here
```

- Highlighted line at index 7: `mid = len(arr) // 2`.
- `explainStep(trace, 7, source)` reads the **next** state and says
  `mid is created with the value 3.`
- `VariableBoxes` renders the **current** state, where `mid` does not exist.
- The value of `arr` is shown as `→ o1`, not as `[38, 27, 43, 3, 9, 82, 10]`.

That is user finding 1 and finding 2 in one screenshot, reproduced exactly.

## What each panel is for (the target)

| Panel | Plain name | Purpose (one line) | Main teach signal |
|---|---|---|---|
| Explanation | **What's happening** | Explain the last step and the next one in words | Just happened / About to happen / Why now |
| Variables | **Variables** | What the program remembers right now | real values, NEW/CHANGED, before→after |
| (new) | **Changes** | Every value change, in order | `step 12: x 5 → 10 (line 6)`, click to jump |
| Stack | **Function calls** | Where the program is right now, and how it got here | arguments, "called from line N", return value |
| Output | **Output** | What the program printed | the exact printed text |
| Graph | **Execution graph** | The route the program took | labelled reasons, you-are-here / came from / next, click to jump |

## Plan

1. `docs/ui-diagnosis.md` (this file) — commit on its own.
2. `src/tracer/stepView.js` + tests — the single source of truth and the
   convention, with `getStepView(trace, i, source)` returning the highlighted
   line, variables before/after, changes, stack with arguments, the graph node,
   and the two-part explanation, all for the same `i`.
3. `explain.js` wording: the two labelled parts plus "Why this line runs now",
   and concept ids for recursion and list indexing.
4. The panels, one at a time: explanation card, variables, changes, function
   calls, code panel, graph reasons, headings/help.
5. Acceptance checks: `x = 5; x = 10`; a `for` loop total; `fact(3)`; the
   merge-sort trace at all steps; click-to-sync; a syntax error and a runtime
   error; 1366×768 and 375px.
