import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Tunnel this listener only, never the Next.js listener. No token/start/stop/UI forwarding.
export function createBookingGateway() {
const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/api/booking/tools' || !/^Bearer [a-f0-9]{64}$/.test(req.headers.authorization ?? '')) {
    res.writeHead(404).end(); return;
  }
  try {
    const chunks = []; let length = 0;
    for await (const chunk of req) {
      length += chunk.length;
      if (length > 4096) { res.writeHead(413).end(); return; }
      chunks.push(chunk);
    }
    const response = await fetch('http://127.0.0.1:3000/api/booking/tools', {
      method: 'POST', headers: { Authorization: req.headers.authorization, 'Content-Type': 'application/json' },
      body: Buffer.concat(chunks), signal: AbortSignal.timeout(12000), redirect: 'error',
    });
    res.writeHead(response.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(await response.text());
  } catch { res.writeHead(502).end('{"ok":false,"code":"GATEWAY_UNAVAILABLE"}'); }
});
server.requestTimeout = 15000;
server.headersTimeout = 10000;
return server;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createBookingGateway().listen(3001, '127.0.0.1', () => console.log('Booking tools gateway listening on 127.0.0.1:3001. No tunnel started.'));
}
