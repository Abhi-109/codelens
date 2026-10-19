"""Runs every program in corpus.py and records exactly what the tracer did.

    python tracer-poc/dump_corpus.py            # check the golden file is current
    python tracer-poc/dump_corpus.py --write    # rewrite the golden file + JS fixture

Two outputs, both generated, never hand-edited:

    tracer-poc/corpus-golden.json          status, output, error type, counts
    src/tracer/__fixtures__/corpus.json.gz the full traces, for the JS tests

`test_corpus.py` checks the golden as well as the declarations in corpus.py, so a
tracer change that alters any program's behaviour fails the Python suite until
the golden is regenerated on purpose. Regenerating is a review step: read the
diff, then commit it.
"""

import gzip
import json
import sys
from pathlib import Path

from corpus import CORPUS, MAX_SECONDS, MAX_STEPS
from tracer import run_trace

ROOT = Path(__file__).resolve().parent.parent
GOLDEN = ROOT / "tracer-poc" / "corpus-golden.json"
FIXTURE = ROOT / "src" / "tracer" / "__fixtures__" / "corpus.json.gz"


def run_case(case):
    """One program, run once; its facts and its trace come from the same run."""
    result = run_trace(
        case["source"],
        max_steps=MAX_STEPS,
        max_seconds=MAX_SECONDS,
        inputs=case.get("inputs"),
    )
    trace = result["trace"]
    error = result.get("error") or {}
    facts = {
        "status": result["status"],
        "output": result["output"],
        "error_type": error.get("type"),
        "error_line": error.get("line"),
        "error_phase": error.get("phase"),
        "steps": result["steps"],
        "events": len(trace),
        "frames": max((len(e.get("frames") or []) for e in trace), default=0),
        "exception": next((e.get("exception") for e in trace if e["event"] == "exception"), None),
    }
    return facts, trace


def build():
    golden = {}
    fixture = {}
    for case in CORPUS:
        facts, trace = run_case(case)
        golden[case["name"]] = facts
        fixture[case["name"]] = {
            "category": case["category"],
            "title": case["title"],
            "source": case["source"],
            "note": case.get("note"),
            "declared": case.get("status", "completed"),
            "declared_error": case.get("error_type"),
            "result": facts,
            "trace": trace,
        }
    return golden, fixture


def main(argv):
    write = "--write" in argv
    golden, fixture = build()
    text = json.dumps(golden, indent=2, sort_keys=True) + "\n"

    if write:
        GOLDEN.write_text(text, encoding="utf-8")
        FIXTURE.parent.mkdir(parents=True, exist_ok=True)
        with gzip.GzipFile(FIXTURE, "wb", mtime=0) as handle:
            handle.write(json.dumps(fixture, sort_keys=True).encode("utf-8"))
        print(f"wrote {GOLDEN.name} ({len(text) / 1024:.1f} KB)")
        print(f"wrote {FIXTURE.name} ({FIXTURE.stat().st_size / 1024:.1f} KB)")
        for name, facts in golden.items():
            shown = facts["output"] if len(facts["output"]) <= 48 else facts["output"][:48] + "…"
            print(
                f"  {name:24} {facts['status']:13} steps={facts['steps']:4} "
                f"events={facts['events']:4} out={shown!r}"
            )
        return 0

    if not GOLDEN.exists():
        print("corpus-golden.json is missing; run with --write")
        return 1
    current = GOLDEN.read_text(encoding="utf-8")
    if current.strip() != text.strip():
        print("The corpus golden file is out of date. Differences:")
        old = json.loads(current)
        for name, facts in golden.items():
            if old.get(name) != facts:
                print(f"  {name}: {json.dumps(old.get(name))} -> {json.dumps(facts)}")
        for name in old:
            if name not in golden:
                print(f"  {name}: removed")
        print("Re-run: python tracer-poc/dump_corpus.py --write")
        return 1
    print(f"corpus golden is current ({len(golden)} programs)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
