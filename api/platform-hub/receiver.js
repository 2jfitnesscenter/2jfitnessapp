import { HUB_SSO, HUB_SSO_NEXT } from './config.js';
import { CORRELATION } from './redeem-client.js';
import { linkState } from './links.js';

// F9b · Receiver of Home's auto-submitted form (2JHub contract §4): POST application/x-www-form-urlencoded with `code` and `correlationId`.
// Redeems the code server-to-server, checks identity and link, asks Platform for verified capabilities and ONLY THEN creates a normal Training
// session (newSsoSession: its own cookie, record, rotation and revocation). Every answer is a 303 redirect: nothing about the person travels back
// in a body, nothing is logged from the body, and any failure leaves no session and no data change (except an audit event).

const CODE = /^[A-Za-z0-9_-]{43,128}$/;
const MAX_BODY = 2048;
const FORM = 'application/x-www-form-urlencoded';
/** Neutral name a provisioned profile is born with; replaced by Platform's display name at the first sign-in. */
export const PROVISIONED_PLACEHOLDER_NAME = 'Socio 2J';

function readForm(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0, tooLarge = false;
    req.on('data', chunk => { if (tooLarge) return; size += chunk.length; if (size > MAX_BODY) { tooLarge = true; chunks.length = 0; return; } chunks.push(chunk); });
    req.on('end', () => (tooLarge ? reject(new Error('too_large')) : resolve(Buffer.concat(chunks).toString('utf8'))));
    req.on('error', reject);
  });
}

