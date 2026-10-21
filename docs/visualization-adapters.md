# Visualization adapters and scenes

A visualization adapter turns one selected step into a renderer-independent
scene. Recognition decides **which algorithm the evidence supports**; an adapter
decides **how to represent this step**; React decides how to draw the scene.
Those three jobs stay separate.

The registry ships the generic, recursion, searching and sorting adapters. The
workspace's Adaptive canvas uses recognition to pick one, offers every adapter
whose availability check passes, and keeps the existing Call tree, Control
flow, Combined and Timeline canvases reachable.

## Files

| File | Responsibility |
|---|---|
| `src/tracer/adapters.js` | Immutable registry, availability checks, validated builds, generic fallback |
| `src/tracer/scene.js` | Scene schema constants and the pure validator |
| `src/tracer/genericAdapter.js` | Always-available adapter built from the canonical StepView |
| `src/tracer/statementStage.js` | Validated assignment/condition/loop/call stage for ordinary steps |
| `src/tracer/recursionAdapter.js` | Invocation-tree scene from real frames, calls and returns |
| `src/tracer/sequenceScene.js` | Shared sequence/variable/highlight scene pieces for search and sort |
| `src/tracer/searchingAdapter.js` | Linear and binary search scenes from real sequences and bounds |
| `src/tracer/sortingAdapter.js` | Exchange, selection, insertion and divide-and-conquer list scenes |
| `src/tracer/scene.test.mjs` | Valid/invalid/partial/truncated scene tests |
| `src/tracer/adapters.test.mjs` | Registry, capability, fallback and corpus-wide tests |
| `src/tracer/recursionAdapter.test.mjs` | Direct/mutual recursion, composite, exceptional, truncated and forged-invocation tests |
| `src/tracer/searchingAdapter.test.mjs` | Hits, misses, duplicates, empty/tuple/mixed/truncated search data |
| `src/tracer/sortingAdapter.test.mjs` | Four sort families, edge inputs, aliases, truncation and built-in fallback |
| `src/visualizer/adaptive.js` | Adapter choices, Auto resolution, availability, validated registry build (pure) |
| `src/visualizer/AdaptiveView.jsx` | Auto/manual chooser, availability and fallback UI, empty states |
| `src/visualizer/SceneView.jsx` | Renders one validated scene: source, variables, stack, heap, sequence, invocations |
| `src/visualizer/runGate.js` | Rejects async results that a newer run or an edited source superseded |
| `src/visualizer/adaptive.test.mjs` | Auto/manual selection, composite capabilities, fallback, empty and determinism tests |

## Adapter contract

An adapter is a plain object:

```js
{
  id: "generic",
  label: "Generic step view",
  description: "...",
  capabilities: ["generic"],

  // { available: boolean, reason: string|null }
  availability(context) {},

  // A serializable scene object. The registry validates it before returning it.
  build(context) {},
}
```

`capabilities` is an array, not a mutually exclusive category. A composite
adapter can declare `["sorting", "recursion"]` and appear in both
`registry.byCapability("sorting")` and `registry.byCapability("recursion")`.

The adapter context is supplied by the caller:

```js
{
  stepView,      // canonical getStepView(trace, index, source, ...)
  trace,         // the original trace array
  traceIndex,    // getTraceIndex(trace)
  source,        // the submitted source text
  profile,       // normalized program profile
  recognition,   // { adapterId, confidence, evidence, unavailableReason }
  result,        // run result, including result.status
  requestedAdapterId,
}
```

Adapters may read only these inputs. They may not import React, mutate the
trace, or perform recognition themselves. Scene generation is deterministic for
the same inputs.

## Registry

```js
import { DEFAULT_REGISTRY, createAdapterRegistry } from "./src/tracer/adapters.js";

DEFAULT_REGISTRY.ids();                    // ["generic", "recursion", "searching", "sorting"]
DEFAULT_REGISTRY.get("sorting");           // the sorting adapter
DEFAULT_REGISTRY.byCapability("sorting");  // adapters declaring that capability
DEFAULT_REGISTRY.matching(["recursion", "sorting"]);
DEFAULT_REGISTRY.build("sorting", context);
```

`createAdapterRegistry(adapters)`:

- validates every adapter at construction, including duplicate IDs;
- always includes the generic adapter;
- returns frozen, sorted lists (`ids()`, `list()`, `byCapability()`, `matching()`);
- never changes a request into a different scene silently.

`build(requestedAdapterId, context)` returns:

