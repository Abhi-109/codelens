"""Runs the 10 example programs from docs/scope.md through the tracer.

Each example doubles as a tracer test case: the program must complete, print
the right thing, and stay small enough to visualize. Structural checks (frame
counts, heap shapes, sorted output) guard the features each example exists to
demonstrate.
"""

import json
import unittest
from pathlib import Path

from tracer import run_trace

EXAMPLES = Path(__file__).parent / "examples"

EXPECTED_OUTPUT = {
    "01_variables.py": "Asha 12\n1.52 True None\n",
    "02_if_else.py": "B\n",
    "03_for_loop.py": "15\n",
    "04_while_loop.py": "5\n4\n3\n2\n1\nLiftoff\n",
    "05_lists.py": "apple\ncherry\n3\n",
    "06_dictionaries.py": "13\n['Asha', 'Ravi', 'Meera']\n",
    "07_function.py": "Hello, Asha\n",
    "08_recursion.py": "120\n",
    "09_bubble_sort.py": "[1, 2, 3, 4, 5]\n",
    "10_class.py": "Rex knows 2 tricks\n['sit', 'shake']\n",
}

# The examples must stay short so the visuals stay readable (scope.md principle 4).
MAX_STEPS_PER_EXAMPLE = 400


def load(name):
    return (EXAMPLES / name).read_text(encoding="utf-8")


def events(result, kind):
    return [e for e in result["trace"] if e["event"] == kind]


def last_state(result):
    """The last event that carries the full stack and heap (output events don't)."""
    return next(e for e in reversed(result["trace"]) if "frames" in e)


