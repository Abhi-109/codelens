# Phase 11B: Motion Visual Quality Audit

Read-only audit of the unified Motion canvas as of `1374db1` (Phase 11A complete).
No implementation files were changed to produce this document.

## 1. Sorting comparisons, swaps, shifts and array movement

### Current implementation
- `src/visualizer/motion/plan.js` builds a stable cell model from the recorded list
  (keyed by position, never by guessed identity) and verified actions
  (`highlight`, `move`, `value`, `enter`, `exit`).
- `src/visualizer/motion/view.js` derives ghosts, changed/highlighted flags and the
  `comparisonOf` sentence from the plan only.
- `src/visualizer/motion/MotionStage.jsx` renders cells with a blue comparison ring,
  a move transform from `choreography.moveKeyframes`, settled green positions, and
  a one-line operation explanation.
- `finality.js` marks cells as settled only when the final recorded array is
  nondecreasing and the run ended cleanly with a real in-place rearrangement.
- Browser checks (`tools/browser-check/run.mjs`) cover bubble sort comparisons,
  swaps, interruption at 1x and 4x, Back/seek, persistent green, themes, reduced
  motion, short and long arrays, and the compact-frame visibility added in 11A.

### What works correctly
- Cells keep stable positional keys, so a swap animates values between the same
  cells rather than inventing a move.
- Comparisons show two ringed operands and a sentence naming the operands.
- Swap cells bow to opposite sides so they pass each other.
- Settled positions turn green only when the trace proves a sorted outcome.
- Interruption and seek are handled by replaying the measured element position.

### Confirmed problems
- Settled green is all-or-nothing per step; there is no progressive "sorted
  prefix/suffix" region while the sort is still running.
- Insertion-sort shifting is animated as a value change on the moving cell, but
  there is no visual distinction between a swap and a shift in the ring/label.
- Long arrays scroll horizontally; the visible window shows roughly four to six
  cells on a phone, and there is no scroll hint or affordance.
- Comparison sentences are one line and can overflow narrow viewports (ellipsis).

### Missing capabilities
- A settled-region indicator that grows with proven progress (if the trace
  supports it) rather than only at the end.
- Distinct iconography for compare vs swap vs shift.
- A compact summary of off-screen cells for very long arrays.

### Relevant files
`plan.js`, `view.js`, `MotionStage.jsx`, `motion.css`, `finality.js`,
`choreography.js`, `tools/browser-check/run.mjs`.

### Existing test coverage
- `view.test.mjs` (55 tests) covers cell keys, swap mapping, insert/pop shapes,
  duplicate values, empty sequences, forward/backward/seek agreement.
- Browser checks: 250/250 including `swap-7`, `compare-5`, `final`, `long-array`,
  `narrow`, `light`, `reduced`.

### Recommended changes
- Keep the positional key model; add a per-cell "settled since" flag derived only
  from the recorded finality evidence, never from order heuristics.
- Add a small operation-kind badge on the explanation line (Compare / Swap /
  Shift) driven by the plan's verified action, not the algorithm name.
- Add a horizontal scroll affordance (fade edges) for overflowing cell rows.

### Risk of regression
- Any change to cell identity risks breaking the FLIP interruption tests.
- Settled logic is deliberately conservative; loosening it could claim sorted
  regions the trace does not prove.

---

## 2. Recursion calls, frames, returns and unwinding

### Current implementation
- `plan.js` records frames keyed by `frame_id`, with `depth`, `call_line`,
  `variables`, `current`, and `returned`.
- `view.js` (`frameView`) assigns `state`: `returning` when the plan's recorded
  return belongs to this frame, otherwise `active` if `frame.current`, else
  `waiting`. `entering` and `highlighted` come from verified flags.
- `MotionStage.jsx` renders a vertical stack, newest first, with a state rail,
  state badge, depth, running/calling line, locals, and a return row. Compact
  frames are used when a single module frame sits above a collection.
- `MAX_VISIBLE_FRAMES = 8`; the rest are counted in `.motion-frames-more`.

### What works correctly
- The active frame leads the stack, so deep recursion stays visible without
  scrolling.
- Returning frames carry the recorded return value.
- Waiting parents are visually de-emphasised but legible.
- Frame values are clamped and the frame clips, preventing overlap.
- Reduced motion is covered.

### Confirmed problems
- There is no explicit "completed" state: a frame that has returned and left the
  stack disappears immediately rather than lingering briefly as completed.
- Return values are shown only while the frame is still on the stack; once it
  unwinds, the returned value is visible only through the Return tile / output.
