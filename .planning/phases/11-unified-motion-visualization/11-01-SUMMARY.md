# Plan 11-01 Summary: Unified Motion visual quality

## Result

The one visible Motion canvas now renders ordinary Python execution as a
behaviour-driven scene: a vertical call stack, collection primitives with real
indices, and node-link compositions built only from recorded references. The
tracer, the trace format, the deterministic planner, the renderer registry and
the shared cursor are untouched.

## What changed

### Call stack (`view.js`, `MotionStage.jsx`, `motion.css`)
- Frames render newest first, so the active call is always on screen.
- Each frame carries function, recorded depth, the line it is running (or was
  called from), its locals, and an `active` / `waiting` / `returning` state.
- Only the recorded returning call owns a return value; parents are `waiting`
  because the stack alone proves it.
- The stack keeps the most recent 8 calls and states how many earlier calls it
  left out; the Inspector still holds every frame.
- Values inside a frame are clamped and the frame clips its content, so a long
  class repr cannot overlap the next section.

### Generic primitives (`view.js`, `motion.css`)
- A changed scalar shows `old -> new`, where `old` is the plan's previous
  snapshot, never a reconstruction.
- Scalar tiles appear only when there is no collection to compete with; the
  frames already list every local.
- Position 0 introduces the run; a step with no drawable change names its line
  and says so honestly.

### Recorded shapes (`view.js`, `MotionStage.jsx`)
- Class instances that reference one another compose into a linked list (chain),
  a tree (one root, at most two children, no cycle) or a graph (a cycle or wider
  fan-out). The classifier reads only reference values the trace recorded.
- Adjacency lists (a node attribute pointing at a list of nodes) are followed one
  hop; the list itself is reported as auxiliary and is not repeated as a card.
- A node's headline value is not repeated among its attributes, and graph edges
  name their destination's value instead of a verbose repr.
- Objects with no recorded references keep their generic cards.

### Collections
- The existing cell composition, comparison ring, swap/shift choreography,
  per-cell index and settled green are unchanged.
- The phone breakpoint now keeps cells readable at 390 px.

## Verification

- `npm run test:tracer`: 136 passed.
- `npm run test:js`: 877 passed.
- `npm run lint`: clean.
- `npm run build`: passed.
- `npm run check:planner`: PASS.
- `npm run check:browser`: 250/250 passed.
- Screenshots inspected for a swap step, the final state, linked list, tree,
  graph and a deep recursion stack.

## Notes and limits

- Shape classification is deliberately conservative. A chain with a tail that
  points back into the middle is drawn as a graph; nodes unreachable from the
  displayed head are counted in the structure note rather than invented.
- Only class instances become nodes. Lists, dicts and sets keep their own cards.
- No shape is drawn when no reference attribute is recorded.
