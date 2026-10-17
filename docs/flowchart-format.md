# CodeLens Flowchart Format (version 2)

## 1. Overview

CodeLens turns Python source into a flowchart **statically**, with Python's own
`ast` module — no code is executed. The result is a graph of flat nodes with
labelled edges, shaped so an SVG renderer can draw textbook flowcharts directly.

The builder that produces this format lives in `tracer-poc/flowchart.py`:

```python
from flowchart import build_flowchart

flow = build_flowchart(source)
```

It is a **sibling** of `tracer.py`, which already had its own `build_flowchart`
returning an older *tree* summary (`statement` / `branch` / `loop` nodes keyed
`<module>`), still used by `src/tracer/flow.js` and the current UI. The two are
told apart by `format_version`: **1 = tree, 2 = graph**.

## 2. Top-Level JSON Structure

| Field | Type | Description |
|---|---|---|
| `format_version` | Integer | Always `2` for this version of the format |
| `functions` | Object | One chart per function, keyed by function name; `<main>` holds module-level code |
| `error` | Object or null | `{type, message, line}`, present when the source does not parse |

On a syntax error, `functions` is empty and `error` describes the problem. The
caller never has to catch an exception.

## 3. Chart Structure

| Field | Type | Description |
|---|---|---|
| `name` | String | The chart's key — same as its entry in `functions` |
| `params` | Array | Parameter names, `[]` for `<main>` |
| `entry` | String | Id of the `start` node |
| `exit` | String | Id of the `end` node |
| `nodes` | Array | Nodes in source order (start, end, then the program) |
| `edges` | Array | Connections between nodes |

## 4. Nodes

| Field | Type | Description |
|---|---|---|
| `id` | String | Unique within the chart (`n1`, `n2`, …) |
| `kind` | String | One of the eight kinds below |
| `label` | String | Short plain-English text shown in the shape |
| `code` | String | The actual Python, for the "Show code in boxes" toggle |
| `lines` | Array or null | `[start, end]` source lines this node maps to; `null` for `start`/ `end` |

Optional fields, present only when relevant:

| Field | On | Description |
|---|---|---|
| `test` | `decision`, `loop` | The condition (or iterable) source, e.g. `n <= 1` — used to build branch chips |
| `loop` | `loop` | `"for"` or `"while"` |
| `defines` | `process` | Chart key of the function/class this box defines |
| `calls` | `call`, `return` | Chart key of the function this box calls, when the program defines it |

### Node kinds

| Kind | Shape | Colour | Drawn for |
|---|---|---|---|
| `start` | Oval (terminator) | Teal | Program / function entry |
| `end` | Oval (terminator) | Teal | Program / function exit |
| `io` | Parallelogram | Copper | `input()`, `print()`, and assignments that read input |
| `process` | Rectangle | Blue-grey | Assignments, calculations, `define` boxes, `break`, `continue`, `with`, `try` |
| `decision` | Diamond | Yellow-amber | An `if` / `elif` condition |
| `loop` | Diamond | Yellow-amber | A `while` or `for` header |
| `call` | Rectangle with double side bars | Purple | A call to a function the program defines |
| `return` | Oval | Teal | A `return` statement |

Labels are plain English by design: `Make total = 0`, `Show the result`,
`Ask "Who?" and make name`, `Is n ≤ 1?`, `Any items left in nums?`,
`Return 5`, `Leave the loop`, `Define fact(n)`.

## 5. Edges

| Field | Type | Description |
|---|---|---|
| `from` | String | Source node id |
| `to` | String | Target node id |
| `label` | String or null | `"Yes"`, `"No"`, or `null` |
| `back` | Boolean | `true` for an arrow that loops back to its diamond |

`Yes` / `No` appear **only** on edges leaving a `decision` or `loop` diamond. A
`for…else` / `while…else` puts the `else` body on the diamond's `No` edge; a
`break` bypasses it.

## 6. Mapping the trace to the chart

Every node except `start` / `end` carries a `lines` range, and within one chart
those ranges never overlap, so *"which node is on line N"* is a single lookup.
`lines` is `null` for `start` / `end` because no line event ever lands there.

The range is the statement's **header only** — never its body. A compound
statement spanning several header lines (a long condition) owns all of them; a
one-liner such as `if x: y = 2` is folded into a single node so the line still
maps to exactly one node.

`tracer.py`'s trace reports module-level code as `<module>`; this format keys it
as `<main>`. The translation belongs in `src/flowchart/mapTrace.js`.

## 7. Known limitations

These are deliberate, and each is documented where it is implemented:

- Decorators are drawn as part of the function's `define` box rather than as
  their own nodes.
- `match` statements become one `process` box covering the whole block; their
  bodies are not expanded.
- `try` / `except` / `finally` use "diamond-free branches": the `Try` box
  branches straight to each handler, with no error diamond.
- Two functions with the same name in different scopes get chart keys `name` and
  `name#2`. The trace reports both as `name`, so mapping by line is needed to
  tell them apart.
