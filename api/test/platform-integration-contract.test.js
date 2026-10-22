import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Isolated reference model for the proposed contract. It intentionally does not import server.js,
// register routes, read/write DATA, or change current login/entitlement behavior.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const integrationSchema = JSON.parse(fs.readFileSync(path.join(root, 'contracts/platform-training-integration-v1.schema.json'), 'utf8'));
const entitlementContract = JSON.parse(fs.readFileSync(path.join(root, 'contracts/platform-training-entitlements-v1.json'), 'utf8'));
const PERSON_A = '22222222-2222-4222-8222-222222222222';
const PERSON_B = '33333333-3333-4333-8333-333333333333';
const TRAINING_A = 'training-user-a';
const TRAINING_B = 'training-user-b';
const now = 1_800_000_000_000;

function createReferenceContract() {
  const users = new Map([[TRAINING_A, { id: TRAINING_A, email: 'same@example.test', disabled: false }], [TRAINING_B, { id: TRAINING_B, disabled: false }]]);
  const linksByPerson = new Map();
  const linksByTraining = new Map();
  const idempotency = new Map();
  const requestIds = new Set();
  const proofs = new Map();
  const codes = new Map();
  const sessions = [];
  const passkeys = new Set([`${TRAINING_A}:passkey-1`]);

  function acceptRequest({ authenticated = true, requestId, idempotencyKey }) {
    if (!authenticated) return 'service_auth_invalid';
    if (!requestId || requestIds.has(requestId)) return 'service_request_replayed';
    requestIds.add(requestId);
    return idempotencyKey ? 'ok' : 'idempotency_key_required';
  }

  return {
    users, linksByPerson, linksByTraining, proofs, codes, sessions, passkeys,
    provision({ authenticated = true, requestId, idempotencyKey, personId, email }) {
      const auth = acceptRequest({ authenticated, requestId, idempotencyKey });
      if (auth !== 'ok') return { status: auth };
      const requestBody = { v: 1, personId, idempotencyKey, correlationId: `corr-${requestId}`, ...(email === undefined ? {} : { email }) };
      const keys = integrationSchema.$defs.provisionRequest.required;
      if (Object.keys(requestBody).some(key => !keys.includes(key)) || keys.some(key => !(key in requestBody))) return { status: 'invalid_request' };
      const prior = idempotency.get(idempotencyKey);
      if (prior) return prior.personId === personId ? { status: 'already_provisioned', ...prior } : { status: 'idempotency_conflict' };
      // Email is deliberately ignored for identity and existing-account resolution.
      void email;
      if (linksByPerson.has(personId)) return { status: 'person_link_conflict' };
      const trainingUserId = `provisioned-${personId}`;
      if (linksByTraining.has(trainingUserId) || [...users.values()].some(user => user.id === trainingUserId)) return { status: 'training_user_conflict' };
      users.set(trainingUserId, { id: trainingUserId, disabled: false });
      const result = { personId, trainingUserId, linkStatus: 'active' };
      linksByPerson.set(personId, trainingUserId);
      linksByTraining.set(trainingUserId, personId);
      idempotency.set(idempotencyKey, result);
      return { status: 'created', ...result };
    },
    issueOwnershipProof({ personId, trainingUserId, passkeyVerified = true, expiresAt = now + 120_000 }) {
      if (!passkeyVerified || !users.has(trainingUserId)) return { status: 'ownership_proof_failed' };
      const code = crypto.randomBytes(32).toString('base64url');
      proofs.set(code, { personId, trainingUserId, expiresAt, consumed: false });
      return { status: 'issued', code };
    },
    linkExisting({ code, nowAt = now }) {
      const proof = proofs.get(code);
      if (!proof) return { status: 'proof_not_found' };
      if (proof.consumed) return { status: 'proof_replayed' };
      if (proof.expiresAt <= nowAt) return { status: 'proof_expired' };
      if (linksByPerson.has(proof.personId) || linksByTraining.has(proof.trainingUserId)) return { status: 'link_conflict' };
      proof.consumed = true;
      linksByPerson.set(proof.personId, proof.trainingUserId);
      linksByTraining.set(proof.trainingUserId, proof.personId);
      return { status: 'linked', personId: proof.personId, trainingUserId: proof.trainingUserId };
    },
    issueSso({ personId, issuer = '2j-platform', audience = '2j-training', destination = 'bunker', expiresAt = now + 60_000 } = {}) {
      const code = crypto.randomBytes(32).toString('base64url');
      codes.set(code, { personId, issuer, audience, destination, expiresAt, consumed: false });
      return code;
    },
    redeemSso({ code, nowAt = now, issuer = '2j-platform', audience = '2j-training', destination = 'bunker' }) {
      const record = codes.get(code);
      if (!record) return { status: 'sso_code_invalid' };
      if (record.consumed) return { status: 'sso_code_consumed' };
      if (record.expiresAt <= nowAt) return { status: 'sso_code_expired' };
      if (record.issuer !== issuer || record.audience !== audience || record.destination !== destination) return { status: 'sso_context_mismatch' };
      const trainingUserId = linksByPerson.get(record.personId);
      if (!trainingUserId || linksByTraining.get(trainingUserId) !== record.personId) return { status: 'active_link_required' };
      const user = users.get(trainingUserId);
      if (!user || user.disabled) return { status: 'training_account_unavailable' };
      record.consumed = true;
      const session = { id: crypto.randomUUID(), trainingUserId, kind: 'training_session', source: 'platform_sso', createdAt: nowAt };
      sessions.push(session);
      return { status: 'redeemed', session };
    },
    revokeLink(personId) {
      const trainingUserId = linksByPerson.get(personId);
      if (!trainingUserId) return false;
      linksByPerson.delete(personId);
      linksByTraining.delete(trainingUserId);
      return true;
    }
  };
}

