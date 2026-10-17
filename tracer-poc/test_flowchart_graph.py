"""Tests for flowchart.build_flowchart: the flowchart graph (format version 2).

The contract under test:

* one chart per function, keyed ``<main>`` for module-level code;
* node kinds are exactly the seven the renderer knows how to draw;
* decision and loop diamonds leave through edges labelled ``Yes`` and ``No``,
  and a loop has a back edge;
* **every executable line maps to exactly one node**, both for the statements
  in the source and for every line the tracer actually fires.
"""

import ast
import os
import unittest

from flowchart import build_flowchart
from tracer import run_trace

EXAMPLES_DIR = os.path.join(os.path.dirname(__file__), "examples")

KINDS = {"start", "end", "io", "process", "decision", "loop", "call", "return"}


# --- helpers ---------------------------------------------------------------
def all_nodes(flow):
    """Every node of every chart as ``(chart_name, node)``."""
    return [
        (name, node)
        for name, chart in flow["functions"].items()
        for node in chart["nodes"]
    ]


def nodes_covering(flow, line):
    """Every node whose ``lines`` range contains ``line``."""
    return [
        (name, node)
        for name, node in all_nodes(flow)
        if node["lines"] and node["lines"][0] <= line <= node["lines"][1]
    ]


def executable_lines(source):
    """Line numbers of every statement in the program."""
    tree = ast.parse(source)
    return {n.lineno for n in ast.walk(tree) if isinstance(n, ast.stmt)}


def fired_lines(source):
    """Line numbers the tracer actually fires while running the program."""
    result = run_trace(source)
    return {
        e["line"]
        for e in result["trace"]
        if e["event"] == "line" and e.get("line") is not None
    }


def out_edges(chart, node_id):
    return [e for e in chart["edges"] if e["from"] == node_id]


def node(chart, node_id):
    return next(n for n in chart["nodes"] if n["id"] == node_id)


def kind(chart, kind_name, index=0):
    found = [n for n in chart["nodes"] if n["kind"] == kind_name]
    return found[index]


def main_chart(flow):
    return flow["functions"]["<main>"]


def load_examples():
    for name in sorted(os.listdir(EXAMPLES_DIR)):
        with open(os.path.join(EXAMPLES_DIR, name), encoding="utf-8") as handle:
            yield name, handle.read()


TRICKY = {
    "nested_loops": (
        "for i in range(3):\n"
        "    for j in range(3):\n"
        "        print(i, j)\n"
    ),
    "elif_chain": (
        "marks = 68\n"
        "if marks >= 90:\n"
        "    grade = 'A'\n"
        "elif marks >= 60:\n"
        "    grade = 'B'\n"
        "elif marks >= 40:\n"
        "    grade = 'C'\n"
        "else:\n"
        "    grade = 'D'\n"
        "print(grade)\n"
    ),
    "break_continue": (
        "for i in range(5):\n"
        "    if i == 1:\n"
        "        continue\n"
        "    if i == 4:\n"
        "        break\n"
        "    print(i)\n"
        "print('done')\n"
    ),
    "recursion": (
        "def fact(n):\n"
        "    if n <= 1:\n"
        "        return 1\n"
        "    return n * fact(n - 1)\n"
        "\n"
        "print(fact(5))\n"
    ),
    "while_loop": (
        "count = 5\n"
        "while count > 0:\n"
        "    count = count - 1\n"
        "print(count)\n"
    ),
    "oneliners": "x = 1\nif x: y = 2\nfor i in range(3): print(i)\nprint(y)\n",
    "multiline_condition": (
        "marks = 95\n"
        "ok = True\n"
        "if (marks > 90\n"
        "        and ok):\n"
        "    grade = 'A'\n"
        "print(grade)\n"
    ),
    "decorated": (
        "def deco(fn):\n"
        "    return fn\n"
        "\n"
        "@deco\n"
        "def helper():\n"
        "    return 1\n"
        "\n"
        "helper()\n"
    ),
    "try_except": (
        "try:\n"
        "    x = 1 / 0\n"
        "except ZeroDivisionError:\n"
        "    x = 0\n"
        "finally:\n"
        "    y = 2\n"
        "print(x, y)\n"
    ),
    "nested_function": (
        "def outer(n):\n"
        "    def inner(x):\n"
        "        return x * 2\n"
        "    return inner(n) + 1\n"
        "\n"
        "outer(3)\n"
    ),
    "for_else": (
        "for n in range(3):\n"
        "    if n == 1:\n"
        "        break\n"
        "    print(n)\n"
        "else:\n"
        "    print('done')\n"
    ),
    "empty": "",
}

