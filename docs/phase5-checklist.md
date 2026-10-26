# Phase 5 checklist — product quality, performance, release readiness

Working record for the release-readiness pass. Every entry below was checked
against the running app, not inferred from the code.

## Baseline (commit `4088798`)

- `git status` clean, `main` level with `origin/main`.
- Gates: 136 tracer tests, 738 JS tests, 145/145 browser checks, lint clean,
  build succeeds.
- Build: one `index-*.js` of 774.16 kB (gzip 223.49 kB) and one CSS file of
  129.63 kB, with Vite's >500 kB chunk advisory. The advisory was the only
  warning.

## Visual and usability audit

Screenshots were captured and inspected for every route at 1440, 720 and
390 px, in both themes, plus reduced motion: home, language picker, the Python
workspace with sorting, recursion, aliasing, exceptions, lists and scalars,
all six labs, Learn index and a lesson, Docs index and a page, About, and the
404 state. Executed-run states and the data-structure labs were inspected
separately.

| Finding | Where | Fix | Verified by |
| --- | --- | --- | --- |
| A successful run showed the tracer's raw status id, `completed`, in the toolbar | Python workspace toolbar | `completed: "Completed"` in `STATUS_LABELS` (`src/App.jsx`) | Browser check "a successful run reads Completed" |
| No way to skip the navigation from the keyboard | Every page | Skip link in `AppShell`, `#main` target with `tabIndex={-1}`, `.skip-link` style | Browser checks for the skip link target, focus and visibility |
| The About grid forced 320 px columns, which overflows below about 344 px | About page | `minmax(min(320px, 100%), 1fr)` | Screenshots at 390 and 720 px |
| Lab buttons and inputs were mouse-sized on phones | Six data-structure labs | 36 px minimum height below 520 px | Lab screenshots at 390 px; existing narrow-lab browser checks |
| Collapsed mobile menu links had a small touch target | Shell, below 820 px | 10 px vertical padding on the open menu's links | Phone screenshots |
| Runaway recursion rendered about a thousand call cards (9,196 DOM nodes) | Motion canvas | Call strip keeps the 24 most recent frames and says how many it left out | Unit test "a deep call stack keeps the most recent frames"; browser check for the cap and note |

The two-panel workspace, every visualization mode, the inspector tabs, both
themes and the mobile Code / Visual Animation switcher are unchanged.

## Stress checks

Each scenario was run in the real app and its state read from the DOM.

| Scenario | Observed |
| --- | --- |
| List of 0 / 1 / 3 elements | Draws no cells, one cell, three cells; no overflow |
| List of 200 elements | First 30 cells with "+170 more", scrolls inside its own row; page does not overflow |
| `a = []; a.append(a); b = a` | Renders a cycle marker (`[…]`), no recursion, no overflow |
| Recursion 50 deep | Completes; the call strip keeps the last 24 frames with an honest count |
| Runaway recursion | Ends as `Runtime error` (RecursionError), not `Completed`; strip capped |
| Caught `IndexError` | Continues to completion; the printed output includes the later lines |
| Uncaught `IndexError` | Ends as `Runtime error`; the raising frame is named |
| Invalid BST search / empty stack pop | Lab reports the failed operation and does not mutate the model |

## Performance

Before: one 774.16 kB entry script (gzip 223.49 kB), 129.63 kB CSS, and the
>500 kB advisory.

After lazy-loading only `PythonVisualizer` (the tracer client, motion planner
and canvases) on its own route:

| Asset | Size | Gzip |
| --- | --- | --- |
| `index-*.js` (landing, Learn, Docs, labs) | 341.98 kB | 107.29 kB |
| `PythonVisualizer-*.js` | 434.90 kB | 118.05 kB |
| `index-*.css` | 26.61 kB | 5.70 kB |
| `PythonVisualizer-*.css` | 103.53 kB | 17.57 kB |

The advisory is gone without raising the threshold, and the landing page no
longer downloads the execution engine. Every other page stays eager: splitting
them would add requests for no measurable gain.

## Deferred, with reasons

- **Same-route query changes do not reload the source.** Moving from
  `/visualizer/python?example=a` to `?example=b` through `history.pushState`
  keeps the mounted workspace, so the source stays as it was. No in-app link
  does this (links to the visualizer are full navigations), and changing it
  would mean re-keying the workspace on every query change. Documented rather
  than re-architected.
- **Long collections are bounded on purpose.** The canvas draws 30 cells and
  states the remainder; the trace still carries every element, and the
  Variables tab shows the recorded value.
- **The call strip shows the 24 most recent frames.** The Stack tab lists the
  whole recorded stack, which is where a deep recursion is read.

## Gates

Run on the final working tree:

| Command | Result |
| --- | --- |
| `npm run test:tracer` | 136 tests, OK |
| `npm run test:js` | 739 tests, 0 failures (one new frame-cap test) |
| `npm run lint` | clean |
| `npm run build` | succeeds; sizes in the table above; no chunk advisory |
| `npm run check:explain` | 238 steps across 10 examples, every step explained |
| `npm run test:pyodide` | all examples trace and profile correctly inside Pyodide |
| `npm run check:browser` | 162/162 checks passed, no console errors or warnings |

