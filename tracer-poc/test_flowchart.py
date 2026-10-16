"""Tests for build_flowchart: the AST summary that powers the flowchart view."""

import unittest

from tracer import build_flowchart


def module_nodes(source):
    return build_flowchart(source)["functions"]["<module>"]["nodes"]


class FlowchartTests(unittest.TestCase):
    def test_plain_statements_in_order(self):
        nodes = module_nodes("x = 1\ny = x + 2\nprint(y)\n")
        self.assertEqual([n["kind"] for n in nodes], ["statement"] * 3)
        self.assertEqual(nodes[0]["text"], "x = 1")
        self.assertEqual(nodes[2]["text"], "print(y)")
        self.assertEqual(nodes[0]["line"], 1)

    def test_if_elif_else_becomes_one_branch_with_three_arms(self):
        src = (
            "marks = 68\n"
            "if marks >= 90:\n"
            "    grade = 'A'\n"
            "elif marks >= 60:\n"
            "    grade = 'B'\n"
            "else:\n"
            "    grade = 'C'\n"
        )
        nodes = module_nodes(src)
        branch = nodes[1]
        self.assertEqual(branch["kind"], "branch")
        self.assertEqual([a["test"] for a in branch["arms"]], ["marks >= 90", "marks >= 60", None])
        self.assertEqual(branch["arms"][1]["body"][0]["text"], "grade = 'B'")
        self.assertEqual(branch["arms"][2]["body"][0]["text"], "grade = 'C'")

    def test_if_without_else_has_no_else_arm(self):
        branch = module_nodes("if x:\n    y = 1\n")[0]
        self.assertEqual(len(branch["arms"]), 1)

    def test_for_and_while_loops(self):
        nodes = module_nodes("for n in range(3):\n    total += n\nwhile total > 0:\n    total -= 1\n")
        self.assertEqual(nodes[0]["kind"], "loop")
        self.assertEqual(nodes[0]["loop"], "for")
        self.assertEqual(nodes[0]["header"], "for n in range(3)")
        self.assertEqual(nodes[0]["body"][0]["text"], "total += n")
        self.assertEqual(nodes[1]["loop"], "while")
        self.assertEqual(nodes[1]["header"], "while total > 0")

    def test_nested_loops_keep_their_bodies(self):
        src = "for i in range(3):\n    for j in range(3):\n        print(i, j)\n"
        inner = module_nodes(src)[0]["body"][0]
        self.assertEqual(inner["kind"], "loop")
        self.assertEqual(inner["body"][0]["text"], "print(i, j)")

    def test_functions_get_their_own_chart_with_params(self):
        src = "def fact(n):\n    return n * fact(n - 1)\n\nprint(fact(5))\n"
        flow = build_flowchart(src)
        self.assertIn("fact", flow["functions"])
        self.assertEqual(flow["functions"]["fact"]["params"], ["n"])
        self.assertEqual(flow["functions"]["fact"]["nodes"][0]["text"], "return n * fact(n - 1)")
        # the definition site still shows in the module chart
        self.assertEqual(module_nodes(src)[0]["text"], "define fact(n)")

    def test_methods_get_their_own_chart(self):
        src = (
            "class Dog:\n"
            "    def __init__(self, name):\n"
            "        self.name = name\n"
            "    def learn(self, trick):\n"
            "        self.tricks.append(trick)\n"
        )
        flow = build_flowchart(src)
        self.assertIn("__init__", flow["functions"])
        self.assertEqual(flow["functions"]["learn"]["nodes"][0]["text"], "self.tricks.append(trick)")

    def test_multi_line_statement_gets_full_range(self):
        nodes = module_nodes("total = (\n    1 + 2\n    + 3\n)\n")
        self.assertEqual(nodes[0]["line"], 1)
        self.assertEqual(nodes[0]["end_line"], 4)
        self.assertNotIn("\n", nodes[0]["text"])

    def test_syntax_error_is_reported_not_raised(self):
        flow = build_flowchart("if True\n    x = 1\n")
        self.assertEqual(flow["error"]["type"], "SyntaxError")
        self.assertEqual(flow["error"]["line"], 1)

    def test_examples_all_build(self):
        import os

        example_dir = os.path.join(os.path.dirname(__file__), "examples")
        for name in sorted(os.listdir(example_dir)):
            with open(os.path.join(example_dir, name), encoding="utf-8") as handle:
                flow = build_flowchart(handle.read())
            self.assertIsNone(flow["error"], f"{name}: {flow['error']}")
            self.assertIn("<module>", flow["functions"], name)


if __name__ == "__main__":
    unittest.main()
