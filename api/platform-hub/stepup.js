import crypto from 'node:crypto';
import { HUB_STEPUP } from './config.js';
import { CORRELATION } from './redeem-client.js';

// F9d-2 · A passkey re-authentication done IN PLATFORM, trusted by Training for the member's OWN export / erasure only (2JHub H-83, contract §9).
//
// Home sends ONE auto-submitted form (POST, body, exact Origin) to POST /api/platform/v1/stepup/receive with an SSO code (F9b, so the browser
// has a session of that very account) and a step-up code. Both are redeemed server to server; the step-up answer must name the SAME person
// and Training user as the session. Only then THAT session (its exact cookie) is marked with a one-use grant for that purpose, valid 5 min.
// Without SSO fields the browser must already hold a session of the same account; no session or another account's → refused.
//
// What it never does: `platform_sso` still satisfies no re-authentication; `platform_passkey` is valid ONLY for GET /api/me/export and
// POST /api/me/delete of the account itself (closed list) — never for passkeys, device links, sessions, webhooks, staff or anything else.
// Staff accounts and ADMIN_UIDS never get a grant (their move is F9e). Grants live in memory only: a restart drops them (fail closed).

const CODE = /^[A-Za-z0-9_-]{43,128}$/;
const FORM = 'application/x-www-form-urlencoded';
/** Route key → purpose. The ONLY two operations a grant can open. */
export const STEPUP_ROUTES = Object.freeze({ 'GET /api/me/export': 'export', 'POST /api/me/delete': 'delete' });
const LANDING = '/settings#data';

const cookieKey = req => {
  const raw = String(req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith('gymsid='));
  const value = raw ? raw.slice('gymsid='.length) : '';
  return value ? crypto.createHash('sha256').update(value).digest('base64url') : null;
};
const cookieKeyOfSetCookie = setCookie => {
  const value = /^gymsid=([^;]+)/.exec(String(setCookie || ''))?.[1];
  return value ? crypto.createHash('sha256').update(value).digest('base64url') : null;
};

