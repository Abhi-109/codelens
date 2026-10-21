# Task: build the Python Visualizer views from the dashboard mockups

Attach **both mockup images** when you paste this into your coding agent, and save them as `docs/design/visualizer-1.png` and `docs/design/visualizer-2.png`. They show the views the visualizer page should have: **how the program is executing, step by step**.

This prompt covers **only the visualizer page** (`/visualizer/python`). The rest of the website (Home, Learn, Docs, About, theme system) is in `website-build-prompt.md`. Use the same design tokens, dark and light themes, and app shell. The Data Structure Visualizer is a separate page.

## Hard rules
- All tests must pass: `npm run test:tracer`, `npm run test:js`, `npm run lint`, `npm run build`.
- **Do not change the trace format** unless it is impossible without it. If you must, bump `format_version`, update `docs/trace-format.md`, and update the tests.
- **Every view must work for any Python program**, never only the examples (see `generality-prompt.md`: no example-specific code, safe fallbacks, corpus tests).
- **The mockups are illustrative, not data.** Never copy their numbers, step counts, memory addresses, or text. Every value shown must come from the real trace. The mockups contain mistakes (for example a variable table that disagrees with the code, "Nes" instead of "Yes", inconsistent step counters). Do not reproduce them.
- No new dependencies without asking (charts and trees are drawn with SVG). Small commits, one view per commit.

