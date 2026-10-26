// The optional AI boundary. It speaks one small JSON request over a same-origin
// endpoint and returns one parsed object; it knows nothing about React, the
// trace or the cursor. Every failure is classified, so the caller can keep the
// deterministic plan without guessing what went wrong.
//
// There is deliberately no API key here: a static client bundle cannot keep a
// secret. The endpoint is expected to hold the credential server-side.

export const AI_REQUEST_VERSION = 1;

export const AI_ERROR_CODES = Object.freeze([
  "not_configured",
  "cancelled",
  "timeout",
  "network",
  "rate_limited",
  "http_error",
  "oversized",
  "invalid_json",
  "invalid_schema",
  "rejected",
]);

export class PlannerProviderError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "PlannerProviderError";
    this.code = AI_ERROR_CODES.includes(code) ? code : "network";
  }
}

/** The configured same-origin endpoint, or null. Never reads a secret. */
export function plannerEndpoint(scope = globalThis) {
  const injected = scope?.__CODELENS_PLANNER_ENDPOINT__;
  if (typeof injected === "string" && injected.trim()) return injected.trim();
  const fromEnv = import.meta.env?.VITE_PLANNER_ENDPOINT;
  return typeof fromEnv === "string" && fromEnv.trim() ? fromEnv.trim() : null;
}

/**
 * Create a provider. `fetchImpl` is injectable so tests never touch the network.
 *
 * @param {{endpoint?: string|null, fetchImpl?: Function, timeoutMs?: number, maxBytes?: number}} options
 */
export function createAiProvider(options = {}) {
  const endpoint = options.endpoint === undefined ? plannerEndpoint() : options.endpoint;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 4000;
  const maxBytes = Number.isFinite(options.maxBytes) ? options.maxBytes : 8192;

  const configured = Boolean(endpoint && typeof fetchImpl === "function");

  // A server that classifies its own refusal is more useful than a bare status
  // code. Only the documented code is read; the rest of the body is dropped.
  async function serverCode(response) {
    try {
      const text = await response.text();
      if (typeof text !== "string" || text.length > maxBytes) return null;
      const code = JSON.parse(text)?.error?.code;
      return AI_ERROR_CODES.includes(code) ? code : null;
    } catch {
      return null;
    }
  }

  async function request(payload, { signal } = {}) {
    if (!configured) throw new PlannerProviderError("not_configured");
    if (signal?.aborted) throw new PlannerProviderError("cancelled");

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener?.("abort", onAbort, { once: true });

    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (response?.status === 429) throw new PlannerProviderError("rate_limited");
      if (!response?.ok) {
        throw new PlannerProviderError((await serverCode(response)) ?? "http_error", `HTTP ${response?.status}`);
      }
      const declared = Number(response.headers?.get?.("content-length"));
      if (Number.isFinite(declared) && declared > maxBytes) {
        throw new PlannerProviderError("oversized");
      }
      const text = await response.text();
      if (typeof text !== "string" || text.length > maxBytes) {
        throw new PlannerProviderError("oversized");
      }
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new PlannerProviderError("invalid_json");
      }
      return parsed;
    } catch (error) {
      if (error instanceof PlannerProviderError) throw error;
      if (signal?.aborted) throw new PlannerProviderError("cancelled");
      if (timedOut || error?.name === "AbortError") throw new PlannerProviderError("timeout");
      throw new PlannerProviderError("network", error?.message ?? "network");
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
    }
  }

  return { configured, endpoint, request };
}
