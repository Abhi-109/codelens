"""Builds a flowchart graph from Python source (flowchart format version 2).

``build_flowchart(source)`` parses the source with Python's own ``ast`` module
and returns one chart per function, in a shape an SVG renderer can draw
directly::

    {"format_version": 2,
     "error": None,
     "functions": {
        "<main>": {"name": "<main>", "params": [], "entry": "n1", "exit": "n2",
                   "nodes": [{"id": "n1", "kind": "start", "label": "Start",
                              "code": "", "lines": None}, ...],
                   "edges": [{"from": "n1", "to": "n3", "label": None,
                              "back": False}, ...]},
        "fact": {...}}}

Node kinds
    start, end   oval terminators (teal)
    io           parallelogram: input() / print() (copper)
    process      rectangle: assignment, calculation, other statements
    decision     diamond: if / elif condition (amber)
    loop         diamond: while / for (amber)
    call         rectangle with double side bars: a call to another chart
    return       oval: ``return 5`` (teal)

Every node except ``start`` / ``end`` carries ``lines``, the ``[start, end]``
source range a ``line`` event can map to. Ranges never overlap *within one
chart*, so "which node is on line N" is a single lookup. ``lines`` is ``null``
for start/end because no line event ever lands there.

Edges are ``{"from", "to", "label", "back"}``: ``label`` is ``"Yes"`` or
``"No"`` for the branches out of a diamond (null otherwise), and ``back`` is
true for an arrow that loops back to its diamond.

See docs/flowchart-format.md for the full contract.

Why a sibling module
--------------------
``tracer.py`` already has its own ``build_flowchart`` that returns the older
*tree* summary (``statement`` / ``branch`` / ``loop`` nodes keyed
``<module>``), which ``src/tracer/flow.js`` and the running UI still consume,
and which ``test_flowchart.py`` pins down. This module adds the *graph* the
new diagram view needs without disturbing any of that. The two are told apart
by ``format_version`` (1 = tree, 2 = graph).
"""

import ast

FLOWCHART_FORMAT_VERSION = 2
MAIN = "<main>"

_COMPARE = {
    ast.Lt: "<",
    ast.LtE: "\u2264",
    ast.Gt: ">",
    ast.GtE: "\u2265",
    ast.Eq: "=",
    ast.NotEq: "\u2260",
    ast.Is: "the same as",
    ast.IsNot: "not the same as",
    ast.In: "in",
    ast.NotIn: "not in",
}

_AUGMENT = {
    ast.Add: "Add {v} to {t}",
    ast.Sub: "Subtract {v} from {t}",
    ast.Mult: "Multiply {t} by {v}",
    ast.Div: "Divide {t} by {v}",
    ast.Mod: "Work out {t} modulo {v}",
    ast.Pow: "Raise {t} to the power of {v}",
    ast.FloorDiv: "Divide {t} by {v} (rounded down)",
    ast.BitOr: "Combine {t} and {v} with OR",
    ast.BitAnd: "Combine {t} and {v} with AND",
    ast.BitXor: "Combine {t} and {v} with XOR",
    ast.LShift: "Shift {t} left by {v}",
    ast.RShift: "Shift {t} right by {v}",
}


# --------------------------------------------------------------------------
# source helpers
# --------------------------------------------------------------------------
def _collapse(text):
    return " ".join((text or "").split())


def _expr(source, node):
    """One-line source text for an ast node."""
    if node is None:
        return ""
    try:
        segment = ast.get_source_segment(source, node)
    except Exception:  # pragma: no cover - position-less nodes only
        segment = None
    return _collapse(segment or "")


def _body_end(stmt):
    """Last line of a compound statement's header (the line before its body)."""
    body = getattr(stmt, "body", None)
    if isinstance(body, list) and body:
        first = getattr(body[0], "lineno", None)
        if first is not None:
            return max(stmt.lineno, first - 1)
    return max(stmt.lineno, getattr(stmt, "end_lineno", None) or stmt.lineno)


def _stmt_lines(stmt):
    """The ``lines`` range for a node: header only, never its body."""
    start = stmt.lineno
    decorators = getattr(stmt, "decorator_list", None)
    if decorators:
        start = min([start] + [d.lineno for d in decorators])
    end = _body_end(stmt)
    return [min(start, end), end]


