# CodeLens Roadmap

The order below is the working plan. Tiers are worked one at a time, and the
project is left in a runnable, demoable state after each task.

## Tier 1: Housekeeping

- [x] Replace the Vite template `README.md` with a real one
- [x] Add `.gitattributes` and normalize line endings to LF
- [x] Add `docs/roadmap.md` (this file)
- [x] Add a GitHub Actions workflow that runs tests, lint, and build on every push and PR

## Flowchart renderer (stages A3–A5)

A vertical slice that replaces the card list with a real textbook flowchart,
drawn as SVG and laid out with dagre. The detailed spec is
[stage-a3-flowchart-renderer.md](stage-a3-flowchart-renderer.md); the graph
builder and its node/edge contract are in
[flowchart-format.md](flowchart-format.md).

### Stage A3 — SVG renderer

- [x] Install `@dagrejs/dagre` for the layout pass
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
      note, NEW/CHANGED badges, Before/After toggle, click a name to see its history
- [x] Changes panel: every change, newest first, each jumpable
- [x] Function calls panel: arguments, called-from line, each call's own variables
      and return value
- [x] Graph: every edge labelled with why it was taken, decision chips with real
      values, run badges, current/came-from/next tags, click-to-jump
- [x] Code panel: wrapped long lines, `▶` on the next line, result hints inline,
      hover a name to see its value
- [x] Side panels renamed and given one-line descriptions and a `?` help button

## Tier 2: Core experience

The biggest win for a beginner. No tracer or trace-format changes.

- [ ] Split `src/App.jsx` into components and hooks (`usePlayer`, `useTraceRunner`)
- [ ] CodeMirror 6 editor: syntax highlighting, line numbers, current-line highlight,
      tab indentation, read-only while stepping
- [ ] Examples gallery grouped by level, each with a goal and a "what to notice" hint
- [ ] `input()` support via an "Input values" box
- [ ] Friendly errors: type, message, line, and a "did you mean" suggestion for `NameError`
- [ ] Light/dark theme, remembered in `localStorage`
- [ ] Responsive mobile layout (single column under 760px)
- [ ] Accessibility: focus rings, `aria-live` explanations, full keyboard use

## Tier 3: Better visuals

- [ ] Reference arrows from variables to heap objects (SVG overlay; the objects
      panel names every variable that points at each object instead)
- [x] Call stack cards with "called from line N", argument values, and return values
- [ ] Recursion tree view
- [ ] Strings as character slots; nested lists as grids
- [ ] Jump controls: next loop round, end of function (jumping to a change is done
      from the Changes panel)

## Tier 4: Teaching layer

- [x] Concept cards, dismissible, shown once per run
- [x] Glossary drawer, and a first-use card wherever a new term appears
- [ ] Level selector (Beginner / Intermediate) changing explanation depth
- [ ] Move all explanation strings into `i18n/en.js` (prep for Kannada)
- [ ] Predict mode with a small score

## Tier 5: Sharing and polish

- [ ] Shareable link: code and inputs encoded in the URL hash
- [ ] Remember the last program in `localStorage`
- [ ] Performance: memoized per-step state, lazy Pyodide, smooth 1,500-step traces
- [ ] Error boundary around the visual panels
- [ ] Optional privacy-friendly analytics (page views only)

## Later (v2)

Out of scope for version 1 — see [scope.md](scope.md) for the full list.

- DSA visuals: searching and sorting bars, stacks, queues, linked lists, trees,
  graphs, dynamic programming tables
- JavaScript support, then possibly Java or C++
- Kannada explanations
- Step counts and Big-O comparison

## Status

Tier 1 is done. The recorder, tracer, teaching layer, object diagrams, and the
card-list flowchart all work end to end. The flowchart renderer (stages A3–A5)
is in progress, but the main view is now the **execution graph**
(`src/flowchart/executionGraph.js` + `ExecutionGraph.jsx`): a trace-driven
diagram of the nodes and hops the run actually took, with a token that follows
the current step. It replaces the textbook flowchart as the default view, which
is still reachable behind "Simple view".

The playground is laid out as one viewport-height screen — code | graph |
explanation above variables / changes / calls / output, with draggable
splitters — folding into tabs (Code, Graph, Variables, Changes, Calls, Output)
below 1280px. What remains on A3 is debounced generation and the show-code
toggle.

The teaching UI pass is done: `src/tracer/stepView.js` is the single tested view
of a step, and every panel and the graph render from it, so they cannot disagree.
The explanation card is three labelled parts, and it now says what the previous
line *did* rather than repeating its prediction. See
[ui-diagnosis.md](ui-diagnosis.md) for the convention and
[flowchart-format.md](flowchart-format.md) for the graph contract.

All suites pass: 81 Python tests, 95 JS tests, plus lint and a production build.
Two opt-in checks need a local Pyodide install: `npm run test:pyodide` and
`npm run check:explain`.
