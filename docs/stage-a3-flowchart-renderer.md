# Stage A3 — SVG Flowchart Renderer

**Status: not started.** Stage A2 (the Python graph builder) is done and on
`main`; this stage renders its output. A4 (execution overlay) and A5 (function
tabs, export) build directly on top of this file, so read it before those too.

## 1. Goal

Turn the graph that `tracer-poc/flowchart.py` already produces into a real
textbook flowchart, drawn as **plain SVG in React**, laid out with **dagre**,
and shown **before the learner presses Run** — generated from the code as they
type.

No animation and no trace highlighting in this stage. That is A4. A3 draws a
correct, well-laid-out chart that is already useful on its own.

## 2. What already exists (do not rebuild)

| Piece | Where | Notes |
|---|---|---|
| Graph builder | `tracer-poc/flowchart.py` | `build_flowchart(source)`, format **version 2** |
| Format contract | `docs/flowchart-format.md` | Node kinds, edge labels, `lines` ranges |
| 41 unit tests | `tracer-poc/test_flowchart_graph.py` | All 10 examples + tricky cases |
| Old tree view | `src/tracer/flow.js` | Keep — becomes the "Simple view" fallback |
| Worker plumbing | `src/tracer/pyodide.worker.js` | Loads `tracer.py` today |
| Client plumbing | `src/tracer/client.js` | `buildFlowchart()` returns the **tree** format |

Node kinds the renderer must draw: `start`, `end`, `io`, `process`,
`decision`, `loop`, `call`, `return`.

| Kind | Shape | Colour family |
|---|---|---|
| `start`, `end`, `return` | Oval (terminator) | Teal |
| `io` | Parallelogram | Copper |
| `process` | Rectangle | Blue-grey |
| `decision`, `loop` | Diamond | Yellow-amber |
| `call` | Rectangle with double side bars | Purple |

Soft filled shapes, coloured borders, rounded corners. Must stay readable in
**both** themes — use tinted fills, never flat neon.

## 3. The one blocking decision

The user's brief asks for `@dagrejs/dagre` for top-to-bottom layout, and the
project rules say **ask before adding any dependency**. So:

1. Ask first. Do not install it silently.
2. If refused, hand-roll a simple layered layout: stack nodes by depth, keep
   the main path in a straight vertical column, push `else` branches to the
   side, route back-edges around the outside. Cruder, but it ships.

Either way the renderer takes **already-positioned** nodes, so swapping the
layout engine later is a contained change.

## 4. Wiring the new format to the browser

`pyodide.worker.js` writes only `/tracer.py` and exposes two Python shims.
`flowchart.py` is standalone (it imports only `ast`, never `tracer.py`), so it
loads exactly the same way — write the file, `spec_from_file_location`, add a
shim such as `build_flowchart_graph_json`.

Add a **new** message type and a **new** client function (e.g.
`buildFlowchartGraph`). Do not repurpose the existing `flowchart` message:
`src/App.jsx` still calls `buildFlowchart()` for the current Simple view, and
that must keep working until A4 flips the default.

Distinguish the two payloads by `format_version`: **1 = tree, 2 = graph**.

Two naming traps, both already handled in the builder but easy to trip over:

- Module-level code is keyed **`<main>`** in the graph, but the trace reports
  **`<module>`**. Translate in one place (see §6).
- Chart keys are plain function names. Two same-named functions in different
  scopes get `name` and `name#2`.

## 5. Render before running

Generate the chart from the editor contents on a **~400 ms debounce**. Running
the program only adds highlighting afterwards (A4); the chart itself must be
there the moment the learner starts typing.

`buildFlowchart()` in `client.js` already caches per source string — reuse that
pattern so re-renders do not re-enter Pyodide.

## 6. `src/flowchart/mapTrace.js` — pure, tested

A small pure module (no React, no network) that answers:

- `chartFor(flow, functionName)` — the chart for a frame, translating
  `<module>` → `<main>`, falling back to `<main>` when unknown.
- `nodeForLine(chart, line)` — the node whose `lines` range contains `line`.
  This is a **single lookup**: A2 guarantees ranges never overlap within a
  chart, and `start`/`end` are `null` so they never match.

Cover it with `node --test`, in a `.test.mjs` beside it, matching the existing
`src/tracer/*.test.mjs` convention. **Baseline before this stage: 35 JS tests
and 40 Python tests** — record the new counts in the task report.

## 7. Interactions to build

- **Pan and zoom**, plus a **fit to screen** button.
- **Show code in boxes** toggle — swaps every label for its `code` field.
- **Click a node** → jump to the first step that ran it. (Purely the lookup
  from §6; wiring it to the player is A4.)

## 8. Suggested task order — one commit each

1. Ask about `@dagrejs/dagre`; install if approved.
2. Worker + client: expose `build_flowchart_graph_json` behind a new message
   type, leaving the old path untouched.
3. `src/flowchart/mapTrace.js` with tests.
4. SVG shape primitives — the five shapes as components, themed, no layout.
5. Dagre layout pass: nodes + edges + arrowheads + Yes/No labels + back-edges
   routed around the side.
6. Pan / zoom / fit-to-screen.
7. Debounced generation in the editor; "Show code in boxes" toggle.
8. Add the "Simple view" switch so the old card list is still reachable.

## 9. Acceptance checks

- `npm run test:tracer`, `npm run test:js`, `npm run lint`, `npm run build` all
  pass, every task.
- Chart is correct for all **10 example programs** and for nested loops, `elif`
  chains, `break`/`continue`, and recursion.
- Loops draw a **back-arrow that never crosses a box**. Decision arrows are
  labelled **Yes** / **No**. The main path stays a straight vertical line.
- No blank screens: empty code, syntax error, runtime error, infinite loop,
  failed Pyodide load.
- Works at **375 px, 768 px, 1440 px**, in **both themes**, and honours
  `prefers-reduced-motion`.
- Keyboard-only use reaches every control.

## 10. Do not

- Do not change `tracer-poc/flowchart.py`'s output shape without updating
  `docs/flowchart-format.md`, the version, and its 41 tests — all in one commit.
- Do not delete `src/tracer/flow.js` or its tests; migrate, don't remove.
- Do not do A4's job: no current-node glow, no trail, no branch chips, no loop
  counters. Those land in the next stage.
- Do not add a backend, accounts, tracking, or another language.