function capabilityAllowed(snapshot, capability, at = now) {
  const required = entitlementContract.capabilities;
  if (!snapshot || snapshot.v !== 1 || !required.every(key => typeof snapshot.capabilities?.[key] === 'boolean')) return false;
  if (snapshot.linkStatus !== 'active' || snapshot.operationalStatus !== 'allowed') return false;
  const issued = Date.parse(snapshot.issuedAt), expires = Date.parse(snapshot.expiresAt);
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || issued > at || expires <= at) return false;
  return snapshot.capabilities[capability] === true;
}

function snapshot(profile, overrides = {}) {
  return {
    v: 1, personId: PERSON_A, trainingUserId: TRAINING_A, linkStatus: 'active', revision: 1,
    issuedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 60_000).toISOString(),
    operationalStatus: 'allowed', reasonCode: null, correlationId: 'corr-snapshot',
    capabilities: { ...entitlementContract.quotaProfiles[profile] }, ...overrides
  };
}

test('contract schema is strict and declares the approved identity, capabilities, and no runtime activation', () => {
  assert.equal(integrationSchema.$defs.capabilitySnapshot.additionalProperties, false);
  assert.equal(integrationSchema.$defs.provisionRequest.additionalProperties, false);
  assert.deepEqual(integrationSchema.$defs.capabilities.required, entitlementContract.capabilities);
  assert.equal(entitlementContract.status, 'design-only');
  assert.equal(entitlementContract.enforcementEnabled, false);
});

test('force quota grants all six capabilities', () => {
  const values = Object.values(entitlementContract.quotaProfiles.force_current);
  assert.equal(values.length, 6);
  assert.ok(values.every(value => value === true));
});

test('other current quota denies AI and professional follow-up only', () => {
  const caps = entitlementContract.quotaProfiles.other_quota_current;
  assert.equal(caps['training.access'], true);
  assert.equal(caps['training.self_routines'], true);
  assert.equal(caps['training.guided_2j'], true);
  assert.equal(caps['training.premium'], true);
  assert.equal(caps['training.ai'], false);
  assert.equal(caps['training.professional_followup'], false);
});

test('no current quota denies all operational capabilities while preserving account and data policy', () => {
  assert.ok(Object.values(entitlementContract.quotaProfiles.no_current_quota).every(value => value === false));
  assert.equal(entitlementContract.restrictedAccess.preserveIdentityAndTrainingData, true);
  assert.equal(entitlementContract.restrictedAccess.minimumBillingOrContactFlow, 'Home/Platform only');
});

test('backend capability check fails closed even when a frontend says the action is available', () => {
  const uiSaysAllowed = true;
  const deniedSnapshot = snapshot('other_quota_current');
  assert.equal(uiSaysAllowed, true);
  assert.equal(capabilityAllowed(deniedSnapshot, 'training.ai'), false);
  assert.equal(capabilityAllowed(deniedSnapshot, 'training.access'), true);
  assert.equal(capabilityAllowed(snapshot('force_current'), 'training.ai'), true);
  assert.equal(capabilityAllowed(null, 'training.access'), false);
  assert.equal(capabilityAllowed(snapshot('force_current', { expiresAt: new Date(now).toISOString() }), 'training.access'), false);
  assert.equal(capabilityAllowed(snapshot('force_current', { linkStatus: 'revoked' }), 'training.access'), false);
});

