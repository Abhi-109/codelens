"""The supported-Python corpus: one small program per thing a learner can write.

Every program here is run by the real tracer (tracer-poc/tracer.py) in
test_corpus.py, and its exact trace is vendored for the JavaScript tests in
src/tracer/__fixtures__/corpus.json.gz. Together they are the promise behind
docs/supported-python.md: if a construct is listed as supported there, a
program in this file proves it, and if it is listed as a known limit, a program
here shows the honest result (a limit event or an error) rather than a made-up
one.

Fields
    name       fixture key, lowercase with dashes
    category   the label docs/supported-python.md uses
    title      one line for the run picker and reports
    source     the program
    status     the status run_trace must report for it
    inputs     values handed to input(), in order
    error_type the exception type, when status is "error"
    note       why a limit or error case is here, in the learner's words

The exact stdout of each program is not written here: it is recorded in
corpus-golden.json by dump_corpus.py, from a real run, and checked by the tests.
"""

# Every corpus program runs under the same limits, so the golden file and the
# browser agree: a program that needs more steps is a limit case, not a bug.
MAX_STEPS = 400
MAX_SECONDS = 1.0

CORPUS = [
    # --- values -------------------------------------------------------------
    {
        "name": "variables",
        "category": "basic variables",
        "title": "Four values, one per type",
        "source": (
            "name = 'Asha'\n"
            "age = 12\n"
            "height = 1.52\n"
            "is_student = True\n"
            "nothing = None\n"
            "print(name, age, height, is_student, nothing)\n"
        ),
    },
    {
        "name": "assign-only",
        "category": "basic variables",
        "title": "Two assignments with no output",
        "source": (
            "x = 1\n"
            "y = 2\n"
        ),
    },
    {
        "name": "strings",
        "category": "strings",
        "title": "F-strings, methods and slicing",
        "source": (
            "first = 'Code'\n"
            "second = 'Lens'\n"
            "joined = first + second\n"
            "print(joined.lower())\n"
            "print(f'{first} has {len(first)} letters')\n"
            "print(joined[4:8])\n"
        ),
    },
    {
        "name": "numbers",
        "category": "numbers",
        "title": "Integer and float arithmetic",
        "source": (
            "whole = 7 // 2\n"
            "rest = 7 % 2\n"
            "exact = 7 / 2\n"
            "big = 2 ** 10\n"
            "print(whole, rest, exact, big)\n"
            "print(0.1 + 0.2)\n"
        ),
    },
    {
        "name": "booleans",
        "category": "booleans",
        "title": "and, or, not and chained comparisons",
        "source": (
            "age = 20\n"
            "has_ticket = True\n"
            "can_enter = age >= 18 and has_ticket\n"
            "print(can_enter)\n"
            "print(not can_enter, can_enter or age > 100)\n"
            "print(0 < age < 100)\n"
        ),
    },
    # --- branches -----------------------------------------------------------
    {
        "name": "if-elif-else",
        "category": "if / elif / else",
        "title": "One branch of three runs",
        "source": (
            "marks = 68\n"
            "if marks >= 90:\n"
            "    grade = 'A'\n"
            "elif marks >= 60:\n"
            "    grade = 'B'\n"
            "else:\n"
            "    grade = 'C'\n"
            "print(grade)\n"
        ),
    },
    {
        "name": "ternary",
        "category": "if / elif / else",
        "title": "A one-line choice",
        "source": ("n = 4\nlabel = 'even' if n % 2 == 0 else 'odd'\nprint(f'{n} is {label}')\n"),
    },
    {
        "name": "if-nested",
        "category": "if / elif / else",
        "title": "One condition inside another",
        "source": (
            "n = 12\n"
            "if n > 0:\n"
            "    if n % 2 == 0:\n"
            "        kind = 'positive even'\n"
            "    else:\n"
            "        kind = 'positive odd'\n"
            "else:\n"
            "    kind = 'not positive'\n"
            "print(kind)\n"
        ),
    },
    # --- loops --------------------------------------------------------------
    {
        "name": "for-loop",
        "category": "for loop",
        "title": "Adding up a range",
        "source": ("total = 0\nfor n in range(1, 6):\n    total = total + n\nprint(total)\n"),
    },
    {
        "name": "while-loop",
        "category": "while loop",
        "title": "Counting down, then the else",
        "source": (
            "fuel = 3\n"
            "while fuel > 0:\n"
            "    print(fuel)\n"
            "    fuel = fuel - 1\n"
            "else:\n"
            "    print('Liftoff')\n"
        ),
    },
    {
        "name": "break-continue",
        "category": "break and continue",
        "title": "Skipping one pass, leaving early",
        "source": (
            "for n in range(1, 8):\n"
            "    if n == 3:\n"
            "        continue\n"
            "    if n == 6:\n"
            "        break\n"
            "    print(n)\n"
            "print('done')\n"
        ),
    },
    {
        "name": "nested-loops",
        "category": "nested loops",
        "title": "A grid of stars",
        "source": (
            "rows = 3\n"
            "line = ''\n"
            "for r in range(rows):\n"
            "    for c in range(r + 1):\n"
            "        line = line + '*'\n"
            "    line = line + '/'\n"
            "print(line)\n"
        ),
    },
    # --- collections --------------------------------------------------------
    {
        "name": "list-basics",
        "category": "lists",
        "title": "Index, slice, append, len",
        "source": (
            "fruits = ['apple', 'banana']\n"
            "fruits.append('cherry')\n"
            "first = fruits[0]\n"
            "pair = fruits[0:2]\n"
            "print(first, len(pair), fruits[-1])\n"
        ),
    },
    {
        "name": "list-mutation",
        "category": "mutating a list",
        "title": "Sort, reverse, replace and delete",
        "source": (
            "scores = [30, 10, 20]\n"
            "scores.sort()\n"
            "scores.reverse()\n"
            "scores[0] = 99\n"
            "del scores[2]\n"
            "print(scores)\n"
        ),
    },
    {
        "name": "list-print-element",
        "category": "lists",
        "title": "Append, then print one element",
        "source": (
            "fruits = ['apple', 'banana']\n"
            "fruits.append('cherry')\n"
            "print(fruits[2])\n"
        ),
    },
    {
        "name": "tuple-unpack",
        "category": "tuples and unpacking",
        "title": "Unpacking a pair and swapping",
        "source": (
            "point = (3, 4)\n"
            "x, y = point\n"
            "x, y = y, x\n"
            "print(x, y, x + y)\n"
        ),
    },
    {
        "name": "dict-basics",
        "category": "dictionaries",
        "title": "Look up, add, update, iterate",
        "source": (
            "ages = {'Asha': 12, 'Ravi': 13}\n"
            "ages['Meera'] = 11\n"
            "ages.update({'Ravi': 14})\n"
            "print(ages['Meera'])\n"
            "print(sorted(ages.items()))\n"
        ),
    },
    {
        "name": "dict-nested",
        "category": "dictionaries",
        "title": "A dictionary holding lists",
        "source": (
            "groups = {}\n"
            "groups.setdefault('fruit', []).append('apple')\n"
            "groups.setdefault('fruit', []).append('pear')\n"
            "groups['veg'] = ['kale']\n"
            "print(groups['fruit'], len(groups))\n"
        ),
    },
    {
        "name": "set-basics",
        "category": "sets",
        "title": "Membership and set algebra",
        "source": (
            "seen = {1, 2, 3}\n"
            "seen.add(4)\n"
            "print(2 in seen, 9 in seen)\n"
            "other = {3, 4, 5}\n"
            "print(sorted(seen & other))\n"
            "print(sorted(seen - other))\n"
        ),
    },
    {
        "name": "alias-shared",
        "category": "aliasing",
        "title": "Two names for one list",
        "source": (
            "numbers = [1, 2]\n"
            "alias = numbers\n"
            "alias.append(3)\n"
            "numbers[0] = 9\n"
            "print(numbers, alias)\n"
        ),
    },
    {
        "name": "alias-dict-in-list",
        "category": "aliasing",
        "title": "One dictionary kept twice in a list",
        "source": (
            "row = {'name': 'Asha'}\n"
            "rows = [row, row]\n"
            "rows[0]['score'] = 5\n"
            "print(rows[1])\n"
        ),
    },
    {
        "name": "comprehension",
        "category": "comprehensions",
        "title": "A list and a dict built in one line",
        "source": (
            "squares = [n * n for n in range(4)]\n"
            "by_letter = {c: 1 for c in 'ab'}\n"
            "double = [n * 2 for n in squares if n % 2 == 0]\n"
            "print(squares, double, sorted(by_letter))\n"
        ),
    },
    # --- functions ----------------------------------------------------------
    {
        "name": "function-basic",
        "category": "functions",
        "title": "A call, a parameter, a return",
        "source": (
            "def greet(name):\n"
            "    message = 'Hello, ' + name\n"
            "    return message\n"
            "\n"
            "result = greet('Asha')\n"
            "print(result)\n"
        ),
    },
    {
        "name": "function-return-none",
        "category": "functions",
        "title": "An explicit return None",
        "source": (
            "def label():\n"
            "    return None\n"
            "\n"
            "print(label())\n"
        ),
    },
    {
        "name": "function-implicit-none",
        "category": "functions",
        "title": "A function that ends without return",
        "source": (
            "def quiet():\n"
            "    x = 1\n"
            "\n"
            "print(quiet())\n"
        ),
    },
    {
        "name": "function-print-return",
        "category": "functions",
        "title": "A function that prints one value and returns another",
        "source": (
            "def report():\n"
            "    print('inside')\n"
            "    return 42\n"
            "\n"
            "print(report())\n"
        ),
    },
    {
        "name": "function-early-return",
        "category": "functions",
        "title": "Three exits, taken one at a time",
        "source": (
            "def classify(n):\n"
            "    if n < 0:\n"
            "        return 'negative'\n"
            "    if n == 0:\n"
            "        return 'zero'\n"
            "    return 'positive'\n"
            "\n"
            "for n in [-1, 0, 2]:\n"
            "    print(n, classify(n))\n"
        ),
    },
    {
        "name": "function-args",
        "category": "function arguments",
        "title": "Defaults and keyword arguments",
        "source": (
            "def greet(name, greeting='Hi'):\n"
            "    return f'{greeting}, {name}'\n"
            "\n"
            "print(greet('Asha'))\n"
            "print(greet('Ravi', greeting='Hello'))\n"
        ),
    },
    {
        "name": "function-star-args",
        "category": "function arguments",
        "title": "*args and **kwargs",
        "source": (
            "def total(*nums):\n"
            "    return sum(nums)\n"
            "\n"
            "def label(**named):\n"
            "    return sorted(named)\n"
            "\n"
            "print(total(1, 2, 3), label(b=2, a=1))\n"
        ),
    },
    {
        "name": "scope-global",
        "category": "scope",
        "title": "A function changing a global",
        "source": (
            "count = 0\n"
            "\n"
            "def bump():\n"
            "    global count\n"
            "    count = count + 1\n"
            "\n"
            "bump()\n"
            "bump()\n"
            "print(count)\n"
        ),
    },
    {
        "name": "scope-closure",
        "category": "scope",
        "title": "A nested function remembering its parent",
        "source": (
            "def make_adder(step):\n"
            "    def add(n):\n"
            "        return n + step\n"
            "    return add\n"
            "\n"
            "add_two = make_adder(2)\n"
            "print(add_two(5))\n"
        ),
    },
    {
        "name": "lambda-key",
        "category": "lambdas",
        "title": "Sorting with a key function",
        "source": (
            "words = ['bb', 'a', 'ccc']\n"
            "by_length = sorted(words, key=len)\n"
            "print(by_length)\n"
        ),
    },
    # --- recursion and calls ------------------------------------------------
    {
        "name": "recursion",
        "category": "recursion",
        "title": "Factorial, one frame per call",
        "source": (
            "def fact(n):\n"
            "    if n <= 1:\n"
            "        return 1\n"
            "    return n * fact(n - 1)\n"
            "\n"
            "print(fact(5))\n"
        ),
    },
    {
        "name": "recursion-mutual",
        "category": "recursion",
        "title": "Two functions calling each other",
        "source": (
            "def is_even(n):\n"
            "    return True if n == 0 else is_odd(n - 1)\n"
            "\n"
            "def is_odd(n):\n"
            "    return False if n == 0 else is_even(n - 1)\n"
            "\n"
            "print(is_even(4), is_odd(4))\n"
        ),
    },
    {
        "name": "call-chain",
        "category": "functions calling functions",
        "title": "A helper used by a caller used by the program",
        "source": (
            "def double(n):\n"
            "    return n * 2\n"
            "\n"
            "def quadruple(n):\n"
            "    return double(double(n))\n"
            "\n"
            "print(quadruple(3))\n"
        ),
    },
    {
        "name": "combo-nested-loop-call",
        "category": "nested loops calling functions",
        "title": "A helper called from inside two loops",
        "source": (
            "def box(n):\n"
            "    return n * n\n"
            "\n"
            "total = 0\n"
            "for r in range(1, 3):\n"
            "    for c in range(1, 3):\n"
            "        total = total + box(r * c)\n"
            "print(total)\n"
        ),
    },
    {
        "name": "combo-recursion-list",
        "category": "recursion",
        "title": "Recursion that walks a list",
        "source": (
            "def total(values):\n"
            "    if len(values) == 0:\n"
            "        return 0\n"
            "    return values[0] + total(values[1:])\n"
            "\n"
            "print(total([4, 5, 6]))\n"
        ),
    },
    # --- exceptions ---------------------------------------------------------
    {
        "name": "exception-caught",
        "category": "exceptions",
        "title": "try, except, else, finally",
        "source": (
            "def half(n):\n"
            "    return 10 / n\n"
            "\n"
            "try:\n"
            "    result = half(2)\n"
            "except ZeroDivisionError:\n"
            "    print('cannot divide by zero')\n"
            "else:\n"
            "    print('ok', result)\n"
            "finally:\n"
            "    print('finished')\n"
        ),
    },
    {
        "name": "exception-custom",
        "category": "exceptions",
        "title": "Raising and catching your own error",
        "source": (
            "class TooBig(Exception):\n"
            "    pass\n"
            "\n"
            "def check(n):\n"
            "    if n > 2:\n"
            "        raise TooBig('n is too big')\n"
            "    return n\n"
            "\n"
            "try:\n"
            "    check(9)\n"
            "except TooBig as exc:\n"
            "    print('caught:', exc)\n"
        ),
    },
    {
        "name": "exception-reraise",
        "category": "exceptions",
        "title": "Re-raising after cleanup",
        "source": (
            "def risky(value):\n"
            "    try:\n"
            "        return 10 // value\n"
            "    except ZeroDivisionError:\n"
            "        print('rethrowing')\n"
            "        raise\n"
            "\n"
            "try:\n"
            "    risky(0)\n"
            "except ZeroDivisionError:\n"
            "    print('caught at top')\n"
        ),
    },
    {
        "name": "combo-exception-loop",
        "category": "exceptions",
        "title": "One bad value in a loop",
        "source": (
            "def parse(text):\n"
            "    return 10 // int(text)\n"
            "\n"
            "for item in ['5', '0', '2']:\n"
            "    try:\n"
            "        print(item, parse(item))\n"
            "    except ZeroDivisionError:\n"
            "        print(item, 'skipped')\n"
        ),
    },
    {
        "name": "error-division",
        "category": "runtime errors",
        "title": "A division by zero stops the run",
        "source": (
            "def divide(a, b):\n"
            "    return a / b\n"
            "\n"
            "print(divide(6, 2))\n"
            "print(divide(1, 0))\n"
        ),
        "status": "error",
        "error_type": "ZeroDivisionError",
        "note": "The run stops on the failing line; the trace keeps everything up to it.",
    },
    {
        "name": "error-index",
        "category": "runtime errors",
        "title": "Reading past the end of a list",
        "source": (
            "scores = [10, 20]\n"
            "print(scores[0])\n"
            "print(scores[5])\n"
        ),
        "status": "error",
        "error_type": "IndexError",
        "note": "IndexError unwinds the frame, and the graph shows where it stopped.",
    },
    {
        "name": "error-name",
        "category": "runtime errors",
        "title": "Using a name that was never set",
        "source": ("total = 1\nprint(totl)\n"),
        "status": "error",
        "error_type": "NameError",
        "note": "A typo is reported as NameError on the line that used it.",
    },
    {
        "name": "error-syntax",
        "category": "syntax errors",
        "title": "Code that never started",
        "source": "def broken(:\n    pass\n",
        "status": "error",
        "error_type": "SyntaxError",
        "note": "Nothing ran, so there is nothing to draw; the message names the line.",
    },
    # --- classes ------------------------------------------------------------
    {
        "name": "class-basic",
        "category": "classes",
        "title": "Building an object and changing it",
        "source": (
            "class Dog:\n"
            "    def __init__(self, name):\n"
            "        self.name = name\n"
            "        self.tricks = []\n"
            "\n"
            "    def learn(self, trick):\n"
            "        self.tricks.append(trick)\n"
            "        return len(self.tricks)\n"
            "\n"
            "rex = Dog('Rex')\n"
            "print(rex.learn('sit'))\n"
            "print(rex.name, rex.tricks)\n"
        ),
    },
    {
        "name": "class-inheritance",
        "category": "class inheritance",
        "title": "A subclass that reuses the parent",
        "source": (
            "class Animal:\n"
            "    def __init__(self, name):\n"
            "        self.name = name\n"
            "\n"
            "    def speak(self):\n"
            "        return 'noise'\n"
            "\n"
            "class Dog(Animal):\n"
            "    def speak(self):\n"
            "        return self.name + ' says woof'\n"
            "\n"
            "pet = Dog('Rex')\n"
            "print(pet.speak())\n"
        ),
    },
    {
        "name": "class-property",
        "category": "classes",
        "title": "A property and a class-level counter",
        "source": (
            "class Counter:\n"
            "    seen = 0\n"
            "\n"
            "    def __init__(self, start):\n"
            "        self.value = start\n"
            "\n"
            "    @property\n"
            "    def next_value(self):\n"
            "        return self.value + 1\n"
            "\n"
            "box = Counter(4)\n"
            "print(box.next_value)\n"
        ),
    },
    {
        "name": "combo-class-loop-dict",
        "category": "classes",
        "title": "Objects kept in a dictionary",
        "source": (
            "class Score:\n"
            "    def __init__(self, points):\n"
            "        self.points = points\n"
            "\n"
            "    def add(self, extra):\n"
            "        self.points = self.points + extra\n"
            "        return self.points\n"
            "\n"
            "board = {}\n"
            "for name in ['Asha', 'Ravi']:\n"
            "    board[name] = Score(10)\n"
            "    board[name].add(5)\n"
            "print(board['Asha'].points, sorted(board))\n"
        ),
    },
    # --- imports and input/output -------------------------------------------
    {
        "name": "import-module",
        "category": "imports",
        "title": "import math and from math import",
        "source": (
            "import math\n"
            "from math import sqrt\n"
            "print(math.floor(3.7))\n"
            "print(sqrt(16))\n"
        ),
    },
    {
        "name": "io-input",
        "category": "input and output",
        "title": "Reading a value, then printing it",
        "source": (
            "name = input('Your name? ')\n"
            "print('Hello', name)\n"
            "print('done', end='!')\n"
        ),
        "inputs": ["Asha"],
    },
    {
        "name": "io-print-options",
        "category": "input and output",
        "title": "print with sep and end",
        "source": (
            "print('one', 'two', sep=' | ')\n"
            "print('no newline', end='...')\n"
            "print('continues')\n"
        ),
    },
    {
        "name": "io-two-inputs",
        "category": "input and output",
        "title": "Two prompts, two answers",
        "source": (
            "first = input('First? ')\n"
            "second = input('Second? ')\n"
            "print(first, second)\n"
        ),
        "inputs": ["Asha", "Ravi"],
    },
    {
        "name": "io-empty-print",
        "category": "input and output",
        "title": "print('') writes a blank line",
        "source": (
            "print('')\n"
            "print('done')\n"
        ),
    },
    # --- generators and async -----------------------------------------------
    {
        "name": "generator",
        "category": "generators",
        "title": "A function that yields twice",
        "source": (
            "def numbers():\n"
            "    yield 1\n"
            "    yield 2\n"
            "\n"
            "for value in numbers():\n"
            "    print(value)\n"
        ),
    },
    {
        "name": "generator-delegates",
        "category": "generators",
        "title": "yield from passing values on",
        "source": (
            "def inner():\n"
            "    yield 'a'\n"
            "    yield 'b'\n"
            "\n"
            "def outer():\n"
            "    yield from inner()\n"
            "    yield 'c'\n"
            "\n"
            "print(list(outer()))\n"
        ),
    },
    {
        "name": "async-await",
        "category": "async and await",
        "title": "An async function run with asyncio",
        "source": (
            "import asyncio\n"
            "\n"
            "async def double(n):\n"
            "    return n * 2\n"
            "\n"
            "print(asyncio.run(double(21)))\n"
        ),
    },
    # --- safety limits ------------------------------------------------------
    {
        "name": "limit-steps",
        "category": "safety limits",
        "title": "A loop that never ends",
        "source": ("n = 0\nwhile True:\n    n = n + 1\n"),
        "status": "step_limit",
        "note": "The tracer stops at its step limit and says so; it never invents an ending.",
    },
    {
        "name": "limit-output",
        "category": "safety limits",
        "title": "A print bigger than the output limit",
        "source": ("print('x' * 20000)\n"),
        "status": "output_limit",
        "note": "Output is capped so one giant print cannot freeze the page.",
    },
    {
        "name": "limit-timeout",
        "category": "safety limits",
        "title": "A program that waits",
        "source": (
            "import time\n"
            "ticks = 0\n"
            "while True:\n"
            "    time.sleep(0.05)\n"
            "    ticks = ticks + 1\n"
        ),
        "status": "timeout",
        "note": "A program that waits is stopped on the clock, not silently left running.",
    },
]