```js
{
  scene,
  adapterId,            // the adapter that actually built the scene
  requestedAdapterId,   // what the caller asked for
  fallbackReason,       // null, or why the request was not used
  validation,           // { valid, errors, scene }
}
```

Fallback order:

1. Unknown ID, unavailable adapter, throwing builder, or invalid scene ->
   generic adapter.
2. Generic scene invalid -> minimal safe unsupported scene with no references.
3. `fallbackReason` always explains the first reason.

A specialized adapter therefore cannot bypass validation: its scene is checked
before it can reach a renderer.

## Scene model

The scene is plain JSON-compatible data:

```js
{
  version: 1,
  kind: "visualization_scene",
  adapterId: "generic",
  status: "ok" | "partial" | "unsupported",
  title: "Generic step view",
  subtitle: "linear_search · line 3",
  capabilities: ["generic"],

  sourceLine: { line: 3, text: "if values[i] == target:", indent: 4 } | null,
  focus: { kind: "line", line: 3 } | null,
  highlights: [{ kind: "change", id: "i", line: 3, tone: "changed" }],

  regions: [
    {
      id: "variables",
      kind: "source" | "variables" | "stack" | "memory" | "changes" | "output" | "context" | "algorithm",
      label: "Variables in linear_search",
      items: [/* items */],
    },
  ],

  changes: [/* actual StepView changes */],
  // Optional and currently generic-only: the validated statement stage that
  // SceneView renders as the primary surface.
  stage: null | { kind: "branch" | "loop" | "assignment" | "print" | "output" | "input" | "call" | "return" | "error" | "step", /* ... */ },
  accessibility: { label: "...", summary: "..." },
  evidence: [{ source: "adapter" | "profile" | "trace" | "recognition", kind: "...", detail: "..." }],
  unsupportedReason: null | "...",
  meta: {
    stepIndex: 3,
    eventKind: "line",
    function: "linear_search",
    frameId: 2,
    truncated: false,
    requestedAdapterId: "generic",
    recognition: { adapterId: "generic", confidence: 0, unavailableReason: "..." } | null,

    // Invocation-tree adapters only. All four are required together.
    invocationCount: 5,
    shownInvocations: 5,
    omittedInvocations: 0,
    invocationLimit: 200,
  },
}
```

### Items

| Item | Required references / fields |
|---|---|
| `line` | `line`, `text`, `indent`; all must match the submitted source |
| `event` | selected `index`, `eventKind`, `line`, `function`, optional `frameId` |
| `variable` | current `frameId`, `name`, displayed `text`, `valueType`, optional `refId` |
| `frame` | `frameId`; current-state fields or `historical: true` |
| `invocation` | real `frameId`, `parentFrameId`, function, depth, call line, first/return/unwind indices, return value, outcome, exception, captured args, active/current/historical flags, base case and hidden-child count |
| `object` | `objectId` in selected heap or declared historical object |
| `slot` | `objectId` plus `index` (list/tuple) or `slotKey`; displayed `text` |
| `change` | exact `name`, `changeKind`, `from`, `to`, `line` from the StepView |
| `output` | accumulated output text at the selected step |
| `context` | one of `function`, `event`, `step`, `status`, `recognition`, `return value`, `printed`, `selection` |

`focus` and each highlight use one of the reference kinds `line`, `frame`,
`object`, `slot`, `change`, `event`, `output`. A historical reference must set
`historical: true` and must exist in the trace (or in an explicitly supplied
historical heap for an object).

## Validation invariants

`validateScene(scene, context)` is pure and never throws. It returns
`{ valid, errors, scene }`. It enforces:

- scene version, kind, status, title, capabilities and root fields;
- an optional generic `stage` is rebuilt from the same StepView, source and trace
  and must match field by field, so a branch, value, item or destination cannot
  be invented;
- every source line exists and line text/indent matches the source;
- every frame exists in the selected state, or is explicitly historical and
  exists in the trace index;
- every invocation frame exists in the trace, its function/depth/call line and
  first/return/unwind indices match the index, and its parent is the recorded
  parent or an omitted non-family caller;
- invocation arguments are re-read from the first captured frame, return values
  from the actual return event, and exception details only from the exception
  immediately before that frame's `unwind`; active/current/historical flags and
  outcomes are re-derived from the selected stack and event index;
- a base case must already have returned normally, have no represented children
  and have no hidden children;
- invocation counts must add up, `shownInvocations` must equal the rendered
  invocation items, and omitted nodes force a partial, truncated scene;
