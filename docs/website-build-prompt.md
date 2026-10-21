# Task: build the full CodeLens website from the design mockups (dark + light)

Attach the two mockup images when you paste this into your coding agent, and save them in the repo as `docs/design/dark.png` and `docs/design/light.png` so the agent can keep checking against them. **The images are the visual reference.** This prompt says what is in them, what to build, and where to deviate on purpose.

## Hard rules
- All tests must pass: `npm run test:tracer`, `npm run test:js`, `npm run lint`, `npm run build`. Do not break the existing visualizer, tracer, or explanation logic.
- Do not change the trace format. Everything the learner sees must work for **any** Python program (see `generality-prompt.md`), never only the examples.
- **Approved new dependencies:** `react-router-dom` and an icon set (`lucide-react`). Ask before adding anything else.
- Small commits, one page or component per commit. After each stage, give me before/after screenshots in **both themes** at 1440×900, 1024×768, and 375×667.
- Colours below are **approximations**. Sample the exact values from the images and put them in the tokens file.

## What the mockups show
Seven screens, each in dark and light:
1. **Home:** hero "See your code come to life." with a live-looking preview card, and a four-item feature strip.
2. **Get Started / Choose a language:** a grid of language cards. Python is "Available now"; the rest are "Coming soon".
3. **Python Visualizer:** code editor on the left; on the right a tab bar (Execution Flow, Variables, Call Stack, Output); a bottom player with Back, Play, Next, a slider, and "Step 4 / 12". Header actions: Save and Run Code.
4. **Data Structure Visualizer:** a left list (Array, Linked List, Stack, Queue, Binary Tree, Heap, Graph), a centre canvas (array cells with indexes, Insert / Update / Delete, Index and New Value fields), and a right "Operations" step log.
5. **Learn:** left sidebar (Getting Started, Python Basics, Control Flow, Functions, Data Structures, Examples), lesson page "Introduction to Python Visualization" with a "What you'll learn" checklist and a Start Lesson button.
6. **Documentation:** sidebar plus guide cards.
7. **About:** mission text and four feature cards.

Common to all: a top bar with logo, links (Home, Features, Learn, Docs), a theme toggle, and a "Get Started" button; a breadcrumb or back link under it.

## Design system (create `src/styles/tokens.css`; everything uses tokens)
**Theme switching:** `data-theme="light|dark"` on `<html>`, defaulting to the system preference, with a toggle (moon/sun) that is remembered in `localStorage` (wrapped in try/catch). Prevent a flash of the wrong theme with a tiny inline script before first paint. Both themes must pass **WCAG AA contrast** and look finished, not like one theme with colours inverted.

**Dark theme (approximate):** background deep navy `#0A0F1E`, surface `#111827`, raised surface `#151E32`, border `#1F2A44`, text `#E8ECF8`, muted `#8E99B4`, **primary blue `#2F6BFF`** (primary buttons, active tab, selected card border), accent teal `#22D3C5` and violet `#8B5CF6` for connector lines and highlights, success green for "Available now" chips.

**Light theme (approximate):** background `#F6F7FC` with a soft lavender-to-white gradient behind the hero, surface `#FFFFFF`, border `#E3E6F0`, text `#0F172A`, muted `#5B6478`, accent blue `#3B5BFF`. In the mockups the **primary buttons are near-black (`#0B1020`) in light mode** and **blue in dark mode**; keep that. Use subtle shadows in light mode, and borders (not shadows) in dark mode.

**Shape and type:** card radius 12 to 16px, control radius 8 to 10px, pills fully rounded; thin 1px borders; one spacing scale on a 4px base. Interface font: Inter or Plus Jakarta Sans. Code and values: JetBrains Mono. Hero heading about 56 to 64px bold, with the second line ("come to life.") in an accent gradient (blue to cyan in dark, blue to violet in light). Two weights for body (400/500) plus bold for headings.

**Motion:** 150 to 300ms fades and slides, a gentle floating hero preview, animated connector lines in the hero. All of it respects `prefers-reduced-motion`.

