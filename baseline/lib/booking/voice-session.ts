import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { BookingService } from './service';

type History = { agent_id?: string; contents?: { role?: string; content?: string }[] };
type Saved = Extract<ReturnType<BookingService['book_appointment']>, { ok: true }>;
type Selection = { doctor_id: string; slot_id: string; demo_alias: string };
type Pending = Selection & { approval_reference: string; readback: string; expires_at: string; idempotency_key: string; userHash: string };
type Session = {
  id: string; browserToken: string; toolToken: string; expiresAt: number; ended: boolean;
  agentId?: string; history?: () => Promise<History>; say?: (text: string) => Promise<void>;
  pending?: Pending; saved?: Saved; savedReference?: string; emergency?: string; notice?: string;
  queue: Promise<unknown>;
};
async function bounded<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Agora request timed out')), 4000); })]); }
  finally { clearTimeout(timer); }
}
const failure = (code: string, message: string) => ({ ok: false as const, code, message });

// One local Node process. Tokens are capabilities, not patient authentication.
export class VoiceSessions {
  private sessions = new Map<string, Session>();
  constructor(readonly booking: BookingService, private clock = () => Date.now()) {}

  create() {
    this.prune();
    const session: Session = { id: randomUUID(), browserToken: randomBytes(32).toString('hex'),
      toolToken: randomBytes(32).toString('hex'), expiresAt: this.clock() + 3_600_000,
      ended: false, queue: Promise.resolve() };
    this.sessions.set(session.id, session);
    return session;
  }
  attach(session: Session, agentId: string, history: () => Promise<History>, say: (text: string) => Promise<void>) {
    session.agentId = agentId; session.history = history; session.say = say;
  }
  authenticate(token: string | undefined, kind: 'browser' | 'tool'): Session | undefined {
    this.prune();
    if (!token) return;
    return [...this.sessions.values()].find(s => !s.ended && (kind === 'browser' ? s.browserToken : s.toolToken) === token);
  }
  end(session: Session) {
    session.ended = true;
    session.pending = undefined;
    this.booking.end_conversation(session.id);
    this.sessions.delete(session.id);
  }
  private prune() {
    for (const s of this.sessions.values()) if (s.expiresAt <= this.clock()) this.end(s);
  }
  private serial<T>(session: Session, work: () => Promise<T>): Promise<T> {
    const next = session.queue.then(work, work);
    session.queue = next.catch(() => {});
    return next;
  }
  private async guard(s: Session) {
    if (s.ended || s.expiresAt <= this.clock()) return failure('SESSION_ENDED', 'Start a new conversation.');
    if (s.emergency) return failure('EMERGENCY_REDIRECTION', s.emergency);
    if (!s.history || !s.agentId) return failure('SESSION_NOT_READY', 'The voice session is not ready.');
    let history: History;
    try { history = await bounded(s.history()); }
    catch { return failure('HISTORY_UNAVAILABLE', 'Cannot check the current conversation. Booking is paused; try again.'); }
    if (s.ended) return failure('SESSION_ENDED', 'Start a new conversation.');
    if (history.agent_id !== s.agentId || !Array.isArray(history.contents)) return failure('HISTORY_UNAVAILABLE', 'Conversation verification failed.');
    const userTurns = history.contents.filter(t => t.role === 'user');
    for (const turn of userTurns) {
      // Every observed user turn is checked, independently of the model choosing a lookup tool.
      const text = turn.content ?? '';
      // Overlapping windows preserve keyword matches across the length boundary.
      let result: ReturnType<BookingService['find_doctors']> = this.booking.find_doctors({ concern: 'routine' }, s.id);
      for (let offset = 0; offset < text.length; offset += 400) {
        result = this.booking.find_doctors({ concern: text.slice(offset, offset + 500) }, s.id);
        if (!result.ok && result.code === 'EMERGENCY_REDIRECTION') break;
      }
      if (!result.ok && result.code === 'EMERGENCY_REDIRECTION') {
        s.emergency = result.message; s.pending = undefined;
        try { if (s.say) await bounded(s.say(result.message)); } catch { /* The card still displays the stop. */ }
        return result;
      }
    }
    const userHash = createHash('sha256').update(JSON.stringify(userTurns)).digest('hex');
    if (s.pending && s.pending.userHash !== userHash) {
      s.pending = undefined; this.booking.approvals.clear(s.id);
      s.notice = 'New speech changed the conversation. Select the slot again for fresh approval.';
    }
    return { ok: true as const, userHash };
  }
  tool(s: Session, name: string, input: unknown) {
    return this.serial(s, async () => {
      const guard = await this.guard(s); if (!guard.ok) return guard;
      if (name === 'findDoctors') {
        this.invalidate(s);
        return this.booking.find_doctors(input, s.id);
      }
      if (name === 'getAvailableSlots') {
        this.invalidate(s);
        const value = input && typeof input === 'object' && !Array.isArray(input) ? Object.fromEntries(Object.entries(input).filter(([k, v]) => !(['start_date', 'end_date', 'preferred_time'].includes(k) && v === ''))) : input;
        return this.booking.get_available_slots(value);
      }
      if (name !== 'bookAppointment') return failure('UNKNOWN_TOOL', 'Unknown booking tool.');
      // The model can request review, but cannot mint approval or supply retry/approval tokens.
      const p = input as Selection;
      if (s.saved && p && Object.keys(p).length === 3 && p.doctor_id === s.saved.slot.doctor_id &&
          p.slot_id === s.saved.slot.id && p.demo_alias === s.saved.booking.demo_alias) return s.saved;
      this.invalidate(s);
      const result = this.booking.prepare_selection(s.id, input);
      if (!result.ok) return result;
      s.pending = { ...p, ...result, idempotency_key: randomUUID(), userHash: guard.userHash };
      const spokenReadback = result.readback.split(', 30 minutes,')[0].replace(' (UTC+05:30)', '');
      return { ok: false, code: 'ON_SCREEN_APPROVAL_REQUIRED',
        readback: `${spokenReadback}. Please review and confirm on screen.`,
        message: 'Not booked. Say only the readback once. Do not read this message, status codes, aliases, duration or references aloud. On-screen confirmation is required to save.' };
    });
  }
  state(s: Session) {
    return this.serial(s, async () => {
      const guard = await this.guard(s);
      if (s.pending && Date.parse(s.pending.expires_at) <= this.clock()) this.invalidate(s);
      return { ...(guard.ok ? { ok: true } : guard),
        pending: guard.ok && s.pending ? { reference: s.pending.approval_reference, readback: s.pending.readback, expires_at: s.pending.expires_at } : undefined,
        saved: s.saved, notice: s.notice, emergency: s.emergency };
    });
  }
  confirm(s: Session, reference: string) {
    return this.serial(s, async () => {
      const guard = await this.guard(s); if (!guard.ok) return guard;
      // A lost HTTP response can be retried without authorizing a second insert.
      if (s.saved && s.savedReference === reference) return s.saved;
      const p = s.pending;
      if (!p || p.approval_reference !== reference || Date.parse(p.expires_at) <= this.clock()) return failure('APPROVAL_REQUIRED', 'Review a fresh selection before confirming.');
      if (!this.booking.approvals.approve(s.id, reference)) return failure('APPROVAL_REQUIRED', 'Approval expired. Select again.');
      const result = this.booking.book_appointment({ doctor_id: p.doctor_id, slot_id: p.slot_id,
        demo_alias: p.demo_alias, idempotency_key: p.idempotency_key, approval_reference: reference }, s.id);
      if (!result.ok) return result;
      s.saved = result; s.pending = undefined; s.savedReference = reference; s.notice = undefined;
      const appointmentTime = new Intl.DateTimeFormat('en-IN', {
        timeZone: result.slot.timezone, weekday: 'long', month: 'long', day: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true,
      }).format(new Date(result.slot.starts_at));
      try { if (s.say) await bounded(s.say(`Your booking is confirmed and saved with ${result.doctor.doctorName} on ${appointmentTime}, India time.`)); }
      catch { s.notice = 'Booking saved. Spoken confirmation could not be delivered.'; }
      return result;
    });
  }
  private invalidate(s: Session) { s.pending = undefined; s.notice = undefined; this.booking.approvals.clear(s.id); }
}

const shared = globalThis as typeof globalThis & { clinicVoiceSessions?: VoiceSessions };
export function voiceSessions() {
  return shared.clinicVoiceSessions ??= new VoiceSessions(new BookingService());
}