ALL_PROGRAMS = dict(TRICKY)
for _name, _source in load_examples():
    ALL_PROGRAMS[f"example:{_name}"] = _source


# --- tests -----------------------------------------------------------------
class FlowchartGraphTests(unittest.TestCase):
    def test_format_version_and_main_key(self):
        flow = build_flowchart("x = 1\n")
        self.assertEqual(flow["format_version"], 2)
        self.assertIsNone(flow["error"])
        self.assertIn("<main>", flow["functions"])

    def test_syntax_error_is_reported_not_raised(self):
        flow = build_flowchart("if True\n    x = 1\n")
        self.assertEqual(flow["error"]["type"], "SyntaxError")
        self.assertEqual(flow["error"]["line"], 1)
        self.assertEqual(flow["functions"], {})

    def test_every_node_kind_is_one_the_renderer_knows(self):
        for name, source in ALL_PROGRAMS.items():
            flow = build_flowchart(source)
            for chart_name, n in all_nodes(flow):
                self.assertIn(n["kind"], KINDS, f"{name} {chart_name} {n}")

    def test_start_and_end_have_no_lines(self):
        flow = build_flowchart("x = 1\n")
        chart = main_chart(flow)
        self.assertEqual(kind(chart, "start")["lines"], None)
        self.assertEqual(kind(chart, "end")["lines"], None)

    def test_node_ids_are_unique_within_a_chart(self):
        for name, source in ALL_PROGRAMS.items():
            flow = build_flowchart(source)
            for chart_name, chart in flow["functions"].items():
                ids = [n["id"] for n in chart["nodes"]]
                self.assertEqual(len(ids), len(set(ids)), f"{name} {chart_name}")
                self.assertEqual(chart["entry"], ids[0])
                self.assertEqual(chart["exit"], ids[1])

    def test_every_edge_references_existing_nodes(self):
        for name, source in ALL_PROGRAMS.items():
            flow = build_flowchart(source)
            for chart_name, chart in flow["functions"].items():
                ids = {n["id"] for n in chart["nodes"]}
                for edge in chart["edges"]:
                    self.assertIn(edge["from"], ids, f"{name} {chart_name}")
                    self.assertIn(edge["to"], ids, f"{name} {chart_name}")
                    self.assertIn(edge["label"], (None, "Yes", "No"), f"{name}")

    def test_every_statement_line_maps_to_exactly_one_node(self):
        for name, source in ALL_PROGRAMS.items():
            flow = build_flowchart(source)
            for line in executable_lines(source):
                hits = nodes_covering(flow, line)
                self.assertEqual(
                    len(hits), 1,
                    f"{name} line {line} maps to {[h[0] + ':' + h[1]['id'] for h in hits]}",
                )

    def test_every_traced_line_maps_to_exactly_one_node(self):
        """The real requirement: whatever the tracer fires must highlight."""
        for name, source in ALL_PROGRAMS.items():
            if not source.strip():
                continue
            flow = build_flowchart(source)
            for line in fired_lines(source):
                hits = nodes_covering(flow, line)
                self.assertEqual(
                    len(hits), 1,
                    f"{name} traced line {line} maps to {hits}",
                )


