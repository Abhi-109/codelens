# CodeLens Animation Visualizer: Spec (v1)

**Status:** the source of truth for the visualizer rebuild. Agents read this at the start of every session. Change it only when the owner agrees, and record the change in the "Decision log" at the bottom.

## 1. Goal
Replace the Python visualizer page with an **animation-first** workspace: the user writes Python, runs it, and **understands the program by watching what actually happens** (values change, list cells move, calls stack up, output appears), like a good sorting-algorithm video.

The page has **exactly two panels**:
1. **Code** (left): editor with line numbers, the next line to run highlighted, Run and Reset, an Examples menu, a status chip.
2. **Animation** (right): the stage. Playback controls (Back, Play/Pause, Next, Restart, slider, "Step 4 / 12", speed) sit in a compact strip at its bottom. Program output is a console strip inside the stage.

No tabs, inspector cards, timeline tables, comparison views, call-stack dashboards, or AI-generated explanations on this page. Call frames, variables, and references appear **inside the stage** as part of the animation.

**Caption line (Decision D1, owner may change):** one short, subtitle-style line inside the stage built only from recorded facts ("`j` is compared with `j + 1`; 12 > 11, so they swap"). It has a toggle and is on by default.

## 2. Non-goals for v1
- No server-side code execution and no sandbox service (see section 3).
- No languages other than Python. No generators, async, threads, or native-library (NumPy, pandas) animation: show observable state plus a gentle note.
- No graph, heap, or priority-queue skins (later).
- No accounts, analytics, or AI in the execution path.
- No new UI library or animation library. SVG/HTML, CSS transforms, and the Web Animations API only. Ask before adding any dependency.

## 3. Execution model and threat model
- User code runs **in the user's own browser**: Pyodide inside a Web Worker. There is no server-side execution.
- Limits: step limit, wall-clock timeout (terminate the worker), output-size cap, trace-size cap (cap on objects per snapshot and items per container).
- A shared link **never auto-runs** code; it waits for the user to press Run.
- Every run has a **session id**. Results from an older session are ignored.
- Document this as the threat model. A trace hook is not a sandbox, and we do not claim it is.

## 4. Pipeline (one direction, one job per stage)
```
editor -> run controller -> worker tracer -> trace -> state at step i -> diff(i-1, i)
       -> actions -> scene (layout) -> renderer
playback controller owns the single `currentStep`
```
- The **renderer never runs Python and never invents events.** It draws what the trace says.
- Everything on screen (highlighted line, state, scene, output) derives from `currentStep`. No panel keeps its own step.

## 5. Trace
- **Reuse the existing tracer v2** and `docs/trace-format.md`. It records a full snapshot per step with stable object ids. Keep full snapshots; add checkpoints or deltas only if measured trace size becomes a problem.
- **Derive mutations by diffing consecutive snapshots.** Add targeted tracer instrumentation only where the diff is ambiguous, and justify each addition in the audit. Any format change bumps `format_version`, updates `docs/trace-format.md`, and updates tests.
- A trace is **complete**, **truncated** (with the reason: step, time, output, or trace size), or **failed**. Never present a partial trace as complete.
- Distinguish: empty collection, contents unknown, contents truncated, value not serializable.

## 6. Diff and the action vocabulary
For two consecutive snapshots, produce a list of actions with stable ids:
`appear`, `disappear`, `change` (old to new), `highlight`, `move` (including `swap` and `shift`), `grow` (append, insert), `shrink` (pop, delete), `connect`, `disconnect`, `call`, `return`, `print`, `error`.

Rules:
- **Never invent.** If it is not certain that something moved, emit `highlight` or `change`, not `move`.
- **Moves:** infer `swap`, `shift`, `insert`, and `delete` by comparing the before and after lists together with the shape of the executed line (`a[i], a[j] = a[j], a[i]` is a swap; `a[j + 1] = a[j]` is a shift). With duplicate values, choose the smallest-movement explanation or fall back to `highlight`.
- **Index markers and compared cells:** evaluate the simple index expressions in the executed line (`i`, `j + 1`, `mid`) with a **safe evaluator**: names, integers, `+ - * //`, parentheses. No calls, no attributes. If it cannot evaluate, show no marker.
- **Reversible:** applying a step's actions to snapshot A yields snapshot B; applying them reversed yields A. This is a required property test over the whole corpus.
- Back plays the reverse actions. Dragging the slider jumps straight to the target state with no animation.

