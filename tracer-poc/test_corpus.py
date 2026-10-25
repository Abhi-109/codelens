"""Property tests over the supported-Python corpus (corpus.py).

Every program is run for real, once, and then two kinds of claim are checked:

  * the claim corpus.py makes about it (status, and the exception type for the
    error cases), plus the recorded golden (exact stdout, counts) - so a tracer
    change that alters any program's behaviour fails here until the golden is
    regenerated on purpose;
  * the trace-format promises, step by step: every event is well formed, every
    line number exists in the source, every reference resolves to an object in
    the same snapshot, every value has a known type, and nothing is invented.

docs/supported-python.md is checked against the same corpus, so the document
cannot drift from what the tracer actually does.
"""

import json
import re
import unittest
from pathlib import Path

from corpus import CORPUS, MAX_SECONDS, MAX_STEPS
from tracer import run_trace

ROOT = Path(__file__).resolve().parent.parent
GOLDEN = json.loads((ROOT / "tracer-poc" / "corpus-golden.json").read_text(encoding="utf-8"))
SUPPORTED_DOC = ROOT / "docs" / "supported-python.md"

# docs/trace-format.md section 4.
VALUE_TYPES = {
    "none", "bool", "int", "float", "str", "ref", "function", "class", "module", "other",
}
CONTAINER_TYPES = {"list", "tuple", "set", "dict", "object"}
EVENT_TYPES = {
    "call", "line", "return", "exception", "unwind", "output", "input", "compare",
    "step_limit", "timeout", "output_limit", "error",
}
# docs/trace-format.md section 3: the operators a compare event can carry.
COMPARE_OPERATORS = {"<", "<=", ">", ">=", "==", "!=", "is", "is not", "in", "not in"}
STATES = {"completed", "error", "step_limit", "timeout", "output_limit", "internal_error"}
LIMIT_EVENTS = {"step_limit": "step_limit", "timeout": "timeout", "output_limit": "output_limit"}
BY_NAME = {case["name"]: case for case in CORPUS}

# Each program is run once and reused by every test: the suite has ~40 tests
# over 45 programs, and a limit case costs a full second of wall clock.
_RESULTS = {}


def run(case):
    """The tracer's real result for this program, computed once."""
    name = case["name"]
    if name not in _RESULTS:
        _RESULTS[name] = run_trace(
            case["source"],
            max_steps=MAX_STEPS,
            max_seconds=MAX_SECONDS,
            inputs=case.get("inputs"),
        )
    return _RESULTS[name]


def declared(case):
    """What corpus.py says this program must do (no status key means: finish)."""
    return case.get("status", "completed")


def source_lines(case):
    return case["source"].count("\n") + 1


def values_in(container):
    """Every value inside a container, for type checking."""
    kind = container.get("type")
    if kind in ("list", "tuple", "set"):
        return list(container.get("items") or [])
    if kind == "dict":
        out = []
        for entry in container.get("entries") or []:
            out.append(entry.get("key"))
            out.append(entry.get("value"))
        return out
    if kind == "object":
        return [attr.get("value") for attr in container.get("attrs") or []]
    return []


