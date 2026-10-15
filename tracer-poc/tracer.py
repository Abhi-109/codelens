"""
CodeLens tracer (trace format version 2)

Runs a string of Python source code and records everything that happens as a
JSON-friendly dictionary:

    result = run_trace(source, max_steps=1500, max_seconds=5.0, inputs=None)

Top-level result
    format_version  int        Always 2 for this version of the format
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
"""

import builtins
import io
import json
import sys
import time
import types
from contextlib import redirect_stdout

FORMAT_VERSION = 2
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


class _Tracer:
    """The function Python calls on every call / line / return / exception event."""

    def __init__(self, max_steps, max_seconds, inputs):
        self.max_steps = max_steps
        self.deadline = time.perf_counter() + max_seconds
        self.max_seconds = max_seconds
        self.inputs = list(inputs or [])
        self.trace = []
        self.stack = []
        self.pending = set()  # frames an exception is currently travelling through
        self.line_steps = 0
        self.frame_counter = 0
        self.values = _Values()

    # --- Python calls this on every event ---------------------------------
    def __call__(self, frame, event, arg):
        if frame.f_code.co_filename != USER_FILE:
            return None  # ignore our own code and the standard library
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
            self.pending.discard(key)  # running again means the exception was handled
            self._record("line", frame)

        elif event == "exception":
            exc_type, exc_value, _ = arg
            self.pending.add(key)
            entry["line"] = frame.f_lineno
            self._record(
                "exception", frame,
                exception={"type": exc_type.__name__, "message": _safe_str(exc_value)},
            )

        elif event == "return":
            if key in self.pending:
                self.pending.discard(key)
                self._record("unwind", frame, exit_kind="exception")
            else:
                self._record("return", frame, exit_kind="normal", has_value=True, value=arg)
            for index in range(len(self.stack) - 1, -1, -1):  # pop this exact frame
                if self.stack[index] is entry:
                    del self.stack[index]
                    break

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


def _error_line(tb):
    """Line number, in the user's code, where the exception happened."""
    line = None
    while tb is not None:
        if tb.tb_frame.f_code.co_filename == USER_FILE:
            line = tb.tb_lineno
        tb = tb.tb_next
    return line


def run_trace(source, max_steps=1500, max_seconds=5.0, inputs=None):
    tracer = _Tracer(max_steps, max_seconds, inputs)
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

    # Syntax errors are reported before anything runs.
    try:
        code = compile(source, USER_FILE, "exec")
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
            exec(code, {"__name__": "__main__"})
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