- every object exists in the selected heap, or is explicitly historical and
  declared with contents;
- every list/tuple index is in range;
- every displayed variable, slot, change, output, context value and event field
  is re-derived from the StepView, heap, trace index or selected event;
- object labels match the names the heap gives them;
- unknown fields, region kinds, item kinds, references, evidence sources and
  context names fail validation;
- `ok` scenes have no unsupported reason; `partial`/`unsupported` scenes must
  explain why.

The validator does not guess. If a value or reference cannot be checked, the
scene is invalid.

## Generic adapter

The generic adapter is always available, including when the trace is empty.
It exposes:

- the current source line;
- the selected frame's variables and argument flags;
- the call stack with depth, status and call line;
- every heap object and its slots, with real reference IDs;
- what the program had printed at this step;
- the event, function, step number, run status, selection state, recognition
  result and return/printed values where present;
- changes and highlights from the StepView;
- accessibility label and summary.

If the run ended at a step/timeout/output limit, the selected call returned, a
container was truncated, a referenced object is missing from the snapshot, or
the source line is unavailable, the scene is `partial` with a concrete reason.
If there is no selected execution step, it is `unsupported`. It never invents a
replacement state.

No adapter is selected by the visualizer yet. Existing Call Tree, Control Flow,
Combined, Timeline and comparison views are unchanged.

## Recursion adapter

The recursion adapter is available only when both static and runtime evidence
exist:

- the profile names a direct or mutual recursion family;
- the real call tree contains a nested call between frames from that family;
- some function in that family reappears in its own actual ancestry, so a real
  direct or mutual cycle exists. One candidate calling another one-way is still
  an ordinary chain.

An ordinary `first -> second -> third` chain has no such cycle, so the registry
falls back to generic with that reason. Helpers called by a recursive function
are not part of the invocation tree; only the family's real frames are.

The scene represents the whole run, like the existing Call Tree:

- one `invocation` item per real frame, with the captured arguments and function;
- `parentFrameId` is the immediate parent the stack recorded when the frame first
  appeared, or `null` for a family root;
- `returnValue` is only the matching `return` event's value; an `unwind` frame
  has `outcome: "raised"`, the exception that caused that unwind, and no return
  value. A caught exception that later returns normally leaves the exception
  fields null;
- `outcome` is one of `future`, `running`, `waiting`, `returned`, `raised` or
  `unfinished`, derived from the selected step;
- `baseCase` marks a leaf invocation that already returned normally at the
  selected step; it is runtime evidence, not a static branch guess;
- active family frames are `active`, the running frame is `current`, and the
  scene focus/highlights follow the selected stack's active recursive path.

The tree is selected breadth-first and capped at the same 200 nodes the Call
Tree layout uses. The scene reports `invocationCount`, `shownInvocations`,
`omittedInvocations` and `invocationLimit`, plus per-node `hiddenChildren`. When
nodes are omitted the status is `partial`, `truncated` is true, and
`unsupportedReason` states the exact count and limit. The represented portion is
deterministic: roots and children are ordered by their trace start index.

Limits, timeouts, unfinished invocations, a lost selected call or a missing
source line also make the scene partial. A missing profile, empty trace, syntax
error or no recursive edge makes the adapter unavailable, so the registry uses
the generic scene. A direct call to `build()` in that state returns a valid
unsupported scene instead.

Merge sort demonstrates composite evidence: recognition reports `sorting`
because its sorting evidence wins priority, while the recursion adapter still
builds a valid `merge_sort` invocation tree from the profile and trace. Both
requests validate independently.

## Searching adapter

The searching adapter is available only when the profile has a search-shaped
comparison and the trace supplies the rest:

- an equality comparison reads `sequence[index]` or an iterated item and compares
  it with a candidate target in a loop or recursive function;
- a frame actually holds a list or tuple under the compared name, and the target
  exists as a recorded argument or variable;
- binary search additionally needs a second comparison between two named numeric
  bounds, and a recorded line where both bounds are numbers.

The scene is built from the selected `StepView`:

- the primary region is the real list or tuple object, with `slot` items for the
  indices the snapshot contains;
- the target, current index, and binary `low`/`high`/`mid` appear only when they
  are real variables in the selected frame;
- the compared slot is a `focus` highlight; a binary search range is a `muted`
  highlight and the midpoint is a stronger focus;
- a recorded return value or membership result supplies `found at index N`,
  `not found`, or `found` without an index. Nothing is inferred from the final
  list looking sorted or from a variable name;
