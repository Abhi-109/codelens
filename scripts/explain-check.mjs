// Integration check for the teaching layer: runs the real Python tracer
// inside Pyodide on all 10 scope examples (tracer-poc/examples), feeds every
// trace through explainStep, and verifies each step gets a real sentence and
// a known concept.
//
//   node scripts/explain-check.mjs
//
// Complements src/tracer/explain.test.mjs (hand-built traces) by proving the
// explainer against actual Pyodide output.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadPyodide } from "pyodide";
import { CONCEPTS, explainStep } from "../src/tracer/explain.js";

const root = join(import.meta.dirname, "..");
const tracerDir = join(root, "tracer-poc");
const exampleDir = join(tracerDir, "examples");

const EXAMPLES = [
  "01_variables.py",
  "02_if_else.py",
  "03_for_loop.py",
  "04_while_loop.py",
  "05_lists.py",
  "06_dictionaries.py",
  "07_function.py",
  "08_recursion.py",
  "09_bubble_sort.py",
  "10_class.py",
];

const pyodide = await loadPyodide();
pyodide.FS.writeFile("/tracer.py", readFileSync(join(tracerDir, "tracer.py"), "utf8"));
pyodide.FS.writeFile(
  "/comparisons.py",
  readFileSync(join(tracerDir, "comparisons.py"), "utf8"),
);
await pyodide.runPythonAsync(
  "import sys, importlib.util\n"
    + "cmp_spec = importlib.util.spec_from_file_location('comparisons', '/comparisons.py')\n"
    + "cmp = importlib.util.module_from_spec(cmp_spec)\n"
    + "sys.modules['comparisons'] = cmp\n"
    + "cmp_spec.loader.exec_module(cmp)\n"
    + "spec = importlib.util.spec_from_file_location('tracer', '/tracer.py')\n"
    + "tracer = importlib.util.module_from_spec(spec)\n"
    + "spec.loader.exec_module(tracer)\n"
    + "sys.modules['tracer'] = tracer\n",
);

const runTraceJson = pyodide.runPython(
  "import json\nlambda source: json.dumps(tracer.run_trace(source))\n",
);

let failed = 0;
let totalSteps = 0;
const seenConcepts = new Set();

for (const name of EXAMPLES) {
  const source = readFileSync(join(exampleDir, name), "utf8");
  const result = JSON.parse(runTraceJson(source));
  const trace = result.trace;
  const problems = [];
  for (let i = 0; i < trace.length; i += 1) {
    const { text, concept } = explainStep(trace, i, source);
    if (!text || !text.trim()) problems.push(`step ${i}: empty sentence`);
    if (concept && !(concept in CONCEPTS)) problems.push(`step ${i}: unknown concept "${concept}"`);
    if (concept) seenConcepts.add(concept);
  }
  totalSteps += trace.length;
  if (problems.length > 0) failed += 1;
  const detail = problems.length === 0
    ? `${trace.length} steps explained`
    : `${problems.length} problem(s): ${problems.slice(0, 3).join("; ")}`;
  console.log(`${problems.length === 0 ? "PASS" : "FAIL"}  ${name}  (${detail})`);
}

// Show a sample of the recursion narration so the output can be eyeballed.
const source = readFileSync(join(exampleDir, "08_recursion.py"), "utf8");
const trace = JSON.parse(runTraceJson(source)).trace;
console.log("\nSample narration (factorial):");
for (let i = 0; i < trace.length; i += 1) {
  const event = trace[i];
  if (["call", "return", "output"].includes(event.event)) {
    console.log(`  ${explainStep(trace, i, source).text}`);
  }
}

console.log(`\n${totalSteps} steps explained across ${EXAMPLES.length} examples; concepts used: ${[...seenConcepts].sort().join(", ")}.`);
console.log(failed === 0 ? "Every step has a plain-English explanation." : `${failed} example(s) had problems.`);
process.exit(failed === 0 ? 0 : 1);
