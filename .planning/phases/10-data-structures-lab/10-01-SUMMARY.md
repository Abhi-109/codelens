---
phase: 10
plan: 01
status: complete
completed_at: 2026-10-29
requirements: [DS-01, DS-02, DS-03, DS-04, DS-05, DS-06, DS-07]
---

# Phase 10 — Data Structures Lab expansion

This phase was scoped in conversation rather than through a separate PLAN.md;
this summary is the record of what shipped and what was deliberately deferred.

## What shipped

### Shared frame contract

`src/datastructures/frames.js` now owns the frame shape used by every structure:
a deep snapshot, one sentence, the eight mark kinds and optional structured
detail. Independent snapshots are why Back, Next, the slider and reset stay
exact for all seven structures; no inverse operation exists to drift.

### The six existing structures

- Array: manual resize (refused if it would drop a value) and clear.
- Linked list: singly/doubly mode, backward traversal, explicit cycle
  construction, detection and breaking.
- Stack: search that inspects downward from the top without mutating.
- Queue: circular mode (front slot, wrap-around) and a stable priority mode.
- BST: deletion of a leaf, a one-child node and a two-child node (successor),
  including the empty-tree result.
- Graph: add/remove nodes and edges, configurable start node, directed mode,
  plus the existing BFS/DFS. Removing the start node is handled rather than
  leaving a dangling highlight.

### Hash table (new)

`src/datastructures/hashTable.js` is the engine. Keys are exact, trimmed strings
(≤ 24 characters); integer-looking keys use their integer value.

- Hash functions: division, multiplication (golden-ratio fraction), polynomial
  (base 31) and first-character (deliberately poor).
- `bucketIndex()` is the single conversion from raw hash to index, so the drawn
  calculation cannot disagree with the state mutation.
- Strategies: separate chaining, linear, quadratic and double hashing. Double
  hashing uses `1 + (|raw| mod (capacity − 1))` and requires a prime capacity.
- Open addressing refuses an insert when the probe sequence repeats before
  visiting every slot, and says so; it does not jump to an unreachable slot.
- Tombstones: delete writes one, lookup walks past it, insert reuses the first
  remembered one only after reaching an empty slot (or a repeated path).
- Load factor, threshold (0.10–2.00; ≤ 0.95 for open addressing), automatic
  growth (double / next prime), manual resize and forced rehash. Maximum
  capacity 97. A resize shows the old table as a `before` strip and rehashes
  every key rather than copying indices.
- Operations: insert/update, search, contains, delete, update value, clear,
  load dataset, apply settings, resize, force rehash.
- Ten presets, including three that load the same colliding keys under linear,
  quadratic and double probing, and `deletions`, which names the linear strategy
  it needs so tombstones are actually visible.

### Page and learning extras

- `StructureView.jsx` draws hash buckets, the key → raw hash → bucket → probes
  journey, the before/after strip, a chain per bucket, tombstones, circular queue
  slots, priority badges, doubly linked pointers, cycles and a dynamic graph
  layout with arrows and a start ring.
- `DataStructureLab.jsx` gained `select` fields, an Advanced disclosure, step
  detail rows, selected-operation state and `?preset=` seeding.
- `HashTableExtras.jsx` adds predict-the-bucket (checked against the real hash),
  a collision hint from the same model, the measured four-strategy comparison
  and an expected/worst-case table.
- Eleven lessons in a new Learn section link to seeded lab datasets. Lesson
  content may now name a `lab` instead of a Python `exampleId`.
- Styles for all of the above use existing tokens and both themes, keep the
  390 px single column, and add no motion beyond the existing colour
  transitions.

### Tests and honest limits

- `hashTable.test.mjs` (25), `structures.test.mjs` (21) and the updated
  `model.test.mjs` (14) cover hashing, every strategy, tombstones, growth,
  presets, the extended operations and determinism.
- Browser checks cover the hash journey, chaining vs each prober on the same
  keys, tombstones, the resize strip, predict-the-bucket and a seeded lesson.
- Deferred and recorded on the page: Robin Hood hashing, cuckoo hashing,
  incremental rehashing, universal hashing, and a real binary heap for the
  priority queue.

## Gates

136 Python tests, 917 JS tests, lint, production build, 230 browser checks.
`check:explain` and `test:pyodide` were not re-run: no worker, tracer or
explanation-layer change.
