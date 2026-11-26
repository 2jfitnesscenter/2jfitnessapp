import crypto from 'node:crypto';
import { z } from 'zod';
import { HUB_PATHS, HUB_STAFF_STEPUP } from './config.js';
import { CORRELATION } from './redeem-client.js';
import { signHubRequest } from './service-auth.js';

// F9o · Strong STAFF actions confirmed with the 2J Hub (Platform) passkey (2JHub H-106.1, H-128.3; contract §11, ADR 0037).
//
// In parallel to F9d-2 (stepup.js) and WITHOUT widening it: own routes, audience, switch and grants. A linked staff account on a 2J Hub
// session (authLevel 'sso', staffSso) that hits `passkey_required` on an action of the CLOSED list may:
//   1. POST /api/platform/v1/staff-stepup/start {action, body}: Búnker fixes HERE the action, the target and the request fields
//      (`bindingHash`), keeps an intent bound to the exact cookie and registers it with Platform (signed). → {confirmUrl} (2J Hub Admin).
//   2. Admin shows what and on whom, asks for the passkey and auto-submits ONE POST form back (exact Origin of PLATFORM_ADMIN_URL).
//   3. POST /api/platform/v1/staff-stepup/receive: same session, server-to-server redemption, every field compared → ONE grant for THAT
//      session, that action and that exact body; 5 min; memory only (a restart drops it).
//   4. The dispatcher spends the grant when the action is ATTEMPTED with a matching body; a different action, target, requested role or any
//      altered field does not match and does not spend it. Two concurrent requests: the check-and-delete is synchronous, only one passes.
// Never: ADMIN_UIDS, unlinked staff, member sessions, PIN sessions, `recovery-link`, `me/delete` (not in the list).

const ACTIONS = HUB_STAFF_STEPUP.actions;
const ACTION_OF_ROUTE = Object.freeze(Object.fromEntries(Object.entries(ACTIONS).map(([action, def]) => [def.route, action])));
/** Route keys a staff grant can open (closed list). */
export const STAFF_STEPUP_ROUTES = Object.freeze(Object.keys(ACTION_OF_ROUTE));