class DiamondTests(unittest.TestCase):
    def test_if_else_leaves_through_yes_and_no(self):
        flow = build_flowchart("x = 1\nif x:\n    y = 2\nelse:\n    y = 3\n")
        chart = main_chart(flow)
        decision = kind(chart, "decision")
        labels = sorted(e["label"] for e in out_edges(chart, decision["id"]))
        self.assertEqual(labels, ["No", "Yes"])
        self.assertEqual(decision["test"], "x")
        self.assertTrue(decision["label"].endswith("?"), decision["label"])

    def test_if_without_else_still_gets_a_no_edge(self):
        flow = build_flowchart("if x:\n    y = 1\n")
        chart = main_chart(flow)
        decision = kind(chart, "decision")
        labels = sorted(e["label"] for e in out_edges(chart, decision["id"]))
        self.assertEqual(labels, ["No", "Yes"])

    def test_elif_chain_becomes_a_chain_of_decisions(self):
        flow = build_flowchart(TRICKY["elif_chain"])
        chart = main_chart(flow)
        decisions = [n for n in chart["nodes"] if n["kind"] == "decision"]
        self.assertEqual(len(decisions), 3)
        self.assertEqual(
            [d["test"] for d in decisions],
            ["marks >= 90", "marks >= 60", "marks >= 40"],
        )
        # each decision's No edge leads to the next decision, except the last
        for first, second in zip(decisions, decisions[1:]):
            edge = next(e for e in out_edges(chart, first["id"]) if e["label"] == "No")
            self.assertEqual(edge["to"], second["id"])
        last_labels = sorted(
            e["label"] for e in out_edges(chart, decisions[-1]["id"])
        )
        self.assertEqual(last_labels, ["No", "Yes"])

    def test_uses_at_least_signs_in_questions(self):
        flow = build_flowchart("n = 3\nif n <= 1:\n    print(1)\n")
        decision = kind(main_chart(flow), "decision")
        self.assertIn("≤", decision["label"])
        self.assertEqual(decision["test"], "n <= 1")

    def test_multiline_condition_covers_every_condition_line(self):
        flow = build_flowchart(TRICKY["multiline_condition"])
        decision = kind(main_chart(flow), "decision")
        self.assertEqual(decision["lines"], [3, 4])


class LoopTests(unittest.TestCase):
    def test_for_loop_asks_about_remaining_items(self):
        flow = build_flowchart("nums = [1]\nfor n in nums:\n    print(n)\n")
        loop = kind(main_chart(flow), "loop")
        self.assertEqual(loop["label"], "Any items left in nums?")
        self.assertEqual(loop["loop"], "for")
        self.assertEqual(loop["test"], "nums")

    def test_for_range_asks_about_more_numbers(self):
        flow = build_flowchart("for n in range(1, 6):\n    print(n)\n")
        loop = kind(main_chart(flow), "loop")
        self.assertEqual(loop["label"], "Any more numbers to go?")

    def test_while_loop_uses_a_question(self):
        flow = build_flowchart(TRICKY["while_loop"])
        loop = kind(main_chart(flow), "loop")
        self.assertEqual(loop["loop"], "while")
        self.assertEqual(loop["test"], "count > 0")
        self.assertTrue(loop["label"].startswith("Is "), loop["label"])

    def test_loop_has_a_yes_edge_in_and_a_back_edge_out(self):
        flow = build_flowchart(TRICKY["while_loop"])
        chart = main_chart(flow)
        loop = kind(chart, "loop")
        labels = {e["label"] for e in out_edges(chart, loop["id"])}
        self.assertEqual(labels, {"No", "Yes"})
        back = [e for e in out_edges(chart, loop["id"]) if e["label"] == "Yes"]
        # the body's last node points back at the diamond
        body_last = back[0]["to"]
        returns = [e for e in out_edges(chart, body_last) if e["back"]]
        self.assertTrue(returns, "body should loop back to the diamond")
        self.assertEqual(returns[0]["to"], loop["id"])

    def test_back_edges_exist_and_only_leave_bodies(self):
        for name, source in ALL_PROGRAMS.items():
            flow = build_flowchart(source)
            for chart_name, chart in flow["functions"].items():
                ids = [n["id"] for n in chart["nodes"]]
                for edge in chart["edges"]:
                    if not edge["back"]:
                        continue
                    # a back edge points at a diamond, and never forward
                    target = node(chart, edge["to"])
                    self.assertEqual(target["kind"], "loop", f"{name} {chart_name}")
                    self.assertLess(
                        ids.index(edge["to"]), ids.index(edge["from"]),
                        f"{name} {chart_name} back edge should not point forward",
                    )

    def test_nested_loops_back_to_their_own_diamond(self):
        flow = build_flowchart(TRICKY["nested_loops"])
        chart = main_chart(flow)
        loops = [n for n in chart["nodes"] if n["kind"] == "loop"]
        self.assertEqual(len(loops), 2)
        outer, inner = loops
        back_targets = {
            e["to"] for e in chart["edges"] if e["back"]
        }
        self.assertIn(inner["id"], back_targets)
        self.assertIn(outer["id"], back_targets)
        # the inner loop falls out through its own No edge
        inner_no = next(
            e for e in out_edges(chart, inner["id"]) if e["label"] == "No"
        )
        self.assertEqual(inner_no["to"], outer["id"])

    def test_break_escapes_past_the_loop(self):
        flow = build_flowchart(TRICKY["break_continue"])
        chart = main_chart(flow)
        breaker = next(n for n in chart["nodes"] if n["label"] == "Leave the loop")
        outs = out_edges(chart, breaker["id"])
        self.assertEqual(len(outs), 1)
        self.assertFalse(outs[0]["back"], "break must not loop back")
        # it lands on the statement after the loop, not on the diamond
        loop = kind(chart, "loop")
        self.assertNotEqual(outs[0]["to"], loop["id"])
        landing = node(chart, outs[0]["to"])
        self.assertEqual(landing["label"], "Show 'done'")

    def test_continue_returns_to_its_own_loop(self):
        flow = build_flowchart(TRICKY["break_continue"])
        chart = main_chart(flow)
        cont = next(n for n in chart["nodes"] if n["label"] == "Go to the next round")
        outs = out_edges(chart, cont["id"])
        self.assertEqual(len(outs), 1)
        self.assertTrue(outs[0]["back"])
        target = node(chart, outs[0]["to"])
        self.assertEqual(target["kind"], "loop")
        self.assertEqual(target["id"], kind(chart, "loop")["id"])

    def test_for_else_puts_else_on_the_no_edge(self):
        flow = build_flowchart(TRICKY["for_else"])
        chart = main_chart(flow)
        loop = kind(chart, "loop")
        no = next(e for e in out_edges(chart, loop["id"]) if e["label"] == "No")
        target = node(chart, no["to"])
        self.assertEqual(target["kind"], "io")
        self.assertIn("done", target["label"])


