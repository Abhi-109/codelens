"""A deterministic, read-only program profile built from Python's AST.

This module never runs, imports, compiles or evaluates the user's source.  It
only parses it with the standard-library ``ast`` module and describes what the
syntax says: definitions, calls, loops, conditions, comparisons, statically
recognisable mutations, returns and container operations.

The shape is versioned by ``PROFILE_VERSION``.  The static profile is deliberately
separate from the execution trace; it cannot prove an algorithm or supply
runtime values.

    profile = analyze_source(source)
    text = analyze_json(source)       # deterministic JSON, for the worker
"""

import ast
import json

PROFILE_VERSION = 1
PROFILE_KIND = "program_profile"
LANGUAGE = "python"
MODULE_ID = "module"

MAX_LABEL = 80
MAX_LABEL_DEPTH = 7

COMPARE_SYMBOLS = {
    ast.Eq: "==",
    ast.NotEq: "!=",
    ast.Lt: "<",
    ast.LtE: "<=",
    ast.Gt: ">",
    ast.GtE: ">=",
    ast.Is: "is",
    ast.IsNot: "is not",
    ast.In: "in",
    ast.NotIn: "not in",
}

BIN_SYMBOLS = {
    ast.Add: "+",
    ast.Sub: "-",
    ast.Mult: "*",
    ast.Div: "/",
    ast.FloorDiv: "//",
    ast.Mod: "%",
    ast.Pow: "**",
    ast.BitOr: "|",
    ast.BitAnd: "&",
    ast.BitXor: "^",
    ast.LShift: "<<",
    ast.RShift: ">>",
}

UNARY_SYMBOLS = {
    ast.Not: "not",
    ast.UAdd: "+",
    ast.USub: "-",
    ast.Invert: "~",
}

LIST_METHODS = {"append", "extend", "insert", "remove", "sort", "reverse"}
DICT_METHODS = {"update", "setdefault", "popitem"}
AMBIGUOUS_METHODS = {"pop", "clear"}


def _pos(node):
    """Source position of an AST node, with a stable shape."""
    return {
        "line": getattr(node, "lineno", None),
        "column": getattr(node, "col_offset", None),
        "end_line": getattr(node, "end_lineno", None),
        "end_column": getattr(node, "end_col_offset", None),
    }


def _truncate(text):
    return text if len(text) <= MAX_LABEL else text[: MAX_LABEL - 1] + "\u2026"


def _label(node, depth=0):
    """A short, safe source-like label.  It is never evaluated."""
    if node is None:
        return ""
    if depth > MAX_LABEL_DEPTH:
        return "\u2026"
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return f"{_label(node.value, depth + 1)}.{node.attr}"
    if isinstance(node, ast.Constant):
        text = repr(node.value)
        return _truncate(text if len(text) <= 40 else text[:39] + "\u2026")
    if isinstance(node, ast.Call):
        args = [_label(arg, depth + 1) for arg in node.args]
        args.extend(
            f"{keyword.arg}={_label(keyword.value, depth + 1)}"
            if keyword.arg is not None
            else f"**{_label(keyword.value, depth + 1)}"
            for keyword in node.keywords
        )
        return _truncate(f"{_label(node.func, depth + 1)}({', '.join(args)})")
    if isinstance(node, ast.Subscript):
        return _truncate(f"{_label(node.value, depth + 1)}[{_slice_label(node.slice, depth + 1)}]")
    if isinstance(node, ast.Slice):
        return _slice_label(node, depth)
    if isinstance(node, ast.List):
        return _sequence_label("[", "]", node.elts, depth)
    if isinstance(node, ast.Tuple):
        return _sequence_label("(", ")", node.elts, depth)
    if isinstance(node, ast.Set):
        return _sequence_label("{", "}", node.elts, depth)
    if isinstance(node, ast.Dict):
        items = []
        for key, value in zip(node.keys[:3], node.values[:3]):
            if key is None:
                items.append(f"**{_label(value, depth + 1)}")
            else:
                items.append(f"{_label(key, depth + 1)}: {_label(value, depth + 1)}")
        if len(node.keys) > 3:
            items.append("\u2026")
        return _truncate("{" + ", ".join(items) + "}")
    if isinstance(node, ast.BinOp):
        return _truncate(
            f"{_label(node.left, depth + 1)} {BIN_SYMBOLS.get(type(node.op), '?')} "
            f"{_label(node.right, depth + 1)}"
        )
    if isinstance(node, ast.BoolOp):
        word = "and" if isinstance(node.op, ast.And) else "or"
        return _truncate(f" {word} ".join(_label(value, depth + 1) for value in node.values))
    if isinstance(node, ast.Compare):
        parts = [_label(node.left, depth + 1)]
        for op, comparator in zip(node.ops, node.comparators):
            parts.append(COMPARE_SYMBOLS.get(type(op), "?"))
            parts.append(_label(comparator, depth + 1))
        return _truncate(" ".join(parts))
    if isinstance(node, ast.UnaryOp):
        return _truncate(f"{UNARY_SYMBOLS.get(type(node.op), '?')} {_label(node.operand, depth + 1)}")
    if isinstance(node, ast.IfExp):
        return _truncate(
            f"{_label(node.body, depth + 1)} if {_label(node.test, depth + 1)} "
            f"else {_label(node.orelse, depth + 1)}"
        )
    if isinstance(node, (ast.ListComp, ast.SetComp, ast.GeneratorExp, ast.DictComp)):
        return _truncate(f"<{type(node).__name__}>")
    if isinstance(node, ast.Lambda):
        return "<lambda>"
    if isinstance(node, ast.Await):
        return _truncate(f"await {_label(node.value, depth + 1)}")
    if isinstance(node, ast.Starred):
        return _truncate(f"*{_label(node.value, depth + 1)}")
    if isinstance(node, ast.JoinedStr):
        return "<f-string>"
    return f"<{type(node).__name__}>"


