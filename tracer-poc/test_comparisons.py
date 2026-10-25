"""Proof-of-concept tests for comparison capture.

Every test runs a program twice - as written, then instrumented - and requires
the two runs to agree on output, on the values left in scope and on where an
exception came from. The records are then checked against what the program
really did. Nothing here touches the trace format.

    python -m unittest discover -s tracer-poc -p "test_*.py"
"""

import ast
import io
import sys
import types
import unittest
from contextlib import redirect_stdout

import comparisons
from comparisons import CELL_NAME, COMPARE_NAME, Recorder, instrument, namespace
from tracer import USER_FILE


def shape(value, depth=0):
    """A deterministic description of a value, so two runs can be compared."""
    if depth > 4:
        return ("deep",)
    if isinstance(value, (bool, int, float, str, bytes)) or value is None:
        return ("scalar", repr(value))
    if isinstance(value, (list, tuple)):
        return (type(value).__name__, tuple(shape(item, depth + 1) for item in value))
    if isinstance(value, dict):
        return ("dict", tuple(sorted((repr(k), shape(v, depth + 1)) for k, v in value.items())))
    if isinstance(value, type):
        return ("class", value.__qualname__)
    if isinstance(value, types.ModuleType):
        return ("module", value.__name__)
    if callable(value) and hasattr(value, "__qualname__"):
        return ("callable", value.__qualname__)
    attrs = getattr(value, "__dict__", None)
    if isinstance(attrs, dict):
        return (
            "object",
            type(value).__qualname__,
            tuple(sorted((name, shape(item, depth + 1)) for name, item in attrs.items())),
        )
    return ("opaque", type(value).__qualname__)


def _exec(code, extra):
    stream = io.StringIO()
    scope = {"__name__": "__main__", **extra}
    error = None
    try:
        with redirect_stdout(stream):
            exec(code, scope)
    except BaseException as exc:  # noqa: BLE001 - the test compares whatever came out
        error = exc
    return {
        "output": stream.getvalue(),
        "error": error,
        "scope": {name: value for name, value in scope.items() if not name.startswith("__")},
    }


def run(source):
    """Run as written and instrumented; return both results and the records."""
    recorder = Recorder()
    plain = _exec(compile(ast.parse(source), USER_FILE, "exec"), {})
    wrapped = _exec(compile(instrument(source), USER_FILE, "exec"), namespace(recorder))
    plain["names"] = {name: shape(value) for name, value in plain["scope"].items()}
    wrapped["names"] = {name: shape(value) for name, value in wrapped["scope"].items()}
    return plain, wrapped, recorder.records


def user_line(exc):
    """The last line of the user's own file in a traceback, like the tracer does."""
    line = None
    tb = exc.__traceback__
    while tb is not None:
        if tb.tb_frame.f_code.co_filename == USER_FILE:
            line = tb.tb_lineno
        tb = tb.tb_next
    return line


def line_events(code, extra):
    """The user-file `line` events the tracer would see."""
    seen = []

    def local_tracer(frame, event, arg):
        if event == "line" and frame.f_code.co_filename == USER_FILE:
            seen.append(frame.f_lineno)
        return local_tracer

    previous = sys.gettrace()
    try:
        sys.settrace(local_tracer)
        with redirect_stdout(io.StringIO()):
            exec(code, {"__name__": "__main__", **extra})
    finally:
        sys.settrace(previous)
    return seen