## 7. What the stage draws
- **Values:** a labelled chip per variable. A change flashes and shows old to new briefly.
- **Lists and tuples:** numbered cells. Index variables appear as labelled arrows under their cells. Compared cells are highlighted. Shade a "done" region only when the data proves it.
- **Dicts and sets:** key to value rows (a set as a bag of cells). Python's built-in `dict` is drawn as key to value, never as fake hash buckets.
- **Objects and references:** node cards with fields and arrows. Two names for one object share one card. Stable layout: an object keeps its position across steps unless it must move. `next` chains lay out as a linked list; `left`/`right` as a tree.
- **Call frames:** a call slides a frame in with its arguments; a return sends the value back and removes the frame. Deep recursion compacts.
- **Console:** printed text appears incrementally.
- **Skins** are chosen from evidence in the trace, show a small "why" chip, and can be switched off: **bars** (8 or more numbers), **linked list**, **tree**, **hash buckets** (a list of lists or nodes indexed with a modulus expression). No evidence means generic views.
- **Big data:** show the first N items with "+ M more", zoom and pan.

## 8. Playback semantics
- Controls: Play, Pause, Back, Next, Restart, seek, speed, step counter, status.
- Animations are **interruptible**: pressing Next mid-animation completes it instantly and starts the next. A late animation can never overwrite a newer target state.
- Speed changes presentation timing only, never order or state.
- Only `transform` and `opacity` are animated. With `prefers-reduced-motion`, replace movement with fades and highlights.
- End of trace shows the true status: completed, failed, or truncated (with the reason).

## 9. Layout and style
- Under the existing site top bar, no page scroll at 1366x768 and up; a draggable splitter (remembered in `localStorage` with try/catch); fullscreen for the animation; under 900px the panels stack and controls stay pinned.
- Use the existing `tokens.css` and both themes. No new palette. WCAG AA contrast, keyboard use (Space plays, arrows step, Esc leaves fullscreen), caption in an `aria-live="polite"` region.
- Welcome state: a few example buttons. Never an empty stage.

## 10. Reuse, do not rebuild
`tracer-poc/tracer.py` and its tests, the 60-program corpus, `stepView` selectors, the no-hardcoding test, `docs/supported-python.md`, `tokens.css`, the shell, router, and theme system. Keep the old visualizer until the new page passes Phase 7, then delete the dead code (it stays in git history).

## 11. v1 scope
**In v1:** generic stage (values, lists, dicts, frames, console), list motion (markers, compare, swap, shift, insert, delete, bars), recursion and call frames, objects with references, linked list, binary tree, and a chaining hash table skin.
**Later:** graph, heap, stack/queue skins, sorting-region shading beyond what data proves, Python dict internals.

## 12. Quality gates (every commit)
- `npm run test:tracer`, `npm run test:js`, `npm run lint`, `npm run build` all pass, and the real output is pasted in the report.
- New logic has tests. Pure functions are tested directly. The corpus is run through the diff and scene builder.
- UI work includes screenshots or a short recording in **both themes**.
- No example-specific code anywhere (the no-hardcoding test stays green).
- Docs updated: `docs/trace-format.md`, `docs/supported-python.md`, and `docs/animation.md` (the action vocabulary and rules).

## 13. Stop and ask before
- Adding a dependency.
- Changing the trace format.
- Touching files outside the current phase's scope.
- Deleting existing features or tests.
- Anything this spec does not cover, or any requirement you cannot meet.

## 14. Definition of done
- Hello world, assignment and reassignment, branches, loops, list mutations, sorting (bubble, selection, insertion), binary search, recursion, aliasing, dict counting, class objects, a linked list, a binary tree, a chaining hash table, and an exception all animate correctly from **real traces**.
- Forward, backward, restart, and slider jumps always land on the exact state of the recorded step.
- An unfamiliar program still gets a truthful generic animation or an honest "not visualised in detail" note.
- Both themes, mobile, keyboard, and reduced motion work. No overlapping elements. No console errors.
- All gates in section 12 pass and the old visualizer code is removed.

## Decision log
| Date | Decision | By |
|---|---|---|
| (today) | Two-panel layout; caption line on by default (D1) | owner |
| 2026-10-24 | Step counter counts executable source-line steps, not raw trace events; internal events stay available for animation detail. The playback cursor remains the event index, so the counter is derived, not renumbered (Phase 2). | owner |
| 2026-10-24 | Corpus count corrected from 45 to 60 in section 10. The spec number was stale; `corpus.py`, the golden file and README all say 60, and the corpus is not changed by the correction. | owner |
| 2026-10-24 | A return value may animate toward the console for `print(f(x))` when the trace proves the output follows the return; no landing variable is invented. Otherwise the return animation stays simpler. | owner |
| 2026-10-24 | Sets are unordered bags of cells: their elements may appear and disappear, never move between ordered positions. | owner |
