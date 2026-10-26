// Development adapter for POST /api/plan.
//
// It exists so the real client can be driven against the real server handler in
// a browser without a provider key or a network. It is mounted only when
// CODELENS_PLANNER_DEV_MOCK is set, only under `vite dev` (`apply: "serve"`), and
// it points the provider at a mock fetch — never at a real upstream.

import { handlePlannerRequest } from "./handler.js";
import { PLANNER_LIMITS } from "./config.js";

const MOCK_KEY = "mock-not-a-secret";

function chatCompletion(content) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }),
  };
}

function neverResolves(options) {
  return new Promise((_resolve, reject) => {
    options?.signal?.addEventListener?.("abort", () => {
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    });
  });
}

/**
 * A fake upstream that answers by scenario name. `slow-*` delays first, so the
 * browser can prove a late answer does not land on a newer run.
 */
export function createMockUpstream(scenario = "tree") {
  const [name, delayText] = String(scenario).split("@");
  const delay = Number(delayText) || 0;
  const respond = async () => {
    if (name === "error") return { ok: false, status: 500, headers: { get: () => null }, text: async () => "" };
    const content =
      name === "invalid" ? { primary: "graph" } : name === "motion" ? { primary: "motion" } : { primary: "tree" };
    return chatCompletion(content);
  };
  return async (_url, options) => {
    if (name === "timeout") return neverResolves(options);
    if (delay > 0) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, delay);
        options?.signal?.addEventListener?.("abort", () => {
          clearTimeout(timer);
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      });
    }
    return respond();
  };
}

function readBody(req, limit) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        tooBig = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve({ text: Buffer.concat(chunks).toString("utf8"), tooBig }));
    req.on("error", () => resolve({ text: "", tooBig: false }));
  });
}

/**
 * @param {Record<string, string|undefined>} env
 * @returns {import("vite").Plugin}
 */
export function createPlannerDevPlugin(env = process.env) {
  return {
    name: "codelens-planner-dev-endpoint",
    apply: "serve",
    configureServer(server) {
      if (!env.CODELENS_PLANNER_DEV_MOCK) return;
      server.middlewares.use("/api/plan", async (req, res) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        const scenario = url.searchParams.get("case") ?? "tree";
        const { text, tooBig } = await readBody(req, PLANNER_LIMITS.requestBytes);
        if (tooBig) {
          res.statusCode = 413;
          res.setHeader("content-type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ error: { code: "oversized", detail: "request" } }));
          return;
        }
        const result = await handlePlannerRequest({
          method: req.method,
          headers: req.headers,
          body: text,
          env: {
            PLANNER_PROVIDER_KEY: MOCK_KEY,
            PLANNER_PROVIDER_URL: "https://mock.invalid/v1/chat/completions",
            PLANNER_MODEL: "mock-model",
          },
          fetchImpl: createMockUpstream(scenario),
          clientKey: "dev",
        });
        res.statusCode = result.status;
        for (const [key, value] of Object.entries(result.headers)) res.setHeader(key, value);
        res.end(JSON.stringify(result.body));
      });
    },
  };
}
