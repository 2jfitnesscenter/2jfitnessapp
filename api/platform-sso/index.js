import { z } from 'zod';
import { classifyRoute } from './route-policy.js';
import { capabilitiesV2Schema, createCapabilitiesService } from './capabilities.js';
import { signPlatformServiceRequest } from '../platform-proof/service-auth.js';

// Platform identity integration for Training. Everything here is OFF by default and per-user:
//   legacy   (default)  no Platform check; current behaviour and data untouched
//   shadow              Platform is consulted and divergences are logged; nothing is blocked
//   enforced            capability gates apply (requires a verified link)
// An `sso` session is always strict: it exists only because Platform vouched for the person.

export const ENFORCEMENT_MODES = Object.freeze(['legacy', 'shadow', 'enforced']);
const ALLOWED_TRANSITIONS = new Set(['legacy>shadow', 'shadow>enforced', 'shadow>legacy', 'enforced>shadow']);
export const userMode = user => ENFORCEMENT_MODES.includes(user?.platformEnforcement) ? user.platformEnforcement : 'legacy';
export const transitionAllowed = (from, to) => ALLOWED_TRANSITIONS.has(`${from}>${to}`);

export const SSO_AUDIENCE = '2j-training-sso';
export const SSO_PURPOSE = 'training-session';
export const PLATFORM_REDEEM_PATH = '/api/internal/platform/v2/sso/redeem';
const TRUE = /^(1|true)$/i;
const redeemRequestSchema = z.object({ v: z.literal(1), code: z.string().min(43).max(128).regex(/^[A-Za-z0-9_-]+$/) }).strict();
const redeemResponseSchema = z.object({ v: z.literal(1), personId: z.string(), trainingUserId: z.string().min(1).max(200), capabilities: capabilitiesV2Schema }).strict();
const enforcementRequestSchema = z.object({ userId: z.string().min(1).max(200), mode: z.enum(['legacy', 'shadow', 'enforced']) }).strict();

export function parsePlatformIntegrationEnv(env) {
  const secret = Buffer.from(String(env.PLATFORM_API_KEY_SECRET || ''), 'base64url');
  let baseUrl = null;
  try {
    const url = new URL(String(env.PLATFORM_API_BASE_URL || ''));
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if (!url.username && !url.password && (url.protocol === 'https:' || (url.protocol === 'http:' && loopback))) baseUrl = url.origin;
  } catch { /* not configured */ }
  const keyId = /^[A-Za-z0-9._-]{1,80}$/.test(String(env.PLATFORM_API_KEY_ID || '')) ? String(env.PLATFORM_API_KEY_ID) : null;
  const configured = Boolean(baseUrl && keyId && secret.length >= 32 && secret.toString('base64url') === env.PLATFORM_API_KEY_SECRET);
  return { ssoEnabled: TRUE.test(env.PLATFORM_SSO_ENABLED || ''), client: configured ? { baseUrl, keyId, secret } : null };
}

