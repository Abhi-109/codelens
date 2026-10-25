"""
CodeLens tracer (trace format version 3)

Runs a string of Python source code and records everything that happens as a
JSON-friendly dictionary:

    result = run_trace(source, max_steps=1500, max_seconds=5.0, inputs=None)

Top-level result
    format_version  int        Always 3 for this version of the format
    status          str        completed | error | step_limit | timeout |
                               output_limit | internal_error
    steps           int        Number of "line" events recorded
    trace           list       Ordered list of events (see below)
    output          str        Everything the program printed
    error           dict|None  {type, message, line, phase}, when status is error

Events (every event has "step", its index in the trace, and "event")
    call        a function (or the module) starts running
    line        a line is ABOUT TO run (variables show the state BEFORE it runs)
    return      a function returned normally
    exception   an exception was raised in a frame
    unwind      a frame exited because an exception propagated out of it
    output      text was printed          (text, frame_id, line)
    input       the program read a value  (prompt, text, frame_id, line)
    compare     one supported comparison ran (operator, operands, result, line).
                It carries its own cursor position so the operands and the
                outcome can be shown before the mutation that follows it. No
                frames or state heap: a comparison changes no state, so the
                current snapshot is still the previous line event's.
    step_limit / timeout / output_limit   a safety limit stopped the run
    error       the run ended with an error

call / line / return / exception / unwind events also carry
    function, frame_id, line, return_value, exception, exit_kind,
    frames   the whole call stack, oldest frame first. Each frame:
             {frame_id, function, call_line, line, variables}
    heap     every container or object reachable from those variables

Values
    Simple values are inline:  {"type": "int", "value": 5}
    Containers and objects live in "heap", keyed by a stable id ("o1", "o2", ...).
    Variables and items point at them with {"type": "ref", "id": "o1"}.
    Two names that point at the same list share one id, which is what lets a
    visualizer draw two arrows into one box.

Notes and known limits
    * The module's own code runs in a frame named "<module>".
    * A bare `except:` or `except BaseException:` in user code can swallow the
      step-limit stop. Run this inside a Web Worker and terminate it on a
      timeout as a second line of defence.
    * Sets are listed in sorted order so traces are deterministic.
    * Comparisons are captured by rewriting the user's syntax tree before it is
      compiled (see comparisons.py): operands keep their order and are evaluated
      once, the comparison runs once, and its own result object is returned. The
      rewrite adds no line events, and it is the only instrumentation the tracer
      performs on user code.
"""

import ast
import builtins
import dis
import io
import json
import re
import sys
import time
import types
from contextlib import redirect_stdout

import comparisons

FORMAT_VERSION = 3
FLOWCHART_VERSION = 1
USER_FILE = "<user>"

MAX_ITEMS = 30            # items shown per container
MAX_STR = 120             # characters shown per string or repr
MAX_HEAP_OBJECTS = 150    # objects described per snapshot
MAX_OUTPUT_CHARS = 10_000
JS_SAFE_INT = 2 ** 53 - 1


class _StopTrace(BaseException):
    """Raised to stop the program. BaseException so `except Exception` can't catch it."""

    def __init__(self, reason, message="", limit=None):
        super().__init__(message)
        self.reason = reason
        self.message = message
        self.limit = limit


def _short_repr(obj):
    try:
        text = repr(obj)
    except Exception:
        text = f"<{type(obj).__name__} object>"
    return text if len(text) <= MAX_STR else text[: MAX_STR - 1] + "…"


def _safe_str(obj):
    try:
        return str(obj)
    except Exception:
        return f"<{type(obj).__name__}>"


