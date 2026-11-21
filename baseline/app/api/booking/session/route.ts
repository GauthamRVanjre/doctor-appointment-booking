import { browserSession } from '@/lib/booking/http';
import { voiceSessions } from '@/lib/booking/voice-session';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  const session = browserSession(request);
  if (!session) return Response.json({ ok: false, code: 'SESSION_ENDED' }, { status: 401 });
  return Response.json(await voiceSessions().state(session), { headers: { 'Cache-Control': 'no-store' } });
}
export async function POST(request: Request) {
  const session = browserSession(request);
  if (!session) return Response.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });
  try {
    const body = await request.json();
    if (!body || Object.keys(body).length !== 1 || typeof body.reference !== 'string') throw new Error();
    return Response.json(await voiceSessions().confirm(session, body.reference));
  } catch { return Response.json({ ok: false, code: 'INVALID_ARGUMENTS' }, { status: 400 }); }
}
export async function DELETE(request: Request) {
  const session = browserSession(request);
  if (!session) return Response.json({ ok: false }, { status: 401 });
  voiceSessions().end(session);
  return Response.json({ ok: true }, { headers: { 'Set-Cookie': 'clinic_session=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0' } });
}
