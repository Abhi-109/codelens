# CodeLens Implementation Plan

The plan for turning CodeLens into a full product site around the working
Python visualizer. Written from a repository audit (Phase 0) done on
`main` @ `298e3a8`; every claim below was verified in the code, not assumed.

## 1. What works today

| Area | State |
|---|---|
| Python tracer (`tracer-poc/tracer.py`, 544 lines) | Records every step as JSON (trace format v2). 45-program corpus over 32 categories. |
| Browser execution | Pyodide in a Web Worker (`src/tracer/pyodide.worker.js`), `input()` supported through the values box. |
| Teaching layer | `stepView.js` (one view per step), `explain.js` (plain English for every event kind), `values.js`, `objects.js` — all pure and tested. |
| Execution graph | `src/flowchart/`: automatic layout (no dagre), per-card values, fold finished calls, zoom/fit/pan/follow. |
| Visualizer UI | `src/App.jsx`: code pane, teach card (section A), inspector B–E, trace details, Beginner/Advanced/Textbook, glossary, concept cards. |
| Responsiveness | Verified at 1366×768 and 375×667; panels fold into tabs below 1280px. |
| Tests | 95 Python + 144 JS (before this plan), oxlint, production build, CI on every push. |

## 2. What the audit found missing

- **No routing** — one screen, no deep links, no refresh-safe pages.
- **No theme control** — `prefers-color-scheme` only, no toggle, no persistence.
- **No site shell** — no navigation, footer, breadcrumbs, 404, or loading/empty/error states.
- **No landing page, language page, learn, docs or about pages.**
- **No data structure visualizer** — nothing in `src/` for it.
- **Partial visualizer modes** — variable-history chart (list only), memory arrows, call tree, timeline, step comparison are missing; output/errors, variables, call stack, flowchart and inline values exist.

## 3. Known issues (pre-existing, unchanged by this plan)

- `explain.js` does not recognise `for i, x in enumerate(xs):`, tuple swap, or `self.attr = value` as changes.
- Step 1 (`call <module>`) highlights no graph card.
- `@dagrejs/dagre` was an unused dependency (removed in this plan's first commit).

## 4. Architecture to reuse

`tracer-poc/*` and the trace contract are untouched. `src/tracer/*` and
`src/flowchart/*` stay pure and tested. The visualizer (`src/App.jsx`) keeps
its own CSS (`App.css`) and its `button`/`header` rules are now scoped under
`.app` so the shell's own chrome is unaffected. Everything new reads colour
from `src/styles/tokens.css`.

## 5. Phases

| Phase | What it delivers | Status |
|---|---|---|
| 0 | Repository audit (this document) | ✅ done |
| 1 | Design tokens, dark/light themes with toggle + persistence, app shell (nav, breadcrumbs, footer, loading/empty/error/404), hand-rolled History-API router, all ten routes resolving; `/visualizer/python` unchanged | ✅ done |
| 2 | Homepage (hero, real-trace preview) and language selection | ⬜ next |
| 3 | Python visualizer: move into the shell, split `App.jsx`, add missing modes (variable-history chart, call tree, timeline, step comparison, memory arrows) | ⬜ |
| 4a | Data structures: array, stack, queue, linked list — pure state machines + tests, three-region UI | ⬜ |
| 4b | Binary tree, heap, graph (only after 4a is approved) | ⬜ |
| 5 | Learn lessons, docs pages, about | ⬜ |
| 6 | Integration QA: all checks, both themes × three sizes, keyboard/a11y, README/roadmap sync | ⬜ |

Each phase stops for review before the next begins.

## 6. Decisions already made

- **Router:** hand-rolled History-API router (`src/router.js` + `router.jsx`), no new dependency. Matching is pure and tested (`src/router.test.mjs`, 18 cases).
- **Dependencies:** none added. `@dagrejs/dagre` removed. The editor stays a custom textarea (line numbers, current-line highlight and inline values already work).
- **Theme:** `data-theme` on `<html>`, set before first paint by an inline boot script in `index.html`, then kept in step by `src/theme.js`. Stored under `codelens-theme`; falls back to the OS preference, then light.
- **Deep links:** History API; `vite dev` and `vite preview` serve the SPA fallback. A static host (e.g. GitHub Pages) would need a `404.html` rewrite.

## 7. Risks

- **Pyodide on the homepage** is a heavy download; the Phase 2 preview lazy-loads the engine and shows a loading state rather than a fake trace.
- **`App.jsx` is 1,242 lines**; Phase 3 splits it into components and hooks, which is the largest refactor in the plan and must keep every existing test green.
- **Theme conversion of `App.css`** changed how the playground looks in both themes; screenshots at three sizes were taken to catch regressions.
- **Placeholder pages** (learn, docs, data structures) are honest about not working yet; they must be replaced, not forgotten.
