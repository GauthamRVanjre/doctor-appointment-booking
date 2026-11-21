import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createBookingGateway } from './booking-gateway.mjs';

const gateway = createBookingGateway();
gateway.listen(0, '127.0.0.1');
await once(gateway, 'listening');
const base = `http://127.0.0.1:${gateway.address().port}`;
const networkFetch = globalThis.fetch;
let forwarded = 0;
globalThis.fetch = async (url, options) => {
  if (url === 'http://127.0.0.1:3000/api/booking/tools') {
    forwarded++;
    assert.equal(options.headers.Authorization, `Bearer ${'a'.repeat(64)}`);
    assert.equal(Buffer.from(options.body).toString(), '{"tool":"findDoctors","input":{"concern":"routine"}}');
    return Response.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 });
  }
  return networkFetch(url, options);
};
try {
  for (const path of ['/', '/api/generate-agora-token', '/api/invite-agent', '/api/stop-conversation', '/api/booking/session', '/api/chat/completions', '/api/booking/tools?x=1']) {
    const response = await fetch(base + path, { method: 'POST', headers: { Authorization: `Bearer ${'a'.repeat(64)}` }, signal: AbortSignal.timeout(3000) });
    assert.equal(response.status, 404, path);
  }
  assert.equal((await fetch(base + '/api/booking/tools', { method: 'POST', signal: AbortSignal.timeout(3000) })).status, 404);
  assert.equal((await fetch(base + '/api/booking/tools', { headers: { Authorization: `Bearer ${'a'.repeat(64)}` }, signal: AbortSignal.timeout(3000) })).status, 404);
  assert.equal(forwarded, 0);
  const allowed = await fetch(base + '/api/booking/tools', { method: 'POST', headers: { Authorization: `Bearer ${'a'.repeat(64)}` }, body: '{"tool":"findDoctors","input":{"concern":"routine"}}', signal: AbortSignal.timeout(3000) });
  assert.equal(allowed.status, 401, 'Gateway preserves the application authorization failure');
  assert.equal(forwarded, 1);
  assert.equal((await allowed.json()).code, 'UNAUTHORIZED');
  assert.equal((await fetch(base + '/api/booking/tools', { method: 'POST', headers: { Authorization: `Bearer ${'a'.repeat(64)}` }, body: 'a'.repeat(4097), signal: AbortSignal.timeout(3000) })).status, 413);
  assert.equal(forwarded, 1, 'Oversize bodies are not forwarded');
  console.log('Gateway checks passed: blocked UI/token/invite/stop/approval/LLM routes, altered paths, missing auth and wrong methods. No public tunnel.');
} finally { globalThis.fetch = networkFetch; gateway.closeAllConnections(); await new Promise(resolve => gateway.close(resolve)); }