## Global shell
- **Top bar** on every page: logo, nav links (Home, Features, Learn, Docs) with an active state, theme toggle, and a "Get Started" button. On screens under 900px it collapses into a menu button with a slide-down panel. The Visualizer pages use a compact version with page-specific actions on the right.
- **Footer:** simple, with the same links and a short line about the project.
- **Routes:** `/` Home, `/get-started`, `/visualizer/python`, `/visualizer/data-structures` (also `/visualizer/data-structures/:type`), `/learn`, `/learn/:section/:lesson`, `/docs`, `/docs/:page`, `/about`, and a friendly 404. Add `vercel.json` with a rewrite of all paths to `/index.html` so refreshing a page works on Vercel.
- Each page has its own `<title>` and meta description.

## Pages in detail

### 1. Home
- Left: a small pill ("Visualize · Learn · Understand"), the headline, one supporting paragraph, and two buttons: **Start Visualizing** (primary, goes to `/get-started`) and **Explore Features** (secondary, scrolls to the feature strip).
- Right: a floating **preview card** that runs the **real engine** on a small program in a loop (code with the current line highlighted, a mini player showing "Step 3 / 8"), with three small cards beside it (Variables, Call Stack, Output) joined by animated connector lines. Do not use a static screenshot; build it from the real trace of a built-in example, and pause the loop when the tab is hidden.
- Feature strip of four items with icons: Step-by-step execution, Visualize variables, Function call stack, Supports multiple languages (soon).
- Subtle background: soft wave lines in dark, lavender gradient in light.

### 2. Get Started: choose a language
- Heading "Choose a Programming Language" and one sentence. A grid of language cards (4 columns on desktop, 2 on tablet, 1 on mobile).
- **Python** is highlighted (blue border), has an "Available now" chip and a "Start with Python" button that goes to `/visualizer/python`.
- JavaScript, Java, C++, C, C#, Go, Rust are **"Coming soon"**: visibly disabled, `aria-disabled`, not clickable. Optional "Notify me" can come later.
- **Logos:** do not copy trademarked logos from the mockup. Use a neutral monogram or simple icon tile for each language, and leave the Python tile text-based or use an officially allowed asset only if I provide it.

