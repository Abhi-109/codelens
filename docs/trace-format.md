# CodeLens Trace Format (version 2)

## 1. Overview

CodeLens records Python execution as an ordered sequence of JSON events. Each event represents an execution step, function call, return, exception, output, input, or a safety limit stopping the run.

The tracer that produces this format lives in `tracer-poc/tracer.py`.

## 2. Top-Level JSON Structure

| Field | Type | Description |
|---|---|---|
| `format_version` | Integer | Always `2` for this version of the format |
| `status` | String | Overall execution status (see below) |
| `steps` | Integer | Number of `line` events recorded |
| `trace` | Array | Ordered list of execution events |
| `output` | String | Everything the program printed, including echoed input |
| `error` | Object or null | `{type, message, line, phase}`, present when `status` is `error` |

### Execution status

| Status | Meaning |
|---|---|
| `completed` | The program ran to the end |
| `error` | A syntax error or an unhandled exception ended the run |
| `step_limit` | The step limit was reached (usually an infinite loop) |
| `timeout` | The wall-clock time limit was reached |
| `output_limit` | The program printed more characters than allowed |
| `internal_error` | A bug in the tracer itself; user code is not at fault |

### Error object

| Field | Type | Description |
|---|---|---|
| `type` | String | Exception or error class name, e.g. `ZeroDivisionError`, `SyntaxError` |
| `message` | String | Human-readable message |
| `line` | Integer or null | Line in the user's code, when known |
| `phase` | String | `compile` (before anything ran), `runtime`, or `tracer` |

## 3. Event Types

| Event | Description |
|---|---|
| `call` | A tracked function (or the module) begins execution |
| `line` | A tracked source line is **about to run** |
| `return` | A function returned normally |
| `exception` | An exception was raised in a frame |
| `unwind` | A frame exited because an exception propagated out of it |
| `output` | Text was written to standard output |
| `input` | The program read a value with `input()` |
| `step_limit` | The step limit stopped the run |
| `timeout` | The time limit stopped the run |
| `output_limit` | The output limit stopped the run |
| `error` | The run ended with an error |

Every event carries `step`, its index in the `trace` array, and `event`, its type.

### Execution events

`call`, `line`, `return`, `exception`, and `unwind` carry the full state:

| Field | Type | Description |
|---|---|---|
| `step` | Integer | Index of this event in `trace` |
| `event` | String | Event type |
| `function` | String | Name of the function this event belongs to; the module is `<module>` |
| `frame_id` | Integer | Stable id of the frame; a new id per call, so recursion gets distinct ids |
| `line` | Integer | Source line associated with the event |
| `return_value` | Value or null | The returned value, on `return` events only |
| `exception` | Object or null | `{type, message}` on `exception` events |
| `exit_kind` | String or null | `normal` on `return`, `exception` on `unwind`, null otherwise |
| `frames` | Array | The whole call stack, oldest frame first; the top of the stack is the last element |
| `heap` | Object | Every container or object reachable from those frames, keyed by object id |

Each entry in `frames`:

| Field | Type | Description |
|---|---|---|
| `frame_id` | Integer | Matches the event's `frame_id` for the current frame |
| `function` | String | Function name |
| `call_line` | Integer or null | Line in the caller that started this call; null for `<module>` |
| `line` | Integer | Line this frame is currently on |
| `variables` | Object | Name to value snapshot of that frame's local variables |

### Output and input events

| Field | Type | Description |
|---|---|---|
| `step` | Integer | Index of this event in `trace` |
| `event` | String | `output` or `input` |
| `text` | String | The text written (`output`) or the value read (`input`) |
| `prompt` | String | The prompt passed to `input()`, on `input` events only |
| `frame_id` | Integer or null | Frame that produced the event |
| `line` | Integer or null | Line that produced the event |

Input is echoed into `output` like a real terminal, so `output` always tells the whole story of what the user would see.

### Limit events

`step_limit`, `timeout`, and `output_limit` carry `step`, `event`, `message`, and `limit`. The `error` event carries `step`, `event`, and the fields of the top-level `error` object.

## 4. Values

Simple values are inline. Containers and objects live in `heap` and are pointed at by reference.

| Value | JSON |
|---|---|
| `None` | `{"type": "none"}` |
| `True` | `{"type": "bool", "value": true}` |
| `5` | `{"type": "int", "value": 5}` |
| A huge integer | `{"type": "int", "value": "99999999999999999999", "big": true}` |
| `1.5` | `{"type": "float", "value": 1.5}` |
| `nan`, `inf` | `{"type": "float", "repr": "nan"}` |
| `"hello"` | `{"type": "str", "value": "hello"}` |
| A function | `{"type": "function", "name": "fact"}` |
| A class | `{"type": "class", "name": "Node"}` |
| A module | `{"type": "module", "name": "math"}` |
| A list, dict, or object | `{"type": "ref", "id": "o1"}` into `heap` |
| Anything else | `{"type": "other", "class": "...", "repr": "..."}` |

Large strings are truncated and marked with `"truncated": true`.

### Heap entries

Each heap entry describes one object:

| Kind | Shape |
|---|---|
| list | `{"type": "list", "items": [...], "more": n?}` |
| tuple | `{"type": "tuple", "items": [...], "more": n?}` |
| set | `{"type": "set", "items": [...], "more": n?}` |
| dict | `{"type": "dict", "entries": [{"key": ..., "value": ...}], "more": n?}` |
| object | `{"type": "object", "class": "Node", "attrs": [{"name": "v", "value": ...}]}` |

A subclass keeps its class name in a `class` field alongside the kind.

Object ids are stable within a run: `o1`, `o2`, and so on, assigned in first-seen order. Two names that point at the same list share one id, which is what lets a visualizer draw two arrows into one box. The heap is rebuilt on every execution event, so only objects reachable from the current frames appear.

## 5. Semantics

- **One-step lag.** A `line` event fires *before* its line runs, so its `variables` show the state *before* the line takes effect. This is deliberate: the visualizer can highlight the line about to run and show what it will read.
- **Determinism.** Sets are listed in sorted order, so the same program always produces the same trace.
- **Frame ordering.** `frames` is oldest first, matching a call stack drawn bottom-up.

## 6. Limits

| Limit | Default | Effect |
|---|---|---|
| `max_steps` | 1500 | `line` events before a `step_limit` stop |
| `max_seconds` | 5.0 | Wall-clock time before a `timeout` stop |
| Items per container | 30 | Extra items are counted in `more` |
| Characters per string | 120 | Longer values are truncated |
| Heap objects per snapshot | 150 | Further objects become `other` with `repr: "…"` |
| Output characters | 10,000 | An `output_limit` stop |

These limits keep traces small enough to visualize and stop runaway programs. The step limit is not a time limit and does not by itself guarantee protection against every possible form of resource exhaustion; a bare `except:` or `except BaseException:` in user code can swallow the stop, so the tracer should run inside a Web Worker that can be terminated on a timeout.

## 7. Stability

This schema describes the current Python tracer. Changes to event fields, value serialization, stack behavior, or execution status must be accompanied by updated tests in `tracer-poc/test_tracer.py`.