export function createReceiver({ hub, homeUrl, db, saveDb, secEvent, readSession, newSsoSession, capabilities, isEnvAdmin, rateLimit, redeem, now = Date.now }) {
  const homeOrigin = homeUrl ? new URL(homeUrl).origin : null;

  /** F9c punto 0 (H-80): Home sends the form with referrerpolicy="origin", so the browser always sends its exact Origin. Only that exact origin is
   *  accepted; `Origin: null` or a missing Origin is refused (no Fetch Metadata fallback: it cannot tell Home from another site → login CSRF). */
  function provenanceOk(headers) {
    const origin = headers.origin;
    return typeof origin === 'string' && origin !== 'null' && origin === homeOrigin;
  }

  const go = (res, location, extra = {}) => {
    res.writeHead(303, { Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', ...extra });
    res.end();
  };
  const refuse = (res, reason, kind = 'denied', userId = null) => {
    secEvent('platform_hub_sso_refused', { userId, meta: { reason } });
    saveDb();
    return go(res, `/sso#error=${kind}`);
  };

  async function receive(req, res) {
    if (!hub.receiverEnabled) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'no encontrado' })); }
    if (!homeOrigin) return refuse(res, 'home_not_configured', 'unavailable');
    if (!provenanceOk(req.headers)) return refuse(res, 'origin_rejected');
    const ip = rateLimit.gate(req, res); if (!ip) return;
    if (String(req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase() !== FORM) { rateLimit.fail(ip); return refuse(res, 'bad_content_type'); }
    let fields;
    try { fields = new URLSearchParams(await readForm(req)); } catch { rateLimit.fail(ip); return refuse(res, 'bad_body'); }
    const names = [...fields.keys()];
    const code = fields.get('code'), correlationId = fields.get('correlationId');
    // F9c: an optional third field `next` from a CLOSED list (only with the settings switch on); anything else is the F9b form, unchanged.
    const withNext = hub.settingsEnabled === true && names.length === 3 && names.includes('next');
    const next = withNext ? fields.get('next') : null;
    if (names.length !== (withNext ? 3 : 2) || !names.includes('code') || !names.includes('correlationId') || !CODE.test(code || '') || !CORRELATION.safeParse(correlationId).success
      || (withNext && !Object.hasOwn(HUB_SSO_NEXT, next))) {
      rateLimit.fail(ip); return refuse(res, 'bad_form');
    }
    const landing = withNext ? HUB_SSO_NEXT[next] : '/';

    const outcome = await admit(req, { code, correlationId });
    if (!outcome.ok) { if (outcome.countFail) rateLimit.fail(ip); return refuse(res, outcome.reason, outcome.kind, outcome.userId); }
    const { cookie } = commit(req, outcome);
    return cookie ? go(res, landing, { 'Set-Cookie': cookie }) : go(res, landing);
  }

  const no = (reason, kind = 'denied', userId = null, countFail = false) => ({ ok: false, reason, kind, userId, countFail });

  /**
   * Redeems a Home SSO code and runs EVERY F9b check (identity, link, verified capabilities, other-account session) WITHOUT writing anything.
   * F9d-2 reuses it for the step-up form, which carries an SSO code too. `countFail` = the failure counts against the IP limiter.
   */
  async function admit(req, { code, correlationId }) {
    const result = await redeem({ code, correlationId });
    if (result.status === 'unavailable') return no('platform_unavailable', 'unavailable');
    if (result.status !== 'ok') return no(result.status === 'invalid' ? 'redeem_invalid_answer' : 'redeem_rejected', 'denied', null, true);
    const answer = result.data;
    if (answer.correlationId !== correlationId || answer.issuer !== HUB_SSO.issuer || answer.audience !== HUB_SSO.audience || answer.linkStatus !== 'active' || answer.assurance !== HUB_SSO.assurance) {
      return no('redeem_mismatch', 'denied', null, true);
    }

    const user = db.users.find(candidate => candidate.id === answer.trainingUserId);
    if (!user || user.disabled) return no('training_user_unknown', 'denied', null, true);
    if (isEnvAdmin(user.id)) return no('env_admin', 'denied', user.id);   // ADMIN_UIDS sign in with their passkey only
    const link = linkState(db, user, answer.personId);
    if (link.status === 'conflict') return no(`link_${link.reason}`, 'denied', user.id);

    // Capabilities are asked for the (person, Training user) pair Platform named; only a VERIFIED answer opens a session (never a degraded one).
    const subject = { id: user.id, personId: answer.personId, platformRestriction: user.platformRestriction };
    let view;
    capabilities.forget(answer.personId);          // a sign-in always asks Platform for the CURRENT answer, never an earlier cached one
    try { view = await capabilities.evaluate(subject, { mode: 'enforced' }); } catch { view = null; }
    if (!view || !view.verified) return no(view?.source === 'rejected' ? 'capabilities_rejected' : 'capabilities_unavailable', view?.source === 'rejected' ? 'denied' : 'unavailable', user.id);
    if (view.level === 'blocked') return no(`blocked_${view.reasonCode}`, 'denied', user.id);

    // Never replace a session of ANOTHER account silently (login CSRF); a passkey session of the same account is stronger and is kept.
    const current = readSession(req);
    if (current && current.id !== user.id) return no('other_session', 'switch', current.id);
    // Re-check after the awaits: two redemptions racing for the same person must not both adopt.
    const again = linkState(db, user, answer.personId);
    if (again.status === 'conflict') return no(`link_${again.reason}`, 'denied', user.id);
    return { ok: true, user, answer, view, current, adopt: again.status === 'adopt', correlationId };
  }

  /** Writes what an admitted sign-in changes and returns the new cookie (null = the same-account passkey session is kept). */
  function commit(req, { user, answer, view, current, adopt, correlationId }) {
    if (adopt) {
      user.personId = answer.personId;
      user.platformLink = { personId: answer.personId, state: 'active', origin: 'platform_admin', adoptedAt: new Date(now()).toISOString(), correlationId };
      secEvent('platform_link_adopted', { userId: user.id, meta: { origin: 'platform_admin' } });
    }
    if (user.platformLink?.origin === 'hub_provisioned' && user.name === PROVISIONED_PLACEHOLDER_NAME) user.name = answer.displayName.slice(0, 60);
    delete user.platformRestriction;
    secEvent('platform_sso_login', { userId: user.id, meta: { via: 'hub', capabilityLevel: view.level } });
    saveDb();
    if (current && current.id === user.id && current.authLevel !== 'sso') return { cookie: null };
    const cookie = newSsoSession(req, user);
    const record = db.deviceSessions.findLast?.(item => item.userId === user.id && item.via === 'sso' && !item.revokedAt);
    if (record) { record.assurance = HUB_SSO.assurance; saveDb(); }
    return { cookie };
  }

  return Object.assign(receive, { admit, commit, provenanceOk, readForm: req => readForm(req) });
}