def _header_code(source, stmt):
    """Collapsed source of just the header line(s), not the indented body."""
    lines = source.splitlines()
    first, last = _stmt_lines(stmt)
    start = first - 1
    if start < 0 or start >= len(lines):
        return ""
    return _collapse(" ".join(lines[start:max(last, first)]))


def _soften(text):
    """Turn comparison operators into the symbols a question should show."""
    return text.replace("<=", "\u2264").replace(">=", "\u2265").replace("!=", "\u2260")


def _question(source, test):
    """A short plain-English question for a condition."""
    if isinstance(test, ast.Compare) and len(test.ops) == 1:
        op = _COMPARE.get(type(test.ops[0]))
        if op:
            left = _soften(_expr(source, test.left))
            right = _soften(_expr(source, test.comparators[0]))
            return f"Is {left} {op} {right}?"
    if isinstance(test, ast.UnaryOp) and isinstance(test.op, ast.Not):
        return f"Is {_soften(_expr(source, test.operand))} not true?"
    if isinstance(test, ast.BoolOp):
        joiner = " and " if isinstance(test.op, ast.And) else " or "
        joined = joiner.join(_soften(_expr(source, v)) for v in test.values)
        return f"Is {joined} true?"
    if isinstance(test, ast.Name):
        return f"Is {test.id} true?"
    return f"Is {_soften(_expr(source, test))} true?"


def _for_question(source, iter_node):
    """The diamond question for a ``for`` loop."""
    if (
        isinstance(iter_node, ast.Call)
        and isinstance(iter_node.func, ast.Name)
        and iter_node.func.id == "range"
    ):
        return "Any more numbers to go?"
    if isinstance(iter_node, ast.Name):
        return f"Any items left in {iter_node.id}?"
    if isinstance(iter_node, ast.Constant) and isinstance(iter_node.value, str):
        return "Any characters left in the text?"
    return "Any items left?"


def _targets(source, stmt):
    if isinstance(stmt, ast.Assign):
        items = stmt.targets
    elif isinstance(stmt, (ast.AnnAssign, ast.AugAssign)):
        items = [stmt.target]
    else:
        items = []
    return ", ".join(_expr(source, item) for item in items)


def _params(args):
    params = [a.arg for a in args.args]
    params += [a.arg for a in args.kwonlyargs]
    if args.vararg:
        params.append("*" + args.vararg.arg)
    if args.kwarg:
        params.append("**" + args.kwarg.arg)
    return params


def _call_func_name(call):
    if isinstance(call.func, ast.Name):
        return call.func.id
    if isinstance(call.func, ast.Attribute):
        return call.func.attr
    return None


def _find_call_named(node, name):
    for sub in ast.walk(node):
        if isinstance(sub, ast.Call) and _call_func_name(sub) == name:
            return sub
    return None


def _io_kind(stmt):
    """``"print"``, ``"input"`` or None: is this statement an I/O action?"""
    if isinstance(stmt, ast.Expr) and isinstance(stmt.value, ast.Call):
        name = _call_func_name(stmt.value)
        if name in ("print", "input"):
            return name
    if isinstance(stmt, (ast.Assign, ast.AnnAssign, ast.AugAssign)):
        if stmt.value is not None and _find_call_named(stmt.value, "input"):
            return "input"
    return None


def _io_label(source, stmt, kind):
    if kind == "print":
        call = stmt.value
        if not call.args:
            return "Show nothing"
        if all(isinstance(a, (ast.Name, ast.Constant)) for a in call.args):
            return "Show " + ", ".join(_expr(source, a) for a in call.args)
        return "Show the result"
    call = _find_call_named(stmt, "input")
    prompt = None
    if call is not None and call.args:
        first = call.args[0]
        if isinstance(first, ast.Constant) and isinstance(first.value, str):
            prompt = str(first.value).replace('"', "'")
    base = f'Ask "{prompt}"' if prompt else "Ask for a value"
    if isinstance(stmt, (ast.Assign, ast.AnnAssign)):
        target = _targets(source, stmt)
        if target:
            return f"{base} and make {target}"
    return base


