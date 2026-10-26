# CodeLens Roadmap

The order below is the working plan. Tiers are worked one at a time, and the
project is left in a runnable, demoable state after each task.

## Tier 1: Housekeeping

- [x] Remove the unused `@dagrejs/dagre` dependency (the graph has been
      hand-rolled since the rebuild)
- [x] **Design tokens** (`src/styles/tokens.css`): colour, spacing, radius and
      both themes in one file; `App.css` no longer hardcodes a single colour
- [x] **Dark/light theme** with a toggle in the nav, persisted in
      `localStorage` (`codelens-theme`), set before first paint so there is no
      flash; falls back to the OS preference
- [x] **Application shell**: shared nav with breadcrumbs, footer, and
      loading / empty / error / 404 states (`src/shell/`)
- [x] **Routing**: hand-rolled History-API router (no new dependency); all ten
      routes resolve and survive refresh; `/visualizer/python` is the existing
      playground, unchanged
- [x] Landing page, language selection page (Python available, others marked
      Coming Soon and unclickable), about page
- [x] **Homepage preview driven by real trace data**: the hero replays a
      recorded run of a built-in example through the visualizer's own
      `getStepView`, looping through the steps with a play/pause player, and
      pausing when the tab is hidden, when it scrolls out of view, and for
      anyone who asked for reduced motion. Deliberately *not* Pyodide: the
      quality bar says to lazy-load the engine only on the visualizer pages,
      so the hero never blocks first paint (`src/pages/preview.js`,
      `npm run fixtures:preview` re-records it)
- [x] Learn lessons and docs pages: seven lessons across five sections, five
      documentation pages, both generated from tested data
      (`src/pages/lessons.js`, `src/pages/docsContent.js`); a lesson's example
      link opens that program in the visualizer without running it
- [x] Data-structure lab: arrays (with capacity growth), linked lists, stacks,
      queues, binary search trees and a fixed graph, on an authored operation
      model with Back/Next/Reset/Play and per-step snapshots
      (`src/datastructures/`)

- [x] Replace the Vite template `README.md` with a real one
- [x] Add `.gitattributes` and normalize line endings to LF
- [x] Add `docs/roadmap.md` (this file)
- [x] Add a GitHub Actions workflow that runs tests, lint, and build on every push and PR

## Product quality (Phase 5)

Release-readiness pass over the finished product. Details and evidence are in
[phase5-checklist.md](phase5-checklist.md).

- [x] Real-browser audit of every route at 1440, 720 and 390 px, both themes,
      and reduced motion
- [x] Successful runs read "Completed" instead of the tracer's `completed`
- [x] Skip link to the main region, with a visible focus state
- [x] Lazy-load the Python visualizer only: the entry bundle drops from
      774 kB to 342 kB and Vite's chunk advisory is gone
- [x] Call strip capped at the 24 most recent frames, with a count of the rest
- [x] Stress checks: 200-element lists, cyclic lists, deep and runaway
      recursion, caught and uncaught exceptions
- [x] Browser regressions for each of the above

## Values, results and output (Phase 6)

The motion stage stopped drawing only heap collections. Details and evidence are
in [animation-progress.md](animation-progress.md).

- [x] Scalar-only programs draw compact value tiles (name, value, type) instead
      of a "nothing to draw" message
- [x] The most recent named function return is shown as a result tile; the
      module's implicit `None` reads as completion, not a returned value
- [x] Printed output is its own bounded area, reconstructed from the recorded
      output events up to the cursor
- [x] The final step reports Completed, a limit, or the recorded runtime/syntax
      error instead of treating every ending as success
- [x] Seeking backwards removes future output; step 0 clears output, return and
      status; a new run replaces all three
- [x] Browser regressions for `greet()` (return and printed output), scalar-only
      runs, backward seeking, reset, both themes and a 390 px phone

## Flowchart renderer (stages A3–A5) — superseded

