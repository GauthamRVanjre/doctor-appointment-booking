import { createHmac, timingSafeEqual } from 'node:crypto';
import { localRequest } from './http';

const NAME = 'clinic_bootstrap';
function signature(payload: string) {
  const secret = process.env.BOOKING_APPROVAL_SECRET;
  if (!secret || secret.length<32) throw new Error('Missing demo signing configuration');
  return createHmac('sha256',secret).update(`bootstrap:${payload}`).digest('hex');
}
export function deployedDemo() { return !!process.env.VERCEL || !!process.env.BOOKING_APP_ORIGIN; }
export function demoEnabled(request: Request) {
  return localRequest(request) && (!deployedDemo() || process.env.BOOKING_PUBLIC_DEMO === 'true');
}
export function bootstrapCookie(channel: string, uid: string) {
  const payload = Buffer.from(JSON.stringify({ channel,uid,expires: Date.now()+3600000 })).toString('base64url');
  return `${NAME}=${payload}.${signature(payload)}; HttpOnly; SameSite=Strict; Secure; Path=/api; Max-Age=3600`;
}
export function ownsBootstrap(request: Request, channel: string, uid: string) {
  if (!deployedDemo()) return true;
  try {
    const value = request.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(`${NAME}=`))?.slice(NAME.length+1);
    const [payload,mac] = value?.split('.') ?? [];
    if (!payload || !mac || !/^[0-9a-f]{64}$/.test(mac) || !timingSafeEqual(Buffer.from(mac),Buffer.from(signature(payload)))) return false;
    const p = JSON.parse(Buffer.from(payload,'base64url').toString());
    return p.channel===channel && p.uid===uid && p.expires>Date.now();
  } catch { return false; }
}
