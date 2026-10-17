// Loads Pyodide once, imports the tracer (and the flowchart graph builder),
// and runs programs on request. Kept off the main thread so a runaway
// program can be killed by terminating this worker (the tracer's own limits
// are the first line of defence; this is the second).

let pyodidePromise = null;
let bootError = null;
let initConfig = null;

function post(message) {
  self.postMessage(message);
}

function getPyodide() {
  if (!pyodidePromise) {
    const init = initConfig;
    pyodidePromise = (async () => {
      post({ type: "status", status: "loading" });
      const { loadPyodide } = await import(
        /* @vite-ignore */ `${init.indexURL}pyodide.mjs`
      );
      const pyodide = await loadPyodide({ indexURL: init.indexURL });
      pyodide.FS.writeFile("/tracer.py", init.tracerSource);
      pyodide.FS.writeFile("/flowchart.py", init.flowchartSource);
      await pyodide.runPythonAsync(`
import importlib.util
import json

spec = importlib.util.spec_from_file_location("tracer", "/tracer.py")
tracer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tracer)

# flowchart.py is a standalone sibling of tracer.py (it imports only ast), so
# it loads the same way and is told apart by format_version: 1 = tree, 2 = graph.
flow_spec = importlib.util.spec_from_file_location("flowchart", "/flowchart.py")
flowchart = importlib.util.module_from_spec(flow_spec)
flow_spec.loader.exec_module(flowchart)

def run_trace_json(source, max_steps=1500, max_seconds=5.0, inputs=None):
    return json.dumps(tracer.run_trace(source, max_steps=max_steps,
                                       max_seconds=max_seconds, inputs=inputs))

def build_flowchart_json(source):
    return json.dumps(tracer.build_flowchart(source))

def build_flowchart_graph_json(source):
    return json.dumps(flowchart.build_flowchart(source))
`);
      post({ type: "status", status: "ready" });
      return pyodide;
    })();
  }
  return pyodidePromise;
}

self.onmessage = async (event) => {
  const message = event.data;

  if (message.type === "init") {
    initConfig = message;
    try {
      await getPyodide();
    } catch (error) {
      bootError = error;
      post({ type: "status", status: "failed", message: String(error?.message ?? error) });
    }
    return;
  }

  if (message.type === "run" || message.type === "flowchart" || message.type === "flowchart_graph") {
    if (bootError) {
      post({ type: "error", id: message.id, error: String(bootError?.message ?? bootError) });
      return;
    }
    try {
      const pyodide = await getPyodide();
      const name =
        message.type === "run"
          ? "run_trace_json"
          : message.type === "flowchart"
            ? "build_flowchart_json"
            : "build_flowchart_graph_json";
      const call = pyodide.globals.get(name);
      try {
        const json = message.type === "run"
          ? call(message.source, message.maxSteps, message.maxSeconds, message.inputs)
          : call(message.source);
        post({ type: "result", id: message.id, result: JSON.parse(json) });
      } finally {
        call.destroy();
      }
    } catch (error) {
      post({ type: "error", id: message.id, error: String(error?.message ?? error) });
    }
  }
};
