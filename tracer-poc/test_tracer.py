import json
import unittest

from tracer import run_trace


def events(result, kind):
    return [e for e in result["trace"] if e["event"] == kind]


class TracerTests(unittest.TestCase):
    def test_simple_program_and_the_one_step_lag(self):
        r = run_trace("x = 1\ny = x + 2\nprint(y)\n")
        self.assertEqual(r["status"], "completed")
        self.assertEqual(r["output"], "3\n")
        lines = events(r, "line")
        self.assertEqual([e["line"] for e in lines], [1, 2, 3])
        # a line event shows the state BEFORE that line runs
        self.assertEqual(lines[0]["frames"][-1]["variables"], {})
        self.assertEqual(lines[1]["frames"][-1]["variables"]["x"], {"type": "int", "value": 1})
        self.assertEqual(lines[2]["frames"][-1]["variables"]["y"], {"type": "int", "value": 3})

    def test_recursion_has_distinct_frames(self):
        src = "def f(n):\n    if n <= 1:\n        return 1\n    return n * f(n - 1)\nf(3)\n"
        r = run_trace(src)
        calls = events(r, "call")
        self.assertEqual([c["function"] for c in calls], ["<module>", "f", "f", "f"])
        self.assertEqual(len({c["frame_id"] for c in calls}), 4)
        deepest = max(r["trace"], key=lambda e: len(e.get("frames", [])))
        self.assertEqual(len(deepest["frames"]), 4)
        returns = events(r, "return")
        self.assertEqual(returns[0]["return_value"], {"type": "int", "value": 1})
        self.assertEqual(calls[2]["frames"][-1]["call_line"], 4)

    def test_shared_reference_is_one_object(self):
        r = run_trace("a = [1, 2]\nb = a\nc = [1, 2]\n")
        last = events(r, "return")[-1]
        v = last["frames"][-1]["variables"]
        self.assertEqual(v["a"], v["b"])
        self.assertNotEqual(v["a"]["id"], v["c"]["id"])
        self.assertEqual(last["heap"][v["a"]["id"]]["type"], "list")

    def test_object_with_cycle(self):
        src = (
            "class Node:\n    def __init__(self, v):\n        self.v = v\n        self.next = None\n"
            "a = Node(1)\nb = Node(2)\na.next = b\nb.next = a\n"
        )
        r = run_trace(src)
        self.assertEqual(r["status"], "completed")
        last = events(r, "return")[-1]
        heap = last["heap"]
        self.assertEqual(len(heap), 2)
        self.assertTrue(all(o["type"] == "object" for o in heap.values()))

    def test_exception_unwinds_through_functions(self):
        src = "def inner():\n    return 1 / 0\ndef outer():\n    inner()\nouter()\n"
        r = run_trace(src)
        self.assertEqual(r["status"], "error")
        self.assertEqual(r["error"]["type"], "ZeroDivisionError")
        self.assertEqual(r["error"]["line"], 2)
        self.assertEqual([e["function"] for e in events(r, "unwind")], ["inner", "outer", "<module>"])

    def test_caught_exception_does_not_unwind(self):
        src = "try:\n    1 / 0\nexcept ZeroDivisionError:\n    print('caught')\n"
        r = run_trace(src)
        self.assertEqual(r["status"], "completed")
        self.assertEqual(len(events(r, "exception")), 1)
        self.assertEqual(events(r, "unwind"), [])

    def test_syntax_error_reports_line(self):
        r = run_trace("x = 1\nif x ==:\n    pass\n")
        self.assertEqual(r["status"], "error")
        self.assertEqual(r["error"]["phase"], "compile")
        self.assertEqual(r["error"]["line"], 2)

    def test_step_limit_stops_infinite_loop(self):
        r = run_trace("while True:\n    pass\n", max_steps=100)
        self.assertEqual(r["status"], "step_limit")
        self.assertEqual(r["steps"], 100)

    def test_step_limit_cannot_be_swallowed_by_except_exception(self):
        src = "while True:\n    try:\n        pass\n    except Exception:\n        pass\n"
        self.assertEqual(run_trace(src, max_steps=50)["status"], "step_limit")

    def test_timeout(self):
        r = run_trace("while True:\n    pass\n", max_steps=10 ** 9, max_seconds=0.2)
        self.assertEqual(r["status"], "timeout")

    def test_input_values(self):
        r = run_trace("name = input('Name? ')\nprint('Hi', name)\n", inputs=["Asha"])
        self.assertEqual(r["output"], "Name? Asha\nHi Asha\n")
        self.assertEqual(events(r, "input")[0]["text"], "Asha")

    def test_missing_input_gives_friendly_error(self):
        r = run_trace("x = input()\n")
        self.assertEqual(r["error"]["type"], "EOFError")

    def test_output_limit(self):
        r = run_trace("while True:\n    print('x' * 1000)\n", max_steps=10 ** 6)
        self.assertEqual(r["status"], "output_limit")

    def test_broken_repr_does_not_crash_tracer(self):
        src = "class Bad:\n    __slots__ = ()\n    def __repr__(self):\n        raise ValueError('no')\nb = Bad()\n"
        self.assertEqual(run_trace(src)["status"], "completed")

    def test_tracer_state_is_fresh_every_run(self):
        src = "x = 1\n"
        self.assertEqual(run_trace(src), run_trace(src))

    def test_output_is_valid_json(self):
        r = run_trace("d = {'a': [1, 2], 'b': (3, 4)}\ns = {3, 1, 2}\nf = 1.5\n")
        json.dumps(r)


if __name__ == "__main__":
    unittest.main()