class ShapeTests(unittest.TestCase):
    def test_print_becomes_an_io_box(self):
        flow = build_flowchart("x = 1\nprint(x)\n")
        box = kind(main_chart(flow), "io")
        self.assertEqual(box["label"], "Show x")
        self.assertEqual(box["code"], "print(x)")

    def test_complex_print_says_show_the_result(self):
        flow = build_flowchart("print(fact(3), nums)\n")
        self.assertEqual(kind(main_chart(flow), "io")["label"], "Show the result")

    def test_input_becomes_an_io_box(self):
        flow = build_flowchart('name = input("Who?")\n')
        box = kind(main_chart(flow), "io")
        self.assertEqual(box["label"], 'Ask "Who?" and make name')

    def test_assignment_label_is_plain_english(self):
        flow = build_flowchart("total = 0\n")
        box = kind(main_chart(flow), "process")
        self.assertEqual(box["label"], "Make total = 0")
        self.assertEqual(box["code"], "total = 0")

    def test_augmented_assignment_uses_a_verb(self):
        flow = build_flowchart("total = 0\ntotal += 3\n")
        box = [n for n in main_chart(flow)["nodes"] if n["kind"] == "process"][1]
        self.assertEqual(box["label"], "Add 3 to total")

    def test_return_is_an_oval_with_its_value(self):
        flow = build_flowchart("def f():\n    return 5\n")
        box = kind(flow["functions"]["f"], "return")
        self.assertEqual(box["label"], "Return 5")

    def test_bare_return_says_nothing(self):
        flow = build_flowchart("def f():\n    return\n")
        box = kind(flow["functions"]["f"], "return")
        self.assertEqual(box["label"], "Return nothing")

    def test_return_edges_point_at_the_end(self):
        flow = build_flowchart(TRICKY["recursion"])
        chart = flow["functions"]["f"] if "f" in flow["functions"] else flow["functions"]["fact"]
        for box in [n for n in chart["nodes"] if n["kind"] == "return"]:
            outs = out_edges(chart, box["id"])
            self.assertEqual(len(outs), 1)
            self.assertEqual(outs[0]["to"], chart["exit"])