- Deep stacks beyond 8 frames are counted but not browsable from the canvas
  (Inspector only), which is acceptable but not discoverable.

### Missing capabilities
- A short-lived completed marker on the frame that just returned, driven by the
  recorded return event rather than a timer guess.
- A return-value trail from the child to the parent's local that received it.

### Relevant files
`plan.js`, `view.js`, `MotionStage.jsx`, `motion.css`, `tools/browser-check/run.mjs`.

### Existing test coverage
- `view.test.mjs`: frame states (active/waiting/returning), deep-stack
  truncation, single active frame, recursion variables.
- Browser: `recursion-stack` screenshot and checks for exactly one active frame,
  active leading, inside canvas.

### Recommended changes
- Add a `completed` state only when the plan already marks the frame as having
  returned and removed; keep it to one step (the recorded return event) so it is
  never invented.
- Keep the 8-frame cap; optionally add a "show all" toggle that is just a
  scroll, no new data.

### Risk of regression
- Frame state priority must remain `returning > active > waiting`; adding
  `completed` must not steal the active flag.
- Any lingering frame must still be keyed by `frame_id` so ghosts do not collide.

---

## 3. Binary tree layout, insertion, searching and traversal

### Current implementation
- `view.js` `structureOf` classifies opaque objects as a tree when one root has
  at most two children, no cycle, and all nodes are reachable.
- Nodes are placed in BFS levels; each node names its recorded edge role
  (`left`/`right` or `child N`).
- `MotionStage.jsx` renders levels as centred rows with a quiet rule between
  levels; active nodes get an accent ring.
- Adjacent lists are treated as edges and reported as auxiliary.

### What works correctly
- Positions are stable between steps (a node only joins its own depth row).
- Left and right children stay on their own columns.
- Edge names come from recorded attribute names.
- Cycle or wider fan-out falls back to the graph classification instead of
  pretending to be a tree.

### Confirmed problems
- There are no drawn edges: only a small centred rule between levels and the
  edge name on the node. A learner cannot see which parent a child belongs to
  when a level has more than two nodes.
- Node spacing is fixed (`gap: 8px`) and nodes have `min-width: 72px`; deep
  trees with many siblings overflow horizontally instead of scaling spacing.
- Insertion/search/traversal animations are limited to the active ring; there is
  no path highlight along parent-to-child edges.

### Missing capabilities
- Real parent-child connectors (SVG or CSS) derived from the recorded edges.
- Horizontal scroll or auto-scale for wide levels.
- A visited/pending marker distinct from active.

### Relevant files
`view.js` (`structureOf`, `breadthFirst`), `MotionStage.jsx` (`Structure`,
`StructureNode`), `motion.css` (`.motion-level`, `.motion-node`).

### Existing test coverage
- `view.test.mjs`: tree classification, level placement, roles.
- Browser: `tree` screenshot and checks for >=2 levels and values `5,3,8`.

### Recommended changes
- Add an SVG overlay of connectors between each node and its recorded children,
  measured from the rendered node rects (same approach as cell FLIP). This is
  choreography only, no new data.
- Add a horizontal scroll container around wide levels with a fade affordance.
- Reuse the existing active ring; add a `visited` class only when the trace
  records an attribute change or active ref on that node.

### Risk of regression
- Measuring node rects across renders must be invalidated on plan change, like
  the existing `motionController`.
- Connectors must not invent edges; every line must correspond to an entry in
  `structure.levels`/recorded outgoing edges.

---

## 4. Graph layout, edges, BFS and DFS progression

### Current implementation
- `structureOf` classifies as graph when max out-degree > 2, max in-degree > 1,
  more than one root, a cycle, or not all nodes reachable from one root.
- Graph uses BFS levels from the roots; nodes not reached are reported in the
  structure note.
- `MotionStage.jsx` renders the same level rows; node links show `-> B . C`
  (destination values).
- Browser check uses a 3-node cycle with adjacency lists.

### What works correctly
- Cycles are detected and the graph does not pretend to be a tree.
- Adjacency lists are followed one hop and reported as auxiliary, so the list
  card is not duplicated.
- Node links name destination values instead of verbose reprs.
- Active node gets an accent ring from recorded refs/changes.

### Confirmed problems
- There are no drawn edges in the graph view either; only text links on nodes.
- BFS/DFS queue or stack progression is not visualised even when the trace
  contains the relevant list attribute.
- Visited/active/pending states are not distinguished (only active is styled).
- Disconnected nodes are counted but not clearly grouped.

