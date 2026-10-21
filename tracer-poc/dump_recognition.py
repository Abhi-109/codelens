"""Record real traces and profiles for the recognition tests.

The recognition engine is a JavaScript module, but it must be tested against
the real tracer and the real AST analyzer rather than hand-written shapes.
This script runs a small set of search/sort/ambiguity programs through
``tracer.py`` and profiles every corpus program with ``analyze.py``.

    python tracer-poc/dump_recognition.py

The output is vendored in ``src/tracer/__fixtures__/recognition.json.gz`` so
``npm run test:js`` does not need Python at test time. Regenerating is a review
step: read the fixture diff after changing the tracer or the analyzer.
"""

import gzip
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import analyze
from corpus import CORPUS, MAX_SECONDS, MAX_STEPS
from tracer import run_trace

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "src" / "tracer" / "__fixtures__" / "recognition.json.gz"

PROGRAMS = {
    "linear-index": (
        "def linear_search(values, target):\n"
        "    for i in range(len(values)):\n"
        "        if values[i] == target:\n"
        "            return i\n"
        "    return -1\n"
        "\n"
        "print(linear_search([4, 7, 1, 9], 7))\n"
    ),
    "linear-item": (
        "def linear_scan(values, target):\n"
        "    for item in values:\n"
        "        if item == target:\n"
        "            return True\n"
        "    return False\n"
        "\n"
        "print(linear_scan([4, 7, 1, 9], 7))\n"
    ),
    "linear-first": (
        "def linear_search(values, target):\n"
        "    for i in range(len(values)):\n"
        "        if values[i] == target:\n"
        "            return i\n"
        "    return -1\n"
        "\n"
        "print(linear_search([4, 7, 1, 9], 4))\n"
    ),
    "linear-last": (
        "def linear_search(values, target):\n"
        "    for i in range(len(values)):\n"
        "        if values[i] == target:\n"
        "            return i\n"
        "    return -1\n"
        "\n"
        "print(linear_search([4, 7, 1, 9], 9))\n"
    ),
    "linear-missing": (
        "def linear_search(values, target):\n"
        "    for i in range(len(values)):\n"
        "        if values[i] == target:\n"
        "            return i\n"
        "    return -1\n"
        "\n"
        "print(linear_search([4, 7, 1, 9], 5))\n"
    ),
    "linear-duplicates": (
        "def linear_search(values, target):\n"
        "    for i in range(len(values)):\n"
        "        if values[i] == target:\n"
        "            return i\n"
        "    return -1\n"
        "\n"
        "print(linear_search([4, 7, 7, 9], 7))\n"
    ),
    "linear-empty": (
        "def linear_search(values, target):\n"
        "    for i in range(len(values)):\n"
        "        if values[i] == target:\n"
        "            return i\n"
        "    return -1\n"
        "\n"
        "print(linear_search([], 7))\n"
    ),
    "linear-tuple": (
        "def linear_search(values, target):\n"
        "    for i in range(len(values)):\n"
        "        if values[i] == target:\n"
        "            return i\n"
        "    return -1\n"
        "\n"
        "print(linear_search((2, 4, 6), 6))\n"
    ),
    "linear-item-duplicates": (
        "def linear_scan(values, target):\n"
        "    for item in values:\n"
        "        if item == target:\n"
        "            return True\n"
        "    return False\n"
        "\n"
        "print(linear_scan([4, 7, 7, 9], 7))\n"
    ),
    "linear-dict": (
        "def find(entries, target):\n"
        "    for key in entries:\n"
        "        if key == target:\n"
        "            return True\n"
        "    return False\n"
        "\n"
        "print(find({'a': 1, 'b': 2}, 'b'))\n"
    ),
    "linear-mixed": (
        "def linear_search(values, target):\n"
        "    for i in range(len(values)):\n"
        "        if values[i] == target:\n"
        "            return i\n"
        "    return -1\n"
        "\n"
        "print(linear_search([1, 'a', 2], 'a'))\n"
    ),
    "linear-alias": (
        "def linear_search(values, target):\n"
        "    for i in range(len(values)):\n"
        "        if values[i] == target:\n"
        "            return i\n"
        "    return -1\n"
        "\n"
        "numbers = [4, 7, 1, 9]\n"
        "alias = numbers\n"
        "print(linear_search(alias, 9))\n"
    ),
    "linear-break": (
        "def linear_search(values, target):\n"
        "    found = -1\n"
        "    for i in range(len(values)):\n"
        "        if values[i] == target:\n"
        "            found = i\n"
        "            break\n"
        "    return found\n"
        "\n"
        "print(linear_search([4, 7, 1, 9], 9))\n"
    ),
    "linear-flag": (
        "def linear_scan(values, target):\n"
        "    found = False\n"
        "    for i in range(len(values)):\n"
        "        if values[i] == target:\n"
        "            found = True\n"
        "            break\n"
        "    return found\n"
        "\n"
        "print(linear_scan([4, 7, 1, 9], 5))\n"
    ),
    "linear-helper": (
        "def matches(value, target):\n"
        "    return value == target\n"
        "\n"
        "def linear_search(values, target):\n"
        "    for i in range(len(values)):\n"
        "        if matches(values[i], target):\n"
        "            return i\n"
        "    return -1\n"
        "\n"
        "print(linear_search([4, 7, 1, 9], 7))\n"
    ),
    "linear-enumerate": (
        "def linear_search(values, target):\n"
        "    for i, value in enumerate(values):\n"
        "        if value == target:\n"
        "            return i\n"
        "    return -1\n"
        "\n"
        "print(linear_search([4, 7, 1, 9], 7))\n"
    ),
    "linear-while": (
        "def linear_search(values, target):\n"
        "    i = 0\n"
        "    while i < len(values):\n"
        "        if values[i] == target:\n"
        "            return i\n"
        "        i = i + 1\n"
        "    return -1\n"
        "\n"
        "print(linear_search([4, 7, 1, 9], 9))\n"
    ),
    "linear-truncated": (
        "def linear_search(values, target):\n"
        "    for i in range(len(values)):\n"
        "        if values[i] == target:\n"
        "            return i\n"
        "    return -1\n"
        "\n"
        "print(linear_search([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, "
        "15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, "
        "32, 33, 34], 0))\n"
    ),
    "binary-search": (
        "def binary_search(values, target):\n"
        "    low = 0\n"
        "    high = len(values) - 1\n"
        "    while low <= high:\n"
        "        mid = (low + high) // 2\n"
        "        if values[mid] == target:\n"
        "            return mid\n"
        "        if values[mid] < target:\n"
        "            low = mid + 1\n"
        "        else:\n"
        "            high = mid - 1\n"
        "    return -1\n"
        "\n"
        "print(binary_search([1, 3, 5, 7, 9, 11], 7))\n"
    ),
    "binary-missing": (
        "def binary_search(values, target):\n"
        "    low = 0\n"
        "    high = len(values) - 1\n"
        "    while low <= high:\n"
        "        mid = (low + high) // 2\n"
        "        if values[mid] == target:\n"
        "            return mid\n"
        "        if values[mid] < target:\n"
        "            low = mid + 1\n"
        "        else:\n"
        "            high = mid - 1\n"
        "    return -1\n"
        "\n"
        "print(binary_search([1, 3, 5, 7, 9, 11], 4))\n"
    ),
    "binary-one": (
        "def binary_search(values, target):\n"
        "    low = 0\n"
        "    high = len(values) - 1\n"
        "    while low <= high:\n"
        "        mid = (low + high) // 2\n"
        "        if values[mid] == target:\n"
        "            return mid\n"
        "        if values[mid] < target:\n"
        "            low = mid + 1\n"
        "        else:\n"
        "            high = mid - 1\n"
        "    return -1\n"
        "\n"
        "print(binary_search([7], 7))\n"
    ),
    "binary-one-missing": (
        "def binary_search(values, target):\n"
        "    low = 0\n"
        "    high = len(values) - 1\n"
        "    while low <= high:\n"
        "        mid = (low + high) // 2\n"
        "        if values[mid] == target:\n"
        "            return mid\n"
        "        if values[mid] < target:\n"
        "            low = mid + 1\n"
        "        else:\n"
        "            high = mid - 1\n"
        "    return -1\n"
        "\n"
        "print(binary_search([7], 3))\n"
    ),
    "binary-first": (
        "def binary_search(values, target):\n"
        "    low = 0\n"
        "    high = len(values) - 1\n"
        "    while low <= high:\n"
        "        mid = (low + high) // 2\n"
        "        if values[mid] == target:\n"
        "            return mid\n"
        "        if values[mid] < target:\n"
        "            low = mid + 1\n"
        "        else:\n"
        "            high = mid - 1\n"
        "    return -1\n"
        "\n"
        "print(binary_search([1, 3, 5, 7, 9], 1))\n"
    ),
    "binary-last": (
        "def binary_search(values, target):\n"
        "    low = 0\n"
        "    high = len(values) - 1\n"
        "    while low <= high:\n"
        "        mid = (low + high) // 2\n"
        "        if values[mid] == target:\n"
        "            return mid\n"
        "        if values[mid] < target:\n"
        "            low = mid + 1\n"
        "        else:\n"
        "            high = mid - 1\n"
        "    return -1\n"
        "\n"
        "print(binary_search([1, 3, 5, 7, 9], 9))\n"
    ),
    "binary-duplicates": (
        "def binary_search(values, target):\n"
        "    low = 0\n"
        "    high = len(values) - 1\n"
        "    while low <= high:\n"
        "        mid = (low + high) // 2\n"
        "        if values[mid] == target:\n"
        "            return mid\n"
        "        if values[mid] < target:\n"
        "            low = mid + 1\n"
        "        else:\n"
        "            high = mid - 1\n"
        "    return -1\n"
        "\n"
        "print(binary_search([1, 2, 2, 2, 3], 2))\n"
    ),
    "binary-empty": (
        "def binary_search(values, target):\n"
        "    low = 0\n"
        "    high = len(values) - 1\n"
        "    while low <= high:\n"
        "        mid = (low + high) // 2\n"
        "        if values[mid] == target:\n"
        "            return mid\n"
        "        if values[mid] < target:\n"
        "            low = mid + 1\n"
        "        else:\n"
        "            high = mid - 1\n"
        "    return -1\n"
        "\n"
        "print(binary_search([], 7))\n"
    ),
    "bubble-sort": (
        "numbers = [4, 2, 5, 1, 3]\n"
        "for i in range(len(numbers)):\n"
        "    for j in range(len(numbers) - i - 1):\n"
        "        if numbers[j] > numbers[j + 1]:\n"
        "            numbers[j], numbers[j + 1] = numbers[j + 1], numbers[j]\n"
        "print(numbers)\n"
    ),
    "bubble-sorted": (
        "numbers = [1, 2, 3, 4, 5]\n"
        "for i in range(len(numbers)):\n"
        "    for j in range(len(numbers) - i - 1):\n"
        "        if numbers[j] > numbers[j + 1]:\n"
        "            numbers[j], numbers[j + 1] = numbers[j + 1], numbers[j]\n"
        "print(numbers)\n"
    ),
    "bubble-duplicates": (
        "numbers = [3, 1, 3, 2]\n"
        "for i in range(len(numbers)):\n"
        "    for j in range(len(numbers) - i - 1):\n"
        "        if numbers[j] > numbers[j + 1]:\n"
        "            numbers[j], numbers[j + 1] = numbers[j + 1], numbers[j]\n"
        "print(numbers)\n"
    ),
    "bubble-reverse": (
        "numbers = [5, 4, 3, 2, 1]\n"
        "for i in range(len(numbers)):\n"
        "    for j in range(len(numbers) - i - 1):\n"
        "        if numbers[j] > numbers[j + 1]:\n"
        "            numbers[j], numbers[j + 1] = numbers[j + 1], numbers[j]\n"
        "print(numbers)\n"
    ),
    "bubble-negative": (
        "numbers = [-3, 0, -1, 2]\n"
        "for i in range(len(numbers)):\n"
        "    for j in range(len(numbers) - i - 1):\n"
        "        if numbers[j] > numbers[j + 1]:\n"
        "            numbers[j], numbers[j + 1] = numbers[j + 1], numbers[j]\n"
        "print(numbers)\n"
    ),
    "bubble-empty": (
        "numbers = []\n"
        "for i in range(len(numbers)):\n"
        "    for j in range(len(numbers) - i - 1):\n"
        "        if numbers[j] > numbers[j + 1]:\n"
        "            numbers[j], numbers[j + 1] = numbers[j + 1], numbers[j]\n"
        "print(numbers)\n"
    ),
    "bubble-single": (
        "numbers = [7]\n"
        "for i in range(len(numbers)):\n"
        "    for j in range(len(numbers) - i - 1):\n"
        "        if numbers[j] > numbers[j + 1]:\n"
        "            numbers[j], numbers[j + 1] = numbers[j + 1], numbers[j]\n"
        "print(numbers)\n"
    ),
    "bubble-alias": (
        "numbers = [3, 1, 2]\n"
        "alias = numbers\n"
        "for i in range(len(numbers)):\n"
        "    for j in range(len(numbers) - i - 1):\n"
        "        if numbers[j] > numbers[j + 1]:\n"
        "            numbers[j], numbers[j + 1] = numbers[j + 1], numbers[j]\n"
        "print(alias)\n"
    ),
    "bubble-truncated": (
        "numbers = [35, 34, 33, 32, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, "
        "21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, "
        "3, 2, 1]\n"
        "for j in range(len(numbers) - 1):\n"
        "    if numbers[j] > numbers[j + 1]:\n"
        "        numbers[j], numbers[j + 1] = numbers[j + 1], numbers[j]\n"
        "print(numbers)\n"
    ),
    "selection-sort": (
        "def selection_sort(values):\n"
        "    for i in range(len(values)):\n"
        "        smallest = i\n"
        "        for j in range(i + 1, len(values)):\n"
        "            if values[j] < values[smallest]:\n"
        "                smallest = j\n"
        "        values[i], values[smallest] = values[smallest], values[i]\n"
        "    return values\n"
        "\n"
        "print(selection_sort([5, 2, 4, 1, 3]))\n"
    ),
    "insertion-sort": (
        "def insertion_sort(values):\n"
        "    for i in range(1, len(values)):\n"
        "        key = values[i]\n"
        "        j = i - 1\n"
        "        while j >= 0 and values[j] > key:\n"
        "            values[j + 1] = values[j]\n"
        "            j = j - 1\n"
        "        values[j + 1] = key\n"
        "    return values\n"
        "\n"
        "print(insertion_sort([5, 2, 4, 1, 3]))\n"
    ),
    "merge-sort": (
        "def merge_sort(values):\n"
        "    if len(values) <= 1:\n"
        "        return values\n"
        "    mid = len(values) // 2\n"
        "    left = merge_sort(values[:mid])\n"
        "    right = merge_sort(values[mid:])\n"
        "    return combine(left, right)\n"
        "\n"
        "def combine(left, right):\n"
        "    result = []\n"
        "    i = 0\n"
        "    j = 0\n"
        "    while i < len(left) and j < len(right):\n"
        "        if left[i] <= right[j]:\n"
        "            result.append(left[i])\n"
        "            i = i + 1\n"
        "        else:\n"
        "            result.append(right[j])\n"
        "            j = j + 1\n"
        "    result.extend(left[i:])\n"
        "    result.extend(right[j:])\n"
        "    return result\n"
        "\n"
        "print(merge_sort([38, 27, 43, 3, 9, 82, 10]))\n"
    ),
    "merge-sort-duplicates": (
        "def merge_sort(values):\n"
        "    if len(values) <= 1:\n"
        "        return values\n"
        "    mid = len(values) // 2\n"
        "    left = merge_sort(values[:mid])\n"
        "    right = merge_sort(values[mid:])\n"
        "    return combine(left, right)\n"
        "\n"
        "def combine(left, right):\n"
        "    result = []\n"
        "    i = 0\n"
        "    j = 0\n"
        "    while i < len(left) and j < len(right):\n"
        "        if left[i] <= right[j]:\n"
        "            result.append(left[i])\n"
        "            i = i + 1\n"
        "        else:\n"
        "            result.append(right[j])\n"
        "            j = j + 1\n"
        "    result.extend(left[i:])\n"
        "    result.extend(right[j:])\n"
        "    return result\n"
        "\n"
        "print(merge_sort([3, 1, 3, 2]))\n"
    ),
    "merge-sort-empty": (
        "def merge_sort(values):\n"
        "    if len(values) <= 1:\n"
        "        return values\n"
        "    mid = len(values) // 2\n"
        "    left = merge_sort(values[:mid])\n"
        "    right = merge_sort(values[mid:])\n"
        "    return combine(left, right)\n"
        "\n"
        "def combine(left, right):\n"
        "    result = []\n"
        "    i = 0\n"
        "    j = 0\n"
        "    while i < len(left) and j < len(right):\n"
        "        if left[i] <= right[j]:\n"
        "            result.append(left[i])\n"
        "            i = i + 1\n"
        "        else:\n"
        "            result.append(right[j])\n"
        "            j = j + 1\n"
        "    result.extend(left[i:])\n"
        "    result.extend(right[j:])\n"
        "    return result\n"
        "\n"
        "print(merge_sort([]))\n"
    ),
    "builtin-sort": (
        "values = [3, 1, 2]\n"
        "values.sort()\n"
        "print(values)\n"
    ),
    "builtin-sorted": (
        "values = [3, 1, 2]\n"
        "print(sorted(values))\n"
    ),
    "sort-mixed": (
        "values = [3, 'a', 2]\n"
        "for j in range(len(values) - 1):\n"
        "    if values[j] > values[j + 1]:\n"
        "        values[j], values[j + 1] = values[j + 1], values[j]\n"
        "print(values)\n"
    ),
    "plain-loop": (
        "total = 0\n"
        "for n in [1, 2, 3]:\n"
        "    total = total + n\n"
        "print(total)\n"
    ),
    "dict-iteration": (
        "ages = {'Asha': 12, 'Ravi': 13}\n"
        "for name in ages:\n"
        "    print(name)\n"
    ),
    "count-matches": (
        "def count_matches(values, target):\n"
        "    count = 0\n"
        "    for item in values:\n"
        "        if item == target:\n"
        "            count = count + 1\n"
        "    return count\n"
        "\n"
        "print(count_matches([1, 2, 1], 1))\n"
    ),
    "filter-list": (
        "def positives(values):\n"
        "    result = []\n"
        "    for value in values:\n"
        "        if value > 0:\n"
        "            result.append(value)\n"
        "    return result\n"
        "\n"
        "print(positives([3, -1, 2]))\n"
    ),
    "max-scan": (
        "def largest(values):\n"
        "    best = values[0]\n"
        "    for i in range(1, len(values)):\n"
        "        if values[i] > best:\n"
        "            best = values[i]\n"
        "    return best\n"
        "\n"
        "print(largest([3, 9, 2]))\n"
    ),
    "call-chain": (
        "def first(value):\n"
        "    return second(value)\n"
        "\n"
        "def second(value):\n"
        "    return third(value)\n"
        "\n"
        "def third(value):\n"
        "    return value\n"
        "\n"
        "print(first(1))\n"
    ),
    "fibonacci": (
        "def fib(n):\n"
        "    if n <= 1:\n"
        "        return n\n"
        "    return fib(n - 1) + fib(n - 2)\n"
        "\n"
        "print(fib(5))\n"
    ),
    "recursive-binary-search": (
        "def search(values, target, low, high):\n"
        "    if low > high:\n"
        "        return -1\n"
        "    mid = (low + high) // 2\n"
        "    if values[mid] == target:\n"
        "        return mid\n"
        "    if values[mid] < target:\n"
        "        return search(values, target, mid + 1, high)\n"
        "    return search(values, target, low, mid - 1)\n"
        "\n"
        "print(search([1, 3, 5, 7, 9, 11], 4, 0, 5))\n"
    ),
    "recursive-exception": (
        "def countdown(n):\n"
        "    if n == 0:\n"
        "        return 1 / 0\n"
        "    return countdown(n - 1)\n"
        "\n"
        "print(countdown(3))\n"
    ),
    "recursive-caught": (
        "def safe(n):\n"
        "    try:\n"
        "        if n == 0:\n"
        "            return 1 / 0\n"
        "        return safe(n - 1)\n"
        "    except ZeroDivisionError:\n"
        "        return 0\n"
        "\n"
        "print(safe(2))\n"
    ),
    "recursive-deep": (
        "def down(n):\n"
        "    if n == 0:\n"
        "        return 0\n"
        "    return 1 + down(n - 1)\n"
        "\n"
        "print(down(25))\n"
    ),
}


def main():
    out = {"programs": {}, "corpus_profiles": {}}
    for name, source in PROGRAMS.items():
        result = run_trace(source, max_steps=MAX_STEPS, max_seconds=MAX_SECONDS)
        out["programs"][name] = {
            "source": source,
            "status": result["status"],
            "trace": result["trace"],
            "profile": analyze.analyze_source(source),
        }
        print(f"{name}: {result['status']}, {len(result['trace'])} events")
    for case in CORPUS:
        out["corpus_profiles"][case["name"]] = analyze.analyze_source(case["source"])

    payload = json.dumps(out, sort_keys=True, separators=(",", ":")).encode("utf-8")
    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    with open(FIXTURE, "wb") as raw:
        with gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as handle:
            handle.write(payload)
    print(f"wrote {FIXTURE} ({len(payload)} bytes before compression)")


if __name__ == "__main__":
    main()