class ExampleTests(unittest.TestCase):
    def test_there_are_exactly_ten_examples(self):
        names = sorted(p.name for p in EXAMPLES.glob("*.py"))
        self.assertEqual(names, sorted(EXPECTED_OUTPUT))

    def test_every_example_completes_and_prints_the_right_thing(self):
        for name in EXPECTED_OUTPUT:
            with self.subTest(example=name):
                r = run_trace(load(name), max_steps=MAX_STEPS_PER_EXAMPLE)
                self.assertEqual(r["status"], "completed", r.get("error"))
                self.assertEqual(r["output"], EXPECTED_OUTPUT[name])
                self.assertGreater(r["steps"], 0)

    def test_every_example_is_valid_json(self):
        for name in EXPECTED_OUTPUT:
            with self.subTest(example=name):
                json.dumps(run_trace(load(name), max_steps=MAX_STEPS_PER_EXAMPLE))

    def test_every_example_stays_small_enough_to_visualize(self):
        for name in EXPECTED_OUTPUT:
            with self.subTest(example=name):
                r = run_trace(load(name))
                self.assertLessEqual(r["steps"], MAX_STEPS_PER_EXAMPLE)
                self.assertLessEqual(len(r["trace"]), 500)

    def test_variables_example_covers_each_basic_type(self):
        r = run_trace(load("01_variables.py"))
        variables = last_state(r)["frames"][-1]["variables"]
        self.assertEqual(variables["name"], {"type": "str", "value": "Asha"})
        self.assertEqual(variables["age"], {"type": "int", "value": 12})
        self.assertEqual(variables["height"], {"type": "float", "value": 1.52})
        self.assertEqual(variables["is_student"], {"type": "bool", "value": True})
        self.assertEqual(variables["nothing"], {"type": "none"})

    def test_if_else_takes_only_the_matching_branch(self):
        r = run_trace(load("02_if_else.py"))
        lines = [e["line"] for e in events(r, "line")]
        self.assertIn(6, lines)       # the elif body ran
        self.assertNotIn(4, lines)    # the if body did not
        self.assertNotIn(8, lines)    # the else body did not

    def test_for_loop_rebinds_the_loop_variable_each_pass(self):
        r = run_trace(load("03_for_loop.py"))
        seen = [
            e["frames"][-1]["variables"]["n"]["value"]
            for e in events(r, "line")
            if e["line"] == 3 and "n" in e["frames"][-1]["variables"]
        ]
        self.assertEqual(seen, [1, 2, 3, 4, 5])

    def test_while_loop_stops_when_the_condition_fails(self):
        r = run_trace(load("04_while_loop.py"))
        lines = [e["line"] for e in events(r, "line")]
        self.assertEqual(lines.count(3), 6)  # the condition ran five times true, once false
        self.assertEqual(lines.count(4), 5)  # the body ran five times
        self.assertEqual(lines[-1], 6)       # "Liftoff" printed after the loop

    def test_lists_append_grows_the_same_object(self):
        r = run_trace(load("05_lists.py"))
        appending = next(e for e in events(r, "line") if e["line"] == 3)
        first_ref = appending["frames"][-1]["variables"]["fruits"]["id"]
        last = last_state(r)
        last_ref = last["frames"][-1]["variables"]["fruits"]["id"]
        self.assertEqual(first_ref, last_ref)  # append mutates, not replaces
        self.assertEqual(len(last["heap"][last_ref]["items"]), 3)

    def test_dictionaries_are_key_value_pairs(self):
        r = run_trace(load("06_dictionaries.py"))
        last = last_state(r)
        entry = last["heap"][last["frames"][-1]["variables"]["ages"]["id"]]
        self.assertEqual(entry["type"], "dict")
        self.assertEqual([pair["key"]["value"] for pair in entry["entries"]], ["Asha", "Ravi", "Meera"])
        self.assertEqual([pair["value"]["value"] for pair in entry["entries"]], [12, 13, 11])

    def test_function_call_has_its_own_frame_and_returns_a_value(self):
        r = run_trace(load("07_function.py"))
        calls = events(r, "call")
        self.assertEqual([c["function"] for c in calls], ["<module>", "greet"])
        returns = events(r, "return")
        self.assertEqual(returns[0]["function"], "greet")
        self.assertEqual(returns[0]["return_value"], {"type": "str", "value": "Hello, Asha"})
        self.assertEqual(len({c["frame_id"] for c in calls}), 2)

    def test_recursion_makes_one_frame_per_call(self):
        r = run_trace(load("08_recursion.py"))
        calls = events(r, "call")
        self.assertEqual([c["function"] for c in calls], ["<module>"] + ["fact"] * 5)
        self.assertEqual(len({c["frame_id"] for c in calls}), 6)
        deepest = max(r["trace"], key=lambda e: len(e.get("frames", [])))
        self.assertEqual(len(deepest["frames"]), 6)
        self.assertEqual(
            [f["variables"]["n"]["value"] for f in deepest["frames"][1:]],
            [5, 4, 3, 2, 1],
        )
        self.assertEqual(events(r, "return")[-2]["return_value"], {"type": "int", "value": 120})

    def test_bubble_sort_ends_with_a_sorted_list(self):
        r = run_trace(load("09_bubble_sort.py"))
        last = last_state(r)
        items = last["heap"][last["frames"][-1]["variables"]["numbers"]["id"]]["items"]
        self.assertEqual([i["value"] for i in items], [1, 2, 3, 4, 5])
        self.assertEqual([c["function"] for c in events(r, "call")], ["<module>"])

    def test_class_example_builds_an_object_with_attributes(self):
        r = run_trace(load("10_class.py"))
        last = last_state(r)
        rex = last["heap"][last["frames"][-1]["variables"]["rex"]["id"]]
        self.assertEqual(rex["type"], "object")
        self.assertEqual(rex["class"], "Dog")
        attrs = {a["name"]: a["value"] for a in rex["attrs"]}
        self.assertEqual(attrs["name"], {"type": "str", "value": "Rex"})
        tricks = last["heap"][attrs["tricks"]["id"]]
        self.assertEqual([t["value"] for t in tricks["items"]], ["sit", "shake"])
        # every trick call created its own frame
        self.assertEqual([c["function"] for c in events(r, "call")].count("learn"), 2)


if __name__ == "__main__":
    unittest.main()
