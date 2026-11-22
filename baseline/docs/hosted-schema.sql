-- Snapshot of hosted migration create_clinic_booking_contract.
-- Applied to demo-care-clinic, Mumbai, 2026-11-21 through Supabase MCP.
-- Reference snapshot only; not a CLI migration file or application integration.
CREATE TABLE public.slots (
 id TEXT PRIMARY KEY, doctor_id TEXT NOT NULL,
 starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ NOT NULL,
 timezone TEXT NOT NULL CHECK (timezone = 'Asia/Kolkata'),
 UNIQUE (doctor_id, starts_at), CHECK (ends_at > starts_at)
);
CREATE TABLE public.bookings (
 id TEXT PRIMARY KEY, slot_id TEXT NOT NULL UNIQUE REFERENCES public.slots(id),
 demo_alias TEXT NOT NULL CHECK (demo_alias IN ('Demo Patient', 'Demo Guest')),
 conversation_hash TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE,
 request_hash TEXT NOT NULL, approval_hash TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE public.conversation_sessions (
 id UUID PRIMARY KEY, browser_token_hash TEXT NOT NULL UNIQUE,
 tool_token_hash TEXT NOT NULL UNIQUE, agent_id TEXT,
 channel TEXT NOT NULL, requester_uid TEXT NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL, ended_at TIMESTAMPTZ,
 emergency_stopped BOOLEAN NOT NULL DEFAULT FALSE,
 revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
 pending_selection JSONB CHECK (jsonb_typeof(pending_selection) = 'object'),
 saved_booking_id TEXT REFERENCES public.bookings(id),
 saved_approval_hash TEXT, created_at TIMESTAMPTZ NOT NULL,
 CHECK (expires_at > created_at AND expires_at <= created_at + INTERVAL '1 hour'),
 CHECK (browser_token_hash ~ '^[0-9a-f]{64}$'),
 CHECK (tool_token_hash ~ '^[0-9a-f]{64}$'),
 CHECK (browser_token_hash <> tool_token_hash)
);
CREATE INDEX conversation_sessions_expires_at_idx ON public.conversation_sessions(expires_at);
CREATE INDEX conversation_sessions_saved_booking_id_idx ON public.conversation_sessions(saved_booking_id);
ALTER TABLE public.slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.slots, public.bookings, public.conversation_sessions FROM PUBLIC, anon, authenticated;
