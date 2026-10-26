// The whole server boundary, exercised as one pure function. No network, no
// framework, no real key: `fetchImpl` and `limiter` are injected.

import assert from "node:assert/strict";
import test from "node:test";

import { PLANNER_LIMITS } from "./config.js";
import { handlePlannerRequest } from "./handler.js";
import { createRateLimiter } from "./rateLimit.js";
import { chatResponse, postRequest, recordingFetch, TEST_ENV, validRequest } from "./testFixtures.mjs";

const FAST = { ...PLANNER_LIMITS, providerTimeoutMs: 25 };
const freshLimiter = () => createRateLimiter({ windowMs: 60000, max: 10, keys: 10 });

async function call(overrides = {}, fixture = {}) {
  const { env = TEST_ENV, fetchImpl = recordingFetch(), limiter = freshLimiter(), ...rest } = fixture;
  return handlePlannerRequest({
    ...postRequest(validRequest()),
    env,
    fetchImpl,
    limiter,
    limits: FAST,
    clientKey: "test-client",
    ...overrides,
    ...rest,
  });
}

test("refuses every method but POST", async () => {
  for (const method of ["GET", "PUT", "DELETE", "OPTIONS"]) {
    const result = await call({ method });
    assert.equal(result.status, 405);
    assert.equal(result.headers.allow, "POST");
    assert.equal(result.body.error.code, "rejected");
  }
});

test("refuses a cross-site origin and accepts a same-origin one", async () => {
  const cross = await call({ headers: { "content-type": "application/json", origin: "https://evil.example", host: "codelens.example" } });
  assert.equal(cross.status, 403);
  assert.equal(cross.body.error.detail, "origin");

  const nullOrigin = await call({ headers: { "content-type": "application/json", origin: "null" } });
  assert.equal(nullOrigin.status, 403);

  const same = await call({ headers: { "content-type": "application/json", origin: "https://codelens.example", host: "codelens.example" } });
  assert.equal(same.status, 200);
});

test("refuses a body that is not JSON content", async () => {
  const result = await call({ headers: { "content-type": "text/plain" } });
  assert.equal(result.status, 415);
  assert.equal(result.body.error.detail, "content_type");
});

test("bounds the request before parsing it", async () => {
  const huge = "x".repeat(FAST.requestBytes + 1);
  const byLength = await call({ body: huge });
  assert.equal(byLength.status, 413);
  assert.equal(byLength.body.error.code, "oversized");

  const byHeader = await call({
    body: "{}",
    headers: { "content-type": "application/json", "content-length": String(FAST.requestBytes + 1) },
  });
  assert.equal(byHeader.status, 413);

  const small = await call({}, { limits: { ...FAST, requestBytes: 64 } });
  assert.equal(small.status, 413);
});

test("refuses malformed JSON and a malformed request", async () => {
  const broken = await call({ body: "{not json" });
  assert.equal(broken.status, 400);
  assert.equal(broken.body.error.code, "invalid_json");

  const wrongShape = await call({ body: JSON.stringify(validRequest({ task: "write_code" })) });
  assert.equal(wrongShape.status, 400);
  assert.equal(wrongShape.body.error.code, "invalid_schema");
  assert.equal(wrongShape.body.error.detail, "request_task");
});

test("answers not_configured without calling upstream", async () => {
  const fetchImpl = recordingFetch();
  const result = await call({}, { env: {}, fetchImpl });
  assert.equal(result.status, 503);
  assert.equal(result.body.error.code, "not_configured");
  assert.equal(fetchImpl.calls.length, 0);
});

test("applies the rate limit and reports when to retry", async () => {
  const limiter = createRateLimiter({ windowMs: 60000, max: 2, keys: 10 });
  const now = 1_000_000;
  assert.equal((await call({}, { limiter, now })).status, 200);
  assert.equal((await call({}, { limiter, now })).status, 200);
  const limited = await call({}, { limiter, now });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error.code, "rate_limited");
  assert.equal(limited.headers["retry-after"], "60");
});

