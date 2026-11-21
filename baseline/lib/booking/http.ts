import { voiceSessions } from './voice-session';

export const COOKIE = 'clinic_session';
export function localRequest(request: Request): boolean {
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && (!origin || origin === url.origin);
}
export function browserSession(request: Request) {
  const token = request.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  return localRequest(request) ? voiceSessions().authenticate(token, 'browser') : undefined;
}
