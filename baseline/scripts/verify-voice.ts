import assert from 'node:assert/strict';
import { BookingService } from '../lib/booking/service';
import { VoiceSessions } from '../lib/booking/voice-session';
import { bookingTools } from '../lib/booking/tools';
import { POST as toolRoute } from '../app/api/booking/tools/route';
import { GET as stateRoute, POST as confirmationRoute } from '../app/api/booking/session/route';
import { localRequest, sessionCookie, bookingHandler } from '../lib/booking/http';
import { bootstrapCookie, ownsBootstrap, demoEnabled } from '../lib/booking/demo-access';

async function main() {
const now = new Date('2026-11-20T08:00:00Z');
const booking = new BookingService(':memory:', () => now);
const sessions = new VoiceSessions(booking, () => now.getTime());
(globalThis as typeof globalThis & { clinicVoiceSessions?: VoiceSessions }).clinicVoiceSessions = sessions;
const history: { role: string; content: string }[] = [{ role: 'user', content: 'routine checkup' }];
const spoken: string[] = [];
const session = sessions.create();
sessions.attach(session, 'agent-one', async () => ({ agent_id: 'agent-one', contents: history }), async text => { spoken.push(text); });
const other = sessions.create();
sessions.attach(other, 'agent-two', async () => ({ agent_id: 'agent-two', contents: [] }), async () => {});
const code = (result: unknown) => (result as { code?: string }).code;
try {
  assert.equal(sessions.authenticate(session.browserToken, 'tool'), undefined);
  assert.equal(sessions.authenticate(session.toolToken, 'browser'), undefined);
  assert.equal(sessions.authenticate('forged', 'tool'), undefined);
  assert.equal(sessions.authenticate(session.toolToken, 'tool')?.id, session.id);
  assert.equal(localRequest(new Request('http://localhost:3000/api/booking/session', { headers: { Origin: 'https://evil.test' } })), false);
  assert.equal(localRequest(new Request('https://public.test/api/booking/session')), false);

  assert.equal((await toolRoute(new Request('http://localhost:3000/api/booking/tools', { method: 'POST', body: '{}' }))).status, 401);
  assert.equal((await stateRoute(new Request('http://localhost:3000/api/booking/session', { headers: { Cookie: `clinic_session=${session.toolToken}` } }))).status, 401);
  assert.equal((await confirmationRoute(new Request('http://localhost:3000/api/booking/session', { method: 'POST', headers: { Cookie: `clinic_session=${session.browserToken}`, Origin: 'https://evil.test' }, body: '{}' }))).status, 401);
  assert.equal((await confirmationRoute(new Request('http://localhost:3000/api/booking/session', { method: 'POST', headers: { Cookie: `clinic_session=${session.browserToken}` }, body: JSON.stringify({ reference: 'forged', approved: true }) }))).status, 400);

  const tools = bookingTools('https://tools.example.test', session.toolToken);
  assert.deepEqual(tools.map(t => t.function.name), ['findDoctors', 'getAvailableSlots', 'bookAppointment']);
  assert(!JSON.stringify(tools.map(t => t.function)).includes(session.toolToken));
  assert(tools.every(t => !JSON.stringify(t.function).includes('approval_reference')));
  assert(tools.every(t => Object.keys(t.function.parameters.properties ?? {}).every(k => t.function.parameters.required?.includes(k))));
  assert.equal(code(await sessions.tool(session, 'findDoctors', { concern: 'dentist' })), 'NO_MATCH');
  const unavailable = await sessions.tool(session, 'getAvailableSlots', { doctor_id: 'dr-ramesh', start_date: '2026-11-25', end_date: '2026-11-25', preferred_time: '18:00' });
  assert('slots' in unavailable && unavailable.slots.length === 0 && unavailable.alternatives.length > 0);
  const available = booking.get_available_slots({ doctor_id: 'dr-ramesh' });
  assert(available.ok && available.slots.length > 1);
  const selection = { doctor_id: 'dr-ramesh', slot_id: available.slots[0].id, demo_alias: 'Demo Patient' };
  assert.equal(code(await sessions.tool(session, 'bookAppointment', { ...selection, approved: true })), 'INVALID_ARGUMENTS');
  assert.equal(code(await sessions.tool(session, 'approve', selection)), 'UNKNOWN_TOOL');
  const review = await sessions.tool(session, 'bookAppointment', selection);
  assert.equal(code(review), 'ON_SCREEN_APPROVAL_REQUIRED');
  assert('readback' in review && review.readback.includes('Dr. Ramesh') && review.readback.includes('Asia/Kolkata'));
  assert(!review.readback.includes('Demo Patient') && !review.readback.includes('30 minutes') && !review.readback.includes('UTC+05:30'));
  let state = await sessions.state(session);
  assert(state.pending && state.pending.readback.includes('Dr. Ramesh') && state.pending.readback.includes('Asia/Kolkata') && state.pending.readback.includes('Demo Care Clinic'));
  const firstReference = state.pending.reference;
  assert.equal(code(await sessions.confirm(other, firstReference)), 'APPROVAL_REQUIRED');
  assert.equal(spoken.length, 0, 'No success speech before commit');
  history.push({ role: 'user', content: 'yes' });
  assert.equal(code(await sessions.confirm(session, firstReference)), 'APPROVAL_REQUIRED', 'Speech alone cannot authorize');
  await sessions.tool(session, 'bookAppointment', selection);
  state = await sessions.state(session); assert(state.pending);
  const reference = state.pending.reference;
  const saved = await sessions.confirm(session, reference);
  assert(saved.ok && 'booking' in saved);
  assert(spoken[0].includes('confirmed and saved'));
  assert(spoken[0].includes('Dr. Ramesh'));
  assert(!spoken[0].includes(saved.booking.id), 'Saved reference stays on the card, not in speech');
  const retry = await sessions.confirm(session, reference);
  assert(retry.ok && 'booking' in retry && retry.booking.id === saved.booking.id);
  const after = booking.get_available_slots({ doctor_id: 'dr-ramesh' });
  assert(after.ok && !after.slots.some(s => s.id === selection.slot_id));
  assert.equal(spoken.length, 1, 'Retry does not duplicate confirmation');
  const toolRetry = await sessions.tool(session, 'bookAppointment', selection);
  assert(toolRetry.ok && 'booking' in toolRetry && toolRetry.booking.id === saved.booking.id);

  await sessions.tool(session, 'bookAppointment', { ...selection, slot_id: available.slots[1].id });
  state = await sessions.state(session); assert(state.pending);
  history.push({ role: 'user', content: 'I have chest pain' });
  assert.equal(code(await sessions.confirm(session, state.pending.reference)), 'EMERGENCY_REDIRECTION');
  assert.equal(code(await sessions.tool(session, 'bookAppointment', { ...selection, slot_id: available.slots[1].id })), 'EMERGENCY_REDIRECTION');
  assert.equal((await sessions.state(session)).pending, undefined);
  assert((await sessions.state(session)).saved, 'Emergency does not delete an existing booking');
  sessions.end(session);
  assert.equal(sessions.authenticate(session.toolToken, 'tool'), undefined);
  assert.equal(code(await sessions.confirm(session, reference)), 'SESSION_ENDED');

  sessions.attach(other, 'agent-two', async () => ({ agent_id: 'agent-two', contents: [] }), async () => {});
  await sessions.tool(other, 'bookAppointment', { ...selection, slot_id: available.slots[1].id });
  const expiring = await sessions.state(other); assert(expiring.pending);
  now.setTime(now.getTime() + 120_001);
  assert.equal(code(await sessions.confirm(other, expiring.pending.reference)), 'APPROVAL_REQUIRED');

  sessions.attach(other, 'agent-two', async () => { throw new Error('offline'); }, async () => {});
  assert.equal(code(await sessions.tool(other, 'findDoctors', { concern: 'routine' })), 'HISTORY_UNAVAILABLE');
  assert.equal(code(await sessions.confirm(other, reference)), 'HISTORY_UNAVAILABLE');
  sessions.attach(other, 'agent-two', async () => ({ agent_id: 'wrong-agent', contents: [] }), async () => {});
  assert.equal(code(await sessions.state(other)), 'HISTORY_UNAVAILABLE');
  const oldOrigin = process.env.BOOKING_APP_ORIGIN;
  const oldSecret = process.env.BOOKING_APPROVAL_SECRET;
  const oldDemo = process.env.BOOKING_PUBLIC_DEMO;
  try {
    process.env.BOOKING_APP_ORIGIN = 'https://clinic.example.test';
    process.env.BOOKING_APPROVAL_SECRET = 'synthetic-test-secret-with-at-least-32-characters';
    const ownedCookie = bootstrapCookie('owned-channel','123').split(';')[0];
    const ownedRequest = new Request('https://clinic.example.test/api/invite-agent',{ method: 'POST',headers: { Cookie: ownedCookie,Origin: 'https://clinic.example.test' } });
    assert.equal(ownsBootstrap(ownedRequest,'owned-channel','123'),true);
    assert.equal(ownsBootstrap(ownedRequest,'other-channel','123'),false);
    assert.equal(ownsBootstrap(ownedRequest,'owned-channel','456'),false);
    assert.equal(ownsBootstrap(new Request('https://clinic.example.test'),'owned-channel','123'),false);
    delete process.env.BOOKING_PUBLIC_DEMO;
    assert.equal(demoEnabled(ownedRequest),false);
    process.env.BOOKING_PUBLIC_DEMO = 'true';
    assert.equal(demoEnabled(ownedRequest),true);
    assert.equal(localRequest(new Request('https://clinic.example.test/api/booking/session',{ method: 'POST' })),false);
    assert.equal(localRequest(new Request('https://clinic.example.test/api/booking/session',{ method: 'POST',headers: { Origin: 'https://evil.test' } })),false);
    assert.equal(localRequest(new Request('https://clinic.example.test/api/booking/session',{ method: 'POST',headers: { Origin: 'https://clinic.example.test' } })),true);
    assert.ok(sessionCookie('test').includes('; Secure'));
    const unavailable = await bookingHandler(async () => { throw new Error('private connection details'); })(new Request('https://clinic.example.test'));
    assert.equal(unavailable.status,503);
    assert.equal((await unavailable.text()).includes('private connection'),false);
  } finally {
    if (oldOrigin === undefined) delete process.env.BOOKING_APP_ORIGIN;
    else process.env.BOOKING_APP_ORIGIN = oldOrigin;
    if (oldSecret===undefined) delete process.env.BOOKING_APPROVAL_SECRET; else process.env.BOOKING_APPROVAL_SECRET = oldSecret;
    if (oldDemo===undefined) delete process.env.BOOKING_PUBLIC_DEMO; else process.env.BOOKING_PUBLIC_DEMO = oldDemo;
  }
  console.log('Voice boundary checks passed: tool/session isolation, unavailable recovery, model rejection, on-screen approval, commit/speech ordering, retries, emergency, cleanup and fail-closed history. No live voice claim.');
} finally { booking.close(); }

}
main().catch(error => { console.error(error); process.exitCode = 1; });
