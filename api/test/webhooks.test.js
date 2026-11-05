// Outbound webhooks, in process: SSRF and DNS pinning, redirects, limits, signatures, retry policy, payload allow-list,
// delivery log contents, secret at rest, erasure. No network: transports are fakes. See docs/WEBHOOKS_SECURITY_REVIEW.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), '2j-webhooks-'));
process.env.DATA_DIR = DIR;
fs.writeFileSync(path.join(DIR, 'secret'), crypto.randomBytes(32).toString('hex'));
const { sendSigned, pinnedLookup } = await import('../webhooks/delivery.js');
const { createWebhookService, RETRY_DELAYS_MS, RATE_PER_HOUR } = await import('../webhooks/service.js');
const { createWebhookStore } = await import('../webhooks/store.js');
const { newEvents, buildPayload, PAYLOAD_FIELDS, PAYLOAD_DATA_FIELDS, WEBHOOK_EVENTS } = await import('../webhooks/events.js');
const { verifyWebhookSignature, SIGNATURE_HEADER, resolvePublicAddresses } = await import('../lib/webhook-security.js');

const PUBLIC_IP = '93.184.216.34';
const URL_OK = 'https://hooks.example.com/in/abc';
const NOW = Date.UTC(2026, 10, 5, 12, 0, 0);
const TODAY = '2026-11-05';

// A fake https.request: records options and body, and lets the script answer.
function fakeTransport(script) {
  const calls = [];
  const fn = (opts, onResponse) => {
    const req = new EventEmitter();
    calls.push({ opts, req });
    req.destroy = () => { req.destroyed = true; };
    req.end = body => {
      req.body = body;
      queueMicrotask(() => script({ opts, onResponse, req, body }));
    };
    return req;
  };
  fn.calls = calls;
  return fn;
}
const answer = (code, headers = {}) => ({ onResponse, req }) => {
  const res = new EventEmitter();
  res.statusCode = code; res.headers = headers;
  res.destroy = () => { res.destroyed = true; };
  onResponse(res);
  if (!res.destroyed) res.emit('end');
  return req;
};
const okResolve = async () => [PUBLIC_IP];

// ---------- SSRF and DNS pinning ----------

test('a name that resolves to one private address is refused before anything is sent', async () => {
  const transport = fakeTransport(answer(200));
  const r = await sendSigned({
    url: URL_OK, body: '{}', secret: 'whsec_x', eventId: 'e1', transport,
    resolve: async () => [PUBLIC_IP, '10.0.0.5'],
  });
  assert.equal(r.status, 'blocked');
  assert.equal(transport.calls.length, 0, 'nothing is connected at all');
});

test('DNS rebinding: the vetted address is pinned, a second lookup at connect time is never used', async () => {
  let lookups = 0;
  const transport = fakeTransport(answer(200));
  const resolve = async () => { lookups++; return [PUBLIC_IP]; };
  await sendSigned({ url: URL_OK, body: '{}', secret: 'whsec_x', eventId: 'e2', transport, resolve });
  assert.equal(lookups, 1, 'the name is resolved once, by the vetting step');
  const opts = transport.calls[0].opts;
  assert.equal(opts.host, 'hooks.example.com', 'TLS is still checked against the host name');
  assert.equal(opts.servername, 'hooks.example.com');
  // Whatever the resolver would answer now (a private address after a rebind), the socket gets the vetted one.
  let connectedTo = null;
  opts.lookup('hooks.example.com', { all: false }, (err, addr) => { connectedTo = addr; });
  assert.equal(connectedTo, PUBLIC_IP);
  opts.lookup('hooks.example.com', { all: true }, (err, list) => { connectedTo = list[0].address; });
  assert.equal(connectedTo, PUBLIC_IP);
});

test('every class of private target is refused: loopback, link-local, metadata, private, IPv6 local', async () => {
  const targets = ['127.0.0.1', '169.254.169.254', '10.1.2.3', '192.168.0.10', '172.20.0.1', '::1', 'fd00:ec2::254', 'fe80::1', '::ffff:10.0.0.1'];
  for (const ip of targets) {
    const transport = fakeTransport(answer(200));
    const r = await sendSigned({ url: URL_OK, body: '{}', secret: 'whsec_x', eventId: 'e3', transport, resolve: async () => [ip] });
    assert.equal(r.status, 'blocked', ip);
    assert.equal(transport.calls.length, 0, ip);
  }
  // A literal private address in the URL itself is refused by the syntax check, before DNS.
  const r = await sendSigned({ url: 'https://169.254.169.254/latest', body: '{}', secret: 'whsec_x', eventId: 'e4', transport: fakeTransport(answer(200)), resolve: okResolve });
  assert.equal(r.status, 'blocked');
});

