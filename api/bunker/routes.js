/* HTTP surface for the Bunker (gym-floor kiosk). Same factory-of-closures shape as
 * friends/routes.js — server.js's own helpers are passed in rather than imported, so this
 * module never needs to know about `db` or the session secret directly.
 *
 * Three trust levels meet here, and keeping them straight is the entire point of this file:
 *  - a normal signed-in session (readSession/cookie) — a member's own phone, e.g. reading/
 *    resetting their own check-in PIN, or a trainer/admin managing the room from their phone.
 *  - a bunker token (Authorization: Bearer, minted by /checkin) — the shared kiosk screen,
 *    scoped to exactly one checked-in member and nothing else: it can read that member's
 *    today's plan and recent results, write their in-progress workout, and finish it. It
 *    cannot touch measurements, settings, social, chat, or any other member's data — there is
 *    no generic "read/write this account's whole state" route reachable with it.
 *  - an admin-kiosk token (Authorization: Bearer, minted by /admin-checkin from a trainer's own
 *    FIXED code entered on the shared screen itself) — read the room's live sessions and close
 *    one, nothing else.
 */
import * as store from './store.js';
import { createHash } from 'node:crypto';
import { readState, writeState } from '../lib/state-store.js';
import { bestWeightFor, is1RMRecord } from './finish-helpers.js';
import { bunkerClientIp, bunkerLimiters } from './rate-limit.js';

const PIN_TOKEN_TTL = 4 * 3600000;      // a training session comfortably fits in 4 hours
const ADMIN_TOKEN_TTL = 30 * 60000;     // the kiosk's own admin overlay re-locks after 30 min

