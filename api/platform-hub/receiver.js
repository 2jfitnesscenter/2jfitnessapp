import { HUB_SSO } from './config.js';
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

/** Registrable-domain approximation for same-site checks (last two labels; loopback hosts compare as-is). */
const siteOf = host => { const parts = String(host).split('.'); return /^\d+$/.test(parts.at(-1)) || parts.length < 2 ? host : parts.slice(-2).join('.'); };

function readForm(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0, tooLarge = false;
    req.on('data', chunk => { if (tooLarge) return; size += chunk.length; if (size > MAX_BODY) { tooLarge = true; chunks.length = 0; return; } chunks.push(chunk); });
    req.on('end', () => (tooLarge ? reject(new Error('too_large')) : resolve(Buffer.concat(chunks).toString('utf8'))));
    req.on('error', reject);
  });
}

export function createReceiver({ hub, homeUrl, trainingOrigin, db, saveDb, secEvent, readSession, newSsoSession, capabilities, isEnvAdmin, rateLimit, redeem, now = Date.now }) {
  const homeOrigin = homeUrl ? new URL(homeUrl).origin : null;
  const crossSiteHome = homeOrigin ? siteOf(new URL(homeOrigin).hostname) !== siteOf(new URL(trainingOrigin).hostname) : false;

  /** Where the request comes from. Origin is exact when the browser sends one; `null` (referrerpolicy=no-referrer) falls back to Fetch Metadata. */
  function provenanceOk(headers) {
    const origin = headers.origin;
    if (typeof origin === 'string' && origin !== 'null') return origin === homeOrigin;
    const site = headers['sec-fetch-site'], mode = headers['sec-fetch-mode'], dest = headers['sec-fetch-dest'];
    if (site !== undefined && !(['same-origin', 'same-site'].includes(site) || (crossSiteHome && site === 'cross-site'))) return false;
    if (mode !== undefined && mode !== 'navigate') return false;
    if (dest !== undefined && dest !== 'document') return false;
    return true;
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

  return async function receive(req, res) {
    if (!hub.receiverEnabled) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'no encontrado' })); }
    if (!homeOrigin) return refuse(res, 'home_not_configured', 'unavailable');
    if (!provenanceOk(req.headers)) return refuse(res, 'origin_rejected');
    const ip = rateLimit.gate(req, res); if (!ip) return;
    if (String(req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase() !== FORM) { rateLimit.fail(ip); return refuse(res, 'bad_content_type'); }
    let fields;
    try { fields = new URLSearchParams(await readForm(req)); } catch { rateLimit.fail(ip); return refuse(res, 'bad_body'); }
    const names = [...fields.keys()];
    const code = fields.get('code'), correlationId = fields.get('correlationId');
    if (names.length !== 2 || !names.includes('code') || !names.includes('correlationId') || !CODE.test(code || '') || !CORRELATION.safeParse(correlationId).success) {
      rateLimit.fail(ip); return refuse(res, 'bad_form');
    }

    const result = await redeem({ code, correlationId });
    if (result.status === 'unavailable') return refuse(res, 'platform_unavailable', 'unavailable');
    if (result.status !== 'ok') { rateLimit.fail(ip); return refuse(res, result.status === 'invalid' ? 'redeem_invalid_answer' : 'redeem_rejected'); }
    const answer = result.data;
    if (answer.correlationId !== correlationId || answer.issuer !== HUB_SSO.issuer || answer.audience !== HUB_SSO.audience || answer.linkStatus !== 'active' || answer.assurance !== HUB_SSO.assurance) {
      rateLimit.fail(ip); return refuse(res, 'redeem_mismatch');
    }

    const user = db.users.find(candidate => candidate.id === answer.trainingUserId);
    if (!user || user.disabled) { rateLimit.fail(ip); return refuse(res, 'training_user_unknown'); }
    if (isEnvAdmin(user.id)) return refuse(res, 'env_admin', 'denied', user.id);   // ADMIN_UIDS sign in with their passkey only
    const link = linkState(db, user, answer.personId);
    if (link.status === 'conflict') return refuse(res, `link_${link.reason}`, 'denied', user.id);

    // Capabilities are asked for the (person, Training user) pair Platform named; only a VERIFIED answer opens a session (never a degraded one).
    const subject = { id: user.id, personId: answer.personId, platformRestriction: user.platformRestriction };
    let view;
    capabilities.forget(answer.personId);          // a sign-in always asks Platform for the CURRENT answer, never an earlier cached one
    try { view = await capabilities.evaluate(subject, { mode: 'enforced' }); } catch { view = null; }
    if (!view || !view.verified) return refuse(res, view?.source === 'rejected' ? 'capabilities_rejected' : 'capabilities_unavailable', view?.source === 'rejected' ? 'denied' : 'unavailable', user.id);
    if (view.level === 'blocked') return refuse(res, `blocked_${view.reasonCode}`, 'denied', user.id);

    // Never replace a session of ANOTHER account silently (login CSRF); a passkey session of the same account is stronger and is kept.
    const current = readSession(req);
    if (current && current.id !== user.id) return refuse(res, 'other_session', 'switch', current.id);
    // Re-check after the awaits: two redemptions racing for the same person must not both adopt.
    const again = linkState(db, user, answer.personId);
    if (again.status === 'conflict') return refuse(res, `link_${again.reason}`, 'denied', user.id);
    if (again.status === 'adopt') {
      user.personId = answer.personId;
      user.platformLink = { personId: answer.personId, state: 'active', origin: 'platform_admin', adoptedAt: new Date(now()).toISOString(), correlationId };
      secEvent('platform_link_adopted', { userId: user.id, meta: { origin: 'platform_admin' } });
    }
    if (user.platformLink?.origin === 'hub_provisioned' && user.name === PROVISIONED_PLACEHOLDER_NAME) user.name = answer.displayName.slice(0, 60);
    delete user.platformRestriction;
    secEvent('platform_sso_login', { userId: user.id, meta: { via: 'hub', capabilityLevel: view.level } });
    saveDb();
    if (current && current.id === user.id && current.authLevel !== 'sso') return go(res, '/');
    const cookie = newSsoSession(req, user);
    const record = db.deviceSessions.findLast?.(item => item.userId === user.id && item.via === 'sso' && !item.revokedAt);
    if (record) { record.assurance = HUB_SSO.assurance; saveDb(); }
    return go(res, '/', { 'Set-Cookie': cookie });
  };
}
