# AGENTS.md

Working notes for agents in this repository.

## Always leave it green

Run all four before calling anything done; they must pass on every commit:

```sh
npm run test:tracer   # Python unit tests (tracer-poc/)
npm run test:js       # JS unit tests (src/**/*.test.mjs)
npm run lint          # oxlint
npm run build         # production build
```

`npm run test:pyodide` and `npm run check:explain` are opt-in and need a real
Pyodide download; run them when changing the worker, `tracer.py`, or the
explanation layer.

## Commits and pushing

- **One commit per task.** Keep each commit reviewable as a unit.
- **Push to GitHub when a task is complete.** Do not wait to be asked, and do
  not leave finished work sitting only on the local machine. After committing a
  completed task, run `git push origin main` and confirm `origin/main` matches
  local `main`.
- If a push fails (auth prompt, no credentials), say so plainly in the reply
  instead of reporting the work as done.

## Working style

- Ask before adding any dependency.
- Do not delete existing user-facing views; keep them reachable behind a toggle
  (e.g. the "Simple view" switch) instead of removing them.
- Keep the dev server demoable after each task.

## Docs to keep in sync

- `docs/flowchart-format.md` and `tracer-poc/flowchart.py`'s version and tests
  must change together in one commit.
- `README.md` test counts and its structure tree drift easily — update them when
  the numbers or `src/` layout change.
- `docs/roadmap.md` records stage status; update it when a stage lands.


```markdown
## Animation visualizer project: non-negotiable rules

Source of truth: docs/animation-spec.md. Progress and decisions: docs/animation-progress.md.
Read both at the start of every session.

1. One phase per session. Never start the next phase, and never "get ahead".
2. Before coding, state objective, in scope, out of scope, files, and tests. Wait for "go".
3. One task per commit, about 300 lines or less. If a change is bigger, split it.
4. After every task run: npm run test:tracer, npm run test:js, npm run lint,
   npm run build. Paste the real output. Never claim a check passed unless you ran it.
5. The renderer never runs Python and never invents events. If unsure, highlight.
6. No example-specific code (keep the no-hardcoding test green). Works for any program.
7. No new dependency, no trace-format change, no deleting features or tests, and no edits
   outside the phase scope without asking first.
8. Two-panel page only: Code and Animation. Do not add tabs, inspector cards, dashboards,
   or AI explanations.
9. Use existing tokens and both themes. Respect prefers-reduced-motion.
10. Do not read or paste node_modules, dist, or large generated files.
11. After each task, update docs/animation-progress.md.
12. At the end of a phase, do a drift check against the spec (done / partly / not done per
    requirement), report, and stop.
If anything is unclear or conflicts with the spec: stop and ask. Do not guess.
```