> **Retired.** This slice drew the format-2 chart with **dagre**, and was
> removed when the visualization was rebuilt (see
> [Visualization rebuild](#visualization-rebuild-call-tree--control-flow--combined)
> below). `@dagrejs/dagre` left the dependency tree in `fe41185`; the layout is
> now hand-rolled and deterministic (`src/flowchart/layout.js`). The format
> contract it documented is unchanged and still accurate.

A vertical slice that replaced the card list with a real textbook flowchart,
drawn as SVG and laid out with dagre. The detailed spec is
[stage-a3-flowchart-renderer.md](stage-a3-flowchart-renderer.md); the graph
builder and its node/edge contract are in
[flowchart-format.md](flowchart-format.md).

### Stage A3 — SVG renderer

- [x] Install `@dagrejs/dagre` for the layout pass *(since removed — see above)*
- [x] Load the format-2 graph through the worker and client (`buildFlowchartGraph`)
- [x] `src/flowchart/mapTrace.js` — chart selection and line→node lookup, with tests
- [x] SVG shape primitives for the eight node kinds
- [x] Dagre layout: nodes, edges, arrowheads, Yes/No labels, back edges
- [x] Draw the diagram in the UI, old card list behind a "Simple view" toggle
- [x] Fit, zoom (wheel and buttons), pan, follow the current node, expand to full screen
- [ ] Generate on a ~400 ms debounce as the learner types, before Run
- [ ] "Show code in boxes" toggle

### Stage A4 — Execution overlay

- [x] Highlight the node for the current step, with a short trail
- [x] `True` / `False` chips on the branch that actually ran, showing the real values
- [x] "ran N times" badges on the nodes and edges the run went round again
- [x] Click a node to jump to the step that ran it (a picker appears if it ran more than once)

### Stage A5 — Function tabs and export

- [ ] One tab per function, following the call stack
- [ ] Export the chart as SVG or PNG

## Visualization rebuild (Call tree / Control flow / Combined)

The legacy execution-graph card timeline (`ExecutionGraph.jsx`, a box-per-line
node model) is **retired**, not replaced in place: its renderer is deleted, its
pure mapping utilities (`executionGraph.js`, `layoutGraph.js`, `nodeBody.js`,
`reasons.js`) are kept because the step view and the corpus tests still depend
on them. In its place the Visualize pane offers a strip of canvases, all of
them windows onto **one** execution — one step, one timer, one speed, shared by
every mode, inspector tab and learning mode.

### Stage 1 — Call tree

- [x] `buildCallTree` / `callStatus` (`src/flowchart/callTree.js`) — parent and
      child from real frame events; status future → running → done/failed
- [x] Deterministic top-down layout (`src/flowchart/callTreeLayout.js`): one box
      per call, never a shared node, stable geometry that ignores the step
- [x] Return values read from the trace's own return events; a failed call shows
      the exception instead, inherited from the deepest raising child
- [x] Click a call to jump to the step it started at; the current call is
      highlighted and kept centred; fold a subtree away and back
- [x] Shared canvas shell (`src/visualizer/Canvas.jsx`): pan, zoom, fit, follow,
      expand, toolbar, legend, empty states
- [x] 28 unit tests (`callTree.test.mjs`, `callTreeLayout.test.mjs`)

### Stage 2 — Control flow graph

- [x] Format-2 chart lookup (`src/flowchart/mapTrace.js`) and the trace→node
      layer (`src/flowchart/controlFlow.js`), both pure
- [x] Hand-rolled deterministic layered layout (`src/flowchart/layout.js`) — ranks,
      barycentre sweeps, private channels for loop-back arrows; no dependency
- [x] SVG shapes for all eight node kinds (`src/flowchart/shapes.jsx`)
- [x] Current node, executed path, and the real Yes/No the run took —
      invocation by invocation, read only from the trace
- [x] Boxes the run never reached are drawn subdued and cannot be clicked; an
      exception highlights the raising line and invents no edge
- [x] One tab per function the program defines, with the ones this run entered
      marked, plus "Follow run", "Show code" and the v1 card list behind
      **Simple view**
- [x] 44 unit tests (`mapTrace.test.mjs`, `layout.test.mjs`, `controlFlow.test.mjs`)

### Stage 3 — Combined view

- [x] The call tree beside a compact call stack and the variables of the current
      step, reusing the inspector components and the one shared step
- [x] A Calls / Variables subview strip (`selectCombinedSubview`) that changes
      only what is drawn: clicking a call, following a name, switching subview,
      or leaving and re-entering the canvas all leave the step exactly where it
      was
- [x] Stacks to one column below 1024px rather than squeezing both halves

### Stage 4 — Animation and playback

- [x] State changes animate as colour and opacity only: `.ct-node`, `.ct-box`,
      `.ct-value`, `.ct-link-line`, `.cfg-node`, `.cfg-shape`, `.cfg-edge-line`.
      Geometry is never transitioned, so a step cannot reflow the drawing —
      verified by comparing the layout attributes across steps on both canvases
- [x] A call's return value is mounted from the first step but held at opacity 0
      until its own `return` event, then fades in (tested: status `future` /
      `running` / `waiting` → opacity 0; `done` → fade to 1)
- [x] Interrupted transitions supersede — CSS retargets; there is no
      `transitionend` listener, no animation queue and no timer between the step
      and the DOM, so a manual step lands in ~20 ms and 20 rapid clicks produce
      exactly 20 steps
- [x] `prefers-reduced-motion: reduce` drops every canvas transition to `none`
      (measured in-browser: `transition-property: none`)
- [x] Playback baseline unchanged: measured 1225–1231 ms at 1× against the
      `800 ÷ 0.65 = 1230.77 ms` baseline, 613–617 ms at 2×, speed persisted to
      `codelens-speed`, and play stops by itself at the last step

### Stage 5 — Polish and QA

- [x] Dark and light theme pass on labels, controls and edges; contrast fixed
      through design tokens
- [x] Keyboard, ARIA and focus check across all three canvases
- [x] Responsive check at desktop, tablet and phone
- [x] Empty / loading / input-required / success / exception states checked
      against real examples

### Stage 6 — Phase C: large runs, values and keyboard navigation

- [x] A call tree over 200 frames opens with a breadth-first visible set; the
      caption gives the real shown/total counts and **Show all calls** draws the
      rest. The cap respects manual folds, and **Show fewer** returns to 200.
- [x] A run with no function calls draws the module frame, explains why there is
      no tree, and offers **Show the flowchart**.
- [x] With **Values** on, control-flow boxes show a real `×N` run count. The
      current box also shows the evaluated condition (with its real operands) or
      the old → new value its line is about to produce; a `for` header shows its
      loop variable changing. A fixed bottom row is reserved in the layout, so
      values never move a box while stepping.
- [x] The shared canvas takes keyboard focus: Arrow keys pan, `+`/`-` zoom, `0`
      resets and `F` fits, all with `stopPropagation` so the global step shortcuts
      do not also fire. Tabbing to a graph node centres it without changing the
      step.
- [x] Function tabs use a roving tabindex with Arrow/Home/End, move focus with the
      selection, and leave the execution step untouched.
- [x] 8 regression tests cover the cap, counts, conditions, line values, loop
      headers and reserved value geometry. The shared viewport maths (`panBy`,
      `centreOn`, `clampPan`) stays covered by its existing tests.
- [x] Desktop, tablet and phone checked in dark and light themes; focus, pan and
      tab navigation exercised in the browser with no console errors.

## Teaching UI pass

The panels stopped guessing and started reading from one tested step view
(`src/tracer/stepView.js`), so the highlighted line, graph node, variables,
changes, stack and explanation can never contradict each other. The convention is
written down in [ui-diagnosis.md](ui-diagnosis.md).

- [x] One `currentStep` driving every panel; every click target (graph node, code
      line, change entry, call) sets it
- [x] Explanation card in three labelled parts: Just happened / About to happen /
      Why this line runs now
- [x] Dismissible concept cards naming the idea the first time it appears
- [x] Variables panel: plain heading and hint, real values, a two-names-for-one-list
      note, NEW/CHANGED badges, Before/After toggle, Boxes/Table layouts, the
      frame's scope, and a clickable history chart for numeric names (a step:value
      list for everything else)
