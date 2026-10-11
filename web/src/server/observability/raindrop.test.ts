import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { captureEvent, captureSignal } from './raindrop';

test('Raindrop capture requires an explicit acknowledgement and never sends orphan feedback', async () => {
  const oldFetch = globalThis.fetch;
  const oldKey = process.env.RAINDROP_WRITE_KEY;
  let requests = 0;
  try {
    delete process.env.RAINDROP_WRITE_KEY;
    globalThis.fetch = async () => { requests++; return new Response(null, { status: 204 }); };
    const event = () => ({ eventId: randomUUID(), userId: 'test', event: 'test' });
    const missing = await captureEvent(event());
    assert.equal(missing.status, 'not_configured');
    await captureSignal(missing, { name: 'approved', type: 'feedback', sentiment: 'POSITIVE' });
    assert.equal(requests, 0);
    process.env.RAINDROP_WRITE_KEY = 'test-key-never-sent';
    const captured = await captureEvent(event());
    assert.equal(captured.status, 'acknowledged');
    assert.equal(captured.httpStatus, 204);
    globalThis.fetch = async () => { requests++; return new Response('{}', { status: 200 }); };
    assert.equal((await captureEvent(event())).status, 'failed');
    const matched = event();
    globalThis.fetch = async () => new Response(JSON.stringify({ events: [{ event_id: matched.eventId }] }), { status: 200 });
    assert.equal((await captureEvent(matched)).status, 'acknowledged');
    assert.equal((await captureEvent(event())).status, 'failed');
    globalThis.fetch = async () => { requests++; throw new Error('network'); };
    assert.equal((await captureEvent(event())).status, 'failed');
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.RAINDROP_WRITE_KEY;
    else process.env.RAINDROP_WRITE_KEY = oldKey;
  }
});
