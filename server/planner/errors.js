// The server side of the planner: a same-origin route that holds the provider
// credential, validates the browser's request against the same plan schema the
// client uses, and returns one classified answer or a classified refusal.
//
// Nothing here trusts the browser. The browser supplies evidence summaries and
// a public endpoint URL; it never supplies a key, an upstream URL or a plan that
// skips validation.

export const PLANNER_ERROR_CODES = Object.freeze([
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

export class PlannerError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "PlannerError";
    this.code = PLANNER_ERROR_CODES.includes(code) ? code : "network";
  }
}

export function plannerError(code, message) {
  return new PlannerError(code, message);
}