- [x] Changes panel: every change, newest first, each jumpable (folded into the
      Variables section behind a disclosure, nothing removed)
- [x] Function calls panel: newest first on a connector, running / waiting /
      returning states, arguments, called-from line, each call's own variables,
      the active source line, and return values
- [x] Memory panel: stack and heap in one picture, real reference arrows measured
      from the rendered boxes, two arrows into one shared object, nested
      references, and stable `list #1` labels only in Advanced
- [x] Graph: every edge labelled with why it was taken, decision chips with real
      values, run badges, current/came-from/next tags, click-to-jump
- [x] Code panel: wrapped long lines, `▶` on the next line, result hints inline,
      hover a name to see its value
- [x] Side panels renamed and given one-line descriptions and a `?` help button
- [x] "Why is control here?" answered for every kind of step, including printing,
      asking for input, raising, unwinding and being stopped by a limit

## Execution graph rebuild

The old graph was diagnosed in [graph-diagnosis.md](graph-diagnosis.md): a
box-per-line node model, a dagre tower for recursion, no call boundary, and a
zoom clamp that hid the current node. The rebuild fixed the root causes:

- [x] One node per executed line, carrying depth, plain-English action, first and
      last step, and how often the line ran; every call gets its own frame label
- [x] Automatic layout with no layout library: rows in run order, 28px indent per
      call depth, edges through right-hand lanes, one labelled wire at a time
- [x] Each card shows code, action, the values that matter, what changed, and
      where control goes next — in fixed slots, so cards never shift while stepping
- [x] Viewport centres the *middle* of the current card, centres the drawing when
      it fits, and keeps the current card on screen on a phone (375×667)
- [x] Finished calls fold away on demand (merge sort: 106 cards → 36 + 15 folds)
- [x] One control switches Beginner / Advanced / Textbook; Textbook is the old
      flowchart, still reachable
- [x] Honest values everywhere: overflow counts, truncated strings, "(not shown at
      this step)" instead of raw ids, `new-slot` wording for appended list slots
- [x] Class bodies labelled `Dog (class body)` rather than as a call

## Supported-Python corpus

- [x] `tracer-poc/corpus.py`: 60 programs across 33 categories, each with the
      claim the tracer must honour about it
- [x] `dump_corpus.py` records exact stdout and counts (`corpus-golden.json`) and
      vendors the traces for the JS tests (`src/tracer/__fixtures__/corpus.json.gz`)
- [x] `test_corpus.py` checks the claims and the trace-format promises per event
- [x] `src/tracer/corpus.test.mjs` walks every step of every program through the
      UI's own functions (explanations, values, graph nodes, back-stepping)
