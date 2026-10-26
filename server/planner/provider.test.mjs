// The provider adapter: one fixed URL, one bounded answer, every failure named.

import assert from "node:assert/strict";
import test from "node:test";

import { createChatProvider } from "./provider.js";
import { chatResponse, TEST_ENV } from "./testFixtures.mjs";

const MESSAGES = { system: "system", user: "{}" };

function provider(fetchImpl, overrides = {}) {
  return createChatProvider({
    url: TEST_ENV.PLANNER_PROVIDER_URL,
    apiKey: TEST_ENV.PLANNER_PROVIDER_KEY,
    model: TEST_ENV.PLANNER_MODEL,
    timeoutMs: 25,
    maxBytes: 1024,
    fetchImpl,
    ...overrides,
  });
}

async function codeOf(promise) {
  try {
    await promise;
    return "ok";
  } catch (error) {
    return error.code;
  }
}

test("is not configured without a key and never calls upstream", async () => {
  let called = false;
  const adapter = provider(async () => {
    called = true;
  }, { apiKey: "" });
  assert.equal(adapter.configured, false);
  assert.equal(await codeOf(adapter.complete(MESSAGES)), "not_configured");
  assert.equal(called, false);
});

test("posts one bounded chat completion to the configured URL", async () => {
  const calls = [];
  const adapter = provider(async (url, options) => {
    calls.push({ url, options });
    return chatResponse({ primary: "motion" });
  });
  assert.deepEqual(await adapter.complete(MESSAGES), { primary: "motion" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, TEST_ENV.PLANNER_PROVIDER_URL);
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.authorization, `Bearer ${TEST_ENV.PLANNER_PROVIDER_KEY}`);
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.model, TEST_ENV.PLANNER_MODEL);
  assert.equal(body.temperature, 0);
  assert.equal(body.response_format.type, "json_object");
  assert.equal(body.messages[1].content, "{}");
});

test("classifies cancellation separately from timeout", async () => {
  const hanging = (_url, options) =>
    new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    });

  const before = new AbortController();
  before.abort();
  assert.equal(await codeOf(provider(hanging).complete(MESSAGES, { signal: before.signal })), "cancelled");

  const during = new AbortController();
  const pending = provider(hanging).complete(MESSAGES, { signal: during.signal });
  during.abort();
  assert.equal(await codeOf(pending), "cancelled");
});

test("times out a provider that never answers", async () => {
  const hanging = (_url, options) =>
    new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    });
  assert.equal(await codeOf(provider(hanging).complete(MESSAGES)), "timeout");
});

test("classifies status, size and JSON failures", async () => {
  const cases = [
    ["rate_limited", async () => chatResponse({}, { status: 429 })],
    ["http_error", async () => chatResponse({}, { status: 503 })],
    ["oversized", async () => chatResponse({}, { declaredLength: "4096" })],
    [
      "oversized",
      async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => "x".repeat(2048) }),
    ],
    ["invalid_json", async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => "{" })],
    [
      "invalid_json",
      async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify({ choices: [{ message: { content: "not json" } }] }),
      }),
    ],
    [
      "invalid_json",
      async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify({ choices: [] }),
      }),
    ],
  ];
  for (const [code, answer] of cases) {
    assert.equal(await codeOf(provider(answer).complete(MESSAGES)), code);
  }
});

test("turns a thrown transport error into a network error", async () => {
  const adapter = provider(async () => {
    throw new Error("ECONNRESET");
  });
  assert.equal(await codeOf(adapter.complete(MESSAGES)), "network");
});
