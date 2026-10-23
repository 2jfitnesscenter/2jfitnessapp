import { z } from 'zod';
import { classifyRoute } from './route-policy.js';
import { applyStatePolicy } from './state-policy.js';
import { capabilitiesV2Schema, createCapabilitiesService } from './capabilities.js';
import { signPlatformServiceRequest } from '../platform-proof/service-auth.js';

// Platform identity integration for Training. Everything here is OFF by default and per-user:
//   legacy   (default)  no Platform check; current behaviour and data untouched
//   shadow              Platform is consulted and divergences are logged; nothing is blocked
//   enforced            capability gates apply (requires a verified link)
// An `sso` session is always strict: it exists only because Platform vouched for the person.

export const ENFORCEMENT_MODES = Object.freeze(['legacy', 'shadow', 'enforced']);
const ALLOWED_TRANSITIONS = new Set(['legacy>shadow', 'shadow>enforced', 'shadow>legacy', 'enforced>shadow']);
/** The account's link, acknowledged by BOTH sides (Platform activated it only after Training agreed). */
export const linkActive = user => user?.platformLink?.state === 'active' && typeof user.personId === 'string';
export const userMode = user => ENFORCEMENT_MODES.includes(user?.platformEnforcement) ? user.platformEnforcement : 'legacy';
/** H10: when the integration itself fails (a bug, not a Platform refusal), only users who opted in to enforcement/shadow lose access; legacy and anonymous callers always proceed. */
export const gateFailureMayProceed = session => !session || userMode(session) === 'legacy';
export const transitionAllowed = (from, to) => ALLOWED_TRANSITIONS.has(`${from}>${to}`);

export const SSO_AUDIENCE = '2j-training-sso';
export const SSO_PURPOSE = 'training-session';
export const PLATFORM_REDEEM_PATH = '/api/internal/platform/v2/sso/redeem';
// Browser binding (PKCE S256). The flow starts HERE: /sso/start puts a random verifier in an HttpOnly cookie of this origin and sends the
// browser to Home with only its SHA-256 challenge. Platform issues the code for that challenge; redemption presents the verifier from the cookie,
// server-to-server. A code that reaches any other browser (login CSRF, a forwarded link) has no matching cookie and cannot be redeemed.
export const SSO_BIND_COOKIE = 'j2ssob';
export const SSO_BIND_PATH = '/api/platform/v1/sso';
export const SSO_BIND_MAX_AGE_S = 600;
const BIND_VERIFIER = /^[A-Za-z0-9_-]{43}$/;
const bindCookieValue = req => { const match = new RegExp(`(?:^|;\\s*)${SSO_BIND_COOKIE}=([^;]+)`).exec(String(req.headers.cookie || '')); return match && BIND_VERIFIER.test(match[1]) ? match[1] : null; };
export const bindingChallengeFor = verifier => globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)).then(buffer => Buffer.from(buffer).toString('base64url'));
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
  let homeUrl = null;                                  // origin of the Home member app, where the browser-bound flow goes to ask Platform for a code
  try {
    const url = new URL(String(env.PLATFORM_HOME_URL || ''));
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if (!url.username && !url.password && !url.search && !url.hash && url.pathname === '/' && (url.protocol === 'https:' || (url.protocol === 'http:' && loopback))) homeUrl = url.origin;
  } catch { /* not configured */ }
  const breakerBase = Number(env.PLATFORM_BREAKER_BASE_MS);
  const breakerBaseMs = Number.isInteger(breakerBase) && breakerBase >= 100 && breakerBase <= 30_000 ? breakerBase : undefined;   // test knob; the default is 5 s
  return { ssoEnabled: TRUE.test(env.PLATFORM_SSO_ENABLED || ''), client: configured ? { baseUrl, keyId, secret } : null, homeUrl, ...(breakerBaseMs ? { breakerBaseMs } : {}) };
}