export function createStepup({ hub, db, saveDb, secEvent, readSession, receiver, redeemStepup, rateLimit, isStaff, isEnvAdmin, now = Date.now }) {
  /** session key (hash of its exact cookie) → { userId, purpose, expiresAt } */
  const grants = new Map();
  const sweep = () => { const at = now(); for (const [key, grant] of grants) if (grant.expiresAt <= at) grants.delete(key); };

  /** Is there a live grant for THIS request's session, this account and this purpose? Does not consume it. */
  function peek(req, user, purpose) {
    if (!hub.stepupEnabled || !user || !HUB_STEPUP.purposes.includes(purpose)) return null;
    const key = cookieKey(req);
    const grant = key ? grants.get(key) : null;
    if (!grant || grant.userId !== user.id || grant.purpose !== purpose || grant.expiresAt <= now()) return null;
    return { key, grant };
  }

  const stepUp = {
    /** For the dispatcher: does this request's route + session carry a live grant? (export / delete only) */
    admits(req, routeKey) {
      const purpose = STEPUP_ROUTES[routeKey];
      if (!purpose) return false;
      try { return Boolean(peek(req, readSession(req), purpose)); } catch { return false; }
    },
    /** One use: true and the grant is gone, or false. */
    consume(req, user, purpose) {
      const found = peek(req, user, purpose);
      if (!found) return false;
      grants.delete(found.key);
      secEvent('platform_hub_stepup_used', { userId: user.id, meta: { purpose } });
      saveDb();
      return true;
    },
    /** What the member's screen may know: the purpose and until when (never the grant itself). */
    view(req, user) {
      if (!hub.stepupEnabled || !user) return null;
      const key = cookieKey(req);
      const grant = key ? grants.get(key) : null;
      if (!grant || grant.userId !== user.id || grant.expiresAt <= now()) return null;
      return { purpose: grant.purpose, expiresAt: new Date(grant.expiresAt).toISOString() };
    },
  };

  const go = (res, location, extra = {}) => {
    res.writeHead(303, { Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', ...extra });
    res.end();
  };
  const refuse = (res, reason, kind = 'denied', userId = null) => {
    secEvent('platform_hub_stepup_refused', { userId, meta: { reason } });
    saveDb();
    return go(res, `/sso#error=${kind}`);
  };
  const isMember = user => !isStaff(user) && !isEnvAdmin(user.id);
  const linkedTo = (user, personId) => user.personId === personId && user.platformLink?.state === 'active' && user.platformLink.personId === personId;

  async function receive(req, res) {
    if (!hub.stepupEnabled) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'no encontrado' })); }
    if (!receiver.provenanceOk(req.headers)) return refuse(res, 'origin_rejected');
    const ip = rateLimit.gate(req, res); if (!ip) return;
    if (String(req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase() !== FORM) { rateLimit.fail(ip); return refuse(res, 'bad_content_type'); }
    let fields;
    try { fields = new URLSearchParams(await receiver.readForm(req)); } catch { rateLimit.fail(ip); return refuse(res, 'bad_body'); }
    // Closed form, two shapes: step-up only (needs a session already), or step-up + SSO code (F9b sign-in of the same account).
    const names = [...fields.keys()].sort().join(',');
    const withSso = names === 'code,correlationId,stepupCode,stepupCorrelationId';
    const stepupCode = fields.get('stepupCode'), stepupCorrelationId = fields.get('stepupCorrelationId');
    const code = fields.get('code'), correlationId = fields.get('correlationId');
    if ((!withSso && names !== 'stepupCode,stepupCorrelationId') || !CODE.test(stepupCode || '') || !CORRELATION.safeParse(stepupCorrelationId).success
      || (withSso && (!CODE.test(code || '') || !CORRELATION.safeParse(correlationId).success))) {
      rateLimit.fail(ip); return refuse(res, 'bad_form');
    }

    // 1. The session this grant will belong to: admitted through the F9b checks (nothing written yet) or the one the browser holds.
    let admitted = null, session = null;
    if (withSso) {
      admitted = await receiver.admit(req, { code, correlationId });
      if (!admitted.ok) { if (admitted.countFail) rateLimit.fail(ip); return refuse(res, admitted.reason, admitted.kind, admitted.userId); }
    } else {
      session = readSession(req);
      if (!session || !cookieKey(req)) { rateLimit.fail(ip); return refuse(res, 'no_session'); }
    }
    const user = admitted ? admitted.user : db.users.find(candidate => candidate.id === session.id);
    if (!user || user.disabled) return refuse(res, 'training_user_unknown');
    if (!isMember(user)) return refuse(res, 'staff', 'denied', user.id);

    // 2. The step-up itself, redeemed with Platform: same person, same Training user, closed purpose, platform_passkey.
    const result = await redeemStepup({ code: stepupCode, correlationId: stepupCorrelationId });
    if (result.status === 'unavailable') return refuse(res, 'platform_unavailable', 'unavailable', user.id);
    if (result.status !== 'ok') { rateLimit.fail(ip); return refuse(res, result.status === 'invalid' ? 'redeem_invalid_answer' : 'redeem_rejected', 'denied', user.id); }
    const answer = result.data;
    if (answer.correlationId !== stepupCorrelationId || answer.issuer !== HUB_STEPUP.issuer || answer.audience !== HUB_STEPUP.audience
      || answer.assurance !== HUB_STEPUP.assurance || !HUB_STEPUP.purposes.includes(answer.purpose)) {
      rateLimit.fail(ip); return refuse(res, 'redeem_mismatch', 'denied', user.id);
    }
    if (answer.trainingUserId !== user.id) { rateLimit.fail(ip); return refuse(res, 'other_account', 'denied', user.id); }
    if (admitted ? answer.personId !== admitted.answer.personId : !linkedTo(user, answer.personId)) {
      rateLimit.fail(ip); return refuse(res, 'other_person', 'denied', user.id);
    }

    // 3. Only now: the sign-in is written (if any) and THAT session gets its one-use grant.
    let setCookie = null, key = null;
    if (admitted) {
      ({ cookie: setCookie } = receiver.commit(req, admitted));
      key = setCookie ? cookieKeyOfSetCookie(setCookie) : cookieKey(req);
    } else key = cookieKey(req);
    if (!key || !linkedTo(user, answer.personId)) return refuse(res, 'link_inactive', 'denied', user.id);
    sweep();
    grants.set(key, { userId: user.id, purpose: answer.purpose, expiresAt: now() + HUB_STEPUP.grantMs });
    secEvent('platform_hub_stepup_granted', { userId: user.id, meta: { purpose: answer.purpose } });
    saveDb();
    return setCookie ? go(res, LANDING, { 'Set-Cookie': setCookie }) : go(res, LANDING);
  }

  return { stepUp, receive, grantsForTests: grants };
}