def _plain_label(source, stmt):
    """Plain-English label for a statement that is not I/O, a call or control flow."""
    if isinstance(stmt, ast.Assign):
        return f"Make {_targets(source, stmt)} = {_expr(source, stmt.value)}"
    if isinstance(stmt, ast.AnnAssign) and stmt.value is not None:
        return f"Make {_targets(source, stmt)} = {_expr(source, stmt.value)}"
    if isinstance(stmt, ast.AugAssign):
        target = _expr(source, stmt.target)
        value = _expr(source, stmt.value)
        template = _AUGMENT.get(type(stmt.op))
        return template.format(t=target, v=value) if template else f"Update {target}"
    if isinstance(stmt, ast.Pass):
        return "Do nothing"
    if isinstance(stmt, ast.Import):
        return "Import " + ", ".join(a.name for a in stmt.names)
    if isinstance(stmt, ast.ImportFrom):
        names = ", ".join(a.name for a in stmt.names)
        return f"Import {names} from {stmt.module or 'another file'}"
    if isinstance(stmt, ast.Assert):
        return f"Check that {_soften(_expr(source, stmt.test))}"
    if isinstance(stmt, ast.Delete):
        return "Forget " + ", ".join(_expr(source, t) for t in stmt.targets)
    if isinstance(stmt, ast.Expr):
        if isinstance(stmt.value, ast.Call):
            return "Call " + _expr(source, stmt.value)
        return _expr(source, stmt.value) or "Do nothing"
    return _expr(source, stmt)


def _handler_types(handler, source):
    if handler.type is None:
        return "any error"
    if isinstance(handler.type, ast.Tuple):
        return ", ".join(_expr(source, e) for e in handler.type.elts)
    return _expr(source, handler.type)


# --------------------------------------------------------------------------
# charts
# --------------------------------------------------------------------------
class _Chart:
    """The nodes and edges of one function."""

    def __init__(self, name, params=None):
        self.name = name
        self.params = list(params or [])
        self.nodes = []
        self.edges = []
        self.loop_stack = []
        self.entry = self.add("start", "Start", "", None)
        self.exit = self.add("end", "End", "", None)

    def add(self, kind, label, code, lines, **extra):
        node = {
            "id": f"n{len(self.nodes) + 1}",
            "kind": kind,
            "label": _collapse(label),
            "code": code,
            "lines": lines,
        }
        node.update(extra)
        self.nodes.append(node)
        return node["id"]

    def link(self, frm, to, label=None, back=False):
        self.edges.append({"from": frm, "to": to, "label": label, "back": bool(back)})

    def connect(self, ports, to, back=False):
        """Attach every pending port (node id, edge label) to ``to``."""
        for frm, label in ports:
            self.link(frm, to, label, back)

    def result(self):
        return {
            "name": self.name,
            "params": self.params,
            "entry": self.entry,
            "exit": self.exit,
            "nodes": self.nodes,
            "edges": self.edges,
        }