def _slice_label(node, depth=0):
    if not isinstance(node, ast.Slice):
        return _label(node, depth + 1)
    start = _label(node.lower, depth + 1) if node.lower is not None else ""
    stop = _label(node.upper, depth + 1) if node.upper is not None else ""
    if node.step is None:
        return f"{start}:{stop}"
    return f"{start}:{stop}:{_label(node.step, depth + 1)}"


def _sequence_label(left, right, values, depth):
    items = [_label(value, depth + 1) for value in values[:3]]
    if len(values) > 3:
        items.append("\u2026")
    return _truncate(left + ", ".join(items) + right)


def _summary(node):
    if node is None:
        return None
    return {"kind": type(node).__name__, "label": _label(node)}


def _operators_in(node):
    """Comparison operators in a condition, including nested and/not groups."""
    if isinstance(node, ast.Compare):
        return [COMPARE_SYMBOLS.get(type(op), "?") for op in node.ops]
    if isinstance(node, ast.BoolOp):
        out = []
        for value in node.values:
            out.extend(_operators_in(value))
        return out
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.Not):
        return _operators_in(node.operand)
    return []


def _source_size(source):
    return {"lines": source.count("\n") + 1, "characters": len(source)}


def _diagnostic(code, message, severity="error", **position):
    return {"code": code, "message": message, "severity": severity, **position}


def _empty_profile(source, status, diagnostics):
    return {
        "profile_version": PROFILE_VERSION,
        "kind": PROFILE_KIND,
        "language": LANGUAGE,
        "status": status,
        "source": _source_size(source) if isinstance(source, str) else {"lines": 0, "characters": 0},
        "diagnostics": diagnostics,
        "functions": [],
        "calls": [],
        "call_graph": {},
        "recursion": {"direct": [], "mutual_candidates": []},
        "loops": [],
        "conditions": [],
        "decisions": [],
        "comparisons": [],
        "mutations": [],
        "returns": [],
        "container_operations": [],
        "summary": {
            "functions": 0,
            "calls": 0,
            "loops": 0,
            "max_loop_depth": 0,
            "conditions": 0,
            "decisions": 0,
            "comparisons": 0,
            "mutations": 0,
            "returns": 0,
            "container_operations": 0,
            "direct_recursive_functions": [],
            "mutual_recursion_candidates": [],
        },
    }