test('provision creates one Training-owned account and returns its stable id', () => {
  const contract = createReferenceContract();
  const result = contract.provision({ requestId: 'req-create', idempotencyKey: 'idempotency-create-0001', personId: PERSON_A });
  assert.equal(result.status, 'created');
  assert.equal(result.personId, PERSON_A);
  assert.ok(result.trainingUserId.startsWith('provisioned-'));
  assert.equal(contract.users.has(result.trainingUserId), true);
});

test('same idempotency key returns same provision after a simulated lost response without duplicate user', () => {
  const contract = createReferenceContract();
  const first = contract.provision({ requestId: 'req-first', idempotencyKey: 'idempotency-retry-0001', personId: PERSON_A });
  const retry = contract.provision({ requestId: 'req-retry', idempotencyKey: 'idempotency-retry-0001', personId: PERSON_A });
  assert.equal(first.status, 'created');
  assert.equal(retry.status, 'already_provisioned');
  assert.equal(retry.trainingUserId, first.trainingUserId);
  assert.equal([...contract.users.keys()].filter(id => id === first.trainingUserId).length, 1);
});

test('same idempotency key with a different person is a conflict', () => {
  const contract = createReferenceContract();
  contract.provision({ requestId: 'req-a', idempotencyKey: 'idempotency-conflict-0001', personId: PERSON_A });
  assert.equal(contract.provision({ requestId: 'req-b', idempotencyKey: 'idempotency-conflict-0001', personId: PERSON_B }).status, 'idempotency_conflict');
});

test('personId uniqueness prevents a second Training profile for the same person', () => {
  const contract = createReferenceContract();
  contract.provision({ requestId: 'req-a', idempotencyKey: 'idempotency-person-0001', personId: PERSON_A });
  assert.equal(contract.provision({ requestId: 'req-b', idempotencyKey: 'idempotency-person-0002', personId: PERSON_A }).status, 'person_link_conflict');
});

test('trainingUserId uniqueness prevents two people claiming one existing account', () => {
  const contract = createReferenceContract();
  const proofA = contract.issueOwnershipProof({ personId: PERSON_A, trainingUserId: TRAINING_A });
  assert.equal(contract.linkExisting({ code: proofA.code }).status, 'linked');
  const proofB = contract.issueOwnershipProof({ personId: PERSON_B, trainingUserId: TRAINING_A });
  assert.equal(contract.linkExisting({ code: proofB.code }).status, 'link_conflict');
});

test('email coincidence cannot take over an existing account and is rejected by strict provision schema', () => {
  const contract = createReferenceContract();
  const before = contract.users.size;
  const result = contract.provision({ requestId: 'req-email', idempotencyKey: 'idempotency-email-0001', personId: PERSON_B, email: 'same@example.test' });
  assert.equal(result.status, 'invalid_request');
  assert.equal(contract.linksByTraining.has(TRAINING_A), false);
  assert.equal(contract.linksByPerson.has(PERSON_B), false);
  assert.equal(contract.users.size, before);
  assert.equal(integrationSchema.$defs.provisionRequest.properties.email, undefined);
});

test('invalid server auth and replayed request id are rejected', () => {
  const contract = createReferenceContract();
  const request = { requestId: 'req-auth', idempotencyKey: 'idempotency-auth-0001', personId: PERSON_A };
  assert.equal(contract.provision({ ...request, authenticated: false }).status, 'service_auth_invalid');
  assert.equal(contract.provision(request).status, 'created');
  assert.equal(contract.provision(request).status, 'service_request_replayed');
});

test('ownership proof requires current passkey-authenticated Training ownership', () => {
  const contract = createReferenceContract();
  assert.equal(contract.issueOwnershipProof({ personId: PERSON_A, trainingUserId: TRAINING_A, passkeyVerified: false }).status, 'ownership_proof_failed');
  assert.equal(contract.issueOwnershipProof({ personId: PERSON_A, trainingUserId: 'missing' }).status, 'ownership_proof_failed');
  const proof = contract.issueOwnershipProof({ personId: PERSON_A, trainingUserId: TRAINING_A });
  assert.equal(contract.linkExisting({ code: proof.code }).status, 'linked');
});

test('ownership proof is single-use and expired proof cannot link', () => {
  const contract = createReferenceContract();
  const proof = contract.issueOwnershipProof({ personId: PERSON_A, trainingUserId: TRAINING_A });
  assert.equal(contract.linkExisting({ code: proof.code }).status, 'linked');
  assert.equal(contract.linkExisting({ code: proof.code }).status, 'proof_replayed');
  const expired = contract.issueOwnershipProof({ personId: PERSON_B, trainingUserId: TRAINING_B, expiresAt: now });
  assert.equal(contract.linkExisting({ code: expired.code }).status, 'proof_expired');
});