class _Values:
    """Turns Python objects into JSON-friendly values with stable object ids."""

    def __init__(self):
        self._ids = {}
        self._keep = []  # keeps objects alive so Python can't reuse their id()

    def _object_id(self, obj):
        key = id(obj)
        if key not in self._ids:
            self._ids[key] = f"o{len(self._ids) + 1}"
            self._keep.append(obj)
        return self._ids[key]

    def existing_id(self, obj):
        """The id this object already has, or None if no snapshot has shown it.

        Used for a comparison's operand cell: a container the trace has never
        serialized is not a cell the canvas can draw, and allocating an id for a
        short-lived temporary (a literal inside a hot loop) would only grow the
        id table.
        """
        return self._ids.get(id(obj))

    def value(self, obj, heap):
        kind = type(obj)

        if obj is None:
            return {"type": "none"}
        if kind is bool:
            return {"type": "bool", "value": obj}
        if kind is int:
            if abs(obj) > JS_SAFE_INT:
                return {"type": "int", "value": str(obj), "big": True}
            return {"type": "int", "value": obj}
        if kind is float:
            if obj != obj or obj in (float("inf"), float("-inf")):
                return {"type": "float", "repr": repr(obj)}
            return {"type": "float", "value": obj}
        if kind is str:
            if len(obj) > MAX_STR:
                return {"type": "str", "value": obj[:MAX_STR], "truncated": True}
            return {"type": "str", "value": obj}
        if isinstance(obj, (types.FunctionType, types.BuiltinFunctionType, types.MethodType)):
            name = getattr(obj, "__qualname__", None) or getattr(obj, "__name__", "function")
            return {"type": "function", "name": name}
        if isinstance(obj, type):
            return {"type": "class", "name": obj.__name__}
        if isinstance(obj, types.ModuleType):
            return {"type": "module", "name": obj.__name__}
        if isinstance(obj, (list, tuple, set, frozenset, dict)) or self._has_dict(obj):
            return self._reference(obj, heap)
        return {"type": "other", "class": kind.__name__, "repr": _short_repr(obj)}

    @staticmethod
    def _has_dict(obj):
        try:
            return isinstance(getattr(obj, "__dict__", None), dict)
        except Exception:
            return False

    def _reference(self, obj, heap):
        object_id = self._object_id(obj)
        if object_id in heap:
            return {"type": "ref", "id": object_id}
        if len(heap) >= MAX_HEAP_OBJECTS:
            return {"type": "other", "class": type(obj).__name__, "repr": "…"}
        heap[object_id] = None  # reserve the slot first so cycles can't loop forever
        heap[object_id] = self._describe(obj, heap)
        return {"type": "ref", "id": object_id}

    def _describe(self, obj, heap):
        if isinstance(obj, dict):
            pairs = list(obj.items())
            entry = {
                "type": "dict",
                "entries": [
                    {"key": self.value(k, heap), "value": self.value(v, heap)}
                    for k, v in pairs[:MAX_ITEMS]
                ],
            }
            if len(pairs) > MAX_ITEMS:
                entry["more"] = len(pairs) - MAX_ITEMS
            if type(obj) is not dict:
                entry["class"] = type(obj).__name__
            return entry

        if isinstance(obj, (list, tuple, set, frozenset)):
            if isinstance(obj, (set, frozenset)):
                try:
                    items = sorted(obj)
                except Exception:
                    items = sorted(obj, key=_short_repr)
                kind = "set"
            else:
                items = list(obj)
                kind = "list" if isinstance(obj, list) else "tuple"
            entry = {"type": kind, "items": [self.value(x, heap) for x in items[:MAX_ITEMS]]}
            if len(items) > MAX_ITEMS:
                entry["more"] = len(items) - MAX_ITEMS
            if type(obj).__name__ != kind:
                entry["class"] = type(obj).__name__
            return entry

        attrs = [(k, v) for k, v in list(obj.__dict__.items()) if isinstance(k, str)]
        return {
            "type": "object",
            "class": type(obj).__name__,
            "attrs": [{"name": k, "value": self.value(v, heap)} for k, v in attrs[:MAX_ITEMS]],
        }


class _Output(io.StringIO):
    """Captures printed text and records each write as an output event."""

    def __init__(self, tracer):
        super().__init__()
        self._tracer = tracer
        self._chars = 0

    def write(self, text):
        if not isinstance(text, str):
            text = str(text)
        room = MAX_OUTPUT_CHARS - self._chars
        stop = len(text) > room
        text = text[: max(room, 0)]
        if text:
            self._chars += len(text)
            super().write(text)
            self._tracer.add_output_event(text)
        if stop:
            raise _StopTrace(
                "output_limit",
                f"The program printed more than {MAX_OUTPUT_CHARS} characters.",
                MAX_OUTPUT_CHARS,
            )
        return len(text)


