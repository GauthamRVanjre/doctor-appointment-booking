import { Pool, type PoolClient } from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { clinic, schedule, type Slot } from './config';
import type { Booking } from './service';

export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export type Selection = {
  doctor_id: string; slot_id: string; demo_alias: 'Demo Patient' | 'Demo Guest';
  nonce: string; approval_hash: string; readback: string; expires_at: string;
  idempotency_key: string; userHash: string;
};
export type StoredSession = {
  id: string; browser_token_hash: string; tool_token_hash: string;
  agent_id: string | null; channel: string; requester_uid: string;
  expires_at: Date; ended_at: Date | null; emergency_stopped: boolean;
  revision: number; pending_selection: Selection | null;
  saved_booking_id: string | null; saved_approval_hash: string | null; created_at: Date;
};
type Saved = { ok: true; booking: Booking; slot: Slot; doctor: typeof clinic; replayed: boolean };
type Failure = { ok: false; code: string; message: string };
const fail = (code: string, message: string): Failure => ({ ok: false, code, message });
const publicSlot = (row: Record<string, unknown>): Slot => ({
  id: String(row.id), doctor_id: String(row.doctor_id), timezone: String(row.timezone),
  starts_at: new Date(row.starts_at as string).toISOString(), ends_at: new Date(row.ends_at as string).toISOString(),
});

// The pool caches connections only. All booking authority lives in Postgres.
export class PostgresStore {
  constructor(readonly pool: Pool) {}

