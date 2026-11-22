import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { AgoraClient, Area, generateConvoAIToken } from 'agora-agents';
import { DEFAULT_AGENT_UID } from '../agora';
import { clinic, addDays, localDate } from './config';
import { digest, PostgresStore, type StoredSession, type Selection } from './postgres';
import type { Session } from './voice-session';

type History = { agent_id?: string; contents?: { role?: string; content?: string }[] };
export type AgentAccess = {
  history(s: StoredSession): Promise<History>;
  say(s: StoredSession, text: string): Promise<unknown>;
};
const fail = (code: string, message: string) => ({ ok: false as const, code, message });
const emergencyMessage = 'Do not wait for a routine appointment. In India, call 112 now and request an ambulance for emergency care. Outside India, call your local emergency number. This assistant cannot assess or treat emergencies.';
const danger = /\b(chest pain|cannot breathe|can.t breathe|difficulty breathing|not breathing|severe bleeding|bleeding heavily|unconscious|unresponsive|heart attack|stroke|suicid\w*|overdose|severe danger|life.threatening)\b/i;
function object(input: unknown, fields: string[]): Record<string, unknown> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !fields.includes(k))) return;
  return input as Record<string, unknown>;
}
function handle(s: StoredSession): Session {
  // Ephemeral request handle only; never used as the source of authority.
  return { id: s.id, agentId: s.agent_id ?? undefined, browserToken: '',toolToken: '',
    expiresAt: s.expires_at.getTime(),ended: !!s.ended_at,queue: Promise.resolve() };
}
function agentClient(s: StoredSession) {
  const appId = process.env.NEXT_PUBLIC_AGORA_APP_ID;
  const appCertificate = process.env.NEXT_AGORA_APP_CERTIFICATE;
  if (!appId || !appCertificate) throw new Error('Missing Agora configuration');
  return new AgoraClient({ area: Area.US,appId,appCertificate,
    authToken: generateConvoAIToken({ appId,appCertificate,channelName: s.channel,uid: DEFAULT_AGENT_UID,tokenExpire: 60 }) });
}
const agentAccess: AgentAccess = {
  history: s => agentClient(s).agents.getHistory({ appid: process.env.NEXT_PUBLIC_AGORA_APP_ID!, agentId: s.agent_id! }, { timeoutInSeconds: 4, maxRetries: 0 }),
  say: (s,text) => agentClient(s).agents.speak({ appid: process.env.NEXT_PUBLIC_AGORA_APP_ID!, agentId: s.agent_id!,text,priority: 'INTERRUPT',interruptable: false }, { timeoutInSeconds: 4,maxRetries: 0 }),
};

