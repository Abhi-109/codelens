# Supported Python

What CodeLens can trace, and what it says when it cannot.

This document is a promise, and it is kept by a test: every category below has
a small program in `tracer-poc/corpus.py`, `tracer-poc/test_corpus.py` checks
that each one runs exactly as documented, and its real trace is vendored for
the JavaScript tests in `src/tracer/__fixtures__/corpus.json.gz`. If a
construct is not in the table, it has no test behind it — the tracer may still
handle it, but only the trace itself is promised, never a particular
explanation.

Trace format version 3 (`docs/trace-format.md`), traced by `tracer-poc/tracer.py`
inside Pyodide in the browser.

## Statuses

| Status | What the learner sees |
| --- | --- |
| **traced** | The full trace: every line, call, return and value, step by step. |
| **stopped** | The run stopped early and says so: a step limit, an output limit, or a clock timeout. Whatever ran before the stop is still traced. |
| **error** | The program failed and the failing line is pointed at. Everything before it is still traced. |

## What is covered

| Category | What it covers | Programs | Status |
| --- | --- | --- | --- |
| basic variables | int, float, str, bool, None in one assignment each | `variables`, `assign-only` | traced |
| basic variables | arithmetic and a branch with no collections at all | `scalars-only` | traced |
| strings | f-strings, concatenation, methods, slicing | `strings` | traced |
| numbers | integer and float arithmetic, large integers, 0.3000…004 | `numbers` | traced |
| booleans | and, or, not, chained comparisons | `booleans` | traced |
| if / elif / else | one branch of three, a nested condition, plus the one-line conditional expression | `if-elif-else`, `if-nested`, `ternary` | traced |
| for loop | iterating a range | `for-loop` | traced |
| while loop | counting down, `while`/`else` | `while-loop` | traced |
| break and continue | leaving a loop early, skipping one pass | `break-continue` | traced |
| nested loops | a loop inside a loop | `nested-loops` | traced |
| lists | index, slice, append, len | `list-basics`, `list-print-element` | traced |
| lists | a list of lists, changed from the inside | `nested-lists` | traced |
| lists | duplicate values sorted, and an empty list grown by one | `list-duplicates` | traced |
| mutating a list | sort, reverse, replace a slot, delete a slot | `list-mutation` | traced |
| mutating a list | insert at the front, append, pop the front, delete a slot | `list-insert-pop` | traced |
| mutating a list | an already-sorted list, and a reverse-sorted list sorted then reversed | `sort-orders` | traced |
| tuples and unpacking | unpacking a pair and swapping two names | `tuple-unpack` | traced |
| dictionaries | add, update, look up, iterate the items | `dict-basics` | traced |
| dictionaries | a dictionary holding lists (the group-by pattern) | `dict-nested` | traced |
| dictionaries | remove a key with `del` and `pop`, then update another | `dict-remove` | traced |
| sets | membership, intersection, difference | `set-basics` | traced |
| aliasing | two names for one list, and one dictionary kept twice in a list | `alias-shared`, `alias-dict-in-list` | traced |
| comprehensions | list and dict comprehensions, with a filter | `comprehension` | traced |
| functions | a call, a parameter, a return value | `function-basic`, `function-return-none`, `function-implicit-none`, `function-print-return` | traced |
| functions | early returns from more than one exit, called in a loop | `function-early-return` | traced |
| function arguments | default values, keyword arguments | `function-args` | traced |
| function arguments | `*args` and `**kwargs` | `function-star-args` | traced |
| scope | a function changing a global | `scope-global` | traced |
| scope | a nested function remembering its parent (closure) | `scope-closure` | traced |
| lambdas | an anonymous function passed as a key | `lambda-key` | traced |
| recursion | factorial, one frame per call | `recursion` | traced |
| recursion | two functions calling each other | `recursion-mutual` | traced |
| recursion | recursion that walks a list | `combo-recursion-list` | traced |
| functions calling functions | a helper used by a caller used by the program | `call-chain` | traced |
| nested loops calling functions | a helper called from inside two loops | `combo-nested-loop-call` | traced |
| exceptions | try, except, else, finally | `exception-caught` | traced |
| exceptions | raising and catching your own error class | `exception-custom` | traced |
| exceptions | a bare raise re-raises after cleanup | `exception-reraise` | traced |
| exceptions | one bad value inside a loop, caught there | `combo-exception-loop` | traced |
| runtime errors | ZeroDivisionError, IndexError, NameError end the run on the failing line | `error-division`, `error-index`, `error-name` | error |
| syntax errors | the program never started, so there is nothing to trace | `error-syntax` | error |
| classes | a class with `__init__` and a method that mutates state | `class-basic` | traced |
| class inheritance | a subclass reusing and overriding its parent | `class-inheritance` | traced |
| classes | a property and a class-level attribute | `class-property` | traced |
| classes | objects kept in a dictionary, built in a loop | `combo-class-loop-dict` | traced |
| imports | `import math` and `from math import sqrt` | `import-module` | traced |
| input and output | `input()` with the values the app supplies, and `print` | `io-input` | traced |
| input and output | two prompts, each answer paired with its own prompt | `io-two-inputs` | traced |
| input and output | `print` with `sep` and `end` | `io-print-options`, `io-empty-print` | traced |
| generators | a function that yields, driven by a for loop | `generator` | traced |
| generators | `yield from` passing values through | `generator-delegates` | traced |
| async and await | an async function run with `asyncio.run` | `async-await` | traced |
| safety limits | a loop that never ends is stopped at the step limit | `limit-steps` | stopped |
| safety limits | one enormous print is stopped at the output limit | `limit-output` | stopped |
| safety limits | a program that waits is stopped on the clock | `limit-timeout` | stopped |
| comparisons | a custom comparison returning a non-boolean, and a chained comparison left uncaptured | `compare-custom-result`, `compare-chained` | traced |

