# Demo Care Clinic

Patient-facing voice appointment assistant built with Next.js, Agora
Conversational AI and Murf Falcon. The local prototype saves fictional
appointments in SQLite after explicit on-screen approval.

## Demo flow

Concern -> configured doctor lookup -> actual availability -> slot selection ->
concise spoken readback -> on-screen review and approval -> database commit ->
spoken confirmation and server-confirmed booking card.

The fictional directory contains Dr. Ramesh at Demo Care Clinic. Consultations
last 30 minutes, Monday, Tuesday, Thursday and Friday, 17:00-20:00 Asia/Kolkata.
The booking window is today through today + 6 local calendar days, excluding
past starts and already-booked slots. Wednesday and weekends are unavailable.

## Stack

- Next.js 16, React 19 and TypeScript.
- Agora Conversational AI, RTC and RTM for voice and live transcript.
- Deepgram nova-3 STT and OpenAI gpt-4o-mini, Agora-managed.
- Murf TTS: Anisha, FALCON, en-IN, 24 kHz.
- Local built-in Node SQLite, no ORM.

## Run locally

Use Node.js 24.10 or newer and a compatible pnpm installation. Run application
commands from this directory (`baseline/` when cloning the repository).

```powershell
pnpm install
```

If `.env.local` does not exist, copy `env.local.example` to `.env.local`. Preserve
an existing file. Fill these values locally or in your host's secret settings;
never commit keys:

| Variable | Purpose |
| --- | --- |
| NEXT_PUBLIC_AGORA_APP_ID | Browser-visible Agora project identifier |
| NEXT_AGORA_APP_CERTIFICATE | Server-only Agora credential |
| MURF_API_KEY | Server-only Murf credential |
| BOOKING_TOOLS_BASE_URL | HTTPS origin serving the booking-tool route |

```powershell
pnpm run dev
```

Open [localhost:3000](http://localhost:3000). Agent startup requires configured
providers and a reachable tools origin. HTTP 200 alone does not prove voice works.

### Local tools access

Agora's cloud cannot reach localhost directly. In a separate terminal run:

```powershell
pnpm run booking:gateway
```

This listens on `127.0.0.1:3001` and forwards only authenticated booking-tool
POST requests. Use an explicitly authorized HTTPS tunnel to that listener,
set BOOKING_TOOLS_BASE_URL to its origin and reload/restart the app. Never tunnel
the whole application on port 3000. No tunnel binary or provider key is bundled.

Start a fresh conversation, select an actual slot, review the details and click
**I approve - save booking**. Spoken yes alone does not save. New observed speech
invalidates pending review; selection approval expires after two minutes.

## Verification

```powershell
pnpm run verify:booking
pnpm run verify:voice
pnpm run verify
```

Full verification covers prerequisites, lint, TypeScript, API contracts, booking
checks, voice/session-boundary checks and production build. Tests use disposable
data. Local gateway HTTP checks can be run with:

```powershell
node scripts/verify-gateway.mjs
```

Booking checks include persistence, retries, rollback and a two-process race for
one slot. Voice-boundary checks mock Agora history/speech. Automated checks do
not establish audible delivery or a working live deployed session.

## Data and limitations

The default local file is `data/clinic.sqlite`, ignored by Git. It contains only
slots and saved bookings; no symptoms, transcripts, audio or real patient identity.
Only Demo Patient and Demo Guest aliases are accepted.

Without DATABASE_URL, pending approval lives in one process and saved bookings
survive on local disk. With DATABASE_URL, bookings and session authority live in
Postgres and survive new application processes until their database expiry.
History checks can lag speech. Emergency keyword checks are conservative, not
medical triage. Existing starter media teardown still needs real-session validation.

**Deployment is pending.** Supabase storage/session integration is implemented;
public agent-start abuse controls and deployed runtime verification remain gates.
Do not treat upstream Next.js deployment defaults as a working deployment of
this booking service.

### Postgres migration progress

The dedicated Supabase project `demo-care-clinic` is hosted in Mumbai
(`ap-south-1`) with the agreed three-table schema. When DATABASE_URL is set,
routes use lib/booking/postgres.ts and lib/booking/postgres-voice.ts. Set a stable
server-only BOOKING_APPROVAL_SECRET of at least 32 random characters. Browser and
tool capability hashes, expiry, pending review and emergency stops are durable.
Authenticated Agora history/speech access is reconstructed per invocation.
No SDK object, transcript or raw capability is saved. A failed database request
never falls back to SQLite. Vercel requires DATABASE_URL.

For deployment, BOOKING_APP_ORIGIN must be the exact trusted HTTPS origin with
no trailing slash; browser mutations require a matching Origin and cookies are
Secure. Set BOOKING_TOOLS_BASE_URL to the deployed origin when releasing.
Public startup is disabled unless BOOKING_PUBLIC_DEMO=true. Deployed token/invite
requests require a trusted origin and a signed HttpOnly bootstrap cookie binding
the channel and user. A Postgres advisory lock coordinates limits across instances:
10 starts per rolling hour, at most two active sessions, and one start per channel.
Failed starts count against the hourly budget. These are global demo limits, so
a busy demo can intentionally return HTTP 429; they are not patient authentication.
Vercel functions are configured for Mumbai (bom1) in vercel.json, near the database.

For opt-in database integration checks, put the server-only transaction-pooler
URI in `DATABASE_URL` in the ignored `.env.local`, then run `pnpm run verify:postgres`.
No browser Supabase key is required. This test creates synthetic session/booking
rows and removes only its own rows afterward; it does not reset demo bookings.
It materializes current schedule slots. Run against the dedicated demo project.
Database integration is separate from `verify` and requires real connectivity.
See [the Postgres contract](docs/postgres-contract.md) and
[the hosted schema snapshot](docs/hosted-schema.sql).

## Design references and attribution

The clinic UI uses the approved local UI branch's cream/green theme, self-hosted
Manrope fonts, transcript-focused call layout and explicit booking review card.
Only presentation components and assets were transferred; the deployed Postgres
backend, session ownership, approval boundary and public-demo limits remain.
The Manrope font license is included under public/fonts/Manrope-OFL.txt.

- [Booking schema and guarantees](docs/booking-contract.md)
- [Voice implementation, approval boundary and runtime limits](docs/voice-to-action.md)
- Based on the [official Agora Next.js quickstart](https://github.com/AgoraIO-Conversational-AI/agent-quickstart-nextjs).
- Scenario reference: [Agora clinic appointment assistant demo](https://github.com/AgoraIO-Community/agora-clinic-appointment-assistant-demo).
  That reference is conversation-only; real lookup, reservation and persistence
  in this fork are implemented separately.

Original MIT attribution is retained in [LICENSE](LICENSE).
