// Shared fixtures for the server boundary tests. Every value here is synthetic:
// no provider key, no user source and no network.

import { getRenderer, rendererIds } from "../../src/planner/renderers.js";

export const TEST_ENV = Object.freeze({
  PLANNER_PROVIDER_KEY: "test-key-not-a-secret",
  PLANNER_PROVIDER_URL: "https://provider.invalid/v1/chat/completions",
  PLANNER_MODEL: "test-model",
});

export const CONCEPTS = Object.freeze([
  Object.freeze({ id: "scalars", strength: "observed", evidence: ["trace.lines"] }),
]);

export const TRACE = Object.freeze({
  events: 12,
  calls: 1,
  returns: 1,
  comparisons: 0,
  exceptions: 0,
  outputs: 1,
  maxDepth: 1,
  recursive: false,
  hasFrames: true,
  termination: "completed",
});

export function renderers() {
  return rendererIds().map((id) => {
    const renderer = getRenderer(id);
    return {
      id,
      purpose: renderer.purpose,
      concepts: [...renderer.concepts],
      requiredEvidence: [...renderer.requiredEvidence],
    };
  });
}

/** The documented v1 request, as the browser builds it. */
export function validRequest(overrides = {}) {
  return {
    request_version: 1,
    task: "choose_visualization",
    source: "x = 1\nprint(x)\n",
    source_truncated: false,
    concepts: CONCEPTS.map((concept) => ({ ...concept, evidence: [...concept.evidence] })),
    trace: { ...TRACE },
    renderers: renderers(),
    deterministic: { primary: "motion", reasons: ["generic_values"] },
    has_flow: true,
    ...overrides,
  };
}

/** A provider answer, wrapped the way a chat-completions API returns it. */
export function chatResponse(content, { status = 200, declaredLength = null } = {}) {
  const text = JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] });
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name === "content-length" ? declaredLength : null) },
    text: async () => text,
  };
}

/** A fetch stub that records what it was asked to do. */
export function recordingFetch(answer = chatResponse({ primary: "motion" })) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return typeof answer === "function" ? answer(url, options) : answer;
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

/** A JSON POST to the handler with a valid body. */
export function postRequest(body, headers = {}) {
  return {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
}