- [x] `docs/supported-python.md` kept in sync by the same tests
- [x] `no-example-hardcoding.test.mjs` keeps example-specific words out of the
      teaching layer's strings

## Tier 2: Core experience

The biggest win for a beginner. No tracer or trace-format changes.

- [ ] Split `src/App.jsx` into components and hooks (`usePlayer`, `useTraceRunner`)
- [ ] CodeMirror 6 editor: syntax highlighting, line numbers, current-line highlight,
      tab indentation, read-only while stepping
- [ ] Examples gallery grouped by level, each with a goal and a "what to notice" hint
- [x] `input()` support via a "Values for input()" box (one value per line; a
      program that asks for more than were given still ends in the real EOFError)
- [ ] Friendly errors: type, message, line, and a "did you mean" suggestion for `NameError`
- [x] Light/dark theme, remembered in `localStorage` (done in Tier 1 alongside
      the design tokens and app shell)
- [x] Responsive layout: four panes on a laptop, tabs (Code / Explain / Graph /
      Panels) below 1280px, verified down to 375×667 with the current card on screen
- [ ] Accessibility: focus rings, `aria-live` explanations, full keyboard use

## Tier 3: Better visuals

- [x] Reference arrows from variables to heap objects (SVG overlay that follows
      resizing; two names pointing at one object show two arrows, and the object
      cards also name every variable that points at them)
- [x] Call stack cards with "called from line N", argument values, and return values
- [ ] Recursion tree view
- [ ] Strings as character slots; nested lists as grids
- [ ] Jump controls: next loop round, end of function (jumping to a change is done
      from the Changes panel)

## Tier 4: Teaching layer

- [x] Concept cards, dismissible, shown once per run
- [x] Glossary drawer, and a first-use card wherever a new term appears
- [x] Level selector: one control switches Beginner / Advanced / Textbook, changing
      how much of the trace is exposed (trace internals only in Advanced)
- [ ] Move all explanation strings into `i18n/en.js` (prep for Kannada)
- [ ] Predict mode with a small score

## Tier 5: Sharing and polish

- [ ] Shareable link: code and inputs encoded in the URL hash
- [ ] Remember the last program in `localStorage`
- [ ] Performance: memoized per-step state, lazy Pyodide, smooth 1,500-step traces
- [x] Error boundary around the visual panels (each inspector section is isolated;
      a bad value loses that section, not the view)
- [ ] Optional privacy-friendly analytics (page views only)

## Later (v2)

Out of scope for version 1 — see [scope.md](scope.md) for the full list.

- DSA visuals: searching and sorting bars, stacks, queues, linked lists, trees,
  graphs, dynamic programming tables
- JavaScript support, then possibly Java or C++
- Kannada explanations
- Step counts and Big-O comparison

## Status

Tier 1 is done. The recorder, tracer, teaching layer and object diagrams work
end to end, and the visualization is now **four canvases over one trace**
(rebuild stages 1-5, above): a **call tree** by default, a **control flow
graph** laid out deterministically with no layout dependency, a **combined
view** that puts the tree beside the live stack or variables, and a virtualised
**timeline** with one row per recorded step. The old
execution-graph card timeline was retired along with its component; its pure
mapping utilities (`executionGraph.js`, `layoutGraph.js`, `nodeBody.js`,
`reasons.js`) are kept and still feed the step view. The textbook flowchart is
still reachable behind the same **Beginner / Advanced / Textbook** control.

The playground is one viewport-height screen — code | graph | inspector —
with draggable splitters, folding into Code / Graph / Inspector tabs below
1280px and staying usable at 375×667. The inspector is six tabs (Explain,
Variables, Stack, Memory, Output, History) behind one ARIA tablist with roving
tabindex, so changing section never moves the execution step, and playback
sits in a single bar under all three panes. The **Beginner / Advanced /
Textbook** control that used to sit above the graph now lives in the top bar,
so it reaches every pane; it changes explanation level and technical detail
for the whole workspace, never the trace itself. This workspace is Phase A of
an approved redesign; the richer Variables, Call Stack and Memory views are
Phase B, the large-run, value and keyboard-navigation pass is Phase C, and
Phase D adds the timeline, two-step comparison and the output/input/error pass.

Phase D's timeline is pure rows over the real trace (Step, Line, Event, Code,
Variables, Output), virtualised at a fixed height and filtered by **Only
changes** without ever hiding the current step. Comparison lives in the
Timeline pane, keeps its own two endpoints and open flag, and never moves
playback. It compares top-frame variables and scopes, nested objects by the
trace's stable object ids, call-stack depth/frames, output, and the input and
error events between the endpoints. Equal, reversed, empty, incomplete and
out-of-range endpoints are explicit; an object missing from the later snapshot
is labelled "Only baseline", not destroyed. The Output inspector now keeps
exact output text, folds later output separately, and lists real prompts,
submitted values and handled/uncaught errors with jump targets.

