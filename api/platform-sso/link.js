import crypto from 'node:crypto';
import { z } from 'zod';
import { readRawBody } from '../platform-proof/routes.js';
import { SERVICE_LINK_ACTIVATE_PATH, SERVICE_LINK_REVOKE_PATH, SERVICE_PROVISION_PATH, SERVICE_SIGNAL_PATH, verifyPlatformServiceRequest } from '../platform-proof/service-auth.js';

// Training side of the bilateral account link (the other half lives in Platform's training-link-flow.ts).
//
//   link state, kept on the Training user:  user.platformLink = { personId, state: 'pending'|'active'|'revoked', origin: 'proof'|'provisioned', linkId, linkVersion, ackId, ... }
//
//   activate  Platform asks Training to acknowledge a link. Training only agrees when it holds its OWN evidence:
//               origin 'proof'        the owner of this Training account proved control with a passkey session (a stored receipt for exactly this person and user)
//               origin 'provisioned'  this account was created by this very Platform request chain and is still pending for that person
//             A person can hold one link and a Training user can hold one link (pending or active); anything else is a conflict. Nothing is inferred from
//             names, e-mail or phone, and a historical account can never be activated without its owner's proof.
//   revoke    Platform ends the link; Training closes the account's sso sessions and never relaxes an enforcement mode (a provisioned account stays enforced and
//             therefore blocked until it is linked again).
//   provision Platform asks for a new minimal profile (display name + person link). Idempotent on the idempotency key; the same person can only be provisioned once.
//
// Every route is OFF unless explicitly enabled, requires 2J-SERVICE-AUTH-V1 (Platform's key), stores single-use request ids and fails closed.

const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const userIdSchema = z.string().min(1).max(200).refine(value => value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value));
const activateSchema = z.object({
  v: z.literal(1), linkId: UUID, linkVersion: z.number().int().min(1).max(1_000_000), personId: UUID, trainingUserId: userIdSchema,
  origin: z.enum(['proof', 'provisioned', 'admin_assisted']), receiptId: UUID.optional(), reviewId: UUID.optional(),
}).strict().refine(body => body.origin === 'admin_assisted' ? !!(body.receiptId && body.reviewId) : !body.reviewId, { message: 'admin_assisted needs receiptId and reviewId; reviewId is only for admin_assisted' });
const revokeSchema = z.object({ v: z.literal(1), linkId: UUID, linkVersion: z.number().int().min(1).max(1_000_000), personId: UUID, trainingUserId: userIdSchema, reason: z.string().max(80).optional() }).strict();
const provisionSchema = z.object({
  v: z.literal(1), idempotencyKey: UUID, correlationId: UUID, personId: UUID,
  displayName: z.string().min(1).max(60).refine(value => value.trim() === value && !/[\u0000-\u001f\u007f<>]/.test(value)),
}).strict();

// Signed Platform -> Training signal (2J-CAPABILITY-SIGNAL-V1). It can only RESTRICT or force a fresh verification; it never grants anything.
const signalSchema = z.object({
  v: z.literal(1), signalId: UUID, kind: z.enum(['suspended', 'lifted']), personId: UUID, trainingUserId: userIdSchema,
  sequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER), occurredAt: z.string().regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/),
}).strict();

const occupies = link => link && ['pending', 'active'].includes(link.state);
const error = (json, res, status, code) => json(res, status, { error: code });

