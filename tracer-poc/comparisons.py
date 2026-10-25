"""
Comparison capture (proof of concept; not yet part of the trace format).

Why this exists
    A trace records state, not intent. Nothing in it says which two values a
    program compared, or with which operator, so a visualizer could only guess
    from source text or from "the cells that look involved". This module rewrites
    a program's syntax tree so every *supported* comparison reports its own
    operands, operator and outcome, and it is written so the rewrite provably
    does not change what the program does.

How the rewrite preserves semantics
    `a OP b` becomes `__codelens_compare__("OP", line, a, b)`:
      * the operands are still evaluated left to right, exactly once each;
      * the comparison itself runs once, by operator-function dispatch;
      * the value returned is the object the comparison really produced, so a
        custom rich comparison returning a non-bool is passed straight through
        and is never truth-tested here;
      * short-circuiting is untouched: only a single, non-chained comparison is
        wrapped, so `and`, `or` and `a < b < c` keep their own control flow;
      * exceptions propagate unchanged; an extra frame appears in the raw
        traceback, but the reported source line is the comparison's own line.

    A subscript operand (`a[i]`) becomes `__codelens_cell__(a, i)`, which reads
    the element once and remembers where it came from, so a visualizer can
    highlight the real cells instead of neighbouring values.

Deliberately not captured
    * chained comparisons (`a < b < c`): wrapping would mean splitting the node,
      which changes evaluation count and short-circuit behaviour;
    * comparisons whose operands contain `yield`, `yield from` or `await`;
    * slices and multi-dimensional subscripts as cells (the value is recorded,
      the position is not);
    * anything that is not a comparison.

Known limitations
    * two hidden module-level names (`__codelens_compare__`,
      `__codelens_cell__`) exist in the program's globals. They start with `__`,
      which the tracer already hides from `variables`, and no user name is
      touched;
    * the helper adds a Python frame, so an exception raised *by* a comparison
      has one more frame in the raw traceback. The type, message and user source
      line are unchanged;
    * a program that counts its own calls through `sys.settrace` or
      `sys.monitoring` will see the helpers;
    * an operand is held by reference until its record is consumed, which can
      keep a temporary alive slightly longer.

Usage (the caller owns policy; this module never touches the tracer)
    tree = instrument(source)
    code = compile(tree, "<user>", "exec")
    recorder = Recorder()
    exec(code, namespace(recorder))
    recorder.records   # one dict per comparison, in evaluation order
"""

import ast
import operator

COMPARE_NAME = "__codelens_compare__"
CELL_NAME = "__codelens_cell__"

_OPERATOR_TEXT = {
    ast.Lt: "<",
    ast.LtE: "<=",
    ast.Gt: ">",
    ast.GtE: ">=",
    ast.Eq: "==",
    ast.NotEq: "!=",
    ast.Is: "is",
    ast.IsNot: "is not",
    ast.In: "in",
    ast.NotIn: "not in",
}

_FUNCTIONS = {
    "<": operator.lt,
    "<=": operator.le,
    ">": operator.gt,
    ">=": operator.ge,
    "==": operator.eq,
    "!=": operator.ne,
    "is": operator.is_,
    "is not": operator.is_not,
    # `a in b` is `contains(b, a)`, so these take the operands in source order.
    "in": lambda left, right: left in right,
    "not in": lambda left, right: left not in right,
}

# An operand expression that makes the rewrite step outside a comparison's own
# semantics. Those comparisons are left exactly as they were written.
_UNSAFE_OPERAND = (ast.Yield, ast.YieldFrom, ast.Await)


class Operand:
    """One evaluated operand: the value, plus the cell it was read from."""

    __slots__ = ("value", "container", "index")

    def __init__(self, value, container=None, index=None):
        self.value = value
        self.container = container
        self.index = index


def read_cell(container, index):
    """Read `container[index]` once and remember where it came from."""
    return Operand(container[index], container, index)


def _value(operand):
    return operand.value if isinstance(operand, Operand) else operand


def _cell(operand):
    if not isinstance(operand, Operand) or operand.container is None:
        return None
    return {"container": operand.container, "index": operand.index, "value": operand.value}


def _outcome(result):
    """True or False only when the comparison really produced that bool."""
    if result is True:
        return True
    if result is False:
        return False
    # Any other object is a comparison result we must not interpret. `is`
    # checks never call __bool__ or __eq__, so nothing here can run user code.
    return None


class Recorder:
    """A comparison sink. Stands in for the tracer until this is wired in."""

    def __init__(self):
        self.records = []

    def __call__(self, operator_text, line, left, right):
        record = {
            "operator": operator_text,
            "line": line,
            "left": _value(left),
            "right": _value(right),
            "cells": [cell for cell in (_cell(left), _cell(right)) if cell is not None],
            "result": None,
        }
        # Recorded before the comparison runs: an exception raised *by* the
        # comparison therefore still shows its operands, with no invented result.
        self.records.append(record)
        result = _FUNCTIONS[operator_text](_value(left), _value(right))
        record["result"] = _outcome(result)
        return result


def _contains_unsafe(node):
    return any(isinstance(child, _UNSAFE_OPERAND) for child in ast.walk(node))


class _Rewriter(ast.NodeTransformer):
    def visit_Compare(self, node):
        # Chained comparisons are one node with several operators; leaving them
        # whole is what keeps their single-evaluation short-circuit behaviour.
        if len(node.ops) != 1:
            return node
        operator_text = _OPERATOR_TEXT.get(type(node.ops[0]))
        if operator_text is None:
            return node
        if _contains_unsafe(node.left) or _contains_unsafe(node.comparators[0]):
            return node

        # Rewrite nested comparisons inside the operands first, so a supported
        # comparison used as an operand reports its own values too.
        self.generic_visit(node)
        left = self._operand(node.left)
        right = self._operand(node.comparators[0])
        call = ast.Call(
            func=ast.Name(id=COMPARE_NAME, ctx=ast.Load()),
            args=[
                ast.Constant(operator_text),
                ast.Constant(node.lineno),
                left,
                right,
            ],
            keywords=[],
        )
        return ast.copy_location(call, node)

    def _operand(self, expr):
        if not isinstance(expr, ast.Subscript):
            return expr
        if isinstance(expr.slice, (ast.Slice, ast.Tuple)):
            return expr  # a slice or several indices: the value, not one cell
        position = expr.slice
        if isinstance(position, ast.Slice):
            return expr
        call = ast.Call(
            func=ast.Name(id=CELL_NAME, ctx=ast.Load()),
            args=[expr.value, position],
            keywords=[],
        )
        return ast.copy_location(call, expr)


def instrument(source):
    """Parse `source` and return a tree whose comparisons report themselves.

    Line numbers are preserved: every new node takes the location of the node it
    replaces, so `line` events and tracebacks keep pointing at the same source
    line as the unmodified program.
    """
    tree = ast.parse(source)
    tree = _Rewriter().visit(tree)
    return ast.fix_missing_locations(tree)


def namespace(recorder):
    """The globals an instrumented program needs. Nothing user-visible is added."""
    return {"__name__": "__main__", COMPARE_NAME: recorder, CELL_NAME: read_cell}