export function bunkerRoutes({ json, readBody, readSession, sign, verifySig, users, isTrainer, todayPrs = () => [], rateLimiters = bunkerLimiters() }) {
  const credentialKey = (kind, value) => createHash('sha256').update(kind + ':' + String(value)).digest('hex');
  const limitAttempt = (kind, ip, value) => {
    const ipLimiter = rateLimiters[kind];
    const credentialLimiter = rateLimiters[kind + 'Credential'];
    const secretKey = credentialKey(kind, value);
    const checks = [ipLimiter?.check(ip), credentialLimiter?.check(secretKey)].filter(Boolean);
    const blocked = checks.find(x => !x.allowed);
    return {
      allowed: !blocked,
      retryAfter: blocked ? Math.max(...checks.filter(x => !x.allowed).map(x => x.retryAfter || 1)) : null,
      fail() { ipLimiter?.fail(ip); credentialLimiter?.fail(secretKey); },
      success() { ipLimiter?.success(ip); credentialLimiter?.success(secretKey); },
    };
  };
  const bearer = req => {
    const h = req.headers.authorization || '';
    return h.startsWith('Bearer ') ? h.slice(7) : '';
  };
  // v1.3.1 (A3 fix) — a cryptographically valid token alone used to be enough for the rest of
  // this token's 4h/30min TTL, even if the account it names got disabled (or, for the admin
  // token, demoted from trainer) the very next second. Both readers now revalidate the account
  // on every single use, not just at checkin/admin-checkin — a disabled/demoted account loses
  // Bunker access immediately, the same way it already loses everywhere else in the app
  // (server.js's own `if (user.disabled) return null;`), instead of keeping whatever token it
  // grabbed until that token expires on its own. This only ever narrows who a token still
  // authenticates as — it never changes which uid a token names, so the per-device credential
  // map (frontend/src/lib/bunker-credentials.js) and its A/B isolation are untouched.
  const readBunkerToken = req => {
    const payload = verifySig(bearer(req));
    if (!payload) return null;
    const [kind, uid, exp] = payload.split(':');
    if (kind !== 'bunker' || Date.now() > Number(exp)) return null;
    const user = users().find(u => u.id === uid);
    if (!user || user.disabled) return null;
    return uid;
  };
  const readAdminToken = req => {
    const payload = verifySig(bearer(req));
    if (!payload) return null;
    const [kind, uid, exp] = payload.split(':');
    if (kind !== 'bunker-admin' || Date.now() > Number(exp)) return null;
    const user = users().find(u => u.id === uid);
    if (!user || user.disabled || !isTrainer(user)) return null;
    return uid;
  };
  // The two ways to reach the admin endpoints: the trainer's own phone (normal cookie), or the
  // kiosk's admin overlay (its own short-lived token, from the trainer's fixed code).
  const guardAdmin = req => {
    const cookieUser = readSession(req);
    if (cookieUser && isTrainer(cookieUser)) return cookieUser.id;
    const kioskUid = readAdminToken(req);
    if (kioskUid) return kioskUid;
    return null;
  };
  const publicName = uid => (users().find(u => u.id === uid) || {}).name || 'Socio';
  const activeRevision = S => S._sync?.activeRevision || 0;
  const replaceActive = (S, active) => {
    if (!S._sync) Object.defineProperty(S, '_sync', { value: { activeRevision: 0, receipts: {}, tombstones: { workouts: [], routines: [], programs: [] }, revision: 0, generation: 0, enabled: false }, writable: true, configurable: true });
    S.active = active;
    S._sync.activeRevision = activeRevision(S) + 1;
  };
  const checkActiveRevision = (res, S, body) => {
    if ((!body.operationId || body.expectedActiveRevision === undefined) && S._sync?.enabled) {
      json(res, 409, { error: 'actualiza la aplicación para continuar', code: 'SYNC_UPGRADE_REQUIRED', active: S.active || null, activeRevision: activeRevision(S) });
      return false;
    }
    if (body.expectedActiveRevision === undefined) return true;
    if (body.expectedActiveRevision !== activeRevision(S)) {
      json(res, 409, {
        error: body.expectedActiveRevision === undefined ? 'actualiza la aplicación para continuar' : 'la sesión cambió en otro dispositivo',
        code: body.expectedActiveRevision === undefined ? 'SYNC_UPGRADE_REQUIRED' : 'ACTIVE_CONFLICT',
        active: S.active || null,
        activeRevision: activeRevision(S),
      });
      return false;
    }
    return true;
  };
  const activeReceipt = (res, S, body, kind) => {
    if (!body.operationId) return null;
    const key = `bunker:${kind}:${body.operationId}`;
    const digest = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const receipt = S._sync.receipts[key];
    if (receipt) {
      if (receipt.digest !== digest) {
        json(res, 409, { error: 'operación reutilizada', code: 'OPERATION_REUSED' });
        return { handled: true };
      }
      json(res, 200, receipt.result);
      return { handled: true };
    }
    return { handled: false, key, digest };
  };
  const saveActive = (uid, S, receipt, result) => {
    if (receipt?.key) S._sync.receipts[receipt.key] = { digest: receipt.digest, result };
    writeState(uid, S);
  };
  // Shared by the member's own GET /session and the admin "assist/adjust" panel — same narrow
  // slice of their real state either way, just reached through a different trust level.
  const sessionPayload = uid => {
    const S = readState(uid) || {};
    return {
      name: publicName(uid),
      unit: S.unit || 'kg',
      week: S.week || {},
      // dayPlan/programs/activeProgramId are what lib/history.js's effectiveRoutine actually
      // reads to resolve "today's routine" — a flat `week` alone is only half the picture for
      // anyone whose schedule is driven by a multi-day program, or who has a one-off override
      // for today. Sending all three is what lets the kiosk use that exact same resolver
      // instead of a second, poorer one that only ever checked `week`.
      dayPlan: S.dayPlan || {},
      programs: S.programs || [],
      activeProgramId: S.activeProgramId || null,
      routines: S.routines || [],
      customEx: S.customEx || [],
      exWeights: S.exWeights || {},
      // A deliberate 1RM test (Actions → Start a test session) — read by the 'pct1rm'
      // progression policy (lib/progression.js's bestTestedOneRM). Without it, an exercise
      // using that policy would look on the kiosk like it had never been tested, even when it
      // has been on the member's own phone.
      tests: S.tests || [],
      // The two toggles buildSets() itself reads (Settings → Training) — omitting them would
      // silently ignore a member's own choice to hide "last time" ghosts or warmup ramp-up sets
      // the moment they train from the kiosk instead of their phone.
      showPreviousResults: S.showPreviousResults !== false,
      warmupEnabled: S.warmupEnabled !== false,
      effort: S.effort ?? (S.showRir ? 'rir' : 'none'),
      recentWorkouts: (S.workouts || []).slice(-40),
      active: S.active || null,
      activeRevision: activeRevision(S),
      // RP Volume Zones — off unless this member turned it on themselves (Settings), matching
      // the exact fields lib/rp-volume.js's landmarksFor/weeklyGroupVolume read elsewhere.
      enableRpVolumeZones: !!S.enableRpVolumeZones,
      trainingLevel: S.trainingLevel || 'intermediate',
      rpVolumeOverrides: S.rpVolumeOverrides || {},
      countSecondaryMuscles: S.countSecondaryMuscles !== false,
      secondaryMuscleFactor: S.secondaryMuscleFactor ?? 0.5,
    };
  };

  return {
    /* ---------- a member's own PIN (their phone, normal session) ---------- */
    'GET /api/bunker/pin': async (req, res) => {
      const me = readSession(req);
      if (!me) return json(res, 401, { error: 'no has iniciado sesión' });
      json(res, 200, { pin: store.pinFor(me.id) });
    },
    'POST /api/bunker/pin/reset': async (req, res) => {
      const me = readSession(req);
      if (!me) return json(res, 401, { error: 'no has iniciado sesión' });
      json(res, 200, { pin: store.resetPin(me.id) });
    },

    // body: { active, force? } — explicit, one-shot handoff of the phone's OWN in-progress
    // session onto the server, so the member can pick it up at the kiosk. Deliberately NOT part
    // of PUT /api/data's continuous sync (which still strips `active` exactly as before) — this
    // fires once, on a deliberate tap, same trust level as the rest of this section (the
    // member's own cookie session, never a bunker token: at the moment of asking for this, they
    // are still on their phone, not at the kiosk yet).
    //
    // Idempotent by active.id: re-sending the same session (a retry, a double tap) just
    // overwrites with the latest copy — safe, since S.active is a single field, never an array
    // nothing here ever appends to. A genuinely DIFFERENT session already on the server (e.g.
    // one already started at the kiosk, or a previous handoff never finished) is never silently
    // replaced — the caller gets a 409 with that existing session, and must retry with
    // `force: true` once the member has actually chosen to discard it.
    'POST /api/bunker/handoff': async (req, res) => {
      const me = readSession(req);
      if (!me) return json(res, 401, { error: 'no has iniciado sesión' });
      const body = await readBody(req);
      const active = body.active;
      if (!active || typeof active !== 'object' || !active.id || !active.d || !Array.isArray(active.entries)) {
        return json(res, 400, { error: 'sesión activa no válida' });
      }
      const S = readState(me.id) || {};
      const existing = S.active;
      if (existing && existing.id !== active.id && !body.force) {
        return json(res, 409, { error: `Ya tienes otra sesión en curso en el Bunker: "${existing.name || 'Entreno'}"`, existing });
      }
      replaceActive(S, active);
      writeState(me.id, S);
      json(res, 200, { ok: true, activeRevision: activeRevision(S) });
    },

    // The one authorized way for the phone/web app to actually END its own S.active — a normal
    // Discard or a normal Finish (frontend/src/views/Workout.jsx, sheets.jsx's doFinishWorkout)
    // call this right after their own local `s.active = null`, instead of trusting PUT
    // /api/data's generic sync to carry that null through: that PUT unconditionally re-injects
    // whatever `active` the server already has (server.js's own comment there explains why —
    // it's what protects a Bunker/handoff session from an unrelated phone sync), so it can never
    // be how a client legitimately ends one. This is that missing "an operation authorized to do
    // it" — same direct writeState() a finish/handoff already uses, just for the opposite intent
    // and reachable from a normal cookie session rather than a bunker token.
    //
    // body: { id? } — only clears if it still matches S.active.id, so a stale call (the phone
    // finishing/discarding a session that has since been replaced — handed off, or a kiosk
    // started a new one) can never silently wipe whatever is there now; same idempotent-by-id
    // guard the handoff endpoint above already uses, just in the other direction. Also refuses
    // outright while the Bunker's own live board shows this member actually checked in right
    // now (store.getSession) — a handoff alone doesn't change `active.id`, so the id check on
    // its own can't tell "still only on my phone" from "now running at the kiosk"; this is the
    // second, independent check that does. A member training normally (never touched the
    // Bunker) always has no live kiosk session, so this never affects the common case.
    'POST /api/active/clear': async (req, res) => {
      const me = readSession(req);
      if (!me) return json(res, 401, { error: 'no has iniciado sesión' });
      const body = await readBody(req);
      const id = body.id ? String(body.id) : null;
      if (store.getSession(me.id)) {
        return json(res, 409, { error: 'esta sesión se está ejecutando en el Bunker ahora mismo' });
      }
      const S = readState(me.id);
      if (S && S.active && (!id || S.active.id === id)) {
        replaceActive(S, null);
        writeState(me.id, S);
      }
      json(res, 200, { ok: true });
    },

    // A trainer/admin's own fixed kiosk-unlock code — generated once, never reset (see
    // store.js's own comment on why).
    'GET /api/bunker/admin-code': async (req, res) => {
      const me = readSession(req);
      if (!me || !isTrainer(me)) return json(res, 401, { error: 'no autorizado' });
      json(res, 200, { code: store.adminCodeFor(me.id) });
    },
    // The /bunker/launch?token=... pairing link — same fixed-code idea as admin-code above, but
    // its own value (see store.js) since a launch link is meant to be shared to a TV/tablet's
    // own browser, a much lower-stakes place for a secret to live than a phone.
    'GET /api/bunker/launch-link': async (req, res) => {
      const me = readSession(req);
      if (!me || !isTrainer(me)) return json(res, 401, { error: 'no autorizado' });
      json(res, 200, { key: store.getRoomKey() });
    },

    /* ---------- the shared kiosk screen — no session of its own ---------- */
    'GET /api/bunker/board': async (req, res) => {
      json(res, 200, { sessions: store.listSessions().map(s => ({
        uid: s.uid, name: s.name, checkinAt: s.checkinAt, exName: s.exName, setIdx: s.setIdx,
        setsTotal: s.setsTotal, restEndsAt: s.restEndsAt, paused: s.paused,
      })), todayPrs: todayPrs() });
    },
    'GET /api/bunker/settings': async (req, res) => json(res, 200, store.getSettings()),
    // body: { token } — verifies a /bunker/launch link before the kiosk pairs itself (see
    // views/BunkerLaunch.jsx). No session of any kind; a wrong/missing token just fails.
    'POST /api/bunker/verify-launch': async (req, res) => {
      const body = await readBody(req);
      json(res, 200, { ok: store.verifyRoomKey(String(body.token || '')) });
    },

    // body: { pin }. Failed guesses are limited by the real public client IP. PIN and admin
    // code have separate buckets, and a valid entry clears its bucket so ordinary rapid member
    // changes on the shared gym kiosk remain smooth. No PIN/code is retained by the limiter.
    'POST /api/bunker/checkin': async (req, res) => {
      const rateKey = bunkerClientIp(req);
      const body = await readBody(req);
      const pin = String(body.pin || '').trim();
      const attempt = limitAttempt('pin', rateKey, pin);
      if (!attempt.allowed) return json(res, 429, { error: 'demasiados intentos; espera un momento' }, { 'Retry-After': String(attempt.retryAfter) });
      const uid = store.userIdForPin(pin);
      if (!uid) { attempt.fail(); return json(res, 400, { error: 'PIN incorrecto' }); }
      // v1.3.1 (A3 fix) — same "PIN incorrecto" either way: a disabled account's PIN must not
      // even mint a token in the first place (readBunkerToken would refuse it on the very next
      // use anyway, see this file's own comment there), and the error stays generic on purpose
      // so it never confirms to whoever is standing at the kiosk that this PIN belongs to a
      // real, disabled account rather than no account at all.
      const account = users().find(u => u.id === uid);
      if (!account || account.disabled) { attempt.fail(); return json(res, 400, { error: 'PIN incorrecto' }); }
      attempt.success();
      const name = publicName(uid);
      store.startSession(uid, name);
      const exp = Date.now() + PIN_TOKEN_TTL;
      json(res, 200, { token: sign('bunker:' + uid + ':' + exp), exp, uid, name });
    },

    // Today's plan + recent results — deliberately narrow (see the module doc comment above):
    // the routine for today, a trimmed slice of recent finished workouts (for "last time"
    // reference), any in-progress S.active (resuming after a minimize), and the handful of
    // other fields the logger UI itself needs (exWeights, customEx, unit). Never the whole S.
    // Also hands back this member's OWN RP Volume Zones preferences (off by default) — the
    // kiosk hydrates its logger per athlete from these, same as the phone app does, and never
    // lets one athlete's settings leak into the next person who checks in (see views/Bunker.jsx).
    'GET /api/bunker/session': async (req, res) => {
      const uid = readBunkerToken(req);
      if (!uid) return json(res, 401, { error: 'sesión de bunker no válida' });
      json(res, 200, sessionPayload(uid));
    },

    // body: { active, exName, setIdx, setsTotal } — the in-progress workout (same shape the
    // phone logger already builds) plus what the room dashboard's card should show right now.
    // Written to S.active only — see the module doc comment on why nothing else is reachable.
    'POST /api/bunker/active': async (req, res) => {
      const uid = readBunkerToken(req);
      if (!uid) return json(res, 401, { error: 'sesión de bunker no válida' });
      const body = await readBody(req);
      const S = readState(uid) || {};
      const receipt = activeReceipt(res, S, body, 'member');
      if (receipt?.handled) return;
      if (!checkActiveRevision(res, S, body)) return;
      // v1.3.1 (A4 fix) — a write that arrives late (a slow mobile-network POST queued right
      // before Finish, landing just after it) must never resurrect a session that has already
      // been saved. Scoped narrowly to "this exact id already finished," never to "is the
      // ephemeral board session still live" — an idle-purged-but-still-open panel (nobody
      // polled the board in 15+ min, see store.js's IDLE_TTL) must keep working normally; this
      // only refuses the one specific case where the workout it's trying to write is already
      // sitting in S.workouts.
      const incomingId = body.active && body.active.id;
      if (incomingId && ((S.workouts || []).some(w => w.id === incomingId) || S._sync?.tombstones.workouts.includes(incomingId))) {
        return json(res, 409, { error: 'esta sesión ya se finalizó' });
      }
      replaceActive(S, body.active || null);
      const result = { ok: true, activeRevision: activeRevision(S) };
      saveActive(uid, S, receipt, result);
      store.touchSession(uid, { exId: body.exId || null, exName: body.exName || null, setIdx: body.setIdx || 0, setsTotal: body.setsTotal || 0 });
      json(res, 200, result);
    },

    // body: { sec } — starts (or extends) the room dashboard's own rest countdown for this
    // member's card; the kiosk ticks it down locally from restEndsAt, same as the phone
    // logger's own rest timer does, so this is just telling every OTHER screen what to show.
    'POST /api/bunker/rest': async (req, res) => {
      const uid = readBunkerToken(req);
      if (!uid) return json(res, 401, { error: 'sesión de bunker no válida' });
      const body = await readBody(req);
      const sec = Math.max(0, Math.min(1800, Number(body.sec) || 0));
      store.touchSession(uid, { restEndsAt: sec ? Date.now() + sec * 1000 : null });
      json(res, 200, { ok: true });
    },

    // body: { workout } — a fully-formed finished-workout object (the kiosk builds it with the
    // exact same lib/history.js helpers the phone logger uses to finish one; this endpoint just
    // appends it where the server trusts the token's own uid to put it, not wherever the
    // request claims). Clears S.active and the room-dashboard card in the same call.
    //
    // PRs and exWeights are computed/updated here, never trusting whatever the client sent for
    // them (same "server re-derives it" principle as the wall-post anti-spoofing check above) —
    // ported 1:1 from doFinishWorkout (frontend/src/sheets.jsx) via ./finish-helpers.js, using
    // the FULL S.workouts this endpoint already has, not the 40-workout window the kiosk's own
    // GET /session hands the client.
    //
    // e1prs (1RM records) is computed and returned in the response for parity-checking, but
    // deliberately never attached to `w` before it's saved: doFinishWorkout itself never
    // persists e1prs on a saved workout either (it only ever reaches the finish-summary sheet in
    // that same React render) — persisting it here would be new, Bunker-only behaviour, not a
    // match for what the normal flow actually keeps.
    'POST /api/bunker/finish': async (req, res) => {
      const uid = readBunkerToken(req);
      if (!uid) return json(res, 401, { error: 'sesión de bunker no válida' });
      const body = await readBody(req);
      const w = body.workout;
      if (!w || !w.d || !Array.isArray(w.entries)) return json(res, 400, { error: 'entreno no válido' });
      const S = readState(uid) || {};
      S.exWeights = S.exWeights || {};

      // v1.3.1 (A4 fix) — idempotent by workout id: a retried finish (double-tap, a client that
      // never saw the first response and retries once back online) must never create a second
      // workout. Re-deriving PRs at this point would also be wrong — the history already
      // includes this exact workout, so it would be compared against itself. Treat it as already
      // succeeded: report the PRs it was actually saved with, and still make sure `active`/the
      // room-board presence are the same "finished" state a first-time success leaves them in,
      // in case an earlier attempt died after saving the workout but before either of those.
      const already = (S.workouts || []).find(x => x.id === w.id);
      if (already) {
        if (S.active && S.active.id === w.id) { replaceActive(S, null); writeState(uid, S); }
        if (!S.active || S.active.id === w.id) store.endSession(uid);
        return json(res, 200, { ok: true, prs: already.prs || [], e1prs: [] });
      }

      // Computed against the history as it stands BEFORE this workout joins it — same order
      // doFinishWorkout uses (prs/e1prs are derived first, the push happens after).
      const prs = [];
      const e1prs = [];
      w.entries.forEach(e => {
        const mx = Math.max(0, ...e.sets.filter(s => s.done).map(s => s.w || 0));
        if (mx > 0 && mx > bestWeightFor(S, e.id)) prs.push(e.id);
        const rec = is1RMRecord(S, e.id, e);
        if (rec && !prs.includes(e.id)) e1prs.push({ id: e.id, ...rec });
      });
      w.prs = prs;

      const workouts = [...(S.workouts || [])];
      let i = workouts.length;
      while (i > 0 && workouts[i - 1].d > w.d) i--;
      workouts.splice(i, 0, w);
      S.workouts = workouts;

      // Same exWeights rule as doFinishWorkout: the heaviest done set (topW counts too),
      // recorded only when it beats whatever was already on file.
      w.entries.forEach(e => {
        const mx = Math.max(0, ...e.sets.filter(x => x.done).map(x => x.w || 0), e.topW || 0);
        if (mx > 0) {
          const cur = S.exWeights[e.id];
          if (!cur || mx > cur.w) S.exWeights[e.id] = { w: mx, d: w.d };
        }
      });

      replaceActive(S, null);
      writeState(uid, S);
      store.endSession(uid);
      json(res, 200, { ok: true, prs, e1prs });
    },

    // Minimizing back to the room dashboard without ending the session — the kiosk just stops
    // showing the member's own panel; their card (and any running rest countdown) stays on the
    // board exactly as /active or /rest last left it. Nothing to do server-side, so there is no
    // endpoint for it — this comment exists so that absence reads as a decision, not a gap.

    /* ---------- room admin — a trainer's phone, or the kiosk's own admin-code overlay ---------- */
    'POST /api/bunker/admin-checkin': async (req, res) => {
      const rateKey = bunkerClientIp(req);
      const body = await readBody(req);
      const code = String(body.code || '').trim();
      const attempt = limitAttempt('admin', rateKey, code);
      if (!attempt.allowed) return json(res, 429, { error: 'demasiados intentos; espera un momento' }, { 'Retry-After': String(attempt.retryAfter) });
      const uid = store.userIdForAdminCode(code);
      if (!uid) { attempt.fail(); return json(res, 400, { error: 'código incorrecto' }); }
      // v1.3.1 (A3 fix) — the code itself is fixed forever (store.js's own comment on
      // adminCodeFor), but the trainer/admin role it once matched isn't: a demoted or disabled
      // account's old code must not mint a working admin token anymore, generic error either
      // way for the same reason as checkin's own comment above.
      const account = users().find(u => u.id === uid);
      if (!account || account.disabled || !isTrainer(account)) { attempt.fail(); return json(res, 400, { error: 'código incorrecto' }); }
      attempt.success();
      const exp = Date.now() + ADMIN_TOKEN_TTL;
      json(res, 200, { token: sign('bunker-admin:' + uid + ':' + exp), exp });
    },
    'GET /api/bunker/admin/sessions': async (req, res) => {
      const admin = guardAdmin(req);
      if (!admin) return json(res, 401, { error: 'no autorizado' });
      json(res, 200, { sessions: store.listSessions() });
    },
    // "Cerrar sesión forzada" — drops the athlete off the kiosk/board. Their S.active is left
    // exactly as it was (see /api/bunker/active above — nothing here touches it), so whatever
    // they'd logged so far is safe on their own account; they just stop being "in the room".
    'POST /api/bunker/admin/close': async (req, res) => {
      const admin = guardAdmin(req);
      if (!admin) return json(res, 401, { error: 'no autorizado' });
      const body = await readBody(req);
      if (!body.uid) return json(res, 400, { error: 'falta uid' });
      store.endSession(String(body.uid));
      json(res, 200, { ok: true });
    },
    // "Pausar / Reanudar" — freezes or resumes just the rest countdown (store.js's
    // pauseSession/resumeSession bank the remaining seconds rather than losing them).
    'POST /api/bunker/admin/pause': async (req, res) => {
      const admin = guardAdmin(req);
      if (!admin) return json(res, 401, { error: 'no autorizado' });
      const body = await readBody(req);
      if (!body.uid) return json(res, 400, { error: 'falta uid' });
      const s = body.paused ? store.pauseSession(String(body.uid)) : store.resumeSession(String(body.uid));
      if (!s) return json(res, 404, { error: 'esa sesión ya no está activa' });
      json(res, 200, { ok: true, paused: s.paused, restEndsAt: s.restEndsAt });
    },
    // "Asistir / Ajustar carga" — the admin's own read of one checked-in member's session,
    // reusing the exact same narrow payload the member's own bunker token gets (sessionPayload
    // above); this is the one place an admin token can see into a member's in-progress workout.
    'GET /api/bunker/admin/session': async (req, res) => {
      const admin = guardAdmin(req);
      if (!admin) return json(res, 401, { error: 'no autorizado' });
      const uid = String(new URL(req.url, 'http://x').searchParams.get('uid') || '');
      if (!uid || !store.getSession(uid)) return json(res, 404, { error: 'esa sesión ya no está activa' });
      json(res, 200, sessionPayload(uid));
    },
    // body: { uid, active, exId, exName, setIdx, setsTotal } — same shape as the member's own
    // POST /active, just authorized as the room admin correcting a mis-logged set instead of
    // the member's own bunker token. Never reaches anything outside S.active either way.
    'POST /api/bunker/admin/edit-set': async (req, res) => {
      const admin = guardAdmin(req);
      if (!admin) return json(res, 401, { error: 'no autorizado' });
      const body = await readBody(req);
      const uid = String(body.uid || '');
      if (!uid || !store.getSession(uid)) return json(res, 404, { error: 'esa sesión ya no está activa' });
      const S = readState(uid) || {};
      const receipt = activeReceipt(res, S, body, 'admin');
      if (receipt?.handled) return;
      if (!checkActiveRevision(res, S, body)) return;
      replaceActive(S, body.active || null);
      const result = { ok: true, activeRevision: activeRevision(S) };
      saveActive(uid, S, receipt, result);
      store.touchSession(uid, { exId: body.exId || null, exName: body.exName || null, setIdx: body.setIdx || 0, setsTotal: body.setsTotal || 0 });
      json(res, 200, result);
    },
    // The PIN-management list (Fase V2 §4) — every real member, not just whoever's currently
    // checked in, so an admin can hand out or reset a PIN before someone's first-ever visit.
    'GET /api/bunker/admin/members': async (req, res) => {
      const admin = guardAdmin(req);
      if (!admin) return json(res, 401, { error: 'no autorizado' });
      json(res, 200, { members: users().filter(u => !u.disabled).map(u => ({ id: u.id, name: u.name, pin: store.pinFor(u.id) })) });
    },
    'POST /api/bunker/admin/pin-reset': async (req, res) => {
      const admin = guardAdmin(req);
      if (!admin) return json(res, 401, { error: 'no autorizado' });
      const body = await readBody(req);
      if (!body.uid) return json(res, 400, { error: 'falta uid' });
      json(res, 200, { pin: store.resetPin(String(body.uid)) });
    },
    'POST /api/bunker/admin/room-key/reset': async (req, res) => {
      const admin = guardAdmin(req);
      if (!admin) return json(res, 401, { error: 'no autorizado' });
      json(res, 200, { key: store.resetRoomKey() });
    },
    'POST /api/bunker/admin/settings': async (req, res) => {
      const admin = guardAdmin(req);
      if (!admin) return json(res, 401, { error: 'no autorizado' });
      const body = await readBody(req);
      const patch = {};
      if (body.columns === 'auto' || Number.isFinite(body.columns)) {
        patch.columns = body.columns === 'auto' ? 'auto' : Math.max(2, Math.min(8, Math.round(body.columns)));
      }
      if (typeof body.header === 'string') patch.header = body.header.slice(0, 60);
      if (typeof body.enableRestEndBeep === 'boolean') patch.enableRestEndBeep = body.enableRestEndBeep;
      if (typeof body.highlightFinishedRest === 'boolean') patch.highlightFinishedRest = body.highlightFinishedRest;
      if (typeof body.hideWeightsInPublicView === 'boolean') patch.hideWeightsInPublicView = body.hideWeightsInPublicView;
      if ([15, 30, 45, 60].includes(Number(body.autoLockSec))) patch.autoLockSec = Number(body.autoLockSec);
      json(res, 200, store.setSettings(patch));
    },
  };
}