### Missing capabilities
- SVG connectors for recorded edges.
- A small queue/stack strip showing the frontier when a recorded list drives it.
- Visited styling derived from recorded active refs over time (requires tracking
  which nodes have been active, which the plan already exposes per step; a
  cumulative view would need history, which the cursor already provides by
  seeking).

### Relevant files
`view.js` (`structureOf`, `hasCycle`, `breadthFirst`), `MotionStage.jsx`,
`motion.css`.

### Existing test coverage
- `view.test.mjs`: graph classification for a cycle, adjacency-list graph.
- Browser: `graph` screenshot and 3-node check.

### Recommended changes
- Add connectors as in the tree case.
- Derive a frontier list only from a recorded list attribute that the current
  node points at; never synthesise a queue.
- Add `visited` styling when a node has been active in a prior step within the
  same run (computable from `plan.index` by replaying; keep it cheap by caching).

### Risk of regression
- Cumulative visited state must be derived from the trace, not from animation
  timing, to stay seek-correct.
- Connectors must handle cycles without overlapping the whole canvas.

---

## 5. Generic Python visualization

### Current implementation
- `view.js` builds scalar tiles from the current frame's primitive variables,
  with `old -> new` transitions from the previous snapshot.
- Objects (lists, dicts, sets, class instances) render as cards with cells/entries.
- Frames render as a vertical stack with state, depth, line, locals.
- Empty/no-change steps show an intro or an honest short note with the line.
- Output, last return and ending render at the bottom.

### What works correctly
- Scalar-only programs show their values as tiles; collections keep cards.
- A changed scalar shows its recorded previous value.
- Position 0 introduces the run instead of a blank canvas.
- No-change steps name their line and say so.
- Output and exceptions are shown from the trace.

### Confirmed problems
- When a collection is present, scalar tiles are hidden entirely, so loop
  counters and small scalars next to a list are only visible inside the frame
  (which is compacted to one line and may clip them).
- Conditions and branches are not visually distinguished beyond the line text;
  there is no branch indicator.
- Loop progression is shown only through the line number and the changing
  counter; there is no loop ribbon in Motion (the adaptive view has one).
- Exceptions stop the run but the failing line is not visually emphasised beyond
  the error tile.

### Missing capabilities
- A compact "current locals" strip that survives even when a collection is on
  screen, without duplicating the collection.
- A branch indicator and loop counter driven by the recorded line/state.
- Stronger emphasis on the exception line.

### Relevant files
`view.js`, `MotionStage.jsx`, `motion.css`, `src/visualizer/labels.js`,
`src/visualizer/SceneView.jsx` (reference for loop ribbon).

### Existing test coverage
- `view.test.mjs`: scalar tiles, changed scalar, intro, frame states, shapes.
- Browser: `scalars`, `greet-final`, `greet-mobile`, `caught-exception`,
  `runaway-recursion`.

### Recommended changes
- Promote the most-changed scalar (or the loop counter) into a small persistent
  strip above the collection instead of hiding all scalars.
- Reuse the existing `loopContext` evidence from the trace if present; do not
  recompute loops in Motion.
- Add an error-state style to the stage head when `view.ending.id === "error"`.

### Risk of regression
- The frame compaction rule must not hide locals that are the only data on screen.
- Loop/branch evidence must come from the trace, not from source parsing in Motion.

---

## 6. Animation synchronization with the shared cursor

### Current implementation
- `App.jsx` computes `motionPlan = planMotion(trace, index, ...)` unconditionally
  and renders `<MotionStage plan={motionPlan} .../>`.
- `MotionStage.jsx` uses a `motionController` keyed on plan identity; ghosts are
  kept for `EXIT_MS` and hidden when the ghost node leaves the map.
- `playback.js` owns speed and stepping; the cursor is shared with all views.
- Reduced motion zeroes durations and hides ghosts.

### What works correctly
- One source of truth: the view is a pure function of one cursor position.
- Interruption continues from the measured element position (FLIP).
- Seeks replay forward/backward actions.
- Speed changes durations, not positions.

### Confirmed problems
- Ghosts are kept for a fixed 180 ms regardless of speed; at 4x a ghost can
  outlive the next step's start, causing a brief overlap.
- The controller invalidates on plan change, but a rapid seek can leave a ghost
  whose target key no longer exists; it is hidden, but the hide is async.
- No explicit "step in progress" affordance beyond the animated transform.

### Missing capabilities
- Speed-scaled ghost lifetime.
- A synchronous ghost cleanup on seek.

### Relevant files
`App.jsx`, `MotionStage.jsx`, `plan.js`, `playback.js`, `choreography.js`.

