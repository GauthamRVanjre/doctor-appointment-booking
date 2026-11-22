# Milestone 4 implementation and runtime gate

Implemented locally on 2026-11-20. Live Agora tool execution and voice behavior
remain unverified until a tools-only HTTPS tunnel is authorized and tested.
No deployment or public exposure is implied by this implementation.

## Accepted approval tradeoff

The user explicitly approved on-screen authorization during this milestone.
Voice drives concern lookup, availability and selection. `bookAppointment`
requests review; it never authorizes a write. The assistant is instructed to
read a concise server readback containing doctor, clinic, date, time and timezone,
then ask for on-screen confirmation once. Duration, demo alias, UTC offset and
reference are not read aloud. The patient reviews the full details on screen
and clicks **I approve — save booking**. This click is the approval authority.
Spoken yes alone does not save. We do not claim to verify that the whole readback
was heard or played without interruption. Any newly observed user speech,
another lookup/availability request, attempted selection change or expiry clears
pending approval. Even an invalid attempted change requires fresh review.

Only a browser request carrying the session's HttpOnly SameSite=Strict cookie
can confirm its pending random reference. It cannot supply slot details,
conversation identity, alias, approval flags or idempotency key. The server
creates those values and executes the existing approval and transaction seams.
No approve tool is registered. The tool schema contains no approval credential.

## Execution and identity

`lib/booking/voice-session.ts` owns a process-local server-created conversation
UUID, separate random browser/tool capabilities, the trusted AgentSession,
pending selection and committed result. The browser receives only the HttpOnly
cookie. Agora receives the tool capability in server-configured Authorization
headers, outside the function schema. Model arguments cannot override it.
These capabilities isolate local demo sessions; they are not patient identity
or authentication. The existing token endpoint still accepts UID/channel for
the starter RTC flow; those client fields do not authorize booking.

Managed tools are `findDoctors`, `getAvailableSlots`, `bookAppointment`, mapping
to the internal snake_case service. Availability fields used in templates are
all required: empty strings mean the default date window or any time. Missing
template variables cause Agora to fail before sending a request. Unknown service
fields remain rejected. A booking-tool call first prepares review and returns
ON_SCREEN_APPROVAL_REQUIRED; an exact call matching an already saved booking
returns that committed result. The actual insert happens through the confirmation
route. Each prepared selection has a server-generated retry key. HTTP confirmation
retries return the same committed result during the live process/session.

Every tool, state refresh and confirmation reads history from the server-held
Agora AgentSession, verifies the returned agent ID, and checks observed user
turns for emergency keywords. Client transcripts and arbitrary webhook bodies
are never approval/emergency evidence. History failure or identity mismatch
blocks approval. The browser polls state every two seconds; requests serialize
per session, and Agora history/speech waits are bounded to four seconds.

On emergency, the existing service latches the trusted conversation, clears
approval and blocks further selection/booking. The UI displays the redirection
and the server attempts to speak it. Existing saved bookings remain saved.
History delivery/transcription can lag or omit words, and polling stops if the
page is suspended. This is not immediate audio-level emergency detection or
medical triage. A not-yet-observed utterance can race a confirmation click.
The assistant prompt also redirects emergencies; actual spoken handling requires
live testing. The keyword detector is conservative, not comprehensive.

Confirmation returns success only after the existing SQLite COMMIT. The server
then requests uninterruptible confirmation speech using `session.say`. The
confirmation text includes the saved status, doctor, date and time in India time.
The saved reference remains on the card and is not read aloud. If speech delivery
fails, the card still shows the real saved booking with a warning.
A successful speak request does not prove audible delivery. This server-issued
message does not guarantee the model remembers the UI action; a subsequent
matching book tool request retrieves the saved result.

## Cleanup and limits

End Conversation revokes booking authority before the existing starter cloud/
media teardown. The stop route also revokes a matching cookie-owned session.
`pagehide` attempts a keepalive revocation. Expiry/restart also invalidate pending
authority; dead network/pagehide delivery is not guaranteed. Sessions expire
after one hour and are pruned on subsequent requests. Ending removes the tool
capability so late calls cannot reopen emergency/approval state.
No previously reverted RTC/layout shutdown fixes were restored. Reliable end-to-end
media teardown remains a runtime verification item. A refresh may invalidate
pending review without proving the cloud agent stopped.