test('the resolver itself refuses a metadata name that points at a link-local address', async () => {
  await assert.rejects(resolvePublicAddresses('metadata.internal.example', async () => [{ address: '169.254.169.254', family: 4 }]), { code: 'WEBHOOK_TARGET_PRIVATE' });
});

test('plain http, credentials, other ports and local host names are refused without a connection', async () => {
  for (const url of ['http://hooks.example.com/x', 'https://u:p@hooks.example.com/x', 'https://hooks.example.com:8443/x', 'https://localhost/x', 'https://printer.internal/x']) {
    const transport = fakeTransport(answer(200));
    const r = await sendSigned({ url, body: '{}', secret: 'whsec_x', eventId: 'e5', transport, resolve: okResolve });
    assert.equal(r.status, 'blocked', url);
    assert.equal(transport.calls.length, 0, url);
  }
});

test('the pinned lookup answers both call shapes that Node uses', () => {
  const l = pinnedLookup(PUBLIC_IP, 4);
  let single; l('h', {}, (e, a, f) => { single = [a, f]; });
  assert.deepEqual(single, [PUBLIC_IP, 4]);
  let all; l('h', { all: true }, (e, list) => { all = list; });
  assert.deepEqual(all, [{ address: PUBLIC_IP, family: 4 }]);
});

// ---------- redirects, timeouts, size limits ----------

test('a redirect is never followed: one request, status redirect', async () => {
  const transport = fakeTransport(answer(302, { location: 'http://127.0.0.1/admin' }));
  const r = await sendSigned({ url: URL_OK, body: '{}', secret: 'whsec_x', eventId: 'e6', transport, resolve: okResolve });
  assert.equal(r.status, 'redirect');
  assert.equal(r.httpCode, 302);
  assert.equal(transport.calls.length, 1);
});

test('a silent receiver is cut off at the timeout', async () => {
  const transport = fakeTransport(() => {});
  const r = await sendSigned({ url: URL_OK, body: '{}', secret: 'whsec_x', eventId: 'e7', transport, resolve: okResolve, timeoutMs: 30 });
  assert.equal(r.status, 'timeout');
});

test('a body above 16 KB is never sent', async () => {
  const transport = fakeTransport(answer(200));
  const r = await sendSigned({ url: URL_OK, body: 'x'.repeat(16 * 1024 + 1), secret: 'whsec_x', eventId: 'e8', transport, resolve: okResolve });
  assert.equal(r.status, 'too_large');
  assert.equal(transport.calls.length, 0);
});

test('the response is read only up to 4 KB and then discarded', async () => {
  let destroyed = false, chunksEmitted = 0;
  const transport = fakeTransport(({ onResponse, req }) => {
    const res = new EventEmitter();
    res.statusCode = 200; res.destroy = () => { destroyed = true; };
    onResponse(res);
    for (let i = 0; i < 50 && !destroyed; i++) { chunksEmitted++; res.emit('data', Buffer.alloc(1024, 65)); }
    if (!destroyed) res.emit('end');
    return req;
  });
  const r = await sendSigned({ url: URL_OK, body: '{}', secret: 'whsec_x', eventId: 'e9', transport, resolve: okResolve });
  assert.equal(r.status, 'ok');
  assert.equal(destroyed, true);
  assert.ok(chunksEmitted <= 4, 'stops reading after 4 KB, read ' + chunksEmitted);
});

test('2xx is ok, 5xx is an http failure with its code', async () => {
  assert.equal((await sendSigned({ url: URL_OK, body: '{}', secret: 's', eventId: 'a', transport: fakeTransport(answer(204)), resolve: okResolve })).status, 'ok');
  const r = await sendSigned({ url: URL_OK, body: '{}', secret: 's', eventId: 'b', transport: fakeTransport(answer(503)), resolve: okResolve });
  assert.equal(r.status, 'http'); assert.equal(r.httpCode, 503);
});

// ---------- signature and replay window ----------