class ComparisonTests(unittest.TestCase):
    def assertSameBehaviour(self, plain, wrapped):
        self.assertEqual(wrapped["output"], plain["output"])
        self.assertEqual(wrapped["names"], plain["names"])
        self.assertEqual(wrapped["error"] is None, plain["error"] is None)
        if plain["error"] is not None:
            self.assertIs(type(wrapped["error"]), type(plain["error"]))
            self.assertEqual(str(wrapped["error"]), str(plain["error"]))
            self.assertEqual(user_line(wrapped["error"]), user_line(plain["error"]))
        self.assertNotIn(COMPARE_NAME, wrapped["scope"])
        self.assertNotIn(CELL_NAME, wrapped["scope"])

    def test_ordinary_comparisons_report_operands_operator_and_result(self):
        source = (
            "a = 5\n"
            "b = 2\n"
            "bigger = a > b\n"
            "smaller = a < b\n"
            "same = a == 5\n"
            "other = a != b\n"
        )
        plain, wrapped, records = run(source)
        self.assertSameBehaviour(plain, wrapped)
        self.assertEqual(
            [(r["operator"], r["left"], r["right"], r["result"], r["line"]) for r in records],
            [
                (">", 5, 2, True, 3),
                ("<", 5, 2, False, 4),
                ("==", 5, 5, True, 5),
                ("!=", 5, 2, True, 6),
            ],
        )

    def test_identity_and_membership_keep_their_own_meaning(self):
        source = (
            "xs = [1, 2]\n"
            "found = 2 in xs\n"
            "missing = 3 not in xs\n"
            "identical = xs is xs\n"
            "other = xs is not [1, 2]\n"
        )
        plain, wrapped, records = run(source)
        self.assertSameBehaviour(plain, wrapped)
        self.assertEqual(
            [(r["operator"], r["left"], r["right"], r["result"]) for r in records],
            [
                ("in", 2, [1, 2], True),
                ("not in", 3, [1, 2], True),
                ("is", [1, 2], [1, 2], True),
                ("is not", [1, 2], [1, 2], True),
            ],
        )
        self.assertIs(records[2]["left"], records[2]["right"], "`xs is xs` is one object")

    def test_each_operand_is_evaluated_once_in_source_order(self):
        source = (
            "log = []\n"
            "def take(value):\n"
            "    log.append(value)\n"
            "    return value\n"
            "result = take(5) > take(2)\n"
        )
        plain, wrapped, records = run(source)
        self.assertSameBehaviour(plain, wrapped)
        self.assertEqual(wrapped["scope"]["log"], [5, 2])
        self.assertEqual([(r["left"], r["right"]) for r in records], [(5, 2)])

    def test_a_subscript_operand_is_read_once_and_remembers_its_cell(self):
        source = (
            "xs = [3, 4]\n"
            "hits = []\n"
            "def idx(value):\n"
            "    hits.append(value)\n"
            "    return value\n"
            "result = xs[idx(0)] < xs[idx(1)]\n"
        )
        plain, wrapped, records = run(source)
        self.assertSameBehaviour(plain, wrapped)
        # The index expression runs once per operand: no re-reading to look at it.
        self.assertEqual(wrapped["scope"]["hits"], [0, 1])
        cells = records[0]["cells"]
        self.assertEqual([(cell["index"], cell["value"]) for cell in cells], [(0, 3), (1, 4)])
        self.assertIs(cells[0]["container"], wrapped["scope"]["xs"])

    def test_an_operand_that_is_not_a_cell_carries_no_position(self):
        plain, wrapped, records = run("xs = [3, 9]\nresult = xs[0] > 2 and len(xs) == 2\n")
        self.assertSameBehaviour(plain, wrapped)
        first, second = records
        self.assertEqual(
            [(cell["index"], cell["value"]) for cell in first["cells"]], [(0, 3)]
        )
        self.assertEqual(second["cells"], [], "a computed operand is not a list cell")

    def test_short_circuiting_and_chained_comparisons_are_untouched(self):
        source = (
            "called = []\n"
            "def boom():\n"
            "    called.append(1)\n"
            "    return 99\n"
            "chained = 0 < 0 < boom()\n"
            "and_short = 3 > 2 and boom()\n"
            "or_short = 3 > 2 or boom()\n"
            "whole = 1 < 2 < 3\n"
        )
        plain, wrapped, records = run(source)
        self.assertSameBehaviour(plain, wrapped)
        self.assertEqual(wrapped["scope"]["called"], [1])
        self.assertFalse(wrapped["scope"]["chained"])
        self.assertEqual(wrapped["scope"]["whole"], True)
        # The chained comparisons are left whole, so they report nothing.
        self.assertEqual([r["operator"] for r in records], [">", ">"])

    def test_an_exception_keeps_its_type_message_and_user_line(self):
        plain, wrapped, records = run('a = 1\nb = "x"\nresult = a > b\n')
        self.assertSameBehaviour(plain, wrapped)
        self.assertIsInstance(wrapped["error"], TypeError)
        self.assertEqual(user_line(wrapped["error"]), 3)
        # The operands are known even though the comparison produced nothing.
        self.assertEqual(
            (records[0]["operator"], records[0]["left"], records[0]["right"], records[0]["result"]),
            (">", 1, "x", None),
        )

    def test_an_exception_raised_by_the_comparison_itself_propagates(self):
        source = (
            "class Boom:\n"
            "    def __gt__(self, other):\n"
            "        raise ValueError('nope')\n"
            "value = Boom() > 3\n"
        )
        plain, wrapped, records = run(source)
        self.assertSameBehaviour(plain, wrapped)
        # The innermost user frame wins, exactly as in the untouched program: the
        # raise is inside __gt__, not at the comparison's own line.
        self.assertEqual(user_line(wrapped["error"]), 3)
        self.assertEqual(records[0]["result"], None)

    def test_a_custom_result_is_passed_through_and_never_truth_tested(self):
        source = (
            "class Result:\n"
            "    def __init__(self):\n"
            "        self.tests = 0\n"
            "    def __bool__(self):\n"
            "        self.tests += 1\n"
            "        return True\n"
            "class Thing:\n"
            "    def __gt__(self, other):\n"
            "        return Result()\n"
            "thing = Thing()\n"
            "value = thing > 0\n"
            "kind = type(value).__name__\n"
        )
        plain, wrapped, records = run(source)
        self.assertSameBehaviour(plain, wrapped)
        self.assertEqual(wrapped["scope"]["kind"], "Result")
        self.assertEqual(wrapped["scope"]["value"].tests, 0, "the result was truth-tested")
        self.assertIsNone(records[0]["result"], "a non-bool outcome must stay undecided")
        self.assertIs(plain["scope"]["value"].tests, 0)

    def test_several_comparisons_on_one_line_keep_evaluation_order(self):
        plain, wrapped, records = run(
            "a = 1\nb = 2\nc = 3\nd = 4\nok = a < b and c < d\n"
        )
        self.assertSameBehaviour(plain, wrapped)
        self.assertEqual(
            [(r["operator"], r["left"], r["right"], r["result"]) for r in records],
            [("<", 1, 2, True), ("<", 3, 4, True)],
        )

    def test_a_multi_line_comparison_reports_its_own_start_line(self):
        source = "xs = [1, 2, 3]\nvalue = (\n    xs[0]\n    < xs[2]\n)\n"
        plain, wrapped, records = run(source)
        self.assertSameBehaviour(plain, wrapped)
        self.assertEqual(records[0]["line"], 3)
        self.assertEqual(records[0]["result"], True)

    def test_unsupported_operands_are_left_exactly_as_written(self):
        source = (
            "def gen():\n"
            "    value = (yield 1) > 0\n"
            "    return value\n"
            "xs = [1, 2, 3]\n"
            "window = xs[0:2] == xs[0:2]\n"
        )
        plain, wrapped, records = run(source)
        self.assertSameBehaviour(plain, wrapped)
        # The generator's comparison contains a yield, so it is untouched; the
        # slice comparison is captured but its operands have no single cell.
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["operator"], "==")
        self.assertEqual(records[0]["cells"], [])

    def test_line_events_are_identical_to_the_plain_program(self):
        source = (
            "total = 0\n"
            "for n in [3, 1, 2]:\n"
            "    if n > total:\n"
            "        total = n\n"
            "print(total)\n"
        )
        plain_lines = line_events(compile(ast.parse(source), USER_FILE, "exec"), {})
        recorder = Recorder()
        wrapped_lines = line_events(
            compile(instrument(source), USER_FILE, "exec"), namespace(recorder)
        )
        self.assertEqual(wrapped_lines, plain_lines)
        self.assertEqual(len(recorder.records), 3, "one comparison per loop pass")

    def test_a_small_corpus_behaves_identically(self):
        sources = [
            "xs = [4, 2, 5]\nfor i in range(len(xs)):\n"
            "    for j in range(len(xs) - i - 1):\n"
            "        if xs[j] > xs[j + 1]:\n"
            "            xs[j], xs[j + 1] = xs[j + 1], xs[j]\n",
            "def fact(n):\n    if n <= 1:\n        return 1\n    return n * fact(n - 1)\n",
            "values = [n * n for n in range(6) if n % 2 == 0]\n",
            "counts = {}\nfor word in ['a', 'b', 'a']:\n"
            "    counts[word] = counts.get(word, 0) + 1\n",
            "try:\n    {}['missing']\nexcept KeyError as exc:\n    print(type(exc).__name__)\n",
            "class Point:\n    def __init__(self, x):\n        self.x = x\n"
            "    def __eq__(self, other):\n        return self.x == other.x\n"
            "print(Point(1) == Point(1))\n",
            "n = 0\nwhile n < 3:\n    n = n + 1\n",
            "text = 'abc'\nfor index, letter in enumerate(text):\n"
            "    if letter == 'b' and index > 0:\n        print(letter)\n",
        ]
        compared = 0
        for source in sources:
            plain, wrapped, records = run(source)
            self.assertSameBehaviour(plain, wrapped)
            compared += len(records)
        self.assertGreater(compared, 10, "the corpus really exercises comparisons")


if __name__ == "__main__":
    unittest.main()
