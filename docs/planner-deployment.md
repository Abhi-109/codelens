# Planner deployment and operations

## Server environment variables (server-only)

Set these in Vercel Project Settings → Environment Variables for Production and
Preview. Never prefix with `VITE_`.

- `PLANNER_PROVIDER_KEY` — provider API key. Required for AI planning.
- `PLANNER_PROVIDER_URL` — chat completions endpoint (default OpenAI).
- `PLANNER_MODEL` — model identifier (default `gpt-4o-mini`).

## Frontend environment variable (public)

- `VITE_PLANNER_ENDPOINT` — same-origin route the browser calls, e.g. `/api/plan`.
  Safe to commit as a URL. Leave unset when AI is not deployed.

## Local development

Copy `.env.example` to `.env.local`. Use `CODELENS_PLANNER_DEV_MOCK=1` to mount a
mock `/api/plan` in the Vite dev server without a key.

## Deploy

1. Push to the intended branch.
2. Vercel builds the frontend and deploys `api/plan.js` as a Node function.
3. Set server env vars for Production and Preview separately.
4. Verify `/api/plan` responds (405 for GET, 503 when unconfigured).

## Health check

- `GET /api/plan` → 405 `rejected` method.
- `POST /api/plan` with no key configured → 503 `not_configured`.
- With a key, a valid request returns 200 with `{ primary, emphasis, explanation }`.

## Beam / OpenCode provider note

The only "Beam" model available in this environment is `opencode/beam-free` (OpenCode
platform, model ID `opencode/beam-free`). It is **not** an OpenAI-compatible HTTP
endpoint that the Vercel server route can call with a Bearer token: the route in
`api/plan.js` speaks `/v1/chat/completions` with `authorization: Bearer <key>`.
OmniRoute (the local gateway) exposes an OpenAI-compatible surface, but its
OpenCode credentials are currently exhausted ("No active credentials for
provider: opencode"), so it cannot serve Beam today.

Therefore, for a Beam-backed deployment you need one of:

1. An OpenCode API key / endpoint that exposes an OpenAI-compatible
   `/v1/chat/completions` route for `opencode/beam-free`, or
2. An alternative OpenAI-compatible provider (e.g. OpenAI `gpt-4o-mini`) with a
   valid API key, used as the configured provider.

Do not silently substitute a different model. Record the exact identifier used.

## Setup checklist (external)

- [ ] Obtain a provider API key for an OpenAI-compatible chat completions endpoint.
- [ ] Set `PLANNER_PROVIDER_KEY` (server-only) in Vercel Production and Preview.
- [ ] Set `PLANNER_PROVIDER_URL` if not the OpenAI default.
- [ ] Set `PLANNER_MODEL` to the exact model identifier.
- [ ] Set `VITE_PLANNER_ENDPOINT=/api/plan` for the frontend.
- [ ] Deploy to preview first.
- [ ] Run `npm run check:planner:live` with the key in the environment.
- [ ] Confirm 200 responses, accepted plans and latency.
- [ ] Run the 122-case live evaluation if budget permits.
- [ ] Promote to production only after preview validation.

## Real provider validation

Run `npm run check:planner:live` with `PLANNER_PROVIDER_KEY` set. The script
refuses to run (exit 1) when the key is missing and makes no provider request.
It never prints the key. It reports status, latency and outcome.

## Key rotation

1. Create a new key at the provider.
2. Update `PLANNER_PROVIDER_KEY` in Vercel for Production and Preview.
3. Redeploy (or wait for next deploy). Old key can be revoked after verification.

## Disabling AI

Unset `PLANNER_PROVIDER_KEY`. The route returns 503 `not_configured`; the browser
falls back to the deterministic planner. Visualization still works.

## Security notes

Origin checks and in-memory rate limiting are abuse mitigations, not user
authentication or globally coordinated rate limiting. They reduce casual abuse
but do not authenticate users or coordinate across instances.

No secret may use a `VITE_` prefix. `.env*` is git-ignored except `.env.example`.
`PLANNER_PROVIDER_KEY`, `PLANNER_PROVIDER_URL` and `PLANNER_MODEL` are server-only.
