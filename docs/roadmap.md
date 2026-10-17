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
- [ ] Pan, zoom, and a fit-to-screen button
- [ ] Generate on a ~400 ms debounce as the learner types, before Run
- [ ] "Show code in boxes" toggle

### Stage A4 — Execution overlay

- [ ] Highlight the node for the current step, with a short trail
- [ ] `True` / `False` chips on the branch that actually ran
- [ ] Loop badges ("Round 2 of 4") in the flowchart and next to the loop line
- [ ] Click a node to jump to the first step that ran it

### Stage A5 — Function tabs and export

- [ ] One tab per function, following the call stack
- [ ] Export the chart as SVG or PNG

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

- [ ] Reference arrows from variables to heap objects (SVG overlay)
- [ ] Call stack cards with "called from line N", argument values, and return values
- [ ] Recursion tree view
- [ ] Strings as character slots; nested lists as grids
- [ ] Jump controls: next loop round, end of function, next change

## Tier 4: Teaching layer

- [ ] Concept cards, dismissible, shown once per run
- [ ] Glossary tooltips on terms in explanations
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
is in progress: A3 draws the format-2 graph as an SVG diagram in the UI, and
what remains is pan/zoom, debounced generation, and the show-code toggle.

All suites pass: 81 Python tests, 55 JS tests, plus lint and a production build.
Two opt-in checks need a local Pyodide install: `npm run test:pyodide` and
`npm run check:explain`.
