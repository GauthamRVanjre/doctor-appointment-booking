# Milestone 2 — Murf Falcon

## Changes

- Kept the official SDK, tokens, lifecycle, STT and LLM. Replaced MiniMaxTTS with installed agora-agents 2.9.0 MurfTTS.
- Configured the official example: FALCON, Matthew, en-US, rate/pitch 0, 24000 Hz, wss://global.api.murf.ai/v1/speech/stream-input.
- Added server-only MURF_API_KEY placeholder to baseline/.env.local without replacing existing credentials; documented it in env.local.example and fork docs.
- Updated the configured pipeline label to Murf Falcon TTS.
- Added contract assertions for vendor/model/voice/sample rate, key handling, and missing-key rejection.
- Saved approved two-table direction and future Calendar/MCP deck pitch in FUTURE-SCOPE.md.

Official source verified 2026-11-20: https://docs.agora.io/en/ai/models/tts/murf. Inspected installed SDK types and serialization before editing; no dependency upgrade was needed.

## Runtime acceptance

Static verification: `pnpm run verify` passed in full (doctor, lint, typecheck, API contract checks, production build). The missing-key test intentionally logs a setup error while asserting rejection. No external provider calls are made by the contract tests.

Pending local Murf key. Fill MURF_API_KEY in baseline/.env.local; never send it in chat. Restart pnpm dev, start a new conversation, hear the greeting, speak a harmless test question, hear a relevant response, and check both transcript sides. Check provider errors if no audio. A configured UI badge, mocked contract test, build, or agent start response does not prove audible Murf output.

The original user/browser evidence showed baseline RTC connection and both transcript sides. Audible output was not independently confirmed. End Conversation bug was deliberately left unchanged after the user requested reverting fixes; it remains an accepted unresolved issue, not a verified pass.

## Scope boundary

No booking tools or schema implementation yet. The user approved two tables: slots/bookings, with doctor information in config and expiring conversation-bound approval in memory. Later restart invalidates pending approvals. No authentication, public deployment, new services, or tunnel added. Stop here before Milestone 3 until CONTINUE.