### 3. Python Visualizer (restyle the current playground; do not rebuild it)
- Layout from the mockup: back link and page title, then a two-column area. **Left:** the code panel (editor, then stepping view with the current-line highlight, as it works now). **Right:** the tabs.
- **Deliberate deviation (keep our teaching priority):** keep the **"What's happening" explanation card** (plain-English "Next" and "Just happened") permanently visible above the tabs, because beginners need it. Tabs: **Variables** (default, with the labelled value boxes, NEW/CHANGED notes, and before → after), **Execution Flow** (the call tree or flow view; for recursion show the calls as a nested chain like the mockup's main → factorial(4) → factorial(3)), **Call Stack**, **Output**. Tab bar styling follows the mockup (underlined active tab).
- Bottom player pinned: Back, Play, Next, a slider, and "Step 4 / 12". Header actions: **Run Code** (primary) and an examples menu. Add **Save** only when it really saves (to `localStorage` plus a shareable link); otherwise leave it out.
- Keep the one-screen layout at 1366×768 and up, with tabs on small screens.

### 4. Data Structure Visualizer (new feature; build in phases)
- Separate from the Python tracer. Each structure is a small **pure state machine** in `src/datastructures/` (for example `array.js`) that takes an operation and returns a list of **animation steps**: `{ state, highlight, message, opLogEntry }`. Unit-test every operation.
- **Phase A:** **Array** (initialize, access index, update index, insert, delete), **Stack** (push, pop, peek), **Queue** (enqueue, dequeue), **Linked List** (insert at head or tail, delete, search with the pointer moving). **Phase B:** Binary Tree (insert, search, traversals), Heap, Graph (BFS and DFS). Phase B comes after I have reviewed phase A.
- Layout from the mockup: left list of structures, centre canvas with the title, a one-line description, the cells or nodes with index labels, buttons (Insert / Update / Delete or the structure's operations) and input fields (Index, New value) with validation and friendly messages; right **Operations** panel: numbered steps ("Update index 2: 30 → 99") with the current one highlighted, clickable to jump. A **Run Example** button plays a scripted sequence with the same Back / Play / Next controls.
- Each step also shows a plain-English sentence ("Index 2 holds 30. We replace it with 99.") and the time cost where relevant (for example "Insert in the middle shifts later items: O(n)").

### 5. Learn
- Left collapsible sidebar tree exactly as in the mockup: **Getting Started** (Introduction, How CodeLens Works, Your First Program), **Python Basics**, **Control Flow**, **Functions**, **Data Structures**, **Examples**. Active item highlighted, expandable groups, collapsible into a drawer on mobile.
- Lesson content is Markdown files in `content/lessons/...` with frontmatter (title, section, order, time, summary). Build a small renderer that supports: headings, code blocks with a **"Visualize this"** button that opens the playground with that code, "What you'll learn" checklists, callouts, and a Previous / Next footer.
- Write **three real lessons now** as the template (Introduction, Your First Program, Variables), written in plain beginner language. Leave other entries as "Coming soon" instead of fake pages. Progress tracking can come later.

### 6. Documentation
- Left sidebar and a list of guide cards as in the mockup. Include only pages that are **real**: Getting Started, Python Visualizer guide, Data Structure Visualizer guide, Keyboard shortcuts, Supported Python (from `docs/supported-python.md`), and FAQ. **Leave out "API Reference"** because CodeLens has no API. Content as Markdown in `content/docs/`.

### 7. About
- Mission paragraph and four cards. Use **true** claims only: "Built for learners", "Free to use", "Runs in your browser" (no servers; your code stays on your device), "More languages planned". Show an "Open source" card **only if the repository is public**. Link to the feedback form and, if public, to GitHub.

## Shared components (build once, reuse)
`ThemeToggle`, `TopBar`, `Footer`, `Button` (primary, secondary, ghost), `Card`, `Chip`, `Tabs` (ARIA tab pattern with keyboard arrows), `Sidebar`, `PlayerBar`, `StepLog`, `CodePanel`, `Breadcrumb`, `EmptyState`, `Callout`, `MarkdownLesson`. Components take tokens only, no hard-coded colours.

## Quality bar
- **Accessibility:** semantic landmarks, a skip-to-content link, visible focus rings in both themes, full keyboard use, labelled controls, tab pattern done properly, no information carried by colour alone, 44px touch targets on mobile.
- **Performance:** code-split routes, lazy-load Pyodide only on the visualizer pages, no layout shift on load, and the hero preview should not block first paint.
- **Honesty:** nothing in the UI may claim a feature that does not exist. Fix typos from the mockups (for example "Ret Started" in the light Docs mock).
- Never a blank screen: loading, empty, error, and 404 states for every page.

## Order of work (stop and show me after each stage)
1. **Tokens, theme system, shell** (top bar, footer, router, `vercel.json`), plus a theme preview page.
2. **Home** page (with the live preview card) and **Get Started**.
3. **Python Visualizer** restyled into the new shell and tabs.
4. **Learn** (layout, renderer, three lessons), **Docs**, **About**, 404.
5. **Data Structure Visualizer, phase A** (Array first, then Stack, Queue, Linked List).
6. Polish pass: both themes side by side against the mockups, accessibility audit, mobile pass.
7. Data Structure Visualizer, phase B.

## Acceptance checks
- Each page matches the mockup's layout and feel in **both** themes at 1440px, adapts cleanly at 1024px and 375px, and has no overlapping or clipped text.
- The theme toggle works everywhere with no flash on reload, and the choice is remembered.
- Direct links and refresh work on every route (check on the Vercel preview).
- The Python Visualizer still passes all existing tests and works for any program.
- Every data structure operation has unit tests, and the operations log matches what the canvas shows.
- Lighthouse accessibility is 95 or higher on every page. All tests, lint, and build pass.

## Report back
For each stage: files changed, screenshots in both themes, deviations from the mockups and why, and anything you left out. Wait for my review before the next stage.
