# CodeLens

**Watch your code run, one step at a time.**

CodeLens is a free, in-browser code visualization and programming education tool for
people learning to program. Write or pick a
program, press Run, and watch it replay step by step as diagrams and
plain-English explanations: variables as boxes, lists as numbered slots, function
calls as stacked cards, and the code itself as a flowchart. Python is the first
supported language; more are planned.

It is built for a **complete beginner** — a school student or first-year college
student with no coding background. Every step gets a short sentence in everyday
words, so the tool reads like a patient teacher rather than a developer console.

> **Demo**
>
> _Screenshot / GIF coming soon — add `docs/demo.gif` here once recorded._
>
> ```markdown
> ![CodeLens replaying a loop step by step](docs/demo.gif)
> ```

## Why it exists

Code runs invisibly. A beginner types a line, gets an answer (or an error), and has
no idea what happened in between. Existing visualization tools are either paid, or
written in developer jargon, or both.

CodeLens fixes both halves of that:

- **Free and in-browser.** Python runs locally in the browser via
  [Pyodide](https://pyodide.org) inside a Web Worker. No account, no server, no
  code leaves the machine.
- **Plain English.** Every execution step is turned into a sentence a non-coder can
  follow. No jargon on first use — it says "box that holds a value", not "binding".

## Features

- **Step-by-step replay** — Back, Play/Pause, Next, a step slider, and speed control.
- **One step, every panel** — the highlighted line, the graph node, the variables,
  the changes, the call stack and the explanation all come from a single tested
  step view, so they can never disagree about the same step. Stepping backwards
  rebuilds exactly the step you land on.
- **Variables with history** — the panel shows the state *before* the line runs and
  previews what the line will change ("After this line: `x` will be 3"); a
  Before/After toggle shows the other side. Click a name to follow its whole
  history, and two names pointing at one list get a "two names for one list" note.
- **Object diagrams** — lists as numbered slots, dictionaries as drawers, class
  instances as labeled cards; the slot the line just touched is lit up. Values are
  never invented: a container cut short says "… 27 more", a value the snapshot
  doesn't show says so, and a new slot reads `fruits[2] = "cherry"`, not `? → …`.
- **Changes** — every value the program changed, newest first, each with a button
  that jumps to the step that changed it.
- **Function calls** — each call on the stack with its arguments and the line that
  called it; click one to see that call's own variables without moving the
  current step, and a finished call shows what it returned and to which line.
- **Four canvases, one run** — the Visualize pane offers a strip of drawings,
  and every one of them is a window onto the *same* execution: switching canvas
  carries the step, the playing state and the speed through untouched.
  - **Call tree** — every call the program made, nested under the call that made
    it, so recursion reads as a tree rather than a tower. Each box shows the real
    arguments and what the call gave back (or the exception that stopped it), the
    call running now is highlighted and kept in view, and clicking any call jumps
    to the step it started at. A subtree can be folded away. A very large run
    opens with the first 200 frames chosen breadth-first, says how many are still
    hidden, and puts the rest behind **Show all calls**; a run with no function
    calls points to the flowchart instead of drawing an empty tree.
  - **Control flow graph** — the textbook flowchart of your code, laid out
    deterministically with no graph library: ovals, rectangles, diamonds, calls
    and read/show boxes. The path this run really took is lit up, a Yes or a No
    only ever shows the branch that was actually taken (per invocation, so a
    recursive call's own answer is its own), a box the run never reached is drawn
    subdued and cannot be clicked, and an exception lights the line it broke on
    without inventing an edge. With **Values** on, each executed box carries its
    real run count; the box under the token also shows the condition a diamond
    evaluated, or the old → new values its line is about to produce. One tab per
    function, "Follow run", "Show code in boxes", "Values", and the old block
    outline one click away under **Simple view**.
  - **Combined** — the call tree beside the two halves of the step you most often
    reach for: which calls are waiting (their real arguments and returned values)
    or what the program is holding, with one click to follow a name through its
    whole history. It draws the inspector's *own* panels, fed the inspector's own
    step view, so the two sides cannot disagree — and choosing between them, or
    switching canvas away and back, leaves the step where it was.
  - **Timeline** — one table row per *real* trace step: Step, Line, Event, Code,
    Variables and Output. It is virtualised, so a 1,500-step run still draws about
    thirty rows; the current row is highlighted and scrolled into view, and
    clicking any row jumps to exactly that step. Event labels separate ordinary
    lines, calls, returns, changes, branches, loops, input, output and errors, and
    **Only changes** never hides the step being played. **Compare steps** opens two
    independent endpoints without moving playback: variables are marked Added,
    Removed, Changed or Unchanged (or "Not comparable" when a different frame owns
    the name), nested lists/dicts are matched by the trace's own object ids, and
    the panel also compares call-stack depth, output, input and errors. Equal,
    reversed, empty and out-of-range endpoints are handled explicitly.
  - Fit, zoom, pan, follow, expand and a "How to read this" legend behave the same
    on every canvas, on a laptop and on a phone, and honour reduced motion. From
    the keyboard, arrow keys pan, `+`/`-` zoom, `0` resets and `F` fits; tabbing
    to a node centres it, and the function tabs use Arrow/Home/End with one tab
    stop.
- **A Beginner / Advanced / Textbook** switch in one control changes how much of
  the trace is exposed; Textbook opens the control flow canvas, and after that you
  can pick any canvas you like.
- **Inspector in five sections** — A this step (line, plain English, why), B
  variables (values, scope, changes), C execution flow (before / now / next with
  reasons), D calls and returns (arguments, locals, waiting calls, returned value
  and its destination), E output. The output console keeps the program's exact
  spaces and line breaks, folds later output behind a clear "not run yet" heading,
  and lists the real input prompts/values and any handled or uncaught errors with
  a jump back to the step that recorded them. Trace internals sit behind a
  disclosure that Advanced mode opens. If one section cannot render, it says so
  and the rest keep working.
- **Code panel that reads itself** — long lines wrap, the next line wears a `▶`,
  the line that just ran keeps a faint mark, the highlighted line shows its result
  inline (`x = 5` → `10`), and hovering a name shows its current value. A program
  that reads the keyboard can be given its input values one per line.
- **Plain-English explanations** — a "what's happening" card for every single step,
  split into **Just happened**, **About to happen** and **Why this line runs now**,
  generated by pure functions over the trace (never AI, so it can never contradict
  what the code did). Every kind of step — printing, asking, failing, being stopped
  by a limit — gets an answer to "why is control here?". Jargon is explained at
  first use by a dismissible concept card, and a glossary drawer collects the terms.
- **Works where beginners are** — phone and laptop, light and dark themes, with
  a theme toggle that is remembered and never flashes the wrong colours.
- **A real site around it** — a landing page whose hero replays a real trace
  step by step (variables, call stack and output, all from the engine's own
  recording, pausing when you leave the tab), a language picker that is honest
  about what runs today, and docs, learn and about pages behind one shared
  shell with breadcrumbs, a footer, and loading / empty / error / 404 states.

## How it works

```
Python code
    │
    ├──► tracer-poc/tracer.py   records every step as JSON  ──►  docs/trace-format.md
    │                                                           (a documented, versioned
    │                                                            language-neutral contract)
    └──► tracer-poc/analyze.py  static AST profile, never runs ──► docs/program-profile.md
                                                                (versioned, deterministic)
tracer-poc/corpus.py      68 programs, one per construct    ──►  docs/supported-python.md
    │                                                      (what the tracer really supports,
    ▼                                                       kept in sync by the tests)
src/tracer/              reads the JSON in the browser
    ├── client.js         runs the tracer in a Web Worker (Pyodide)
    ├── traceIndex.js     per-trace lookup tables, cached by the trace array
    ├── stepView.js       one tested view of step N: line, variables, changes, stack
    ├── runStory.js       the whole run in a few sentences: rounds, values, result
    ├── explain.js        turns each step into a plain-English sentence
    ├── flow.js           builds the flowchart and loop counts
    ├── history.js        numeric-series guard and SVG chart geometry
    ├── values.js         value formatting, and the honesty rules for it
    ├── objects.js        builds the object diagrams and reference edges
    ├── programProfile.js static AST profile (never runs the program)
    ├── recognition.js    picks a search/sort/recursion capability from that profile
    ├── adapters.js, scene.js the validated adapter registry and scene contract
    ├── genericAdapter.js, statementStage.js the default scene and its step model
    ├── searchingAdapter.js, sortingAdapter.js, recursionAdapter.js
    └── sequenceScene.js  shared sequence panels for the specialist scenes
    │
    ▼
src/flowchart/           draws the same trace as a call tree or a flowchart
    ├── callTree.js, callTreeLayout.js the calls this run made, nested
    ├── mapTrace.js, layout.js         the format-2 chart, laid out with no dependency
    ├── controlFlow.js, shapes.jsx     a trace step -> a shape, an arrow, a branch
    └── viewport.js                    fit / zoom / pan maths, shared by both (pure)
    │
    ▼
src/visualizer/          the workspace beside the canvas
    ├── Inspector.jsx     six tabbed sections (Explain…History), real ARIA tabs
    ├── AdaptiveView.jsx, SceneView.jsx the canvas, its validated scenes and the view menu
    ├── RunStoryCard.jsx  the run map above the canvas, current part marked
    ├── workspace.css     the workspace chrome: toolbar, split, inspector, playback
    ├── adaptive.js       Auto/manual adapter choice and the header label
    ├── PlaybackBar.jsx   stepping, timeline, speed, and the Developer menu
    ├── TimelinePane.jsx, timeline.js the virtualised step table and its pure rows
    ├── StepComparison.jsx, compare.js the two-step diff and its endpoint state
    ├── output.js         exact past/later output, input prompts and error entries
    ├── playback.js       milliseconds per step, plus the saved preference
    ├── learningMode.js   what Beginner / Advanced / Textbook are allowed to change
    ├── workspace.js      step clamping and tab selection, so they cannot tangle
    ├── labels.js         the learner's words for a step and a variable list
    └── panelBits.jsx     shared panel pieces: rows, calls, objects, headings
    │
    ▼
React UI (src/App.jsx)   draws it all: the code panel, the graph and the
                         inspector all read the same tested step view
```

The tracer is the single source of truth, and the trace JSON is the only thing the
UI knows about. That separation is what will later let CodeLens add JavaScript
support, DSA visuals, and Kannada explanations without touching the tracer.

## Getting started

Requires **Node.js 20+** and **Python 3** (the tracer tests run with the standard
library only — no pip installs).

```bash
npm install     # install dependencies
npm run dev     # start the dev server at http://localhost:5173
```

Then open the printed URL, pick an example (or paste your own code), and press Run.
The first run takes a few seconds while Python loads into the browser; it is cached
after that.

## Tests

Three suites, all of which should pass on every commit:

```bash
npm run test:tracer   # 136 Python tests: the tracer and its comparison events, the
                      # flowchart model, the static program profile and the corpus
npm run test:js       # 698 JS tests: the animation diff vocabulary, the one-transition
                      # diff and its inverse (including task-5 list/tuple state,
                      # 5b swap/shift movement, 5c insert/pop shapes and task-6
                      # dict/set/object contents and lifecycle), the pure motion
                      # plan (stable nodes, operations, seeks, reduced motion and
                      # cancellation), the settled-position evidence, the
                      # recorded-comparison display and its operand cells, the
                      # one-sentence operation explanations, the swap
                      # choreography (curves, arcs, one duration per pair),
                      # DOM-free motion view and its real-
                      # action-to-render mapping (persistent keys, verified moves,
                      # ghosts, highlights),
                      # the safe index evaluator and the
                      # statement-shape parser, the call tree and control flow model and
                      # layout, the
                      # graph, the teaching layer, the
                      # corpus, the trace index, the program
                      # profile parser and recognition engine, the adapter registry,
                      # recursion, searching and sorting scenes, the statement stage and
                      # the scene validator, Auto/manual adapter choice, composite
                      # capabilities, fallback and stale-run rejection, early-step evidence
                      # wording, source-dirty status, exception chains, the router, the
                      # homepage preview, the language picker, the workspace modules,
                      # variable history, the run story (rounds, value chains and
                      # error endings), the timeline and comparison helpers,
                      # output/input/error entries, and the design tokens' contrast
npm run lint          # oxlint
npm run build         # production build
```

The corpus is the breadth behind those numbers: 68 programs across 34 categories
of Python, each traced for real (`tracer-poc/corpus.py`) and checked on both
sides — `test_corpus.py` against the claims it makes, and `src/tracer/corpus.test.mjs`
step by step through the UI's own functions. `docs/supported-python.md` is kept in
sync by the same tests, so it cannot promise what the tracer does not do.

There are also three opt-in checks:

```bash
npm run test:pyodide  # sanity-check the Web Worker against real Pyodide
npm run check:explain # verify every example's trace explains cleanly
npm run check:browser # drive the real app in headless Chrome (no npm dependency)
```

`check:browser` starts its own dev server and headless Chrome, then checks the motion
canvas against real layout: consecutive swaps, an interrupted swap at 1x and 4x, mid-move
Back and slider seeks, a burst of steps, comparisons, persistent green positions, themes,
reduced motion, and short and long arrays. It needs Chrome or Edge; set `CHROME_PATH` if it
is not in a standard location. It is the only test that can exercise the effect ordering in
`MotionStage.jsx`, so it is the regression test for the interruption fix.

## Project structure

```
codelens/
├── docs/
│   ├── scope.md            # what CodeLens is, who it is for, what is in and out of v1
│   ├── trace-format.md     # the trace JSON contract (format version 3)
│   ├── supported-python.md # what the tracer really supports, kept in sync by tests
│   ├── graph-diagnosis.md  # why the old graph did not teach, and the rebuild plan
│   ├── ui-diagnosis.md     # per-panel purpose, and the "line about to run" convention
│   ├── flowchart-format.md # the textbook flowchart's node/edge contract
│   ├── program-profile.md  # the static AST profile contract (version 1)
│   ├── recognition.md      # evidence rules and confidence for algorithm recognition
│   ├── visualization-adapters.md # adapter contract, scene schema, validation rules
│   ├── brand.md            # the mark, palette, asset files and usage rules
│   ├── implementation-plan.md # the site build: audit, phases, and status
│   ├── animation-spec.md   # the visualizer rebuild's source of truth
│   ├── animation.md        # the action vocabulary and the diff rules
│   ├── animation-audit.md  # Phase 0: what the tracer really records
│   ├── animation-progress.md # phase status, decisions, open questions
│   └── roadmap.md          # what is built, what is next
├── src/
│   ├── main.jsx            # mounts the router and paints the stored theme
│   ├── router.js           # route table + path matching (pure, tested)
│   ├── router.jsx          # <Router> and <Link> over the History API
│   ├── routerContext.js    # the context the shell and pages read
│   ├── routes.jsx          # route name -> page component, plus <Site>
│   ├── theme.js            # theme resolve / persist / toggle (pure part tested)
│   ├── styles/tokens.css   # design tokens: colour, spacing, radius, both themes
│   ├── styles/contrast.test.mjs # WCAG audit of those tokens, in both themes
│   ├── index.css           # document base: type, focus ring, reduced motion
│   ├── brand/
│   │   ├── BrandLogo.jsx   # the mark and horizontal lockup, theme-aware
│   │   ├── brand.css       # logo colours and placement sizes
│   │   └── wordmarkPath.js # "CodeLens" outlined to paths, no font shipped
│   ├── shell/
│   │   ├── AppShell.jsx    # nav, theme toggle, breadcrumbs, footer
│   │   ├── states.jsx      # loading, empty, error and 404 states
│   │   └── shell.css
│   ├── pages/              # one file per route (home, get-started, learn, ...)
│   │   ├── Home.jsx            # the landing page and its live preview
│   │   ├── GetStarted.jsx      # the language grid (Python only, honestly)
│   │   ├── languages.js        # the language list + the homepage features (pure)
│   │   ├── languages.test.mjs  # Python is the only language that links anywhere
│   │   ├── preview.js          # real trace -> preview frames (pure, reuses stepView)
│   │   ├── preview.test.mjs    # every frame checked against the corpus recording
│   │   ├── preview-fixture.json # a recorded run of one built-in example
│   │   └── usePageMeta.js      # each page's own <title> and meta description
│   ├── App.jsx             # the Python visualizer: orchestrator + tracer wiring
│   ├── App.css
│   ├── animation/          # the action diff behind the new animation page
│   │   ├── actions.js      # vocabulary, effects, targets, deterministic ids
│   │   ├── actions.test.mjs
│   │   ├── diff.js         # one transition as actions, plus apply and its inverse
│   │   ├── diff.test.mjs
│   │   ├── evaluate.js     # safe index expressions + separate bounds resolution
│   │   ├── evaluate.test.mjs
│   │   ├── lineShape.js    # which statement shape a source line has, from syntax only
│   │   └── lineShape.test.mjs
│   ├── visualizer/
│   │   ├── session/             # one execution session: run, cursor, playback, selected call
│   │   ├── motion/
│   │   │   ├── plan.js          # cursor -> stable nodes + generic motion operations (pure)
│   │   │   ├── plan.test.mjs   # real traces, reversibility, seeks, timing, cancellation
│   │   │   ├── view.js          # plan -> drawable nodes, ghosts and step flags (pure)
│   │   │   ├── view.test.mjs   # real-trace action-to-render mapping
│   │   │   ├── MotionStage.jsx  # persistent data cards, FLIP moves, cancellation
│   │   │   ├── motion.css       # the motion canvas styling, token-only
│   │   │   └── useReducedMotion.js # the live prefers-reduced-motion preference
│   │   ├── Inspector.jsx        # six tabbed sections, full ARIA tab pattern
│   │   ├── PlaybackBar.jsx      # stepping, timeline, speed, Developer menu
│   │   ├── panelBits.jsx        # shared panel pieces (components only)
│   │   ├── labels.js            # step words, scope and the variable list builder
│   │   ├── labels.test.mjs
│   │   ├── playback.js          # ms per step and the saved speed (pure)
│   │   ├── playback.test.mjs
│   │   ├── learningMode.js      # what each learning mode may change (pure)
│   │   ├── learningMode.test.mjs
│   │   ├── workspace.js         # step clamping and tab selection (pure)
│   │   ├── workspace.test.mjs
│   │   ├── vizMode.js           # which canvas draws the run (pure)
│   │   ├── vizMode.test.mjs
│   │   ├── RunStoryCard.jsx     # the run map above the canvas (pure model input)
│   │   ├── adaptive.js          # Auto/manual adapter choice and validated scene build (pure)
│   │   ├── adaptive.test.mjs    # composite capabilities, fallback, empty and determinism
│   │   ├── runGate.js           # rejects stale run/profile/recognition results (pure)
│   │   ├── runGate.test.mjs
│   │   ├── AdaptiveView.jsx     # Adaptive canvas: view menu, fallback reason, empty states
│   │   ├── SceneView.jsx        # renders one validated scene
│   │   ├── sceneKeys.js         # matches scene highlights to their slots (pure)
│   │   ├── sceneKeys.test.mjs
│   │   ├── stageLayout.js       # result-above-inputs layout for algorithm regions (pure)
│   │   ├── stageLayout.test.mjs
│   │   ├── Canvas.jsx           # the shared surface: pan, zoom, fit, follow, expand
│   │   ├── CallTree.jsx         # canvas 1: the calls this run made, nested
│   │   ├── CombinedView.jsx     # canvas 3: the tree beside the stack or variables
│   │   ├── VisualizationPane.jsx # one canvas toolbar: the offered views and the tools slot
│   │   ├── workspace.css        # the chrome layer: toolbar, split, tabs, playback bar
│   │   └── SimpleFlow.jsx       # the v1 block outline, behind "Simple view"
│   ├── flowchart/
│   │   ├── callTree.js          # frames -> a tree of calls, one node per call (pure)
│   │   ├── callTree.test.mjs
│   │   ├── callTreeLayout.js    # box sizes and positions for that tree (pure)
│   │   ├── callTreeLayout.test.mjs
│   │   ├── mapTrace.js          # format-2 chart and line -> node lookup (pure)
│   │   ├── mapTrace.test.mjs
│   │   ├── layout.js            # deterministic layered layout, no dependency (pure)
│   │   ├── layout.test.mjs
│   │   ├── controlFlow.js       # trace step -> chart node, arrow, branch (pure)
│   │   ├── controlFlow.test.mjs
│   │   ├── shapes.jsx           # SVG primitives for the eight node kinds
│   │   ├── ControlFlowChart.jsx # canvas 2: the shapes, with the run's path lit
│   │   ├── executionGraph.js    # the step view's node model (pure, still load-bearing)
│   │   ├── layoutGraph.js       # card rows, indents and edge lanes (pure)
│   │   ├── nodeBody.js          # what each card shows (pure)
│   │   ├── reasons.js           # why an edge ran, with real values (pure)
│   │   └── viewport.js          # fit / zoom / pan maths (pure)
│   └── tracer/
│       ├── client.js           # talks to the Web Worker
│       ├── pyodide.worker.js   # loads Pyodide, runs the tracer
│       ├── traceIndex.js       # per-trace state/frame/output lookups (pure, cached)
│       ├── programProfile.js   # validate/normalise the static AST profile (pure)
│       ├── recognition.js      # profile + trace evidence -> adapter decision (pure)
│       ├── adapters.js         # immutable adapter registry + validated fallback (pure)
│       ├── genericAdapter.js   # always-available StepView scene (pure)
│       ├── statementStage.js   # validated assignment/condition/loop stage (pure)
│       ├── recursionAdapter.js # invocation-tree scene from real frames (pure)
│       ├── sequenceScene.js    # shared sequence/highlight scene pieces (pure)
│       ├── searchingAdapter.js # linear/binary search scenes from real traces (pure)
│       ├── sortingAdapter.js   # four list-sort families from real traces (pure)
│       ├── scene.js            # scene contract and validator (pure)
│       ├── stepView.js         # one view of a step, shared by every panel (pure)
│       ├── runStory.js         # trace -> the plain-English map of the whole run (pure)
│       ├── runStory.test.mjs
│       ├── explain.js          # step -> plain-English sentence (pure functions)
│       ├── flow.js             # flowchart model and loop counts
│       ├── history.js          # numeric-series guard and chart geometry (pure)
│       ├── history.test.mjs
│       ├── objects.js          # object diagram and reference-edge model
│       ├── values.js           # value formatting, and its honesty rules
│       └── __fixtures__/       # real traces the tests replay, kept gzipped
├── tracer-poc/
│   ├── tracer.py           # THE TRACER — single source of truth
│   ├── analyze.py          # read-only AST program profile, never executes source
│   ├── corpus.py           # 68 programs, one per construct category
│   ├── dump_corpus.py      # runs them for real; writes the golden and the fixture
│   ├── dump_recognition.py # records search/sort/recursion fixtures and corpus profiles
│   ├── corpus-golden.json  # recorded status, stdout and counts per program
│   ├── examples/           # the first 10 example programs (each doubles as a test)
│   └── test_*.py           # tracer, flowchart and corpus tests
└── scripts/                # preview-fixture.mjs (re-records the homepage's trace),
                            # plus the opt-in Pyodide and explain checks
```

Tests live beside what they cover (`*.test.mjs` next to the `.js`), and
`npm run test:js` lists them explicitly.

## Roadmap

See [docs/roadmap.md](docs/roadmap.md) for what is done and what comes next —
including the examples gallery, reference arrows, a recursion tree view, and
shareable links. The longer-term vision (DSA visuals, more languages, Kannada) is
in [docs/scope.md](docs/scope.md).

## Docs

| Doc | What it covers |
|---|---|
| [docs/scope.md](docs/scope.md) | Product scope, audience, and principles |
| [docs/trace-format.md](docs/trace-format.md) | The trace JSON contract the UI consumes |
| [docs/supported-python.md](docs/supported-python.md) | What the tracer supports today, by construct |
| [docs/graph-diagnosis.md](docs/graph-diagnosis.md) | Why the old graph did not teach, and the rebuild plan |
| [docs/ui-diagnosis.md](docs/ui-diagnosis.md) | Why each panel exists, and the one-step convention the UI follows |
| [docs/run-story.md](docs/run-story.md) | The map of a whole run: parts, round counting and honesty rules |
| [docs/flowchart-format.md](docs/flowchart-format.md) | The textbook flowchart's node and edge contract |
| [docs/program-profile.md](docs/program-profile.md) | The static AST program profile the adaptive engine will read |
| [docs/recognition.md](docs/recognition.md) | Evidence rules and confidence for algorithm recognition |
| [docs/visualization-adapters.md](docs/visualization-adapters.md) | Adapter contract, scene schema and validation rules |
| [docs/brand.md](docs/brand.md) | The CodeLens mark, palette, asset files and usage |
| [docs/roadmap.md](docs/roadmap.md) | Build order and current status |

## Status

Working end to end, and teaching: the tracer runs the bundled examples plus a
68-program corpus covering 34 categories of Python, and the UI replays any of
them on six canvases — Adaptive, call tree, control flow, combined, timeline and
motion — with a six-section inspector and plain-English explanations for every
kind of step. One workspace toolbar, one canvas toolbar and one playback bar
replace the four competing control rows the page used to have; the drawing keeps
the space, and the inspector is a single tabbed column. Runs
with very large call trees open capped at 200 visible frames, with a counted
**Show all calls** escape hatch. Both graph canvases support keyboard
pan/zoom/fit and focus-centring, and control flow adds roving function tabs. The
playground now sits
inside a real site — landing page, language picker, learn, docs and about —
behind one shared shell with a remembered dark/light theme. Built with React
19, Vite, and Pyodide.