## Comparisons

A comparison is recorded as its own event with its two operands, the operator and, when it
really produced one, a boolean outcome. That is what lets the visualizer mark the two cells
that were compared instead of guessing them from the source line.

| Case | What you get |
| --- | --- |
| `a > b`, `a[i] < a[j]`, `x in xs`, `a is b` | One `compare` event per evaluation, with both operands and their cells |
| A custom rich comparison | The operands and operator, `result: null`; the object it returned is never truth-tested |
| A comparison that raises | The operands and operator, `result: null`, then the exception events |
| A chained comparison (`a < b < c`) | No `compare` event; the comparison runs exactly as written |
| An operand containing `yield`, `yield from` or `await` | No `compare` event |

Comparisons add events but not steps: the step counter still counts source lines.

## Execution support vs. visual animation

Every program in the table is executed by the real tracer and can be stepped. Lines,
variables, calls, returns, printed output and exceptions are traced for all of them,
including programs that never touch a collection.

The motion canvas is a narrower promise. It draws a list, tuple, set, dictionary or object
only when the trace shows that value, and it animates a change only when two real snapshots
prove what changed:

| Visual operation | When it is drawn |
| --- | --- |
| swap | two neighbouring cells exchange values; one verified `move.swap` per pair |
| shift | one adjacent assignment moves a value into its neighbour's slot |
| insert / grow | an item is added at a known index (`append`, `insert`, a longer slice) |
| pop / delete / shrink | an item disappears from a known index (`pop()`, `pop(i)`, `del a[i]`) |
| change | a cell, dictionary entry or object attribute keeps its place and gets a new value |
| compare | a recorded comparison rings its two operand cells in gold; it never moves anything |
| settled green | a completed run proves a position final (the list ends sorted and was rearranged in place); the mark survives later steps |

When the evidence is not enough — a reorder with duplicate values, an ambiguous delete, a
construct the line-shape parser does not recognise — the canvas states what it can and leaves
the state still. It never invents a move or a cell. A program with no collection values is
still useful: it shows the line, variables, call stack, explanation and output, and the value
area says there is nothing to draw. A comparison operand with a negative or non-integer
(dictionary) index has no cell to ring, so only its sentence is shown.

## Limits, and what the app says instead

The tracer is deliberately bounded, so one program can never freeze the page —
and when it stops short it says so rather than inventing the rest:

| Limit | Value | What you see |
| --- | --- | --- |
| Steps per run | 1500 (the app), 400 (corpus tests) | A "step limit" event; the last state is the real one. |
| Seconds per run | 5.0 (the app), 1 second (corpus tests) | A "timeout" event. |
| Output characters | 10 000 | An "output limit" event; the printed text is a cut-short prefix. |
| Items per container | 30 | The value reads `… 27 more`. |
| Characters per string | 120 | The string is shown with `…`. |
| Heap objects per snapshot | 150 | A reference whose object is missing reads `(not shown at this step)` — never a raw object id. |

Other honest outcomes, each produced by a real run rather than special-cased
text:

* **`input()` with no values given** ends the run with `EOFError`, and the
  message says the program asked for input but none was supplied. The app
  passes the values you type into its "Values for input()" box.
* **A module that is not installed in the Pyodide build** raises
  `ModuleNotFoundError` on the import line, exactly as it would locally.
* **Sets are listed in sorted order** so traces are deterministic.
* **Nothing is guessed from the source.** Every value shown comes from the
  trace; if the trace does not have one, the app says it does not have one.

## Adding a program

1. Add it to `tracer-poc/corpus.py` with its category, title, source and the
   status it must have.
2. Run `python tracer-poc/dump_corpus.py --write`, read the diff in
   `tracer-poc/corpus-golden.json` (its stdout, especially, is worth reading),
   and commit it with the program.
3. Add the category and program name to the table above.
4. `npm run test:tracer` and `npm run test:js` now cover it, per program and
   per step.
