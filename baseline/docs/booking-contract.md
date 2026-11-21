Milestone 4 extension: [voice-to-action.md](voice-to-action.md) specifies the implemented HTTP/Agora boundary. Schema and service contracts below are unchanged. User-approved on-screen confirmation is the authorization authority, not model flags or spoken yes. prepare_selection/approve remain internal trusted seams; bookAppointment only requests review until an on-screen commit has occurred. Live tool/voice verification requires an authorized tools-only HTTPS tunnel.

# Milestone 3: local booking contract

Agreed two-table design, specified before implementation (2026-11-20).
Server-only TypeScript tools; no HTTP exposure or Agora wiring in this milestone.

## Exact schema

```sql
CREATE TABLE slots (
  id TEXT PRIMARY KEY,
  doctor_id TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  timezone TEXT NOT NULL CHECK(timezone = 'Asia/Kolkata'),
  UNIQUE(doctor_id, starts_at),
  CHECK(ends_at > starts_at)
) STRICT;
CREATE TABLE bookings (
  id TEXT PRIMARY KEY,
  slot_id TEXT NOT NULL UNIQUE REFERENCES slots(id),
  demo_alias TEXT NOT NULL CHECK(demo_alias IN ('Demo Patient', 'Demo Guest')),
  conversation_hash TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  approval_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
```

UTC ISO timestamps; timezone is returned explicitly. Doctor, clinic, service keywords,
working weekdays (Mon/Tue/Thu/Fri), hours (17:00–20:00), duration (30 minutes)
live in configuration. No symptoms, transcripts, audio, or real patient identity
are saved. Conversation and approval references are stored only as SHA-256 hashes.
Slot availability is derived by excluding booked slots, with UNIQUE(slot_id) as
the final concurrency guard. No mutable reserved flag or third table.

Node 24.10+ local process, built-in node:sqlite, parameterized queries, foreign
keys, WAL, busy timeout. Default file: baseline/data/clinic.sqlite (ignored).
The database opens lazily when the service is instantiated. No ORM or new package.

## Tools

All tools accept unknown input and return {ok:true,...} or
{ok:false,code,message}; validation rejects unknown fields (including approved).
Exceptions at the database boundary become STORAGE_FAILURE without internal details.

- find_doctors({concern}): bounded text, configured name or service-keyword lookup;
  NO_MATCH for unsupported requests, EMERGENCY_REDIRECTION for obvious emergency
  phrases. Matching is scheduling assistance, never diagnosis or medical advice.
- get_available_slots({doctor_id,start_date?,end_date?,preferred_time?}): dates
  YYYY-MM-DD, inclusive, within today through today+6 in Asia/Kolkata; optional
  exact HH:mm preference. Closed days/time preferences return an empty list with
  reason and actual alternatives from the requested date range, or from the full
  seven-day window when that range has none. Alternatives are explicitly separate
  from matches, and can fall outside requested preferences. Past starts excluded.
- book_appointment({doctor_id,slot_id,demo_alias,idempotency_key,approval_reference},
  trustedConversationId): only a generated, currently valid, unbooked slot. The
  conversation is supplied by trusted server context, never tool arguments.

Idempotency keys are globally unique opaque tokens, 8–128 characters. The request
hash binds doctor, slot, alias, conversation hash and approval hash. Exact retry
returns the existing saved booking even after restart/expiry; changed reuse is
IDEMPOTENCY_CONFLICT. Replays still require the same conversation and reference.
BEGIN IMMEDIATE wraps retry lookup, slot/approval checks, insert and commit.
Success is returned only after commit. A failed insert rolls back everything.

## Pending approval boundary

A small server-only approval store prepares exact readback from a server slot
and alias, replacing prior pending details for that conversation. References are
random and expire after two minutes. Approval is recorded separately by trusted
server code only after exact readback and explicit patient approval. Re-selection
invalidates the old reference. book_appointment requires the matching approved
reference; LLM-provided approved=true never authorizes a write.

Milestone 3 tests use this internal seam; no public approval endpoint exists.
Milestone 4 must connect it to trustworthy conversation identity/readback and
approval evidence, never expose approval minting as an LLM tool. Spoken approval
cannot establish legal consent or speaker identity; transcription and turn timing
can be wrong. These limits must remain visible in demo documentation. Restart
invalidates all pending approvals, but saved bookings and exact retries survive.
Memory is local to one service/process, not shared across workers or deployments.

## Verification and milestone boundary

Run `pnpm run verify:booking`, then `pnpm run verify`. Tests use disposable SQLite
files, fixed clocks, independent connections/processes for reservation races, and
reopen the file for persistence. No vendor calls, audio, or patient data.
Voice tools, session binding, emergency speech, confirmed card and tunnel remain
Milestone 4. The starter persona/UI/end-session behavior remain untouched.

SQLite API reference: https://nodejs.org/download/release/v24.10.0/docs/api/sqlite.html

## Emergency stop (2026-11-20)

Obvious severe-danger language returns EMERGENCY_REDIRECTION before directory matching. The message directs India-based patients to call 112 and request an ambulance for emergency care; outside India, use the local emergency number. Source: https://www.mha.gov.in/emergency-response-support-system-erss . This is a conservative keyword safeguard, not medical triage or diagnosis.

When find_doctors receives the trusted conversation as its separate second argument, an emergency clears pending approval and blocks selection and booking for that conversation, even if approval was already granted. It remains blocked until trusted session teardown calls end_conversation, or the service restarts. No saved booking is deleted. No concern is persisted. Milestone 4 must pass trusted conversation context on every lookup and wire this emergency stop into speech/turn handling and session teardown. Stateless lookup without context only returns redirection and cannot latch a session stop.
