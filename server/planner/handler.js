// POST /api/plan — the whole server boundary in one pure function.
//
// It takes plain values (method, headers, body, env, fetch) and returns
// { status, headers, body }, so the Vercel adapter, the Vite dev adapter and the
// unit tests all exercise the same code. No framework, no dependency, no log of
// user source, no key in a response.

import { aiPlanFromResponse } from "../../src/planner/aiPlanner.js";
import { readPlannerConfig, PLANNER_LIMITS } from "./config.js";
import { PlannerError } from "./errors.js";
import { buildPrompt } from "./prompt.js";
import { createChatProvider } from "./provider.js";
import { createRateLimiter } from "./rateLimit.js";
import { validatePlannerRequest } from "./request.js";

const JSON_HEADERS = Object.freeze({
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
});

const sharedLimiter = createRateLimiter({
  windowMs: PLANNER_LIMITS.rateWindowMs,
  max: PLANNER_LIMITS.rateMax,
  keys: PLANNER_LIMITS.rateKeys,
});

const PROVIDER_STATUS = Object.freeze({
  not_configured: 503,
  cancelled: 408,
  timeout: 504,
  network: 502,
  rate_limited: 429,
  http_error: 502,
  oversized: 502,
  invalid_json: 502,
  invalid_schema: 502,
  rejected: 502,
});

function header(headers, name) {
  if (!headers) return undefined;
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) {
      return Array.isArray(value) ? value[0] : value;
    }
  }
  return undefined;
}

function byteLength(text) {
  return new TextEncoder().encode(text).length;
}

function reply(status, payload, extra = {}) {
  return { status, headers: { ...JSON_HEADERS, ...extra }, body: payload };
}

function refuse(status, code, detail, extra = {}) {
  return reply(status, detail ? { error: { code, detail } } : { error: { code } }, extra);
}

/** Same-origin only: a browser on another site may not spend this endpoint. */
function originAllowed(origin, host) {
  if (origin === "null") return false;
  if (!origin) return true;
  if (!host) return true;
  try {
    const parsed = new URL(origin);
    return parsed.host === host;
  } catch {
    return false;
  }
}

/**
 * @param {{
 *   method?: string,
 *   headers?: Record<string, string|string[]|undefined>,
 *   body?: string,
 *   env?: Record<string, string|undefined>,
 *   fetchImpl?: Function,
 *   now?: number,
 *   clientKey?: string,
 *   limiter?: ReturnType<typeof createRateLimiter>,
 * }} input
 * @returns {Promise<{status: number, headers: Record<string,string>, body: object}>}
 */
export async function handlePlannerRequest(input = {}) {
  const {
    method = "GET",
    headers = {},
    body = "",
    env = {},
    fetchImpl,
    now = Date.now(),
    clientKey = "unknown",
    limiter = sharedLimiter,
    limits = PLANNER_LIMITS,
  } = input;

  if (String(method).toUpperCase() !== "POST") {
    return refuse(405, "rejected", "method", { allow: "POST" });
  }
  if (!originAllowed(header(headers, "origin"), header(headers, "host"))) {
    return refuse(403, "rejected", "origin");
  }
  const contentType = String(header(headers, "content-type") ?? "");
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return refuse(415, "rejected", "content_type");
  }
  const text = typeof body === "string" ? body : "";
  const declared = Number(header(headers, "content-length"));
  if (Number.isFinite(declared) && declared > limits.requestBytes) {
    return refuse(413, "oversized", "request");
  }
  if (byteLength(text) > limits.requestBytes) {
    return refuse(413, "oversized", "request");
  }

  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return refuse(400, "invalid_json", "request");
  }

  const validated = validatePlannerRequest(raw, { limits });
  if (!validated.ok) {
    return refuse(400, validated.error.code, validated.error.detail);
  }
  const request = validated.request;

  const config = readPlannerConfig(env);
  if (!config.configured) return refuse(503, "not_configured", "provider");

  const limited = limiter.take(clientKey, now);
  if (!limited.ok) {
    return refuse(429, "rate_limited", "client", { "retry-after": String(limited.retryAfter) });
  }

  const provider = createChatProvider({
    url: config.url,
    apiKey: config.apiKey,
    model: config.model,
    timeoutMs: limits.providerTimeoutMs,
    maxBytes: limits.responseBytes,
    fetchImpl,
  });

  let answer;
  try {
    answer = await provider.complete(buildPrompt(request));
  } catch (error) {
    const code = error instanceof PlannerError ? error.code : "network";
    return refuse(PROVIDER_STATUS[code] ?? 502, code, "provider");
  }

  const result = aiPlanFromResponse(answer, {
    analysis: { concepts: request.concepts, trace: request.trace },
    deterministic: {
      primary: request.deterministic.primary,
      reasons: request.deterministic.reasons.map((code) => ({ code })),
      concepts: request.concepts,
    },
    hasFlow: request.has_flow,
  });
  if (!result.plan) {
    const code = result.error?.code === "invalid_schema" ? "invalid_schema" : "rejected";
    return refuse(502, code, result.error?.detail ?? "plan");
  }

  // The response is the model's selection, not a materialised plan: concepts
  // appear only when the model picked them, so the client re-validates the same
  // small answer it would have received from the provider directly.
  const payload = {
    primary: result.plan.primary,
    emphasis: result.plan.emphasis,
    explanation: result.plan.explanation,
  };
  if (Array.isArray(answer?.concepts)) {
    payload.concepts = result.plan.concepts.map((concept) => concept.id);
  }
  return reply(200, payload);
}