def _finally_source_lines(source):
    """Line numbers inside a finally suite, where an exception may still unwind."""
    try:
        tree = ast.parse(source)
    except (SyntaxError, ValueError):
        return set()
    try_nodes = (ast.Try,) + ((ast.TryStar,) if hasattr(ast, "TryStar") else ())
    lines = set()
    for node in ast.walk(tree):
        if isinstance(node, try_nodes):
            for statement in node.finalbody:
                start = getattr(statement, "lineno", None)
                end = getattr(statement, "end_lineno", start)
                if start is not None and end is not None:
                    lines.update(range(start, end + 1))
    return lines


class _Tracer:
    """The function Python calls on every call / line / return / exception event."""

    def __init__(self, max_steps, max_seconds, inputs, source=""):
        self.max_steps = max_steps
        self.deadline = time.perf_counter() + max_seconds
        self.max_seconds = max_seconds
        self.inputs = list(inputs or [])
        self.source_lines = source.splitlines()
        self.finally_lines = _finally_source_lines(source)
        self.trace = []
        self.stack = []
        self.pending = {}  # frame key -> the exception currently escaping that frame
        self.last_exception = {}  # frame key -> its most recent exception, for a bare raise
        self.line_steps = 0
        self.frame_counter = 0
        self.values = _Values()
        self.stopping = False  # a _StopTrace is unwinding; its frames are tracer noise

    # --- Python calls this on every event ---------------------------------
    def __call__(self, frame, event, arg):
        if self.stopping or frame.f_code.co_filename != USER_FILE:
            return None  # ignore our own code, the standard library, and a limit unwind
        try:
            self._handle(frame, event, arg)
        except (_StopTrace, RecursionError):
            raise
        except Exception as exc:  # a bug in the tracer must not look like a user error
            raise _StopTrace("internal_error", f"{type(exc).__name__}: {exc}")
        return self

    def _handle(self, frame, event, arg):
        key = id(frame)

        if event == "call":
            self.frame_counter += 1
            back = frame.f_back
            call_line = None
            if back is not None and back.f_code.co_filename == USER_FILE:
                call_line = back.f_lineno
            self.stack.append({
                "frame": frame,
                "key": key,
                "frame_id": self.frame_counter,
                "function": frame.f_code.co_name,
                "call_line": call_line,
                "line": frame.f_lineno,
            })
            self._record("call", frame)
            return

        entry = self._entry(key)
        if entry is None:
            return

        if event == "line":
            if self.line_steps >= self.max_steps:
                raise _StopTrace(
                    "step_limit",
                    f"Stopped after {self.max_steps} steps. Is there an infinite loop?",
                    self.max_steps,
                )
            if time.perf_counter() > self.deadline:
                raise _StopTrace(
                    "timeout",
                    f"Stopped after {self.max_seconds} seconds.",
                    self.max_seconds,
                )
            self.line_steps += 1
            entry["line"] = frame.f_lineno
            # A bare raise keeps the exception travelling; a finally suite must
            # not hide it either. Any other resumed line means it was handled.
            if frame.f_lineno not in self.finally_lines:
                self.pending.pop(key, None)
            if self._is_bare_raise(frame.f_lineno):
                self.pending.setdefault(key, self.last_exception.get(key))
            self._record("line", frame)

        elif event == "exception":
            exc_type, exc_value, _ = arg
            if exc_type is _StopTrace:
                self.stopping = True  # do not show the tracer's own stop as a user error
                return
            exception = {"type": exc_type.__name__, "message": _safe_str(exc_value)}
            self.pending[key] = exception
            self.last_exception[key] = exception
            entry["line"] = frame.f_lineno
            self._record("exception", frame, exception=exception)

        elif event == "return":
            last_op = self._last_opcode(frame)
            # A normal return or a yield suspends normally. Everything else
            # while pending is the frame exiting because an exception escaped.
            if key in self.pending and not last_op.startswith("RETURN_") and last_op != "YIELD_VALUE":
                exception = self.pending.pop(key)
                self.last_exception.pop(key, None)
                self._record("unwind", frame, exception=exception, exit_kind="exception")
            else:
                if last_op.startswith("RETURN_"):
                    self.pending.pop(key, None)
                    self.last_exception.pop(key, None)
                self._record("return", frame, exit_kind="normal", has_value=True, value=arg)
            for index in range(len(self.stack) - 1, -1, -1):  # pop this exact frame
                if self.stack[index] is entry:
                    del self.stack[index]
                    break

    def _is_bare_raise(self, lineno):
        if not (1 <= lineno <= len(self.source_lines)):
            return False
        return re.fullmatch(r"raise\s*(?:#.*)?", self.source_lines[lineno - 1].strip()) is not None

    @staticmethod
    def _last_opcode(frame):
        code = frame.f_code.co_code
        return dis.opname[code[frame.f_lasti]] if 0 <= frame.f_lasti < len(code) else ""

    # --- helpers ----------------------------------------------------------
    def _entry(self, key):
        for entry in reversed(self.stack):
            if entry["key"] == key:
                return entry
        return None

    def _frames(self, heap):
        frames = []
        for entry in self.stack:
            try:
                items = list(entry["frame"].f_locals.items())
            except Exception:
                items = []
            variables = {
                name: self.values.value(val, heap)
                for name, val in items
                if not name.startswith("__")
            }
            frames.append({
                "frame_id": entry["frame_id"],
                "function": entry["function"],
                "call_line": entry["call_line"],
                "line": entry["line"],
                "variables": variables,
            })
        return frames

    def _record(self, event, frame, exception=None, exit_kind=None, has_value=False, value=None):
        entry = self._entry(id(frame))
        heap = {}
        frames = self._frames(heap)
        self.trace.append({
            "step": len(self.trace),
            "event": event,
            "function": entry["function"],
            "frame_id": entry["frame_id"],
            "line": frame.f_lineno,
            "return_value": self.values.value(value, heap) if has_value else None,
            "exception": exception,
            "exit_kind": exit_kind,
            "frames": frames,
            "heap": heap,
        })

    def _where(self):
        if self.stack:
            top = self.stack[-1]
            return top["frame_id"], top["line"]
        return None, None

    def add_output_event(self, text):
        frame_id, line = self._where()
        self.trace.append({
            "step": len(self.trace), "event": "output",
            "text": text, "frame_id": frame_id, "line": line,
        })

    def add_input_event(self, prompt, text):
        frame_id, line = self._where()
        self.trace.append({
            "step": len(self.trace), "event": "input",
            "prompt": prompt, "text": text, "frame_id": frame_id, "line": line,
        })

    def compare(self, operator_text, line, left, right):
        """Sink for an instrumented comparison; returns its real result.

        The event is appended *before* the comparison runs, so a comparison that
        raises still shows its operands and operator with `result: None` instead
        of a fabricated outcome. Describing the operands can never change what
        the program does: if the tracer cannot describe them, it records nothing
        and the comparison runs anyway.
        """
        event = None
        try:
            event = self._compare_event(operator_text, line, left, right)
        except Exception:  # introspection must not become a user-visible error
            event = None
        result = comparisons.compare_values(operator_text, left, right)
        if event is not None:
            event["result"] = comparisons.outcome(result)
        return result

    def _compare_event(self, operator_text, line, left, right):
        heap = {}
        operands = []
        for operand in (left, right):
            cell = None
            if isinstance(operand, comparisons.Operand) and operand.container is not None:
                object_id = self.values.existing_id(operand.container)
                if object_id is not None:
                    cell = {"object_id": object_id, "index": operand.index}
            operands.append({
                "value": self.values.value(comparisons.operand_value(operand), heap),
                "cell": cell,
            })
        entry = self.stack[-1] if self.stack else None
        # No frames and no state heap: a comparison changes no state, so the
        # renderer keeps showing the previous line event's snapshot and these
        # events stay small in a long trace.
        event = {
            "step": len(self.trace),
            "event": "compare",
            "function": entry["function"] if entry else None,
            "frame_id": entry["frame_id"] if entry else None,
            "line": line,
            "operator": operator_text,
            "operands": operands,
            "result": None,
            "heap": heap,
        }
        self.trace.append(event)
        return event