Phase E is the measured pass over that surface. The timeline keeps its line
column on phones, its rows match the virtual row height exactly, auto-scroll
follows a resized pane and ignores hidden panes, and the scrubber spans the
phone width above the transport row. Inspector and visualization tabs stay on
one line at 1440, 1366, 820 and 375 pixels, scrolling only when they cannot
fit. The help popover is anchored inside the inspector, has a 24 px target and
closes on Escape; focus rings and playback targets meet the same size rules.
Both themes, keyboard use, reduced motion, a 1,866-step trace and shared
playback were checked in the browser.

The execution session is now one reducer: the source/result/flow lifecycle,
cursor, playback, speed, selected call and chosen canvas all live together, and
every panel reads the step through the same selectors. Selecting a stack or
memory frame only changes whose variables are shown; it cannot move the cursor.
The call tree keeps its explicit "jump to where this call started" action.

A per-trace index now answers the repeated questions behind that view — nearest
state, source lines, frame lifetimes, top-frame lookups, output prefixes/segments
and exception outcomes. It is cached by the trace array in a WeakMap, so advance
or rewind reuses the same tables; a new run's array builds a new index. The
corpus-wide test compares every step against the old linear scans, and a 2,008-event
synthetic run measured 0.42 ms to build the index and 0.024 ms p95 per selector
lookup (JavaScript only; React render and browser paint are not included).

A read-only AST profile now describes the source without running it: functions,
parameters, decorators, calls and candidate call edges, direct and mutual
recursion candidates, loops with syntactic depth, conditions, comparisons,
statically identifiable list/dict/index/slice/attribute mutations, returns and
container operations. `tracer-poc/analyze.py` uses only the standard library and
returns a versioned, deterministic profile; syntax and analysis failures are
structured diagnostics. The Pyodide worker exposes it as a normal `analyze`
request, cached per source, and `src/tracer/programProfile.js` validates and
normalises the response without inventing missing data. The profile is metadata:
it does not execute source, supply runtime values, or recognise algorithms. The
visualizer will combine it with trace evidence in a later adaptive phase.

The evidence layer now does that combination without switching the UI:
`src/tracer/recognition.js` returns `generic`, `recursion`, `searching` or
`sorting` from the profile plus the real trace. Sorting needs element
comparisons and visible changes to the same list; searching needs indexed or
iterated container evidence, with binary-like bounds narrowing only when the
trace records it; recursion needs a static self-call or candidate cycle and
actually nested frames. Built-in sorting is never presented as traced
comparisons, already-sorted runs stay generic, and malformed or truncated input
returns generic with a reason. Rules and fixed confidence values are in
[recognition.md](recognition.md); the corpus-wide and positive/negative tests
are in `src/tracer/recognition.test.mjs`.

The adapter layer is now in place without changing the workspace.
`src/tracer/adapters.js` keeps an immutable registry and validates every scene
before returning it; an unknown, unavailable or malformed adapter falls back to
the always-available generic adapter with a reason. `src/tracer/scene.js`
defines a serializable scene of source lines, regions, frame/object/slot
references, changes, output, focus, accessibility text and evidence, then
re-derives displayed values from the StepView, heap and trace index. Malformed
scenes, invented changes, missing frames/objects, invalid indices and truncated
state fail validation instead of reaching a renderer. Capabilities are sets, so
a composite adapter can represent recursion and sorting structure together. The
generic adapter exposes the information the existing views already support.

The recursion adapter now builds an invocation tree from the trace. It uses the
profile's direct/mutual recursion families, requires an actual nested call edge
that closes a function cycle, and creates one node per real frame with captured
arguments, the parent edge the stack recorded, return values from return events,
exception and unwind outcomes, runtime base-case leaves, and the active path from the selected
step. Ordinary call chains and helper calls are not turned into recursion. Merge
sort builds a recursion scene even while recognition reports sorting. The tree
is capped breadth-first at 200 invocations, and omitted nodes are reported as a
partial scene with exact counts.

The searching adapter now turns a real list or tuple, target, index and recorded
return/membership result into linear and binary search scenes. It shows a binary
range and midpoint only where the trace records them, never invents an index for
item iteration, and marks duplicate-item, mixed-type and truncated data partial.
Linear first/middle/last/missing hits, empty and tuple containers, aliases,
while-loop control flow and recursive binary search are covered by real
fixtures. Break/flag/helper/enumerate shapes that have no in-loop return or
indexed comparison stay generic with an explicit reason.

The sorting adapter now builds list scenes for exchange, selection, insertion
and divide-and-conquer sorts. It follows the runtime list object rather than a
name, uses StepView changes for swaps/shifts/writes, and shows a proven prefix or
suffix without claiming the whole list is sorted. It covers sorted, reverse,
negative, duplicate, empty, single, aliased and truncated inputs; mixed types are
partial, and built-in `sorted()`/`list.sort()` internals fall back to generic.
Searching/sorting and recursion capabilities overlap, so merge sort and
recursive binary search can be requested either way. Both adapters are
registered and every scene is validated. Rules are in
[visualization-adapters.md](visualization-adapters.md).

