"""Tests for the static, AST-only program profiler (tracer-poc/analyze.py).

The analyzer is deliberately not a runtime observer: every test here checks a
syntactic fact, a source location, or a structured failure.  The side-effect
test proves the source was never executed.
"""

import json
import tempfile
import unittest
from pathlib import Path

import analyze


def profile(source):
    return analyze.analyze_source(source)


def by_name(value, name):
    return [item for item in value["functions"] if item["name"] == name]


def mutations(value, kind=None):
    return [
        item
        for item in value["mutations"]
        if kind is None or item["kind"] == kind or item["operation"] == kind
    ]


class ProfileTests(unittest.TestCase):
    def test_profile_is_versioned_deterministic_and_json_safe(self):
        source = """x = 1
if x > 0:
    x = x + 1
"""
        first = profile(source)
        second = profile(source)
        self.assertEqual(first, second)
        self.assertEqual(analyze.analyze_json(source), analyze.analyze_json(source))
        self.assertEqual(json.loads(analyze.analyze_json(source)), first)

        self.assertEqual(first["profile_version"], 1)
        self.assertEqual(first["kind"], "program_profile")
        self.assertEqual(first["language"], "python")
        self.assertEqual(first["status"], "ok")
        self.assertEqual(first["source"], {"lines": 4, "characters": len(source)})
        self.assertNotIn("trace", first)
        self.assertNotIn("events", first)
        for function in first["functions"]:
            self.assertNotIn("_node_body", function)

    def test_nested_expressions_get_unique_stable_ids(self):
        value = profile("def run(g):\n    return g()()\n")
        ids = [item["id"] for item in value["calls"]]
        self.assertEqual(len(ids), 2)
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(ids, [item["id"] for item in value["calls"]])
        self.assertEqual(set(value["functions"][0]["call_ids"]), set(ids))

    def test_plain_assignments_and_expressions(self):
        value = profile("x = 1\ny = x + 2\nz = y * 3\n")
        self.assertEqual(value["status"], "ok")
        self.assertEqual(value["functions"], [])
        self.assertEqual(value["calls"], [])
        self.assertEqual(value["mutations"], [])
        self.assertEqual(value["comparisons"], [])
        self.assertEqual(value["summary"]["functions"], 0)

    def test_if_else_elif_and_nested_loops(self):
        value = profile(
            """for i in range(3):
    if i > 1:
        while i < 2:
            i += 1
    elif i == 0:
        pass
    else:
        for j in range(2):
            pass
"""
        )
        self.assertEqual([loop["kind"] for loop in value["loops"]], ["for", "while", "for"])
        self.assertEqual([loop["depth"] for loop in value["loops"]], [1, 2, 2])
        self.assertEqual(value["loops"][0]["parent_id"], None)
        self.assertEqual(value["loops"][1]["parent_id"], value["loops"][0]["id"])
        self.assertEqual(value["summary"]["max_loop_depth"], 2)
        self.assertEqual([item["kind"] for item in value["decisions"]], ["for", "if", "while", "elif", "for"])
        self.assertEqual([item["kind"] for item in value["conditions"]], ["if", "while", "elif"])
        self.assertEqual(
            [item["operators"] for item in value["comparisons"]],
            [[">"], ["<"], ["=="]],
        )

    def test_direct_and_mutual_recursion_candidates(self):
        value = profile(
            """def fact(n):
    if n <= 1:
        return 1
    return n * fact(n - 1)

def is_even(n):
    if n == 0:
        return True
    return is_odd(n - 1)

def is_odd(n):
    if n == 0:
        return False
    return is_even(n - 1)
"""
        )
        fact = by_name(value, "fact")[0]
        even = by_name(value, "is_even")[0]
        odd = by_name(value, "is_odd")[0]
        self.assertTrue(fact["direct_self_recursion"])
        self.assertFalse(even["direct_self_recursion"])
        self.assertEqual(odd["call_count"], 1)
        self.assertEqual(value["recursion"]["direct"], [fact["id"]])
        self.assertEqual(value["recursion"]["mutual_candidates"], [[even["id"], odd["id"]]])
        self.assertIn(odd["id"], value["call_graph"][even["id"]])
        self.assertIn(even["id"], value["call_graph"][odd["id"]])

    def test_calls_parameters_returns_and_defaults(self):
        value = profile(
            """def greet(name, punctuation="!"):
    return "hi " + name + punctuation

result = greet("Asha")
"""
        )
        greet = by_name(value, "greet")[0]
        self.assertEqual([item["name"] for item in greet["parameters"]], ["name", "punctuation"])
        self.assertEqual([item["kind"] for item in greet["parameters"]], ["positional", "positional"])
        self.assertEqual(greet["parameters"][1]["default"]["label"], "'!'")
        self.assertTrue(greet["has_return_value"])
        self.assertEqual(greet["return_count"], 1)
        call = next(item for item in value["calls"] if item["name"] == "greet")
        self.assertEqual(call["caller"], "module")
        self.assertEqual(call["resolved_function_id"], greet["id"])
        self.assertEqual(call["resolution"], "name_candidate")
        self.assertEqual(value["returns"][0]["value"]["kind"], "BinOp")

        empty = profile("def stop():\n    return\n")
        self.assertFalse(by_name(empty, "stop")[0]["has_return_value"])

        shaped = profile("def shaped(a, /, b=2, *args, c, d=4, **kwargs):\n    pass\n")
        parameters = by_name(shaped, "shaped")[0]["parameters"]
        self.assertEqual(
            [(item["name"], item["kind"], item["has_default"]) for item in parameters],
            [
                ("a", "positional_only", False),
                ("b", "positional", True),
                ("args", "vararg", False),
                ("c", "keyword_only", False),
                ("d", "keyword_only", True),
                ("kwargs", "kwarg", False),
            ],
        )

    def test_mutations_indexing_slices_and_container_operations(self):
        value = profile(
            """items = [1, 2]
items.append(3)
items += [6]
items[0] = 4
items[1:2] = [5]
last = items[0]
d = {}
d["x"] = 1
d.update({"y": 2})
d |= {"z": 3}
obj.attr = 3
del items[0]
del obj.attr
"""
        )
        found = {(item["kind"], item["operation"]) for item in value["mutations"]}
        self.assertIn(("list_method", "append"), found)
        self.assertIn(("list_method", "augmented_add"), found)
        self.assertIn(("dict_method", "augmented_merge"), found)
        self.assertIn(("index", "assign"), found)
        self.assertIn(("slice", "assign"), found)
        self.assertIn(("index", "delete"), found)
        self.assertIn(("dict_method", "update"), found)
        self.assertIn(("attribute", "assign"), found)
        self.assertIn(("attribute", "delete"), found)
        append = next(item for item in value["mutations"] if item["operation"] == "append")
        self.assertEqual(append["container_kind"], "list")
        index = next(item for item in value["mutations"] if item["kind"] == "slice")
        self.assertEqual(index["container_kind"], "list")
        operations = {item["operation"] for item in value["container_operations"]}
        self.assertIn("list_literal", operations)
        self.assertIn("dict_literal", operations)
        self.assertIn("index_read", operations)
        self.assertIn("append", operations)

    def test_empty_source_and_syntax_errors_are_safe(self):
        empty = profile("")
        self.assertEqual(empty["status"], "ok")
        self.assertEqual(empty["functions"], [])
        self.assertEqual(empty["summary"]["functions"], 0)
        self.assertEqual(empty["diagnostics"], [])

        broken = profile("def broken(:\n    pass\n")
        self.assertEqual(broken["status"], "syntax_error")
        self.assertEqual(broken["functions"], [])
        self.assertEqual(broken["calls"], [])
        self.assertEqual(broken["diagnostics"][0]["code"], "syntax_error")
        self.assertEqual(broken["diagnostics"][0]["line"], 1)
        self.assertGreaterEqual(broken["diagnostics"][0]["column"], 0)
        json.dumps(broken)

    def test_unusual_identifiers_nested_functions_and_decorators(self):
        value = profile(
            '''class Café:
    @decorator("x")
    def méthode(self, π=3.14):
        def inner(δ):
            return δ
        return inner(π)
'''
        )
        method = by_name(value, "méthode")[0]
        inner = by_name(value, "inner")[0]
        self.assertEqual(method["qualified_name"], "Café.méthode")
        self.assertEqual(inner["qualified_name"], "Café.méthode.inner")
        self.assertEqual(inner["parent_function_id"], method["id"])
        self.assertEqual(inner["class"], "Café")
        self.assertEqual(method["parameters"][0]["name"], "self")
        self.assertEqual(method["parameters"][1]["name"], "π")
        self.assertEqual(method["decorators"][0]["label"], "decorator('x')")
        self.assertEqual(value["status"], "ok")

    def test_source_is_never_executed(self):
        with tempfile.TemporaryDirectory() as directory:
            sentinel = Path(directory) / "executed.txt"
            source = (
                "from pathlib import Path\n"
                f"Path({str(sentinel)!r}).write_text('ran')\n"
                "while True:\n"
                "    pass\n"
            )
            value = profile(source)
            self.assertEqual(value["status"], "ok")
            self.assertEqual(len(value["loops"]), 1)
            self.assertFalse(sentinel.exists())
            self.assertNotIn("ran", json.dumps(value["source"]))


if __name__ == "__main__":
    unittest.main()