def _error_line(tb):
    """Line number, in the user's code, where the exception happened."""
    line = None
    while tb is not None:
        if tb.tb_frame.f_code.co_filename == USER_FILE:
            line = tb.tb_lineno
        tb = tb.tb_next
    return line


def run_trace(source, max_steps=1500, max_seconds=5.0, inputs=None):
    tracer = _Tracer(max_steps, max_seconds, inputs, source)
    output = _Output(tracer)
    status = "completed"
    error = None

    def result():
        return {
            "format_version": FORMAT_VERSION,
            "status": status,
            "steps": tracer.line_steps,
            "trace": tracer.trace,
            "output": output.getvalue(),
            "error": error,
        }

    def add_error_event():
        tracer.trace.append({"step": len(tracer.trace), "event": "error", **error})

    # Syntax errors are reported before anything runs. The tree is rewritten for
    # comparison capture first; every new node keeps the location of the node it
    # replaces, so line events and tracebacks still point at the same source.
    try:
        code = compile(comparisons.instrument(source), USER_FILE, "exec")
    except (SyntaxError, ValueError) as exc:
        status = "error"
        error = {
            "type": type(exc).__name__,
            "message": getattr(exc, "msg", None) or _safe_str(exc),
            "line": getattr(exc, "lineno", None),
            "phase": "compile",
        }
        add_error_event()
        return result()

    def fake_input(prompt=""):
        prompt = _safe_str(prompt)
        if prompt:
            output.write(prompt)
        if not tracer.inputs:
            raise EOFError("The program asked for input, but no input values were given.")
        text = str(tracer.inputs.pop(0))
        tracer.add_input_event(prompt, text)
        output.write(text + "\n")  # echo, like a real terminal
        return text

    previous_trace = sys.gettrace()
    original_input = builtins.input
    builtins.input = fake_input
    try:
        sys.settrace(tracer)
        with redirect_stdout(output):
            exec(code, {"__name__": "__main__", **comparisons.namespace(tracer.compare)})
    except _StopTrace as stop:
        status = stop.reason
        extra = {"limit": stop.limit} if stop.limit is not None else {}
        if stop.reason == "internal_error":
            error = {"type": "InternalError", "message": stop.message, "line": None, "phase": "tracer"}
            add_error_event()
        else:
            tracer.trace.append({
                "step": len(tracer.trace), "event": stop.reason,
                "message": stop.message, **extra,
            })
    except SystemExit:
        pass  # the program called exit(); that is a normal ending
    except Exception as exc:
        status = "error"
        error = {
            "type": type(exc).__name__,
            "message": _safe_str(exc),
            "line": _error_line(exc.__traceback__),
            "phase": "runtime",
        }
        add_error_event()
    finally:
        sys.settrace(previous_trace)
        builtins.input = original_input

    return result()


