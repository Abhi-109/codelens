/* The lessons, as data.
 *
 * Every lesson is a page at /learn/:section/:lesson, and every claim here has
 * to match what the visualizer actually does. That is why the lessons live in
 * a plain module: lessons.test.mjs can check that each one has objectives, a
 * runnable example from src/examples.js, and at least one checkpoint, without
 * a browser or a React renderer.
 *
 * A block is one of:
 *   { p: "paragraph" }
 *   { h: "sub-heading" }
 *   { list: ["item", "item"] }
 *   { note: "one honest aside" }
 */

export const LESSON_SECTIONS = [
  {
    id: "getting-started",
    title: "Getting started",
    lessons: [
      {
        id: "introduction",
        title: "Introduction to CodeLens",
        summary:
          "What a step is, what the two panels show, and why every value you see was recorded rather than guessed.",
        objectives: [
          "Explain what one step of a run is.",
          "Tell the code panel and the animation panel apart.",
          "Know why CodeLens never shows a value the trace did not record.",
        ],
        exampleId: "statements",
        body: [
          {
            p: "CodeLens runs a Python program in your browser, records what happened, and then lets you move through that recording one step at a time. The recording is called a trace.",
          },
          { h: "What a step is" },
          {
            p: "The tracer writes one event each time something real happens: a line is about to run, a function is called, a function returns, a comparison is made, text is printed, or an error is raised. A step in CodeLens is one of those events. Two steps can therefore show the same source line — the line about to run, and the comparison that line performed.",
          },
          {
            list: [
              "The code panel on the left marks the line the current event belongs to.",
              "The animation panel on the right draws the data that event touched.",
              "Inspect, below the animation, holds the recorded details: variables, the call stack, memory, output and the change history.",
            ],
          },
          { h: "Nothing is filled in" },
          {
            p: "The panels read the trace. If the trace has no value for a name, no panel invents one; if a position is not proven final, it is not painted green. That rule is the reason the animation can be trusted while you are learning: what you see is what the program did.",
          },
          {
            note: "You do not need an account and your code is not uploaded. Python runs locally in a Web Worker.",
          },
        ],
        checkpoints: [
          {
            q: "Why can two different steps show the same line of code?",
            a: "Because a line about to run and a comparison on that line are two separate recorded events. The comparison event is what lets the visualizer mark the exact two values that were compared.",
          },
          {
            q: "What does a green ring around a value mean?",
            a: "The recording proves that position settled — for example, the end of a sort. It is never painted on a position the run has not reached.",
          },
        ],
      },
      {
        id: "first-program",
        title: "Your first Python program",
        summary:
          "Read a short program one recorded event at a time: assignment, re-assignment, then output.",
        objectives: [
          "Follow a program from its first line to its last event.",
          "Use the Variables and Output tabs to confirm what happened.",
          "Predict the next step before you press Next.",
        ],
        exampleId: "variables",
        body: [
          {
            p: "This program gives five names values, then prints two of them. Open it in the visualizer, press Run, and step forward once.",
          },
          { h: "Read the run in order" },
          {
            list: [
              "The first event is the module call. It has no source line yet, so the code panel has nothing marked.",
              "Each assignment is one line event. The Variables tab shows the name and its value after that line runs.",
              "The print is a line event followed by an output event. The Output tab shows the text the program wrote.",
            ],
          },
          {
            p: "The animation shows only what moved. A step that changes nothing still has a sentence, but it does not pretend a value changed.",
          },
          {
            note: "Use the left and right arrow keys to step, or Space to play and pause. The step slider jumps anywhere in the run.",
          },
        ],
        checkpoints: [
          {
            q: "Which line runs first, and what is the very first event?",
            a: "The first event is the module call at line 0; line 1 is the first line event. The module call is bookkeeping for the program itself, not a line of your code.",
          },
          {
            q: "After the last step, what does the Output tab hold?",
            a: "Exactly the text the program printed — here `Asha 12` — and nothing the program did not print.",
          },
        ],
      },
    ],
  },
  {
    id: "python-basics",
    title: "Python basics",
    lessons: [
      {
        id: "variables-and-structures",
        title: "Variables, values and structures",
        summary:
          "What a name holds, how lists and dictionaries are drawn, and why two names can share one object.",
        objectives: [
          "Distinguish a name from the value it points at.",
          "Read a list and a dictionary as structures, not as text.",
          "Recognise aliasing: two names for the same object.",
        ],
        exampleId: "aliasing",
        body: [
          {
            p: "A variable is a name pointing at a value. For a number or a string, the value is the whole story. For a list or a dictionary, the value is an object that other names can point at too.",
          },
          { h: "A name is not the value" },
          {
            p: "The Variables tab lists names in the current call. The Memory tab shows the objects those names reach: a list with its slots, a dictionary with its keys, and the arrows from each name to the object it points at.",
          },
          { h: "One object, two names" },
          {
            p: "In this example `second = first` does not copy the dictionary. It makes a second name for the same object, so appending to `second[\"scores\"]` is visible through `first` as well. The Memory tab draws both names arriving at one dictionary; that shared arrow is the aliasing.",
          },
          {
            note: "Appending to a list inside a dictionary changes the dictionary's contents without reassigning the name. The change history records that as a change to the list's slots.",
          },
        ],
        checkpoints: [
          {
            q: "Why does changing `second` also change `first`?",
            a: "Both names point at the same dictionary. The append changes the list inside that one object, so every name that reaches it sees the new item.",
          },
          {
            q: "What does the Memory tab show that Variables does not?",
            a: "The objects and the arrows between them: which names share one list or dictionary, and what each object contains at this step.",
          },
        ],
      },
      {
        id: "conditionals-and-loops",
        title: "Conditions and loops",
        summary:
          "Follow a loop pass by pass and see which branch a condition chose, with the values that decided it.",
        objectives: [
          "Read a condition as a recorded comparison.",
          "Follow one pass of a loop at a time.",
          "Explain why a branch was taken or skipped.",
        ],
        exampleId: "even-sum",
        body: [
          {
            p: "This program adds the even numbers from 1 to 5. It is small on purpose: the loop and the branch are the whole program.",
          },
          { h: "A comparison is its own step" },
          {
            p: "The tracer records each supported comparison with both operands and the outcome. That is why CodeLens can show `Compare 2 % 2 == 0 → True` as its own step, instead of asking you to work it out from the line.",
          },
          { h: "One pass at a time" },
          {
            list: [
              "The for line runs once per value in the range.",
              "The if line runs once per pass; its comparison step follows.",
              "Only the pass that takes the branch changes `total`.",
              "When the loop ends, the print line runs once.",
            ],
          },
          {
            note: "Control flow mode draws the loop and both branches, and lights up the path this run actually took.",
          },
        ],
        checkpoints: [
          {
            q: "How many times does the if line run, and how many times does `total` change?",
            a: "The if line runs five times, once per value. `total` changes twice — on 2 and on 4 — because the other passes take the skipped branch.",
          },
          {
            q: "Where can you see which values the comparison used?",
            a: "In the comparison step itself: the animation names both operands and the outcome, and the Explain tab gives the same fact in a sentence.",
          },
        ],
      },
    ],
  },
  {
    id: "functions",
    title: "Functions",
    lessons: [
      {
        id: "functions-and-returns",
        title: "Functions, the call stack and return values",
        summary:
          "A call opens a frame, a return closes it, and the value comes back to the caller.",
        objectives: [
          "Explain what a call frame is.",
          "Read the call stack top to bottom.",
          "Follow a return value back into the caller.",
        ],
        exampleId: "functions",
        body: [
          {
            p: "A function call is a recorded event of its own. It opens a frame with its own parameters and local names; when the function returns, the frame closes and the value goes back to whoever called it.",
          },
          { h: "The stack is the open calls" },
          {
            p: "The Stack tab lists the frames that are open at this step, newest on top. The module frame is always at the bottom. Selecting a frame only changes whose variables you are reading — it never moves the step.",
          },
          { h: "A return carries a value" },
          {
            p: "The return event records the value the function handed back. The animation prints that value on the frame that returned it, so you can watch `message` become the caller's result without guessing.",
          },
          {
            note: "A function with no return statement hands back None, and the trace says so. That is not the same as a function that failed.",
          },
        ],
        checkpoints: [
          {
            q: "What appears in the stack while `greet` is running?",
            a: "Two frames: `greet` on top with its own `name` and `message`, and the module frame below it.",
          },
          {
            q: "After the return, where is the value?",
            a: "It is the result of the call expression on the print line, so the caller uses it there. The closed frame's names are gone from the stack.",
          },
        ],
      },
    ],
  },
  {
    id: "errors",
    title: "Errors",
    lessons: [
      {
        id: "exceptions",
        title: "When Python raises an error",
        summary:
          "A caught error keeps running; an uncaught one unwinds the stack and stops the program. Both are recorded.",
        objectives: [
          "Tell a caught exception from an uncaught one.",
          "Read an unwind as a frame leaving because of an error.",
          "Find the final error and the line that caused it.",
        ],
        exampleId: "exceptions",
        body: [
          {
            p: "The first division is fine. The second divides by zero, and the function catches it. The third divides by zero again, gets None back, and then adds one to it — which raises an error nothing catches.",
          },
          { h: "Caught" },
          {
            p: "A caught exception is recorded where it was raised, and the except branch runs next. The run continues, so the trace continues. The animation says the handler caught it.",
          },
          { h: "Uncaught" },
          {
            p: "An uncaught exception records an unwind for each frame it leaves, then an error event that ends the run. The code panel points at the failing line, and the Output tab keeps everything printed before it.",
          },
          {
            note: "A syntax error is different: the program never starts, so there is no trace to step through. CodeLens says that plainly instead of showing an empty canvas.",
          },
        ],
        checkpoints: [
          {
            q: "Why does the second division not stop the program?",
            a: "The except branch catches ZeroDivisionError inside `divide`, so the function returns None and the run continues.",
          },
          {
            q: "What ends the run, and on which line?",
            a: "Adding 1 to None raises a TypeError that nothing catches, so the run ends on the last print line.",
          },
        ],
      },
    ],
  },
  {
    id: "practice",
    title: "Practice",
    lessons: [
      {
        id: "sorting-in-practice",
        title: "Practice: watch a sort",
        summary:
          "Use everything from the earlier lessons on a real algorithm: comparisons, a swap, and the moment the list is proven sorted.",
        objectives: [
          "Tell a comparison step from a swap step.",
          "Predict a swap from the comparison before it.",
          "Explain why the green rings appear only at the end.",
        ],
        exampleId: "bubble-sort",
        body: [
          {
            p: "Bubble sort compares neighbours and swaps them when they are out of order. In this run the list starts as [4, 2, 5, 1, 3].",
          },
          { h: "Compare, then swap" },
          {
            list: [
              "A comparison step marks the two values in gold and states the outcome.",
              "The swap step marks the same two positions in blue and moves them.",
              "A line that changes nothing still gets a sentence, so a quiet step is not a missing step.",
            ],
          },
          { h: "Green means proven" },
          {
            p: "Green rings appear only where the recording proves a position is final. Seeking backwards removes them again, because a later position is not evidence about an earlier one.",
          },
          {
            note: "Timeline mode lists every recorded step with its line, values and output — useful when you want to jump around instead of playing straight through.",
          },
        ],
        checkpoints: [
          {
            q: "The comparison says 4 > 2 is True. What should the next step do?",
            a: "It swaps the two values, so the cells move and the list becomes [2, 4, 5, 1, 3].",
          },
          {
            q: "Why is the whole list green only at the last step?",
            a: "The recording proves each position settled as the sort finishes; before that, only the positions it has already proven are green.",
          },
        ],
      },
    ],
  },
];

/** Every lesson in reading order, flattened, with its section attached. */
export const LESSON_ORDER = LESSON_SECTIONS.flatMap((section) =>
  section.lessons.map((lesson) => ({ ...lesson, section: section.id, sectionTitle: section.title })),
);

/** One lesson by section and id, or null when the pair names nothing. */
export function findLesson(sectionId, lessonId) {
  const section = LESSON_SECTIONS.find((entry) => entry.id === sectionId);
  if (!section) return null;
  const lesson = section.lessons.find((entry) => entry.id === lessonId);
  return lesson ? { ...lesson, section: section.id, sectionTitle: section.title } : null;
}

/** The lessons before and after this one, for the footer links. */
export function lessonNeighbours(sectionId, lessonId) {
  const at = LESSON_ORDER.findIndex(
    (entry) => entry.section === sectionId && entry.id === lessonId,
  );
  if (at < 0) return { previous: null, next: null };
  return {
    previous: at > 0 ? LESSON_ORDER[at - 1] : null,
    next: at < LESSON_ORDER.length - 1 ? LESSON_ORDER[at + 1] : null,
  };
}