export class PostgresVoiceSessions {
  constructor(readonly store: PostgresStore, private secret: string, private agent: AgentAccess = agentAccess) {
    if (secret.length < 32) throw new Error('BOOKING_APPROVAL_SECRET must contain at least 32 characters');
  }
  private reference(id: string, nonce: string) {
    return createHmac('sha256',this.secret).update(`${id}:${nonce}`).digest('hex');
  }
  async create(channel = '', requesterUid = '') {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(channel) || !/^\d{1,10}$/.test(requesterUid)) throw new Error('Invalid session identity');
    const browserToken = randomBytes(32).toString('hex'), toolToken = randomBytes(32).toString('hex');
    const row = await this.store.create({ id: randomUUID(),browserToken,toolToken,channel,requesterUid });
    return { ...handle(row),browserToken,toolToken };
  }
  async authenticate(token: string | undefined, kind: 'browser' | 'tool') {
    const row = await this.store.authenticate(token,kind);
    return row ? handle(row) : undefined;
  }
  async attach(s: Session, id: string, _history?: () => Promise<History>, _say?: (text: string) => Promise<void>) {
    await this.store.attach(s.id,id); s.agentId = id;
  }
  async end(s: Session) { await this.store.end(s.id); }

  private async guard(s: Session) {
    const row = await this.store.get(s.id);
    if (!row || row.ended_at || row.expires_at.getTime() <= Date.now()) return fail('SESSION_ENDED','Start a new conversation.');
    if (row.emergency_stopped) return fail('EMERGENCY_REDIRECTION',emergencyMessage);
    if (!row.agent_id) return fail('SESSION_NOT_READY','The voice session is not ready.');
    let history: History;
    try { history = await this.agent.history(row); }
    catch { return fail('HISTORY_UNAVAILABLE','Cannot check the current conversation. Booking is paused; try again.'); }
    if (history.agent_id !== row.agent_id || !Array.isArray(history.contents)) return fail('HISTORY_UNAVAILABLE','Conversation verification failed.');
    const turns = history.contents.filter(t => t.role === 'user');
    if (turns.some(t => danger.test(t.content ?? ''))) {
      await this.store.emergency(row.id);
      try { await this.agent.say(row,emergencyMessage); } catch { /* stop is durable even if speech fails */ }
      return fail('EMERGENCY_REDIRECTION',emergencyMessage);
    }
    const userHash = digest(JSON.stringify(turns));
    if (row.pending_selection && (row.pending_selection.userHash !== userHash || Date.parse(row.pending_selection.expires_at)<=Date.now())) {
      const updated = await this.store.replacePending(row.id,row.revision,null);
      if (!updated) return fail('STALE_SELECTION','The conversation changed. Review again.');
      return { ok: true as const,row: updated,userHash,notice: 'Review expired or new speech changed the conversation. Select again.' };
    }
    // Check that the history fetch did not race an end/selection/emergency change.
    const latest = await this.store.get(row.id);
    if (!latest || latest.ended_at || latest.emergency_stopped || latest.revision !== row.revision)
      return fail('STALE_SELECTION','The conversation changed. Review again.');
    return { ok: true as const,row,userHash,notice: undefined };
  }

  async tool(s: Session, name: string, input: unknown) {
    const g = await this.guard(s); if (!g.ok) return g;
    if (!['findDoctors','getAvailableSlots','bookAppointment'].includes(name)) return fail('UNKNOWN_TOOL','Unknown booking tool.');
    // Invalidate before any attempted selection change, including invalid input.
    const row = await this.store.replacePending(s.id,g.row.revision,null);
    if (!row) return fail('STALE_SELECTION','The conversation changed. Try again.');
    if (name === 'findDoctors') {
      const p = object(input,['concern']);
      if (!p || typeof p.concern !== 'string' || !p.concern.trim() || p.concern.length>500) return fail('INVALID_ARGUMENTS','Provide a concern of 1–500 characters.');
      if (danger.test(p.concern)) { await this.store.emergency(s.id); return fail('EMERGENCY_REDIRECTION',emergencyMessage); }
      if (/\b(ramesh|general physician|general doctor)\b/i.test(p.concern) || clinic.keywords.some(k => new RegExp(`\\b${k}\\b`,'i').test(p.concern as string))) return { ok: true,doctors: [clinic] };
      return fail('NO_MATCH','The demo directory contains only Dr. Ramesh for routine general physician consultations.');
    }
    if (name === 'getAvailableSlots') {
      const p = object(input,['doctor_id','start_date','end_date','preferred_time']);
      if (!p || p.doctor_id !== clinic.doctorId) return fail('INVALID_ARGUMENTS','Use a configured doctor_id.');
      const today = localDate(new Date());
      const start = p.start_date === '' || p.start_date === undefined ? today : p.start_date;
      const end = p.end_date === '' || p.end_date === undefined ? addDays(today,6) : p.end_date;
      const time = p.preferred_time;
      const validDate = (v: unknown): v is string => typeof v==='string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0,10)===v;
      if (!validDate(start) || !validDate(end) || start<today || end>addDays(today,6) || end<start ||
          (time !== undefined && time !== '' && (typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)))) return fail('INVALID_ARGUMENTS','Use dates in the upcoming seven local days and HH:mm time.');
      const available = await this.store.available();
      const range = available.filter(s => localDate(new Date(s.starts_at))>=start && localDate(new Date(s.starts_at))<=end);
      const slots = range.filter(s => !time || new Date(Date.parse(s.starts_at)+330*60000).toISOString().slice(11,16)===time);
      return { ok: true,slots,alternatives: slots.length ? [] : (range.length ? range : available).slice(0,6) };
    }
    const p = object(input,['doctor_id','slot_id','demo_alias']);
    if (!p || Object.keys(p).length !== 3 || p.doctor_id!==clinic.doctorId || typeof p.slot_id!=='string' ||
        (p.demo_alias!=='Demo Patient' && p.demo_alias!=='Demo Guest')) return fail('INVALID_ARGUMENTS','Use a server slot and fictional alias.');
    if (row.saved_booking_id) {
      const saved = await this.store.saved(row.saved_booking_id);
      if (saved && saved.slot.id===p.slot_id && saved.booking.demo_alias===p.demo_alias) return saved;
    }
    const slot = (await this.store.available()).find(s => s.id===p.slot_id);
    if (!slot) return fail('SLOT_UNAVAILABLE','Choose a currently available server slot.');
    const date = new Intl.DateTimeFormat('en-IN',{ timeZone: clinic.timezone,weekday: 'long',year: 'numeric',month: 'long',day: 'numeric',hour: 'numeric',minute: '2-digit',hour12: true }).format(new Date(slot.starts_at));
    const readback = `${clinic.doctorName}, ${clinic.clinicName}, ${date}, ${clinic.timezone}. Please review and confirm on screen.`;
    const nonce = randomUUID();
    const pending: Selection = { doctor_id: clinic.doctorId,slot_id: slot.id,demo_alias: p.demo_alias as Selection['demo_alias'],
      nonce,approval_hash: digest(this.reference(s.id,nonce)),readback,expires_at: new Date(Date.now()+120000).toISOString(),idempotency_key: randomUUID(),userHash: g.userHash };
    if (!await this.store.replacePending(s.id,row.revision,pending)) return fail('STALE_SELECTION','The conversation changed. Select again.');
    return { ok: false,code: 'ON_SCREEN_APPROVAL_REQUIRED',readback,message: 'Not booked. On-screen confirmation is required to save. Say only the readback once.' };
  }

  async state(s: Session) {
    const g = await this.guard(s);
    if (!g.ok) {
      const row = await this.store.get(s.id);
      return { ...g,emergency: g.code==='EMERGENCY_REDIRECTION' ? emergencyMessage : undefined,
        saved: row?.saved_booking_id ? await this.store.saved(row.saved_booking_id) : undefined };
    }
    const p = g.row.pending_selection;
    return { ok: true,pending: p ? { reference: this.reference(s.id,p.nonce),readback: p.readback,expires_at: p.expires_at } : undefined,
      saved: g.row.saved_booking_id ? await this.store.saved(g.row.saved_booking_id) : undefined,notice: g.notice };
  }
  async confirm(s: Session, reference: string) {
    if (!/^[0-9a-f]{64}$/.test(reference)) return fail('APPROVAL_REQUIRED','Review a fresh selection.');
    const g = await this.guard(s); if (!g.ok) return g;
    const p = g.row.pending_selection;
    if (p && this.reference(s.id,p.nonce)!==reference) return fail('APPROVAL_REQUIRED','Review a fresh selection.');
    const saved = await this.store.confirm(s.id,g.row.revision,reference,g.userHash);
    if (saved.ok && !saved.replayed) {
      const date = new Intl.DateTimeFormat('en-IN',{ timeZone: clinic.timezone,weekday: 'long',month: 'long',day: 'numeric',hour: 'numeric',minute: '2-digit',hour12: true }).format(new Date(saved.slot.starts_at));
      try { await this.agent.say(g.row,`Your booking is confirmed and saved with ${clinic.doctorName} on ${date}, India time.`); }
      catch { /* Committed booking remains saved; state polling retrieves it. */ }
    }
    return saved;
  }
}