class CorpusTests(unittest.TestCase):
    """The claims corpus.py makes about the programs."""

    def test_names_are_unique_snake_case_and_the_corpus_is_broad(self):
        names = [case["name"] for case in CORPUS]
        self.assertEqual(len(names), len(set(names)), "duplicate program name")
        for name in names:
            self.assertRegex(name, r"^[a-z0-9]+(-[a-z0-9]+)*$")
        self.assertGreaterEqual(len(CORPUS), 30, "the corpus is meant to be broad")

    def test_every_program_has_a_golden_entry_and_a_note_when_it_stops_early(self):
        for case in CORPUS:
            with self.subTest(program=case["name"]):
                self.assertIn(declared(case), STATES)
                self.assertIn(case["name"], GOLDEN)
                if declared(case) != "completed":
                    self.assertTrue(
                        case.get("note"),
                        f"{case['name']} stops early, so say why in a note",
                    )
                if declared(case) == "error":
                    self.assertTrue(case.get("error_type"), "error cases name the exception")

    def test_every_program_does_what_it_declares(self):
        for case in CORPUS:
            with self.subTest(program=case["name"]):
                result = run(case)
                self.assertEqual(result["status"], declared(case))
                if declared(case) == "error":
                    self.assertEqual((result.get("error") or {}).get("type"), case["error_type"])
                golden = GOLDEN[case["name"]]
                self.assertEqual(result["output"], golden["output"], "stdout changed")
                if declared(case) == "timeout":
                    # A wall-clock stop lands after however many loop iterations
                    # the scheduler allowed, so the exact counts are not stable.
                    # Status, stdout and the timeout event are the contract.
                    self.assertGreater(result["steps"], 0)
                    self.assertLessEqual(result["steps"], MAX_STEPS)
                    self.assertTrue(
                        any(event["event"] == "timeout" for event in result["trace"]),
                        "a timed-out run must record its timeout event",
                    )
                else:
                    self.assertEqual(result["steps"], golden["steps"], "step count changed")
                    self.assertEqual(len(result["trace"]), golden["events"], "event count changed")

    def test_output_events_add_up_to_the_printed_output(self):
        for case in CORPUS:
            with self.subTest(program=case["name"]):
                result = run(case)
                printed = "".join(
                    e["text"] for e in result["trace"] if e["event"] == "output"
                )
                golden = GOLDEN[case["name"]]["output"]
                if declared(case) == "output_limit":
                    # The cap is the point: what was printed is a cut-short prefix.
                    self.assertTrue(golden.startswith(printed))
                else:
                    self.assertEqual(printed, golden)

    def test_a_program_stopped_by_a_limit_says_so_in_the_trace(self):
        for case in CORPUS:
            if declared(case) not in LIMIT_EVENTS:
                continue
            with self.subTest(program=case["name"]):
                kinds = [e["event"] for e in run(case)["trace"]]
                self.assertIn(LIMIT_EVENTS[declared(case)], kinds)

    def test_a_stopped_run_keeps_the_real_state_it_had(self):
        # A limit stop happens between steps; the last state must still be the
        # real one, so every reference in it still resolves inside its own heap.
        for case in CORPUS:
            if declared(case) not in LIMIT_EVENTS:
                continue
            with self.subTest(program=case["name"]):
                for event in run(case)["trace"]:
                    check_event(self, case, event)


class TracePropertyTests(unittest.TestCase):
    """The trace-format promises, for every event of every corpus program."""

    def test_every_event_of_every_program_is_well_formed(self):
        for case in CORPUS:
            with self.subTest(program=case["name"]):
                lines = source_lines(case)
                for index, event in enumerate(run(case)["trace"]):
                    check_event(self, case, event, index=index)
                    check_line_in_source(self, event, lines)

    def test_frames_are_consistent_within_an_event(self):
        for case in CORPUS:
            with self.subTest(program=case["name"]):
                for event in run(case)["trace"]:
                    frames = event.get("frames")
                    if not frames:
                        continue
                    ids = [f["frame_id"] for f in frames]
                    self.assertEqual(len(ids), len(set(ids)), "a frame appears twice")
                    for frame in frames:
                        self.assertIn("function", frame)
                        self.assertIsInstance(frame.get("variables"), dict)
                        for value in frame["variables"].values():
                            self.assertIn(value["type"], VALUE_TYPES)
                            check_ref(self, event, value)

    def test_line_numbers_never_invent_a_line(self):
        for case in CORPUS:
            with self.subTest(program=case["name"]):
                lines = source_lines(case)
                for event in run(case)["trace"]:
                    if event["event"] != "line":
                        continue
                    self.assertIsInstance(event["line"], int)
                    self.assertGreaterEqual(event["line"], 1)
                    self.assertLessEqual(event["line"], lines)

    def test_the_module_frame_opens_and_closes_a_run_that_completed(self):
        for case in CORPUS:
            if declared(case) != "completed":
                continue
            with self.subTest(program=case["name"]):
                trace = run(case)["trace"]
                first, last = trace[0], trace[-1]
                self.assertEqual(first["event"], "call")
                self.assertEqual(first["function"], "<module>")
                self.assertEqual(last["event"], "return")
                self.assertEqual(last["function"], "<module>")
                self.assertEqual(last["exit_kind"], "normal")
                self.assertEqual(last["return_value"], {"type": "none"})

    def test_every_program_stays_json_and_small_enough_to_draw(self):
        for case in CORPUS:
            with self.subTest(program=case["name"]):
                result = run(case)
                json.dumps(result)
                self.assertLessEqual(result["steps"], MAX_STEPS)
                self.assertLessEqual(len(result["trace"]), MAX_STEPS * 2 + 40)