## Layout (from the mockups, with our teaching priorities kept)
- **App shell:** a slim left sidebar (Python Visualizer, Data Structures, Learn, Examples, Docs; icons with labels, collapsible to icons), and a header with a back arrow, "Python Visualizer", the file tab (`main.py`), a run-status chip (Ready, Running, Completed, Error), small icon buttons (theme, share), and **Run Code** as the single primary button.
- **Left:** code panel. Right: view tabs. **Bottom:** player (Back, Play, Next, slider, "Step 4 / 12", speed).
- **Keep our additions to the mockup:** a permanent **"What's happening" card** (plain-English "Next" and "Just happened") above the tabs, and the **one `currentStep` that drives everything**. At 1366×768 and up the page must not scroll; panels scroll internally only if needed. On small screens the tabs become a scrollable tab bar and the code panel collapses.
- **Tabs:** **Variables** (default), **Flow**, **Call Stack**, **Memory**, **Output**. Each tab has a one-line description under its title and a "?" with a beginner explanation.
- **View-mode switcher** (the mockup's "Multiple Visualization Modes"): a compact segmented control inside the Flow tab: **Flowchart | Call tree | Timeline**. Remember the last choice in `localStorage` (try/catch).

## The views

### 1. Variables
- Two layouts with a toggle: **Boxes** (labelled value boxes with NEW / CHANGED notes and old → new; default for beginners) and **Table** (Name, Value, Type, Scope as in the mockup).
- **Scope** comes from the frame: the module is "global", a function frame is "local to `factorial(4)`".
- **Variable history:** pick a variable to see how it changed over time. Numeric variables get an SVG **line chart** (x = step, y = value, markers at each change, the current step highlighted, tooltips on hover). Non-numeric variables get a compact "step: value" list. Click a point or row to jump to that step.
- Beginner mode hides technical words; Intermediate mode shows types and scope.

### 2. Call stack
- Frames listed **top (newest) to bottom**, joined by a vertical connector line. Each frame shows `function(args)`, its local variables, and a status: **running**, **waiting for the call below**, or **returning**.
- The active frame shows its pending expression with real values substituted ("return 4 * factorial(3)") when the trace allows it.
- Push and pop animate. Clicking a frame selects it and shows **that frame's variables** everywhere (Variables tab, inline values).
- If the program has no function calls, show the single main frame with a friendly note.

### 3. Memory (Stack and Heap)
- Sub-tabs or two columns: **Stack memory** (frames and their variable names) and **Heap memory** (objects: lists, dicts, sets, class instances).
- **Arrows** from variable names to the objects they refer to (SVG overlay that follows scrolling and resizing). Two names pointing at the same object show two arrows into one object, with a plain note: "`a` and `b` are two names for the same list".
- Small values (numbers, short strings, booleans) are shown **inside the variable box**, not as separate heap objects, to avoid confusing beginners.
- Do **not** show fake memory addresses like `0x7f…`. Show a short stable label (`list #1`) in Intermediate mode only.

### 4. Output
- **Console output** that grows as the program prints, with the newest line highlighted, a **Clear** button, and an input box (values supplied before running for `input()`).
- **Error trace** sub-tab: a friendly message first ("Python can't divide by zero on line 3"), the line highlighted in the editor, and the raw traceback collapsed underneath. A caught exception (as in the `try/except` mockup) shows the message "caught and handled" without ending the run.

### 5. Flow: Flowchart (control-flow graph)
- Standard symbols: oval Start/End, rectangle statements, diamond decisions with **True / False** (or Yes / No) labels, parallelograms for input/output, one back-arrow per loop.
- Built from the code's structure (Python `ast`, run in the Pyodide worker), one node per line of code, not per step. It appears before running and lights up during the run: current node, visited path, "ran N times" badges, the branch taken.
- Values are shown **inside or beside** the nodes (old → new for the line about to run, the evaluated condition for diamonds).
- Readable at the fit scale, with zoom, pan, Fit, and Follow. No overlapping labels (keep the unit test that checks this).

### 6. Flow: Call tree (execution tree)
- Built from the call and return events. Each node is a call with its arguments (`fib(3)`) and, once finished, its **returned value**.
- **Linear recursion** (like factorial) is drawn as the nested chain from the mockup, with the return values flowing back up (`4 * factorial(3)` becoming `24`). **Branching recursion** (like Fibonacci) is drawn as a tidy tree.
- Node states: not yet called (hidden or faint), **active** (highlighted), waiting, returned (value shown, green). Nodes animate in when called and fill in when they return.
- Cap very large trees (for example 200 nodes) with a "show more" control and a clear note.
- If there is no recursion or no function call, show "This program has no function calls, so there is no call tree" and offer the Flowchart.

### 7. Flow: Timeline
- A table with one row per step: **Step, Line, Code, Variables, Output**. The current row is highlighted and the table auto-scrolls; clicking a row jumps to that step.
- A "Only show changes" filter and loop collapsing ("rounds 2 to 9 are similar").
- **Virtualise** the rows so 1,500 steps stay fast.

### 8. Step comparison
- A compare mode (in Timeline or Variables): choose any two steps, or "this step vs the previous one". Rows are variables, call stack depth, and output; columns are the chosen steps; **changed cells are highlighted** with old → new.

### 9. Inline values in the code panel
- A toggle on the code panel: after each executed line, show a small chip at the end of the line with the value it produced or changed (`total = 6`, `i = 3`), taken from the trace. Default: only the current and the just-run line; optional: all executed lines. Hovering a variable name in the code shows its current value.

### 10. Run status, errors, and empty states
- Status chip states: Ready, Loading Python…, Running, Completed, Error, Stopped (step or time limit, with a friendly explanation).
- Every view has a useful empty state before the first run and a friendly "not applicable" state (for example no recursion, no heap objects).

## Data layer (pure, tested functions in `src/visualizer/selectors/`)
`getVariablesAt(trace, i)`, `getVariableHistory(trace, name)`, `getCallStackAt(trace, i)`, `getCallTree(trace)`, `getTimelineRows(trace)`, `getHeapGraphAt(trace, i)`, `compareSteps(trace, a, b)`, `getInlineValuesAt(trace, i)`, and the Python `build_flowchart(source)`. Memoise per trace. Components only render what these return.

## Quality bar
- **One source of truth:** `currentStep`. Selecting anything (a flowchart node, a timeline row, a history point, a call-tree node, a stack frame, a code line) updates every view together, and the views never contradict the explanation card (the highlighted line is the line about to run).
- **Beginner-first wording:** plain English with the technical term beside it ("Call stack: where the program is right now"). Intermediate mode shows the technical terms.
- **Both themes** per the design tokens, **WCAG AA contrast**, full keyboard use (arrow keys switch steps and tabs, the ARIA tab pattern), visible focus rings, `prefers-reduced-motion` respected, and no information carried by colour alone.
- **Performance:** lazy-render tabs that are not visible, memoise selectors, and keep a 1,500-step trace smooth.
- **Tests:** unit tests for every selector over the **30-program corpus** (loops, nested calls, recursion, classes, aliasing, errors, `input()`); label-overlap tests for the graph layout; a test that fails if a view throws for any corpus program at any step.

## Order of work (stop and show me after each stage)
1. **Shell, tabs, player, explanation card, Variables (boxes and table), Output.** This is the core a beginner needs.
2. **Call Stack and Inline values.**
3. **Memory** (stack and heap with arrows) and the **Variable history chart**.
4. **Call tree** (chain and branching tree).
5. **Timeline and Step comparison.**
6. **Flowchart** (control-flow graph).
7. Polish: light theme check, mobile, the corpus visual pass, accessibility audit.

## Acceptance checks
- For the programs `x = 5; x = 10`, a `for` loop adding numbers, `fact(4)`, `fib(4)`, an aliasing example (`b = a`; `b.append(3)`), and a `try/except` example, each view shows correct, real data and updates together as I step.
- Pasting a program I have never seen (a grade calculator, a prime checker) works in every tab, or shows a friendly "not applicable" message.
- No fake memory addresses, no copied mockup text, no example-specific code (the no-hardcoding test passes).
- At 1366×768 there is no page scroll; at 375px wide the tabs scroll and everything remains usable; dark and light both look finished.
- All tests, lint, and build pass.

## Report back
For each stage: files changed, screenshots in both themes at 1440×900 and 375×667, how each view above was met, deviations from the mockups and why, and anything left out. Wait for my review before the next stage.
