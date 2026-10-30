import assert from "node:assert/strict";
import test from "node:test";

import { createGeminiProvider } from "./geminiProvider.js";

const MESSAGES = { system: "system", user: "{}" };

function provider(fetchImpl, overrides = {}) {
  return createGeminiProvider({
    url: "https://generativelanguage.googleapis.com/v1beta/interactions",
    apiKey: "test-key",
    model: "gemini-3.8-flash",
    timeoutMs: 25,
    maxBytes: 1024,
    fetchImpl,
    ...overrides,
  });
}

test("is not configured without a key", async () => {
  const adapter = provider(async () => {}, { apiKey: "" });
  assert.equal(adapter.configured, false);
  try {
    await adapter.complete(MESSAGES);
    assert.fail("should throw");
  } catch (e) {
    assert.equal(e.code, "not_configured");
  }
});

test("uses x-goog-api-key and parses output_text", async () => {
  const calls = [];
  const adapter = provider(async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify({ output_text: JSON.stringify({ primary: "motion" }) }),
    };
  });
  const result = await adapter.complete(MESSAGES);
  assert.deepEqual(result, { primary: "motion" });
  assert.equal(calls[0].options.headers["x-goog-api-key"], "test-key");
  assert.ok(!("authorization" in calls[0].options.headers));
});

test("parses outputs array text", async () => {
  const adapter = provider(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => JSON.stringify({ outputs: [{ type: "text", text: JSON.stringify({ primary: "array" }) }] }),
  }));
  assert.deepEqual(await adapter.complete(MESSAGES), { primary: "array" });
});

test("classifies http errors", async () => {
  const adapter = provider(async () => ({ ok: false, status: 500, headers: { get: () => null }, text: async () => "" }));
  try {
    await adapter.complete(MESSAGES);
    assert.fail("should throw");
  } catch (e) {
    assert.equal(e.code, "http_error");
  }
});
