import { randomUUID } from 'node:crypto';
import { clinic, type Slot } from './config';

export type Pending = { reference: string; conversation: string; slot: Slot; alias: string; expiresAt: number; approved: boolean; readback: string };

// Internal trusted-server seam. Never register prepare/approve as LLM tools.
export class ApprovalStore {
  private pending = new Map<string, Pending>();
  constructor(private readonly clock: () => Date = () => new Date()) {}

  prepare(conversation: string, slot: Slot, alias: string): Pending {
    this.prune();
    const dateTime = new Intl.DateTimeFormat('en-IN', { timeZone: clinic.timezone,
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(slot.starts_at));
    const pending: Pending = { reference: randomUUID(), conversation, slot: { ...slot }, alias,
      expiresAt: this.clock().getTime() + 120_000, approved: false,
      readback: `${clinic.doctorName}, ${clinic.clinicName}, ${dateTime}, ${clinic.timezone} (UTC+05:30), 30 minutes, for ${alias}. Do you explicitly approve this booking?` };
    this.pending.set(conversation, pending);
    return structuredClone(pending);
  }

  // Caller must establish readback completion and explicit approval; a model flag is not evidence.
  approve(conversation: string, reference: string): boolean {
    this.prune();
    const pending = this.pending.get(conversation);
    if (!pending || pending.reference !== reference) return false;
    pending.approved = true;
    return true;
  }

  matches(conversation: string, reference: string, slot: Slot, alias: string): boolean {
    this.prune();
    const p = this.pending.get(conversation);
    return !!p && p.approved && p.reference === reference && p.alias === alias &&
      p.slot.id === slot.id && p.slot.doctor_id === slot.doctor_id && p.slot.starts_at === slot.starts_at &&
      p.slot.ends_at === slot.ends_at && p.slot.timezone === slot.timezone;
  }

  clear(conversation: string): void { this.pending.delete(conversation); }
  private prune(): void {
    for (const [id, p] of this.pending) if (p.expiresAt <= this.clock().getTime()) this.pending.delete(id);
  }
}
