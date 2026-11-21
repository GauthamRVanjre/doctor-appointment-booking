import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PostgresStore, digest, type Selection } from '../lib/booking/postgres';
import { PostgresVoiceSessions, type AgentAccess } from '../lib/booking/postgres-voice';

// Opt-in integration checks. Only rows belonging to these generated test
// sessions/bookings are removed; real demo bookings are never reset.
async function main() {
if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL locally before running verify:postgres.');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3, connectionTimeoutMillis: 5000 });
const first = new PostgresStore(pool);
const secondPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 5000 });
const second = new PostgresStore(secondPool);
const ids: string[] = [];
const keys: string[] = [];
const rollbackSlot = `integration:${randomUUID()}`;
const userHash = digest('synthetic test turn');
async function session() {
  const id = randomUUID(); ids.push(id);
  const browserToken = randomBytes(32).toString('hex'), toolToken = randomBytes(32).toString('hex');
  const row = await first.create({ id, browserToken, toolToken, channel: `test-${id}`, requesterUid: '123' });
  return { row, browserToken, toolToken };
}
try {
  const a = await session(), b = await session();
  const previousOrigin = process.env.BOOKING_APP_ORIGIN;
  try {
    process.env.BOOKING_APP_ORIGIN = 'https://clinic.example.test';
    await assert.rejects(second.create({ id: randomUUID(),browserToken: randomBytes(32).toString('hex'),
      toolToken: randomBytes(32).toString('hex'),channel: `test-limit-${randomUUID()}`,requesterUid: '123' }),/DEMO_START_LIMIT/,
      'a third active session is rejected across independent database clients');
  } finally {
    if (previousOrigin===undefined) delete process.env.BOOKING_APP_ORIGIN;
    else process.env.BOOKING_APP_ORIGIN = previousOrigin;
  }
  assert.equal((await second.authenticate(a.browserToken, 'browser'))?.id, a.row.id, 'independent connection recognizes session');
  assert.equal(await second.authenticate(a.browserToken, 'tool'), undefined, 'browser capability cannot authenticate as tool');
  assert.equal(await second.authenticate(a.toolToken, 'browser'), undefined);
  const slots = await first.available();
  assert.ok(slots.length, 'a real unbooked slot is required');
  const slot = slots[0];
  const referenceA = randomUUID(), referenceB = randomUUID();
  function pending(reference: string): Selection {
    const key = randomUUID(); keys.push(key);
    return { doctor_id: slot.doctor_id,slot_id: slot.id,demo_alias: 'Demo Guest',nonce: randomUUID(),
      approval_hash: digest(reference),readback: 'Synthetic integration review',expires_at: new Date(Date.now()+120000).toISOString(),
      idempotency_key: key,userHash };
  }
  const selectedA = await first.replacePending(a.row.id,a.row.revision,pending(referenceA));
  const selectedB = await second.replacePending(b.row.id,b.row.revision,pending(referenceB));
  assert.ok(selectedA && selectedB);
  assert.equal(await second.replacePending(a.row.id,a.row.revision,null), undefined, 'stale revision cannot clear newer review');
  const wrong = await first.confirm(a.row.id,selectedA.revision,referenceB,userHash);
  assert.equal(wrong.ok, false, 'cross-session approval rejected');
  const changedSpeech = await first.confirm(a.row.id,selectedA.revision,referenceA,digest('different turn'));
  assert.equal(changedSpeech.ok,false, 'changed observed speech cannot approve');
  const race = await Promise.all([
    first.confirm(a.row.id,selectedA.revision,referenceA,userHash),
    second.confirm(b.row.id,selectedB.revision,referenceB,userHash),
  ]);
  assert.equal(race.filter(r => r.ok).length,1,'exactly one session reserves the slot');
  assert.ok(race.some(r => !r.ok && r.code === 'SLOT_UNAVAILABLE'));
  const winner = race[0].ok ? a : b;
  const selected = race[0].ok ? selectedA : selectedB;
  const reference = race[0].ok ? referenceA : referenceB;
  const replay = await second.confirm(winner.row.id,selected.revision,reference,userHash);
  assert.ok(replay.ok && replay.replayed, 'lost-response retry returns committed booking');
  const conflictSession = await session();
  const conflictReference = randomUUID();
  const conflictSelection = { ...pending(conflictReference), idempotency_key: selected.pending_selection!.idempotency_key };
  const conflictRow = await first.replacePending(conflictSession.row.id,conflictSession.row.revision,conflictSelection);
  assert.ok(conflictRow);
  const conflict = await first.confirm(conflictRow.id,conflictRow.revision,conflictReference,userHash);
  assert.ok(!conflict.ok && conflict.code === 'IDEMPOTENCY_CONFLICT', 'same key with changed details is rejected');
  const expiredReviewSession = await session();
  const expiredReference = randomUUID();
  const expiredReview = await first.replacePending(expiredReviewSession.row.id,expiredReviewSession.row.revision,
    { ...pending(expiredReference), expires_at: new Date(Date.now()-1000).toISOString() });
  assert.ok(expiredReview);
  const expiredResult = await second.confirm(expiredReview.id,expiredReview.revision,expiredReference,userHash);
  assert.ok(!expiredResult.ok && expiredResult.code === 'APPROVAL_REQUIRED', 'expired review cannot save');
  assert.equal((await first.available()).some(s => s.id===slot.id),false,'booked slot is excluded');
  await first.emergency(winner.row.id);
  assert.equal((await second.confirm(winner.row.id,selected.revision,reference,userHash)).ok,false);
  assert.ok(replay.ok && await second.saved(replay.booking.id),'emergency preserves saved booking');
  await first.end(winner.row.id);
  assert.equal(await second.authenticate(winner.browserToken,'browser'),undefined,'ended session cannot regain authority');
  const expired = await session();
  await pool.query("UPDATE public.conversation_sessions SET expires_at=created_at+interval '1 millisecond' WHERE id=$1",[expired.row.id]);
  assert.equal(await second.authenticate(expired.browserToken,'browser'),undefined);
  await assert.rejects(first.transaction(async client => {
    await client.query(`INSERT INTO public.slots(id,doctor_id,starts_at,ends_at,timezone)
      VALUES ($1,'integration-test',now(),now()+interval '30 minutes','Asia/Kolkata')`,[rollbackSlot]);
    throw new Error('Injected write failure');
  }), /Injected write failure/);
  assert.equal((await pool.query('SELECT id FROM public.slots WHERE id=$1',[rollbackSlot])).rowCount,0,'failed transaction rolls back');
  const turns = [{ role: 'user',content: 'routine checkup' }];
  let spoken = 0;
  const access: AgentAccess = {
    history: async row => ({ agent_id: row.agent_id!,contents: [...turns] }),
    say: async row => {
      assert.ok((await second.get(row.id))?.saved_booking_id, 'confirmation speech occurs after committed save');
      spoken++;
    },
  };
  const secret = randomBytes(32).toString('hex');
  const voice = new PostgresVoiceSessions(first,secret,access);
  const cold = new PostgresVoiceSessions(second,secret,access);
  const v = await voice.create(`integration-${randomUUID()}`,'123'); ids.push(v.id);
  await voice.attach(v,'synthetic-agent');
  const authenticated = await cold.authenticate(v.browserToken,'browser'); assert.ok(authenticated);
  const available = await first.available(); assert.ok(available.length>1);
  const selection = { doctor_id: available[0].doctor_id,slot_id: available[0].id,demo_alias: 'Demo Guest' };
  await voice.tool(v,'bookAppointment',selection);
  let state = await cold.state(authenticated);
  assert.ok(state.ok && 'pending' in state && state.pending);
  const staleReference = state.pending.reference;
  turns.push({ role: 'user',content: 'choose another time' });
  assert.equal((await cold.confirm(authenticated,staleReference)).ok,false,'new observed speech invalidates approval');
  await voice.tool(v,'bookAppointment',selection);
  state = await cold.state(authenticated);
  assert.ok(state.ok && 'pending' in state && state.pending);
  const voiceReference = state.pending.reference;
  const confirmed = await cold.confirm(authenticated,voiceReference); assert.ok(confirmed.ok);
  assert.equal(spoken,1);
  assert.ok((await new PostgresVoiceSessions(second,secret,access).confirm(authenticated,voiceReference)).ok,'new service instance recognizes exact retry');
  assert.equal(spoken,1,'exact retry does not repeat success speech');
  turns.push({ role: 'user',content: 'cannot breathe' });
  assert.equal((await cold.confirm(authenticated,voiceReference)).ok,false);
  assert.equal((await first.get(v.id))?.emergency_stopped,true);
  assert.ok(await second.saved(confirmed.booking.id),'emergency does not erase saved booking');
  await cold.end(authenticated);
  assert.equal(await voice.authenticate(v.browserToken,'browser'),undefined);
  console.log('Postgres integration passed: independent connections, ownership, stale revisions, approval binding, race, retry, emergency, expiry, rollback.');
} finally {
  await pool.query('DELETE FROM public.conversation_sessions WHERE id=ANY($1::uuid[])',[ids]);
  await pool.query('DELETE FROM public.bookings WHERE conversation_hash=ANY($1::text[])',[ids.map(digest)]);
  await pool.query('DELETE FROM public.bookings WHERE idempotency_key=ANY($1::text[])',[keys]);
  await Promise.all([pool.end(),secondPool.end()]);
}
}
main().catch((error: unknown) => {
  // Report safe codes without logging a driver error/stack containing credentials.
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'UNKNOWN';
  console.error(`Postgres integration failed (${code}).`);
  if (error instanceof assert.AssertionError) console.error(error.message);
  process.exitCode = 1;
});
