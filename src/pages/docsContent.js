/* The documentation pages, as data.
 *
 * Like the lessons, this is a plain module so node --test can check it. The
 * lists of visualization modes and Inspect tabs are generated from the code
 * that owns them, so a mode added to the workspace cannot silently be missing
 * from the page that explains it.
 */

import { INSPECTOR_TABS } from "../visualizer/workspace.js";
import { SPEED_OPTIONS } from "../visualizer/playback.js";
import { VIZ_BLURBS, VIZ_LABELS, VIZ_MODES } from "../visualizer/vizMode.js";

const TAB_NOTES = {
  explain: "the plain-English sentence for this step, its value changes and the concept it teaches",
  variables: "the names in the current call, with the state before and after the step",
  stack: "the calls that are open, newest on top; selecting one only changes whose variables you read",
  memory: "the objects the names reach and the arrows between them, so aliasing is visible",
  output: "everything printed up to this step, the input supplied, and any error",
  history: "every change to a watched name across the whole run",
};

export const DOC_PAGES = [
  {
    slug: "getting-started",
    title: "Getting started",
    summary: "Run a program, move through the recording, and know what the workspace remembers.",
    blocks: [
      {
        p: "CodeLens runs Python in your browser and records what happened. You then move through that recording one event at a time, with the code, the data and a sentence about each step on screen together.",
      },
      { h: "Run a program" },
      {
        list: [
          "Write or paste code in the Code panel, or pick a built-in example from the picker under it.",
          "Press Run. The first run loads the Python runtime, which can take a moment; after that it is already there.",
          "After a run the panel shows the executed lines instead of the editor. Press Edit to change the source; the header says “Source edited” until you run again.",
          "The restart button beside Run records the same source again from the first step.",
        ],
      },
      { h: "Move through the run" },
      {
        list: [
          "First, Step back, Play/Pause, Step forward and Last are the transport controls under the animation.",
          "The slider seeks anywhere in the run; the readout beside it shows the current step and the total.",
          `Playback speed is one of ${SPEED_OPTIONS.map((speed) => `${speed}×`).join(", ")}.`,
          "Left and right arrows step, Space plays or pauses. Keys are ignored while you are typing in the editor.",
          "On a narrow screen the Code and Visual Animation tabs switch between the two panels.",
        ],
      },
      { h: "What the workspace remembers" },
      {
        p: "Your theme, playback speed, chosen canvas, learning mode and column width are stored in this browser. Your code is not saved between visits and is never uploaded.",
      },
      {
        note: "The theme switch is in the top bar. Every colour in both themes is measured by the contrast tests, so a change to the palette cannot quietly make text unreadable.",
      },
    ],
  },
  {
    slug: "python-visualizer",
    title: "Python visualizer",
    summary: "The two panels, the six canvases, the Inspect tabs, and the one cursor they all share.",
    blocks: [
      {
        p: "The workspace has two panels. Code is on the left: the program, the line the current event belongs to, and the values that line used. Visual Animation is on the right: the canvas, the playback controls and the Inspect tabs.",
      },
      { h: "Visualization modes" },
      {
        p: "A mode is a different drawing of the same run. Switching canvas never moves the step, the playback state or the speed.",
      },
      { list: VIZ_MODES.map((mode) => `${VIZ_LABELS[mode]} — ${VIZ_BLURBS[mode]}.`) },
      { h: "Inspect" },
      {
        p: "The drawer under the animation holds six tabs. They all read the same recorded step, so they cannot disagree with each other.",
      },
      { list: INSPECTOR_TABS.map((tab) => `${tab.label} — ${TAB_NOTES[tab.id] ?? ""}`) },
      { h: "Events and the shared cursor" },
      {
        p: "The trace is an ordered list of events. Each event is one of: a line about to run, a call, a return, an exception, an unwind (a frame left because of an error), printed output, input read, a comparison, or one of the safety limits that stopped the run. Every event carries its step number, its function, its frame and its line.",
      },
      {
        p: "One cursor — the step number — is shared by every panel. That is why the code panel, the animation and all six Inspect tabs always describe the same moment. A line event means the line is about to run, so Variables shows the state before it and the change list says what the line will do.",
      },
      {
        p: "Seeking and stepping backwards render the target position directly instead of replaying the path. A seek plans no animation, so no highlight or settled mark can survive from a step you did not take.",
      },
      { h: "Where the sentences come from" },
      {
        p: "Every explanation is produced from the trace by tested functions. The learning mode (Beginner, Advanced, Textbook) changes the vocabulary and how much metadata is shown; it never changes an execution fact.",
      },
    ],
  },
  {
    slug: "supported-python",
    title: "Supported Python",
    summary: "What the tracer records, what it refuses, and the limits that stop a run.",
    blocks: [
      {
        p: "Python is the only language CodeLens traces today. The tracer records ordinary statements, functions, recursion, classes, exceptions, comprehensions, generators, imports and the built-in container types. The repository's corpus holds 68 programs across 34 categories, and each one is checked by both the Python and JavaScript test suites.",
      },
      { h: "Run statuses" },
      {
        list: [
          "Traced — the program ran and every step is in the trace.",
          "Stopped — a safety limit ended the run early; whatever ran before it is still traced.",
          "Error — a syntax error or an uncaught exception ended the run; the failing line is pointed at.",
        ],
      },
      { h: "Limits" },
      {
        list: [
          "A step limit stops a program that never ends.",
          "An output limit stops a program that prints without stopping.",
          "A wall-clock limit stops a program that waits.",
          "A syntax error means the program never started, so there is no trace to step through.",
        ],
      },
      {
        p: "Comparisons are recorded as their own events with both operands, the operator and the outcome. That is what lets the canvas mark the two values a comparison used rather than guessing them from the source line.",
      },
      {
        note: "The full table of supported constructs lives in docs/supported-python.md in the repository. If a construct is not in that table, it has no test behind it: the tracer may still handle it, but only the trace itself is promised.",
      },
    ],
  },
  {
    slug: "data-structures",
    title: "Data structures",
    summary: "A separate lab for arrays, linked lists, stacks, queues, trees and graphs.",
    blocks: [
      {
        p: "The data-structure lab is not the Python tracer. Its operations are authored for teaching: you apply an operation, the lab records the steps it produced, and you move through them with Back, Next, Reset and Play. Nothing on those pages claims to come from a Python run.",
      },
      { h: "What each structure offers" },
      {
        list: [
          "Array — append, insert, remove and search, with a capacity that doubles when it fills.",
          "Linked list — prepend, append, remove, search and a full traversal.",
          "Stack — push, pop and peek, with the top marked.",
          "Queue — enqueue, dequeue and peek, with front and back marked.",
          "Binary search tree — insert, search and an in-order traversal.",
          "Graph — breadth-first and depth-first traversal of a fixed example graph.",
        ],
      },
      { h: "How the steps work" },
      {
        p: "One operation produces one or more steps, and each step carries its own snapshot of the structure plus a sentence. Back, Next and seeking draw that snapshot directly, so a highlight from a later step cannot linger. An operation that cannot run — popping an empty stack, an index outside the array — says so and leaves the structure unchanged.",
      },
      { h: "What is deliberately not offered" },
      {
        p: "Tree deletion, graph editing and custom graph input are not implemented. Each page says so rather than showing a control that does nothing. The lab also keeps one copy of a duplicate tree value.",
      },
    ],
  },
  {
    slug: "faq",
    title: "FAQ",
    summary: "Short answers to the questions the workspace raises.",
    blocks: [
      { h: "Is my code uploaded anywhere?" },
      {
        p: "No. Python runs in a Web Worker in your browser. There is no server that receives your source, and there is no account.",
      },
      { h: "Why does the same line appear in more than one step?" },
      {
        p: "A line about to run and a comparison on that line are separate recorded events, and a loop line is recorded once per pass. Each is its own step with its own facts.",
      },
      { h: "Why is there no trace after a syntax error?" },
      {
        p: "The program never started, so nothing ran and nothing could be recorded. The code panel points at the error instead of showing an empty canvas.",
      },
      { h: "Why does nothing move on some steps?" },
      {
        p: "Because the recording proves nothing moved. The step still has a sentence, and a value is only highlighted when the trace names it as changed.",
      },
      { h: "Why is the canvas empty for a program with no lists or dictionaries?" },
      {
        p: "There is no structure to draw. The canvas says so and points at the call strip, where the scalar variables still update with each step.",
      },
      { h: "Do the data-structure pages use Python?" },
      {
        p: "No. They are a separate, hand-authored operation model for teaching the structures themselves. The page states that, and the steps are deterministic and tested.",
      },
      { h: "Which Python version runs?" },
      {
        p: "The Python runtime that Pyodide ships with this build. The tracer targets that runtime, and the corpus tests run against it.",
      },
    ],
  },
];

/** One documentation page by slug, or null when the slug names nothing. */
export function docBySlug(slug) {
  return DOC_PAGES.find((page) => page.slug === slug) ?? null;
}