The workspace now opens on an **Adaptive** canvas that uses the recognition
result instead of a second classifier. Auto asks the registry for the adapter
recognition named and labels the result; every other adapter is offered when
its own availability check passes at the selected step, so merge sort exposes
Sorting and Recursion together and recursive binary search exposes Recursion
and Searching. Choosing an adapter is presentation-only: the step, selected
frame, playback and speed stay put. Every scene still goes through the
registry and the validator, and an unavailable manual choice falls back to the
generic scene with the adapter's own reason. A run/profile/recognition change
is guarded so stale async results cannot replace the current run. The existing
Call tree, Control flow, Combined and Timeline canvases remain available. A
follow-up hardening pass separates "recognized but this step lacks evidence"
from "unsupported program" and adapter errors, reports the adapter actually
drawn in the header, keeps the previous valid run when an edit cancels a
pending one (marked **Edited**, not replaced by an error), opens failing runs on
the frame that raised the uncaught exception, and distinguishes a caught
exception from one that stopped the program.

The Adaptive canvas is now a visual stage rather than a stack of diagnostic
cards. The generic scene carries an optional statement stage rebuilt and
validated from the selected step: assignments show the real value change,
conditions show the observed outcome, the skipped or taken body and the next
condition the trace actually reached, loops show the round, the next recorded
item and the exit, and calls, returns, output, program completion and errors get their own stage.
Searching and sorting keep their adapter scenes as the primary stage, including
every sequence region the trace proves (a merge shows its result beside both
inputs), and recursion keeps its call tree as the primary stage. Variables, stack, memory, output and execution context move behind one
collapsed **Step details** disclosure. The explanation panel leads with what
happened, what is next and what changed; its control-flow reasoning and glossary
card are expandable. A changed scene still cannot invent a branch, value or
destination: `src/tracer/statementStage.js` re-derives the stage and
`src/tracer/scene.js` rejects a scene whose stage does not match the step.

Phase 9.1 fits a merge combine on the desktop canvas by putting the result
across the top and both inputs side by side, and makes the five canvas modes
wrap on narrow screens instead of clipping Timeline. The arrangement is a pure
choice from the region count (`src/visualizer/stageLayout.js`); values, indices,
highlights and the selected step are unchanged.

The selected step now keeps one execution story across the highlighted line,
trace event, StepView, stage, values, stack, output and explanation. A print()
newline is the end of the line it closes, so it shows that line's text; only a
line with no text before its newline (`print("")`) is blank. A completed program
ends on a distinct **Program finished** stage with no return value and a
`completed` module frame, while a real function return — including an explicit
or implicit `None` — keeps its ordinary **Return** stage and value. Caught
exceptions continue the run; an uncaught one still ends it on the error stage.
Six corpus programs pin the output, return, completion and exception shapes,
and `src/tracer/executionSemantics.test.mjs` walks each one through the scene
validator and the generic adapter. A bare `raise` and an exception passing
through `finally` now record an unwind with the real exception type instead of
a normal return of `None`; a `return` in `finally` still suppresses the
exception. Empty, whitespace-only and comment-only sources get an honest
**Empty program** stage, and fallback steps name the operation they observed
(definition, class, import, try, handler, break, continue, yield) instead of a
generic "Step".

Deliberately deferred: collapsing repeated loop rounds ("rounds 2 to 9 are
similar"), a live "waiting for input" state (inputs are still supplied before
the run), and reconstructing state between recorded steps. A trace only exposes
the state its recorded steps carry, so the comparison says "Not comparable"
rather than inventing more.

## Phase 10 — Universal program coverage and real-world validation

The coverage audit ran 15 unfamiliar programs (shared mutable containers,
nested conditions, early returns, comprehension variants, two prompts, nested
`break`, `while`/`else`, two calls on one line, an uncaught custom error, a
`finally` return, tree-shaped recursion, a mixed menu) through the real tracer,
the StepView, the statement stage, the scene validator and recognition. All
traced correctly and all stayed on the safe adapter except Fibonacci, which
recognition already reported as recursion. No recognition rule changed: no
false positive or false negative was found, so no positive/negative pair was
justified.

Five gaps were real enough to add to the corpus, which is now **60 programs
across 33 categories**: `alias-shared` and `alias-dict-in-list` (two names or
two slots for one object), `if-nested` (a condition inside a condition),
`function-early-return` (three exits called in a loop) and `io-two-inputs`
(two prompts, each paired with its answer). The aliasing programs prove the
shared-object note and the trace's repeated heap reference rather than
asserting them.

