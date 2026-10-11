# CodeLens: Scope

## Product
**CodeLens** is a free, in-browser tool where anyone can write code and watch it run step by step as diagrams and plain-English explanations. It is built so that a complete beginner can understand what their code is doing, with no prior coding knowledge.

*(Name is a placeholder and can change.)*

## Why it exists
Many code-visualization tools lock their best features behind a paid plan, and most explain things in jargon. CodeLens stays free (code runs in the user's browser, so there are no server costs) and explains every step in everyday words.

## Who it's for
**Version 1:** complete beginners learning to code, especially school students and first-year college students.

**Later versions:** placement-prep students (DSA) and career switchers or self-learners.

## Language
- **v1:** Python only.
- **Later:** JavaScript, then possibly Java or C++. The tracer outputs a language-neutral JSON format, so adding a language means adding one new tracer.

## Product principles
1. **Beginner first.** If a total beginner can follow it, it's right.
2. **Show, then explain.** Every step has a diagram and a plain-English sentence.
3. **Free and in-browser.** No accounts and no servers in v1.
4. **Small examples.** Encourage short inputs so visuals stay readable.
5. **Always demoable.** The project works at the end of every work session.

## How it works (high level)
1. **Tracer:** runs the user's Python (via Pyodide) and records every step as JSON: line number, variables, objects and references, call stack, and output.
2. **Visual engine:** reads the JSON and draws variables as boxes, lists as numbered slots, function calls as stacked cards, and the code as a flowchart.
3. **Teaching layer:** turns each step into a plain-English sentence and shows short concept cards the first time a concept appears.

The visual and teaching layers never depend on the language, only on the JSON format.

## Topics

### Level 1: Basics (v1)
- Variables and data types
- Input and output
- if / elif / else
- for and while loops
- Functions (parameters, return values)

### Level 2: Intermediate (v1)
- Lists and dictionaries
- Strings
- Nested loops
- Recursion (call stack and recursion tree)
- Classes and objects

### Level 3: Advanced and DSA (v2)
- Searching and sorting (animated bars)
- Stacks and queues
- Linked lists
- Trees and BST operations, traversals
- Graphs (BFS and DFS)
- Dynamic programming (table filling)
- Backtracking and greedy algorithms
- Step counts and Big-O comparison

## First 10 example programs
1. Variables and data types
2. if / else
3. A for loop that adds numbers
4. A while loop that counts down
5. Lists (append and index)
6. Dictionaries
7. A function and its call
8. Recursion (factorial)
9. Nested loops (bubble sort)
10. A class and an object

Each example doubles as a test case for the tracer.

## v1 features
- Code editor with example gallery
- Step controls: Back, Next, Play/Pause, speed, slider, and keyboard arrows
- Variables as labeled boxes, with flashes when values change
- Lists and dictionaries as diagrams
- Call stack view, including recursion
- Flowchart with the current step highlighted and run counts
- Plain-English explanation for every step
- Concept cards and a small glossary
- Works on phone and laptop, with light and dark themes

## Not in v1
- Languages other than Python
- Kannada (or other language) explanations
- User accounts and saved programs
- AI-generated explanations
- Trees, graphs, sorting bars, and DP visuals (v2)
- Multithreading, async code, and low-level memory topics

## Later ideas
Predict mode ("what happens next?"), side-by-side algorithm comparison, shareable links, Kannada explanations, JavaScript support.

## Milestones
| Week | Goal |
|---|---|
| 1 | Repo, Vite + React app, this scope doc |
| 2 | Python tracer proof of concept (Pyodide, step JSON) |
| 3 | Solid tracer: call stack, output, errors, step limit; passes all 10 examples |
| 4 | First visuals: variable boxes and step controls |
| 5+ | Lists, dictionaries, flowchart, teaching layer, gallery, polish |
| Later | Real users, README with GIFs, demo video, make repo public |

## Definition of done for v1
- All 10 example programs trace and visualize correctly.
- A non-coder (a roommate, for example) can follow a program without help.
- Works on phone and laptop.
- Deployed, with a public link, a README, and a demo video.
- At least 20 real people have tried it.
