# 08 Security

Fork update 2026-11-20: `MURF_API_KEY` is a required server-only provider credential. Never prefix it NEXT_PUBLIC, return it in API responses, print it, or place it in screenshots. Keep local `.env.local` excluded from source control. Contract checks use a fake key and assert it is not returned.

> Security model, trust boundaries, secret handling, and safety controls for this quickstart.

## Trust Boundaries

- Browser is untrusted and never receives `NEXT_AGORA_APP_CERTIFICATE`.
- Next.js server routes hold credentials and mint scoped, expiring tokens.
- Agora cloud executes managed agent pipeline using server-issued credentials.

## Secret Handling Rules

- Keep `NEXT_AGORA_APP_CERTIFICATE` server-side only.
- Do not expose BYOK provider API keys to client bundles.
- Store secrets in `.env.local` for dev and deployment secret store in Vercel.
- `env.local.example` documents expected keys without real values.

## Token Security Model

- Tokens expire (default 1 hour).
- Token endpoint allows caller-provided UID/channel but still uses server secret signing.
- Renewal flow requests new RTC/RTM tokens near expiry.
- RTM capability is required and intentionally embedded by `buildTokenWithRtm`.

## Input Validation and Failure Handling

- Route handlers validate required fields and env availability.
- Errors return structured JSON with bounded detail.
- Stop route treats already-stopping/not-found agent as idempotent success.

## Agent Behavior Safety

- Prompt includes explicit honesty and non-hallucination policy for product claims.
- Agent failure message is constrained (`Please wait a moment.`) for degraded-path behavior.

## Operational Security Practices

- Run `pnpm run verify` before release changes.
- Avoid logging secrets; current logs are operational and should remain non-secret.
- Use least-privilege project bindings when managing Agora environments.

## Known Limits

- This quickstart is a sample app; it does not implement user auth/tenant isolation.
- If productionizing, add authenticated route access and per-user authorization checks.

## Security Review Checklist

1. Confirm `NEXT_AGORA_APP_CERTIFICATE` is never referenced in client files.
2. Confirm token minting still uses server route only.
3. Confirm route error payloads do not leak secrets.
4. Confirm BYOK keys are optional and remain server-side.
5. Confirm docs do not instruct users to expose secrets in public config.

## Threat Notes for This Sample

- Token misuse risk is bounded by token expiry but still requires secure key custody.
- Public start/stop endpoints are unauthenticated in sample form; production needs auth.
- RTM message payloads are parsed defensively but should be treated as untrusted input.

## Hardening Steps for Productionization

- Add authenticated identity and authorization to all mutation routes.
- Scope agent start permissions per user/session ownership.
- Add rate limiting for token and invite endpoints.
- Add request tracing IDs for security incident investigation.
- Add environment-specific secret rotation policy and monitoring.

## Deployment Secret Checklist (Vercel)

- `NEXT_PUBLIC_AGORA_APP_ID` set for all required environments.
- `NEXT_AGORA_APP_CERTIFICATE` set as server-side secret only.
- Optional BYOK keys set only when related provider block is enabled.
- Preview environments use non-production credentials.

## Security-Relevant Files

- `app/api/generate-agora-token/route.ts`
- `app/api/invite-agent/route.ts`
- `app/api/stop-conversation/route.ts`
- `env.local.example`
- `README.md` environment section

## Audit Trigger Events

Re-audit security docs when any of these change:

- token issuance logic
- agent start/stop route authorization assumptions
- environment variable set or naming
- provider integration path (default vs BYOK)

## Related Deep Dives

- [conversation_lifecycle.md](L2/conversation_lifecycle.md) — Token issuance and renewal sequence details.
- [transcript_pipeline.md](L2/transcript_pipeline.md) — RTM event surfaces and error propagation boundaries.

## Milestone 3 approval and storage boundary

Booking writes fail closed without exact conversation/slot/alias approval. No LLM approved flag accepted. Approval capture is not yet connected; do not expose internal approve methods to model calls. Two-minute pending memory is process-local and restart-invalidated. Persist only fixed fictional alias, slot, hashed conversation/approval, retry hashes/key and booking metadata. Never store concern text/audio/transcript. SQLite uniqueness and BEGIN IMMEDIATE prevent duplicate reservations; exact retries survive restart. Spoken consent limitations and trust requirements: ../../booking-contract.md.

Emergency lookup with trusted conversation context clears approval and blocks further selection/booking until session teardown or service restart. Direct India emergency messaging uses 112 for ambulance assistance; keyword detection is not medical triage. Milestone 4 must supply context consistently and wire emergency turn handling. See ../../booking-contract.md.
