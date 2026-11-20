import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { BookingService } from '../lib/booking/service';
import { clinic, localDate, schedule } from '../lib/booking/config';

const fixed = () => new Date('2026-11-20T09:00:00Z');
const details = (slot: string) => ({ doctor_id: clinic.doctorId, slot_id: slot, demo_alias: 'Demo Patient' });
function prepared(s: BookingService, conversation: string, slot: string, key: string) {
  const p = s.prepare_selection(conversation, details(slot));
  assert(p.ok);
  assert(p.readback.includes('Dr. Ramesh') && p.readback.includes('Asia/Kolkata'));
  assert(s.approvals.approve(conversation, p.approval_reference));
  return { ...details(slot), approval_reference: p.approval_reference, idempotency_key: key };
}

async function main() {
  const folder = mkdtempSync(join(tmpdir(), 'clinic-test-'));
  const path = join(folder, 'clinic.sqlite');
  let service = new BookingService(path, fixed);
  try {
    assert.equal(service.find_doctors({ concern: 'I need Dr. Ramesh' }).ok, true);
    assert.equal(service.find_doctors({ concern: 'routine checkup' }).ok, true);
    assert.deepEqual(service.find_doctors({ concern: 'dentist for tooth extraction' }).ok, false);
    const emergency = service.find_doctors({ concern: 'chest pain' });
    assert(!emergency.ok && emergency.code === 'EMERGENCY_REDIRECTION');
    assert(emergency.message.includes('112') && emergency.message.includes('ambulance'));
    const safety = new BookingService(':memory:', fixed);
    try {
      const safetySlot = schedule(fixed())[0].id;
      const approvedBeforeEmergency = prepared(safety, 'danger-conversation', safetySlot, 'danger-retry-key');
      const redirected = safety.find_doctors({ concern: 'Dr. Ramesh please, the patient is unconscious' }, 'danger-conversation');
      assert(!redirected.ok && redirected.code === 'EMERGENCY_REDIRECTION');
      const blocked = safety.book_appointment(approvedBeforeEmergency, 'danger-conversation');
      assert(!blocked.ok && blocked.code === 'EMERGENCY_REDIRECTION');
      assert(!safety.prepare_selection('danger-conversation', details(safetySlot)).ok);
      assert(!safety.find_doctors({ concern: 'routine checkup' }, 'danger-conversation').ok);
      const stillFree = safety.get_available_slots({ doctor_id: clinic.doctorId });
      assert(stillFree.ok && stillFree.slots.some(s => s.id === safetySlot));
      assert(safety.prepare_selection('other-conversation', details(safetySlot)).ok);
      safety.end_conversation('danger-conversation');
    } finally { safety.close(); }
    assert(!service.find_doctors({ concern: '' }).ok);
    assert(!service.get_available_slots({ doctor_id: clinic.doctorId, start_date: '2026-11-31' }).ok);
    assert(!service.get_available_slots({ doctor_id: clinic.doctorId, end_date: '2026-11-27' }).ok);
    const all = service.get_available_slots({ doctor_id: clinic.doctorId });
    assert(all.ok);
    assert.equal(all.slots.length, 24);
    for (const slot of all.slots) {
      assert([1, 2, 4, 5].includes(new Date(slot.starts_at).getUTCDay()));
      assert.equal(Date.parse(slot.ends_at) - Date.parse(slot.starts_at), 1_800_000);
      assert.equal(slot.timezone, 'Asia/Kolkata');
    }
    assert.equal(all.slots[0].starts_at, '2026-11-20T11:30:00.000Z');
    assert.equal(localDate(new Date('2026-11-20T19:00:00Z')), '2026-11-21');
    assert(schedule(new Date('2026-11-20T12:00:00Z')).every(s => Date.parse(s.starts_at) > Date.parse('2026-11-20T12:00:00Z')));
    const closed = service.get_available_slots({ doctor_id: clinic.doctorId, start_date: '2026-11-25', end_date: '2026-11-25', preferred_time: '18:00' });
    assert(closed.ok && closed.slots.length === 0 && closed.alternatives.length > 0);
    const unavailableTime = service.get_available_slots({ doctor_id: clinic.doctorId, preferred_time: '16:00' });
    assert(unavailableTime.ok && unavailableTime.slots.length === 0 && unavailableTime.alternatives.length > 0);
    const slot = all.slots[0].id;
    const request = prepared(service, 'conversation-one', slot, 'retry-key-one');
    const wrongConversation = service.book_appointment(request, 'conversation-two');
    assert(!wrongConversation.ok && wrongConversation.code === 'APPROVAL_REQUIRED');
    assert(!service.book_appointment({ ...request, approved: true }, 'conversation-one').ok);
    const saved = service.book_appointment(request, 'conversation-one');
    assert(saved.ok && !saved.replayed);
    const replay = service.book_appointment(request, 'conversation-one');
    assert(replay.ok && replay.replayed && replay.booking.id === saved.booking.id);
    const conflict = service.book_appointment({ ...request, demo_alias: 'Demo Guest' }, 'conversation-one');
    assert(!conflict.ok && conflict.code === 'IDEMPOTENCY_CONFLICT');
    const after = service.get_available_slots({ doctor_id: clinic.doctorId });
    assert(after.ok && !after.slots.some(s => s.id === slot));
    assert(!service.prepare_selection('conversation-two', details('invented-slot')).ok);
    const stale = prepared(service, 'conversation-two', all.slots[1].id, 'retry-key-two');
    service.prepare_selection('conversation-two', details(all.slots[2].id));
    const staleResult = service.book_appointment(stale, 'conversation-two');
    assert(!staleResult.ok && staleResult.code === 'APPROVAL_REQUIRED');
    service.close();
    service = new BookingService(path, fixed);
    const persisted = service.book_appointment(request, 'conversation-one');
    assert(persisted.ok && persisted.booking.id === saved.booking.id);
    assert(!service.book_appointment(stale, 'conversation-two').ok);

    let instant = fixed();
    const expiring = new BookingService(':memory:', () => instant);
    const expiryRequest = prepared(expiring, 'expiry-conversation', all.slots[1].id, 'expiry-key');
    instant = new Date(instant.getTime() + 120_001);
    const expired = expiring.book_appointment(expiryRequest, 'expiry-conversation');
    assert(!expired.ok && expired.code === 'APPROVAL_REQUIRED');
    expiring.close();

    const db = new DatabaseSync(path);
    db.exec("CREATE TRIGGER reject_booking BEFORE INSERT ON bookings BEGIN SELECT RAISE(ABORT, 'injected failure'); END;");
    const failureRequest = prepared(service, 'failure-conversation', all.slots[1].id, 'failure-key');
    const failure = service.book_appointment(failureRequest, 'failure-conversation');
    assert(!failure.ok && failure.code === 'STORAGE_FAILURE');
    assert.equal(db.prepare('SELECT count(*) AS n FROM bookings').get()?.n, 1);
    db.exec('DROP TRIGGER reject_booking');
    assert(service.book_appointment(failureRequest, 'failure-conversation').ok);
    db.close();

    const racers = ['racer-one', 'racer-two'].map(id => fork(fileURLToPath(import.meta.url), ['worker', path, id, all.slots[2].id], { execArgv: ['--import', 'tsx'], stdio: ['ignore', 'inherit', 'inherit', 'ipc'] }));
    try {
      const ready = racers.map(child => new Promise<void>((resolve, reject) => {
        child.once('message', msg => msg === 'ready' ? resolve() : reject(new Error('Worker failed')));
        child.once('error', reject);
        child.once('exit', code => { if (code) reject(new Error(`Worker exited ${code}`)); });
      }));
      await Promise.all(ready);
      const results = racers.map(child => new Promise<{ ok: boolean; code?: string }>((resolve, reject) => {
        child.once('message', msg => resolve(msg as { ok: boolean; code?: string }));
        child.once('error', reject);
      }));
      racers.forEach(child => child.send('go'));
      const outcomes = await Promise.all(results);
      assert.equal(outcomes.filter(r => r.ok).length, 1);
      assert.equal(outcomes.filter(r => r.code === 'SLOT_UNAVAILABLE').length, 1);
      await Promise.all(racers.map(child => new Promise<void>(resolve => child.exitCode !== null ? resolve() : child.once('exit', () => resolve()))));
    } finally { racers.forEach(child => { if (child.exitCode === null) child.kill(); }); }
    const audit = new DatabaseSync(path);
    assert.equal(audit.prepare('SELECT count(*) AS n FROM bookings WHERE slot_id = ?').get(all.slots[2].id)?.n, 1);
    assert.equal(audit.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get()?.n, 2);
    audit.close();
    console.log('Booking verification passed: directory, safety, schedule/timezone, validation, approval expiry/change/binding, persistence, retry/conflict, rollback, two-process reservation race.');
  } finally { service.close(); rmSync(folder, { recursive: true, force: true }); }
}

if (process.argv[2] === 'worker') {
  const [, , , path, id, slot] = process.argv;
  const service = new BookingService(path, fixed);
  const request = prepared(service, id, slot, `${id}-key`);
  process.once('message', () => {
    const result = service.book_appointment(request, id);
    service.close();
    process.send?.(result, () => process.disconnect());
  });
  process.send?.('ready');
} else {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