export function createPlatformIntegration({ config, db, saveDb, secEvent, json, readBody, readSession, requireAdmin, isTrainer, proofStore, origin, newSsoSession, isEnvAdmin = () => false, rateLimit, secureCookie = false, fetchImpl = globalThis.fetch, now = Date.now, log = console }) {
  const revokeSsoSessions = (user, reason) => {
    let revoked = 0;
    for (const record of db.deviceSessions) if (record.userId === user.id && record.via === 'sso' && !record.revokedAt) { record.revokedAt = new Date(now()).toISOString(); revoked++; }
    if (revoked) { secEvent('platform_sso_sessions_revoked', { userId: user.id, meta: { reason, revoked } }); saveDb(); }
  };
  const capabilities = createCapabilitiesService({
    config: config.client, now, fetchImpl, ...(config.breakerBaseMs ? { breakerBaseMs: config.breakerBaseMs } : {}),
    onRestriction: (user, restriction) => {
      const target = db.users.find(candidate => candidate.id === user.id);
      if (!target) return;
      if (restriction) target.platformRestriction = restriction; else delete target.platformRestriction;
      saveDb();
    },
    onLinkLost: (user, reason) => revokeSsoSessions(user, reason),
    // Operational alerts (rate-limited inside the service): Platform unreachable, refusing our service calls, contradicting an identity, or not configured.
    onAlert: (kind, detail) => log.error?.(`platform integration alert: ${kind} ${JSON.stringify(detail)}`),
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

  /**
   * Central dispatcher hook. Returns false when it already answered.
   *
   * The ENFORCEMENT MODE belongs to the user, not to the kind of session (decision H1): a legacy user keeps exactly what Búnker gave them whether they
   * sign in with a passkey or arrive through Platform SSO; shadow only logs; enforced applies Platform's capabilities. What an `sso` session can never
   * do is independent of the mode: it only reaches routes marked `ssoAllowed` (never passkey-only, staff or destructive ones).
   * Route kinds under enforcement: `gated` needs its capabilities; `member` (social, chat, friends, media, push, news) needs the account not to be
   * blocked (administrative suspension, revoked/missing link) so a suspension is coherent for every session type (decision H2); identity, public
   * and staff routes (recovery, export, deletion, logout, administration) are never closed by the capability contract.
   */
  async function gate(req, res, key) {
    if (key === 'GET /api/platform/v1/sso/start' || key === 'POST /api/platform/v1/sso/redeem' || key === 'POST /api/platform/v1/sso/confirm') return true;   // how a session is (re)established; each validates everything itself
    if (!req.headers.cookie || !req.headers.cookie.includes('gymsid=')) return true;
    const policy = classifyRoute(key);
    const session = readSession(req);
    if (!session) return true;                                  // the handler answers 401 / public
    const isSso = session.authLevel === 'sso';
    if (isSso && !policy.ssoAllowed) { deny(res, 'passkey_required'); return false; }
    const mode = userMode(session);
    if (mode === 'legacy') return true;                         // no Platform check, no change of behaviour
    const interactive = policy.kind === 'gated' || (policy.kind === 'member' && !policy.blockedOk && !(policy.blockedReadOk && ['GET', 'HEAD'].includes(req.method)));
    if (!interactive) return true;
    if (!isSso && isTrainer(session)) return true;              // staff functions never depend on the staff member's own capabilities
    if (mode === 'enforced' && !linkActive(session)) { deny(res, 'platform_link_inactive', { reasonCode: 'TRAINING_LINK_MISSING' }); return false; }
    if (mode === 'shadow') {
      // Shadow never waits for Platform and never blocks: the comparison runs in the background.
      capabilities.evaluate(session, { mode }).then(view => {
        const ok = policy.kind === 'gated' ? capabilities.allows(view, policy.capabilities) : view?.level !== 'blocked';
        if (!ok) shadowDivergence(session, key, view, policy.kind === 'gated' ? policy.capabilities : ['not_blocked']);
      }).catch(() => {});
      return true;
    }
    const view = await capabilities.evaluate(session, { mode });
    const ok = policy.kind === 'gated' ? capabilities.allows(view, policy.capabilities) : Boolean(view) && view.level !== 'blocked';
    if (!ok) {
      const blocked = !view || view.level === 'blocked';
      if (blocked && (isSso || policy.kind === 'member')) deny(res, 'platform_access_blocked', { reasonCode: view?.reasonCode ?? 'UNVERIFIED' });
      else deny(res, 'capability_required', { capabilities: policy.capabilities, reasonCode: view?.reasonCode ?? 'UNVERIFIED' });
      return false;
    }
    return true;
  }

  /** For handlers that identify the member themselves (kiosk PIN). */
  async function memberGate(user, names = ['autonomousTraining']) {
    const mode = userMode(user);
    if (mode === 'legacy' || isTrainer(user)) return { allowed: true };
    if (mode === 'enforced' && !linkActive(user)) return { allowed: false, reasonCode: 'TRAINING_LINK_MISSING' };
    if (mode === 'shadow') {                                     // never waits for Platform, never blocks
      capabilities.evaluate(user, { mode }).then(view => { if (!capabilities.allows(view, names)) shadowDivergence(user, 'kiosk', view, names); }).catch(() => {});
      return { allowed: true };
    }
    const view = await capabilities.evaluate(user, { mode });
    const ok = capabilities.allows(view, names);
    return ok ? { allowed: true } : { allowed: false, reasonCode: view?.reasonCode ?? 'UNVERIFIED' };
  }

  /**
   * Content-level check for the synced member state (POST /api/sync save/replace/reset, legacy PUT /api/data). Same route, different
   * operations: free personal content passes, paid subtrees follow their capability. Legacy users and staff are untouched; shadow only logs.
   * Returns { state, stripped, denied } where `state` is what the server should store.
   */
  async function authorizeStateWrite(session, incoming, current) {
    const pass = { state: incoming, stripped: [], denied: [] };
    const mode = userMode(session);
    if (mode === 'legacy' || isTrainer(session) || !incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return pass;
    const view = await capabilities.evaluate(session, { mode });
    if (!view) return pass;                                    // no verdict (shadow/legacy with nothing known): current behaviour
    const verdict = applyStatePolicy({ current, incoming, caps: view.capabilities });
    if (mode === 'shadow') {
      if (verdict.stripped.length || verdict.denied.length) shadowDivergence(session, 'state-write', view, [...verdict.stripped, ...verdict.denied.map(item => item.capability)]);
      return pass;
    }
    if (verdict.stripped.length) secEvent('platform_state_stripped', { userId: session.id, meta: { count: verdict.stripped.length, kind: verdict.stripped[0] } });
    return verdict;
  }

  async function redeemWithPlatform(code, verifier) {
    if (!config.client) return { status: 503 };
    const path = PLATFORM_REDEEM_PATH, timestamp = new Date(now()).toISOString(), requestId = globalThis.crypto.randomUUID();
    const body = Buffer.from(JSON.stringify({ v: 2, code, verifier, audience: SSO_AUDIENCE, purpose: SSO_PURPOSE }), 'utf8');
    const { signature } = signPlatformServiceRequest({ keyId: config.client.keyId, secret: config.client.secret, timestamp, requestId, method: 'POST', path, body });
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetchImpl(new URL(path, config.client.baseUrl), {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { 'content-type': 'application/json', 'x-2j-key-id': config.client.keyId, 'x-2j-timestamp': timestamp, 'x-2j-request-id': requestId, 'x-2j-signature': signature }, body,
      });
      const payload = await response.json().catch(() => null);
      if (response.status === 200) { const parsed = redeemResponseSchema.safeParse(payload); return parsed.success ? { status: 200, data: parsed.data } : { status: 502 }; }
      return { status: response.status, error: typeof payload?.error === 'string' ? payload.error : null, reasonCode: typeof payload?.reasonCode === 'string' ? payload.reasonCode : null };
    } catch { return { status: 503 }; }
    finally { clearTimeout(timer); }
  }

  // H3: a Platform code must never silently REPLACE a session that belongs to another account (login CSRF: an attacker with a linked account
  // sends a victim to /sso#code=<attacker's code>). Instead the redemption answers 409 with a short-lived, single-use switch ticket bound to the
  // browser session that is currently signed in; only that session can confirm, and only after the person has been shown who they would become.
  const SWITCH_TTL_MS = 60_000, switchTickets = new Map();
  const hashText = async value => Buffer.from(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))).toString('hex');
  const sessionToken = req => { const match = /(?:^|;\s*)gymsid=([^;]+)/.exec(String(req.headers.cookie || '')); return match ? match[1] : null; };
  const sweepTickets = () => { const t = now(); for (const [key, ticket] of switchTickets) if (ticket.expiresAt <= t) switchTickets.delete(key); if (switchTickets.size > 500) switchTickets.clear(); };
  const sessionBody = (user, payloadLevel) => ({
    ok: true, capabilityLevel: payloadLevel,
    user: { id: user.id, name: user.name, username: user.username || null, created: user.created || null, avatar: user.avatar || null, admin: false, trainer: false, authLevel: 'sso' },
  });

  const routes = {
    // Browser -> Training. The code arrives in the URL fragment on Training's own page and is posted here once.
    'POST /api/platform/v1/sso/redeem': async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      if (!config.ssoEnabled) return json(res, 423, { error: 'platform_sso_disabled' });
      if (req.headers.origin !== origin) return json(res, 403, { error: 'origin_rejected' });
      const ip = rateLimit.gate(req, res); if (!ip) return;
      const body = redeemRequestSchema.safeParse(await readBody(req));
      if (!body.success) { rateLimit.fail(ip); return json(res, 400, { error: 'invalid_sso_request' }); }
      // The flow must have started in THIS browser (/sso/start). Without its verifier the code is not even sent to Platform, so a code that arrived
      // through a link someone else crafted is neither redeemed nor burned.
      const verifier = bindCookieValue(req);
      const clearBind = `${SSO_BIND_COOKIE}=; Path=${SSO_BIND_PATH}; Max-Age=0; HttpOnly;${secureCookie ? ' Secure;' : ''} SameSite=Lax`;
      const stop = (status, obj) => json(res, status, obj, { 'Set-Cookie': clearBind });
      if (!verifier) { rateLimit.fail(ip); log.warn?.('platform sso redeem refused: no binding cookie (a link opened in a browser that did not start the flow)'); return stop(400, { error: 'sso_binding_missing' }); }
      const result = await redeemWithPlatform(body.data.code, verifier);
      if (result.status === 403 && result.error === 'sso_binding_mismatch') { rateLimit.fail(ip); log.warn?.('platform sso redeem refused: Platform says the verifier does not match the code'); return stop(400, { error: 'sso_binding_mismatch' }); }
      if (result.status === 403) { rateLimit.fail(ip); return stop(403, { error: 'platform_access_blocked', reasonCode: result.reasonCode }); }
      if (result.status !== 200) {
        if ([404, 409, 410].includes(result.status)) { rateLimit.fail(ip); return stop(400, { error: 'sso_code_invalid' }); }
        return json(res, 503, { error: 'platform_unavailable' });   // retryable: the binding cookie stays
      }
      const { personId, trainingUserId, capabilities: payload } = result.data;
      const fail = (status, error) => { rateLimit.fail(ip); return stop(status, { error }); };
      if (payload.personId !== personId || payload.trainingSubject.linkStatus !== 'active' || payload.trainingSubject.trainingUserId !== trainingUserId || payload.capabilityLevel === 'blocked') return fail(403, 'platform_access_blocked');
      const user = db.users.find(candidate => candidate.id === trainingUserId);
      if (!user || user.disabled) return fail(400, 'sso_code_invalid');
      if (isEnvAdmin(user.id)) return fail(403, 'platform_access_blocked');   // administrators from ADMIN_UIDS sign in with their passkey only
      // Bilateral link: Platform says the person owns this Training user; Training must hold its own evidence.
      // Bilateral link: this side must already hold an ACKNOWLEDGED link for exactly this person (it is created only by Platform's activate call, never here).
      const link = user.platformLink;
      if (!link || link.state !== 'active' || link.personId !== personId || user.personId !== personId) return fail(409, 'link_not_confirmed');
      if (db.users.some(candidate => candidate.id !== user.id && ((candidate.platformLink?.state === 'active' || candidate.platformLink?.state === 'pending') && candidate.platformLink.personId === personId))) return fail(409, 'link_conflict');
      if (link.origin === 'proof') {
        let evidence;
        try { evidence = proofStore.linkEvidence({ personId, trainingUserId }); } catch { return stop(503, { error: 'link_store_unavailable' }); }
        if (evidence.status === 'conflict') return fail(409, 'link_conflict');
        if (evidence.status !== 'linked') return fail(409, 'link_not_confirmed');
      }
      // A valid session of ANOTHER account is never replaced silently (H3).
      const current = readSession(req);
      if (current && current.id !== user.id) {
        sweepTickets();
        const token = sessionToken(req);
        if (!token) return fail(409, 'link_not_confirmed');
        const ticket = globalThis.crypto.randomUUID().replaceAll('-', '') + globalThis.crypto.randomUUID().replaceAll('-', '');
        switchTickets.set(await hashText(ticket), { sessionHash: await hashText(token), targetUserId: user.id, personId, capabilityLevel: payload.capabilityLevel, expiresAt: now() + SWITCH_TTL_MS });
        secEvent('platform_sso_switch_requested', { userId: current.id, meta: { target: 'other-account' } });
        saveDb();
        return stop(409, { error: 'session_switch_confirmation_required', ticket, current: { name: current.name }, target: { name: user.name }, expiresInSeconds: SWITCH_TTL_MS / 1000 });
      }
      delete user.platformRestriction;
      capabilities.prime(personId, payload);
      secEvent('platform_sso_login', { userId: user.id, meta: { capabilityLevel: payload.capabilityLevel } });
      saveDb();
      // A valid passkey (or other non-sso) session for the SAME account is stronger than an sso one: keep it rather than replacing the cookie.
      if (current && current.id === user.id && current.authLevel !== 'sso') {
        return stop(200, { ok: true, sessionKept: true, capabilityLevel: payload.capabilityLevel, user: { id: user.id, name: user.name, authLevel: current.authLevel } });
      }
      json(res, 200, sessionBody(user, payload.capabilityLevel), { 'Set-Cookie': [newSsoSession(req, user), clearBind] });
    },

    // Begins the browser-bound flow. A top-level navigation (Home's "Abrir Búnker", or Búnker's own "Sign in with your 2J account"): remember a random
    // verifier in THIS browser, then send it to Home carrying only the challenge. Nothing is stored on the server and nothing here proves who the person is.
    'GET /api/platform/v1/sso/start': async (req, res) => {
      const leave = (location, headers = {}) => { res.writeHead(302, { Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', ...headers }); res.end(); };
      if (!config.ssoEnabled) return leave('/sso#error=disabled');
      if (!rateLimit.gate(req, res)) return;
      if (!config.homeUrl) return leave('/sso#error=unavailable');
      const verifier = globalThis.crypto.getRandomValues(new Uint8Array(32)), text = Buffer.from(verifier).toString('base64url');
      const challenge = await bindingChallengeFor(text);
      leave(`${config.homeUrl}/#sso_challenge=${challenge}`, { 'Set-Cookie': `${SSO_BIND_COOKIE}=${text}; Path=${SSO_BIND_PATH}; Max-Age=${SSO_BIND_MAX_AGE_S}; HttpOnly;${secureCookie ? ' Secure;' : ''} SameSite=Lax` });
    },

    // The person has seen "you are signed in as A; continue as B?" and said yes. Only the browser session that was signed in when the code was
    // redeemed can confirm, once, within a minute. Everything about B is checked again (account enabled, not an environment administrator, link still acknowledged).
    'POST /api/platform/v1/sso/confirm': async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      if (!config.ssoEnabled) return json(res, 423, { error: 'platform_sso_disabled' });
      if (req.headers.origin !== origin) return json(res, 403, { error: 'origin_rejected' });
      const ip = rateLimit.gate(req, res); if (!ip) return;
      const body = z.object({ ticket: z.string().regex(/^[0-9a-f]{64}$/) }).strict().safeParse(await readBody(req));
      if (!body.success) { rateLimit.fail(ip); return json(res, 400, { error: 'invalid_sso_request' }); }
      const current = readSession(req), token = sessionToken(req);
      if (!current || !token) { rateLimit.fail(ip); return json(res, 400, { error: 'sso_code_invalid' }); }
      sweepTickets();
      const key = await hashText(body.data.ticket), ticket = switchTickets.get(key);
      switchTickets.delete(key);                                   // single use, whatever happens next
      if (!ticket || ticket.expiresAt <= now() || ticket.sessionHash !== await hashText(token)) { rateLimit.fail(ip); return json(res, 400, { error: 'sso_code_invalid' }); }
      const user = db.users.find(candidate => candidate.id === ticket.targetUserId);
      const link = user?.platformLink;
      if (!user || user.disabled || isEnvAdmin(user.id) || !link || link.state !== 'active' || link.personId !== ticket.personId || user.personId !== ticket.personId || current.id === user.id) { rateLimit.fail(ip); return json(res, 409, { error: 'link_not_confirmed' }); }
      delete user.platformRestriction;
      secEvent('platform_sso_switch_confirmed', { userId: user.id, meta: { target: 'from-other-account', capabilityLevel: ticket.capabilityLevel } });
      secEvent('platform_sso_login', { userId: user.id, meta: { capabilityLevel: ticket.capabilityLevel } });
      saveDb();
      json(res, 200, sessionBody(user, ticket.capabilityLevel), { 'Set-Cookie': newSsoSession(req, user) });
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
        if (!linkActive(user)) return json(res, 409, { error: 'link_required' });
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

  return { routes, gate, memberGate, authorizeStateWrite, capabilities, revokeSsoSessions, classifyRoute, platformStatus: () => capabilities.status() };
}