const FORM = 'application/x-www-form-urlencoded';
const CODE = /^[A-Za-z0-9_-]{43,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
const sha256 = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const cookieKey = req => {
  const raw = String(req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith('gymsid='));
  const value = raw ? raw.slice('gymsid='.length) : '';
  return value ? crypto.createHash('sha256').update(value).digest('base64url') : null;
};

/** The canonical binding of an action to a request body (same function at start and at use). */
export function bindingOf(action, body, user) {
  const def = ACTIONS[action];
  const fields = def.fields(body && typeof body === 'object' ? body : {});
  const target = def.target === 'user' ? fields.id : def.target === 'invite' ? `inv:${sha256(fields.code)}` : def.target === 'self' ? user.id : null;
  return { target, fields, bindingHash: sha256(JSON.stringify({ action, target, fields })) };
}

const redeemResponseSchema = z.object({
  v: z.literal(1), issuer: z.literal(HUB_STAFF_STEPUP.issuer), audience: z.literal(HUB_STAFF_STEPUP.audience),
  contract: z.literal(HUB_STAFF_STEPUP.contract), personId: z.string().regex(UUID), trainingUserId: z.string().min(1).max(200),
  staffRole: z.enum(['admin', 'trainer']), action: z.enum(Object.keys(ACTIONS)), bindingHash: z.string().regex(SHA), intentId: z.string().regex(UUID),
  assurance: z.literal(HUB_STAFF_STEPUP.assurance), verifiedAt: z.string().datetime(), correlationId: CORRELATION,
}).strict();

/** Signed call to Platform. → { status: 'ok', data } | { status: 'rejected' } | { status: 'unavailable' } | { status: 'invalid' } */
export function createStaffStepupClient({ client, fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 5000 }) {
  async function call(target, payload, okStatus) {
    if (!client) return { status: 'unavailable' };
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const timestamp = new Date(now()).toISOString(), requestId = globalThis.crypto.randomUUID();
    const { signature } = signHubRequest({ keyId: client.keyId, secret: client.secret, timestamp, requestId, method: 'POST', target, body });
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(new URL(target, client.baseUrl), {
        method: 'POST', redirect: 'error', signal: controller.signal, body,
        headers: { 'content-type': 'application/json', accept: 'application/json', 'x-2j-key-id': client.keyId, 'x-2j-timestamp': timestamp, 'x-2j-request-id': requestId, 'x-2j-signature': signature },
      });
      if (response.status >= 500 || response.status === 408 || response.status === 429) return { status: 'unavailable' };
      if (response.status !== okStatus) return { status: 'rejected', httpStatus: response.status };
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > 16 * 1024) return { status: 'invalid' };
      try { return { status: 'ok', data: JSON.parse(text) }; } catch { return { status: 'invalid' }; }
    } catch { return { status: 'unavailable' }; }
    finally { clearTimeout(timer); }
  }
  return {
    registerIntent: payload => call(HUB_PATHS.staffStepupIntent, payload, 201),
    async redeem({ code, correlationId, intentId }) {
      if (!CODE.test(code || '') || !CORRELATION.safeParse(correlationId).success || !UUID.test(intentId || '')) return { status: 'rejected' };
      const r = await call(HUB_PATHS.staffStepupRedeem, { v: 1, code, audience: HUB_STAFF_STEPUP.audience, destination: HUB_STAFF_STEPUP.destination, correlationId, intentId }, 200);
      if (r.status !== 'ok') return r;
      const parsed = redeemResponseSchema.safeParse(r.data);
      return parsed.success ? { status: 'ok', data: parsed.data } : { status: 'invalid' };
    },
  };
}

