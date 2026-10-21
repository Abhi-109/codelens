// Verifies the Python tracer runs inside Pyodide (the browser runtime CodeLens will use).
// This is the de-risking step: sys.settrace and time.perf_counter must work there.
//
//   node scripts/pyodide-check.mjs
//
// Exits 0 only if every example from tracer-poc/examples completes with the
// expected output inside Pyodide.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadPyodide } from "pyodide";

const root = join(import.meta.dirname, "..");
const tracerDir = join(root, "tracer-poc");
const exampleDir = join(tracerDir, "examples");

const EXPECTED = {
  "01_variables.py": "Asha 12\n1.52 True None\n",
  "02_if_else.py": "B\n",
  "03_for_loop.py": "15\n",
  "04_while_loop.py": "5\n4\n3\n2\n1\nLiftoff\n",
  "05_lists.py": "apple\ncherry\n3\n",
  "06_dictionaries.py": "13\n['Asha', 'Ravi', 'Meera']\n",
  "07_function.py": "Hello, Asha\n",
  "08_recursion.py": "120\n",
  "09_bubble_sort.py": "[1, 2, 3, 4, 5]\n",
  "10_class.py": "Rex knows 2 tricks\n['sit', 'shake']\n",
};

const pyodide = await loadPyodide();
pyodide.FS.writeFile("/tracer.py", readFileSync(join(tracerDir, "tracer.py"), "utf8"));
pyodide.FS.writeFile("/flowchart.py", readFileSync(join(tracerDir, "flowchart.py"), "utf8"));
pyodide.FS.writeFile("/analyze.py", readFileSync(join(tracerDir, "analyze.py"), "utf8"));
await pyodide.runPythonAsync(
  "import sys, importlib.util\n"
    + "spec = importlib.util.spec_from_file_location('tracer', '/tracer.py')\n"
    + "tracer = importlib.util.module_from_spec(spec)\n"
    + "spec.loader.exec_module(tracer)\n"
    + "sys.modules['tracer'] = tracer\n"
    + "flow_spec = importlib.util.spec_from_file_location('flowchart', '/flowchart.py')\n"
    + "flowchart = importlib.util.module_from_spec(flow_spec)\n"
    + "flow_spec.loader.exec_module(flowchart)\n"
    + "analyze_spec = importlib.util.spec_from_file_location('analyze', '/analyze.py')\n"
    + "analyze = importlib.util.module_from_spec(analyze_spec)\n"
    + "analyze_spec.loader.exec_module(analyze)\n",
);

const runTraceJson = pyodide.runPython(
  "import json\nlambda source: json.dumps(tracer.run_trace(source))\n",
);

const buildFlowchartJson = pyodide.runPython(
  "import json\nlambda source: json.dumps(tracer.build_flowchart(source))\n",
);

const buildFlowchartGraphJson = pyodide.runPython(
  "import json\nlambda source: json.dumps(flowchart.build_flowchart(source))\n",
);

const analyzeJson = pyodide.runPython(
  "import json\nlambda source: json.dumps(analyze.analyze_source(source))\n",
);

let failed = 0;
for (const name of Object.keys(EXPECTED).sort()) {
  const source = readFileSync(join(exampleDir, name), "utf8");
  const parsed = JSON.parse(runTraceJson(source));
  const ok = parsed.status === "completed" && parsed.output === EXPECTED[name];
  if (!ok) failed += 1;
  const detail = ok
    ? `${parsed.steps} steps`
    : `status=${parsed.status} output=${JSON.stringify(parsed.output)}`;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  (${detail})`);

  const flow = JSON.parse(buildFlowchartJson(source));
  const flowOk = flow.error === null && "<module>" in flow.functions;
  if (!flowOk) failed += 1;
  console.log(
    `${flowOk ? "PASS" : "FAIL"}  ${name}  (flowchart: ${Object.keys(flow.functions).length} chart(s))`,
  );

  const graph = JSON.parse(buildFlowchartGraphJson(source));
  const graphOk =
    graph.format_version === 2 && graph.error === null && "<main>" in graph.functions;
  if (!graphOk) failed += 1;
  console.log(
    `${graphOk ? "PASS" : "FAIL"}  ${name}  (flowchart graph: ${Object.keys(graph.functions).length} chart(s))`,
  );

  const profile = JSON.parse(analyzeJson(source));
  const profileOk =
    profile.profile_version === 1 &&
    profile.kind === "program_profile" &&
    profile.status === "ok" &&
    Array.isArray(profile.functions) &&
    Array.isArray(profile.calls);
  if (!profileOk) failed += 1;
  console.log(
    `${profileOk ? "PASS" : "FAIL"}  ${name}  (profile: ${profile.functions?.length ?? 0} function(s))`,
  );
}

console.log(
  failed === 0
    ? "\nAll examples trace and profile correctly inside Pyodide."
    : `\n${failed} example(s) failed.`,
);
process.exit(failed === 0 ? 0 : 1);
