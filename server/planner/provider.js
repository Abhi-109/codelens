// One provider call, one fixed upstream URL, one bounded answer.
//
// The URL and the key come from server configuration only. This module never
// reads a request header, a query string or a body field to decide where to
// send data, so the route cannot be turned into a proxy.

import { PlannerError, plannerError } from "./errors.js";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {{url: string, apiKey: string, model: string, timeoutMs?: number, maxBytes?: number, fetchImpl?: Function}} options
 */
export function createChatProvider(options = {}) {
  const { url, apiKey, model } = options;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 6000;
  const maxBytes = Number.isFinite(options.maxBytes) ? options.maxBytes : 16384;
  const configured = Boolean(url && apiKey && typeof fetchImpl === "function");

  async function complete(messages, { signal } = {}) {
    if (!configured) throw plannerError("not_configured");
    if (signal?.aborted) throw plannerError("cancelled");

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener?.("abort", onAbort, { once: true });

    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: 200,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: messages.system },
            { role: "user", content: messages.user },
          ],
        }),
        signal: controller.signal,
      });
      if (response?.status === 429) throw plannerError("rate_limited");
      if (!response?.ok) throw plannerError("http_error");
      const declared = Number(response.headers?.get?.("content-length"));
      if (Number.isFinite(declared) && declared > maxBytes) throw plannerError("oversized");
      const text = await response.text();
      if (typeof text !== "string" || text.length > maxBytes) throw plannerError("oversized");
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        throw plannerError("invalid_json");
      }
      const content = isObject(body) ? body.choices?.[0]?.message?.content : null;
      if (typeof content !== "string" || content.length > maxBytes) throw plannerError("invalid_json");
      try {
        return JSON.parse(content);
      } catch {
        throw plannerError("invalid_json");
      }
    } catch (error) {
      if (error instanceof PlannerError) throw error;
      if (signal?.aborted) throw plannerError("cancelled");
      if (timedOut || error?.name === "AbortError") throw plannerError("timeout");
      throw plannerError("network");
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
    }
  }

  return { configured, url, model, complete };
}