export function createPlatformLinkRoutes({ assisted = null, config, db, saveDb, secEvent, json, store, serviceKeys, revokeSsoSessions, applySignal = () => ({ applied: false }), generateUsername, newUserId = () => crypto.randomBytes(12).toString('base64url'), now = Date.now }) {
  const hashOf = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
  db.platformProvisioning = db.platformProvisioning && typeof db.platformProvisioning === 'object' && !Array.isArray(db.platformProvisioning) ? db.platformProvisioning : {};

  /** Shared guard: flag, raw body, service signature, single-use request id, strict body. */
  async function authenticated(req, res, path, schema, enabled) {
    res.setHeader?.('Cache-Control', 'no-store');
    if (!enabled) { error(json, res, 423, 'platform_link_disabled'); return null; }
    let raw;
    try { raw = await readRawBody(req); } catch (cause) { error(json, res, cause?.code === 'BODY_TOO_LARGE' ? 413 : 400, 'invalid_request'); return null; }
    const authorization = verifyPlatformServiceRequest({ method: req.method, requestTarget: req.url, headers: req.headers, body: raw, keys: serviceKeys, now: now() });
    if (authorization.status !== 'ok' || req.url !== path) { error(json, res, 401, authorization.status === 'ok' ? 'service_auth_invalid' : authorization.status); return null; }
    if (req.headers?.['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') { error(json, res, 400, 'invalid_request'); return null; }
    let body;
    try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); } catch { error(json, res, 400, 'invalid_request'); return null; }
    const parsed = schema.safeParse(body);
    if (!parsed.success) { error(json, res, 400, 'invalid_request'); return null; }
    try { if (store.acceptServiceRequest(authorization.requestId, 'platform_link').status !== 'accepted') { error(json, res, 409, 'service_request_replayed'); return null; } }
    catch { error(json, res, 503, 'platform_link_unavailable'); return null; }
    return parsed.data;
  }

  return {
    [`POST ${SERVICE_LINK_ACTIVATE_PATH}`]: async (req, res) => {
      const body = await authenticated(req, res, SERVICE_LINK_ACTIVATE_PATH, activateSchema, config.lifecycleEnabled);
      if (!body) return;
      const user = db.users.find(candidate => candidate.id === body.trainingUserId);
      if (!user || user.disabled) return error(json, res, 404, 'training_user_not_found');
      const current = user.platformLink;
      if (current && current.personId === body.personId && current.state === 'active' && current.linkId === body.linkId) {
        return json(res, 200, { v: 1, status: 'active', replay: true, ackId: current.ackId, linkId: current.linkId, linkVersion: current.linkVersion, trainingUserId: user.id });
      }
      // One link per person and per Training user (pending or active).
      if (occupies(current) && current.personId !== body.personId) return error(json, res, 409, 'link_conflict');
      if (db.users.some(other => other.id !== user.id && occupies(other.platformLink) && other.platformLink.personId === body.personId)) return error(json, res, 409, 'link_conflict');
      if (body.origin === 'proof') {
        let evidence;
        try { evidence = store.linkEvidence({ personId: body.personId, trainingUserId: user.id }); } catch { return error(json, res, 503, 'link_store_unavailable'); }
        if (evidence.status === 'conflict') return error(json, res, 409, 'link_conflict');
        if (evidence.status !== 'linked' || (body.receiptId && body.receiptId !== evidence.receiptId)) return error(json, res, 409, 'proof_required');
        if (current?.state === 'revoked' && !(Date.parse(evidence.verifiedAt) > Date.parse(current.revokedAt))) return error(json, res, 409, 'proof_required');   // after a revocation only a NEW proof counts
        user.platformLink = { personId: body.personId, state: 'active', origin: 'proof', linkId: body.linkId, linkVersion: body.linkVersion, ackId: crypto.randomUUID(), receiptId: evidence.receiptId, activatedAt: new Date(now()).toISOString() };
      } else if (body.origin === 'admin_assisted') {
        if (!assisted || !assisted.enabled) return error(json, res, 423, 'assisted_link_disabled');
        const outcome = assisted.consume({ receiptId: body.receiptId, reviewId: body.reviewId, personId: body.personId, trainingUserId: user.id, revokedAt: current?.state === 'revoked' ? current.revokedAt : null });
        if (outcome.status === 'unavailable') return error(json, res, 503, 'assist_unavailable');
        if (outcome.status !== 'ok') return error(json, res, 409, 'proof_required');
        user.platformLink = { personId: body.personId, state: 'active', origin: 'admin_assisted', linkId: body.linkId, linkVersion: body.linkVersion, ackId: crypto.randomUUID(), receiptId: body.receiptId, reviewId: body.reviewId, issuedBy: outcome.receipt.issuedBy, activatedAt: new Date(now()).toISOString() };
      } else {
        if (!(current && current.origin === 'provisioned' && current.state === 'pending' && current.personId === body.personId)) return error(json, res, 409, 'not_provisioned');
        user.platformLink = { ...current, state: 'active', linkId: body.linkId, linkVersion: body.linkVersion, ackId: crypto.randomUUID(), activatedAt: new Date(now()).toISOString() };
      }
      user.personId = body.personId;
      secEvent('platform_link_activated', { userId: user.id, meta: { kind: body.origin } });
      saveDb();
      return json(res, 200, { v: 1, status: 'active', replay: false, ackId: user.platformLink.ackId, linkId: body.linkId, linkVersion: body.linkVersion, trainingUserId: user.id });
    },

    [`POST ${SERVICE_LINK_REVOKE_PATH}`]: async (req, res) => {
      const body = await authenticated(req, res, SERVICE_LINK_REVOKE_PATH, revokeSchema, config.lifecycleEnabled);
      if (!body) return;
      const user = db.users.find(candidate => candidate.id === body.trainingUserId);
      const link = user?.platformLink;
      if (!user || !link || link.personId !== body.personId || (link.linkId && link.linkId !== body.linkId)) return error(json, res, 404, 'link_not_found');
      if (link.state !== 'revoked') {
        user.platformLink = { ...link, state: 'revoked', revokedAt: new Date(now()).toISOString(), revokedLinkVersion: body.linkVersion };
        delete user.personId;                                  // frees the person; the history stays in platformLink
        delete user.platformRestriction;
        // Enforcement is never relaxed by unlinking: legacy stays legacy, shadow stays shadow, enforced (including every provisioned account) stays enforced and blocked.
        revokeSsoSessions(user, 'link_revoked');
        secEvent('platform_link_revoked', { userId: user.id, meta: { reason: body.reason || 'platform' } });
        saveDb();
      }
      return json(res, 200, { v: 1, status: 'revoked', ackId: user.platformLink.ackId || crypto.randomUUID(), linkId: body.linkId, trainingUserId: user.id });
    },

    // Platform tells Training, at once, that a suspension was imposed or lifted for a person. This is an accelerator for the 60 s capability cache and a way to
    // keep a suspension in force if Platform becomes unreachable right after; it is never the authority. `suspended` blocks now (and is remembered); `lifted` only
    // makes Training ask Platform again, and access returns when Platform's own answer says so. Signals older than the last one applied are ignored.
    [`POST ${SERVICE_SIGNAL_PATH}`]: async (req, res) => {
      const body = await authenticated(req, res, SERVICE_SIGNAL_PATH, signalSchema, config.signalsEnabled);
      if (!body) return;
      const user = db.users.find(candidate => candidate.id === body.trainingUserId);
      const link = user?.platformLink;
      if (!user || !link || link.state !== 'active' || link.personId !== body.personId || user.personId !== body.personId) return error(json, res, 404, 'link_not_found');
      const outcome = applySignal(user, body);
      return json(res, 200, { v: 1, status: outcome.applied ? 'applied' : 'ignored', signalId: body.signalId, ...(outcome.applied ? {} : { reason: outcome.reason ?? 'stale' }) });
    },

    [`POST ${SERVICE_PROVISION_PATH}`]: async (req, res) => {
      const body = await authenticated(req, res, SERVICE_PROVISION_PATH, provisionSchema, config.provisioningEnabled);
      if (!body) return;
      const requestHash = hashOf({ personId: body.personId, displayName: body.displayName });
      const previous = db.platformProvisioning[body.idempotencyKey];
      if (previous) {
        if (previous.requestHash !== requestHash) return error(json, res, 409, 'idempotency_conflict');
        const existing = db.users.find(candidate => candidate.id === previous.trainingUserId);
        return json(res, 200, { v: 1, status: 'provisioned', replay: true, trainingUserId: previous.trainingUserId, linkState: existing?.platformLink?.state ?? 'pending' });
      }
      // The same person never gets a second profile (and a person already linked to a historical account is refused).
      if (db.users.some(candidate => occupies(candidate.platformLink) && candidate.platformLink.personId === body.personId)) return error(json, res, 409, 'link_conflict');
      if (Object.values(db.platformProvisioning).some(record => record.personId === body.personId)) return error(json, res, 409, 'already_provisioned');
      let id = newUserId();
      while (db.users.some(candidate => candidate.id === id)) id = newUserId();
      const created = new Date(now()).toISOString();
      db.users.push({
        id, name: body.displayName, created, username: generateUsername(body.displayName),
        personId: body.personId,
        // New accounts exist only through Platform and start enforced: they never fall back to the open legacy behaviour, even if later unlinked.
        platformEnforcement: 'enforced',
        platformLink: { personId: body.personId, state: 'pending', origin: 'provisioned', provisioningKey: body.idempotencyKey, createdAt: created },
      });
      db.platformProvisioning[body.idempotencyKey] = { requestHash, personId: body.personId, trainingUserId: id, at: created };
      secEvent('platform_provisioned', { userId: id });
      saveDb();
      return json(res, 201, { v: 1, status: 'provisioned', replay: false, trainingUserId: id, linkState: 'pending' });
    },
  };
}
