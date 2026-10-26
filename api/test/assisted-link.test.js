import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAssistedLink, DAILY_ISSUE_LIMIT, RECEIPT_TTL_MS } from '../platform-sso/assisted-link.js';
import { createLedger } from '../lib/append-ledger.js';

/* H13 at module level: permission, step-up, limits, expiry, ledger. The HTTP wiring is in assisted-link-http.test.js. */
const KEY = crypto.randomBytes(32).toString('hex');
const uuid = () => crypto.randomUUID();
const OWNER = { id: 'owner' }, PEDRO = { id: 'pedro' }, ADMIN = { id: 'admin', admin: true, trainer: true }, TRAINER = { id: 'coach', trainer: true };

function setup({ enabled = true, key = KEY, members = 30, legacyAssist = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assist-'));
  let clock = Date.parse('2026-10-24T10:00:00Z');
  const db = { users: [OWNER, PEDRO, ADMIN, TRAINER, ...Array.from({ length: members }, (_, i) => ({ id: `m${i}` }))], ...(legacyAssist ? { platformAssist: structuredClone(legacyAssist) } : {}) };
  const spent = new Set();
  const stepUp = { valid: req => !!req.step && !spent.has(req.step), consume: req => { if (!req.step || spent.has(req.step)) return false; spent.add(req.step); return true; } };
  const sent = [];
  let encryptedState = { requests: [], receipts: [] };
  const store = { readAssistedLinkState: () => structuredClone(encryptedState), saveAssistedLinkState: value => { encryptedState = structuredClone(value); } };
  const json = (res, status, body) => { res.out = { status, body }; return res.out; };
  const assisted = createAssistedLink({
    config: { enabled, issuers: ['owner', 'pedro'], ledgerFile: path.join(dir, 'ledger.jsonl'), ledgerKey: key },
    db, saveDb: () => { sent.push('save'); }, json, readBody: async req => req.body,
    store,
    requireStaff: (req, res) => { if (req.user && (req.user.trainer || req.user.admin)) return req.user; json(res, 403, { error: 'prohibido' }); return null; },
    requirePasskeySession: (req, res) => { if (req.user) return req.user; json(res, 401, {}); return null; },
    stepUp, now: () => clock,
  });
  const call = async (route, user, body, step) => { const res = {}; await assisted.routes[route]({ user, body, step }, res); return res.out; };
  return { assisted, db, dir, call, store, advance: ms => { clock += ms; }, ledgerFile: path.join(dir, 'ledger.jsonl'), people: i => ({ personId: uuid(), trainingUserId: `m${i}`, reasonCode: 'lost_device' }) };
}
const ISSUE = 'POST /api/admin/platform-link/assist', REQUEST = 'POST /api/admin/platform-link/assist-requests', APPROVE = 'POST /api/admin/platform-link/assist-requests/approve', REJECT = 'POST /api/admin/platform-link/assist-requests/reject';
let stepCounter = 0; const step = () => `step-${++stepCounter}`;

test('disabled by default: every route is 404 and nothing can be consumed', async () => {
  const s = setup({ enabled: false });
  for (const route of Object.keys(s.assisted.routes)) assert.equal((await s.call(route, OWNER, s.people(0), step())).status, 404, route);
  assert.equal(s.assisted.consume({ receiptId: uuid(), reviewId: uuid(), personId: uuid(), trainingUserId: 'm0' }).status, 'disabled');
});

test('enabled without a valid ledger key: nobody can issue (503) and nothing is consumed', async () => {
  const s = setup({ key: 'short' });
  assert.equal((await s.call(ISSUE, OWNER, s.people(0), step())).status, 503);
  assert.equal(s.assisted.consume({ receiptId: uuid(), reviewId: uuid(), personId: uuid(), trainingUserId: 'm0' }).status, 'unavailable');
});

test('the permission is not the admin flag: admins, trainers and members cannot issue; they can only request', async () => {
  const s = setup();
  for (const who of [ADMIN, TRAINER, { id: 'm1' }]) {
    assert.deepEqual([(await s.call(ISSUE, who, s.people(2), step())).status, (await s.call(APPROVE, who, { requestId: uuid() }, step())).status], [403, 403], who.id);
  }
  assert.equal((await s.call(ISSUE, ADMIN, s.people(2), step())).body.error, 'not_issuer');
  assert.equal((await s.call(REQUEST, TRAINER, s.people(3))).status, 201);
  assert.equal((await s.call(REQUEST, ADMIN, s.people(4))).status, 201);
  assert.equal((await s.call(REQUEST, { id: 'm1' }, s.people(5))).status, 403, 'a member cannot even ask');
});

test('issuing needs a fresh step-up that is spent by use', async () => {
  const s = setup();
  assert.deepEqual([(await s.call(ISSUE, OWNER, s.people(0))).status, (await s.call(ISSUE, OWNER, s.people(0))).body.code], [403, 'step_up_required']);
  const one = step();
  const first = await s.call(ISSUE, OWNER, s.people(0), one);
  assert.equal(first.status, 201); assert.ok(first.body.receiptId);
  assert.equal((await s.call(ISSUE, OWNER, s.people(1), one)).status, 403, 'the same step-up cannot authorise a second issuance');
  assert.equal((await s.call(ISSUE, PEDRO, s.people(1), step())).status, 201);
});

test('request -> approve by a holder; reject; an own account is refused and recorded', async () => {
  const s = setup();
  const requested = await s.call(REQUEST, TRAINER, s.people(0));
  assert.equal(requested.status, 201);
  assert.equal((await s.call(REQUEST, ADMIN, { ...s.people(0), personId: uuid() })).status, 409, 'the same Training account cannot have two open requests');
  const approved = await s.call(APPROVE, OWNER, { requestId: requested.body.requestId }, step());
  assert.equal(approved.status, 201);
  assert.equal(s.store.readAssistedLinkState().requests[0].status, 'approved');
  const second = await s.call(REQUEST, TRAINER, s.people(1));
  assert.equal((await s.call(REJECT, PEDRO, { requestId: second.body.requestId })).status, 200);
  assert.equal((await s.call(APPROVE, PEDRO, { requestId: second.body.requestId }, step())).status, 404, 'a rejected request cannot be approved');
  const own = await s.call(ISSUE, OWNER, { personId: uuid(), trainingUserId: 'owner', reasonCode: 'other' }, step());
  assert.deepEqual([own.status, own.body.error], [403, 'own_account']);
  assert.ok(createLedger({ file: s.ledgerFile, key: KEY }).verify().ok);
});

test('legacy plaintext requests migrate losslessly into the encrypted store and are removed from db.json state', () => {
  const legacy = {
    head: null,
    requests: [{ requestId: uuid(), personId: uuid(), trainingUserId: 'm0', reasonCode: 'other', note: 'legacy note', requestedBy: 'coach', createdAt: '2026-10-24T10:00:00.000Z', status: 'open' }],
    receipts: [],
  };
  const s = setup({ legacyAssist: legacy });
  assert.deepEqual(s.store.readAssistedLinkState().requests, legacy.requests);
  assert.equal(Object.hasOwn(s.db.platformAssist, 'requests'), false);
  assert.equal(Object.hasOwn(s.db.platformAssist, 'receipts'), false);
  assert.equal(s.db.platformAssist.head, null);

  const disabled = setup({ enabled: false, legacyAssist: legacy });
  assert.deepEqual(disabled.store.readAssistedLinkState().requests, legacy.requests, 'migration protects retained notes even while H13 routes stay disabled');
  assert.equal(Object.hasOwn(disabled.db.platformAssist, 'requests'), false);
  assert.equal(Object.keys(disabled.assisted.routes).length > 0, true);
  assert.equal(disabled.assisted.enabled, false);
});

test('daily limit: 20 per issuer; the 21st is refused and the other holder is unaffected', async () => {
  const s = setup();
  for (let i = 0; i < DAILY_ISSUE_LIMIT; i++) assert.equal((await s.call(ISSUE, OWNER, s.people(i), step())).status, 201, `issue ${i}`);
  assert.equal((await s.call(ISSUE, OWNER, s.people(DAILY_ISSUE_LIMIT), step())).status, 429);
  assert.equal((await s.call(ISSUE, PEDRO, s.people(DAILY_ISSUE_LIMIT), step())).status, 201);
  s.advance(24 * 3_600_000 + 1000);
  assert.equal((await s.call(ISSUE, OWNER, s.people(DAILY_ISSUE_LIMIT + 1), step())).status, 201, 'the window rolls');
});

test('receipts are single use, bound to (person, Training user), and expire in 24 h', async () => {
  const s = setup();
  const pair = s.people(0);
  const issued = (await s.call(ISSUE, OWNER, pair, step())).body;
  const base = { receiptId: issued.receiptId, reviewId: uuid(), personId: pair.personId, trainingUserId: pair.trainingUserId };
  assert.equal(s.assisted.consume({ ...base, personId: uuid() }).status, 'missing', 'another person');
  assert.equal(s.assisted.consume({ ...base, trainingUserId: 'm1' }).status, 'missing', 'another Training user');
  assert.equal(s.assisted.consume({ ...base, receiptId: uuid() }).status, 'missing', 'an unknown receipt');
  assert.equal(s.assisted.consume(base).status, 'ok');
  assert.equal(s.assisted.consume(base).status, 'missing', 'used once');
  const late = (await s.call(ISSUE, OWNER, s.people(1), step())).body;
  s.advance(RECEIPT_TTL_MS + 1);
  assert.equal(s.assisted.consume({ receiptId: late.receiptId, reviewId: uuid(), personId: s.store.readAssistedLinkState().receipts[1].personId, trainingUserId: 'm1' }).status, 'missing', 'expired');
});

test('a receipt issued before a revocation does not count after it', async () => {
  const s = setup();
  const pair = s.people(0);
  const issued = (await s.call(ISSUE, OWNER, pair, step())).body;
  const revokedAt = new Date(Date.parse(s.store.readAssistedLinkState().receipts[0].issuedAt) + 1000).toISOString();
  assert.equal(s.assisted.consume({ receiptId: issued.receiptId, reviewId: uuid(), personId: pair.personId, trainingUserId: pair.trainingUserId, revokedAt }).status, 'missing');
});

test('conflicts: a Training account or person that is already linked is refused', async () => {
  const s = setup();
  s.db.users.find(user => user.id === 'm0').platformLink = { personId: uuid(), state: 'active' };
  assert.equal((await s.call(ISSUE, OWNER, s.people(0), step())).body.error, 'link_conflict');
  const taken = uuid();
  s.db.users.find(user => user.id === 'm1').platformLink = { personId: taken, state: 'pending' };
  assert.equal((await s.call(ISSUE, OWNER, { ...s.people(2), personId: taken }, step())).body.error, 'link_conflict');
  s.db.users.find(user => user.id === 'm3').disabled = true;
  assert.equal((await s.call(ISSUE, OWNER, s.people(3), step())).status, 404);
});

test('ledger: append-only chain; editing, cutting or truncating it stops issuance and consumption', async () => {
  const s = setup();
  await s.call(ISSUE, OWNER, s.people(0), step());
  await s.call(ISSUE, OWNER, s.people(1), step());
  const original = fs.readFileSync(s.ledgerFile, 'utf8');
  const lines = original.trim().split('\n');
  assert.equal(lines.length, 2);
  const ledger = createLedger({ file: s.ledgerFile, key: KEY });
  assert.deepEqual(Object.keys(ledger).sort(), ['append', 'countSince', 'verify'], 'the ledger API has no edit or delete');

  fs.writeFileSync(s.ledgerFile, lines[0].replace('"lost_device"', '"other"') + '\n' + lines[1] + '\n');           // edited line
  assert.equal((await s.call(ISSUE, OWNER, s.people(2), step())).status, 503);
  fs.writeFileSync(s.ledgerFile, lines[1] + '\n');                                                               // first line removed
  assert.equal((await s.call(ISSUE, OWNER, s.people(2), step())).status, 503);
  fs.writeFileSync(s.ledgerFile, lines[0] + '\n');                                                               // tail truncated: head in db is ahead
  assert.equal((await s.call(ISSUE, OWNER, s.people(2), step())).status, 503);
  assert.equal(s.assisted.consume({ receiptId: uuid(), reviewId: uuid(), personId: uuid(), trainingUserId: 'm0' }).status, 'unavailable');
  fs.writeFileSync(s.ledgerFile, original);                                                                      // restored: works again
  assert.equal((await s.call(ISSUE, OWNER, s.people(2), step())).status, 201);
});

test('ledger lines hold only allow-listed scalar fields (no notes, tokens, addresses)', async () => {
  const s = setup();
  const requested = await s.call(REQUEST, TRAINER, { ...s.people(0), note: 'call mum on 600123456 secret=abc' });
  assert.equal(requested.status, 201);
  const text = fs.readFileSync(s.ledgerFile, 'utf8');
  assert.ok(!text.includes('600123456') && !text.includes('secret'), 'the free-text note never reaches the ledger');
  for (const line of text.trim().split('\n')) {
    for (const [field, value] of Object.entries(JSON.parse(line))) assert.ok(['string', 'number'].includes(typeof value), `${field} is a scalar`);
  }
});

test('input is strict: unknown keys, bad reason codes, control characters in notes', async () => {
  const s = setup();
  assert.equal((await s.call(ISSUE, OWNER, { ...s.people(0), extra: 1 }, step())).status, 400);
  assert.equal((await s.call(ISSUE, OWNER, { ...s.people(0), reasonCode: 'because' }, step())).status, 400);
  assert.equal((await s.call(REQUEST, TRAINER, { ...s.people(0), note: 'a\nb' })).status, 400);
  assert.equal((await s.call(REQUEST, TRAINER, { ...s.people(0), note: 'x'.repeat(81) })).status, 400);
});