class SupportedDocTests(unittest.TestCase):
    """docs/supported-python.md describes exactly this corpus."""

    @classmethod
    def setUpClass(cls):
        cls.text = SUPPORTED_DOC.read_text(encoding="utf-8")

    def test_the_document_exists_and_names_the_version_it_describes(self):
        import tracer

        self.assertIn(f"Trace format version {tracer.FORMAT_VERSION}", self.text)

    def test_every_category_in_the_corpus_is_documented_with_a_program(self):
        for category in sorted({case["category"] for case in CORPUS}):
            with self.subTest(category=category):
                cells = row_for(self.text, category)
                self.assertIsNotNone(cells, f'no row for category "{category}"')
                # Category | What it covers | Programs | Status
                names = re.findall(r"`([a-z0-9]+(?:-[a-z0-9]+)*)`", cells[2])
                self.assertTrue(names, f'category "{category}" names no program')
                for name in names:
                    self.assertIn(name, BY_NAME, f'"{name}" is not in the corpus')

    def test_the_limits_in_the_document_are_the_limits_in_the_tracer(self):
        import tracer

        self.assertIn(f"Trace format version {tracer.FORMAT_VERSION}", self.text)
        for number in (tracer.MAX_ITEMS, tracer.MAX_STR, tracer.MAX_HEAP_OBJECTS):
            self.assertIn(str(number), self.text, f"the doc omits the limit {number}")
        self.assertIn("10 000", self.text, "the doc omits the output limit")
        self.assertIn("1500", self.text, "the doc omits the step limit")
        self.assertIn("5.0", self.text, "the doc omits the clock limit")
        self.assertIn("400", self.text, "the doc omits the corpus step limit")
        self.assertIn("1 second", self.text, "the doc omits the corpus clock limit")


# --- helpers ---------------------------------------------------------------


def check_event(test, case, event, index=None):
    """One event: documented shape, real references, known value types."""
    where = f"{case['name']} step {event.get('step')}"
    test.assertIn(event["event"], EVENT_TYPES, where)
    if index is not None:
        test.assertEqual(event["step"], index, f"{where}: step is its own index")
    heap = event.get("heap")
    if heap is not None:
        test.assertIsInstance(heap, dict)
        for object_id, container in heap.items():
            test.assertRegex(object_id, r"^o\d+$", where)
            test.assertIn(container["type"], CONTAINER_TYPES, where)
            for value in values_in(container):
                test.assertIsNotNone(value, where)
                test.assertIn(value["type"], VALUE_TYPES, where)
                check_ref(test, event, value)
    for frame in event.get("frames") or []:
        for value in (frame.get("variables") or {}).values():
            check_ref(test, event, value)
    if event["event"] == "compare":
        test.assertIn(event.get("operator"), COMPARE_OPERATORS, where)
        test.assertIsInstance(event.get("operator"), str, where)
        test.assertIsNone(event.get("frames"), f"{where}: a comparison carries no state snapshot")
        result = event.get("result")
        test.assertTrue(result is True or result is False or result is None, where)
        operands = event.get("operands")
        test.assertIsInstance(operands, list, where)
        test.assertEqual(len(operands), 2, where)
        for operand in operands:
            test.assertIn(operand["value"]["type"], VALUE_TYPES, where)
            check_ref(test, event, operand["value"])
            cell = operand.get("cell")
            if cell is not None:
                test.assertRegex(cell["object_id"], r"^o\d+$", where)
                test.assertIsInstance(cell["index"], int, where)


def check_ref(test, event, value):
    """A reference must point at something in the same snapshot."""
    if value.get("type") == "ref":
        heap = event.get("heap") or {}
        test.assertIn(value["id"], heap, f"dangling reference {value['id']}")


def check_line_in_source(test, event, lines):
    line = event.get("line")
    if line is None:
        return
    test.assertIsInstance(line, int)
    test.assertGreaterEqual(line, 0)
    test.assertLessEqual(line, lines, f"line {line} is not in the source")


def row_for(text, category):
    """The cells of the table row documenting `category` (matched on first cell)."""
    for line in text.splitlines():
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if cells and cells[0] == category:
            return cells
    return None


if __name__ == "__main__":
    unittest.main()
