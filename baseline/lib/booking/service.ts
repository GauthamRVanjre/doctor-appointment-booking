import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ApprovalStore } from './approval';
import { addDays, clinic, localDate, schedule, type Slot } from './config';

type Failure = { ok: false; code: string; message: string };
type Result<T> = ({ ok: true } & T) | Failure;
export type Booking = { id: string; slot_id: string; demo_alias: string; created_at: string };
const fail = (code: string, message: string): Failure => ({ ok: false, code, message });
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const token = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9:_-]{8,128}$/.test(value);
const aliasValid = (v: unknown): v is string => v === 'Demo Patient' || v === 'Demo Guest';
const emergencyMessage = 'Do not wait for a routine appointment. In India, call 112 now and request an ambulance for emergency care. Outside India, call your local emergency number. This assistant cannot assess or treat emergencies.';
function object(input: unknown, allowed: string[]): Record<string, unknown> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return;
  if (Object.keys(input).some(key => !allowed.includes(key))) return;
  return input as Record<string, unknown>;
}
function dateValid(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export class BookingService {
  private db: DatabaseSync;
  readonly approvals: ApprovalStore;
  private emergencyConversations = new Set<string>();
  constructor(path = resolve(process.cwd(), 'data/clinic.sqlite'), private readonly clock: () => Date = () => new Date()) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS slots (
        id TEXT PRIMARY KEY, doctor_id TEXT NOT NULL, starts_at TEXT NOT NULL,
        ends_at TEXT NOT NULL, timezone TEXT NOT NULL CHECK(timezone = 'Asia/Kolkata'),
        UNIQUE(doctor_id, starts_at), CHECK(ends_at > starts_at)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS bookings (
        id TEXT PRIMARY KEY, slot_id TEXT NOT NULL UNIQUE REFERENCES slots(id),
        demo_alias TEXT NOT NULL CHECK(demo_alias IN ('Demo Patient', 'Demo Guest')),
        conversation_hash TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE,
        request_hash TEXT NOT NULL, approval_hash TEXT NOT NULL, created_at TEXT NOT NULL
      ) STRICT;`);
    this.approvals = new ApprovalStore(clock);
  }
  close(): void { this.db.close(); }

  find_doctors(input: unknown, conversation?: string): Result<{ doctors: (typeof clinic)[] }> {
    if (conversation !== undefined && !token(conversation)) return fail('INVALID_ARGUMENTS', 'Use a valid trusted conversation.');
    const p = object(input, ['concern']);
    if (!p || typeof p.concern !== 'string' || !p.concern.trim() || p.concern.length > 500) return fail('INVALID_ARGUMENTS', 'Provide a concern of 1–500 characters.');
    const text = p.concern.toLowerCase();
    if (/\b(chest pain|cannot breathe|can.t breathe|difficulty breathing|not breathing|severe bleeding|bleeding heavily|unconscious|unresponsive|heart attack|stroke|suicid\w*|overdose|severe danger|life.threatening)\b/.test(text)) {
      if (conversation) {
        this.emergencyConversations.add(conversation);
        this.approvals.clear(conversation);
      }
      return fail('EMERGENCY_REDIRECTION', emergencyMessage);
    }
    if (conversation && this.emergencyConversations.has(conversation)) return fail('EMERGENCY_REDIRECTION', emergencyMessage);
    if (/\b(ramesh|general physician|general doctor)\b/.test(text) || clinic.keywords.some(word => new RegExp(`\\b${word}\\b`).test(text))) return { ok: true, doctors: [clinic] };
    return fail('NO_MATCH', 'No configured consultation matches. The demo directory contains only Dr. Ramesh for routine general physician consultations.');
  }

  get_available_slots(input: unknown): Result<{ slots: Slot[]; alternatives: Slot[]; reason?: string }> {
    const p = object(input, ['doctor_id', 'start_date', 'end_date', 'preferred_time']);
    const now = this.clock();
    const today = localDate(now);
    if (!p || p.doctor_id !== clinic.doctorId) return fail('INVALID_ARGUMENTS', 'Use a configured doctor_id.');
    const start = p.start_date ?? today;
    const end = p.end_date ?? addDays(today, 6);
    if (!dateValid(start) || !dateValid(end) || start < today || end > addDays(today, 6) || end < start ||
      (p.preferred_time !== undefined && (typeof p.preferred_time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(p.preferred_time)))) return fail('INVALID_ARGUMENTS', 'Dates must lie within the upcoming seven local calendar days; time must be HH:mm.');
    try {
      const available = this.available(now);
      const inRange = available.filter(s => localDate(new Date(s.starts_at)) >= start && localDate(new Date(s.starts_at)) <= end);
      const slots = inRange.filter(s => !p.preferred_time || new Date(Date.parse(s.starts_at) + 330 * 60_000).toISOString().slice(11, 16) === p.preferred_time);
      return { ok: true, slots, alternatives: slots.length ? [] : (inRange.length ? inRange : available).slice(0, 6),
        ...(slots.length ? {} : { reason: 'No available slots match. Working hours are Monday, Tuesday, Thursday and Friday, 17:00–20:00 Asia/Kolkata. Widen the dates to find alternatives.' }) };
    } catch { return fail('STORAGE_FAILURE', 'Availability could not be checked. Please try again.'); }
  }

  prepare_selection(conversation: string, input: unknown): Result<{ approval_reference: string; readback: string; expires_at: string }> {
    if (this.emergencyConversations.has(conversation)) return fail('EMERGENCY_REDIRECTION', emergencyMessage);
    const p = object(input, ['doctor_id', 'slot_id', 'demo_alias']);
    // An attempted change invalidates the prior approval, even when the new selection is invalid.
    this.approvals.clear(conversation);
    if (!token(conversation) || !p || p.doctor_id !== clinic.doctorId || typeof p.slot_id !== 'string' || !aliasValid(p.demo_alias)) return fail('INVALID_ARGUMENTS', 'Use a valid conversation, server slot and fictional demo alias.');
    try {
      const slot = this.available(this.clock()).find(s => s.id === p.slot_id);
      if (!slot) return fail('SLOT_UNAVAILABLE', 'Choose a currently available server slot.');
      const pending = this.approvals.prepare(conversation, slot, p.demo_alias);
      return { ok: true, approval_reference: pending.reference, readback: pending.readback, expires_at: new Date(pending.expiresAt).toISOString() };
    } catch { return fail('STORAGE_FAILURE', 'Selection could not be checked. Please try again.'); }
  }

  book_appointment(input: unknown, conversation: string): Result<{ booking: Booking; slot: Slot; doctor: typeof clinic; replayed: boolean }> {
    if (this.emergencyConversations.has(conversation)) return fail('EMERGENCY_REDIRECTION', emergencyMessage);
    const p = object(input, ['doctor_id', 'slot_id', 'demo_alias', 'idempotency_key', 'approval_reference']);
    if (!p || p.doctor_id !== clinic.doctorId || typeof p.slot_id !== 'string' || p.slot_id.length > 128 || !aliasValid(p.demo_alias) || !token(p.idempotency_key) || !token(p.approval_reference) || !token(conversation)) return fail('INVALID_ARGUMENTS', 'Provide valid booking details and approval reference.');
    const conversationHash = hash(conversation);
    const approvalHash = hash(p.approval_reference);
    const requestHash = hash(JSON.stringify([p.doctor_id, p.slot_id, p.demo_alias, conversationHash, approvalHash]));
    let transaction = false;
    try {
      this.db.exec('BEGIN IMMEDIATE'); transaction = true;
      const existing = this.db.prepare('SELECT * FROM bookings WHERE idempotency_key = ?').get(p.idempotency_key);
      if (existing) {
        if (existing.request_hash !== requestHash) {
          this.db.exec('ROLLBACK'); transaction = false;
          return fail('IDEMPOTENCY_CONFLICT', 'This retry key was already used for different details.');
        }
        const slot = this.db.prepare('SELECT * FROM slots WHERE id = ?').get(existing.slot_id) as Slot;
        this.db.exec('COMMIT'); transaction = false;
        return { ok: true, booking: this.publicBooking(existing), slot, doctor: clinic, replayed: true };
      }
      const slot = schedule(this.clock()).find(s => s.id === p.slot_id);
      const stored = this.db.prepare('SELECT * FROM slots WHERE id = ?').get(p.slot_id);
      if (!slot || !stored || JSON.stringify([stored.doctor_id, stored.starts_at, stored.ends_at, stored.timezone]) !== JSON.stringify([slot.doctor_id, slot.starts_at, slot.ends_at, slot.timezone]) || this.db.prepare('SELECT id FROM bookings WHERE slot_id = ?').get(p.slot_id)) {
        this.db.exec('ROLLBACK'); transaction = false;
        return fail('SLOT_UNAVAILABLE', 'That slot is no longer available. Request current alternatives.');
      }
      if (!this.approvals.matches(conversation, p.approval_reference, slot, p.demo_alias)) {
        this.db.exec('ROLLBACK'); transaction = false;
        return fail('APPROVAL_REQUIRED', 'Exact readback and fresh explicit approval are required for these details.');
      }
      const booking: Booking = { id: randomUUID(), slot_id: slot.id, demo_alias: p.demo_alias, created_at: this.clock().toISOString() };
      this.db.prepare('INSERT INTO bookings VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(booking.id, slot.id, booking.demo_alias, conversationHash, p.idempotency_key, requestHash, approvalHash, booking.created_at);
      this.db.exec('COMMIT'); transaction = false;
      this.approvals.clear(conversation);
      return { ok: true, booking, slot, doctor: clinic, replayed: false };
    } catch {
      if (transaction) { try { this.db.exec('ROLLBACK'); } catch { /* Connection failure: no success returned. */ } }
      return fail('STORAGE_FAILURE', 'Booking could not be confirmed. Retry with the same details and key.');
    }
  }

  // Only trusted session teardown should release this conversation's temporary state.
  end_conversation(conversation: string): void {
    this.approvals.clear(conversation);
    this.emergencyConversations.delete(conversation);
  }

  private publicBooking(row: Record<string, unknown>): Booking {
    return { id: String(row.id), slot_id: String(row.slot_id), demo_alias: String(row.demo_alias), created_at: String(row.created_at) };
  }
  private available(now: Date): Slot[] {
    const slots = schedule(now);
    const insert = this.db.prepare('INSERT INTO slots VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING');
    for (const s of slots) insert.run(s.id, s.doctor_id, s.starts_at, s.ends_at, s.timezone);
    const booked = new Set(this.db.prepare('SELECT slot_id FROM bookings').all().map(r => r.slot_id));
    return slots.filter(s => !booked.has(s.id));
  }
}
