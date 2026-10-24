# Focus kit for the coding agent

Two things to put in the repo. The first goes into your existing `AGENTS.md`; the second is a new file the agent keeps up to date.

---

## 1. Add this section to `AGENTS.md`

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

---

## 2. Create `docs/animation-progress.md`

```markdown
# Animation visualizer: progress

**Current phase:** 0 (Audit)
**Last updated:** (agent fills in)

## Phase checklist
- [ ] 0 Audit
- [ ] 1 Diff engine
- [ ] 2 Two-panel page + generic stage
- [ ] 3 List motion
- [ ] 4 Frames, recursion, objects
- [ ] 5 Skins
- [ ] 6 Hardening
- [ ] 7 Validation, polish, cleanup

## Current phase: tasks
(agent keeps this list: task, status, commit hash)

## Decisions made
(date, decision, reason. Mirrors the spec's decision log.)

## Open questions for the owner
(agent adds; owner answers)

## Known issues and limits found
(anything discovered that later phases must handle)

## Next action
(one sentence: exactly what the next session should do first)
```

---

## 3. How you keep the agent on track (your routine)

**Before each session**
- Make sure the previous phase is reviewed, merged, and committed. Start from a clean `git status`.
- Open a **fresh session** (new chat). Long conversations make agents forget the early instructions, so the files carry the memory instead.
- Paste the common header and **one** phase block. Nothing else.

**During the session**
- Make it echo the plan first (objective, in scope, out of scope, files, tests) and approve it with "go". If the plan is off, correct it before any code exists.
- Watch the size of changes: `git diff --stat` after each commit. A task that touches many unrelated files is drifting.
- If the agent starts adding something not in the phase ("while I'm here, I'll also..."), say: "Out of scope. Revert that and continue with the plan."

**After each task and phase**
- Check the real evidence yourself: run the four commands, open the app, look at the screenshots. Do not rely on the agent's summary.
- Ask for the **drift check**: each spec requirement for the phase with done / partly / not done. Anything "partly" gets finished or logged in the progress file before moving on.

**When the agent goes off track**
- Do not argue in a long thread. Run `git status`, keep the good commits, `git reset` or `git revert` the bad ones, and start a **fresh session** with the header, the phase block, and one line saying what went wrong ("last time you did X; do not").
- If it keeps happening, make the phase smaller.

**What keeps things honest**
- Tests are the guardrails: the property test (actions turn snapshot A into B and back), the corpus run, the no-hardcoding test, and the overlap test fail loudly when the agent cheats or drifts.
- A rule that matters should be both in the spec and in a test.

**Prompt hygiene**
- Short prompts that point at files beat long prompts that repeat them.
- Keep stable rules in `AGENTS.md`; keep changing instructions in the phase block.
- State what NOT to do. A list of non-goals prevents more drift than a longer list of goals.
