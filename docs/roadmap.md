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
- [ ] Homepage preview driven by the real engine (lazy-loaded)
- [ ] Learn lessons and docs pages

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
- [x] Changes panel: every change, newest first, each jumpable (folded into the
      Variables section behind a disclosure, nothing removed)
- [x] Function calls panel: arguments, called-from line, each call's own variables
      and return value, and where a finished call's result went
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

- [x] `tracer-poc/corpus.py`: ~45 programs across 32 categories, each with the
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

Tier 1 is done. The recorder, tracer, teaching layer, object diagrams, and the
card-list flowchart all work end to end. The main view is now the **execution
graph** (`src/flowchart/executionGraph.js` + `ExecutionGraph.jsx`): one card per
executed line, laid out automatically in run order and indented per call depth,
so recursion reads as a staircase rather than a dagre tower. Each card carries
the code, a plain-English action, the values that matter, what changed, and
where control goes next; finished calls fold away. The textbook flowchart is
still reachable behind the same **Beginner / Advanced / Textbook** control.

The playground is one viewport-height screen — code | graph | explanation |
inspector — with draggable splitters, folding into tabs (Code, Explain, Graph,
Panels) below 1280px and staying usable at 375×667. The inspector is five
labelled sections (A this step, B variables, C execution flow, D calls and
returns, E output) plus a collapsed trace-internals disclosure, each wrapped in
its own error boundary.

Breadth is proven rather than claimed: `tracer-poc/corpus.py` holds ~45 programs
across 32 categories of Python, `test_corpus.py` checks the tracer against them
and keeps [supported-python.md](supported-python.md) in sync, and
`src/tracer/corpus.test.mjs` walks every step of every program through the UI's
own functions. A `no-example-hardcoding` test keeps example-specific words out of
the teaching layer's strings.

All suites pass: 95 Python tests, 144 JS tests, plus lint and a production build.
Two opt-in checks need a local Pyodide install: `npm run test:pyodide` and
`npm run check:explain`. What remains on A3 is debounced generation and the
show-code toggle; see the roadmap above for the rest.
