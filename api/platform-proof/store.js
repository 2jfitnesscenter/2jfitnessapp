import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { encrypt, decrypt } from '../lib/crypto.js';

const INFO = '2j-platform-link-proofs-v1';
const STORE_FILE = 'platform-link-proofs.dat';
const SERVICE_REPLAY_TTL_MS = 2 * 60_000;
const PROOF_RETENTION_MS = 90 * 24 * 60 * 60_000;

const emptyState = () => ({ schemaVersion: 1, proofs: [], serviceRequests: [], audit: [] });
const isRecord = value => value && typeof value === 'object' && !Array.isArray(value);
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
function constantTimeHexEqual(left, right) {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

/** Durable, encrypted Training-side proof and service replay store. Mutations are synchronous
 * (read/check/write without yielding), so requests are serialized within this single API process. */
export function createPlatformProofStore({ dataDir = process.env.DATA_DIR || '/data', now = Date.now } = {}) {
  const file = path.join(dataDir, STORE_FILE);
  function read() {
    let blob;
    try { blob = fs.readFileSync(file, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return emptyState(); throw error; }
    const state = decrypt(blob, INFO);
    if (!isRecord(state) || state.schemaVersion !== 1 || !Array.isArray(state.proofs) || !Array.isArray(state.serviceRequests) || !Array.isArray(state.audit)) {
      throw Object.assign(new Error('Platform proof store is unavailable'), { code: 'PLATFORM_PROOF_STORE_UNAVAILABLE' });
    }
    return state;
  }
  function write(state) {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temp, encrypt(state, INFO), { mode: 0o600, flag: 'wx' });
      fs.renameSync(temp, file);
    } catch (error) {
      try { fs.unlinkSync(temp); } catch { /* cleanup is best effort */ }
      throw error;
    }
  }
  const audit = (state, event, values = {}) => {
    state.audit.push({ event, occurredAt: new Date(now()).toISOString(), ...values });
    if (state.audit.length > 20_000) state.audit.splice(0, state.audit.length - 20_000);
  };
  function expireAndPrune(state, timestamp) {
    for (const proof of state.proofs) {
      if (proof.status === 'pending' && proof.expiresAtMs <= timestamp) {
        proof.status = 'expired';
        proof.consumedAt = null;
        audit(state, 'platform_proof.expired', { proofId: proof.proofId, transactionId: proof.transactionId });
      }
    }
    state.proofs = state.proofs.filter(proof => proof.status === 'pending' || timestamp - (proof.consumedAtMs || proof.expiresAtMs) <= PROOF_RETENTION_MS);
    state.serviceRequests = state.serviceRequests.filter(request => request.expiresAtMs > timestamp);
  }

  return {
    issue(context, trainingUserId) {
      const timestamp = now(), state = read();
      expireAndPrune(state, timestamp);
      for (const proof of state.proofs) {
        if (proof.status === 'pending' && proof.transactionId === context.transactionId && proof.trainingUserId === trainingUserId) {
          proof.status = 'expired';
          proof.consumedAt = null;
          audit(state, 'platform_proof.expired', { proofId: proof.proofId, transactionId: proof.transactionId, reason: 'superseded' });
        }
      }
      const code = crypto.randomBytes(32).toString('base64url');
      const codeHash = sha256(Buffer.from(code, 'utf8'));
      const expiresAtMs = Math.min(timestamp + 120_000, context.platformExpiresAtMs);
      const proof = {
        proofId: crypto.randomUUID(), codeHash,
        transactionId: context.transactionId, personId: context.personId,
        audience: context.audience, purpose: context.purpose, challengeDigest: context.challengeDigest,
        trainingUserId, status: 'pending', createdAt: new Date(timestamp).toISOString(),
        expiresAtMs, expiresAt: new Date(expiresAtMs).toISOString(), consumedAt: null,
      };
      state.proofs.push(proof);
      audit(state, 'platform_proof.issued', { proofId: proof.proofId, transactionId: proof.transactionId, expiresAt: proof.expiresAt });
      write(state);
      return { code, expiresAt: proof.expiresAt };
    },

    exchange({ codeHash, requestId, context, isTrainingUserActive }) {
      const timestamp = now(), state = read();
      expireAndPrune(state, timestamp);
      if (state.serviceRequests.some(request => request.requestId === requestId)) {
        audit(state, 'platform_service_auth.replay_rejected', { requestId });
        write(state);
        return { status: 'service_request_replayed' };
      }
      state.serviceRequests.push({ requestId, expiresAtMs: timestamp + SERVICE_REPLAY_TTL_MS });
      const proof = state.proofs.find(candidate => constantTimeHexEqual(candidate.codeHash, codeHash));
      if (!proof) { write(state); return { status: 'proof_not_found' }; }
      if (proof.status === 'consumed') {
        audit(state, 'platform_proof.replay_rejected', { proofId: proof.proofId, transactionId: proof.transactionId });
        write(state);
        return { status: 'proof_already_consumed' };
      }
      if (proof.status !== 'pending' || proof.expiresAtMs <= timestamp) {
        if (proof.status === 'pending') {
          proof.status = 'expired';
          audit(state, 'platform_proof.expired', { proofId: proof.proofId, transactionId: proof.transactionId });
        }
        write(state);
        return { status: 'proof_expired' };
      }
      if (proof.transactionId !== context.transactionId || proof.personId !== context.personId || proof.audience !== context.audience || proof.purpose !== context.purpose || proof.challengeDigest !== context.challengeDigest) {
        audit(state, 'platform_proof.context_mismatch', { proofId: proof.proofId, transactionId: proof.transactionId });
        write(state);
        return { status: 'proof_context_mismatch' };
      }
      if (!isTrainingUserActive(proof.trainingUserId)) { write(state); return { status: 'proof_not_found' }; }
      proof.status = 'consumed';
      proof.consumedAtMs = timestamp;
      proof.consumedAt = new Date(timestamp).toISOString();
      audit(state, 'platform_proof.exchanged', { proofId: proof.proofId, transactionId: proof.transactionId, verifiedAt: proof.consumedAt });
      write(state);
      return {
        status: 'exchanged',
        receipt: {
          v: 1, transactionId: proof.transactionId, personId: proof.personId,
          trainingUserId: proof.trainingUserId, audience: proof.audience, purpose: proof.purpose,
          verifiedAt: proof.consumedAt,
        },
      };
    },

    /** Test/operations view excludes code hashes, account IDs and any raw secret material. */
    auditEvents() { return read().audit.map(event => ({ ...event })); },
  };
}

export const platformProofStoreConstants = Object.freeze({ STORE_FILE, INFO, SERVICE_REPLAY_TTL_MS, PROOF_RETENTION_MS });