export function createPlatformIntegration({ config, db, saveDb, secEvent, json, readBody, readSession, requireAdmin, isTrainer, proofStore, origin, newSsoSession, isEnvAdmin = () => false, rateLimit, fetchImpl = globalThis.fetch, now = Date.now, log = console }) {
  const revokeSsoSessions = (user, reason) => {
    let revoked = 0;
    for (const record of db.deviceSessions) if (record.userId === user.id && record.via === 'sso' && !record.revokedAt) { record.revokedAt = new Date(now()).toISOString(); revoked++; }
    if (revoked) { secEvent('platform_sso_sessions_revoked', { userId: user.id, meta: { reason, revoked } }); saveDb(); }
  };
  const capabilities = createCapabilitiesService({
    config: config.client, now, fetchImpl,
    onRestriction: (user, restriction) => {
      const target = db.users.find(candidate => candidate.id === user.id);
      if (!target) return;
      if (restriction) target.platformRestriction = restriction; else delete target.platformRestriction;
      saveDb();
    },
    onLinkLost: (user, reason) => revokeSsoSessions(user, reason),
  });

  const shadowSeen = new Map();
  function shadowDivergence(user, key, view, names) {
    const bucket = `${user.id}|${key}|${Math.floor(now() / 3_600_000)}`;
    if (shadowSeen.has(bucket)) return;
    if (shadowSeen.size > 5000) shadowSeen.clear();
    shadowSeen.set(bucket, true);
    log.warn?.(`platform shadow divergence user=${user.id} route=${key} level=${view?.level ?? 'none'} reason=${view?.reasonCode ?? 'none'} needs=${names.join(',')}`);
  }

  const deny = (res, code, extra = {}) => json(res, 403, { error: code === 'passkey_required' ? 'esta acción requiere iniciar sesión con passkey' : 'tu cuenta no tiene acceso a esta función', code, ...extra });

  /** Central dispatcher hook. Returns false when it already answered. */
  async function gate(req, res, key) {
    if (key === 'POST /api/platform/v1/sso/redeem') return true;   // redeeming is how a session is (re)established; it validates everything itself
    if (!req.headers.cookie || !req.headers.cookie.includes('gymsid=')) return true;
    const policy = classifyRoute(key);
    const session = readSession(req);
    if (!session) return true;                                  // the handler answers 401 / public
    if (session.authLevel === 'sso') {
      if (!policy.ssoAllowed) { deny(res, 'passkey_required'); return false; }
      const view = await capabilities.evaluate(session, { mode: 'enforced' });
      if ((!view || view.level === 'blocked') && key !== 'POST /api/logout') { deny(res, 'platform_access_blocked', { reasonCode: view?.reasonCode ?? 'UNVERIFIED' }); return false; }
      if (policy.kind === 'gated' && !capabilities.allows(view, policy.capabilities)) { deny(res, 'capability_required', { capabilities: policy.capabilities, reasonCode: view.reasonCode }); return false; }
      return true;
    }
    const mode = userMode(session);
    if (mode === 'legacy' || policy.kind !== 'gated') return true;
    if (isTrainer(session)) return true;                        // staff functions never depend on the staff member's own capabilities
    const view = await capabilities.evaluate(session, { mode });
    const ok = capabilities.allows(view, policy.capabilities);
    if (mode === 'shadow') { if (!ok) shadowDivergence(session, key, view, policy.capabilities); return true; }
    if (!ok) { deny(res, 'capability_required', { capabilities: policy.capabilities, reasonCode: view?.reasonCode ?? 'UNVERIFIED' }); return false; }
    return true;
  }

  /** For handlers that identify the member themselves (kiosk PIN). */
  async function memberGate(user, names = ['autonomousTraining']) {
    const mode = userMode(user);
    if (mode === 'legacy' || isTrainer(user)) return { allowed: true };
    const view = await capabilities.evaluate(user, { mode });
    const ok = capabilities.allows(view, names);
    if (mode === 'shadow') { if (!ok) shadowDivergence(user, 'kiosk', view, names); return { allowed: true }; }
    return ok ? { allowed: true } : { allowed: false, reasonCode: view?.reasonCode ?? 'UNVERIFIED' };
  }

  async function redeemWithPlatform(code) {
    if (!config.client) return { status: 503 };
    const path = PLATFORM_REDEEM_PATH, timestamp = new Date(now()).toISOString(), requestId = globalThis.crypto.randomUUID();
    const body = Buffer.from(JSON.stringify({ v: 1, code, audience: SSO_AUDIENCE, purpose: SSO_PURPOSE }), 'utf8');
    const { signature } = signPlatformServiceRequest({ keyId: config.client.keyId, secret: config.client.secret, timestamp, requestId, method: 'POST', path, body });
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetchImpl(new URL(path, config.client.baseUrl), {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { 'content-type': 'application/json', 'x-2j-key-id': config.client.keyId, 'x-2j-timestamp': timestamp, 'x-2j-request-id': requestId, 'x-2j-signature': signature }, body,
      });
      const payload = await response.json().catch(() => null);
      if (response.status === 200) { const parsed = redeemResponseSchema.safeParse(payload); return parsed.success ? { status: 200, data: parsed.data } : { status: 502 }; }
      return { status: response.status, reasonCode: typeof payload?.reasonCode === 'string' ? payload.reasonCode : null };
    } catch { return { status: 503 }; }
    finally { clearTimeout(timer); }
  }

  const routes = {
    // Browser -> Training. The code arrives in the URL fragment on Training's own page and is posted here once.
    'POST /api/platform/v1/sso/redeem': async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      if (!config.ssoEnabled) return json(res, 423, { error: 'platform_sso_disabled' });
      if (req.headers.origin !== origin) return json(res, 403, { error: 'origin_rejected' });
      const ip = rateLimit.gate(req, res); if (!ip) return;
      const body = redeemRequestSchema.safeParse(await readBody(req));
      if (!body.success) { rateLimit.fail(ip); return json(res, 400, { error: 'invalid_sso_request' }); }
      const result = await redeemWithPlatform(body.data.code);
      if (result.status === 403) { rateLimit.fail(ip); return json(res, 403, { error: 'platform_access_blocked', reasonCode: result.reasonCode }); }
      if (result.status !== 200) {
        if ([404, 409, 410].includes(result.status)) { rateLimit.fail(ip); return json(res, 400, { error: 'sso_code_invalid' }); }
        return json(res, 503, { error: 'platform_unavailable' });
      }
      const { personId, trainingUserId, capabilities: payload } = result.data;
      const fail = (status, error) => { rateLimit.fail(ip); return json(res, status, { error }); };
      if (payload.personId !== personId || payload.trainingSubject.linkStatus !== 'active' || payload.trainingSubject.trainingUserId !== trainingUserId || payload.capabilityLevel === 'blocked') return fail(403, 'platform_access_blocked');
      const user = db.users.find(candidate => candidate.id === trainingUserId);
      if (!user || user.disabled) return fail(400, 'sso_code_invalid');
      if (isEnvAdmin(user.id)) return fail(403, 'platform_access_blocked');   // administrators from ADMIN_UIDS sign in with their passkey only
      // Bilateral link: Platform says the person owns this Training user; Training must hold its own evidence.
      if (user.personId && user.personId !== personId) return fail(409, 'link_conflict');
      if (db.users.some(candidate => candidate.id !== user.id && candidate.personId === personId)) return fail(409, 'link_conflict');
      let evidence;
      try { evidence = proofStore.linkEvidence({ personId, trainingUserId }); } catch { return json(res, 503, { error: 'link_store_unavailable' }); }
      const provisioned = user.platformLink?.origin === 'provisioned' && user.platformLink.personId === personId;
      if (evidence.status === 'conflict') return fail(409, 'link_conflict');
      if (evidence.status !== 'linked' && !provisioned) return fail(409, 'link_not_confirmed');
      user.personId = personId;
      user.platformLink = provisioned ? user.platformLink : { personId, state: 'active', origin: 'proof', receiptId: evidence.receiptId, verifiedAt: evidence.verifiedAt };
      delete user.platformRestriction;
      capabilities.prime(personId, payload);
      secEvent('platform_sso_login', { userId: user.id, meta: { capabilityLevel: payload.capabilityLevel } });
      saveDb();
      // A valid passkey (or other non-sso) session for the SAME account is stronger than an sso one: keep it rather than
      // replacing the cookie. A session of another account, an invalid cookie, or an older sso session is replaced.
      const current = readSession(req);
      if (current && current.id === user.id && current.authLevel !== 'sso') {
        return json(res, 200, { ok: true, sessionKept: true, capabilityLevel: payload.capabilityLevel, user: { id: user.id, name: user.name, authLevel: current.authLevel } });
      }
      json(res, 200, {
        ok: true, capabilityLevel: payload.capabilityLevel,
        user: { id: user.id, name: user.name, username: user.username || null, created: user.created || null, avatar: user.avatar || null, admin: false, trainer: false, authLevel: 'sso' },
      }, { 'Set-Cookie': newSsoSession(req, user) });
    },

    // Administrator moves ONE user along legacy -> shadow -> enforced (and back to shadow). No global switch exists.
    'POST /api/admin/platform-enforcement': async (req, res) => {
      const admin = requireAdmin(req, res); if (!admin) return;
      if (admin.authLevel === 'sso') return deny(res, 'passkey_required');
      const body = enforcementRequestSchema.safeParse(await readBody(req));
      if (!body.success) return json(res, 400, { error: 'invalid_request' });
      const user = db.users.find(candidate => candidate.id === body.data.userId);
      if (!user) return json(res, 404, { error: 'ese usuario no existe' });
      const from = userMode(user), to = body.data.mode;
      if (from === to) return json(res, 200, { ok: true, mode: to, unchanged: true });
      if (!transitionAllowed(from, to)) return json(res, 409, { error: 'transition_not_allowed', from, to });
      if (to !== 'legacy') {
        if (!user.personId || user.platformLink?.state !== 'active') return json(res, 409, { error: 'link_required' });
        if (to === 'enforced') {
          const view = await capabilities.evaluate(user, { mode: 'shadow' });
          if (!view || view.source === 'degraded' || view.level === 'blocked') return json(res, 409, { error: 'platform_verification_required', reasonCode: view?.reasonCode ?? 'UNVERIFIED' });
        }
      }
      user.platformEnforcement = to;
      secEvent('admin_action', { userId: user.id, actorId: admin.id, meta: { kind: 'platform_enforcement', from, to } });
      saveDb();
      json(res, 200, { ok: true, mode: to, from });
    },
  };

  return { routes, gate, memberGate, capabilities, revokeSsoSessions, classifyRoute };
}
