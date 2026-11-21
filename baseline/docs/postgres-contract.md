# Agreed deployment database contract

Accepted on 2026-11-21: Vercel with Supabase Postgres, using `slots`,
`bookings`, and `conversation_sessions`. This supersedes the local-only
two-table boundary for deployment. The application still runs on SQLite;
this contract is not evidence of an implemented or tested cloud backend.

## Tables

`slots` preserves TEXT `id`, TEXT `doctor_id`, TIMESTAMPTZ `starts_at` and
`ends_at`, and TEXT `timezone` constrained to Asia/Kolkata. All are required.
The primary key is `id`; `(doctor_id, starts_at)` is unique and end must be
after start. Doctor configuration and schedule remain in code.

`bookings` preserves required TEXT fields `id` (primary key), `slot_id`
(unique foreign key to slots), `demo_alias` (Demo Patient or Demo Guest),
`conversation_hash`, `idempotency_key` (unique), `request_hash`,
`approval_hash`, and TIMESTAMPTZ `created_at`. Existing text identifiers
remain compatible. No cascading deletion of bookings is permitted.

`conversation_sessions` contains:

| Column | Contract |
| --- | --- |
| id | Server-generated UUID primary key |
| browser_token_hash | Required unique TEXT SHA-256 digest |
| tool_token_hash | Required unique TEXT SHA-256 digest, separate capability |
| agent_id | Nullable TEXT runtime agent identifier |
| channel | Required TEXT server-associated channel |
| requester_uid | Required TEXT Agora user identifier |
| created_at | Required TIMESTAMPTZ |
| expires_at | Required TIMESTAMPTZ, after creation and at most one hour later |
| ended_at | Nullable TIMESTAMPTZ |
| emergency_stopped | Required BOOLEAN, default false |
| revision | Required nonnegative INTEGER, default zero |
| pending_selection | Nullable JSONB object, strictly validated by server |
| saved_booking_id | Nullable TEXT foreign key to bookings, indexed |
| saved_approval_hash | Nullable TEXT SHA-256 digest |

Pending selection contains only doctor/slot identifiers, fictional alias,
selection nonce, approval hash, readback derived from scheduling data,
two-minute expiry, idempotency key, and observed user-turn hash. Persist no
usable approval reference, raw capability, transcript, symptom, or SDK object.
Derive a pollable reference with a server-only signing secret. Every request
checks expiry; cleanup is not the authorization mechanism.

## Transaction contract

1. Authenticate the appropriate hashed capability and read session revision.
2. Fetch authenticated Agora history outside a database transaction.
3. Lock the session row and compare its revision. A stale result must be
   discarded or checked again; it cannot replace newer authority.
4. For confirmation, validate active session, emergency latch, exact selection,
   approval digest, expiry, observed-turn hash and request fingerprint.
5. Lock the slot after the session. Check exact idempotent replay before a new
   insert. A reused key with different details is a conflict. The unique slot
   constraint is the final double-booking guard.
6. Insert booking and update session saved metadata/clear pending state in
   one transaction. Increment revision on authority changes. Roll back the
   entire write on failure; handle uniqueness conflicts after rollback.
7. Return saved state and attempt confirmation speech only after commit.
   Failed speech must not roll back or falsely undo a committed booking.

All operations lock in session-then-slot order. No provider network calls
occur while locks are held. Emergency and end operations lock the same session,
clear pending state and increment revision. A committed emergency latch blocks
later saves; it cannot retroactively undo a booking committed earlier.
Retry recognition must never restore an ended session's authority.

## Hosting and access

Use a dedicated clinic project. Do not reuse the unrelated Resume Parser project.
Use server-only Postgres credentials through the transaction pooler, with
bounded connections and timeouts. Each transaction must use one checked-out
connection; independent HTTP Data API calls do not form one transaction.
Avoid named prepared statements with transaction pooling.

Enable RLS and revoke table privileges from PUBLIC, anon and authenticated.
No browser Data API policies are needed. Use a server database role with
explicit required grants; verify its privileges and RLS behavior in integration
tests. Index session expiry for bounded cleanup. Deleting session state must
never delete saved bookings.

## Verification and remaining work

Implement the asynchronous Postgres booking/session repositories, per-request
Agora access, deployed origin/cookies, ownership and bounded public agent-start
controls before deploying. Preserve the existing local demo during this work.
Generate migration files with the Supabase CLI, inspect target tables before
applying them, and run real Postgres tests for rollback, same-slot races,
conflicting retries, stale revisions, expiry, emergency and cold starts.
No hosted migration or deployment has been performed at contract acceptance.

## Pitch

We chose Supabase because it provides managed PostgreSQL for our Vercel app.
Booking needs an all-or-nothing write: validate approval, reserve one available
slot, and record the result. PostgreSQL transactions, row locks, and unique
constraints let us coordinate that operation across server instances and roll
back incomplete writes. Supabase reduces database hosting work for a solo
hackathon while keeping the core schema and SQL portable to another PostgreSQL
host. Transaction safety comes from PostgreSQL and correct application code;
it is not exclusive to Supabase.

SQLite remains useful for the local prototype but its local file and process
state do not provide shared durable authority for Vercel Functions. Other
managed PostgreSQL hosts are valid alternatives with the same core database
guarantees. Supabase is the accepted operational choice, not a claim that other
databases cannot support transactions. Rolling back an uncommitted transaction
does not undo a booking that has already committed.

Sources:
- https://supabase.com/docs/guides/database/connecting-to-postgres
- https://www.postgresql.org/docs/current/tutorial-transactions.html