class _DefinitionCollector(ast.NodeVisitor):
    """Find every function definition, including nested functions and methods."""

    def __init__(self):
        self.functions = []
        self.by_id = {}
        self._scope_names = []
        self._scope_kinds = []
        self._function_stack = []
        self._class_names = []

    def visit_FunctionDef(self, node):
        self._add_function(node, is_async=False)

    def visit_AsyncFunctionDef(self, node):
        self._add_function(node, is_async=True)

    def visit_ClassDef(self, node):
        self._scope_names.append(node.name)
        self._scope_kinds.append("class")
        self._class_names.append(node.name)
        self.generic_visit(node)
        self._class_names.pop()
        self._scope_kinds.pop()
        self._scope_names.pop()

    def _add_function(self, node, is_async):
        scope = self._scope_names + [node.name]
        qualified = ".".join(scope)
        parent = self._function_stack[-1] if self._function_stack else None
        enclosing_kind = self._scope_kinds[-1] if self._scope_kinds else None
        if enclosing_kind == "class":
            kind = "method"
        elif parent is not None:
            kind = "nested_function"
        else:
            kind = "function"
        if is_async:
            kind = f"async_{kind}"
        class_name = ".".join(self._class_names) if self._class_names else None
        function_id = f"function:{qualified}@{node.lineno}:{node.col_offset}"
        info = {
            "id": function_id,
            "name": node.name,
            "qualified_name": qualified,
            "kind": kind,
            "async": is_async,
            "class": class_name,
            "parent_function_id": parent["id"] if parent else None,
            **_pos(node),
            "parameters": _parameters(node.args),
            "decorators": [
                {**_summary(decorator), **_pos(decorator)} for decorator in node.decorator_list
            ],
            "call_ids": [],
            "return_ids": [],
            "direct_self_recursion": False,
            "call_count": 0,
            "return_count": 0,
            "has_return_value": False,
            "_node_body": node.body,
        }
        self.functions.append(info)
        self.by_id[function_id] = info
        self._function_stack.append(info)
        self._scope_names.append(node.name)
        self._scope_kinds.append("function")
        self.generic_visit(node)
        self._scope_kinds.pop()
        self._scope_names.pop()
        self._function_stack.pop()


def _parameters(arguments):
    positional = list(arguments.posonlyargs) + list(arguments.args)
    defaults = [None] * (len(positional) - len(arguments.defaults)) + list(arguments.defaults)
    parameters = []
    for arg, default in zip(positional, defaults):
        parameters.append(
            {
                "name": arg.arg,
                "kind": "positional_only" if arg in arguments.posonlyargs else "positional",
                "has_default": default is not None,
                "default": _summary(default),
                "annotation": _summary(arg.annotation),
                **_pos(arg),
            }
        )
    if arguments.vararg is not None:
        parameters.append(
            {
                "name": arguments.vararg.arg,
                "kind": "vararg",
                "has_default": False,
                "default": None,
                "annotation": _summary(arguments.vararg.annotation),
                **_pos(arguments.vararg),
            }
        )
    for arg, default in zip(arguments.kwonlyargs, arguments.kw_defaults):
        parameters.append(
            {
                "name": arg.arg,
                "kind": "keyword_only",
                "has_default": default is not None,
                "default": _summary(default),
                "annotation": _summary(arg.annotation),
                **_pos(arg),
            }
        )
    if arguments.kwarg is not None:
        parameters.append(
            {
                "name": arguments.kwarg.arg,
                "kind": "kwarg",
                "has_default": False,
                "default": None,
                "annotation": _summary(arguments.kwarg.annotation),
                **_pos(arguments.kwarg),
            }
        )
    return parameters


