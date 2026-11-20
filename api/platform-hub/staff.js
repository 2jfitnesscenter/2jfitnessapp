import { z } from 'zod';
import { HUB_PATHS, HUB_STAFF, HUB_STAFF_NEXT, staffDeeplinkLocation } from './config.js';
import { CORRELATION } from './redeem-client.js';
import { signHubRequest, verifyHubRequest } from './service-auth.js';

// F9e · Staff (trainers and administration) in Búnker with the identity and the ROLE decided by Platform (2JHub H-02, H-82, H-104, H-105;
// 2JHub contract §10, `training-staff-v1`). Everything here only exists with PLATFORM_HUB_STAFF_ROLES_ENABLED (and the bridge + SSO); off, the
// routes are absent (router 404), there is no timer and Búnker's admin panel changes roles exactly as today.
//
//   - Link: Platform's admin links ONE person of the 2J team to ONE staff account of Búnker (by hand; Búnker has no emails). Búnker learns it
//     from Platform's signed state / events or at that person's first entry, and keeps it on the account (`platformStaffLink`). One person,
//     one account, both ways; never an ADMIN_UIDS account (H-105.3: those keep their Búnker passkey as the emergency key).
//   - Role: `admin` / `trainer` / paused (null) comes from Platform. Paused = staff powers off while the flags and assignments stay. It is written with the SAME function the admin panel uses (changeRole), so the
//     last-admin and ADMIN_UIDS protections apply unchanged: an order that would leave Búnker without an administrator is KEPT (not applied)
//     and audited. While a link is active the admin panel cannot change that account's role (`role_from_platform`).
//   - Delay: every change is pushed by Platform (persistent queue) and Búnker re-reads the whole staff state every 60 s, so a role change or a
//     departure is effective within about a minute, and at the latest at the next entry (the entry always carries the current role).
//   - Entry: Admin's auto-submitted form → exact Origin of PLATFORM_ADMIN_URL → server-to-server redemption → a normal SSO session record with
//     `staff: true`. It is `platform_sso`: it NEVER satisfies a passkey check (the passkey-only staff operations stay as they are).
//   - History is untouched: same account id, so routines, programs, follow-ups, comments and authorship stay where they were.

export const PLATFORM_ACTOR = Object.freeze({ id: 'platform:2jhub' });
const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const ISO = z.string().datetime({ offset: false });
const TRAINING_USER = z.string().min(1).max(200);
const ROLE = z.enum(HUB_STAFF.roles);
export const staffItemSchema = z.discriminatedUnion('linkStatus', [
  z.object({ personId: UUID, trainingUserId: TRAINING_USER, linkStatus: z.literal('active'), staffRole: ROLE.nullable(), changedAt: ISO }).strict(),
  z.object({ personId: UUID, trainingUserId: TRAINING_USER, linkStatus: z.literal('ended'), staffRole: z.null(), reason: z.enum(['revoked', 'staff_departed']), changedAt: ISO }).strict(),
]);
export const staffEventSchema = z.object({ v: z.literal(1), contract: z.literal(HUB_STAFF.contract), eventId: UUID, item: staffItemSchema }).strict();
export const staffStateSchema = z.object({ v: z.literal(1), contract: z.literal(HUB_STAFF.contract), generatedAt: ISO, items: z.array(staffItemSchema).max(500) }).strict();
export const staffRedeemResponseSchema = z.object({
  v: z.literal(1), contract: z.literal(HUB_STAFF.contract), issuer: z.literal(HUB_STAFF.issuer), audience: z.literal(HUB_STAFF.audience), personId: UUID,
  trainingUserId: TRAINING_USER, linkStatus: z.literal('active'), staffRole: ROLE, displayName: z.string().min(1).max(200),
  assurance: z.literal(HUB_STAFF.assurance), correlationId: CORRELATION,
  // F9m (optional, backwards compatible both ways): where Admin asked to land. `member` needs the member's id and nothing else may carry it.
  next: z.enum(HUB_STAFF_NEXT).optional(), memberTrainingUserId: TRAINING_USER.optional(),
}).strict().refine(answer => (answer.next === 'member') === (answer.memberTrainingUserId !== undefined), { message: 'memberTrainingUserId only with next=member' });

