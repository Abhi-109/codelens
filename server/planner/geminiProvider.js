// Gemini (Google AI Studio) adapter for the Interactions API.
//
// https://generativelanguage.googleapis.com/v1beta/interactions
// Auth: x-goog-api-key. Request: { model, input, system_instruction? }.
// Response: { output_text? } or { outputs: [{ type, text }] }.

import { PlannerError, plannerError } from "./errors.js";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function extractText(body) {
  if (!isObject(body)) return null;
  if (typeof body.output_text === "string") return body.output_text;
  if (Array.isArray(body.outputs)) {
    for (const output of body.outputs) {
      if (isObject(output) && typeof output.text === "string") return output.text;
    }
  }
  if (typeof body.text === "string") return body.text;
  return null;
}

export function createGeminiProvider(options = {}) {
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

    const endpoint = url || "https://generativelanguage.googleapis.com/v1beta/interactions";

    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          model,
          input: messages?.user ?? "",
          system_instruction: messages?.system ?? "",
          generation_config: { temperature: 0, response_mime_type: "application/json" },
          store: false,
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
      const content = extractText(body);
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

  const resolvedUrl = url || "https://generativelanguage.googleapis.com/v1beta/interactions";
  return { configured, url: resolvedUrl, model, complete };
}