def build_flowchart(source):
    """Summarises a program's structure for the flowchart view.

    Returns a JSON-friendly tree built with Python's own ast module:

        {"format_version": 1,
         "functions": {"<module>": {"name": "<module>", "params": [],
                                    "nodes": [...]},
                       "fact": {"name": "fact", "params": ["n"], "nodes": [...]}}}

    One entry per function (the module included), so the UI can show the
    flowchart of whichever function is at the top of the call stack. Each
    "nodes" list holds, in source order:

        {"kind": "statement", "line", "end_line", "text"}
        {"kind": "branch", "line", "end_line",
         "arms": [{"test": "marks >= 90" | None, "body": [nodes]}, ...]}
        {"kind": "loop", "loop": "for" | "while", "line", "end_line",
         "header": "for n in range(1, 6)", "body": [nodes]}

    elif chains are flattened into one branch with several arms; the else
    branch is the last arm with test None. Function definitions appear as a
    statement at their definition site, and their bodies live under the
    function's own entry.
    """
    try:
        tree = ast.parse(source)
    except SyntaxError as exc:
        return {
            "format_version": FLOWCHART_VERSION,
            "functions": {},
            "error": {
                "type": type(exc).__name__,
                "message": getattr(exc, "msg", None) or _safe_str(exc),
                "line": getattr(exc, "lineno", None),
            },
        }

    functions = {}

    def add_function(name, args, body):
        params = [a.arg for a in args.args]
        params += [a.arg for a in args.kwonlyargs]
        if args.vararg:
            params.append("*" + args.vararg.arg)
        if args.kwarg:
            params.append("**" + args.kwarg.arg)
        nodes = []
        functions[name] = {"name": name, "params": params, "nodes": nodes}
        fill_nodes(body, nodes)

    def fill_nodes(statements, out):
        for stmt in statements:
            line = stmt.lineno
            end_line = getattr(stmt, "end_lineno", None) or line

            if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)):
                params = ", ".join(a.arg for a in stmt.args.args)
                out.append({
                    "kind": "statement", "line": line, "end_line": line,
                    "text": f"define {stmt.name}({params})",
                })
                add_function(stmt.name, stmt.args, stmt.body)
                continue

            if isinstance(stmt, ast.ClassDef):
                out.append({
                    "kind": "statement", "line": line, "end_line": line,
                    "text": f"class {stmt.name}",
                })
                for sub in stmt.body:
                    if isinstance(sub, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        add_function(sub.name, sub.args, sub.body)
                continue

            if isinstance(stmt, ast.If):
                arms = []
                node = stmt
                while True:
                    body = []
                    arms.append({
                        "test": _flow_text(source, node.test),
                        "body": body,
                        "line": node.lineno,
                    })
                    fill_nodes(node.body, body)
                    if len(node.orelse) == 1 and isinstance(node.orelse[0], ast.If):
                        node = node.orelse[0]
                        continue
                    if node.orelse:
                        else_body = []
                        arms.append({"test": None, "body": else_body, "line": None})
                        fill_nodes(node.orelse, else_body)
                    break
                out.append({
                    "kind": "branch", "line": line, "end_line": end_line,
                    "arms": arms,
                })
                continue

            if isinstance(stmt, (ast.For, ast.AsyncFor, ast.While)):
                body = []
                if isinstance(stmt, ast.While):
                    loop = "while"
                    header = "while " + _flow_text(source, stmt.test)
                else:
                    loop = "for"
                    header = (
                        "for "
                        + _flow_text(source, stmt.target)
                        + " in "
                        + _flow_text(source, stmt.iter)
                    )
                out.append({
                    "kind": "loop", "loop": loop, "line": line,
                    "end_line": end_line, "header": header, "body": body,
                })
                fill_nodes(stmt.body, body)
                continue

            # Everything else: one statement box with its source text.
            out.append({
                "kind": "statement", "line": line, "end_line": end_line,
                "text": _flow_text(source, stmt),
            })

    module_nodes = []
    functions["<module>"] = {"name": "<module>", "params": [], "nodes": module_nodes}
    fill_nodes(tree.body, module_nodes)

    return {"format_version": FLOWCHART_VERSION, "functions": functions, "error": None}


def _flow_text(source, node):
    """One-line source text for an ast node, with newlines collapsed."""
    segment = ast.get_source_segment(source, node) or ""
    return " ".join(segment.split())


DEMO = """def fact(n):
    if n <= 1:
        return 1
    return n * fact(n - 1)

nums = [3, 1, 2]
alias = nums
alias.append(4)
print(fact(3), nums)
"""

if __name__ == "__main__":
    if len(sys.argv) > 1:
        with open(sys.argv[1], encoding="utf-8") as handle:
            program = handle.read()
    else:
        program = DEMO
    print(json.dumps(run_trace(program), indent=2))