  async get(id: string) {
    return (await this.pool.query<StoredSession>('SELECT * FROM public.conversation_sessions WHERE id=$1', [id])).rows[0];
  }

  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let broken = false;
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout = '5s'");
      await client.query("SET LOCAL lock_timeout = '3s'");
      const value = await work(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { broken = true; }
      throw error;
    } finally { client.release(broken); }
  }

  async create(input: { id: string; browserToken: string; toolToken: string; channel: string; requesterUid: string }) {
    // Bounded cleanup of old authority only; no saved booking is deleted.
    await this.pool.query(`DELETE FROM public.conversation_sessions WHERE id IN
      (SELECT id FROM public.conversation_sessions WHERE expires_at<clock_timestamp()-interval '1 day'
       ORDER BY expires_at LIMIT 100)`);
    return this.transaction(async client => {
    if (process.env.VERCEL || process.env.BOOKING_APP_ORIGIN) {
      // Coordinate the public demo budget across all function instances.
      await client.query("SELECT pg_advisory_xact_lock(hashtext('clinic-start-budget'))");
      const usage = (await client.query(`SELECT
        count(*) FILTER (WHERE created_at>clock_timestamp()-interval '1 hour')::int AS recent,
        count(*) FILTER (WHERE ended_at IS NULL AND expires_at>clock_timestamp())::int AS active,
        count(*) FILTER (WHERE channel=$1)::int AS same_channel FROM public.conversation_sessions`,[input.channel])).rows[0];
      if (usage.recent>=10 || usage.active>=2 || usage.same_channel>0) throw new Error('DEMO_START_LIMIT');
    }
    const result = await client.query<StoredSession>(`INSERT INTO public.conversation_sessions
      (id,browser_token_hash,tool_token_hash,channel,requester_uid,created_at,expires_at)
      VALUES ($1,$2,$3,$4,$5,statement_timestamp(),statement_timestamp()+interval '1 hour') RETURNING *`,
    [input.id, digest(input.browserToken), digest(input.toolToken), input.channel, input.requesterUid]);
    return result.rows[0];
    });
  }

  async authenticate(token: string | undefined, kind: 'browser' | 'tool') {
    if (!token || !/^[0-9a-f]{64}$/.test(token)) return;
    // The only interpolated identifier is selected from this fixed allowlist.
    const column = kind === 'browser' ? 'browser_token_hash' : 'tool_token_hash';
    return (await this.pool.query<StoredSession>(`SELECT * FROM public.conversation_sessions
      WHERE ${column}=$1 AND ended_at IS NULL AND expires_at>clock_timestamp()`, [digest(token)])).rows[0];
  }

  async attach(id: string, agentId: string) {
    const result = await this.pool.query(`UPDATE public.conversation_sessions SET agent_id=$2, revision=revision+1
      WHERE id=$1 AND agent_id IS NULL AND ended_at IS NULL AND expires_at>clock_timestamp()`, [id, agentId]);
    if (result.rowCount !== 1) throw new Error('Session no longer active');
  }

  async end(id: string) {
    await this.pool.query(`UPDATE public.conversation_sessions SET ended_at=COALESCE(ended_at,clock_timestamp()),
      pending_selection=NULL,revision=revision+1 WHERE id=$1`, [id]);
  }

  async emergency(id: string) {
    // Never conditional on an old history revision: observed danger must latch.
    await this.pool.query(`UPDATE public.conversation_sessions SET emergency_stopped=true,
      pending_selection=NULL,revision=revision+1 WHERE id=$1 AND NOT emergency_stopped`, [id]);
  }

  async replacePending(id: string, revision: number, pending: Selection | null) {
    const result = await this.pool.query<StoredSession>(`UPDATE public.conversation_sessions
      SET pending_selection=$3::jsonb,revision=revision+1 WHERE id=$1 AND revision=$2
      AND ended_at IS NULL AND NOT emergency_stopped AND expires_at>clock_timestamp() RETURNING *`,
    [id, revision, pending === null ? null : JSON.stringify(pending)]);
    return result.rows[0]; // Missing means stale/ended; caller must not restore old state.
  }

  async available(now = new Date()): Promise<Slot[]> {
    const slots = schedule(now);
    if (!slots.length) return [];
    await this.pool.query(`INSERT INTO public.slots(id,doctor_id,starts_at,ends_at,timezone)
      SELECT id,doctor_id,starts_at::timestamptz,ends_at::timestamptz,timezone
      FROM jsonb_to_recordset($1::jsonb) AS s(id text,doctor_id text,starts_at text,ends_at text,timezone text)
      ON CONFLICT DO NOTHING`, [JSON.stringify(slots)]);
    const booked = new Set((await this.pool.query<{slot_id: string}>(
      'SELECT slot_id FROM public.bookings WHERE slot_id=ANY($1::text[])', [slots.map(s => s.id)])).rows.map(r => r.slot_id));
    return slots.filter(s => !booked.has(s.id));
  }

  async saved(id: string): Promise<Saved | undefined> {
    const booking = (await this.pool.query('SELECT * FROM public.bookings WHERE id=$1', [id])).rows[0];
    if (!booking) return;
    const slot = (await this.pool.query('SELECT * FROM public.slots WHERE id=$1', [booking.slot_id])).rows[0];
    return this.result(booking, slot, true);
  }

  // Called only by a cookie-authenticated explicit confirmation handler after
  // authenticated history verification. Never expose this method as a model tool.
  async confirm(id: string, revision: number, reference: string, userHash: string): Promise<Saved | Failure> {
    try {
      return await this.transaction(async client => {
        const session = (await client.query<StoredSession>(
          'SELECT * FROM public.conversation_sessions WHERE id=$1 FOR UPDATE', [id])).rows[0];
        if (!session || session.ended_at || session.expires_at.getTime() <= Date.now())
          return fail('SESSION_ENDED', 'Start a new conversation.');
        if (session.emergency_stopped) return fail('EMERGENCY_REDIRECTION', 'Routine booking has stopped.');
        if (session.saved_booking_id && session.saved_approval_hash === digest(reference)) {
          const b = (await client.query('SELECT * FROM public.bookings WHERE id=$1', [session.saved_booking_id])).rows[0];
          const s = (await client.query('SELECT * FROM public.slots WHERE id=$1', [b.slot_id])).rows[0];
          return this.result(b, s, true);
        }
        if (session.revision !== revision) return fail('STALE_SELECTION', 'Review the current selection again.');
        const p = session.pending_selection;
        if (!p || p.approval_hash !== digest(reference) || p.userHash !== userHash ||
            Date.parse(p.expires_at) <= Date.now()) return fail('APPROVAL_REQUIRED', 'Review a fresh selection before confirming.');
        const requestHash = digest(JSON.stringify([p.doctor_id,p.slot_id,p.demo_alias,digest(id),p.approval_hash]));
        const existing = (await client.query('SELECT * FROM public.bookings WHERE idempotency_key=$1', [p.idempotency_key])).rows[0];
        if (existing && existing.request_hash !== requestHash)
          return fail('IDEMPOTENCY_CONFLICT', 'This retry key was already used for different details.');
        // All writers use session -> slot order, with the unique slot constraint
        // protecting against any competing session that acquired its own lock.
        const stored = (await client.query('SELECT * FROM public.slots WHERE id=$1 FOR UPDATE', [p.slot_id])).rows[0];
        const current = schedule(new Date()).find(s => s.id === p.slot_id);
        const actual = stored ? publicSlot(stored) : undefined;
        if (!actual || (!existing && (!current || actual.doctor_id !== current.doctor_id ||
            actual.starts_at !== current.starts_at || actual.ends_at !== current.ends_at || actual.timezone !== current.timezone)))
          return fail('SLOT_UNAVAILABLE', 'Request current alternatives.');
        let booking = existing;
        if (!booking) {
          if ((await client.query('SELECT id FROM public.bookings WHERE slot_id=$1', [p.slot_id])).rowCount)
            return fail('SLOT_UNAVAILABLE', 'That slot was just booked. Request alternatives.');
          booking = (await client.query(`INSERT INTO public.bookings
            (id,slot_id,demo_alias,conversation_hash,idempotency_key,request_hash,approval_hash,created_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,clock_timestamp()) RETURNING *`,
          [randomUUID(),p.slot_id,p.demo_alias,digest(id),p.idempotency_key,requestHash,p.approval_hash])).rows[0];
        }
        await client.query(`UPDATE public.conversation_sessions SET saved_booking_id=$2,
          saved_approval_hash=$3,pending_selection=NULL,revision=revision+1 WHERE id=$1`, [id,booking.id,p.approval_hash]);
        return this.result(booking, stored, !!existing);
      });
    } catch {
      return fail('STORAGE_FAILURE', 'Booking could not be confirmed. Retry the same approval reference.');
    }
  }

  private result(b: Record<string, unknown>, s: Record<string, unknown>, replayed: boolean): Saved {
    return { ok: true, booking: { id: String(b.id),slot_id: String(b.slot_id),demo_alias: String(b.demo_alias),
      created_at: new Date(b.created_at as string).toISOString() }, slot: publicSlot(s),doctor: clinic,replayed };
  }
}

let store: PostgresStore | undefined;
export function postgresStore() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for Postgres storage');
  return store ??= new PostgresStore(new Pool({ connectionString: process.env.DATABASE_URL,
    max: 3, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5_000,
    query_timeout: 10_000, application_name: 'demo-care-clinic' }));
}
