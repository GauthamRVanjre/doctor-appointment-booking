import { voiceSessions } from '@/lib/booking/voice-session';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  const sessions = voiceSessions();
  const session = sessions.authenticate(request.headers.get('authorization')?.replace(/^Bearer /, ''), 'tool');
  if (!session) return Response.json({ ok: false, code: 'UNAUTHORIZED', message: 'Invalid tool session.' }, { status: 401 });
  try {
    const raw = await request.text();
    if (raw.length > 4096) return Response.json({ ok: false, code: 'INVALID_ARGUMENTS' }, { status: 400 });
    const body = JSON.parse(raw);
    if (!body || Object.keys(body).some(k => !['tool', 'input'].includes(k)) || typeof body.tool !== 'string') throw new Error();
    return Response.json(await sessions.tool(session, body.tool, body.input));
  } catch { return Response.json({ ok: false, code: 'INVALID_ARGUMENTS', message: 'Invalid tool request.' }, { status: 400 }); }
}
