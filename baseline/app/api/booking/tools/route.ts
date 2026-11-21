import { voiceSessions } from '@/lib/booking/voice-session';
import { bookingHandler } from '@/lib/booking/http';
export const runtime = 'nodejs';
async function post(request: Request) {
  const sessions = voiceSessions();
  const session = await sessions.authenticate(request.headers.get('authorization')?.replace(/^Bearer /, ''), 'tool');
  if (!session) return Response.json({ ok: false, code: 'UNAUTHORIZED', message: 'Invalid tool session.' }, { status: 401 });
  let body: { tool: string; input: unknown };
  try {
    const raw = await request.text();
    if (raw.length > 4096) return Response.json({ ok: false, code: 'INVALID_ARGUMENTS' }, { status: 400 });
    body = JSON.parse(raw);
    if (!body || Object.keys(body).some(k => !['tool', 'input'].includes(k)) || typeof body.tool !== 'string') throw new Error();
  } catch { return Response.json({ ok: false, code: 'INVALID_ARGUMENTS', message: 'Invalid tool request.' }, { status: 400 }); }
  return Response.json(await sessions.tool(session, body.tool, body.input), { headers: { 'Cache-Control': 'no-store' } });
}
export const POST = bookingHandler(post);