The Generic fallback improved first, in shared explanation code only. Lines
that used to read "Runs this line: …" now name what the trace shows: an
attribute assignment reads the new value from the next state (`self.points` is
set to 15), tuple targets unpack or swap with their real values, `yield` and
`yield from` say what they hand on, imports and decorators say what they load
or wrap, `async def` says when the body runs, `del` names its target, a nested
subscript assignment names its slot, and a method on a dotted or indexed
receiver names that receiver. The fallback still exists for syntax no rule
knows, but no recorded step of the corpus reaches it, and
`src/tracer/corpus.test.mjs` now enforces that.

Every step of every program now also goes through the adapter registry and
`validateScene`, not just the six execution-semantics programs: 1,415 steps
across 60 programs build a valid scene for the adapter recognition chose, with
no fallback.

No performance change was made, because none was justified: on a 1,502-event
run the whole per-step path measured 21.3 ms for `getStepView`, 11.5 ms for
the statement stage and 42.9 ms for the generic scene (about 0.05 ms per
step, p95 0.061 ms); the trace index builds in 0.32 ms for 402 events. The
existing index is already reused through its WeakMap, and the remaining
bounded scans are far below a frame at these sizes.

Breadth is proven rather than claimed: `tracer-poc/corpus.py` holds 60 programs
across 33 categories of Python, `test_corpus.py` checks the tracer against them
and keeps [supported-python.md](supported-python.md) in sync, and
`src/tracer/corpus.test.mjs` walks every step of every program through the UI's
own functions. A `no-example-hardcoding` test keeps example-specific words out of
the teaching layer's strings.

The landing page and the language picker are real, not stubs: the hero replays
a **recorded trace** of a built-in example through the same `getStepView` the
visualizer uses, so every value on it comes from the engine, and the language
grid marks Python as the only card that opens anything
(`src/pages/preview.js`, `src/pages/languages.js`, both tested).

All suites pass: 111 Python tests, 511 JS tests, plus lint and a production
build. Two opt-in checks need a local Pyodide install: `npm run test:pyodide`
and `npm run check:explain`. What remains on A3 is debounced generation; see the
roadmap above for the rest.

## Phase 11 — The run map: teaching the mechanism, not just the state

Phase 10 made every step explain itself. The gap that remained was the one a
beginner hits first: forty honest steps do not add up to the rule that produced
them. A `for` loop's rule — "this body runs five times, adding 1 then 2 then 3"
— exists only across those steps, and nothing on screen said it.

`src/tracer/runStory.js` now writes that rule down. It reads the same trace the
canvas replays and produces at most eight parts: setup, a repeat part per loop
that actually repeated, call parts (including recursion depth and the return
chain), the ending with the real printed text, a straight-through part for
programs with no repetition, and an error or limit part that never pretends the
run finished. `RunStoryCard` puts the map above the canvas, marks the part the
current step is inside, and jumps to a part's first step when clicked.

The counting is where the honesty lives, and the tests enforce it: rounds are
body executions, so a `for` loop's exhausted check is not a round; a loop is
only reported when the source line is really a loop header; chain links must be
values the trace recorded; a subclass instance is never reported as its base;
and a loop in a function called many times gets no single round count. All 60
corpus programs are checked, and exact stories are asserted for the `for` loop,
the `while` loop, nested loops, a `break`, recursion, a subclass and an error.

Limitations are documented rather than papered over in
[docs/run-story.md](run-story.md): inner loops have no separate round sentence,
loops in multi-call functions have no single round count, and printed text is
attributed only where it can be. The next teaching layer is prediction at loop
and decision boundaries, generated from the next recorded state.

While a repeat part is active, the card also shows "Round 3 of 5" with previous
and next round buttons, so a loop of thirty rounds costs a few clicks instead
of thirty. Those jumps are the trace's own header steps; the card never moves
the program anywhere the recorder did not go.

All suites pass: 111 Python tests, 526 JS tests, plus lint and a production
build.

## Phase 12 — One workspace, three regions

The workspace had grown a row of controls per stage: a second header inside the
shell, run buttons in the toolbar *and* the code pane, a canvas heading above
the canvas tabs, an adapter pill strip under those, and a playback bar that
wrapped into three rows on a phone. Each addition was reasonable on its own; the
sum was a dashboard.

The chrome now lives in `src/visualizer/workspace.css`, loaded after `App.css`
so it wins by order rather than by `!important`. The page has three regions:

- **one toolbar** — file, honest run state, learning mode, Run and Restart. The
  engine chip appears only while Python is loading or has failed; the step
  count moved to the playback bar where the slider is.
- **the canvas**, with one toolbar: a segmented control for the five views and,
  for the Adaptive view, a single "View: Auto → Generic" menu. Every adapter
  alternative and the recognizer's reason moved into that menu, so the pill
  strip and its permanent "why" details are gone. The run map stays above the
  canvas and now collapses.
- **the inspector**, six underline tabs in one non-wrapping row, with the panel
  on a flat surface instead of a tinted card inside a column.

