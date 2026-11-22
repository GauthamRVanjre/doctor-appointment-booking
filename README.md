# Demo Care Clinic — Voice AI Appointment Booking

Find an available doctor appointment through conversation, review the details,
and explicitly approve the booking before it is saved.

Built for **From Conversations to Autonomous Action**, this full-stack voice AI
prototype connects natural conversation to scheduling tools and persistent
booking storage. The clinic and patient aliases are fictional; availability
and confirmed bookings are backed by the application's database.

**[Try the live demo](https://demo-care-clinic.vercel.app)**

## Screenshots

### Start a conversation

![Landing page with the voice assistant and Start conversation button](docs/images/landing-page.png)

### From conversation to a saved booking

![Live transcript alongside the saved appointment and booking reference](docs/images/saved-booking.png)

## Features

- **Natural voice interaction:** Agora Conversational AI with Murf Falcon TTS,
  using the Anisha voice.
- **Availability checks:** checks the configured doctor's schedule and existing
  bookings, offering actual alternatives when a requested time is unavailable.
- **Live transcripts:** follow both sides of the conversation on screen.
- **Explicit approval:** review appointment details and approve on screen.
  A spoken “yes” alone never saves a booking.
- **Persistent confirmation:** saves the approved appointment and displays a
  server-confirmed booking card with a reference.
- **Booking safeguards:** validates session ownership and approval, handles
  retries, and uses database constraints to prevent double booking.
- **Emergency redirection:** stops routine booking for supported emergency
  phrases and directs the user toward urgent help.

## Booking flow

1. Start a conversation and allow microphone access.
2. Describe a routine concern and request an appointment.
3. Choose from the available slots returned by the scheduling tools.
4. Review the doctor, date, time and demo patient alias on screen.
5. Approve the booking and receive the saved confirmation reference.

The fictional directory contains **Dr. Ramesh**, a general physician offering
30-minute appointments on Monday, Tuesday, Thursday and Friday, 17:00–20:00
**Asia/Kolkata**. The booking window covers today through the next six local
calendar days, excluding past starts and already-booked slots.

## Technology

| Layer | Technology |
| --- | --- |
| Application | Next.js 16, React 19, TypeScript, Tailwind CSS |
| Voice and messaging | Agora Conversational AI, RTC and RTM |
| Speech recognition | Agora-managed Deepgram nova-3 |
| Language model | Agora-managed OpenAI gpt-4o-mini |
| Speech synthesis | Murf Falcon, Anisha, en-IN |
| Deployed storage | Supabase Postgres |
| Hosting | Vercel |
| Local demo storage | Node.js built-in SQLite |

The Next.js server connects the agent's tools to availability and booking
services. The deployed implementation stores slots, bookings and conversation
session authority in Postgres to support requests across application instances.
The server validates approval and commits the booking transaction before
returning confirmation.

## Development

The application lives in [`baseline/`](baseline/). Use **Node.js 24.10+** and
**pnpm**, then run:

```powershell
cd baseline
pnpm install
```

Copy `env.local.example` to `.env.local` if it does not already exist and
configure the Agora and Murf credentials. Never commit provider credentials.
See the [application guide](baseline/README.md) for local setup and the
booking gateway. Agora's cloud requires a reachable HTTPS tool endpoint;
local voice development uses a tools-only tunnel.

```powershell
pnpm run dev
```

Open [localhost:3000](http://localhost:3000).

The merged deployment implementation uses server-only `DATABASE_URL` and
`BOOKING_APPROVAL_SECRET` settings for Postgres and durable approval state.
Hosted operation also uses `BOOKING_APP_ORIGIN`, `BOOKING_TOOLS_BASE_URL` and
`BOOKING_PUBLIC_DEMO`. Set both origin settings to the deployed HTTPS origin,
without a trailing slash. The older SQLite demo branch runs with local disk
and process-local session authority.

## Verification

Run from `baseline/`:

```powershell
pnpm run verify:booking
pnpm run verify:voice
pnpm run verify
```

The merged Postgres implementation also provides `pnpm run verify:postgres`,
an opt-in integration check requiring a configured demo database. It creates
synthetic records and removes its own records afterward.

Automated checks cover booking and session boundaries. Audible voice delivery
and the complete conversation flow also require a live browser session.

## Demo scope

This is a scheduling prototype for fictional appointments. It does not diagnose,
provide medical advice or connect to a real clinic calendar. Only **Demo Patient**
and **Demo Guest** aliases are supported. Emergency phrase handling is
conservative redirection, not medical triage.

The public demo has startup and session limits; new conversations may be
unavailable temporarily when those limits are reached.

## References and attribution

- [Application setup and verification](baseline/README.md)
- [Original local booking contract](baseline/docs/booking-contract.md)
- [Voice-to-action implementation](baseline/docs/voice-to-action.md)

Based on the MIT-licensed
[official Agora Next.js quickstart](https://github.com/AgoraIO-Conversational-AI/agent-quickstart-nextjs).
Scenario inspiration:
[Agora clinic appointment assistant demo](https://github.com/AgoraIO-Community/agora-clinic-appointment-assistant-demo).
Availability lookup, approval and booking persistence are implemented in this fork.
Original attribution is preserved in [the application license](baseline/LICENSE).