class _EventCollector(ast.NodeVisitor):
    """Collect static events for one function body, or for module-level code."""

    def __init__(self, profile, function_info, functions_by_name):
        self.profile = profile
        self.function = function_info
        self.function_id = function_info["id"] if function_info else MODULE_ID
        self.functions_by_name = functions_by_name
        self.loop_stack = []
        self.var_kinds = {}

    # -- definitions are handled by _DefinitionCollector --------------------
    def visit_FunctionDef(self, node):
        self._visit_signature(node)

    def visit_AsyncFunctionDef(self, node):
        self._visit_signature(node)

    def visit_Lambda(self, node):
        self._visit_signature(node)

    def _visit_signature(self, node):
        # Defaults, decorators and annotations run in the enclosing scope.  The
        # callable's body runs later, so its events belong to its own collector.
        for decorator in getattr(node, "decorator_list", ()):
            self.visit(decorator)
        for default in getattr(node.args, "defaults", ()):
            self.visit(default)
        for default in getattr(node.args, "kw_defaults", ()):
            if default is not None:
                self.visit(default)
        for arg in _all_args(node.args):
            if arg.annotation is not None:
                self.visit(arg.annotation)
        returns = getattr(node, "returns", None)
        if returns is not None:
            self.visit(returns)

    # -- loops and decisions ------------------------------------------------
    def visit_For(self, node):
        self._visit_for(node, is_async=False)

    def visit_AsyncFor(self, node):
        self._visit_for(node, is_async=True)

    def _visit_for(self, node, is_async):
        kind = "async_for" if is_async else "for"
        depth = len(self.loop_stack) + 1
        loop_id = self._id("loop", node, kind)
        parent_id = self.loop_stack[-1] if self.loop_stack else None
        loop = {
            "id": loop_id,
            "kind": kind,
            "function_id": self.function_id,
            "depth": depth,
            "parent_id": parent_id,
            "condition_id": None,
            "condition": None,
            "target": _summary(node.target),
            "iterator": _summary(node.iter),
            **_pos(node),
        }
        self.profile["loops"].append(loop)
        self._record_decision(
            "for",
            node,
            condition=None,
            condition_id=None,
            iterator=_summary(node.iter),
            loop_id=loop_id,
            loop_depth=depth,
        )
        self.visit(node.target)
        self.visit(node.iter)
        self.loop_stack.append(loop_id)
        for statement in node.body:
            self.visit(statement)
        for statement in node.orelse:
            self.visit(statement)
        self.loop_stack.pop()

    def visit_While(self, node):
        depth = len(self.loop_stack) + 1
        loop_id = self._id("loop", node, "while")
        parent_id = self.loop_stack[-1] if self.loop_stack else None
        condition = _summary(node.test)
        condition_id = self._record_condition(node.test, "while", depth)
        loop = {
            "id": loop_id,
            "kind": "while",
            "function_id": self.function_id,
            "depth": depth,
            "parent_id": parent_id,
            "condition_id": condition_id,
            "condition": condition,
            "target": None,
            "iterator": None,
            **_pos(node),
        }
        self.profile["loops"].append(loop)
        self._record_decision(
            "while",
            node,
            condition=condition,
            condition_id=condition_id,
            iterator=None,
            loop_id=loop_id,
            loop_depth=depth,
        )
        self.loop_stack.append(loop_id)
        self.visit(node.test)
        for statement in node.body:
            self.visit(statement)
        for statement in node.orelse:
            self.visit(statement)
        self.loop_stack.pop()

    def visit_If(self, node):
        self._visit_if(node, is_elif=False)

    def _visit_if(self, node, is_elif):
        kind = "elif" if is_elif else "if"
        condition = _summary(node.test)
        condition_id = self._record_condition(node.test, kind, len(self.loop_stack))
        self._record_decision(
            kind,
            node,
            condition=condition,
            condition_id=condition_id,
            iterator=None,
            loop_id=None,
            loop_depth=len(self.loop_stack),
            is_elif=is_elif,
        )
        self.visit(node.test)
        for statement in node.body:
            self.visit(statement)
        if len(node.orelse) == 1 and isinstance(node.orelse[0], ast.If):
            self._visit_if(node.orelse[0], is_elif=True)
        else:
            for statement in node.orelse:
                self.visit(statement)

    def visit_IfExp(self, node):
        condition = _summary(node.test)
        condition_id = self._record_condition(node.test, "conditional", len(self.loop_stack))
        self._record_decision(
            "conditional_expression",
            node,
            condition=condition,
            condition_id=condition_id,
            iterator=None,
            loop_id=None,
            loop_depth=len(self.loop_stack),
        )
        self.visit(node.test)
        self.visit(node.body)
        self.visit(node.orelse)

    def visit_Assert(self, node):
        condition = _summary(node.test)
        condition_id = self._record_condition(node.test, "assert", len(self.loop_stack))
        self._record_decision(
            "assert",
            node,
            condition=condition,
            condition_id=condition_id,
            iterator=None,
            loop_id=None,
            loop_depth=len(self.loop_stack),
        )
        self.visit(node.test)
        if node.msg is not None:
            self.visit(node.msg)

    def visit_comprehension(self, node):
        self.visit(node.target)
        self.visit(node.iter)
        for condition in node.ifs:
            self._record_condition(condition, "comprehension", len(self.loop_stack))
            self.visit(condition)

    def visit_Match(self, node):
        self._record_decision(
            "match",
            node,
            condition=None,
            condition_id=None,
            iterator=None,
            loop_id=None,
            loop_depth=len(self.loop_stack),
            subject=_summary(node.subject),
        )
        self.visit(node.subject)
        for case in node.cases:
            condition_id = None
            if case.guard is not None:
                condition_id = self._record_condition(case.guard, "match_guard", len(self.loop_stack))
            self.visit(case.pattern)
            if case.guard is not None:
                self.visit(case.guard)
            for statement in case.body:
                self.visit(statement)

    def _record_condition(self, node, kind, loop_depth):
        condition_id = self._id("condition", node, kind)
        self.profile["conditions"].append(
            {
                "id": condition_id,
                "kind": kind,
                "function_id": self.function_id,
                "loop_depth": loop_depth,
                "expression": _summary(node),
                "operators": _operators_in(node),
                **_pos(node),
            }
        )
        return condition_id

    def _record_decision(
        self,
        kind,
        node,
        condition,
        condition_id,
        iterator,
        loop_id,
        loop_depth,
        **extra,
    ):
        decision = {
            "id": self._id("decision", node, kind),
            "kind": kind,
            "function_id": self.function_id,
            "loop_depth": loop_depth,
            "condition_id": condition_id,
            "condition": condition,
            "iterator": iterator,
            "loop_id": loop_id,
            **_pos(node),
            **extra,
        }
        self.profile["decisions"].append(decision)

    # -- comparisons, calls and returns ------------------------------------
    def visit_Compare(self, node):
        self.profile["comparisons"].append(
            {
                "id": self._id("comparison", node, ""),
                "function_id": self.function_id,
                "loop_depth": len(self.loop_stack),
                "left": _summary(node.left),
                "operators": [COMPARE_SYMBOLS.get(type(op), "?") for op in node.ops],
                "comparators": [_summary(value) for value in node.comparators],
                **_pos(node),
            }
        )
        self.generic_visit(node)

    def visit_Call(self, node):
        self._record_call(node)
        self.generic_visit(node)

    def _record_call(self, node):
        func = node.func
        receiver = None
        callee = None
        attribute = False
        if isinstance(func, ast.Name):
            callee = func.id
        elif isinstance(func, ast.Attribute):
            attribute = True
            callee = func.attr
            receiver = _label(func.value)
        target = receiver + "." + callee if receiver and callee else (callee or _label(func))
        caller = self.function_id
        self_recursion = False
        if self.function is not None and callee == self.function["name"]:
            if not attribute or receiver in ("self", self.function.get("class")):
                self_recursion = True

        candidates = []
        if callee:
            if attribute and receiver == "self" and self.function is not None:
                candidates = [
                    info["id"]
                    for info in self.functions_by_name.get(callee, ())
                    if info.get("class") == self.function.get("class")
                ]
            elif attribute and receiver:
                candidates = [
                    info["id"]
                    for info in self.functions_by_name.get(callee, ())
                    if info.get("class") == receiver
                ]
            else:
                candidates = [info["id"] for info in self.functions_by_name.get(callee, ())]
        candidates = sorted(set(candidates))
        if self_recursion and self.function is not None:
            candidates = sorted(set(candidates + [self.function["id"]]))
        if self_recursion:
            resolution = "self"
        elif candidates:
            resolution = "method_candidate" if attribute else "name_candidate"
        else:
            resolution = "unresolved"

        call = {
            "id": self._id("call", node, ""),
            "caller": caller,
            "name": callee,
            "target": target,
            "attribute": attribute,
            "receiver": receiver,
            "resolution": resolution,
            "candidate_function_ids": candidates,
            "resolved_function_id": candidates[0] if len(candidates) == 1 else None,
            "self_recursion": self_recursion,
            "arg_count": len(node.args),
            "keyword_count": len(node.keywords),
            "has_star_args": any(isinstance(arg, ast.Starred) for arg in node.args),
            "has_star_kwargs": any(keyword.arg is None for keyword in node.keywords),
            **_pos(node),
        }
        self.profile["calls"].append(call)
        if self.function is not None:
            self.function["call_ids"].append(call["id"])
            self.function["call_count"] += 1
            if self_recursion:
                self.function["direct_self_recursion"] = True
        for candidate in candidates:
            self.profile["_edges"].setdefault(caller, set()).add(candidate)
        if attribute and callee in LIST_METHODS | DICT_METHODS | AMBIGUOUS_METHODS:
            self._record_method_mutation(node, callee)

    def visit_Return(self, node):
        result = {
            "id": self._id("return", node, ""),
            "function_id": self.function_id,
            "loop_depth": len(self.loop_stack),
            "has_value": node.value is not None,
            "value": _summary(node.value),
            **_pos(node),
        }
        self.profile["returns"].append(result)
        if self.function is not None:
            self.function["return_ids"].append(result["id"])
            self.function["return_count"] += 1
            if node.value is not None:
                self.function["has_return_value"] = True
        if node.value is not None:
            self.visit(node.value)

    # -- static mutations ---------------------------------------------------
    def visit_Assign(self, node):
        for target in node.targets:
            self._record_target_mutation(target, "assign")
            self._record_target_kind(target, node.value)
        self.visit(node.value)
        for target in node.targets:
            self._visit_target_expressions(target)

    def visit_AnnAssign(self, node):
        if node.value is not None:
            self._record_target_mutation(node.target, "assign")
            self._record_target_kind(node.target, node.value)
            self.visit(node.value)
        self.visit(node.annotation)
        self._visit_target_expressions(node.target)

    def visit_AugAssign(self, node):
        if isinstance(node.target, ast.Name):
            kind = self.var_kinds.get(node.target.id)
            if kind == "list" and isinstance(node.op, (ast.Add, ast.Mult)):
                operation = (
                    "augmented_add" if isinstance(node.op, ast.Add) else "augmented_multiply"
                )
                self._add_mutation(
                    kind="list_method",
                    operation=operation,
                    target=_summary(node.target),
                    container=_summary(node.target),
                    container_kind="list",
                    certainty="inferred",
                    node=node.target,
                )
            elif kind == "dict" and isinstance(node.op, ast.BitOr):
                self._add_mutation(
                    kind="dict_method",
                    operation="augmented_merge",
                    target=_summary(node.target),
                    container=_summary(node.target),
                    container_kind="dict",
                    certainty="inferred",
                    node=node.target,
                )
        self._record_target_mutation(node.target, "augmented")
        self.visit(node.target)
        self.visit(node.value)

    def visit_Delete(self, node):
        for target in node.targets:
            self._record_target_mutation(target, "delete")
            self._visit_target_expressions(target)

    def _record_target_mutation(self, target, operation):
        if isinstance(target, (ast.Tuple, ast.List)):
            for item in target.elts:
                self._record_target_mutation(item, operation)
            return
        if isinstance(target, ast.Starred):
            self._record_target_mutation(target.value, operation)
            return
        if isinstance(target, ast.Subscript):
            container = _summary(target.value)
            kind = "slice" if isinstance(target.slice, ast.Slice) else "index"
            self._add_mutation(
                kind=kind,
                operation=operation,
                target=_summary(target),
                container=container,
                container_kind=self._kind_of(target.value),
                certainty="syntax",
                node=target,
            )
        elif isinstance(target, ast.Attribute):
            self._add_mutation(
                kind="attribute",
                operation=operation,
                target=_summary(target),
                container=_summary(target.value),
                container_kind="attribute",
                certainty="syntax",
                node=target,
            )

    def _record_target_kind(self, target, value):
        kind = self._kind_of(value)
        if isinstance(target, ast.Name):
            if kind:
                self.var_kinds[target.id] = kind
            else:
                self.var_kinds.pop(target.id, None)
        elif isinstance(target, ast.Attribute):
            label = _label(target)
            if kind:
                self.var_kinds[label] = kind
            else:
                self.var_kinds.pop(label, None)

    def _record_method_mutation(self, node, method):
        receiver = node.func.value
        kind = self._kind_of(receiver)
        if method in LIST_METHODS:
            container_kind = "list" if kind in (None, "unknown") else kind
            group = "list_method"
        elif method in DICT_METHODS:
            container_kind = "dict" if kind in (None, "unknown") else kind
            group = "dict_method"
        else:
            container_kind = kind or "unknown"
            group = "ambiguous_method"
        self._add_mutation(
            kind=group,
            operation=method,
            target=_summary(receiver),
            container=_summary(receiver),
            container_kind=container_kind,
            certainty="method_name",
            node=node,
        )

    def _add_mutation(self, kind, operation, target, container, container_kind, certainty, node):
        mutation_id = self._id("mutation", node, f"{kind}:{operation}")
        mutation = {
            "id": mutation_id,
            "kind": kind,
            "operation": operation,
            "function_id": self.function_id,
            "loop_depth": len(self.loop_stack),
            "target": target,
            "container": container,
            "container_kind": container_kind,
            "certainty": certainty,
            **_pos(node),
        }
        self.profile["mutations"].append(mutation)
        self.profile["container_operations"].append(
            {
                "id": self._id("operation", node, f"{kind}:{operation}"),
                "function_id": self.function_id,
                "operation": operation,
                "kind": "mutation",
                "container_kind": container_kind,
                "loop_depth": len(self.loop_stack),
                "mutation_id": mutation_id,
                "target": target,
                **_pos(node),
            }
        )

    def _visit_target_expressions(self, target):
        if isinstance(target, (ast.Tuple, ast.List)):
            for item in target.elts:
                self._visit_target_expressions(item)
        elif isinstance(target, ast.Starred):
            self._visit_target_expressions(target.value)
        elif isinstance(target, ast.Subscript):
            self.visit(target.value)
            self.visit(target.slice)
        elif isinstance(target, ast.Attribute):
            self.visit(target.value)
        else:
            self.visit(target)

    def _kind_of(self, node):
        if isinstance(node, (ast.List, ast.ListComp)):
            return "list"
        if isinstance(node, (ast.Dict, ast.DictComp)):
            return "dict"
        if isinstance(node, (ast.Set, ast.SetComp)):
            return "set"
        if isinstance(node, ast.Tuple):
            return "tuple"
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            return "str"
        if isinstance(node, ast.Name):
            return self.var_kinds.get(node.id, "unknown")
        if isinstance(node, ast.Attribute):
            return self.var_kinds.get(_label(node), "unknown")
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            if node.func.id in ("list", "dict", "set", "tuple"):
                return node.func.id
        return "unknown"

    # -- container operations ----------------------------------------------
    def visit_List(self, node):
        self._record_container("list_literal", node, "list")
        self.generic_visit(node)

    def visit_Dict(self, node):
        self._record_container("dict_literal", node, "dict")
        self.generic_visit(node)

    def visit_Set(self, node):
        self._record_container("set_literal", node, "set")
        self.generic_visit(node)

    def visit_Tuple(self, node):
        self._record_container("tuple_literal", node, "tuple")
        self.generic_visit(node)

    def visit_ListComp(self, node):
        self._record_container("list_comprehension", node, "list")
        self.generic_visit(node)

    def visit_DictComp(self, node):
        self._record_container("dict_comprehension", node, "dict")
        self.generic_visit(node)

    def visit_SetComp(self, node):
        self._record_container("set_comprehension", node, "set")
        self.generic_visit(node)

    def visit_GeneratorExp(self, node):
        self._record_container("generator_expression", node, "generator")
        self.generic_visit(node)

    def visit_Subscript(self, node):
        kind = "slice" if isinstance(node.slice, ast.Slice) else "index"
        self._record_container(f"{kind}_read", node, kind)
        self.generic_visit(node)

    def _record_container(self, operation, node, kind):
        self.profile["container_operations"].append(
            {
                "id": self._id("operation", node, operation),
                "function_id": self.function_id,
                "operation": operation,
                "kind": "container",
                "container_kind": kind,
                "loop_depth": len(self.loop_stack),
                "target": _summary(node),
                **_pos(node),
            }
        )

    # -- helpers ------------------------------------------------------------
    def _id(self, prefix, node, suffix):
        # Start position alone is not unique: ``f()()`` and ``a[0][1]`` put two
        # nodes at the same column.  The end position distinguishes them.
        line = getattr(node, "lineno", 0)
        column = getattr(node, "col_offset", 0)
        end_line = getattr(node, "end_lineno", line)
        end_column = getattr(node, "end_col_offset", column)
        tail = f":{suffix}" if suffix else ""
        return f"{prefix}:{line}:{column}:{end_line}:{end_column}{tail}"


