# Final demo and deck notes

Theme: **From Conversations to Autonomous Action.**

Presentation notes. This is a deck source, not a claim that every planned
feature is implemented. Last updated: 2026-11-20.

## Technical decision: SQLite and reliable booking

### Slide-ready point

**SQLite keeps the solo prototype simple while making its saved outcome verifiable.**
It runs inside the application and persists bookings to a local file, without
a separate database service or ORM. Avoiding a network hop is useful, but the
primary reason is low setup and operational effort for a two-day local demo.

Two tables are sufficient: server-generated slots and saved bookings. The fictional
doctor, services and working hours live in configuration. A slot is available
when no booking references it, avoiding a separate availability flag that could
drift out of sync.

### Speaker notes: correctness decisions

- **Atomic reservation:** BEGIN IMMEDIATE puts retry lookup, slot checks,
  approval validation and insertion inside one transaction. Commit must succeed
  before the service returns success.
- **Same-slot competition:** one writer obtains SQLite's lock first; the other
  waits and then checks the updated state. UNIQUE(slot_id) is the database's final
  protection against double booking. Different slots can both be booked.
- **Retry protection:** an exact retry with the same idempotency key returns the
  original saved booking. A request fingerprint rejects changed details under
  an existing key. This protects against duplicate requests, separately from
  protecting a slot against competing patients.
- **Rollback:** an insert failure rolls back the transaction and returns a
  structured failure. The service never reports a booking it could not commit.
- **Approval boundary:** a short-lived random reference binds approval to the
  conversation, slot and fictional alias. Changed details invalidate prior
  approval. An LLM-supplied approved=true is insufficient.
- **Minimal persistence:** fixed fictional alias and booking metadata only;
  no symptoms, transcripts or audio are stored by the booking database.

### Evidence available after Milestone 3

Automated verification passed for directory matching/no match, obvious-emergency
redirection, schedule/timezone rules, booked-slot exclusion, approval binding,
selection changes and expiry, persistence after reopening SQLite, exact retries,
conflicting-key rejection and rollback after an injected insert failure.

A two-process test prepared competing bookings for the same slot and released
both to attempt reservation. Exactly one succeeded, one returned SLOT_UNAVAILABLE,
and exactly one booking row was saved. This is database coordination evidence,
not a voice-flow test or a load-test claim.

### Limits to acknowledge

SQLite serializes writes. This is a small local demo with persistent disk, not
a stateless/serverless deployment design. Node's built-in SQLite is experimental
in the verified Node 24.10 runtime. Pending approval is process-local memory,
expires after two minutes and is lost on restart; saved bookings survive.

Milestone 4 must still establish trusted conversation identity, completed exact
readback and explicit approval capture. Spoken approval is not proof of speaker
identity or legal consent; transcription and turn timing can be wrong.

## Remaining delivery milestones

### Milestone 4: voice-to-action

Connect the supported tool execution path to Agora, establish trustworthy session
identity and approval capture, replace the starter persona with scheduling behavior,
and add a server-confirmed booking card. Say success only after persistence.
Verify unavailable-time recovery, tool failures and the full spoken flow.
Managed HTTPS tools require cloud-reachable routes: explain and authorize tunnel
exposure before setting it up. No tunnel is currently configured.

### Milestone 5: demo readiness

Agree visual direction before UI implementation, then polish the UI, finalize
README/attribution and the two-minute script, and run final verification.
Commit/push, merge to main and deployment require the user's authorization.

## Target demo sequence (planned; not yet end-to-end verified)

1. Start the voice session and ask for Wednesday at 6 p.m.
2. Explain that Wednesday is unavailable and offer real server-returned slots.
3. Select an alternative.
4. Read back exact doctor, clinic, date, time and Asia/Kolkata timezone.
5. Ask for explicit approval; save only after valid approval.
6. Commit the booking, then speak confirmation and display the server-confirmed card.
7. Recheck availability and show that the booked slot no longer appears.

Use current dates within the actual seven-day window when rehearsing. The
Wednesday recovery scenario needs a bookable alternative in that window.

## Emergency fallback / stop

For obvious severe danger, stop routine scheduling and direct the patient to call 112 in India and request an ambulance for emergency care (local emergency number elsewhere). Do not diagnose or recommend waiting for an appointment. Trusted conversation context clears pending approval and blocks further booking in that session; no saved booking is deleted. This is emergency redirection, distinct from database rollback. Keyword checks and server guards are tested; spoken enforcement remains Milestone 4. Official reference: https://www.mha.gov.in/emergency-response-support-system-erss .
