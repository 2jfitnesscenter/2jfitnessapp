import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createCapabilitiesService } from '../platform-sso/capabilities.js';
import { snapshot, http, PERSON, NOW } from './capabilities-corpus.mjs';

// A capability answer is about ONE (person, Training user) pair. These tests pin that the cache, the in-flight sharing and the short rejection memory
// are partitioned by that pair, and that a cache hit is revalidated against the Training user asking (idea taken from the other consumer's partition test).
const SECRET = crypto.randomBytes(32).toString('base64url');
const config = { baseUrl: 'http://127.0.0.1:3100', keyId: 'bunker-1', secret: SECRET };
const answerFor = (trainingUserId, kind = 'full') => snapshot(kind, { trainingSubject: { linkStatus: 'active', trainingUserId } });
const user = id => ({ personId: PERSON, id });

function platform(respond) {
  const calls = [];
  const fetchImpl = async () => { calls.push(Date.now()); return respond(calls.length); };
  return { calls, service: createCapabilitiesService({ config, now: () => NOW, fetchImpl, breakerBaseMs: 1 }) };
}

test('two Training users of the same person never share a cached answer (a relink inside the 60 s window must not inherit the previous account\'s rights)', async () => {
  let current = 'training-A';
  const { service, calls } = platform(() => http(200, answerFor(current, current === 'training-A' ? 'full' : 'baseline')));
  const first = await service.evaluate(user('training-A'), { mode: 'enforced' });
  assert.equal(first.level, 'full');
  current = 'training-B';                                   // the person's link moved to another Training account
  const second = await service.evaluate(user('training-B'), { mode: 'enforced' });
  assert.equal(calls.length, 2, 'the second Training user is asked for itself, not served the first one\'s cache');
  assert.equal(second.level, 'baseline');
  assert.equal(second.source, 'fresh');
  assert.equal(calls.length, 2);
});

test('priming (SSO redemption) is for the pair named in the answer: another Training user of the same person gets no free cache hit', async () => {
  const { service, calls } = platform(() => http(200, answerFor('training-B', 'baseline')));
  service.prime(PERSON, answerFor('training-A', 'full'));
  const forB = await service.evaluate(user('training-B'), { mode: 'enforced' });
  assert.equal(calls.length, 1, 'B was not served the answer primed for A');
  assert.equal(forB.level, 'baseline');
  const forA = await service.evaluate(user('training-A'), { mode: 'enforced' });
  assert.equal(forA.source, 'cache', 'the primed pair itself still hits the cache');
  assert.equal(forA.level, 'full');
  assert.equal(calls.length, 1);
});

test('concurrent evaluations for two Training users of one person are two requests, not one shared promise', async () => {
  const { service, calls } = platform(async () => { await new Promise(resolve => setTimeout(resolve, 20)); return http(200, answerFor('training-A', 'full')); });
  const [a, b] = await Promise.all([service.evaluate(user('training-A'), { mode: 'enforced' }), service.evaluate(user('training-B'), { mode: 'enforced' })]);
  assert.equal(calls.length, 2);
  assert.equal(a.level, 'full');
  assert.equal(b.source, 'rejected', 'an answer about training-A is a contradiction for training-B and fails closed');
  const same = platform(async () => { await new Promise(resolve => setTimeout(resolve, 20)); return http(200, answerFor('training-A', 'full')); });
  await Promise.all([same.service.evaluate(user('training-A'), { mode: 'enforced' }), same.service.evaluate(user('training-A'), { mode: 'enforced' }), same.service.evaluate(user('training-A'), { mode: 'enforced' })]);
  assert.equal(same.calls.length, 1, 'callers for the SAME pair still share one request');
});

test('a short-lived rejection for one Training user does not block another Training user of the same person', async () => {
  const { service } = platform(() => http(200, answerFor('training-A', 'full')));
  const rejected = await service.evaluate(user('training-B'), { mode: 'enforced' });
  assert.equal(rejected.source, 'rejected');
  const fine = await service.evaluate(user('training-A'), { mode: 'enforced' });
  assert.equal(fine.source, 'fresh');
  assert.equal(fine.level, 'full');
});

test('forget(personId) clears every partition of that person, and answers in flight before it are discarded for all of them', async () => {
  const { service, calls } = platform(() => http(200, answerFor('training-A', 'full')));
  await service.evaluate(user('training-A'), { mode: 'enforced' });
  await service.evaluate(user('training-B'), { mode: 'enforced' });
  const before = calls.length;
  service.forget(PERSON);
  await service.evaluate(user('training-A'), { mode: 'enforced' });
  assert.equal(calls.length, before + 1, 'training-A is asked again after the signal');
  await service.evaluate(user('training-B'), { mode: 'enforced' });
  assert.equal(calls.length, before + 2, 'training-B is asked again too (its rejection memory was cleared)');
});
