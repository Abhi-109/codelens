// Vercel Node function adapter for POST /api/plan.
//
// Vercel checks the filesystem (static files and functions) before applying the
// catch-all rewrite in vercel.json, so this route wins over /index.html. The
// adapter only translates the platform's request/response into the pure handler;
// every security decision lives in server/planner/handler.js.

import { handlePlannerRequest } from "../server/planner/handler.js";

function clientKeyOf(req) {
  const forwarded = req?.headers?.["x-forwarded-for"];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (typeof first === "string" && first.trim()) return first.split(",")[0].trim();
  const remote = req?.socket?.remoteAddress;
  return typeof remote === "string" && remote ? remote : "unknown";
}

function bodyOf(req) {
  const body = req?.body;
  if (typeof body === "string") return body;
  if (body === undefined || body === null) return "";
  try {
    return JSON.stringify(body);
  } catch {
    return "";
  }
}

/**
 * Build the handler with injectable environment and fetch, so the route can be
 * tested without a live provider.
 */
export function createVercelHandler({ env = process.env, fetchImpl } = {}) {
  return async function handler(req, res) {
    let result;
    try {
      result = await handlePlannerRequest({
        method: req?.method,
        headers: req?.headers ?? {},
        body: bodyOf(req),
        env,
        fetchImpl,
        clientKey: clientKeyOf(req),
      });
    } catch {
      // Never surface an internal failure. Nothing is logged here on purpose:
      // the request may contain user source.
      result = {
        status: 500,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
        body: { error: { code: "http_error" } },
      };
    }
    res.statusCode = result.status;
    for (const [key, value] of Object.entries(result.headers)) res.setHeader(key, value);
    res.end(JSON.stringify(result.body));
  };
}

export default createVercelHandler();
