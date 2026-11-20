# Future-scope deck notes

Approved direction: keep this two-day demo small, with a configured fictional doctor and only two SQLite tables: slots and bookings. Temporary conversation-bound selection/approval lives in memory and expires; a restart requires selecting and approving again. No symptom, transcript, or audio persistence.

Pitch for the future-scope slide:

> The prototype completes a booking against a local scheduling system. Next, we will connect clinic calendars through authenticated tools or MCP, while preserving explicit patient approval and reliable booking records.

- Google Calendar can supply busy periods and store appointment events. Working hours, services, approval rules, retry protection, and booking coordination still belong in the application.
- Calendar free/busy lookup followed by event creation is not an atomic reservation. Keep a small booking record and coordinate concurrent requests; future synchronization must handle external calendar changes.
- Calendar OAuth authorizes clinic calendar access; patient login is a separate future decision.
- MCP is a possible integration interface, not a replacement for the booking rules or database by itself.
- Later possibilities: multiple doctors, clinic accounts, patient authentication when useful, cancellation, reminders, calendar synchronization status.
- Do not claim four tables are necessary for scalability. Separate entities when actual features require them.

Sources checked on 2026-11-20:
- https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query
- https://developers.google.com/workspace/calendar/api/v3/reference/events/insert
- https://developers.google.com/workspace/calendar/api/auth

These are future possibilities, not implemented demo features. Include this distinction when preparing the deck.
