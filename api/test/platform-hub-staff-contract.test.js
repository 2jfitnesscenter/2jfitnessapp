// F9e · Contract `training-staff-v1` (2JHub docs/contracts/platform-training-v2.md §10): Búnker's own schemas accept the shared examples and refuse
// the invalid ones. The examples file is an IDENTICAL copy of 2JHub docs/contracts/training-staff-v1.examples.json (checked here when
// PLATFORM_REPO_DIR points to a 2JHub clone, and from the 2JHub side with BUNKER_REPO_DIR).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const { staffEventSchema, staffItemSchema, staffRedeemResponseSchema, staffStateSchema } = await import('../platform-hub/staff.js');
const { HUB_STAFF, HUB_SSO, HUB_STEPUP } = await import('../platform-hub/config.js');
const file = path.resolve('..', 'contracts', 'platform-training-staff-v1.examples.json');
const ex = JSON.parse(fs.readFileSync(file, 'utf8'));

test('valid examples pass Búnker\'s schemas', () => {
  assert.ok(staffRedeemResponseSchema.safeParse(ex.staffSsoRedeemResponse).success);
  assert.ok(staffStateSchema.safeParse(ex.staffState).success);
  assert.ok(staffEventSchema.safeParse(ex.staffEvent).success);
  for (const item of ex.staffState.items) assert.ok(staffItemSchema.safeParse(item).success);
  // What Búnker sends Platform: the redemption request and its own directory / acknowledgement shapes.
  assert.deepEqual(Object.keys(ex.staffSsoRedeemRequest).sort(), ['audience', 'code', 'correlationId', 'destination', 'v']);
  assert.equal(ex.staffSsoRedeemRequest.audience, HUB_STAFF.audience);
  assert.deepEqual(Object.keys(ex.staffEventAck).sort(), ['eventId', 'result', 'v']);
  for (const item of ex.staffDirectory.items) {
    assert.ok(['admin', 'trainer'].includes(item.role));
    assert.equal(typeof item.adminByConfig, 'boolean');
  }
});

test('invalid examples are refused: a role outside the list, the member audience, an end that carries a role, an extra field', () => {
  assert.equal(staffRedeemResponseSchema.safeParse(ex.invalid.staffSsoRedeemResponse_roleFromCaller).success, false);
  assert.equal(staffRedeemResponseSchema.safeParse(ex.invalid.staffSsoRedeemResponse_memberAudience).success, false);
  assert.equal(staffEventSchema.safeParse(ex.invalid.staffEvent_endedWithRole).success, false);
  assert.equal(staffStateSchema.safeParse(ex.invalid.staffState_passkeyAssurance).success, false);
});

test('the member contract is untouched: own audience, never passkey assurance', () => {
  assert.notEqual(HUB_STAFF.audience, HUB_SSO.audience);
  assert.notEqual(HUB_STAFF.audience, HUB_STEPUP.audience);
  assert.equal(HUB_STAFF.assurance, 'platform_sso');
});

test('identical to 2JHub\'s copy when PLATFORM_REPO_DIR points to a clone', () => {
  const dir = process.env.PLATFORM_REPO_DIR;
  const theirs = dir ? path.join(dir, 'docs', 'contracts', 'training-staff-v1.examples.json') : '';
  if (!dir || !fs.existsSync(theirs)) return;
  assert.deepEqual(JSON.parse(fs.readFileSync(theirs, 'utf8')), ex);
});