### Existing test coverage
- Browser: interruption at 1x and 4x, mid-move Back and slider seeks, burst of
  steps, reduced motion.

### Recommended changes
- Scale `EXIT_MS` by `1 / speed` with a floor, or skip ghosts entirely when
  reduced motion.
- On seek, clear ghosts synchronously before measuring.

### Risk of regression
- Ghost cleanup must not remove elements that are still animating a legitimate
  exit; keying by `(kind, key)` must remain unique.

---

## 7. Empty states, responsive behaviour, overflow and performance

### Current implementation
- `.motion-stage` is a flex column with `overflow: auto`, token-only styling.
- Empty/no-change steps show an intro or honest note.
- Mobile breakpoints at 720 px and 480 px; reduced-motion block.
- Long arrays scroll horizontally; frames clamp values; nodes have max-width.

### What works correctly
- No empty canvas on position 0.
- Honest fallback text for unrecognised steps.
- 390 px layout is covered by browser checks.
- Reduced motion removes transitions and ghosts.

### Confirmed problems
- The 720 px breakpoint hides the source snippet, which removes useful context
  on tablets.
- Horizontal scroll in cell rows and list rows has no visible affordance; a
  learner may not realise more cells exist.
- Frame compaction only triggers for a single module frame; a two-frame
  recursion above a collection still takes the tall layout.
- `motion.css` is 1241 lines and growing; several rules are duplicated between
  the base and compact variants.

### Missing capabilities
- Scroll affordances (fade edges) on every horizontally scrolling container.
- A more general compaction rule based on available height rather than frame count.
- CSS organisation by component.

### Relevant files
`motion.css`, `MotionStage.jsx`, `tools/browser-check/run.mjs`.

### Existing test coverage
- Browser: `long-array`, `narrow`, `greet-mobile`, `ds-mobile-reduced`,
  `ds-keyboard`.

### Recommended changes
- Add fade-edge gradients to `.motion-list-row` and `.motion-slots` when
  overflow is detected (CSS-only, via `mask-image`).
- Keep the 720 px source hiding only below 600 px.
- Split `motion.css` into section comments only; no file split needed.

### Risk of regression
- `mask-image` must not clip the focus ring or ghost measurements.
- Changing breakpoints can invalidate the 390 px browser checks.

---

## Summary of verified gaps (prioritised)

1. Sorting: progressive settled region, swap vs shift distinction, scroll
   affordance, long-array summary.
2. Recursion: completed state, return-value trail, discoverability of deep stacks.
3. Tree: real connectors, wide-level scroll/scale, visited styling.
4. Graph: connectors, frontier strip, visited styling.
5. Generic: persistent locals strip, branch/loop indicators, exception emphasis.
6. Synchronization: speed-scaled ghosts, synchronous seek cleanup.
7. Responsive/overflow/perf: scroll affordances, breakpoint tuning, CSS hygiene.

## Areas already working (do not rewrite)
- Positional cell identity and FLIP interruption.
- Settled-position evidence from the trace.
- Honest empty/no-change states.
- Reduced motion and theming.
- Deterministic, cursor-driven view model.

## Recommended implementation order
Sorting -> Recursion -> Tree -> Graph -> Generic -> Sync -> Responsive.
Each as a small, testable unit with a browser screenshot check.

## Phase 11B implementation (this pass)

Implemented from the verified gaps above:

1. **Exception emphasis** — `.motion-stage.is-error` tints the canvas border and
   head when `view.ending.id === "error"`, so a failing run is visible at a
   glance instead of only in the result tile.
2. **Operation-kind badge** — the explanation line now carries a small pill
   naming the verified operation kind (`compare`, `swap`, `shift`, `insert`,
   `remove`, `change`, `call`, `return`, `error`), driven by
   `view.feedback.kind`, so a swap and a shift are distinguishable even when
   their sentences are similar. The sentence itself keeps its recorded wording.
3. **Scroll affordances** — horizontal scroll containers (cell rows and linked-list
   rows) now fade their edges with a mask, signalling that more content exists
   off-screen without changing layout or measurements.

Not attempted this pass (deferred, documented as remaining limitations):
- Progressive settled region (finality only proves the final state; no per-step
  evidence exists to claim a growing sorted prefix honestly).
- Tree/graph SVG connectors (requires a measurement pass; deferred to avoid
  regressions in the FLIP layer).
- Cumulative visited styling (requires history replay; deferred).
- Speed-scaled ghost lifetime (speed is not exposed on the plan; plumbing deferred).

Quality gates after this pass: tracer 136/136, JS 877/877, lint clean, build
passes, planner PASS, browser 250/250.