function readForm(req, maxBytes = 2048) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function createHubStaffStepup({ hub, client, db, saveDb, secEvent, json, readBody, readSession, isEnvAdmin, rateLimit, fetchImpl = globalThis.fetch, now = Date.now }) {
  const on = hub.staffStepupEnabled === true;
  const platform = createStaffStepupClient({ client, fetchImpl, now });
  /** intentId → { cookieKey, userId, action, bindingHash, expiresAt } */
  const intents = new Map();
  /** session key (hash of its exact cookie) → { userId, action, bindingHash, expiresAt } */
  const grants = new Map();
  const sweep = () => {
    const at = now();
    for (const [key, value] of intents) if (value.expiresAt <= at) intents.delete(key);
    for (const [key, value] of grants) if (value.expiresAt <= at) grants.delete(key);
  };

  /** A linked staff account on a 2J Hub staff session, never ADMIN_UIDS. */
  function eligible(req) {
    let user = null;
    try { user = readSession(req); } catch { return null; }
    if (!user || user.disabled || user.authLevel !== 'sso' || user.staffSso !== true) return null;
    if (user.platformStaffLink?.state !== 'active' || !user.platformStaffLink.personId || isEnvAdmin(user.id)) return null;
    return user;
  }

  const stepUp = {
    /** Should the `passkey_required` answer offer «Confirmar con tu passkey de 2J Hub»? */
    offered(req, routeKey) {
      return on && Boolean(ACTION_OF_ROUTE[routeKey]) && Boolean(eligible(req));
    },
    /**
     * Does THIS request carry a live grant for its action and exact body? Spent on the attempt (true once), never on a mismatch.
     * The body is read before the synchronous check-and-delete, so two concurrent requests cannot both pass.
     */
    async admits(req, routeKey) {
      const action = ACTION_OF_ROUTE[routeKey];
      if (!on || !action) return false;
      const user = eligible(req), key = cookieKey(req);
      if (!user || !key || !grants.has(key)) return false;
      let body;
      try { body = action === 'logout_all' ? {} : await readBody(req); } catch { return false; }
      const grant = grants.get(key);
      if (!grant || grant.userId !== user.id || grant.action !== action || grant.expiresAt <= now()) return false;
      if (bindingOf(action, body, user).bindingHash !== grant.bindingHash) {
        secEvent('platform_staff_stepup_refused', { userId: user.id, meta: { reason: 'body_mismatch', action } });
        saveDb();
        return false;
      }
      grants.delete(key);
      secEvent('platform_staff_stepup_used', { userId: user.id, meta: { action } });
      saveDb();
      return true;
    },
  };

  async function start(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    const user = eligible(req), key = cookieKey(req);
    if (!user || !key) return json(res, 403, { error: 'esta acción solo se confirma desde una sesión del personal de 2J Hub', code: 'staff_stepup_denied' });
    if (!hub.adminUrl) return json(res, 503, { error: 'no se puede confirmar ahora: falta la dirección de 2J Hub', code: 'platform_unavailable' });
    let input;
    try { input = await readBody(req); } catch { return json(res, 400, { error: 'petición inválida' }); }
    const action = typeof input?.action === 'string' && Object.hasOwn(ACTIONS, input.action) ? input.action : null;
    if (!action || Object.keys(input).some(k => k !== 'action' && k !== 'body')) return json(res, 400, { error: 'acción no permitida', code: 'staff_stepup_action' });
    const def = ACTIONS[action];
    const binding = bindingOf(action, input.body, user);
    const target = { kind: def.target };
    const requested = {};
    if (def.target === 'user') {
      const other = db.users.find(candidate => candidate.id === binding.fields.id);
      if (!other) return json(res, 404, { error: 'ese usuario no existe' });
      Object.assign(target, { trainingUserId: other.id, displayName: String(other.name || other.username || other.id).slice(0, 80) });
    } else if (def.target === 'invite') {
      const invite = (db.invites || []).find(item => item.code === binding.fields.code);
      if (!invite) return json(res, 404, { error: 'esa invitación no existe' });
      target.inviteHint = binding.fields.code.slice(-4).toUpperCase().replace(/[^A-Z0-9]/g, '0').padStart(4, '0');
    } else if (def.target === 'self') target.trainingUserId = user.id;
    if (action === 'user_role') requested.role = binding.fields.role.slice(0, 20);
    if (action === 'user_trainer') requested.trainer = binding.fields.trainer;
    if (action === 'user_disable') requested.disabled = binding.fields.disabled;
    sweep();
    const intentId = crypto.randomUUID(), expiresAt = now() + HUB_STAFF_STEPUP.intentMs;
    const registered = await platform.registerIntent({
      v: 1, contract: HUB_STAFF_STEPUP.contract, intentId, trainingUserId: user.id, action, bindingHash: binding.bindingHash, target,
      ...(Object.keys(requested).length ? { requested } : {}), expiresAt: new Date(expiresAt).toISOString(),
    });
    if (registered.status === 'unavailable') {
      secEvent('platform_staff_stepup_refused', { userId: user.id, meta: { reason: 'platform_unavailable', action } }); saveDb();
      return json(res, 503, { error: 'no se puede confirmar ahora: 2J Hub no responde. Inténtalo en unos minutos.', code: 'platform_unavailable' });
    }
    if (registered.status !== 'ok') {
      secEvent('platform_staff_stepup_refused', { userId: user.id, meta: { reason: 'intent_rejected', action } }); saveDb();
      return json(res, 403, { error: '2J Hub no permite confirmar esta acción con tu cuenta', code: 'staff_stepup_denied' });
    }
    intents.set(intentId, { cookieKey: key, userId: user.id, action, bindingHash: binding.bindingHash, expiresAt });
    secEvent('platform_staff_stepup_started', { userId: user.id, meta: { action, target: def.target === 'user' ? target.trainingUserId : def.target } });
    saveDb();
    return json(res, 200, { confirmUrl: `${hub.adminUrl}/#/bunker-confirmar/${intentId}`, expiresAt: new Date(expiresAt).toISOString() });
  }

  const go = (res, location) => {
    res.writeHead(303, { Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    res.end();
  };
  const refuse = (res, reason, kind = 'denied', userId = null) => {
    secEvent('platform_staff_stepup_refused', { userId, meta: { reason } });
    saveDb();
    return go(res, `/sso#error=${kind}`);
  };

  async function receive(req, res) {
    if (!hub.adminUrl) return refuse(res, 'admin_not_configured', 'unavailable');
    const origin = req.headers.origin;
    if (typeof origin !== 'string' || origin === 'null' || origin !== hub.adminUrl) return refuse(res, 'origin_rejected');
    const ip = rateLimit.gate(req, res); if (!ip) return;
    if (String(req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase() !== FORM) { rateLimit.fail(ip); return refuse(res, 'bad_content_type'); }
    let fields;
    try { fields = new URLSearchParams(await readForm(req)); } catch { rateLimit.fail(ip); return refuse(res, 'bad_body'); }
    const names = [...fields.keys()].sort().join(',');
    const stepupCode = fields.get('stepupCode'), correlationId = fields.get('stepupCorrelationId'), intentId = fields.get('intentId');
    if (names !== 'intentId,stepupCode,stepupCorrelationId' || !CODE.test(stepupCode || '') || !CORRELATION.safeParse(correlationId).success || !UUID.test(intentId || '')) {
      rateLimit.fail(ip); return refuse(res, 'bad_form');
    }
    sweep();
    const intent = intents.get(intentId);
    const user = eligible(req), key = cookieKey(req);
    if (!intent) { rateLimit.fail(ip); return refuse(res, 'intent_unknown', 'denied', user?.id ?? null); }
    if (!user || !key) return refuse(res, 'no_session', 'denied');
    if (key !== intent.cookieKey || user.id !== intent.userId) { rateLimit.fail(ip); return refuse(res, 'other_session', 'denied', user.id); }

    const result = await platform.redeem({ code: stepupCode, correlationId, intentId });
    if (result.status === 'unavailable') return refuse(res, 'platform_unavailable', 'unavailable', user.id);
    if (result.status !== 'ok') { rateLimit.fail(ip); return refuse(res, result.status === 'invalid' ? 'redeem_invalid_answer' : 'redeem_rejected', 'denied', user.id); }
    const answer = result.data;
    const roleOk = answer.staffRole === 'admin' || (answer.staffRole === 'trainer' && answer.action === 'logout_all');
    if (answer.correlationId !== correlationId || answer.intentId !== intentId || answer.action !== intent.action || answer.bindingHash !== intent.bindingHash
      || answer.trainingUserId !== user.id || answer.personId !== user.platformStaffLink.personId || !roleOk) {
      rateLimit.fail(ip); return refuse(res, 'redeem_mismatch', 'denied', user.id);
    }
    // Still the same linked staff session (the link could have ended while the person was in Admin).
    if (!eligible(req)) return refuse(res, 'link_inactive', 'denied', user.id);
    intents.delete(intentId);
    grants.set(key, { userId: user.id, action: intent.action, bindingHash: intent.bindingHash, expiresAt: now() + HUB_STAFF_STEPUP.grantMs });
    secEvent('platform_staff_stepup_granted', { userId: user.id, meta: { action: intent.action } });
    saveDb();
    return go(res, ACTIONS[intent.action].landing);
  }

  return {
    on,
    stepUp,
    routes: on ? { [`POST ${HUB_PATHS.staffStepupStart}`]: start, [`POST ${HUB_PATHS.staffStepupReceiver}`]: receive } : {},
    grantsForTests: grants,
    intentsForTests: intents,
  };
}