def _all_args(arguments):
    values = list(arguments.posonlyargs) + list(arguments.args)
    if arguments.vararg is not None:
        values.append(arguments.vararg)
    values.extend(arguments.kwonlyargs)
    if arguments.kwarg is not None:
        values.append(arguments.kwarg)
    return values


def _sort_events(items):
    return sorted(
        items,
        key=lambda item: (
            item.get("line") or 0,
            item.get("column") or 0,
            item.get("id") or "",
        ),
    )


def _strongly_connected(nodes, edges):
    """Kosaraju's algorithm, iterative so deeply nested code cannot overflow."""
    order = []
    seen = set()
    for start in sorted(nodes):
        if start in seen:
            continue
        seen.add(start)
        stack = [(start, 0)]
        while stack:
            current, position = stack[-1]
            next_nodes = edges.get(current, ())
            if position < len(next_nodes):
                stack[-1] = (current, position + 1)
                nxt = next_nodes[position]
                if nxt not in seen:
                    seen.add(nxt)
                    stack.append((nxt, 0))
            else:
                order.append(current)
                stack.pop()

    reverse = {node: [] for node in nodes}
    for source, targets in edges.items():
        for target in targets:
            if target in reverse:
                reverse[target].append(source)

    components = []
    seen = set()
    for start in reversed(order):
        if start in seen:
            continue
        seen.add(start)
        component = []
        stack = [start]
        while stack:
            node = stack.pop()
            component.append(node)
            for predecessor in sorted(reverse.get(node, ())):
                if predecessor not in seen:
                    seen.add(predecessor)
                    stack.append(predecessor)
        if len(component) > 1:
            components.append(sorted(component))
    return sorted(components)


