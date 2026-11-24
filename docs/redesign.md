# CodeLens redesign: Focus, universal coverage, languages

**Status:** working contract for the next-level redesign (2026-11-24). Read with
`docs/animation-spec.md` (v2) and `docs/animation-progress.md`.

## 1. What changes

The product stays the same — write Python, press Run, watch what really happened —
but the surface is rebuilt:

- **Focus is the default visualizer.** One code editor on the left, one stage on
  the right, one compact transport under it. No canvas tabs, inspector drawer,
  run-story card, learning-mode switch, glossary button or developer menu.
- **Studio is one toggle away.** The existing workspace (six canvases, six
  inspector sections, run story, timeline, comparison, developer facts) is kept
  intact, sharing the same session, cursor, playback and speed. It is never
  deleted; it is simply not the default.
- **The site is refreshed** around the same design tokens: new type scale,
  control primitives, spacing rhythm and motion, both themes.

The two-surface model is the only way to satisfy both the product brief ("only
code editor and visualizer") and the repository rule that user-facing views stay
reachable behind a toggle.

## 2. Universal visualization contract

A trace is evidence. A visualization may only draw what the recording proves.

> **Every run produces a non-blank, truthful stage.** For every recorded step the
> stage shows the source line, the operation, and the state the trace carries:
> values, containers, nested contents, references, call frames, comparisons,
> output, input, a return, or an error. When something cannot be shown, the stage
> says exactly what and why. It never invents a value, a movement or an outcome.

Non-goals, stated plainly: code that never runs (syntax error, engine failure)
can only be shown as its error; and execution the tracer cannot record
(threads, native-library internals, some generator/async machinery) gets an
explicit note, not a fabricated animation.

Coverage is measured, not claimed: a pure `coverage` report classifies each step,
and a corpus-wide test fails on an unexplained blank stage.

## 3. Multi-language architecture (kept in memory, not faked)

v1 execution remains Python. The redesign reserves a language boundary so a
second language can land without a UI rewrite:

```
source (language) -> language runtime -> trace (format 3 contract) -> diff -> stage
```

- A language adapter owns the runtime (Pyodide today; a JS tracer or another
  browser runtime later), the supported-construct documentation and the
  fixture corpus.
- Everything downstream of the trace is language-neutral and already is:
  `snapshotAt`, `diff`, `planMotion`, `motionView`, the stage and playback.
- The shell exposes one language registry. A language is only advertised when
  its adapter can run and record; no placeholder claims execution.
- Adding a language is a new adapter + corpus + docs, not a new workspace.

The same rule as Python applies: never invent. A language that cannot record a
construct must say so.

## 4. Coverage gaps this redesign closes

| Area | Today | Target |
|---|---|---|
| Scalars beside collections | Hidden when a collection is drawn | Always visible, capped and ranked |
| Strings | One scalar tile | Character cells when the trace indexes them; full text otherwise |
| Nested containers | Parent card only | Bounded nested rows with the inner change marked |
| Opaque values | `other` pill | Card with class, repr and an honest "not further inspected" |
| I/O and errors | Output/status area | First-class stage events, including input prompts |
| Statement shapes | Swap/shift/insert/pop/dict/object | Strings, slices, augmented/multi-target, nested writes, comprehension writes |
| Blank steps | Several honest but empty notes | A step line + operation + state, always |

## 5. Design language

- **Editorial terminal.** Warm paper and charcoal, one electric accent, values
  treated as physical objects.
- **One surface per pane.** Borders only where they separate; no card inside a
  card; no dashboard chrome.
- **Type.** Large mono step headline, comfortable 13–14px code, 1.6–1.75 line
  height, tabular numbers for counters.
- **Motion.** 120–220 ms, transform and opacity only, interruptible; reduced
  motion removes movement and keeps colour/state.
- **Tokens only.** No raw colours in components; `contrast.test.mjs` keeps both
  themes at WCAG AA.

## 6. Phases

| Phase | Scope | Status |
|---|---|---|
| 0 | Spec v2, this contract, roadmap/progress | done |
| 1 | Design foundation: tokens, primitives, shell | next |
| 2 | Focus workspace (editor + stage + transport, Studio toggle) | in progress |
| 3 | Universal stage coverage (strings, nested, opaque, I/O) | partly: measured coverage guard landed; value kinds pending |
| 4 | Diff/motion completeness + performance | pending |
| 5 | Site-wide redesign | pending |
| 6 | Python breadth audit; multi-language adapter boundary | pending |
| 7 | Hardening: a11y, budgets, engine states | pending |
| 8 | Polish and release | pending |

Every phase keeps the four gates green: `test:tracer`, `test:js`, `lint`,
`build`.

## 7. Decisions

- **D1** Focus/Studio over one session; no feature deletion.
- **D2** Universal stage contract above; blank is a bug, not a fallback.
- **D3** Zero new dependencies for the first editor pass; a rich editor
  dependency is a separate, approved decision.
- **D4** Multi-language support is an adapter boundary, not a claim. Python is
  the only runnable language today.
- **D5** Studio keeps every existing canvas and inspector, including the ones
  hidden by the current unified Motion switch.