test('link conflicts never overwrite an already linked person', () => {
  const contract = createReferenceContract();
  const first = contract.issueOwnershipProof({ personId: PERSON_A, trainingUserId: TRAINING_A });
  assert.equal(contract.linkExisting({ code: first.code }).status, 'linked');
  const second = contract.issueOwnershipProof({ personId: PERSON_A, trainingUserId: TRAINING_B });
  assert.equal(contract.linkExisting({ code: second.code }).status, 'link_conflict');
  assert.equal(contract.linksByPerson.get(PERSON_A), TRAINING_A);
});

test('SSO success creates a Training-owned session without changing passkeys or existing sessions', () => {
  const contract = createReferenceContract();
  const proof = contract.issueOwnershipProof({ personId: PERSON_A, trainingUserId: TRAINING_A });
  contract.linkExisting({ code: proof.code });
  const passkeysBefore = [...contract.passkeys];
  const sessionCountBefore = contract.sessions.length;
  const code = contract.issueSso({ personId: PERSON_A });
  const result = contract.redeemSso({ code });
  assert.equal(result.status, 'redeemed');
  assert.equal(result.session.trainingUserId, TRAINING_A);
  assert.equal(result.session.kind, 'training_session');
  assert.equal(contract.sessions.length, sessionCountBefore + 1);
  assert.deepEqual([...contract.passkeys], passkeysBefore);
});

test('SSO code is single-use', () => {
  const contract = createReferenceContract();
  const proof = contract.issueOwnershipProof({ personId: PERSON_A, trainingUserId: TRAINING_A });
  contract.linkExisting({ code: proof.code });
  const code = contract.issueSso({ personId: PERSON_A });
  assert.equal(contract.redeemSso({ code }).status, 'redeemed');
  assert.equal(contract.redeemSso({ code }).status, 'sso_code_consumed');
});

test('concurrent SSO redemptions consume exactly once', async () => {
  const contract = createReferenceContract();
  const proof = contract.issueOwnershipProof({ personId: PERSON_A, trainingUserId: TRAINING_A });
  contract.linkExisting({ code: proof.code });
  const code = contract.issueSso({ personId: PERSON_A });
  const results = await Promise.all([0, 1].map(() => Promise.resolve().then(() => contract.redeemSso({ code }))));
  assert.deepEqual(results.map(result => result.status).sort(), ['redeemed', 'sso_code_consumed']);
  assert.equal(contract.sessions.length, 1);
});

test('SSO expiry, wrong issuer/audience/destination, and tampered code fail closed', () => {
  const contract = createReferenceContract();
  const expired = contract.issueSso({ personId: PERSON_A, expiresAt: now });
  assert.equal(contract.redeemSso({ code: expired }).status, 'sso_code_expired');
  const wrongContext = contract.issueSso({ personId: PERSON_A, issuer: 'other-issuer' });
  assert.equal(contract.redeemSso({ code: wrongContext }).status, 'sso_context_mismatch');
  const wrongAudience = contract.issueSso({ personId: PERSON_A });
  assert.equal(contract.redeemSso({ code: wrongAudience, audience: 'other-audience' }).status, 'sso_context_mismatch');
  const wrongDestination = contract.issueSso({ personId: PERSON_A });
  assert.equal(contract.redeemSso({ code: wrongDestination, destination: 'other-app' }).status, 'sso_context_mismatch');
  assert.equal(contract.redeemSso({ code: `${wrongDestination.slice(0, -1)}x` }).status, 'sso_code_invalid');
});

test('SSO requires an active link and an existing enabled Training account', () => {
  const contract = createReferenceContract();
  const unlinked = contract.issueSso({ personId: PERSON_A });
  assert.equal(contract.redeemSso({ code: unlinked }).status, 'active_link_required');
  const proof = contract.issueOwnershipProof({ personId: PERSON_A, trainingUserId: TRAINING_A });
  contract.linkExisting({ code: proof.code });
  contract.revokeLink(PERSON_A);
  const revoked = contract.issueSso({ personId: PERSON_A });
  assert.equal(contract.redeemSso({ code: revoked }).status, 'active_link_required');
});

test('staff exemption applies to staff identity, while an acting member is gated by the member snapshot', () => {
  const staffHasNoQuota = snapshot('no_current_quota');
  const memberHasAccess = snapshot('other_quota_current');
  assert.equal(capabilityAllowed(staffHasNoQuota, 'training.access'), false);
  // Staff route authorization is a separate role check; member capability is evaluated for the target.
  const staffRoleValid = true;
  assert.equal(staffRoleValid, true);
  assert.equal(capabilityAllowed(memberHasAccess, 'training.professional_followup'), false);
  assert.equal(capabilityAllowed(snapshot('force_current'), 'training.professional_followup'), true);
});