def _build_profile(source, tree):
    definitions = _DefinitionCollector()
    definitions.visit(tree)
    functions = definitions.functions
    by_name = {}
    for info in functions:
        by_name.setdefault(info["name"], []).append(info)

    profile = {
        "profile_version": PROFILE_VERSION,
        "kind": PROFILE_KIND,
        "language": LANGUAGE,
        "status": "ok",
        "source": _source_size(source),
        "diagnostics": [],
        "functions": functions,
        "calls": [],
        "call_graph": {},
        "recursion": {"direct": [], "mutual_candidates": []},
        "loops": [],
        "conditions": [],
        "decisions": [],
        "comparisons": [],
        "mutations": [],
        "returns": [],
        "container_operations": [],
        "summary": {},
        "_edges": {},
    }

    module_events = _EventCollector(profile, None, by_name)
    for statement in tree.body:
        module_events.visit(statement)
    for info in functions:
        collector = _EventCollector(profile, info, by_name)
        for statement in info["_node_body"]:
            collector.visit(statement)

    # The definition collector keeps the body on the info while collecting; it
    # is removed below so the profile stays JSON-compatible and source-free.
    for info in functions:
        info.pop("_node_body", None)

    for key in (
        "calls",
        "loops",
        "conditions",
        "decisions",
        "comparisons",
        "mutations",
        "returns",
        "container_operations",
    ):
        profile[key] = _sort_events(profile[key])

    graph = {}
    for caller, targets in profile.pop("_edges").items():
        graph[caller] = sorted(targets)
    for info in functions:
        graph.setdefault(info["id"], [])
    if MODULE_ID in graph:
        graph[MODULE_ID] = sorted(graph[MODULE_ID])

    profile["call_graph"] = {key: graph[key] for key in sorted(graph)}
    function_edges = {
        node: [target for target in targets if target in definitions.by_id]
        for node, targets in graph.items()
        if node in definitions.by_id
    }
    direct = sorted(
        info["id"] for info in functions if info.get("direct_self_recursion")
    )
    mutual = _strongly_connected(set(function_edges), function_edges)
    profile["recursion"] = {"direct": direct, "mutual_candidates": mutual}
    profile["functions"] = sorted(
        functions, key=lambda info: (info["line"] or 0, info["column"] or 0, info["id"])
    )
    profile["summary"] = {
        "functions": len(functions),
        "calls": len(profile["calls"]),
        "loops": len(profile["loops"]),
        "max_loop_depth": max((loop["depth"] for loop in profile["loops"]), default=0),
        "conditions": len(profile["conditions"]),
        "decisions": len(profile["decisions"]),
        "comparisons": len(profile["comparisons"]),
        "mutations": len(profile["mutations"]),
        "returns": len(profile["returns"]),
        "container_operations": len(profile["container_operations"]),
        "direct_recursive_functions": direct,
        "mutual_recursion_candidates": mutual,
    }
    return profile