test('the signature header verifies, a changed body fails, and a request older than 300 s is refused', async () => {
  const secret = 'whsec_test_secret';
  const transport = fakeTransport(answer(200));
  const body = buildPayload({ type: 'workout.finished', eventId: 'evt_1', created: NOW, date: TODAY });
  await sendSigned({ url: URL_OK, body, secret, eventId: 'evt_1', now: NOW, transport, resolve: okResolve });
  const headers = transport.calls[0].opts.headers;
  const header = headers[SIGNATURE_HEADER];
  const at = Math.floor(NOW / 1000);
  assert.deepEqual(verifyWebhookSignature({ secret, header, body, now: at }), { ok: true });
  assert.equal(verifyWebhookSignature({ secret, header, body: body.replace(TODAY, '2026-01-01'), now: at }).ok, false, 'tampered body');
  assert.equal(verifyWebhookSignature({ secret: 'whsec_other', header, body, now: at }).ok, false, 'wrong secret');
  assert.equal(verifyWebhookSignature({ secret, header, body, now: at + 300 }).ok, true, 'edge of the window');
  assert.equal(verifyWebhookSignature({ secret, header, body, now: at + 301 }).reason, 'stale', 'replay after the window');
  assert.equal(verifyWebhookSignature({ secret, header, body, now: at - 301 }).reason, 'stale', 'timestamp from the future');
  assert.equal(headers['2j-event-id'], 'evt_1');
  assert.ok(!JSON.stringify(headers).includes(secret), 'the secret itself is never sent');
});

// ---------- payload allow-list ----------

test('the payload carries only the owner-approved fields', () => {
  const body = JSON.parse(buildPayload({ type: 'weighin.recorded', eventId: 'evt_2', created: NOW, date: TODAY }));
  assert.deepEqual(Object.keys(body).sort(), [...PAYLOAD_FIELDS].sort());
  assert.deepEqual(Object.keys(body.data), [...PAYLOAD_DATA_FIELDS]);
  assert.deepEqual(body, { id: 'evt_2', type: 'weighin.recorded', created: new Date(NOW).toISOString(), data: { date: TODAY } });
  assert.deepEqual(WEBHOOK_EVENTS, ['workout.finished', 'weighin.recorded'], 'the owner-approved event list');
  assert.throws(() => buildPayload({ type: 'member.updated', eventId: 'x', created: NOW, date: TODAY }));
  assert.throws(() => buildPayload({ type: 'workout.finished', eventId: 'x', created: NOW, date: 'yesterday' }));
});

test('event detection: only new, recent records; never a restore or a first save', () => {
  const w = { id: 'w1', d: TODAY, name: 'SECRET ROUTINE', entries: [], notes: 'private' };
  const old = { id: 'w0', d: '2025-01-01', name: 'OLD', entries: [] };
  const prev = { workouts: [old], bodyweight: [{ d: TODAY, w: 80, t: 1 }] };
  const next = { workouts: [old, w, { id: 'w2', d: '2025-01-02' }], bodyweight: [{ d: TODAY, w: 80, t: 1 }, { d: TODAY, w: 81.5, t: 2 }] };
  const evs = newEvents('uid-1', prev, next, NOW);
  assert.deepEqual(evs.map(e => [e.type, e.date]), [['workout.finished', TODAY], ['weighin.recorded', TODAY]]);
  assert.deepEqual(newEvents('uid-1', null, next, NOW), [], 'a first save or a restore is silent');
  assert.deepEqual(newEvents('uid-1', prev, prev, NOW), [], 'an unchanged state is silent');
});

// ---------- service: retries, limits, failures, payload on the wire ----------

async function setup({ enabled = true, send } = {}) {
  const store = createWebhookStore({ dataDir: fs.mkdtempSync(path.join(DIR, 'st-')) });
  const timers = [];
  const schedule = (fn, ms) => timers.push({ fn, ms });
  const runTimers = async () => { while (timers.length) { const t = timers.shift(); await t.fn(); } };
  const sent = [];
  const svc = createWebhookService({
    store, enabled, now: () => NOW, schedule,
    send: send || (async args => { sent.push(args); return { status: 'ok', httpCode: 200, durationMs: 1 }; }),
  });
  return { store, svc, timers, runTimers, sent };
}
const workoutState = (extra = {}) => ({ prev: { workouts: [] }, next: { workouts: [{ id: 'w1', d: TODAY, name: 'SECRET', entries: [] }] }, ...extra });

test('disabled by default: no endpoint, no event and no send', async () => {
  const { store, svc, runTimers, sent } = await setup({ enabled: false });
  store.create({ uid: 'm1', url: URL_OK, events: ['workout.finished'], now: NOW });
  const { prev, next } = workoutState();
  svc.onStateWritten('m1', prev, next);
  await runTimers();
  assert.equal(sent.length, 0);
  assert.equal(store.deliveriesFor('m1').length, 0);
});

