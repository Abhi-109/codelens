// npm run check:planner:live  (to be wired in package.json)
//
// Real provider validation. Refuses to run unless the server-side configuration
// is present. Never prints credentials. Reports success, rejection, failure and
// latency. Exits non-zero when the live validation cannot be completed.
//
// This script does NOT fake a live test: if credentials are missing it exits 1
// with a clear message and performs no provider request.

const env = process.env;
const key = (env.PLANNER_PROVIDER_KEY ?? "").trim();
const url = (env.PLANNER_PROVIDER_URL ?? "").trim() || "https://api.openai.com/v1/chat/completions";
const model = (env.PLANNER_MODEL ?? "").trim() || "gpt-4o-mini";

if (!key) {
  console.error("planner-live-check: BLOCKED — PLANNER_PROVIDER_KEY is not set.");
  console.error("Set PLANNER_PROVIDER_KEY (server-side only) and re-run. No provider request was made.");
  process.exit(1);
}

// Minimal smoke request through the handler, using a real fetch.
const { handlePlannerRequest } = await import("../server/planner/handler.js");
const { validRequest } = await import("../server/planner/testFixtures.mjs");

const request = validRequest();
const start = Date.now();
let result;
try {
  result = await handlePlannerRequest({
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost", host: "localhost" },
    body: JSON.stringify(request),
    env: { PLANNER_PROVIDER_KEY: key, PLANNER_PROVIDER_URL: url, PLANNER_MODEL: model },
    fetchImpl: globalThis.fetch,
    clientKey: "live-check",
  });
} catch (error) {
  console.error("planner-live-check: request threw:", error?.message ?? error);
  process.exit(1);
}
const latency = Date.now() - start;

console.log("planner-live-check");
console.log("  provider url:", url);
console.log("  model:", model);
console.log("  status:", result.status);
console.log("  latency ms:", latency);
if (result.status === 200) {
  console.log("  outcome: accepted");
  console.log("  primary:", result.body?.primary);
  process.exit(0);
}
console.log("  outcome: rejected/failed");
console.log("  error:", result.body?.error);
process.exit(1);