test("returns a validated selection from a valid answer", async () => {
  const fetchImpl = recordingFetch(chatResponse({ primary: "motion", emphasis: ["values"] }));
  const result = await call({}, { fetchImpl });
  assert.equal(result.status, 200);
  assert.equal(result.body.primary, "motion");
  assert.deepEqual(result.body.emphasis, ["values"]);
  assert.equal(result.body.explanation, "standard");
  // The model picked no concepts, so the client keeps its own detected ones.
  assert.equal("concepts" in result.body, false);
  assert.equal(result.headers["cache-control"], "no-store");

  // One fixed upstream, key in the header only, and the source stays out of the URL.
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].url, TEST_ENV.PLANNER_PROVIDER_URL);
  assert.equal(fetchImpl.calls[0].options.headers.authorization, `Bearer ${TEST_ENV.PLANNER_PROVIDER_KEY}`);
  assert.equal(JSON.stringify(result.body).includes(TEST_ENV.PLANNER_PROVIDER_KEY), false);
});

test("echoes the concepts the model picked, and only those", async () => {
  const fetchImpl = recordingFetch(chatResponse({ primary: "motion", concepts: ["scalars"] }));
  const result = await call({}, { fetchImpl });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.concepts, ["scalars"]);
});

test("maps every upstream failure to a classified code", async () => {
  const cases = [
    ["http_error", async () => chatResponse({}, { status: 500 })],
    ["rate_limited", async () => chatResponse({}, { status: 429 })],
    ["invalid_json", async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => "not json" })],
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
      "oversized",
      async () => ({
        ok: true,
        status: 200,
        headers: { get: () => "999999" },
        text: async () => "",
      }),
    ],
    ["network", async () => {
      throw new Error("connection reset");
    }],
  ];
  for (const [code, answer] of cases) {
    const result = await call({}, { fetchImpl: recordingFetch(answer) });
    assert.equal(result.status >= 500 || result.status === 429, true);
    assert.equal(result.body.error.code, code);
    assert.equal(JSON.stringify(result.body).includes("connection reset"), false);
  }
});

test("times out a slow upstream instead of hanging", async () => {
  const fetchImpl = async (_url, options) =>
    new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    });
  const result = await call({}, { fetchImpl });
  assert.equal(result.status, 504);
  assert.equal(result.body.error.code, "timeout");
});

test("rejects an unknown renderer, a widened concept and unsupported evidence", async () => {
  const unknown = await call({}, { fetchImpl: recordingFetch(chatResponse({ primary: "graph" })) });
  assert.equal(unknown.status, 502);
  assert.equal(unknown.body.error.code, "rejected");
  assert.equal(unknown.body.error.detail, "unknown_renderer");

  const inventedConcept = await call({}, { fetchImpl: recordingFetch(chatResponse({ primary: "motion", concepts: ["graph"] })) });
  assert.equal(inventedConcept.body.error.detail, "unknown_concept");

  // `tree` needs recorded call events; this trace has one call, so remove them.
  const noCalls = validRequest();
  noCalls.trace.calls = 0;
  const unsupported = await call({ body: JSON.stringify(noCalls) }, { fetchImpl: recordingFetch(chatResponse({ primary: "tree" })) });
  assert.equal(unsupported.body.error.detail, "missing_call_events");

  const extraField = await call({}, { fetchImpl: recordingFetch(chatResponse({ primary: "motion", note: "hi" })) });
  assert.equal(extraField.body.error.code, "invalid_schema");
});

test("never leaks the upstream body or an internal failure", async () => {
  const leaky = async () => ({
    ok: false,
    status: 500,
    headers: { get: () => null },
    text: async () => JSON.stringify({ secret: "sk-live-should-never-appear", stack: "Error: boom" }),
  });
  const result = await call({}, { fetchImpl: recordingFetch(leaky) });
  const serialized = JSON.stringify(result.body);
  assert.equal(serialized.includes("sk-live"), false);
  assert.equal(serialized.includes("boom"), false);
  assert.deepEqual(Object.keys(result.body.error), ["code", "detail"]);
});
