# Supported Python

What CodeLens can trace, and what it says when it cannot.

This document is a promise, and it is kept by a test: every category below has
a small program in `tracer-poc/corpus.py`, `tracer-poc/test_corpus.py` checks
that each one runs exactly as documented, and its real trace is vendored for
the JavaScript tests in `src/tracer/__fixtures__/corpus.json.gz`. If a
construct is not in the table, it has no test behind it — the tracer may still
handle it, but only the trace itself is promised, never a particular
explanation.

Trace format version 2 (`docs/trace-format.md`), traced by `tracer-poc/tracer.py`
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
| basic variables | int, float, str, bool, None in one assignment each | `variables` | traced |
| strings | f-strings, concatenation, methods, slicing | `strings` | traced |
| numbers | integer and float arithmetic, large integers, 0.3000…004 | `numbers` | traced |
| booleans | and, or, not, chained comparisons | `booleans` | traced |
| if / elif / else | one branch of three, plus the one-line conditional expression | `if-elif-else`, `ternary` | traced |
| for loop | iterating a range | `for-loop` | traced |
| while loop | counting down, `while`/`else` | `while-loop` | traced |
| break and continue | leaving a loop early, skipping one pass | `break-continue` | traced |
| nested loops | a loop inside a loop | `nested-loops` | traced |
| lists | index, slice, append, len | `list-basics` | traced |
| mutating a list | sort, reverse, replace a slot, delete a slot | `list-mutation` | traced |
| tuples and unpacking | unpacking a pair and swapping two names | `tuple-unpack` | traced |
| dictionaries | add, update, look up, iterate the items | `dict-basics` | traced |
| dictionaries | a dictionary holding lists (the group-by pattern) | `dict-nested` | traced |
| sets | membership, intersection, difference | `set-basics` | traced |
| comprehensions | list and dict comprehensions, with a filter | `comprehension` | traced |
| functions | a call, a parameter, a return value | `function-basic` | traced |
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
| exceptions | one bad value inside a loop, caught there | `combo-exception-loop` | traced |
| runtime errors | ZeroDivisionError, IndexError, NameError end the run on the failing line | `error-division`, `error-index`, `error-name` | error |
| syntax errors | the program never started, so there is nothing to trace | `error-syntax` | error |
| classes | a class with `__init__` and a method that mutates state | `class-basic` | traced |
| class inheritance | a subclass reusing and overriding its parent | `class-inheritance` | traced |
| classes | a property and a class-level attribute | `class-property` | traced |
| classes | objects kept in a dictionary, built in a loop | `combo-class-loop-dict` | traced |
| imports | `import math` and `from math import sqrt` | `import-module` | traced |
| input and output | `input()` with the values the app supplies, and `print` | `io-input` | traced |
| input and output | `print` with `sep` and `end` | `io-print-options` | traced |
| generators | a function that yields, driven by a for loop | `generator` | traced |
| generators | `yield from` passing values through | `generator-delegates` | traced |
| async and await | an async function run with `asyncio.run` | `async-await` | traced |
| safety limits | a loop that never ends is stopped at the step limit | `limit-steps` | stopped |
| safety limits | one enormous print is stopped at the output limit | `limit-output` | stopped |
| safety limits | a program that waits is stopped on the clock | `limit-timeout` | stopped |

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