- an item-style `for item in values` search never invents an index. If the item
  occurs more than once, the scene is `partial` and says the index is unproven;
- a missing return event leaves the outcome open instead of guessing;
- a `break`/flag search, a helper call, or `enumerate` iteration may stay
  `generic` when the profile has no in-loop return or indexed comparison. That is
  an explicit fallback, not a guessed index. A `while` loop with an in-loop return
  is supported and uses the same runtime rules.

First, middle, last, missing, duplicate, empty, tuple and boundary targets all
use the same rules. Mixed value types and truncated snapshots are
`partial` with an exact reason. Dictionary/count-style containers are not a
sequence search and fall back to generic.

Empty sequences are representable when the adapter is requested directly. The
recognition layer may still answer `generic` for an empty or no-change trace
because its runtime rule requires repeated comparisons with a changing index.

## Sorting adapter

The sorting adapter is available only when both kinds of evidence exist:

- the profile contains an ordering comparison on list elements and a list
  mutation in the same function, so a read-only scan is not a sort;
- the trace proves the compared name really holds a list at runtime. The static
  mutation may never execute, which is how an already-sorted run stays
  representable.

The supported shapes are classified from that evidence:

- **Exchange sort** - adjacent comparisons and swaps of adjacent slots;
- **Selection sort** - a scanning comparison, a tracked smallest index, and a
  recorded swap;
- **Insertion sort** - a key plus shifts/writes inside the list;
- **divide-and-conquer sort** - recursive splitting and a combine result built by
  appends, with the recorded left and right runs.

The adapter tracks the runtime list object, not a suggestive variable name. It
uses the selected frame's list, variables and `StepView.changes`; aliases are
labelled with every name the heap records. Comparisons, swaps, shifts, writes
and combines are shown only where the trace recorded them.

A nondecreasing prefix after selection/insertion, or a nondecreasing suffix after
exchange sort, may be marked as a recorded prefix/suffix. That is a statement
about the checked range, not a claim that the whole list is sorted. The
divide-and-conquer scene shows the combine `result` and the recorded left/right
inputs, and calls it a recorded combined prefix for the same reason. A base-case
return is just the returned sublist, never a completed combine.

Empty, single-element, already-sorted, reverse-sorted, negative, duplicate,
aliased and truncated inputs are covered by real fixtures. Mixed types are
`partial`; a truncated snapshot reports the missing count and draws no hidden
slots. `sorted()`, `list.sort()` and other built-ins are not traced internals, so
they fall back to generic rather than showing invented comparisons. Empty and
single-element runs may likewise be recognized as `generic` while remaining
buildable when requested explicitly.

## Known limits

- Auto follows recognition, which requires runtime evidence, so an empty or
  no-change search/sort trace can stay `generic`. The adapters can still build
  an explicit scene for those steps, and the manual chooser offers them whenever
  their own availability check passes.
- Availability is evaluated at the selected step. A manual adapter that is not
  supported there falls back to the validated generic scene and states the
  adapter's own reason instead of drawing a guessed scene.
- Detection covers the comparison and mutation shapes the profile records:
  simple names, indexed reads and common loop/bounds patterns. Unfamiliar helper,
  flag or control-flow shapes may stay generic; the adapters never recover a
  missing value by static guesswork.
- The recursion tree represents the whole run, so a future call and its recorded
  return can be visible before the selected step reaches them. `outcome` and the
  active flags say what is happening at the selected step; a renderer should not
  treat future nodes as already executed.
- The invocation family comes from the normalized profile plus actual nested
  frames. A missing or unusable profile makes recursion unavailable rather than
  guessing the family from function names alone.
- A base case is a runtime leaf that returned normally. A recursive function
  whose static base-case branch did not run produces no base-case marker.
- Historical objects need an explicit `historicalObjectIds` and
  `historicalHeap` in the validator context. The generic adapter never needs
  them because it represents the selected state. Recursion invocation frames
  are validated against the trace index instead.
- The validator is intentionally strict about unknown fields. The invocation
  item and the four invocation count fields were added for recursion because a
  `frame` item cannot express parent edges, returns, exceptions, base cases or
  omitted nodes. Future adapters must document any further extension.
- The generic scene includes the whole selected heap, and the recursion scene
  can include up to 200 invocation nodes, so very large runs produce large
  scenes. Pagination and per-node expansion are renderer concerns for a later
  phase.
- No adapter selection is wired to the execution session. The UI continues to
  use its existing layouts.
