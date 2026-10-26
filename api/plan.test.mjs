// The Vercel adapter only translates. These tests prove the translation, the
// fallback for an internal failure and that nothing internal escapes.

import assert from "node:assert/strict";
import test from "node:test";

import { createVercelHandler } from "./plan.js";
import { chatResponse, recordingFetch, TEST_ENV, validRequest } from "../server/planner/testFixtures.mjs";

function fakeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(key, value) {
      this.headers[key] = value;
    },
    end(text) {
      this.body = text;
    },
  };
}

function fakeReq(overrides = {}) {
  return {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9, 10.0.0.1" },
    body: JSON.stringify(validRequest()),
    ...overrides,
  };
}

test("answers a valid request with the selected plan", async () => {
  const handler = createVercelHandler({
    env: TEST_ENV,
    fetchImpl: recordingFetch(chatResponse({ primary: "motion" })),
  });
  const res = fakeRes();
  await handler(fakeReq(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["cache-control"], "no-store");
  assert.equal(JSON.parse(res.body).primary, "motion");
});

test("accepts a pre-parsed body and refuses a non-POST method", async () => {
  const handler = createVercelHandler({
    env: TEST_ENV,
    fetchImpl: recordingFetch(chatResponse({ primary: "motion" })),
  });
  const objectBody = fakeRes();
  await handler(fakeReq({ body: validRequest() }), objectBody);
  assert.equal(objectBody.statusCode, 200);

  const wrongMethod = fakeRes();
  await handler(fakeReq({ method: "GET", body: "" }), wrongMethod);
  assert.equal(wrongMethod.statusCode, 405);
});

test("returns not_configured when the deployment has no key", async () => {
  const handler = createVercelHandler({ env: {}, fetchImpl: recordingFetch() });
  const res = fakeRes();
  await handler(fakeReq(), res);
  assert.equal(res.statusCode, 503);
  assert.equal(JSON.parse(res.body).error.code, "not_configured");
});

test("hides an internal failure behind a classified 500", async () => {
  const explodingEnv = new Proxy(
    {},
    {
      get() {
        throw new Error("configuration exploded at C:\\secret\\path");
      },
    },
  );
  const handler = createVercelHandler({ env: explodingEnv });
  const res = fakeRes();
  await handler(fakeReq(), res);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(JSON.parse(res.body), { error: { code: "http_error" } });
  assert.equal(res.body.includes("secret"), false);
});