def analyze_source(source):
    """Parse and describe ``source`` without running it.

    Syntax and unexpected analysis failures are returned as structured
    diagnostics; this function does not raise for bad user input.
    """
    if not isinstance(source, str):
        return _empty_profile(
            "",
            "analysis_error",
            [_diagnostic("invalid_source", "source must be a string")],
        )
    try:
        tree = ast.parse(source, filename="<user>", mode="exec")
    except SyntaxError as error:
        offset = max((error.offset or 1) - 1, 0)
        end_offset = max((error.end_offset or error.offset or 1) - 1, 0)
        return _empty_profile(
            source,
            "syntax_error",
            [
                _diagnostic(
                    "syntax_error",
                    error.msg or "invalid Python syntax",
                    line=error.lineno,
                    column=offset,
                    end_line=error.end_lineno,
                    end_column=end_offset,
                )
            ],
        )
    except Exception as error:  # pragma: no cover - defensive, never execute source
        return _empty_profile(
            source,
            "analysis_error",
            [_diagnostic("parse_error", f"{type(error).__name__}: {error}")],
        )

    try:
        return _build_profile(source, tree)
    except Exception as error:  # pragma: no cover - defensive
        return _empty_profile(
            source,
            "analysis_error",
            [_diagnostic("analysis_error", f"{type(error).__name__}: {error}")],
        )


def analyze_json(source):
    """Deterministic JSON for the worker; keys are stable and source text is not included."""
    return json.dumps(
        analyze_source(source),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
