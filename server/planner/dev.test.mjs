// The dev endpoint exists so the real client can be driven against the real
// handler without a key. It must stay off unless explicitly enabled.

import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { createMockUpstream, createPlannerDevPlugin } from "./dev.js";
import { validRequest } from "./testFixtures.mjs";

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

function fakeReq(body) {
  const req = Readable.from([Buffer.from(body)]);
  req.method = "POST";
  req.url = "/api/plan?case=tree";
  req.headers = { "content-type": "application/json" };
  return req;
}

test("the mock upstream answers each scenario by name", async () => {
  const answer = async (scenario) => {
    const response = await createMockUpstream(scenario)("https://mock.invalid", {});
    return JSON.parse(await response.text()).choices[0].message.content;
  };
  assert.deepEqual(JSON.parse(await answer("tree")), { primary: "tree" });
  assert.deepEqual(JSON.parse(await answer("invalid")), { primary: "graph" });
  assert.deepEqual(JSON.parse(await answer("motion")), { primary: "motion" });

  const failed = await createMockUpstream("error")("https://mock.invalid", {});
  assert.equal(failed.ok, false);

  const controller = new AbortController();
  const pending = createMockUpstream("timeout")("https://mock.invalid", { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, /aborted/);
});

test("the dev endpoint stays off unless CODELENS_PLANNER_DEV_MOCK is set", () => {
  const plugin = createPlannerDevPlugin({});
  assert.equal(plugin.apply, "serve");
  let mounted = 0;
  plugin.configureServer({ middlewares: { use() { mounted += 1; } } });
  assert.equal(mounted, 0);
});

test("the dev endpoint drives the real handler over HTTP", async () => {
  let middleware = null;
  const plugin = createPlannerDevPlugin({ CODELENS_PLANNER_DEV_MOCK: "1" });
  plugin.configureServer({
    middlewares: {
      use(path, fn) {
        assert.equal(path, "/api/plan");
        middleware = fn;
      },
    },
  });
  assert.equal(typeof middleware, "function");

  const res = fakeRes();
  await middleware(fakeReq(JSON.stringify(validRequest())), res);
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).primary, "tree");
});