SQLite schema and durability are unchanged. Process restart keeps saved database
rows but loses session capabilities, cached cards and pending state. The core
service's exact retry guarantees remain unchanged; browser recovery after restart
is not implemented. Use one Node process with persistent local disk. No serverless
deployment, authentication system, calendar or new database table was added.

## Concrete public-access plan — requires authorization

1. Run the Next app locally on port 3000.
2. Run `pnpm run booking:gateway`, listening only on 127.0.0.1:3001.
3. With explicit authorization, install/use Cloudflare's `cloudflared` and open
   a temporary HTTPS tunnel to **port 3001 only**. No tunnel tool was detected
   on PATH during inspection. Do not tunnel port 3000.
4. The gateway forwards only POST `/api/booking/tools`, with a size limit,
   bounded timeout and Authorization header. Everything else returns 404.
   Next.js validates that bearer capability against its live server session.
   The tunnel provider handles the HTTPS traffic, including fictional tool inputs
   and outputs. No real patient data should be used in this demo.
5. Set server-only `BOOKING_TOOLS_BASE_URL` to that HTTPS origin in `.env.local`
   and restart the app. Never put credentials in URLs or browser code.
6. Start a fresh voice session, test it, then stop the temporary tunnel after
   the demo. No tunnel is started by `dev`, `verify` or `booking:gateway`.

Missing BOOKING_TOOLS_BASE_URL rejects agent startup explicitly. No silent
conversation-only fallback is provided. The app's UI, token minting, invite,
stop, confirmation and optional LLM routes are not forwarded by the gateway.

## Verification and next live test

Current results: full `pnpm run verify` passed (doctor, lint, TypeScript, API
contracts, booking verification, voice-boundary verification, production build).
The unchanged command ran outside the sandbox after its CSS-worker restriction.
Separate `node scripts/verify-gateway.mjs` local HTTP checks passed outside the
sandbox: blocked private routes, altered paths, wrong methods, missing auth,
oversize bodies, and preserved application authorization failures. No public
tunnel was opened for these checks. Expected SQLite experimental and deliberate
missing-Murf-key logs appeared during the corresponding passing checks.

`verify:voice` uses a disposable in-memory database and mocked authenticated
history/speech. It checks session separation, route authorization, unknown approval
fields/tools, unavailable Wednesday alternatives, exact review, speech invalidation,
expiry, commit-before-speech, retry identity, booked-slot exclusion, emergency
invalidation, teardown and history failure. `verify:booking` retains transaction,
persistence and cross-process race checks. These do not verify real Agora calls.

After tunnel authorization, use the actual seven-day Asia/Kolkata window. On
2026-11-20 the Wednesday is 2026-11-25, with alternatives drawn from actual
server availability. Ask for Wednesday at 18:00, select an actual alternative,
hear exact readback, confirm on screen, hear saved confirmation, inspect the card
and recheck availability. Also exercise a changed slot, an emergency after
selection, a tool/network failure and End Conversation. Record current user
voice evidence; compilation and mocks do not prove voice works.

## Official sources checked

- [Managed tools](https://docs.agora.io/en/ai/build/tools/custom-tools): synchronous
  HTTPS requests, header authentication, naming and template constraints.
- [History API](https://docs.agora.io/en/api-reference/api-ref/conversational-ai/history):
  running-session stored messages; speech timing is custom-LLM-only and does not
  distinguish completed from interrupted playback by itself.
- [Turns API](https://docs.agora.io/en/api-reference/api-ref/conversational-ai/turns):
  documented for post-conversation analytics, not used as a live approval gate.
- Installed `agora-agents` 2.9.0 declarations and implementation:
  LlmTool/LlmToolServer, OpenAI/BaseLlmOptions, AgentSession.getHistory/say.

Original starter/Murf implementation and MIT notices remain intact.
