# The run story

`src/tracer/runStory.js` turns one execution trace into a few plain-English
sentences: what the program does as a whole — which lines repeat, how many
rounds, with what values, what grows, and how it ends. The card above the canvas
(`src/visualizer/RunStoryCard.jsx`) renders those sentences and makes each one a
button to the step where it happens.

The story exists because a step view cannot answer a beginner's first question.
"Line 3 is about to run and `total` is 10" is true, and it is not the same as
"lines 2–3 repeat five times and add 1, 2, 3, 4, 5 to `total`". The rule that
produces forty steps is invisible in any one of them; the story states it.

## Parts

A story has at most eight parts, in run order, each pointing at a real step:

| Kind | What it says |
|---|---|
| `start` | The lines that ran before the first repetition or call |
| `repeat` | A loop that actually repeated: its lines, rounds, value chains |
| `call` | A call: how often, with what arguments, what came back; recursion uses the call depth and the return chain |
| `finish` | What ran after the last part, including real printed text |
| `run` | A straight-line program: the lines in order, no repetition claimed |
| `error` | The line and exception that stopped the run |
| `limit` | The safety limit that stopped the run |

`sectionAt(story, index)` answers which part the current step is inside; when
parts overlap (a call inside a loop, a loop inside a called function), it picks
the smallest range, so the most specific part is the one marked.

A `repeat` part also carries `roundJumps`: the header step of every round. The
card uses them for "Round 3 of 5" and its previous/next round buttons, so a
long loop can be stepped a round at a time without leaving the map.

## What is counted, and how

- **Rounds are body executions, not header visits.** A `for` loop visits its
  header one extra time to discover the iterator is exhausted; a `while` loop
  visits its header one last time to read `False`. Neither is a round. A round
  is a header visit followed by a body line, or, for a one-line loop, a visit
  after which the frame's state changed (or output/a call/a raise happened).
- **The loop variable's values are read at the body**, because Python assigns a
  `for` target before the first body line runs. Reading the header state would
  shift every value one round late. For a one-line loop, the variable's distinct
  values inside the loop are used only when their count equals the round count.
- **The chain is the value that changed in the most rounds and took the most new
  values**, so an accumulator that keeps growing wins over a counter that resets
  each round. Its links are the values the trace recorded, in order.
- **A loop is only called a loop when the source agrees.** The header line must
  start with `for`/`while` (or hold a comprehension `for … in`). A repeated
  decorator line in a class body is a repeat in the trace and not a loop in the
  program, so it is not reported as one.
- **A class is created under its own name.** `self` in the `__init__` frame
  points at the heap object, whose `class` field names the subclass; the base
  class is never reported for a subclass instance.
- **A constructor's `__init__` is the creation, not a separate call**, and
  comprehension frames (Python's `<listcomp>`-style helpers) are not calls the
  learner wrote.

## What it does not claim

Some shapes are deliberately left out rather than guessed:

- A loop inside a function that is called more than once has no single round
  count (it is rounds × calls), so its call part counts the calls and the inner
  loop is not described as one number.
- A loop nested inside another loop is included in the outer part's range, but
  the inner loop is not given its own "repeats N times" sentence — per-round
  counts vary, and a total would mislead.
- A one-line loop whose variable's values cannot be matched to its rounds gets
  the round count and the body change, not a value list.
- Printed text is shown for `run`/`finish` parts only, because output produced
  by a loop's final check cannot always be attributed to a round.

## Tests

`src/tracer/runStory.test.mjs` runs all 60 corpus programs through the story and
checks each part's range, jump target, ordered position and wording, that a
`repeat` header is a real loop line, and that every chain value is a value the
variable actually held. Exact stories are asserted for a `for` loop, a `while`
loop, nested loops, a `break`, recursion, a subclass and an error, so a change
in wording or counting has to be deliberate.
