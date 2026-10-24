# Animation visualizer: phase prompts

How to use: **one phase per session.** Start a fresh agent session for each phase. Paste the **common header**, then paste **only that phase's block**. Never paste two phases together. Do not start a phase until the previous one is reviewed and committed.

---

## Common header (paste at the start of EVERY session)

```
You are working in the CodeLens repo. Before anything else, read, in this order:
1. AGENTS.md
2. docs/animation-spec.md   (the source of truth; do not contradict it)
3. docs/animation-progress.md   (where we are, decisions made, open questions)

Work on ONE phase only: the one below. Rules:
- Before writing code, reply with: objective, in scope, out of scope, files you
  expect to touch, tests you will add. Then wait for me to say "go".
- Work in small tasks (one commit each, about 300 lines or less).
- After each task: run npm run test:tracer, npm run test:js, npm run lint,
  npm run build; paste the real output; update docs/animation-progress.md; commit.
- If you hit a "stop and ask" case from the spec (dependency, trace format change,
  files outside scope, deleting features, anything unclear), STOP and ask me.
- At the end: do a drift check (list each requirement of this phase from the spec
  with done / partly / not done), report, and stop. Do not start the next phase.
```

---

## Phase 0: Audit (no code changes)

```
PHASE 0: AUDIT. Do not modify any source file. Write docs/animation-audit.md only.

Inspect the real repo (not my descriptions) and answer:
1. What events and snapshot fields does the tracer capture today? Show 3 real
   trace excerpts: x=10 then x=x+1; a list append; a recursive call.
2. Which object identities and references are stable across steps? Is aliasing
   (b = a) preserved?
3. Which collection mutations are visible by diffing consecutive snapshots
   (append, insert, pop, index assign, swap, dict set/delete, attribute set)?
   Which are ambiguous (for example swaps with duplicate values)? Prove each with
   a real trace.
4. Is every snapshot complete enough to reconstruct the stage without re-running
   Python? Are forward, backward, and jump states identical today?
5. How big are traces for the corpus (steps, bytes)? Is full-snapshot storage
   acceptable?
6. What data is missing for: index markers, return values at the call site,
   the executed line's structure (swap or shift shape)?
7. Which existing components, selectors, and tests can be reused? Which parts of
   the old visualizer page will be replaced?
8. Baseline: results of test:tracer, test:js, lint, build, and any pre-existing
   failures.
9. The smallest sequence of changes that satisfies docs/animation-spec.md.

Then update docs/animation-progress.md and stop for my review.
```

---

## Phase 1: Diff engine (no UI)

```
PHASE 1: DIFF ENGINE. No UI changes.

Build src/animation/ with: the action types from spec section 6, a pure function
diffSteps(prevSnapshot, nextSnapshot, context) -> actions, the safe index-
expression evaluator, and the move inference (swap, shift, insert, delete, with
the ambiguity fallback). Make only the tracer changes the audit approved.

Tests (required):
- Golden action lists for at least 20 programs: hello world, assign/reassign,
  branches, loop accumulator, append, pop, index assign, bubble sort, selection
  sort, insertion sort, binary search, factorial, aliasing, dict counting, class
  with fields, linked list, chaining hash table, exception.
- Property tests over the whole corpus: applying a step's actions to snapshot A
  gives snapshot B, and reversing them gives A.
- Safe evaluator: accepts names, integers, + - * //, parentheses; rejects calls,
  attributes, and anything else without throwing.
- A duplicate-value case proving the engine falls back to highlight, never an
  invented move.

Document the vocabulary in docs/animation.md. Report and stop.
```

---

## Phase 2: Thin end-to-end slice (the new page, minimal motion)

```
PHASE 2: TWO-PANEL PAGE + GENERIC STAGE. Build the new page next to the old one
(do not delete the old visualizer yet).

Build the page at the visualizer route behind a flag or a temporary route:
Code panel, Animation panel with the control strip, splitter, status chip, welcome
state with example buttons, session handling (stale results ignored). Build
src/animation/scene.js (snapshot -> positioned elements with stable layout) and the
renderer for: variable chips, lists, dicts, frames (simple), console. Motion: fades
and highlights only. Everything from one currentStep.

Done when these animate end to end from REAL traces: print("Hello"), x = 10 then
x = x + 1, a for loop with an accumulator, list append, and a call to a function.
Include screenshots in both themes. Report and stop.
```

---

## Phase 3: Motion for lists

```
PHASE 3: LIST MOTION. Add real animation using the Phase 1 actions: index markers,
compare highlights, swap, shift, insert, delete, append, the value-change flash,
and the bars skin for 8+ numbers.

Requirements: interruptible animations (Next mid-animation finishes it instantly),
only transform and opacity, reduced-motion fallback, speed setting respected,
scrubbing jumps without animating. Add scene tests for bubble, selection, and
insertion sort and binary search: forward, backward, and jump states are identical.
Recording or screenshots in both themes. Report and stop.
```

---

## Phase 4: Calls, recursion, objects, linked structures

```
PHASE 4: FRAMES AND OBJECTS. Animate call frames (slide in with arguments, return
value travels back, frame leaves), recursion, node cards with reference arrows
(animated connect/disconnect), aliasing (two names, one card), linked-list and tree
auto-layout, and stable positions across steps (no jumping).

Tests: factorial, Fibonacci, a linked list build and traversal, a binary tree
insert, aliasing, a cyclic reference, a class with attribute changes. Add a layout
test that fails if two elements overlap. Report and stop.
```

---

## Phase 5: Skins from evidence

```
PHASE 5: SKINS. Add the hash-bucket skin (activates only when a list of lists or
nodes is indexed with a modulus expression), the dict key-to-value table, and the
tree and linked-list skin polish. Each skin shows a small "why" chip and can be
switched off from the animation header menu. No evidence means generic views.

Tests: a user-written chaining hash table (insert, collision, lookup), a program
that merely names a variable hash_table (must NOT activate the skin), built-in dict
operations (no fake buckets). Report and stop.
```

---

## Phase 6: Playback and limits hardening

```
PHASE 6: HARDENING. Race conditions (rapid Play/Pause/Next/Back, seek while
playing, Run during playback, stale results), end-of-trace statuses (completed,
failed, truncated with the reason), step/time/output/trace-size limits with the
worker terminated on timeout, large collections ("+ M more", zoom/pan), cancelled
runs, invalid source, caption in an aria-live region, keyboard shortcuts.

Tests for each of the above. Report and stop.
```

---

## Phase 7: Validation, polish, cleanup

```
PHASE 7: FINISH. Run EVERY corpus program through diff and scene builder in tests
(no throw, no overlap, forward/backward/jump identical). Check both themes at
1440x900, 1024x768, 375x667; accessibility pass. Make the new page the default,
then DELETE the old visualizer code and its now-unused tests. Update README and
docs: trace-format.md, supported-python.md, animation.md. Run the spec's section 14
definition of done and report each item. Stop.
```
