// Talks to the Pyodide worker. The Python tracer has one source of truth in
// tracer-poc/tracer.py; it is imported here as text and handed to the worker.

import tracerSource from "../../tracer-poc/tracer.py?raw";

// Pinned to the version in package.json so the CDN matches the npm package
// that scripts/pyodide-check.mjs tests against.
const PYODIDE_VERSION = "314.0.7";
const INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

const DEFAULT_LIMITS = { maxSteps: 1500, maxSeconds: 5.0 };

let worker = null;
let nextId = 1;
const pending = new Map();
let lastStatus = "idle";
const statusListeners = new Set();

function setStatus(status) {
  lastStatus = status;
  for (const listener of statusListeners) listener(status);
}

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./pyodide.worker.js", import.meta.url), {
    type: "module",
  });
  worker.onmessage = (event) => {
    const message = event.data;
    if (message.type === "status") {
      setStatus(message.status);
      return;
    }
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.type === "result") entry.resolve(message.result);
    else entry.reject(new Error(message.error));
  };
  worker.postMessage({ type: "init", tracerSource, indexURL: INDEX_URL });
  return worker;
}

/** Reports "idle" | "loading" | "ready" | "failed". Returns an unsubscribe function. */
export function onEngineStatus(listener) {
  statusListeners.add(listener);
  listener(lastStatus);
  return () => statusListeners.delete(listener);
}

export function engineStatus() {
  return lastStatus;
}

/**
 * Runs Python source and resolves with the trace object from
 * docs/trace-format.md. Rejects only if the engine itself fails; a program
 * that crashes comes back as a normal result with status "error".
 */
export function runTrace(source, { inputs = [], ...limits } = {}) {
  const w = ensureWorker();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({
      type: "run",
      id,
      source,
      inputs,
      ...DEFAULT_LIMITS,
      ...limits,
    });
  });
}

/**
 * Builds the flowchart structure for a source without running it. Cached
 * per source, since it depends on nothing else.
 */
const flowCache = new Map();
export function buildFlowchart(source) {
  if (flowCache.has(source)) return Promise.resolve(flowCache.get(source));
  const w = ensureWorker();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, {
      resolve: (value) => {
        flowCache.set(source, value);
        resolve(value);
      },
      reject,
    });
    w.postMessage({ type: "flowchart", id, source });
  });
}

/**
 * Kills the worker. This is the hard stop for a program the tracer's own
 * limits failed to contain, and it also frees the Pyodide memory.
 */
export function stopEngine() {
  if (!worker) return;
  for (const { reject } of pending.values()) {
    reject(new Error("stopped"));
  }
  pending.clear();
  worker.terminate();
  worker = null;
  setStatus("idle");
}
