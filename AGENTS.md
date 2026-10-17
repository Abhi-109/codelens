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
