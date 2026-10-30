// Server-only configuration. The provider key lives here and nowhere else: it is
// read from the server environment, never bundled, never returned and never
// accepted from a request.

export const DEFAULT_PROVIDER_URL = "https://api.openai.com/v1/chat/completions";
export const DEFAULT_MODEL = "gpt-4o-mini";

/** Every bound the route enforces, in one place so tests can reason about it. */
export const PLANNER_LIMITS = Object.freeze({
  requestBytes: 32768,
  sourceBytes: 8000,
  concepts: 24,
  evidence: 3,
  renderers: 8,
  responseBytes: 16384,
  providerTimeoutMs: 6000,
  rateWindowMs: 60000,
  rateMax: 10,
  rateKeys: 500,
});

/**
 * Read the server configuration.
 *
 * @param {Record<string, string|undefined>} env
 * @returns {{configured: boolean, url: string, model: string, apiKey: string}}
 */
export function readPlannerConfig(env = {}) {
  const apiKey = typeof env.PLANNER_PROVIDER_KEY === "string" ? env.PLANNER_PROVIDER_KEY.trim() : "";
  const configuredUrl =
    typeof env.PLANNER_PROVIDER_URL === "string" && env.PLANNER_PROVIDER_URL.trim()
      ? env.PLANNER_PROVIDER_URL.trim()
      : DEFAULT_PROVIDER_URL;
  const model =
    typeof env.PLANNER_MODEL === "string" && env.PLANNER_MODEL.trim()
      ? env.PLANNER_MODEL.trim()
      : DEFAULT_MODEL;
  const provider =
    typeof env.PLANNER_PROVIDER === "string" && env.PLANNER_PROVIDER.trim()
      ? env.PLANNER_PROVIDER.trim().toLowerCase()
      : configuredUrl.includes("generativelanguage.googleapis.com")
        ? "gemini"
        : "openai";
  return { configured: apiKey.length > 0, url: configuredUrl, model, apiKey, provider };
}
