// F9c · End-of-link outbox (platform-hub/link-end.js): persisted before any attempt, retried with backoff, idempotent by eventId, dropped on a
// final refusal or after 30 days, survives a restart, and never throws to the erasure that queued it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempData } from './helpers.mjs';

const { createLinkEndNotifier, LINK_ENDED_PATH } = await import('../platform-hub/link-end.js');
const client = { baseUrl: 'http://platform.test', keyId: 'bunker-out-1', secret: Buffer.alloc(32, 7) };
const PERSON = '8b0f0f0e-0000-4000-8000-000000000001';

function harness({ answers }) {
  const dir = tempData();
  let clock = Date.parse('2026-11-14T10:00:00.000Z');
  const calls = [], events = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body.toString('utf8')) });
    const next = answers.shift() ?? 200;
    if (next === 'network') throw new TypeError('fetch failed');
    const body = JSON.parse(init.body.toString('utf8'));
    return new Response(JSON.stringify(next === 200 ? { v: 1, eventId: body.eventId, status: 'revoked' } : { error: 'x' }), { status: next });
  };
  const make = () => createLinkEndNotifier({ client, dataDir: dir, secEvent: (e, o) => events.push([e, o]), saveDb: () => {}, fetchImpl, now: () => clock, setTimer: () => null });
  return { dir, calls, events, make, tick: ms => { clock += ms; }, outbox: () => JSON.parse(fs.readFileSync(path.join(dir, 'platform-hub-outbox.json'), 'utf8')).items };
}

test('queued first, signed, retried with backoff and removed once delivered (same eventId every time)', async () => {
  const h = harness({ answers: [503, 'network', 200] });
  const n = h.make();
  assert.equal(n.enqueue({ personId: PERSON, trainingUserId: 'u-gone' }), true);
  await n.run();
  assert.equal(h.calls.length, 1);
  assert.equal(new URL(h.calls[0].url).pathname, LINK_ENDED_PATH);
  assert.match(h.calls[0].headers['x-2j-signature'], /^[A-Za-z0-9_-]{43}$/);
  assert.equal(h.outbox().length, 1, 'still queued after a 503');
  await n.run();
  assert.equal(h.calls.length, 1, 'not before its backoff');
  h.tick(31_000); await n.run();
  assert.equal(h.calls.length, 2);
  h.tick(61_000); await n.run();
  assert.equal(h.calls.length, 3);
  assert.equal(new Set(h.calls.map(c => c.body.eventId)).size, 1, 'idempotent: the same eventId on every attempt');
  assert.equal(h.outbox().length, 0, 'delivered → removed (no account id left on disk)');
  assert.deepEqual(h.events.map(e => e[0]), ['platform_hub_link_end_sent']);
});

test('a final refusal (409) drops it; a restart picks up what was still queued', async () => {
  const h = harness({ answers: [503] });
  const first = h.make();
  first.enqueue({ personId: PERSON, trainingUserId: 'u-gone' });
  await first.run();
  assert.equal(h.outbox().length, 1);
  const again = h.make();   // "restart": a new notifier reads the same file
  assert.equal(again.pending().length, 1);
  h.tick(31_000);
  // next answer: 409
  h.calls.length = 0;
  const h2answers = [409];
  const fetchOnce = async (url, init) => { h.calls.push(init); return new Response('{}', { status: h2answers.shift() ?? 409 }); };
  const restarted = createLinkEndNotifier({ client, dataDir: h.dir, secEvent: (e, o) => h.events.push([e, o]), saveDb: () => {}, fetchImpl: fetchOnce, now: () => Date.parse('2026-11-14T10:01:00.000Z'), setTimer: () => null });
  await restarted.run();
  assert.equal(h.outbox().length, 0);
  assert.equal(h.events.at(-1)[0], 'platform_hub_link_end_dropped');
});

test('never throws to the erasure: an unwritable outbox is reported as false', () => {
  const file = path.join(tempData(), 'not-a-dir');
  fs.writeFileSync(file, 'x');
  const n = createLinkEndNotifier({ client, dataDir: file, secEvent: () => {}, saveDb: () => {}, fetchImpl: async () => new Response('{}'), setTimer: () => null });
  assert.equal(n.enqueue({ personId: PERSON, trainingUserId: 'u' }), false);
});
