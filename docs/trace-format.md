# CodeLens Trace Format

## 1. Overview

CodeLens records Python execution as an ordered sequence of JSON events. Each event represents an execution step, function call, return, exception, output operation, or execution limit.

## 2. Top-Level JSON Structure

| Field | Type | Description |
|---|---|---|
| `status` | String | Overall execution status: `completed`, `error`, or `step_limit` |
| `steps` | Integer | Number of traced line events counted by the tracer |
| `trace` | Array | Ordered list of execution events |
| `output` | String | Complete captured standard output |

## 3. Event Types

| Event | Description |
|---|---|
| `call` | A tracked function begins execution |
| `line` | Python reaches a tracked source line |
| `return` | A function returns normally |
| `exception` | An exception is raised or propagates through a tracked frame |
| `unwind` | A function exits because an exception propagates out of it |
| `output` | Text is written to standard output |
| `step_limit` | The configured execution-step limit is reached |
| `error` | Execution terminates with an error |

## 4. Event Fields

| Field | Type | Description |
|---|---|---|
| `event` | String | Event type |
| `function` | String | Function associated with the event, when applicable |
| `line` | Integer | Source line associated with the event, when applicable |
| `variables` | Object | Snapshot of local variables |
| `return_value` | String or null | Representation of the returned value |
| `exception` | Object or null | Exception type and message |
| `exit_kind` | String or null | Indicates normal return or exception unwinding |
| `call_stack` | Array | Snapshot of tracked active function calls |
| `text` | String | Text captured by an output event |
| `limit` | Integer | Configured limit in a `step_limit` event |
| `message` | String | Additional event or error information |

Not every event contains every field. The fields depend on the event type.

## 5. Variable Representation

The current prototype uses Python's `repr()` to represent variable values. Therefore, variable values are stored as strings in JSON.

For example:

- Integer `2` becomes `"2"`.
- List `[10, 20]` becomes `"[10, 20]"`.
- String `"hello"` is represented as `"'hello'"`.

This representation is suitable for the current prototype but will need a more structured format for visualizing objects and references.

## 6. Output Behavior

The top-level `output` field contains the complete captured output. Individual `output` events may contain fragments, including spaces and newline characters.

## 7. Exception Behavior

The tracer records an `exception` event when an exception is raised or propagates through a tracked frame. A frame that exits due to an unhandled propagating exception is recorded as `unwind`.

A caught exception may produce an `exception` event without ending program execution.

## 8. Step Limit

The prototype limits execution using `MAX_STEPS`. The current counter increments on traced line events. When the limit is exceeded, a `step_limit` event is recorded and execution status becomes `step_limit`.

The limit is not a time limit and does not by itself guarantee protection against every possible form of resource exhaustion.

## 9. Stability

This schema describes the current experimental Python tracer. Changes to event fields, variable serialization, stack behavior, or execution status should be accompanied by updated tests.
