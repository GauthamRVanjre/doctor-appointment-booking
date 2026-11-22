import { browserSession, sessionCookie, bookingHandler } from '@/lib/booking/http';
import { voiceSessions } from '@/lib/booking/voice-session';
export const runtime = 'nodejs';
async function get(request: Request) {
  const session = await browserSession(request);
  if (!session) return Response.json({ ok: false, code: 'SESSION_ENDED' }, { status: 401 });
  return Response.json(await voiceSessions().state(session), { headers: { 'Cache-Control': 'no-store' } });
}
async function post(request: Request) {
  const session = await browserSession(request);
  if (!session) return Response.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });
  let reference: string;
  try {
    const body = await request.json();
    if (!body || Object.keys(body).length !== 1 || typeof body.reference !== 'string') throw new Error();
    reference = body.reference;
  } catch { return Response.json({ ok: false, code: 'INVALID_ARGUMENTS' }, { status: 400 }); }
  return Response.json(await voiceSessions().confirm(session, reference), { headers: { 'Cache-Control': 'no-store' } });
}
async function remove(request: Request) {
  const session = await browserSession(request);
  if (!session) return Response.json({ ok: false }, { status: 401 });
  await voiceSessions().end(session);
  return Response.json({ ok: true }, { headers: { 'Set-Cookie': sessionCookie('',0) } });
}
export const GET = bookingHandler(get);
export const POST = bookingHandler(post);
export const DELETE = bookingHandler(remove);
