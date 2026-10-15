
import sys
import json
import io
import os
from contextlib import redirect_stdout

MAX_STEPS = 1500
TARGET_FILE = os.path.abspath(__file__)

trace = []
call_stack = []
pending_exceptions = set()
step_count = 0
execution_status = "completed"


class TraceLimitExceeded(BaseException):
    pass


class TraceOutput(io.StringIO):
    """Capture printed text without tracing this helper method."""

    def write(self, text):
        # Actually store the text so getvalue() works.
        written = super().write(text)

        if text:
            trace.append({
                "event": "output",
                "text": text,
                "call_stack": [
                    {
                        "function": item["function"],
                        "line": item["line"]
                    }
                    for item in call_stack
                ]
            })

        return written


def tracer(frame, event, arg):
    global step_count

    # Do not trace our own output-capture implementation.
    if frame.f_code is TraceOutput.write.__code__:
        return None

    # Ignore external files and library internals.
    if os.path.abspath(frame.f_code.co_filename) != TARGET_FILE:
        return None

    function_name = frame.f_code.co_name
    frame_id = id(frame)

    if event == "call":
        call_stack.append({
            "frame_id": frame_id,
            "function": function_name,
            "line": frame.f_lineno
        })

    if event == "line":
        step_count += 1

        if step_count > MAX_STEPS:
            trace.append({
                "event": "step_limit",
                "limit": MAX_STEPS,
                "message": "Maximum step limit reached."
            })
            raise TraceLimitExceeded()

        # Execution continued in this frame, so a previously
        # raised exception was caught or handled here.
        pending_exceptions.discard(frame_id)

    variables = {
        name: repr(value)
        for name, value in frame.f_locals.items()
    }

    stack_snapshot = [
        {
            "function": item["function"],
            "line": item["line"]
        }
        for item in call_stack
    ]

    record = {
        "event": event,
        "function": function_name,
        "line": frame.f_lineno,
        "variables": variables,
        "return_value": None,
        "exception": None,
        "exit_kind": None,
        "call_stack": stack_snapshot
    }

    if event == "exception":
        exc_type, exc_value, _ = arg
        pending_exceptions.add(frame_id)

        record["exception"] = {
            "type": exc_type.__name__,
            "message": str(exc_value)
        }

        trace.append(record)

    elif event == "return":
        if frame_id in pending_exceptions:
            record["event"] = "unwind"
            record["exit_kind"] = "exception"
            pending_exceptions.discard(frame_id)
        else:
            record["return_value"] = repr(arg)
            record["exit_kind"] = "normal"

        trace.append(record)

        # Remove this exact frame, including recursive calls.
        for index in range(len(call_stack) - 1, -1, -1):
            if call_stack[index]["frame_id"] == frame_id:
                call_stack.pop(index)
                break

    elif event in ("call", "line"):
        trace.append(record)

    return tracer


# Test program
def inner():
    result = 10 / 0


def middle():
    inner()


def main():
    middle()


if __name__ == "__main__":
    output_capture = TraceOutput()

    try:
        sys.settrace(tracer)

        with redirect_stdout(output_capture):
            main()

    except TraceLimitExceeded:
        execution_status = "step_limit"

    except Exception as exc:
        execution_status = "error"

        trace.append({
            "event": "error",
            "type": type(exc).__name__,
            "message": str(exc)
        })

    finally:
        sys.settrace(None)
        call_stack.clear()
        pending_exceptions.clear()

    print(json.dumps({
        "status": execution_status,
        "steps": step_count,
        "trace": trace,
        "output": output_capture.getvalue()
    }, indent=2))