const CODE = /^[A-Za-z0-9_-]{43,128}$/;
const FORM = 'application/x-www-form-urlencoded';
const MAX_BYTES = 64 * 1024;
const APPLIED_KEEP = 1000;
const STAFF_ALLOWLIST = Object.freeze([{ method: 'GET', path: HUB_PATHS.staffDirectory }, { method: 'POST', path: HUB_PATHS.staffEvents }]);

function readRaw(req, max = 16 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0, tooLarge = false;
    req.on('data', chunk => { if (tooLarge) return; size += chunk.length; if (size > max) { tooLarge = true; chunks.length = 0; return; } chunks.push(chunk); });
    req.on('end', () => (tooLarge ? reject(new Error('too_large')) : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

export function createHubStaff({
  hub, client, db, saveDb, secEvent, json, readSession, newSsoSession, isEnvAdmin, isAdmin, isTrainer, changeRole, revokeSsoStaffSessions,
  envAdminIds = [], store, rateLimit, fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 5000,
}) {
  const on = hub.staffRolesEnabled === true;
  db.platformStaffEvents = Array.isArray(db.platformStaffEvents) ? db.platformStaffEvents : [];
  const adminOrigin = hub.adminUrl || null;
  const iso = () => new Date(now()).toISOString();
  const roleOf = user => (isAdmin(user) ? 'admin' : isTrainer(user) ? 'trainer' : 'member');
  const linkOf = user => (user?.platformStaffLink?.state === 'active' ? user.platformStaffLink : null);

  /** While on, Platform decides the role of a linked staff account: the admin panel must not change it. */
  const governs = user => on && Boolean(linkOf(user));

  /** Is there an ADMIN_UIDS account able to sign in with its Búnker passkey? (Then an admin can be sent to 2J Hub.) */
  const configAdminAvailable = () => envAdminIds.some(id => db.users.some(u => u.id === id && !u.disabled));

  /**
   * Applies ONE state item (from the entry, a pushed event or the 60-second refresh). Idempotent; never older than what is stored.
   * @returns 'applied' | 'kept' (refused and audited: unknown account, ADMIN_UIDS, link conflict, last admin) | 'stale'
   */
  function apply(item, via) {
    const user = db.users.find(candidate => candidate.id === item.trainingUserId);
    const keep = reason => { secEvent('platform_staff_kept', { userId: user?.id ?? null, meta: { reason, via } }); return 'kept'; };
    if (!user) return keep('unknown_user');
    if (isEnvAdmin(user.id)) return keep('env_admin');
    const current = user.platformStaffLink || null;
    if (current && Date.parse(current.changedAt || 0) > Date.parse(item.changedAt)) return 'stale';

    const otherAdmin = () => db.users.some(other => other.id !== user.id && !other.disabled && isAdmin(other));

    if (item.linkStatus === 'ended') {
      if (!linkOf(user) || current.personId !== item.personId) return 'stale';   // nothing of THIS link here (already ended or another person)
      const ended = { ...current, state: 'ended', role: null, changedAt: item.changedAt, endedAt: iso(), reason: item.reason };
      user.platformStaffLink = ended;   // first: a paused account shows its real flags again
      // A departure (archived in Platform) drops the staff role, like Búnker's own panel. A hand revocation (e.g. to fix a wrong link) only
      // gives the account back to Búnker's panel with the role it has: nothing of its assignments is lost.
      if (item.reason === 'staff_departed' && roleOf(user) !== 'member') {
        const result = changeRole(PLATFORM_ACTOR, user, 'member');
        if (result.status !== 200) { user.platformStaffLink = current; return keep(result.body?.code || 'role_refused'); }
      }
      revokeSsoStaffSessions(user.id);
      secEvent('platform_staff_link_ended', { userId: user.id, actorId: PLATFORM_ACTOR.id, meta: { reason: item.reason, via } });
      return 'applied';
    }

    // Active. One person ↔ one account, both ways, and coherent with the MEMBER link of that account.
    if (linkOf(user) && current.personId !== item.personId) return keep('link_conflict');
    if (db.users.some(other => other.id !== user.id && linkOf(other)?.personId === item.personId)) return keep('link_conflict');
    if (user.platformLink?.state === 'active' && user.personId && user.personId !== item.personId) return keep('member_link_conflict');
    const adopted = !linkOf(user);
    const next = { personId: item.personId, state: 'active', role: item.staffRole, changedAt: item.changedAt, linkedAt: adopted ? iso() : current.linkedAt };
    if (item.staffRole === null) {
      // No staff role in Platform right now (account suspended, or a role with no Búnker equivalent): the staff powers are PAUSED (isAdmin /
      // isTrainer answer false while `role` is null), the flags and the members' assignments are kept, so lifting it restores everything.
      if (linkOf(user)?.role !== null && isAdmin(user) && !otherAdmin()) return keep('last_admin');
      user.platformStaffLink = next;
      revokeSsoStaffSessions(user.id);
    } else {
      user.platformStaffLink = next;   // un-pause first, so changeRole sees the real current role
      if (roleOf(user) !== item.staffRole) {
        const result = changeRole(PLATFORM_ACTOR, user, item.staffRole);
        if (result.status !== 200) { user.platformStaffLink = current; return keep(result.body?.code || 'role_refused'); }
      }
    }
    if (adopted) secEvent('platform_staff_link_adopted', { userId: user.id, actorId: PLATFORM_ACTOR.id, meta: { via } });
    secEvent('platform_staff_role', { userId: user.id, actorId: PLATFORM_ACTOR.id, meta: { role: item.staffRole ?? 'paused', via } });
    return 'applied';
  }

  /* -------------------------------------------------------------- Búnker → Platform (signed) */
  async function call(method, target, body) {
    if (!client) return { status: 'unavailable' };
    const bytes = Buffer.from(body === undefined ? '' : JSON.stringify(body), 'utf8');
    const timestamp = new Date(now()).toISOString(), requestId = globalThis.crypto.randomUUID();
    const { signature } = signHubRequest({ keyId: client.keyId, secret: client.secret, timestamp, requestId, method, target, body: bytes });
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(new URL(target, client.baseUrl), {
        method, redirect: 'error', signal: controller.signal, ...(body === undefined ? {} : { body: bytes }),
        headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }), 'x-2j-key-id': client.keyId, 'x-2j-timestamp': timestamp, 'x-2j-request-id': requestId, 'x-2j-signature': signature },
      });
      if (response.status >= 500 || response.status === 408 || response.status === 429) return { status: 'unavailable' };
      if (response.status !== 200) return { status: 'rejected', httpStatus: response.status };
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) return { status: 'invalid' };
      try { return { status: 'ok', data: JSON.parse(text) }; } catch { return { status: 'invalid' }; }
    } catch { return { status: 'unavailable' }; }
    finally { clearTimeout(timer); }
  }

  async function redeem(code, correlationId) {
    const result = await call('POST', HUB_PATHS.staffRedeem, { v: 1, code, audience: HUB_STAFF.audience, destination: HUB_STAFF.destination, correlationId });
    if (result.status !== 'ok') return result;
    const parsed = staffRedeemResponseSchema.safeParse(result.data);
    return parsed.success ? { status: 'ok', data: parsed.data } : { status: 'invalid' };
  }

  /** Re-reads the whole staff state from Platform and applies it (ends first, then active links). Never removes a role by absence. */
  let refreshing = null;
  async function refresh() {
    if (!on) return { status: 'off' };
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const result = await call('GET', HUB_PATHS.staffState);
      if (result.status !== 'ok') return { status: result.status };
      const parsed = staffStateSchema.safeParse(result.data);
      if (!parsed.success) { secEvent('platform_staff_state_invalid', {}); saveDb(); return { status: 'invalid' }; }
      const counts = { applied: 0, kept: 0, stale: 0 };
      const ordered = [...parsed.data.items].sort((a, b) => (a.linkStatus === b.linkStatus ? 0 : a.linkStatus === 'ended' ? -1 : 1));
      for (const item of ordered) {
        // An unchanged item is not re-audited every minute.
        const user = db.users.find(candidate => candidate.id === item.trainingUserId);
        const same = user?.platformStaffLink && user.platformStaffLink.changedAt === item.changedAt
          && (item.linkStatus === 'active' ? user.platformStaffLink.state === 'active' : user.platformStaffLink.state === 'ended');
        if (same) { counts.stale++; continue; }
        counts[apply(item, 'refresh')]++;
      }
      if (counts.applied || counts.kept) saveDb();
      return { status: 'ok', ...counts };
    })().finally(() => { refreshing = null; });
    return refreshing;
  }

  /* -------------------------------------------------------------- Platform → Búnker (signed) */
  async function authenticated(req, res, kind) {
    res.setHeader?.('Cache-Control', 'no-store');
    let raw;
    try { raw = await readRaw(req); } catch { json(res, 413, { error: 'invalid_request' }); return null; }
    const verdict = verifyHubRequest({ method: req.method, requestTarget: req.url, headers: req.headers, body: raw, keys: hub.inboundKeys, allow: STAFF_ALLOWLIST, now: now() });
    const refuse = reason => { secEvent('platform_hub_service_refused', { meta: { kind, reason, keyId: req.headers['x-2j-key-id'] || null } }); saveDb(); json(res, 401, { error: 'SERVICE_AUTH_INVALID' }); return null; };
    if (!verdict.ok) return refuse(verdict.reason);
    try {
      if (store.acceptServiceRequest(verdict.requestId, 'platform_hub').status !== 'accepted') return refuse('replay');
    } catch { json(res, 503, { error: 'unavailable' }); return null; }
    return raw;
  }

  /** The staff accounts of Búnker (read-only, for Platform's dry-run report and linking). With the DIRECTORY switch, like the member one. */
  async function directory(req, res) {
    if (!hub.directoryEnabled) return json(res, 404, { error: 'no encontrado' });
    if (!(await authenticated(req, res, 'staff_directory'))) return;
    if (new URL(req.url, 'http://x').search) return json(res, 400, { error: 'invalid_request' });
    const items = db.users.filter(user => isTrainer(user) || isEnvAdmin(user.id)).slice(0, 500).map(user => ({
      trainingUserId: user.id,
      displayName: String(user.name || user.username || user.id).slice(0, 200),
      ...(user.username ? { username: String(user.username).slice(0, 100) } : {}),
      role: isAdmin(user) ? 'admin' : 'trainer',
      adminByConfig: isEnvAdmin(user.id),
      disabled: !!user.disabled,
      staffPersonId: linkOf(user)?.personId ?? null,
    }));
    return json(res, 200, { v: 1, items });
  }

  async function events(req, res) {
    const raw = await authenticated(req, res, 'staff_events'); if (!raw) return;
    if (String(req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase() !== 'application/json') return json(res, 400, { error: 'invalid_request' });
    let event;
    try { event = staffEventSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw))); } catch { return json(res, 400, { error: 'invalid_request' }); }
    if (db.platformStaffEvents.includes(event.eventId)) return json(res, 200, { v: 1, eventId: event.eventId, result: 'duplicate' });
    const outcome = apply(event.item, 'event');
    db.platformStaffEvents.push(event.eventId);
    if (db.platformStaffEvents.length > APPLIED_KEEP) db.platformStaffEvents.splice(0, db.platformStaffEvents.length - APPLIED_KEEP);
    saveDb();
    // 'stale' = already superseded by a newer state: nothing to do, which for Platform is the same as applied.
    return json(res, 200, { v: 1, eventId: event.eventId, result: outcome === 'kept' ? 'kept' : 'applied' });
  }

  /* -------------------------------------------------------------- the form from 2J Hub Admin */
  const go = (res, location, extra = {}) => {
    res.writeHead(303, { Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', ...extra });
    res.end();
  };
  const refuse = (res, reason, kind = 'denied', userId = null) => {
    secEvent('platform_staff_sso_refused', { userId, meta: { reason } });
    saveDb();
    return go(res, `/sso#error=${kind}`);
  };

  async function receive(req, res) {
    if (!adminOrigin) return refuse(res, 'admin_not_configured', 'unavailable');
    const origin = req.headers.origin;
    if (typeof origin !== 'string' || origin === 'null' || origin !== adminOrigin) return refuse(res, 'origin_rejected');
    const ip = rateLimit.gate(req, res); if (!ip) return;
    if (String(req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase() !== FORM) { rateLimit.fail(ip); return refuse(res, 'bad_content_type'); }
    let fields;
    try { fields = new URLSearchParams((await readRaw(req, 2048)).toString('utf8')); } catch { rateLimit.fail(ip); return refuse(res, 'bad_body'); }
    const names = [...fields.keys()];
    const code = fields.get('code'), correlationId = fields.get('correlationId');
    if (names.length !== 2 || !names.includes('code') || !names.includes('correlationId') || !CODE.test(code || '') || !CORRELATION.safeParse(correlationId).success) {
      rateLimit.fail(ip); return refuse(res, 'bad_form');
    }
    const result = await redeem(code, correlationId);
    if (result.status === 'unavailable') return refuse(res, 'platform_unavailable', 'unavailable');
    if (result.status !== 'ok') { rateLimit.fail(ip); return refuse(res, result.status === 'invalid' ? 'redeem_invalid_answer' : 'redeem_rejected'); }
    const answer = result.data;
    if (answer.correlationId !== correlationId) { rateLimit.fail(ip); return refuse(res, 'redeem_mismatch'); }
    const user = db.users.find(candidate => candidate.id === answer.trainingUserId);
    if (!user || user.disabled) { rateLimit.fail(ip); return refuse(res, 'training_user_unknown'); }
    if (isEnvAdmin(user.id)) return refuse(res, 'env_admin', 'denied', user.id);   // ADMIN_UIDS keep their Búnker passkey only (H-105.3)
    // Never replace a session of ANOTHER account silently (login CSRF).
    const current = readSession(req);
    if (current && current.id !== user.id) return refuse(res, 'other_session', 'switch', current.id);
    // The entry always carries the CURRENT role: apply it before anything (same rules as the queue).
    // `changedAt` of the entry = the stored one (or the epoch): Platform's clock orders changes, Búnker's never hides a later one.
    const since = user.platformStaffLink?.changedAt || new Date(0).toISOString();
    const outcome = apply({ personId: answer.personId, trainingUserId: user.id, linkStatus: 'active', staffRole: answer.staffRole, changedAt: since }, 'entry');
    if (outcome === 'kept') { saveDb(); return refuse(res, 'staff_kept', 'denied', user.id); }
    if (!isTrainer(user)) { saveDb(); return refuse(res, 'not_staff', 'denied', user.id); }
    secEvent('platform_staff_sso_login', { userId: user.id, meta: { role: roleOf(user) } });
    saveDb();
    const cookie = newSsoSession(req, user);
    const record = db.deviceSessions.findLast?.(item => item.userId === user.id && item.via === 'sso' && !item.revokedAt);
    if (record) { record.assurance = HUB_STAFF.assurance; record.staff = true; saveDb(); }
    return go(res, landing(user, answer), { 'Set-Cookie': cookie });
  }

  /** F9m · Deep link: only with its own switch, only to an existing, enabled member, and the route is built HERE from the id (never taken from Platform). */
  function landing(staffUser, answer) {
    if (!hub.staffDeeplinkEnabled || answer.next !== 'member') return '/';
    const member = db.users.find(candidate => candidate.id === answer.memberTrainingUserId);
    const target = member && !member.disabled && member.id !== staffUser.id ? staffDeeplinkLocation('member', member.id) : '/';
    secEvent('platform_staff_sso_deeplink', { userId: staffUser.id, meta: { next: 'member', memberId: member?.id ?? null, landed: target !== '/' } });
    saveDb();
    return target;
  }

  let timer = null;
  function start() {
    if (!on || !client || timer) return;
    timer = setInterval(() => { refresh().catch(() => {}); }, HUB_STAFF.refreshMs);
    timer.unref?.();
    setTimeout(() => { refresh().catch(() => {}); }, 2000).unref?.();
  }
  const stop = () => { if (timer) clearInterval(timer); timer = null; };

  return {
    on,
    governs,
    configAdminAvailable,
    linkOf,
    apply,
    refresh,
    start,
    stop,
    routes: on ? {
      [`POST ${HUB_PATHS.staffReceiver}`]: receive,
      [`POST ${HUB_PATHS.staffEvents}`]: events,
    } : {},
    /** The read-only staff directory lives under the DIRECTORY switch (Platform's dry-run must work before the roles switch is on). */
    directoryRoutes: hub.directoryEnabled ? { [`GET ${HUB_PATHS.staffDirectory}`]: directory } : {},
  };
}