class FunctionTests(unittest.TestCase):
    def test_function_gets_its_own_chart_with_params(self):
        flow = build_flowchart(TRICKY["recursion"])
        self.assertIn("fact", flow["functions"])
        self.assertEqual(flow["functions"]["fact"]["params"], ["n"])

    def test_definition_site_is_a_box_that_links_to_the_chart(self):
        flow = build_flowchart(TRICKY["recursion"])
        chart = main_chart(flow)
        box = kind(chart, "process")
        self.assertEqual(box["label"], "Define fact(n)")
        self.assertEqual(box["defines"], "fact")

    def test_call_box_links_to_the_function_chart(self):
        flow = build_flowchart("def greet():\n    print(1)\n\ngreet()\n")
        box = kind(main_chart(flow), "call")
        self.assertEqual(box["calls"], "greet")

    def test_builtin_calls_stay_unlinked_process_boxes(self):
        flow = build_flowchart("nums = [1]\nn = len(nums)\n")
        box = next(n for n in main_chart(flow)["nodes"] if n["label"].startswith("Make n"))
        self.assertEqual(box["kind"], "process")
        self.assertNotIn("calls", box)

    def test_nested_functions_get_their_own_charts(self):
        flow = build_flowchart(TRICKY["nested_function"])
        self.assertEqual(
            sorted(flow["functions"]), ["<main>", "inner", "outer"]
        )
        outer = flow["functions"]["outer"]
        define = next(n for n in outer["nodes"] if n["kind"] == "process")
        self.assertEqual(define["defines"], "inner")

    def test_class_gets_a_chart_and_each_method_gets_one(self):
        source = (
            "class Dog:\n"
            "    def __init__(self, name):\n"
            "        self.name = name\n"
            "\n"
            "    def learn(self, trick):\n"
            "        self.tricks.append(trick)\n"
            "\n"
            "rex = Dog('Rex')\n"
            "rex.learn('sit')\n"
        )
        flow = build_flowchart(source)
        self.assertEqual(
            sorted(flow["functions"]), ["<main>", "Dog", "__init__", "learn"]
        )
        # the definition box in <main> links to the class chart
        define = [n for n in main_chart(flow)["nodes"]
                  if n.get("defines") == "Dog"][0]
        self.assertEqual(define["label"], "Define class Dog")
        # the call site links to the method chart
        call = [n for n in main_chart(flow)["nodes"] if n["kind"] == "call"][1]
        self.assertEqual(call["calls"], "learn")

    def test_method_charts_include_self(self):
        source = (
            "class Dog:\n"
            "    def learn(self, trick):\n"
            "        self.tricks.append(trick)\n"
        )
        flow = build_flowchart(source)
        self.assertEqual(flow["functions"]["learn"]["params"], ["self", "trick"])


class TenExamplesTests(unittest.TestCase):
    def test_all_ten_examples_build_without_error(self):
        found = list(load_examples())
        self.assertEqual(len(found), 10, "expected 10 example programs")
        for name, source in found:
            flow = build_flowchart(source)
            self.assertIsNone(flow["error"], f"{name}: {flow['error']}")
            self.assertIn("<main>", flow["functions"], name)

    def test_all_ten_examples_trace_and_cover_every_line(self):
        for name, source in load_examples():
            flow = build_flowchart(source)
            for line in fired_lines(source):
                self.assertEqual(
                    len(nodes_covering(flow, line)), 1,
                    f"{name}: line {line} not uniquely mapped",
                )

    def test_example_8_recursion_has_a_fact_chart(self):
        with open(os.path.join(EXAMPLES_DIR, "08_recursion.py"), encoding="utf-8") as h:
            flow = build_flowchart(h.read())
        self.assertIn("fact", flow["functions"])
        chart = flow["functions"]["fact"]
        self.assertEqual(chart["params"], ["n"])
        returns = [n for n in chart["nodes"] if n["kind"] == "return"]
        self.assertEqual(len(returns), 2)

    def test_example_9_bubble_sort_has_nested_loops_and_a_decision(self):
        with open(os.path.join(EXAMPLES_DIR, "09_bubble_sort.py"), encoding="utf-8") as h:
            flow = build_flowchart(h.read())
        chart = main_chart(flow)
        kinds = [n["kind"] for n in chart["nodes"]]
        self.assertEqual(kinds.count("loop"), 2)
        self.assertEqual(kinds.count("decision"), 1)


if __name__ == "__main__":
    unittest.main()
