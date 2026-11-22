# Demo Care Clinic voice appointment assistant

A hackathon prototype for **From Conversations to Autonomous Action**.
Patients talk to an Agora voice assistant, select a real available appointment,
review the details and explicitly approve on screen before the server saves it.

The Next.js application is in [`baseline/`](baseline/). See its
[setup and verification guide](baseline/README.md).

## Current status

- Local booking demo implemented with SQLite persistence.
- Agora Conversational AI with Murf Falcon TTS, voice Anisha.
- On-screen approval is required; spoken yes alone does not save.
- Supabase Postgres is hosted in Mumbai; durable booking/session routes are
  implemented. Vercel release controls and deployed voice verification remain.
  No live deployed application URL is available yet.

Only fictional appointments and aliases are supported. This prototype does not
diagnose, provide medical advice or connect to a real clinic calendar.

## Project references

- [Application guide](baseline/README.md)
- [Booking schema and guarantees](baseline/docs/booking-contract.md)
- [Voice-to-action implementation and limitations](baseline/docs/voice-to-action.md)
- [Demo and presentation notes](FINAL-DEMO.md)

Based on the MIT-licensed
[official Agora Next.js quickstart](https://github.com/AgoraIO-Conversational-AI/agent-quickstart-nextjs).
Original attribution is preserved in [the application license](baseline/LICENSE).
