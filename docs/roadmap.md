# CodeLens Roadmap

> **Placeholder.** This file was generated from the priority tiers in the project
> brief so the README link is not broken. Replace it with the real roadmap when
> ready.

The order below is the working plan. Tiers are worked one at a time, and the
project is left in a runnable, demoable state after each task.

## Tier 1: Housekeeping

- [x] Replace the Vite template `README.md` with a real one
- [x] Add `.gitattributes` and normalize line endings to LF
- [x] Add `docs/roadmap.md` (this file)
- [x] Add a GitHub Actions workflow that runs tests, lint, and build on every push and PR

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
- [ ] Loop badges ("Round 2 of 4") in the flowchart and next to the loop line
- [ ] Condition chips (True/False) on `if` and `while` evaluation
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

Everything under Tier 1 is done. The app runs all 10 example programs in
`tracer-poc/examples/`, and both test suites pass (40 Python, 35 JS).