# --------------------------------------------------------------------------
# builder
# --------------------------------------------------------------------------
class _Builder:
    """Walks the ast once and fills one :class:`_Chart` per function."""

    def __init__(self, source, tree):
        self.source = source
        self.tree = tree
        self.charts = {}
        self.defined = set()
        self._suppress = False
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                self.defined.add(node.name)

    # --- chart plumbing ---------------------------------------------------
    def _register(self, name, params):
        key = name
        n = 2
        while key in self.charts:
            key = f"{name}#{n}"
            n += 1
        chart = _Chart(key, params)
        self.charts[key] = chart
        return chart

    def _lines(self, stmt):
        return None if self._suppress else _stmt_lines(stmt)

    def run(self):
        main = self._register(MAIN, [])
        exits, _ = self._block(self.tree.body, main, [(main.entry, None)])
        main.connect(exits, main.exit)

    # --- blocks -----------------------------------------------------------
    def _block(self, statements, chart, incoming):
        """Build a straight run of statements.

        Returns ``(forward, breaks)``: ports that fall out of the end of the
        block, and ports belonging to ``break`` statements that must escape
        the enclosing loop.
        """
        forward = list(incoming)
        breaks = []
        for stmt in statements:
            forward, extra = self._statement(stmt, chart, forward)
            breaks.extend(extra)
        return forward, breaks

    def _statement(self, stmt, chart, incoming):
        if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)):
            return self._define(stmt, chart, incoming)
        if isinstance(stmt, ast.ClassDef):
            return self._define_class(stmt, chart, incoming)
        if isinstance(stmt, ast.If):
            return self._if(stmt, chart, incoming)
        if isinstance(stmt, (ast.For, ast.AsyncFor, ast.While)):
            return self._loop(stmt, chart, incoming)
        if isinstance(stmt, ast.Try):
            return self._try(stmt, chart, incoming)
        if isinstance(stmt, (ast.With, ast.AsyncWith)):
            return self._with(stmt, chart, incoming)
        if isinstance(stmt, ast.Return):
            return self._return(stmt, chart, incoming)
        if isinstance(stmt, ast.Break):
            return self._break(stmt, chart, incoming)
        if isinstance(stmt, ast.Continue):
            return self._continue(stmt, chart, incoming)
        return self._simple(stmt, chart, incoming)

    # --- statements -------------------------------------------------------
    def _simple(self, stmt, chart, incoming):
        kind, label, extra = self._classify(stmt)
        node = chart.add(kind, label, _header_code(self.source, stmt) or _expr(self.source, stmt),
                         self._lines(stmt), **extra)
        chart.connect(incoming, node)
        return [(node, None)], []

    def _classify(self, stmt):
        io = _io_kind(stmt)
        if io:
            return "io", _io_label(self.source, stmt, io), {}

        known = self._known_call(stmt)
        if known:
            name, text = known
            return "call", self._call_label(stmt, text), {"calls": name}

        outer = _outermost_call(stmt)
        if outer is not None:
            return "call", self._call_label(stmt, _expr(self.source, outer)), {}

        return "process", _plain_label(self.source, stmt), {}

    def _call_label(self, stmt, text):
        if isinstance(stmt, ast.Assign):
            return f"Call {text} and make {_targets(self.source, stmt)}"
        if isinstance(stmt, ast.AnnAssign) and stmt.value is not None:
            return f"Call {text} and make {_targets(self.source, stmt)}"
        if isinstance(stmt, ast.Match):
            return f"Match on {_expr(self.source, stmt.subject)}"
        return f"Call {text}"

    def _known_call(self, stmt):
        """The first call to a function this program defines, if any."""
        for node in ast.walk(stmt):
            if not isinstance(node, ast.Call):
                continue
            name = _call_func_name(node)
            if name and name in self.defined:
                return name, _expr(self.source, node)
        return None

    def _define(self, stmt, chart, incoming):
        params = _params(stmt.args)
        sub = self._register(stmt.name, params)
        node = chart.add(
            "process",
            f"Define {stmt.name}({', '.join(params)})",
            _header_code(self.source, stmt),
            self._lines(stmt),
            defines=sub.name,
        )
        chart.connect(incoming, node)
        exits, _ = self._body(stmt, sub, [(sub.entry, None)])
        sub.connect(exits, sub.exit)
        return [(node, None)], []

    def _define_class(self, stmt, chart, incoming):
        sub = self._register(stmt.name, [])
        node = chart.add(
            "process",
            f"Define class {stmt.name}",
            _header_code(self.source, stmt),
            self._lines(stmt),
            defines=sub.name,
        )
        chart.connect(incoming, node)
        exits, _ = self._body(stmt, sub, [(sub.entry, None)])
        sub.connect(exits, sub.exit)
        return [(node, None)], []

    def _if(self, stmt, chart, incoming):
        forward, breaks = [], []
        pending = list(incoming)
        current = stmt
        while True:
            decision = chart.add(
                "decision",
                _question(self.source, current.test),
                _header_code(self.source, current),
                self._lines(current),
                test=_expr(self.source, current.test),
            )
            chart.connect(pending, decision)

            yes, yes_breaks = self._body(current, chart, [(decision, "Yes")])
            forward.extend(yes)
            breaks.extend(yes_breaks)

            orelse = current.orelse
            if len(orelse) == 1 and isinstance(orelse[0], ast.If):
                pending = [(decision, "No")]
                current = orelse[0]
                continue
            if orelse:
                no, no_breaks = self._body(current, chart, [(decision, "No")],
                                           block=orelse)
                forward.extend(no)
                breaks.extend(no_breaks)
            else:
                forward.append((decision, "No"))
            break
        return forward, breaks

    def _body(self, stmt, chart, incoming, block=None):
        """Build a compound statement's body, folding a one-liner body away."""
        statements = stmt.body if block is None else block
        one_liner = bool(statements) and statements[0].lineno == stmt.lineno
        saved = self._suppress
        self._suppress = saved or one_liner
        try:
            return self._block(statements, chart, incoming)
        finally:
            self._suppress = saved

    def _loop(self, stmt, chart, incoming):
        if isinstance(stmt, (ast.For, ast.AsyncFor)):
            loop, test = "for", _expr(self.source, stmt.iter)
            label = _for_question(self.source, stmt.iter)
        else:
            loop, test = "while", _expr(self.source, stmt.test)
            label = _question(self.source, stmt.test)
        header = chart.add("loop", label, _header_code(self.source, stmt),
                           self._lines(stmt), loop=loop, test=test)
        chart.connect(incoming, header)

        chart.loop_stack.append(header)
        try:
            body, body_breaks = self._body(stmt, chart, [(header, "Yes")])
        finally:
            chart.loop_stack.pop()

        for frm, lbl in body:
            chart.link(frm, header, lbl, back=True)

        if stmt.orelse:
            else_ports, else_breaks = self._body(stmt, chart, [(header, "No")],
                                                 block=stmt.orelse)
            return else_ports + body_breaks, else_breaks
        return [(header, "No")] + body_breaks, []

    def _try(self, stmt, chart, incoming):
        head = chart.add("process", "Try", _header_code(self.source, stmt),
                         self._lines(stmt))
        chart.connect(incoming, head)
        forward, breaks = self._block(stmt.body, chart, [(head, None)])
        for handler in stmt.handlers:
            types = _handler_types(handler, self.source)
            box = chart.add("process", f"If {types} happens",
                            _header_code(self.source, handler),
                            self._lines(handler))
            chart.link(head, box)
            ports, extra = self._block(handler.body, chart, [(box, None)])
            forward.extend(ports)
            breaks.extend(extra)
        if stmt.finalbody:
            forward, extra = self._block(stmt.finalbody, chart, forward)
            breaks.extend(extra)
        return forward, breaks

    def _with(self, stmt, chart, incoming):
        targets = [i.optional_vars for i in stmt.items if i.optional_vars is not None]
        if targets:
            label = "Use " + ", ".join(_expr(self.source, t) for t in targets)
        else:
            first = stmt.items[0].context_expr if stmt.items else None
            label = "Work with " + (_expr(self.source, first) or "it")
        node = chart.add("process", label, _header_code(self.source, stmt),
                         self._lines(stmt))
        chart.connect(incoming, node)
        return self._body(stmt, chart, [(node, None)])

    def _return(self, stmt, chart, incoming):
        value = _expr(self.source, stmt.value) if stmt.value is not None else ""
        label = f"Return {value}" if value else "Return nothing"
        node = chart.add("return", label, _expr(self.source, stmt) or "return",
                         self._lines(stmt))
        chart.connect(incoming, node)
        chart.link(node, chart.exit)
        return [], []

    def _break(self, stmt, chart, incoming):
        node = chart.add("process", "Leave the loop", "break", self._lines(stmt))
        chart.connect(incoming, node)
        return [], [(node, None)]

    def _continue(self, stmt, chart, incoming):
        node = chart.add("process", "Go to the next round", "continue",
                         self._lines(stmt))
        chart.connect(incoming, node)
        if chart.loop_stack:
            chart.link(node, chart.loop_stack[-1], back=True)
        return [], []


def _outermost_call(stmt):
    """The call a statement is mostly about, when it is not I/O."""
    if not isinstance(stmt, (ast.Expr, ast.Assign, ast.AnnAssign)):
        return None
    value = getattr(stmt, "value", None)
    return value if isinstance(value, ast.Call) else None


def build_flowchart(source):
    """Summarise a program as a flowchart graph (format version 2)."""
    try:
        tree = ast.parse(source)
    except (SyntaxError, ValueError) as exc:
        return {
            "format_version": FLOWCHART_FORMAT_VERSION,
            "functions": {},
            "error": {
                "type": type(exc).__name__,
                "message": getattr(exc, "msg", None) or str(exc),
                "line": getattr(exc, "lineno", None),
            },
        }
    builder = _Builder(source, tree)
    builder.run()
    return {
        "format_version": FLOWCHART_FORMAT_VERSION,
        "functions": {name: chart.result() for name, chart in builder.charts.items()},
        "error": None,
    }