test('a finished workout reaches every subscribed endpoint with the minimal body, and the log has no body', async () => {
  const { store, svc, runTimers, sent } = await setup();
  store.create({ uid: 'm1', url: URL_OK, events: ['workout.finished'], now: NOW });
  store.create({ uid: 'm1', url: 'https://other.example.com/x', events: ['weighin.recorded'], now: NOW });
  const { prev, next } = workoutState();
  svc.onStateWritten('m1', prev, next);
  await runTimers();
  assert.equal(sent.length, 1, 'only the endpoint that subscribed to workouts');
  const body = JSON.parse(sent[0].body);
  assert.deepEqual(Object.keys(body).sort(), [...PAYLOAD_FIELDS].sort());
  assert.equal(body.type, 'workout.finished');
  assert.deepEqual(body.data, { date: TODAY });
  assert.ok(!sent[0].body.includes('SECRET'), 'no workout name on the wire');
  const log = store.deliveriesFor('m1');
  assert.equal(log.length, 1);
  assert.deepEqual(Object.keys(log[0]).sort(), ['attempt', 'durationMs', 'event', 'eventId', 'httpCode', 'status', 'at', 'webhookId'].sort());
  assert.equal(log[0].eventId, body.id);
  assert.ok(!JSON.stringify(log).includes('SECRET') && !JSON.stringify(log).includes('example.com'), 'no body, no URL in the log');
});

test('the same state is never emitted twice (dedupe survives a re-save)', async () => {
  const { store, svc, runTimers, sent } = await setup();
  store.create({ uid: 'm1', url: URL_OK, events: ['workout.finished'], now: NOW });
  const { prev, next } = workoutState();
  svc.onStateWritten('m1', prev, next);
  svc.onStateWritten('m1', prev, next);
  await runTimers();
  assert.equal(sent.length, 1);
});

test('retries: network errors are retried with bounded waits, four attempts in total', async () => {
  const attempts = [];
  const { store, svc, runTimers } = await setup({ send: async () => { attempts.push(1); return { status: 'network', durationMs: 1 }; } });
  store.create({ uid: 'm1', url: URL_OK, events: ['workout.finished'], now: NOW });
  const { prev, next } = workoutState();
  svc.onStateWritten('m1', prev, next);
  await runTimers();
  assert.equal(attempts.length, 4);
  const log = store.deliveriesFor('m1');
  assert.deepEqual(log.map(l => l.attempt).sort(), [1, 2, 3, 4]);
  assert.deepEqual(RETRY_DELAYS_MS, [30000, 120000, 600000]);
});

test('client errors and blocked targets are final on the first attempt', async () => {
  for (const r of [{ status: 'http', httpCode: 404 }, { status: 'blocked' }, { status: 'redirect', httpCode: 301 }]) {
    const attempts = [];
    const { store, svc, runTimers } = await setup({ send: async () => { attempts.push(1); return { ...r, durationMs: 1 }; } });
    store.create({ uid: 'm1', url: URL_OK, events: ['workout.finished'], now: NOW });
    const { prev, next } = workoutState();
    svc.onStateWritten('m1', prev, next);
    await runTimers();
    assert.equal(attempts.length, 1, r.status);
  }
});

test('an endpoint is switched off after ten final failures in a row, and comes back only when the owner enables it', async () => {
  // A 400 is final on the first attempt, so ten events are ten final failures (5xx would retry and share the hourly budget).
  const { store, svc, runTimers } = await setup({ send: async () => ({ status: 'http', httpCode: 400, durationMs: 1 }) });
  const ep = store.create({ uid: 'm1', url: URL_OK, events: ['workout.finished'], now: NOW }).endpoint;
  for (let i = 0; i < 10; i++) {
    const state = { workouts: [{ id: 'w' + i, d: TODAY, entries: [] }] };
    svc.onStateWritten('m1', { workouts: [] }, state);
    await runTimers();
  }
  const after = store.list('m1')[0];
  assert.equal(after.enabled, false);
  assert.equal(after.disabledReason, 'failures');
  assert.equal(after.failures, 10);
  const back = store.update({ uid: 'm1', id: ep.id, enabled: true });
  assert.equal(back.endpoint.enabled, true);
  assert.equal(back.endpoint.failures, 0);
});

