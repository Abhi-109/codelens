// The provider boundary: one POST, bounded size, classified failures, no secret.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PlannerProviderError,
  createAiProvider,
  plannerEndpoint,
} from "./aiProvider.js";

const payload = { request_version: 1, task: "choose_visualization" };

test("an unconfigured provider never touches the network", async () => {
  let calls = 0;
  const provider = createAiProvider({
    endpoint: null,
    fetchImpl: async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    },
  });
  assert.equal(provider.configured, false);
  await assert.rejects(provider.request(payload), (error) => error.code === "not_configured");
  assert.equal(calls, 0);
});

test("a good response is parsed once", async () => {
  let seen = null;
  const provider = createAiProvider({
    endpoint: "/api/plan",
    fetchImpl: async (url, options) => {
      seen = { url, options };
      return new Response(JSON.stringify({ primary: "motion" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  assert.equal(provider.configured, true);
  assert.deepEqual(await provider.request(payload), { primary: "motion" });
  assert.equal(seen.url, "/api/plan");
  assert.equal(seen.options.method, "POST");
  assert.equal(seen.options.headers["content-type"], "application/json");
});

test("HTTP failures are classified", async () => {
  const respond = (status, body = "{}", headers = {}) =>
    createAiProvider({ endpoint: "/api/plan", fetchImpl: async () => new Response(body, { status, headers }) });

  await assert.rejects(respond(429).request(payload), (error) => error.code === "rate_limited");
  await assert.rejects(respond(500).request(payload), (error) => error.code === "http_error");
  await assert.rejects(respond(200, "not json").request(payload), (error) => error.code === "invalid_json");
  await assert.rejects(
    respond(200, "{}", { "content-length": "999999" }).request(payload),
    (error) => error.code === "oversized",
  );
  const tiny = createAiProvider({
    endpoint: "/api/plan",
    maxBytes: 10,
    fetchImpl: async () => new Response("x".repeat(50), { status: 200 }),
  });
  await assert.rejects(tiny.request(payload), (error) => error.code === "oversized");
});

test("a network failure is not mistaken for a timeout", async () => {
  const provider = createAiProvider({
    endpoint: "/api/plan",
    fetchImpl: async () => {
      throw new TypeError("fetch failed");
    },
  });
  await assert.rejects(provider.request(payload), (error) => error.code === "network");
});

test("a hanging request times out", async () => {
  const provider = createAiProvider({
    endpoint: "/api/plan",
    timeoutMs: 20,
    fetchImpl: (url, options) =>
      new Promise((resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      }),
  });
  await assert.rejects(provider.request(payload), (error) => error.code === "timeout");
});

test("a caller can cancel its own request", async () => {
  const controller = new AbortController();
  const provider = createAiProvider({
    endpoint: "/api/plan",
    timeoutMs: 5000,
    fetchImpl: (url, options) =>
      new Promise((resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
        setTimeout(() => controller.abort(), 10);
      }),
  });
  await assert.rejects(provider.request(payload, { signal: controller.signal }), (error) => error.code === "cancelled");
});

test("a server that classifies its own refusal is believed", async () => {
  const respond = (status, body) =>
    createAiProvider({
      endpoint: "/api/plan",
      fetchImpl: async () => new Response(JSON.stringify(body), { status }),
    });

  await assert.rejects(respond(503, { error: { code: "not_configured", detail: "sk-live-secret" } }).request(payload), (error) => {
    assert.equal(error.code, "not_configured");
    assert.equal(error.message.includes("sk-live"), false);
    return true;
  });
  await assert.rejects(
    respond(400, { error: { code: "rejected", detail: "origin" } }).request(payload),
    (error) => error.code === "rejected",
  );
  await assert.rejects(
    respond(502, { error: { code: "nonsense", detail: "stack trace" } }).request(payload),
    (error) => error.code === "http_error",
  );
});

test("the endpoint comes from public configuration, never a key", () => {
  assert.equal(plannerEndpoint({}), null);
  assert.equal(plannerEndpoint({ __CODELENS_PLANNER_ENDPOINT__: " /api/plan " }), "/api/plan");
});

test("the error class refuses unknown codes", () => {
  assert.equal(new PlannerProviderError("nonsense").code, "network");
});