The code and inspector columns are still resizable; the inspector is now a
fixed pixel width (320–480px) because a tabbed panel has a comfortable size,
while the code column stays a percentage. Below 1200px the canvas and inspector
take turns again, and below 900px it is one pane at a time. The playback bar is
one row of transport icons, a step readout, the timeline and the speed, with
Glossary and the Developer menu at the right.

Smaller systemic fixes came with it: a 4px-scale spacing pass, `.state-toggle`
and the Combined view's tabs use the same segmented control as the toolbar, the
drawing's zoom/fit/follow controls are a borderless footer, thin scrollbars
replace the default grey bars, and `box-sizing: border-box` inside `.app` fixed
a real horizontal overflow (the stage's error card was `width: 100%` plus its
own padding).

All gates pass: 111 Python tests, 526 JS tests, lint and a production build.
The screenshots used for verification were taken against a running dev server
at 1600, 1100 and 420px with the recursion example, a `for` loop, a runtime
error, round stepping, playback, every view and the inspector tabs.

## Automatic visualization planner (Phase 7A)

The canvases were already real; choosing one was still manual. Phase 7A adds a
decision layer that reads the existing AST profile and the recorded trace,
names evidence-labelled concepts, validates a versioned plan, and opens a
supported canvas.

- [x] Deterministic concept detection over the existing profile, trace and
      recognizer (`src/planner/concepts.js`); no second Python parser
- [x] Capability registry for the six real canvases, with explicit missing
      evidence and unknown-id rejection (`src/planner/renderers.js`)
- [x] Versioned plan schema (v1), strict bounded validator and motion fallback
      (`src/planner/plan.js`)
- [x] Pure deterministic planner with reason codes: sorting/searching -> Adaptive,
      observed recursion -> Call tree, nested calls -> Call tree/Combined,
      branch-heavy -> Control flow, everything else -> Motion
- [x] Lifecycle integration: one plan per run, auto-selection only until the
      learner picks a canvas, one restrained why-line, cursor untouched
- [x] Optional AI provider boundary with timeout, cancellation, size cap,
      classified errors, schema/registry validation, bounded cache and stale-run
      rejection; no key in the browser
- [x] Unit, corpus integration and browser checks; docs in
      [visualization-planner.md](visualization-planner.md)

AI-assisted planning is implemented and tested behind the provider boundary. Phase
7A left it off because the static deployment cannot hold a credential.

Gates: 136 Python tests, 823 JS tests, lint, production build, 195 browser
checks, `check:explain` and `test:pyodide`.

## Secure AI planner activation (Phase 7B)

Phase 7B makes that boundary deployable instead of hypothetical: the credential
moves server-side, the lifecycle gets explicit cancellation, and the planner's
automatic choices are measured against a written expectation table.

- [x] Server route `api/plan.js` (Vercel Node function) over a pure
      `handlePlannerRequest` core: POST-only, same-origin check, JSON content
      type, 32 KB request cap, strict v1 schema, 6 s provider timeout, 16 KB
      response cap, per-instance rate limit, explicit `not_configured`
- [x] Provider key read from server env only (`PLANNER_PROVIDER_KEY`,
      `PLANNER_PROVIDER_URL`, `PLANNER_MODEL`); fixed upstream URL, key in a
      header, no key/stack/upstream body in any response or the bundle
- [x] Reuses `plan.js`, `renderers.js` and `aiPlanner.js` — no second schema,
      planner, parser or renderer; advertised capabilities must equal the real
      registry
- [x] Server returns the model's selection only; the browser re-validates it
      against its own full evidence and builds the plan
- [x] Client lifecycle: deterministic plan first, one in-flight request aborted
      by a new run/edit/unmount, cache keyed by endpoint and whole request,
      fallback baselines never overridden, failures silent in the UI
- [x] Planner quality corpus: 122 cases (68 corpus + 54 recognition) covering 20
      required behaviours, with a `check:planner` gate and a scripted-AI
      comparison that measures validation, not a model
- [x] `nested_loop` rule: loops nested two deep without a collection open
      Control flow
- [x] Server unit tests, client integration tests and browser scenarios against
      a mock upstream (valid, invalid, error, timeout, stale, manual pin, edit
      cancel, cursor stability, no third panel)

Deployment is Vercel: set the three server variables and
`VITE_PLANNER_ENDPOINT=/api/plan`. Without them the route answers
`not_configured` and the deterministic planner is the whole product — a supported
configuration, not a broken one.

**Not verified live:** this environment had no provider credential and no
deployed route, so the model path is implemented and mock-tested only. The
measured quality numbers describe the deterministic planner and the validator.

Gates: 136 Python tests, 871 JS tests, lint, production build, `check:planner`
(122/122 appropriate), `check:browser` (212/212). `check:explain` and
`test:pyodide` were not re-run: this phase did not touch the worker, `tracer.py`
or the explanation layer.
