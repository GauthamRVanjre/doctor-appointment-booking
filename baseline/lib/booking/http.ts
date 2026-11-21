import { voiceSessions } from './voice-session';

export const COOKIE = 'clinic_session';
export function localRequest(request: Request): boolean {
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  const trusted = process.env.BOOKING_APP_ORIGIN;
  if (trusted) {
    try {
      const target = new URL(trusted);
      if (target.protocol !== 'https:' || target.origin !== trusted) return false;
      return url.origin === trusted && (request.method === 'GET' ? !origin || origin === trusted : origin === trusted);
    } catch { return false; }
  }
  return !process.env.VERCEL && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && (!origin || origin === url.origin);
}
export async function browserSession(request: Request) {
  const token = request.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  return localRequest(request) ? voiceSessions().authenticate(token, 'browser') : undefined;
}

export function sessionCookie(token: string, maxAge = 3600) {
  return `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${maxAge}${process.env.BOOKING_APP_ORIGIN ? '; Secure' : ''}`;
}

export function bookingHandler(handler: (request: Request) => Promise<Response>) {
  return async (request: Request) => {
    try { return await handler(request); }
    catch { return Response.json({ ok: false,code: 'STORAGE_FAILURE',message: 'Booking service unavailable. Retry the same request.' },
      { status: 503,headers: { 'Cache-Control': 'no-store' } }); }
  };
}