test('per-endpoint rate limit: attempts beyond thirty an hour are logged as rate_limited and not sent', async () => {
  const { store, svc, runTimers, sent } = await setup();
  store.create({ uid: 'm1', url: URL_OK, events: ['workout.finished'], now: NOW });
  for (let i = 0; i < RATE_PER_HOUR + 1; i++) {
    svc.onStateWritten('m1', { workouts: [] }, { workouts: [{ id: 'r' + i, d: TODAY, entries: [] }] });
  }
  await runTimers();
  assert.equal(sent.length, RATE_PER_HOUR);
  assert.ok(store.deliveriesFor('m1').some(d => d.status === 'rate_limited'));
});

test('a disabled endpoint receives nothing even if a retry is pending', async () => {
  let sends = 0;
  const { store, svc, runTimers } = await setup({ send: async () => { sends++; return { status: 'network', durationMs: 1 }; } });
  const ep = store.create({ uid: 'm1', url: URL_OK, events: ['workout.finished'], now: NOW }).endpoint;
  svc.onStateWritten('m1', { workouts: [] }, { workouts: [{ id: 'z', d: TODAY, entries: [] }] });
  store.update({ uid: 'm1', id: ep.id, enabled: false });
  await runTimers();
  assert.equal(sends, 0, 'the owner switched it off before the first attempt ran');
});

// ---------- secret at rest, store shape, erasure ----------

test('the secret is shown by create and rotate only; lists never return it; the file never holds it in clear', async () => {
  const { store } = await setup();
  const made = store.create({ uid: 'm2', url: URL_OK, events: ['weighin.recorded'], now: NOW });
  assert.match(made.secret, /^whsec_/);
  const listed = JSON.stringify(store.list('m2'));
  assert.ok(!listed.includes(made.secret) && !listed.includes('whsec_'), 'list has no secret');
  assert.equal(store.secretFor(store.byId('m2', made.endpoint.id)), made.secret, 'the server can still sign with it');
  const onDisk = fs.readFileSync(store.FILE, 'utf8');
  assert.ok(!onDisk.includes(made.secret), 'the file never holds the secret in clear');
  const rotated = store.rotate({ uid: 'm2', id: made.endpoint.id });
  assert.notEqual(rotated.secret, made.secret);
  assert.equal(store.secretFor(store.byId('m2', made.endpoint.id)), rotated.secret);
  assert.ok(!JSON.stringify(store.list('m2')).includes(rotated.secret));
});

test('limits and validation: https only, at most three endpoints, known event types only', async () => {
  const { store } = await setup();
  assert.equal(store.create({ uid: 'm3', url: 'http://hooks.example.com/x' }).error, 'WEBHOOK_URL_NOT_HTTPS');
  assert.equal(store.create({ uid: 'm3', url: 'https://127.0.0.1/x' }).error, 'WEBHOOK_TARGET_PRIVATE');
  assert.equal(store.create({ uid: 'm3', url: URL_OK, events: ['member.deleted'] }).error, 'WEBHOOK_EVENTS_INVALID');
  for (let i = 0; i < 3; i++) assert.ok(store.create({ uid: 'm3', url: `https://h${i}.example.com/x` }).endpoint);
  assert.equal(store.create({ uid: 'm3', url: 'https://h9.example.com/x' }).error, 'WEBHOOK_LIMIT');
});

test('account erasure removes endpoints, secrets, log and dedupe keys of that member only', async () => {
  const { store, svc, runTimers } = await setup();
  const a = store.create({ uid: 'erase-me', url: URL_OK, events: ['workout.finished'], now: NOW });
  store.create({ uid: 'keep-me', url: 'https://keep.example.com/x', events: ['workout.finished'], now: NOW });
  svc.onStateWritten('erase-me', { workouts: [] }, { workouts: [{ id: 'q', d: TODAY, entries: [] }] });
  svc.onStateWritten('keep-me', { workouts: [] }, { workouts: [{ id: 'q', d: TODAY, entries: [] }] });
  await runTimers();
  const report = store.removeUser('erase-me');
  assert.equal(report.endpoints, 1);
  assert.equal(store.list('erase-me').length, 0);
  assert.equal(store.deliveriesFor('erase-me').length, 0);
  assert.equal(store.byId('erase-me', a.endpoint.id), null);
  assert.equal(store.list('keep-me').length, 1, 'other members untouched');
  assert.equal(store.deliveriesFor('keep-me').length, 1);
  const onDisk = fs.readFileSync(store.FILE, 'utf8');
  assert.ok(!onDisk.includes('erase-me'), 'no trace of the erased member in the file');
  assert.ok(!onDisk.includes(a.secret));
});
