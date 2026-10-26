/* The built-in programs the visualizer can open.
 *
 * They live here (not in App.jsx) because two other places need the same
 * list: the "Examples" picker in the workspace and the lesson pages, whose
 * "Open in the visualizer" link carries an example id in the query string.
 * A lesson therefore cannot point at a program that does not exist, and
 * examples.test.mjs keeps the ids stable.
 *
 * Every program is small on purpose: it is a demonstration, not a library.
 */

export const EXAMPLES = [
  {
    id: "variables",
    name: "Variables",
    code: 'name = "Asha"\nage = 12\nheight = 1.52\nis_student = True\nnothing = None\nprint(name, age)\n',
  },
  {
    id: "if-else",
    name: "if / else",
    code: 'marks = 68\nif marks >= 90:\n    grade = "A"\nelif marks >= 60:\n    grade = "B"\nelse:\n    grade = "C"\nprint(grade)\n',
  },
  {
    id: "for-loop",
    name: "for loop",
    code: "total = 0\nfor n in range(1, 6):\n    total = total + n\nprint(total)\n",
  },
  {
    id: "recursion",
    name: "Recursion",
    code: "def fact(n):\n    if n <= 1:\n        return 1\n    return n * fact(n - 1)\n\n\nprint(fact(5))\n",
  },
  {
    id: "list",
    name: "List",
    code: 'fruits = ["apple", "banana"]\nfruits.append("cherry")\nprint(fruits[2])\n',
  },
  {
    id: "class",
    name: "Class",
    code:
      "class Dog:\n    def __init__(self, name):\n        self.name = name\n        self.tricks = []\n\n    def learn(self, trick):\n        self.tricks.append(trick)\n\n\nrex = Dog('Rex')\nrex.learn('sit')\nprint(rex.tricks)\n",
  },
  {
    id: "merge-sort",
    name: "Merge sort",
    code:
      "def merge_sort(arr):\n    if len(arr) <= 1:\n        return arr\n    mid = len(arr) // 2\n    left = merge_sort(arr[:mid])\n    right = merge_sort(arr[mid:])\n    return merge(left, right)\n\n\ndef merge(left, right):\n    result = []\n    i = 0\n    j = 0\n    while i < len(left) and j < len(right):\n        if left[i] <= right[j]:\n            result.append(left[i])\n            i += 1\n        else:\n            result.append(right[j])\n            j += 1\n    result.extend(left[i:])\n    result.extend(right[j:])\n    return result\n\n\ndata = [38, 27, 43, 3, 9, 82, 10]\nprint(merge_sort(data))\n",
  },
  {
    id: "statements",
    name: "Statements",
    code: "total = 3\ntotal = total + 4\nprint(total)\n",
  },
  {
    id: "aliasing",
    name: "Two names, one list",
    code:
      'first = {"name": "Asha", "scores": [3, 1]}\nsecond = first\nsecond["scores"].append(2)\nprint(first["scores"])\n',
  },
  {
    id: "functions",
    name: "Function and return",
    code:
      'def greet(name):\n    message = "Hello, " + name\n    return message\n\n\nprint(greet("Asha"))\n',
  },
  {
    id: "exceptions",
    name: "Caught and uncaught",
    code:
      "def divide(a, b):\n    try:\n        return a / b\n    except ZeroDivisionError:\n        return None\n\n\nprint(divide(6, 2))\nprint(divide(1, 0))\nprint(divide(1, 0) + 1)\n",
  },
  {
    id: "even-sum",
    name: "Condition and loop",
    code:
      "total = 0\nfor n in range(1, 6):\n    if n % 2 == 0:\n        total = total + n\nprint(total)\n",
  },
  {
    id: "bubble-sort",
    name: "Bubble sort",
    code:
      "numbers = [4, 2, 5, 1, 3]\n\nfor i in range(len(numbers)):\n    for j in range(len(numbers) - i - 1):\n        if numbers[j] > numbers[j + 1]:\n            numbers[j], numbers[j + 1] = numbers[j + 1], numbers[j]\n\nprint(numbers)\n",
  },
];

/** The example a fresh workspace opens on: recursion shows the call stack. */
export const DEFAULT_EXAMPLE_ID = "recursion";

/** One example by its stable id, or null when the id names nothing. */
export function exampleById(id) {
  return EXAMPLES.find((example) => example.id === id) ?? null;
}
