/* opengym-api — passkey (WebAuthn) auth + per-user state storage for openGym
   No framework, JSON-file storage, signed session cookies.               */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse
} from '@simplewebauthn/server';
import webpush from 'web-push';
import * as coachConfig from './coach/config.js';
import * as coachJobs from './coach/jobs.js';
import { coachRoutes } from './coach/routes.js';
import { startCadence } from './coach/cadence.js';

const PORT = +(process.env.PORT || 3000);
const DATA = process.env.DATA_DIR || '/data';
const RP_ID = process.env.RP_ID || 'localhost';
const ORIGIN = process.env.ORIGIN || 'http://localhost:8080';
const RP_NAME = process.env.RP_NAME || 'openGym';
// Admin dashboard (issue): admins are matched by uid; INVITE_ONLY gates new signups behind a
// code the admin generates. Both default off so a fresh self-hosted instance stays open.
const ADMIN_UIDS = (process.env.ADMIN_UIDS || '').split(',').map(s => s.trim()).filter(Boolean);
const INVITE_ONLY = /^(1|true|yes|on)$/i.test(process.env.INVITE_ONLY || '');
// 90 days keeps someone who trains a few times a week permanently signed in without a stolen
// cookie staying good for a year. Overridable because a family instance and one on the open
// internet don't want the same number. Only affects cookies minted from now on — the expiry is
// baked into each cookie when it's issued, so lowering this never cuts an existing session short.
const SESSION_DAYS = Math.max(1, +(process.env.SESSION_DAYS || 90) || 90);
const MAX_BODY = 5 * 1024 * 1024;
// Secure cookies require HTTPS; over plain http://localhost the flag would drop the cookie
const SECURE = /^https:/i.test(ORIGIN) ? ' Secure;' : '';

fs.mkdirSync(DATA, { recursive: true });
// 0700 is what stops the unprivileged user that Coach jobs run as from reading any of this —
// state files, db.json, the session secret, the provider credential. The Agent SDK process gets
// its job payload in a temp directory and nothing else. Best-effort: a bind-mounted host directory
// may refuse the chmod, and that is not a reason to refuse to boot.
try { fs.chmodSync(DATA, 0o700); } catch { /* host filesystem says no — carry on */ }

/* ---------- secret + db ---------- */
const secretFile = path.join(DATA, 'secret');
if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
const SECRET = fs.readFileSync(secretFile, 'utf8').trim();

const dbFile = path.join(DATA, 'db.json');
let db = { users: [], creds: [], subs: [], invites: [], recoveries: [] };
try { db = JSON.parse(fs.readFileSync(dbFile, 'utf8')); } catch {}
db.subs = db.subs || [];
db.invites = db.invites || [];
db.recoveries = db.recoveries || [];
const isAdmin = user => !!user && (user.admin === true || ADMIN_UIDS.includes(user.id));
// Trainer: gym staff, granted by the owner (admin) from the admin panel — a persisted flag on
// the user record, same shape as `admin` itself. Admins keep trainer powers so the owner never
// has to grant themselves a separate flag to use the trainer-only endpoints below.
const isTrainer = user => !!user && (user.trainer === true || isAdmin(user));
function saveDb() { atomicWrite(dbFile, JSON.stringify(db, null, 2)); }
function atomicWrite(file, content) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}
// Gym-wide exercise blacklist — ids the owner has hidden from every member's search/picker
// (equipment this gym doesn't have, movements they'd rather not offer). Not a deletion: a
// hidden id still resolves fine for anyone who already has it logged or in a routine.
const hiddenExFile = path.join(DATA, 'hidden-exercises.json');
let hiddenEx = [];
try { hiddenEx = JSON.parse(fs.readFileSync(hiddenExFile, 'utf8')); if (!Array.isArray(hiddenEx)) hiddenEx = []; } catch {}
function saveHiddenEx() { atomicWrite(hiddenExFile, JSON.stringify(hiddenEx)); }

const stateFile = uid => path.join(DATA, 'state-' + uid.replace(/[^a-zA-Z0-9_-]/g, '') + '.json');
function readState(uid) {
  try { return JSON.parse(fs.readFileSync(stateFile(uid), 'utf8')); } catch { return null; }
}

// Social: routines and programs members publish for each other (and trainers publish
// separately), plus the Wall of real logged PRs. Shared across every user, unlike
// state-<uid>.json — same module-level cache + atomicWrite-the-whole-object shape as hiddenEx
// above, just with content many different users contribute to instead of only the admin.
const socialFile = path.join(DATA, 'social.json');
let social = { routines: [], programs: [], wall: [] };
try {
  const parsed = JSON.parse(fs.readFileSync(socialFile, 'utf8'));
  social.routines = Array.isArray(parsed.routines) ? parsed.routines : [];
  social.programs = Array.isArray(parsed.programs) ? parsed.programs : [];
  social.wall = Array.isArray(parsed.wall) ? parsed.wall : [];
} catch {}
function saveSocial() { atomicWrite(socialFile, JSON.stringify(social, null, 2)); }

// Uploaded images — a routine/program's own cover (set from Plan, see POST /api/media/upload)
// or a Social routine/program post's cover (POST /api/social/routines|programs). Either way,
// the one place this app stores a user-provided file. DATA is a private volume nginx never sees
// (docker-compose.yml), so these have to be served back through the api itself (see GET
// /api/social/media below) rather than through the static img/ and gif/ dirs exercise media uses.
const uploadsDir = path.join(DATA, 'uploads');
try { fs.mkdirSync(uploadsDir, { recursive: true }); } catch {}
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
// dataUrl -> stored filename, or throws. The client resizes/compresses before sending (see
// Social.jsx's ImagePicker) — this cap is a safety net, not the primary size control.
function saveUploadedImage(dataUrl) {
  if (typeof dataUrl !== 'string' || !/^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(dataUrl))
    throw new Error('not a valid image');
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length || buf.length > MAX_IMAGE_BYTES) throw new Error('image too large');
  const name = crypto.randomBytes(9).toString('base64url').replace(/[^a-zA-Z0-9_-]/g, '') + '.jpg';
  fs.writeFileSync(path.join(uploadsDir, name), buf);
  return name;
}
function deleteUploadedImage(name) {
  if (!name) return;
  try { fs.unlinkSync(path.join(uploadsDir, String(name).replace(/[^a-zA-Z0-9_.-]/g, ''))); } catch {}
}

// Optional "spec sheet" fields on a Social routine/program post — level and goal are fixed
// choices (mirrors frontend/src/lib/starter.js's GOALS), duration and days/week are free-ish so
// publishing never blocks on filling in every field. All four are entirely optional.
const LEVELS = ['beginner', 'intermediate', 'advanced'];
const GOALS = ['hypertrophy', 'toning', 'fatloss', 'power', 'plyometrics', 'longevity'];
function readSpecFields(body) {
  const out = {};
  if (LEVELS.includes(body.level)) out.level = body.level;
  if (GOALS.includes(body.goal)) out.goal = body.goal;
  const duration = String(body.duration || '').trim().slice(0, 30);
  if (duration) out.duration = duration;
  const daysPerWeek = Math.round(Number(body.daysPerWeek));
  if (Number.isInteger(daysPerWeek) && daysPerWeek >= 1 && daysPerWeek <= 7) out.daysPerWeek = daysPerWeek;
  return out;
}

/* ---------- push notifications (Web Push / VAPID) ---------- */
const vapidFile = path.join(DATA, 'vapid.json');
let vapid;
try { vapid = JSON.parse(fs.readFileSync(vapidFile, 'utf8')); }
catch { vapid = webpush.generateVAPIDKeys(); fs.writeFileSync(vapidFile, JSON.stringify(vapid), { mode: 0o600 }); }
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || (SECURE ? ORIGIN : 'mailto:admin@localhost');
webpush.setVapidDetails(VAPID_SUBJECT, vapid.publicKey, vapid.privateKey);

async function sendPush(userId, payload) {
  const subs = db.subs.filter(s => s.userId === userId);
  if (!subs.length) return;
  const body = JSON.stringify(payload);
  let dirty = false;
  await Promise.all(subs.map(async sub => {
    // urgency 'high' is the one lever we have over delivery speed — iOS/Android throttle
    // low-urgency background push more aggressively under battery-saving modes. TTL is left
    // at the library default (long) so a briefly-offline device still gets it once reconnected,
    // rather than risking it being dropped for the sake of shaving off latency that TTL doesn't
    // actually control anyway.
    try { await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, body, { urgency: 'high' }); }
    catch (e) {
      console.error('push send failed', userId, e.statusCode, e.body || e.message);
      if (e.statusCode === 404 || e.statusCode === 410) {
        db.subs = db.subs.filter(s => s.endpoint !== sub.endpoint); dirty = true;
      }
    }
  }));
  if (dirty) saveDb();
}

// Rest-timer alerts: client schedules on start/extend, cancels on skip or on-screen completion —
// this only fires when the tab was backgrounded/suspended and never got to cancel it itself.
const restTimers = new Map(); // userId -> Timeout
function scheduleRestTimer(userId, sec, exercise) {
  const t = restTimers.get(userId);
  if (t) clearTimeout(t);
  restTimers.set(userId, setTimeout(() => {
    restTimers.delete(userId);
    sendPush(userId, {
      title: 'Descanso terminado 💪',
      body: exercise ? `Tu próxima serie: ${exercise}` : 'Es hora de tu siguiente serie.',
      tag: 'rest-timer'
    });
  }, sec * 1000));
}
function cancelRestTimer(userId) {
  const t = restTimers.get(userId);
  if (t) { clearTimeout(t); restTimers.delete(userId); }
}

// "Workout planned today" reminder — one per user per day, at their chosen time.
// Duplicated (not imported) from frontend/src/lib/history.js effectiveRoutineId — tiny pure helper, not worth sharing across the two runtimes.
function effectiveRoutineId(S, iso) {
  const ov = S.dayPlan?.[iso];
  if (ov === 'rest') return null;
  if (ov && S.routines?.some(r => r.id === ov)) return ov;
  const wd = new Date(iso + 'T12:00:00').getDay();
  return S.week?.[wd] || null;
}
// Computes "now" in an arbitrary IANA zone (e.g. "Europe/Lisbon") instead of the server's own —
// each user's reminder fires by their own clock, wherever they and their phone actually are.
function userNow(tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    }).formatToParts(new Date());
    const g = t => parts.find(p => p.type === t)?.value;
    const date = `${g('year')}-${g('month')}-${g('day')}`;
    // Weekday is derived from the zone's own date, not the server's — a Sunday-evening review
    // has to be Sunday where the user is, which is what the reminder already assumes for time.
    return { date, hhmm: `${g('hour')}:${g('minute')}`, weekday: new Date(date + 'T12:00:00Z').getUTCDay() };
  } catch { return null; } // unknown/invalid tz string — skip this user rather than guess
}
setInterval(() => {
  for (const user of db.users) {
    if (!db.subs.some(s => s.userId === user.id)) continue;
    const S = readState(user.id);
    if (!S?.reminder?.on) continue;
    const now = userNow(S.reminder.tz || 'UTC');
    if (!now || S.reminder.time !== now.hhmm) continue;
    if (user.lastReminder === now.date) continue;
    if ((S.workouts || []).some(w => w.d === now.date)) continue;
    const rid = effectiveRoutineId(S, now.date);
    if (!rid) continue; // rest day — nothing planned
    const routine = (S.routines || []).find(r => r.id === rid);
    console.log('reminder firing', user.id, rid);
    user.lastReminder = now.date;
    saveDb();
    sendPush(user.id, {
      title: routine ? `${routine.emoji || '🏋️'} ${routine.name} hoy` : 'Entreno planeado hoy',
      body: 'Está en tu plan — vamos 💪',
      tag: 'day-reminder'
    });
  }
// Checked every 10s (not 60s) — ticks aren't aligned to the top of the minute, so a 60s
// interval could sit on your target minute for up to 59s before noticing. 10s caps that at ~9s.
}, 10000).unref();

/* ---------- sessions (signed cookie) ---------- */
function sign(payload) {
  const mac = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return payload + '.' + mac;
}
function verifySig(token) {
  const i = token.lastIndexOf('.');
  if (i < 0) return null;
  const payload = token.slice(0, i), mac = token.slice(i + 1);
  const expect = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  } catch { return null; }
  return payload;
}
// Session payload is `<uid>:<expiry>:<version>`, where the version is the user's `sv` counter.
// Bumping `sv` (POST /api/logout/all) makes every cookie ever handed out for that account stop
// verifying, which is the only revocation there was before short of deleting ./data/secret and
// signing out the whole instance. Cookies minted before `sv` existed have no third field and are
// read as version 0, matching a user who has never bumped — they stay valid until they expire.
const sessionVersion = user => user.sv || 0;
function makeSession(user) {
  const exp = Date.now() + SESSION_DAYS * 86400000;
  return sign(user.id + ':' + exp + ':' + sessionVersion(user));
}
function readSession(req) {
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(c => {
    const i = c.indexOf('='); return i < 0 ? ['', ''] : [c.slice(0, i).trim(), c.slice(i + 1).trim()];
  }));
  const tok = cookies.gymsid;
  if (!tok) return null;
  const payload = verifySig(tok);
  if (!payload) return null;
  const [uid, exp, ver] = payload.split(':');
  if (!uid || +exp < Date.now()) return null;
  const user = db.users.find(u => u.id === uid) || null;
  if (!user) return null;
  if (user.disabled) return null;           // disabled accounts are locked out everywhere
  // Missing third field = pre-versioning cookie = version 0. Anything non-numeric is a malformed
  // payload (it still had to pass the HMAC, so this is belt-and-braces) and is refused outright.
  const claimed = ver === undefined ? 0 : Number(ver);
  if (!Number.isInteger(claimed) || claimed !== sessionVersion(user)) return null;
  return user;
}
// Guard for /api/admin/* — resolves the caller and 401/403s if they aren't an admin.
function requireAdmin(req, res) {
  const user = readSession(req);
  if (!user) { json(res, 401, { error: 'not signed in' }); return null; }
  if (!isAdmin(user)) { json(res, 403, { error: 'forbidden' }); return null; }
  return user;
}
// Guard for /api/trainer/* — resolves the caller and 401/403s if they aren't a trainer (or admin).
function requireTrainer(req, res) {
  const user = readSession(req);
  if (!user) { json(res, 401, { error: 'not signed in' }); return null; }
  if (!isTrainer(user)) { json(res, 403, { error: 'forbidden' }); return null; }
  return user;
}
function sessionCookie(user) {
  return `gymsid=${makeSession(user)}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly;${SECURE} SameSite=Lax`;
}
const clearCookie = `gymsid=; Path=/; Max-Age=0; HttpOnly;${SECURE} SameSite=Lax`;

/* ---------- challenge store (in-memory, 5 min TTL) ---------- */
const challenges = new Map(); // cid -> {challenge, name?, uid?, exp}
function putChallenge(data) {
  const cid = crypto.randomBytes(16).toString('base64url');
  challenges.set(cid, { ...data, exp: Date.now() + 5 * 60000 });
  return cid;
}
function takeChallenge(cid) {
  const c = challenges.get(cid);
  challenges.delete(cid);
  if (!c || c.exp < Date.now()) return null;
  return c;
}
setInterval(() => { for (const [k, v] of challenges) if (v.exp < Date.now()) challenges.delete(k); }, 60000).unref();

/* ---------- helpers ---------- */
function json(res, code, obj, extraHeaders) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(extraHeaders || {}) });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', d => {
      size += d.length;
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(d);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}
const b64uToBuf = s => Buffer.from(s, 'base64url');

/* ---------- live presence (in-memory) ---------- */
// Clients heartbeat /api/activity while a workout is on screen; the admin dashboard reads who's
// live. Purely ephemeral — never persisted. Expires shortly after the last ping.
const presence = new Map();               // uid -> { name, exIdx, exTotal, setsDone, setsTotal, startedAt, updatedAt }
const PRESENCE_TTL = 70000;               // ~3.5× the 20s client heartbeat
function livePresence(uid) {
  const p = presence.get(uid);
  if (!p) return null;
  if (Date.now() - p.updatedAt > PRESENCE_TTL) { presence.delete(uid); return null; }
  return p;
}
setInterval(() => { for (const [k, v] of presence) if (Date.now() - v.updatedAt > PRESENCE_TTL) presence.delete(k); }, 30000).unref();

/* ---------- routes ---------- */
const routes = {
  'GET /api/health': async (req, res) => json(res, 200, { ok: true, users: db.users.length }),

  // Public config the login screen needs before anyone is signed in. `coach` is absent unless
  // the instance has both switched the Coach on and successfully connected a provider — the
  // single flag every piece of Coach UI hangs off, so an unconfigured instance is byte-for-byte
  // the app it was before the feature existed.
  'GET /api/config': async (req, res) => {
    const coach = coachConfig.publicConfig();
    json(res, 200, { invite_only: INVITE_ONLY, hiddenExercises: hiddenEx, ...(coach ? { coach } : {}) });
  },

  'GET /api/me': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    json(res, 200, { user: { id: user.id, name: user.name, admin: isAdmin(user), trainer: isTrainer(user) } });
  },

  'POST /api/register/options': async (req, res) => {
    const body = await readBody(req);
    const name = String(body.name || '').trim().slice(0, 40);
    if (!name) return json(res, 400, { error: 'name required' });
    const code = String(body.code || '').trim().toUpperCase();
    if (INVITE_ONLY && !db.invites.some(i => i.code === code && !i.usedBy && !i.revoked))
      return json(res, 403, { error: 'a valid invite code is required' });
    const uid = crypto.randomBytes(12).toString('base64url');
    const options = await generateRegistrationOptions({
      rpName: RP_NAME, rpID: RP_ID,
      userID: Buffer.from(uid), userName: name, userDisplayName: name,
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
      excludeCredentials: []
    });
    const cid = putChallenge({ challenge: options.challenge, name, uid, code });
    json(res, 200, { cid, options });
  },

  'POST /api/register/verify': async (req, res) => {
    const body = await readBody(req);
    const c = takeChallenge(body.cid);
    if (!c || !c.uid) return json(res, 400, { error: 'challenge expired — try again' });
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body.credential,
        expectedChallenge: c.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: false
      });
    } catch (e) { return json(res, 400, { error: 'verification failed: ' + e.message }); }
    if (!verification.verified) return json(res, 400, { error: 'not verified' });
    const { credential } = verification.registrationInfo;
    if (db.creds.find(x => x.id === credential.id)) return json(res, 409, { error: 'credential already registered' });
    // Re-check the invite at the last moment (it may have been used/revoked since options), then burn it.
    let invite = null;
    if (INVITE_ONLY) {
      invite = db.invites.find(i => i.code === c.code && !i.usedBy && !i.revoked);
      if (!invite) return json(res, 403, { error: 'invite code is no longer valid — ask for a new one' });
    }
    const user = { id: c.uid, name: c.name, created: new Date().toISOString() };
    if (invite) { user.invitedBy = invite.code; invite.usedBy = user.id; invite.usedAt = user.created; }
    db.users.push(user);
    db.creds.push({
      id: credential.id, userId: user.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter || 0,
      transports: body.credential?.response?.transports || []
    });
    saveDb();
    json(res, 200, { user: { id: user.id, name: user.name, admin: isAdmin(user), trainer: isTrainer(user) } }, { 'Set-Cookie': sessionCookie(user) });
  },

  'POST /api/login/options': async (req, res) => {
    const options = await generateAuthenticationOptions({
      rpID: RP_ID, userVerification: 'preferred', allowCredentials: []
    });
    const cid = putChallenge({ challenge: options.challenge });
    json(res, 200, { cid, options });
  },

  'POST /api/login/verify': async (req, res) => {
    const body = await readBody(req);
    const c = takeChallenge(body.cid);
    if (!c) return json(res, 400, { error: 'challenge expired — try again' });
    const cred = db.creds.find(x => x.id === body.credential?.id);
    if (!cred) return json(res, 404, { error: 'unknown passkey — create a profile first' });
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: body.credential,
        expectedChallenge: c.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: false,
        credential: {
          id: cred.id,
          publicKey: b64uToBuf(cred.publicKey),
          counter: cred.counter,
          transports: cred.transports
        }
      });
    } catch (e) { return json(res, 400, { error: 'verification failed: ' + e.message }); }
    if (!verification.verified) return json(res, 400, { error: 'not verified' });
    cred.counter = verification.authenticationInfo.newCounter;
    saveDb();
    const user = db.users.find(u => u.id === cred.userId);
    if (!user) return json(res, 500, { error: 'user missing' });
    if (user.disabled) return json(res, 403, { error: 'this account has been disabled' });
    json(res, 200, { user: { id: user.id, name: user.name, admin: isAdmin(user), trainer: isTrainer(user) } }, { 'Set-Cookie': sessionCookie(user) });
  },

  // ---------- admin-assisted account recovery ----------
  // Passkeys have no "forgotten password" — the one gap that leaves is a member who loses
  // their only device with no synced backup (iCloud Keychain / Google Password Manager cover
  // every other case on their own). This is the deliberate alternative to adding real
  // passwords + email back into the app: a short-lived, single-use, admin-issued token that
  // lets that member register a brand-new passkey onto their EXISTING account in person at the
  // gym, instead of creating a second, empty one. Same shape as an invite code, but it grants
  // access to an existing profile rather than creating a fresh one, hence the short expiry.
  'POST /api/recover/options': async (req, res) => {
    const body = await readBody(req);
    const token = String(body.token || '').trim().toUpperCase();
    const rec = db.recoveries.find(r => r.token === token && !r.usedAt && !r.revoked);
    if (!rec || rec.expiresAt < Date.now()) return json(res, 400, { error: 'this recovery link is no longer valid — ask staff for a new one' });
    const user = db.users.find(u => u.id === rec.userId);
    if (!user) return json(res, 404, { error: 'account no longer exists' });
    if (user.disabled) return json(res, 403, { error: 'this account has been disabled' });
    const existing = db.creds.filter(c => c.userId === user.id);
    const options = await generateRegistrationOptions({
      rpName: RP_NAME, rpID: RP_ID,
      userID: Buffer.from(user.id), userName: user.name, userDisplayName: user.name,
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
      // Same device the member lost isn't in this list — this only stops re-registering one
      // they still have (a phone that's fine, a saved passkey on another browser, etc).
      excludeCredentials: existing.map(c => ({ id: c.id, transports: c.transports || [] }))
    });
    const cid = putChallenge({ challenge: options.challenge, uid: user.id, recoveryToken: token });
    json(res, 200, { cid, options, name: user.name });
  },

  'POST /api/recover/verify': async (req, res) => {
    const body = await readBody(req);
    const c = takeChallenge(body.cid);
    if (!c || !c.uid || !c.recoveryToken) return json(res, 400, { error: 'challenge expired — try again' });
    // Re-checked at the last moment — same reasoning as the invite-code re-check: it may have
    // been used or have expired in the seconds since the options were issued.
    const rec = db.recoveries.find(r => r.token === c.recoveryToken && !r.usedAt && !r.revoked);
    if (!rec || rec.expiresAt < Date.now()) return json(res, 400, { error: 'this recovery link is no longer valid — ask staff for a new one' });
    const user = db.users.find(u => u.id === c.uid);
    if (!user) return json(res, 404, { error: 'account no longer exists' });
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body.credential,
        expectedChallenge: c.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: false
      });
    } catch (e) { return json(res, 400, { error: 'verification failed: ' + e.message }); }
    if (!verification.verified) return json(res, 400, { error: 'not verified' });
    const { credential } = verification.registrationInfo;
    if (db.creds.find(x => x.id === credential.id)) return json(res, 409, { error: 'credential already registered' });
    db.creds.push({
      id: credential.id, userId: user.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter || 0,
      transports: body.credential?.response?.transports || []
    });
    rec.usedAt = new Date().toISOString();
    saveDb();
    json(res, 200, { user: { id: user.id, name: user.name, admin: isAdmin(user), trainer: isTrainer(user) } }, { 'Set-Cookie': sessionCookie(user) });
  },

  'POST /api/logout': async (req, res) => json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie }),

  // "Sign out everywhere" — bumps this user's session version, which invalidates every cookie
  // ever issued for the account, on every device, including a copy someone else walked off with.
  // The caller's own cookie is cleared here too, so the browser doing it doesn't sit on a token
  // it no longer accepts. Passkeys are untouched: signing back in works immediately.
  'POST /api/logout/all': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    user.sv = sessionVersion(user) + 1;
    saveDb();
    json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie });
  },

  'GET /api/data': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    try {
      const state = JSON.parse(fs.readFileSync(stateFile(user.id), 'utf8'));
      json(res, 200, { state });
    } catch { json(res, 200, { state: null }); }
  },

  'PUT /api/data': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    if (!body.state || typeof body.state !== 'object') return json(res, 400, { error: 'state required' });
    delete body.state.active;              // in-progress workouts stay device-local
    atomicWrite(stateFile(user.id), JSON.stringify(body.state));
    json(res, 200, { ok: true, ts: body.state._ts || null });
  },

  'GET /api/push/public-key': async (req, res) => json(res, 200, { key: vapid.publicKey }),

  'POST /api/push/subscribe': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const sub = body.subscription;
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return json(res, 400, { error: 'invalid subscription' });
    db.subs = db.subs.filter(s => s.endpoint !== sub.endpoint);
    db.subs.push({ userId: user.id, endpoint: sub.endpoint, keys: sub.keys, created: new Date().toISOString() });
    saveDb();
    json(res, 200, { ok: true });
  },

  'POST /api/push/unsubscribe': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    db.subs = db.subs.filter(s => !(s.userId === user.id && s.endpoint === body.endpoint));
    saveDb();
    json(res, 200, { ok: true });
  },

  'POST /api/push/test': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    await sendPush(user.id, { title: '2J Fitness Center', body: 'Notificación de prueba ✅ — así se ven las alertas.', tag: 'test' });
    json(res, 200, { ok: true });
  },

  'POST /api/push/rest-timer': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const sec = Math.max(1, Math.min(3600, Math.round(+body.seconds || 0)));
    if (!sec) return json(res, 400, { error: 'seconds required' });
    const exercise = String(body.exercise || '').slice(0, 60).trim() || null;
    scheduleRestTimer(user.id, sec, exercise);
    json(res, 200, { ok: true });
  },

  'POST /api/push/rest-timer/cancel': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    cancelRestTimer(user.id);
    json(res, 200, { ok: true });
  },

  // Live-workout heartbeat: client pings while a workout is on screen; { active:false } drops it.
  'POST /api/activity': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    if (body.active) {
      presence.set(user.id, {
        name: String(body.name || '').slice(0, 60),
        exIdx: +body.exIdx || 0, exTotal: +body.exTotal || 0,
        setsDone: +body.setsDone || 0, setsTotal: +body.setsTotal || 0,
        startedAt: +body.startedAt || Date.now(),
        updatedAt: Date.now()
      });
    } else presence.delete(user.id);
    json(res, 200, { ok: true });
  },

  /* ---------- admin dashboard ---------- */
  // One row per user, cheap enough for a personal instance (reads each state file once).
  'GET /api/admin/users': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const users = db.users.map(u => {
      const S = readState(u.id) || {};
      const workouts = S.workouts || [];
      const last = workouts[workouts.length - 1];
      return {
        id: u.id, name: u.name, created: u.created || null,
        disabled: !!u.disabled, admin: isAdmin(u), trainer: isTrainer(u), invitedBy: u.invitedBy || null,
        workouts: workouts.length,
        lastWorkout: last ? last.d : null,
        lastSync: S._ts || null,
        hasPush: db.subs.some(s => s.userId === u.id),
        live: livePresence(u.id)
      };
    });
    json(res, 200, { users, invite_only: INVITE_ONLY, now: Date.now() });
  },

  // Drill-down: full workout history + body-weight log for one user.
  'GET /api/admin/user': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = new URL(req.url, 'http://x').searchParams.get('id');
    const u = db.users.find(x => x.id === id);
    if (!u) return json(res, 404, { error: 'no such user' });
    const S = readState(u.id) || {};
    const bw = S.bodyweight || [];
    json(res, 200, {
      user: { id: u.id, name: u.name, created: u.created || null, disabled: !!u.disabled, admin: isAdmin(u), trainer: isTrainer(u), invitedBy: u.invitedBy || null },
      unit: S.unit || 'kg',
      lastSync: S._ts || null,
      // Basic profile — set at registration or edited here, read by the AI Coach too
      // (api/coach/payload.js). birthDate stays a date, never a stored age.
      birthDate: S.birthDate || null,
      body: S.body === 'female' ? 'female' : 'male',
      height: Number.isFinite(S.height) && S.height > 0 ? S.height : null,
      // Muscle priorities (frontend/src/lib/muscle-priority.js slugs) — feed both the quick PPL plan
      // (starter.js's buildPlan, mirrored below) and the AI Coach's exercise selection.
      priorityMuscles: Array.isArray(S.priorityMuscles) ? S.priorityMuscles : [],
      secondaryMuscles: Array.isArray(S.secondaryMuscles) ? S.secondaryMuscles : [],
      latestWeight: bw.length ? bw[bw.length - 1] : null,
      // Latest reading per measurement key — see /api/admin/user/measurements. Full history
      // stays on the member's own device; the admin card only needs "what's the number now".
      measurements: Object.fromEntries(
        Object.entries(S.measurements || {}).map(([k, list]) => [k, list.length ? list[list.length - 1] : null])
      ),
      routines: (S.routines || []).map(r => ({ id: r.id, name: r.name, emoji: r.emoji, count: (r.ex || []).length })),
      bodyweight: bw,
      workouts: (S.workouts || []).slice().reverse()   // newest first for display
    });
  },

  // Staff edit of a member's own basic info — same fields the registration screen and
  // Settings' "Basic info" section collect, just editable by an admin on someone else's
  // profile. Bumping _ts means the member's own device picks this up on next sync exactly
  // like any other change (see pullState's _ts comparison in useStore.js).
  'POST /api/admin/user/profile': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const u = db.users.find(x => x.id === body.id);
    if (!u) return json(res, 404, { error: 'no such user' });
    if (body.name !== undefined) {
      const name = String(body.name).trim().slice(0, 40);
      if (!name) return json(res, 400, { error: 'name required' });
      u.name = name;
      saveDb();
    }
    const S = readState(u.id);
    if (!S) return json(res, 200, { ok: true }); // never synced yet — nothing to merge the rest into
    if (body.birthDate !== undefined) {
      S.birthDate = body.birthDate && /^\d{4}-\d{2}-\d{2}$/.test(body.birthDate) ? body.birthDate : null;
    }
    if (body.body !== undefined) S.body = body.body === 'female' ? 'female' : 'male';
    if (body.height !== undefined) {
      const h = Math.round(Number(body.height));
      S.height = h > 0 && h <= 250 ? h : null;
    }
    // Same 10-slug list as frontend/src/lib/muscle-priority.js's MUSCLES — silently drop anything else
    // rather than reject the whole save, same tolerance the rest of this endpoint gives bad input.
    const MUSCLES = ['quads', 'glutes', 'hamstrings', 'calves', 'chest', 'back', 'shoulders', 'biceps', 'triceps', 'abs'];
    if (body.priorityMuscles !== undefined) {
      S.priorityMuscles = Array.isArray(body.priorityMuscles) ? body.priorityMuscles.filter(m => MUSCLES.includes(m)) : [];
    }
    if (body.secondaryMuscles !== undefined) {
      S.secondaryMuscles = Array.isArray(body.secondaryMuscles) ? body.secondaryMuscles.filter(m => MUSCLES.includes(m)) : [];
    }
    S._ts = Date.now();
    atomicWrite(stateFile(u.id), JSON.stringify(S));
    json(res, 200, { ok: true });
  },

  // Staff entering a bioimpedance scan (this gym's Tanita, typically) straight onto a member's
  // profile — the same S.measurements[key] time series frontend/src/lib/measurements.js reads,
  // just written from the admin side instead of the member's own device. body: { id, values:
  // {key: number, ...}, d? }. `values` may carry any subset of MEASUREMENTS' keys — a scan that
  // only gave a body-fat reading shouldn't force every other field. `d` defaults to today so a
  // same-day re-entry (a mis-typed number, say) overwrites rather than duplicating.
  'POST /api/admin/user/measurements': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const u = db.users.find(x => x.id === body.id);
    if (!u) return json(res, 404, { error: 'no such user' });
    const S = readState(u.id);
    if (!S) return json(res, 400, { error: 'member has never synced — nothing to add measurements to yet' });
    const KEYS = ['neck', 'shoulders', 'chest', 'bicepsL', 'bicepsR', 'forearmL', 'forearmR', 'waist', 'hips',
      'thighL', 'thighR', 'calfL', 'calfR', 'bodyFat', 'muscleMass', 'waterPct', 'visceralFat', 'boneMass',
      'skinTriceps', 'skinSubscapular', 'skinSuprailiac', 'skinAbdominal'];
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(body.d || '') ? body.d : new Date().toISOString().slice(0, 10);
    const values = body.values && typeof body.values === 'object' ? body.values : {};
    S.measurements = S.measurements || {};
    let n = 0;
    for (const key of KEYS) {
      const v = values[key];
      if (v === undefined || v === null || v === '') continue;
      const num = Math.round(Number(v) * 10) / 10;
      if (!Number.isFinite(num) || num <= 0) continue;
      const list = S.measurements[key] = S.measurements[key] || [];
      const ex = list.find(x => x.d === iso);
      if (ex) { ex.v = num; ex.t = Date.now(); } else list.push({ d: iso, v: num, t: Date.now() });
      list.sort((a, b) => (a.d < b.d ? -1 : 1));
      n++;
    }
    if (!n) return json(res, 400, { error: 'no valid values given' });
    S._ts = Date.now();
    atomicWrite(stateFile(u.id), JSON.stringify(S));
    json(res, 200, { ok: true, saved: n });
  },

  // Applies the same Push/Pull/Legs starter plan "Load starter plan" offers a member, straight
  // onto a member's profile from the admin side — mirrors frontend/src/lib/starter.js's
  // buildPlan() exactly (exercise ids, SPEC_B, GOAL_RULES, DAY_SPREAD, routineOrder); kept in
  // sync by hand, same trade-off payload.js already makes for logic shared with the frontend
  // but not build-step-shared with it. body: { id, goal?, days? } — goal defaults to
  // 'longevity', days (2-6) to 3, same defaults the member-facing intake sheet starts on.
  // Muscle priorities aren't a body param — they come from the member's own saved profile
  // (S.priorityMuscles/secondaryMuscles), same as age/sex/height already do here.
  'POST /api/admin/user/apply-starter-plan': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const u = db.users.find(x => x.id === body.id);
    if (!u) return json(res, 404, { error: 'no such user' });
    const S = readState(u.id);
    if (!S) return json(res, 400, { error: 'member has never synced — nothing to add a plan to yet' });
    // Names hardcoded in Spanish — this admin endpoint has no i18n layer (the frontend's
    // equivalent, frontend/src/lib/starter.js, runs the same English keys through t()).
    const SPEC = [
      ['Día de empuje', 'barbell', ['0025', '0047', '0426', '0334', '0241', '0251']],
      ['Día de tirón', 'pullup', ['2330', '0027', '1323', '0031', '0313']],
      ['Día de piernas', 'legs', ['0043', '0085', '0739', '0585', '0586', '0605']]
    ];
    // A second, equally-curated exercise choice per slot/position — no longer "the whole
    // repeat-day routine" (see makeRoutine below, which blends SPEC/SPEC_B position by position
    // instead of picking one array wholesale), so its own names are never read anymore.
    const SPEC_B = [
      [null, 'barbell', ['0289', '0314', '0405', '0178', '0060', '0308']],
      [null, 'pullup', ['0818', '3017', '0861', '0070', '0165']],
      [null, 'legs', ['0046', '1459', '0760', '0585', '0599', '0594']]
    ];
    // [styleA, styleB] per position — 'free' (barbell/dumbbell-family) vs 'machine'
    // (cable/leverage/sled/smith) vs null (bodyweight/other) — precomputed from the live
    // exercise dataset's `eq` field, which this backend has no access to at runtime. Mirrors
    // frontend/src/lib/starter.js's styleOf(); regenerate by hand if SPEC/SPEC_B ever change.
    const STYLE = {
      0: [['free', 'free'], ['free', 'free'], ['free', 'free'], ['free', 'machine'], ['machine', 'free'], [null, 'free']],
      1: [['machine', 'machine'], ['free', 'free'], ['machine', 'machine'], ['free', 'free'], ['free', 'machine']],
      2: [['free', 'free'], ['free', 'free'], ['machine', 'machine'], ['machine', 'machine'], ['machine', 'machine'], ['machine', 'machine']]
    };
    // Same character-per-goal mapping as starter.js's GOAL_STYLE — power/plyometrics lean free-
    // weight, toning/fatloss/longevity lean machine; hypertrophy has no preference (its own goal
    // note calls for variety instead).
    const GOAL_STYLE = { power: 'free', plyometrics: 'free', toning: 'machine', fatloss: 'machine', longevity: 'machine' };
    const GOAL_RULES = {
      hypertrophy: { compound: [8, 4], accessory: [12, 3], superset: false },
      toning: { compound: [10, 4], accessory: [15, 3], superset: false },
      fatloss: { compound: [8, 4], accessory: [12, 3], superset: true },
      power: { compound: [3, 5], accessory: [5, 3], superset: false },
      plyometrics: { compound: [5, 4], accessory: [5, 3], superset: false },
      longevity: { compound: [10, 3], accessory: [12, 2], superset: false }
    };
    const DAY_SPREAD = { 2: [1, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 4, 5], 6: [1, 2, 3, 4, 5, 6] };
    const rules = GOAL_RULES[body.goal] || GOAL_RULES.longevity;
    const days = DAY_SPREAD[body.days] || DAY_SPREAD[3];
    // Optional — mirrors frontend/src/lib/starter.js's exerciseCountFor: trims a routine's
    // exercise count down for a shorter session (never grows past the curated list) and turns
    // supersets on for short sessions, kept in sync by hand like every other duplication here.
    const sessionMin = Number(body.sessionMin) || null;
    const exerciseCountFor = poolSize => {
      if (!sessionMin) return poolSize;
      const target = Math.round(5 + (sessionMin - 30) * 7 / 90);
      return Math.max(3, Math.min(poolSize, target));
    };
    // Picks 'A' (SPEC) or 'B' (SPEC_B) for one position — goal-biased where the two differ in
    // equipment style, a coin flip otherwise, forced to the other letter on a within-week repeat.
    const pickVariant = (styleA, styleB, exclude) => {
      if (exclude === 'A') return 'B';
      if (exclude === 'B') return 'A';
      const style = GOAL_STYLE[body.goal];
      if (style) {
        const aFits = styleA === style, bFits = styleB === style;
        if (aFits && !bFits) return 'A';
        if (bFits && !aFits) return 'B';
      }
      return Math.random() < 0.5 ? 'A' : 'B';
    };
    const makeRoutine = (slot, excludeLetters) => {
      const [name, emoji, idsA] = SPEC[slot];
      const [, , idsB] = SPEC_B[slot];
      const count = exerciseCountFor(idsA.length);
      const letters = [];
      const ex = [];
      for (let i = 0; i < count; i++) {
        const [styleA, styleB] = STYLE[slot][i];
        const letter = pickVariant(styleA, styleB, excludeLetters && excludeLetters[i]);
        letters.push(letter);
        const [reps, sets] = i === 0 ? rules.compound : rules.accessory;
        ex.push({ id: letter === 'A' ? idsA[i] : idsB[i], sets, reps, weight: 0 });
      }
      if (rules.superset || (sessionMin && sessionMin <= 45)) {
        for (let i = 1; i + 1 < ex.length; i += 2) { const tag = 'a' + i; ex[i].sg = tag; ex[i + 1].sg = tag; }
      }
      return { routine: { id: crypto.randomBytes(9).toString('base64url'), name, emoji, ex }, letters };
    };
    // Which of the 3 SPEC slots each muscle priority trains — see starter.js's MUSCLE_ROUTINE
    // for the full rationale. Ranks the slots so, under 3 days, the routine(s) that train the
    // prioritized muscles are the ones kept, and over 3 days they're the ones repeated first.
    const MUSCLE_ROUTINE = { chest: 0, shoulders: 0, triceps: 0, back: 1, biceps: 1, quads: 2, glutes: 2, hamstrings: 2, calves: 2 };
    const score = [0, 0, 0];
    (S.priorityMuscles || []).forEach(m => { const s = MUSCLE_ROUTINE[m]; if (s !== undefined) score[s] += 2; });
    (S.secondaryMuscles || []).forEach(m => { const s = MUSCLE_ROUTINE[m]; if (s !== undefined) score[s] += 1; });
    const order = [0, 1, 2].sort((a, b) => score[b] - score[a] || a - b);
    let slots;
    if (days.length <= 3) {
      const chosen = new Set(order.slice(0, days.length));
      slots = [0, 1, 2].filter(s => chosen.has(s));
    } else {
      slots = [0, 1, 2];
      for (let extra = 0; slots.length < days.length; extra++) slots.push(order[extra % 3]);
    }
    const usedByLap0 = {};   // slot -> letters[] picked on that slot's first occurrence this week
    const routines = slots.map((slot, i) => {
      const lap = slots.slice(0, i).filter(s => s === slot).length;
      const { routine, letters } = makeRoutine(slot, lap === 0 ? null : usedByLap0[slot]);
      if (lap === 0) usedByLap0[slot] = letters;
      return routine;
    });
    S.routines = [...(S.routines || []), ...routines];
    S.week = { ...(S.week || {}) };
    days.forEach((d, i) => { S.week[d] = routines[i].id; });
    S._ts = Date.now();
    atomicWrite(stateFile(u.id), JSON.stringify(S));
    json(res, 200, { ok: true });
  },

  // The exercise blacklist itself — ids only. The 1324-exercise catalogue (names, body parts,
  // equipment) already ships inside the frontend bundle, so the admin page browses that
  // directly rather than this server sending it again; this just says which ids are off.
  'GET /api/admin/exercises/hidden': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    json(res, 200, { hidden: hiddenEx });
  },

  'POST /api/admin/exercises/hidden': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const id = String(body.id || '');
    if (!id) return json(res, 400, { error: 'id required' });
    const on = hiddenEx.includes(id);
    if (body.hidden && !on) hiddenEx.push(id);
    else if (!body.hidden && on) hiddenEx = hiddenEx.filter(x => x !== id);
    saveHiddenEx();
    json(res, 200, { ok: true, hidden: hiddenEx });
  },

  'POST /api/admin/user/disable': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const u = db.users.find(x => x.id === body.id);
    if (!u) return json(res, 404, { error: 'no such user' });
    if (isAdmin(u)) return json(res, 400, { error: 'cannot disable an admin' });
    u.disabled = !!body.disabled;
    if (u.disabled) presence.delete(u.id);   // drop them off "training now" at once
    saveDb();
    json(res, 200, { ok: true, id: u.id, disabled: u.disabled });
  },

  // Grants/revokes the Trainer role — gym staff who can publish routines to Social's
  // "Entrenadores" section and assign one directly onto a member's plan. Admins are always
  // trainers too (isTrainer), so this flag only matters for non-admin staff accounts.
  'POST /api/admin/user/trainer': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const u = db.users.find(x => x.id === body.id);
    if (!u) return json(res, 404, { error: 'no such user' });
    u.trainer = !!body.trainer;
    saveDb();
    json(res, 200, { ok: true, id: u.id, trainer: u.trainer });
  },

  // Admin-assisted recovery: a short-lived, single-use link that lets a member who lost their
  // only device register a new passkey onto their EXISTING account — see /api/recover/options
  // for the full rationale. Meant to be handed over in person (shown on screen, AirDropped,
  // read out as a code), not sent unattended, so 15 minutes is deliberately tight: an admin
  // generates it right when the member is standing there, not ahead of time.
  'POST /api/admin/user/recovery-link': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const u = db.users.find(x => x.id === body.id);
    if (!u) return json(res, 404, { error: 'no such user' });
    // Only one live link per member — generating a new one retires any still-unused one, so a
    // link an admin forgot about can't be found and used later.
    db.recoveries.forEach(r => { if (r.userId === u.id && !r.usedAt) r.revoked = true; });
    let token;
    do { token = crypto.randomBytes(8).toString('hex').toUpperCase(); } while (db.recoveries.some(r => r.token === token));
    const expiresAt = Date.now() + 15 * 60000;
    db.recoveries.push({ token, userId: u.id, createdBy: admin.id, created: new Date().toISOString(), expiresAt });
    saveDb();
    json(res, 200, { token, expiresAt });
  },

  'GET /api/admin/invites': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    // resolve usedBy uid → name for display
    const invites = db.invites.map(i => ({
      ...i, usedByName: i.usedBy ? (db.users.find(u => u.id === i.usedBy) || {}).name || null : null
    }));
    json(res, 200, { invites, invite_only: INVITE_ONLY });
  },

  'POST /api/admin/invites/new': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    let code;
    // 16 hex chars = 64 bits, up from 8 chars / 32 bits. The app has no rate limiting by design
    // (that's the reverse proxy's job) and /api/register/options tells a caller whether a code is
    // good, so the code itself has to be the thing that isn't worth guessing. Codes already in
    // db.json keep working — validation is an exact string compare, never a length or format check.
    do { code = crypto.randomBytes(8).toString('hex').toUpperCase(); } while (db.invites.some(i => i.code === code));
    const invite = { code, note: String(body.note || '').slice(0, 60), createdBy: admin.id, created: new Date().toISOString() };
    db.invites.push(invite);
    saveDb();
    json(res, 200, { invite });
  },

  'POST /api/admin/invites/revoke': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const inv = db.invites.find(i => i.code === String(body.code || '').toUpperCase());
    if (!inv) return json(res, 404, { error: 'no such code' });
    if (inv.usedBy) return json(res, 400, { error: 'already used — cannot revoke' });
    db.invites = db.invites.filter(i => i.code !== inv.code);
    saveDb();
    json(res, 200, { ok: true });
  },

  /* ---------- Social: member/trainer routines + the Wall of real PRs ---------- */
  // Every route here requires a signed-in session — this is a private single-gym app, nothing
  // is reachable by someone who hasn't registered a profile. Publishing is unmoderated (goes
  // live immediately); the escape hatch is that the author or an admin can always delete a post.
  'GET /api/social/routines': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const routines = social.routines.map(r => {
      const ratings = r.ratings || [];
      const avgStars = ratings.length ? Math.round((ratings.reduce((s, x) => s + x.stars, 0) / ratings.length) * 10) / 10 : null;
      const mine = ratings.find(x => x.uid === user.id);
      const { ratings: _drop, ...rest } = r;
      return { ...rest, avgStars, ratingCount: ratings.length, myStars: mine ? mine.stars : null };
    });
    json(res, 200, { routines });
  },

  // body: { name, emoji, prog?, ex, customExDefs?, image?, description? } — a deep-cloned member
  // routine, exactly the shape frontend/src/views/RoutineEdit.jsx produces. `authorKind` is
  // computed here from the caller's OWN trainer status at the moment of publishing, never
  // trusted from the client and never recomputed later — a trainer role revoked afterwards
  // doesn't retroactively move their past posts out of "Entrenadores".
  'POST /api/social/routines': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const name = String(body.name || '').trim().slice(0, 60);
    const ex = Array.isArray(body.ex) ? body.ex : null;
    if (!name || !ex || !ex.length) return json(res, 400, { error: 'a routine needs a name and at least one exercise' });
    const customExDefs = Array.isArray(body.customExDefs)
      ? body.customExDefs.filter(d => d && typeof d.id === 'string' && typeof d.n === 'string') : [];
    const customIds = new Set(customExDefs.map(d => d.id));
    // Every custom-exercise id the routine references has to travel with its full definition —
    // EXIDX is per-browser-tab and rebuilt from whichever user's customEx last loaded, so a
    // custom exercise id alone would resolve to "Unknown exercise" for anyone else.
    if (ex.some(e => typeof e.id === 'string' && e.id.startsWith('c') && !customIds.has(e.id)))
      return json(res, 400, { error: 'missing definitions for one or more custom exercises in this routine' });
    let image = null;
    if (body.image) { try { image = saveUploadedImage(body.image); } catch (e) { return json(res, 400, { error: e.message }); } }
    const post = {
      id: crypto.randomBytes(9).toString('base64url'),
      authorId: user.id, authorName: user.name, authorKind: isTrainer(user) ? 'trainer' : 'member',
      name, emoji: String(body.emoji || 'dumbbell').slice(0, 20),
      image, description: String(body.description || '').trim().slice(0, 300) || null,
      ...readSpecFields(body),
      ex, customExDefs,
      createdAt: Date.now(),
      ratings: []
    };
    if (body.prog) post.prog = String(body.prog).slice(0, 20);
    social.routines.push(post);
    saveSocial();
    json(res, 200, { ok: true, id: post.id });
  },

  'POST /api/social/routines/rate': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const stars = Math.round(Number(body.stars));
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) return json(res, 400, { error: 'stars must be 1-5' });
    const post = social.routines.find(r => r.id === body.id);
    if (!post) return json(res, 404, { error: 'no such routine' });
    post.ratings = post.ratings || [];
    const existing = post.ratings.find(x => x.uid === user.id);
    if (existing) { existing.stars = stars; existing.at = Date.now(); }
    else post.ratings.push({ uid: user.id, stars, at: Date.now() });
    saveSocial();
    const avgStars = Math.round((post.ratings.reduce((s, x) => s + x.stars, 0) / post.ratings.length) * 10) / 10;
    json(res, 200, { ok: true, avgStars, ratingCount: post.ratings.length, myStars: stars });
  },

  'POST /api/social/routines/delete': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const post = social.routines.find(r => r.id === body.id);
    if (!post) return json(res, 404, { error: 'no such routine' });
    if (post.authorId !== user.id && !isAdmin(user)) return json(res, 403, { error: 'forbidden' });
    deleteUploadedImage(post.image);
    social.routines = social.routines.filter(r => r.id !== body.id);
    saveSocial();
    json(res, 200, { ok: true });
  },

  // A routine's/program's image lives on disk, not in social.json — DATA is a private volume
  // nginx never sees, so this is the one place an uploaded file gets served back.
  'GET /api/social/media': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const id = String(new URL(req.url, 'http://x').searchParams.get('id') || '').replace(/[^a-zA-Z0-9_.-]/g, '');
    if (!id) return json(res, 400, { error: 'id required' });
    try {
      const buf = fs.readFileSync(path.join(uploadsDir, id));
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=31536000, immutable' });
      res.end(buf);
    } catch { json(res, 404, { error: 'no such image' }); }
  },

  // A routine's or program's own cover photo, set from Plan (not tied to publishing it to
  // Social — see frontend/src/sheets.jsx's glyphPicker) — any signed-in member, body: { image }
  // a data URL. Nothing here tracks which routine/program a file belongs to (the client stores
  // just the returned id on the routine/program itself, same as every other opaque S field), so
  // an orphaned cover from a since-deleted routine is never cleaned up — an accepted trade-off
  // for a small single-gym instance rather than building real reference-counted GC for it.
  'POST /api/media/upload': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    try { json(res, 200, { id: saveUploadedImage(body.image) }); }
    catch (e) { json(res, 400, { error: e.message }); }
  },

  /* ---------- Social: Programs (a named group of routines, published as one unit) ---------- */
  'GET /api/social/programs': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const programs = social.programs.map(p => {
      const ratings = p.ratings || [];
      const avgStars = ratings.length ? Math.round((ratings.reduce((s, x) => s + x.stars, 0) / ratings.length) * 10) / 10 : null;
      const mine = ratings.find(x => x.uid === user.id);
      const { ratings: _drop, ...rest } = p;
      return { ...rest, avgStars, ratingCount: ratings.length, myStars: mine ? mine.stars : null };
    });
    json(res, 200, { programs });
  },

  // body: { name, emoji, image?, description?, routines: [{name, emoji, prog?, ex, customExDefs?}, ...] }
  // — the full embedded routine objects (not ids: S.programs[].routineIds only mean something on
  // the publishing member's own device), one customExDefs check per embedded routine.
  'POST /api/social/programs': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const name = String(body.name || '').trim().slice(0, 60);
    const routinesIn = Array.isArray(body.routines) ? body.routines : null;
    if (!name || !routinesIn || !routinesIn.length) return json(res, 400, { error: 'a program needs a name and at least one routine' });
    const routines = [];
    for (const r of routinesIn) {
      const rname = String(r?.name || '').trim().slice(0, 60);
      const ex = Array.isArray(r?.ex) ? r.ex : null;
      if (!rname || !ex || !ex.length) return json(res, 400, { error: 'every routine needs a name and at least one exercise' });
      const customExDefs = Array.isArray(r.customExDefs)
        ? r.customExDefs.filter(d => d && typeof d.id === 'string' && typeof d.n === 'string') : [];
      const customIds = new Set(customExDefs.map(d => d.id));
      if (ex.some(e => typeof e.id === 'string' && e.id.startsWith('c') && !customIds.has(e.id)))
        return json(res, 400, { error: 'missing definitions for one or more custom exercises in this program' });
      const routine = { name: rname, emoji: String(r.emoji || 'dumbbell').slice(0, 20), ex, customExDefs };
      if (r.prog) routine.prog = String(r.prog).slice(0, 20);
      routines.push(routine);
    }
    let image = null;
    if (body.image) { try { image = saveUploadedImage(body.image); } catch (e) { return json(res, 400, { error: e.message }); } }
    const post = {
      id: crypto.randomBytes(9).toString('base64url'),
      authorId: user.id, authorName: user.name, authorKind: isTrainer(user) ? 'trainer' : 'member',
      name, emoji: String(body.emoji || 'folder').slice(0, 20),
      image, description: String(body.description || '').trim().slice(0, 300) || null,
      ...readSpecFields(body),
      routines,
      createdAt: Date.now(),
      ratings: []
    };
    social.programs.push(post);
    saveSocial();
    json(res, 200, { ok: true, id: post.id });
  },

  'POST /api/social/programs/rate': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const stars = Math.round(Number(body.stars));
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) return json(res, 400, { error: 'stars must be 1-5' });
    const post = social.programs.find(p => p.id === body.id);
    if (!post) return json(res, 404, { error: 'no such program' });
    post.ratings = post.ratings || [];
    const existing = post.ratings.find(x => x.uid === user.id);
    if (existing) { existing.stars = stars; existing.at = Date.now(); }
    else post.ratings.push({ uid: user.id, stars, at: Date.now() });
    saveSocial();
    const avgStars = Math.round((post.ratings.reduce((s, x) => s + x.stars, 0) / post.ratings.length) * 10) / 10;
    json(res, 200, { ok: true, avgStars, ratingCount: post.ratings.length, myStars: stars });
  },

  'POST /api/social/programs/delete': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const post = social.programs.find(p => p.id === body.id);
    if (!post) return json(res, 404, { error: 'no such program' });
    if (post.authorId !== user.id && !isAdmin(user)) return json(res, 403, { error: 'forbidden' });
    deleteUploadedImage(post.image);
    social.programs = social.programs.filter(p => p.id !== body.id);
    saveSocial();
    json(res, 200, { ok: true });
  },

  'GET /api/social/wall': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    json(res, 200, { wall: [...social.wall].sort((a, b) => b.createdAt - a.createdAt) });
  },

  // body: { exId, exName, mode, value, sourceDate, note? } — re-checked against the CALLER's own
  // logged history below, so this can never be a made-up number: the picker in the app is a
  // convenience, this check is the actual guarantee.
  'POST /api/social/wall': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const exId = String(body.exId || '');
    const mode = ['reps', 'time', 'cardio'].includes(body.mode) ? body.mode : null;
    const sourceDate = String(body.sourceDate || '');
    const value = body.value && typeof body.value === 'object' ? body.value : null;
    if (!exId || !mode || !value || !/^\d{4}-\d{2}-\d{2}$/.test(sourceDate))
      return json(res, 400, { error: 'a valid exercise, mode, value and date are required' });
    const S = readState(user.id);
    if (!S) return json(res, 400, { error: 'nothing synced yet' });
    const workout = (S.workouts || []).find(w => w.d === sourceDate);
    const entry = workout && workout.entries.find(e => e.id === exId);
    const matches = s => {
      if (!s.done) return false;
      if (mode === 'cardio') return Number(s.min) === Number(value.min) && Number(s.speed) === Number(value.speed);
      if (mode === 'time') return Number(s.sec) === Number(value.sec) && Number(s.w || 0) === Number(value.w || 0);
      return Number(s.w) === Number(value.w) && Number(s.r) === Number(value.r);
    };
    if (!entry || !entry.sets.some(matches)) return json(res, 400, { error: 'this does not match a set from your own logged history' });
    const post = {
      id: crypto.randomBytes(9).toString('base64url'),
      authorId: user.id, authorName: user.name,
      exId, exName: String(body.exName || '').trim().slice(0, 60) || exId, mode, value, sourceDate,
      note: String(body.note || '').trim().slice(0, 140) || null,
      createdAt: Date.now(),
      comments: []
    };
    social.wall.push(post);
    saveSocial();
    json(res, 200, { ok: true, id: post.id });
  },

  // body: { id, text } — id is the Wall post, not a comment id. A flat list, no replies/likes:
  // this is meant to be a quick "nice work" / "how many reps did that leave you" thread, not a
  // forum.
  'POST /api/social/wall/comment': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const text = String(body.text || '').trim().slice(0, 300);
    if (!text) return json(res, 400, { error: 'comment cannot be empty' });
    const post = social.wall.find(w => w.id === body.id);
    if (!post) return json(res, 404, { error: 'no such post' });
    post.comments = post.comments || [];
    const comment = { id: crypto.randomBytes(9).toString('base64url'), authorId: user.id, authorName: user.name, text, createdAt: Date.now() };
    post.comments.push(comment);
    saveSocial();
    json(res, 200, { ok: true, comment });
  },

  'POST /api/social/wall/comment/delete': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const post = social.wall.find(w => w.id === body.postId);
    if (!post) return json(res, 404, { error: 'no such post' });
    const comment = (post.comments || []).find(c => c.id === body.commentId);
    if (!comment) return json(res, 404, { error: 'no such comment' });
    if (comment.authorId !== user.id && !isAdmin(user)) return json(res, 403, { error: 'forbidden' });
    post.comments = post.comments.filter(c => c.id !== body.commentId);
    saveSocial();
    json(res, 200, { ok: true });
  },

  'POST /api/social/wall/delete': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const post = social.wall.find(w => w.id === body.id);
    if (!post) return json(res, 404, { error: 'no such post' });
    if (post.authorId !== user.id && !isAdmin(user)) return json(res, 403, { error: 'forbidden' });
    social.wall = social.wall.filter(w => w.id !== body.id);
    saveSocial();
    json(res, 200, { ok: true });
  },

  // Trimmed member list for a trainer's "assign to..." picker — just enough to search/identify
  // someone, not the full admin detail view.
  'GET /api/trainer/members': async (req, res) => {
    if (!requireTrainer(req, res)) return;
    const members = db.users.filter(u => !u.disabled).map(u => ({ id: u.id, name: u.name }));
    json(res, 200, { members });
  },

  // Pushes one of the TRAINER'S OWN published routines straight onto a member's plan — same
  // mechanism as apply-starter-plan below: mutate the member's state file directly, bump _ts, let
  // their own device pick it up on next pullState(). Deliberately restricted to routines the
  // trainer authored themselves (not any routine in Social) to keep the blast radius of the
  // trainer role obvious and small.
  'POST /api/trainer/assign-routine': async (req, res) => {
    const trainer = requireTrainer(req, res); if (!trainer) return;
    const body = await readBody(req);
    const post = social.routines.find(r => r.id === body.routineId);
    if (!post) return json(res, 404, { error: 'no such routine' });
    if (post.authorId !== trainer.id) return json(res, 403, { error: 'you can only assign routines you published yourself' });
    const member = db.users.find(x => x.id === body.memberId);
    if (!member) return json(res, 404, { error: 'no such member' });
    const S = readState(member.id);
    if (!S) return json(res, 400, { error: 'member has never synced — nothing to assign to yet' });
    S.customEx = S.customEx || [];
    (post.customExDefs || []).forEach(def => { if (!S.customEx.some(x => x.id === def.id)) S.customEx.push(def); });
    const routine = { id: crypto.randomBytes(9).toString('base64url'), name: post.name, emoji: post.emoji, ex: JSON.parse(JSON.stringify(post.ex)) };
    if (post.prog) routine.prog = post.prog;
    S.routines = [...(S.routines || []), routine];
    S._ts = Date.now();
    atomicWrite(stateFile(member.id), JSON.stringify(S));
    json(res, 200, { ok: true, routineId: routine.id });
  },

  // Same as assign-routine, but for a whole Program: every embedded routine lands in the
  // member's S.routines with a fresh id, then one new S.programs entry groups them — so the
  // member gets the whole plan, not loose routines they'd have to group themselves.
  'POST /api/trainer/assign-program': async (req, res) => {
    const trainer = requireTrainer(req, res); if (!trainer) return;
    const body = await readBody(req);
    const post = social.programs.find(p => p.id === body.programId);
    if (!post) return json(res, 404, { error: 'no such program' });
    if (post.authorId !== trainer.id) return json(res, 403, { error: 'you can only assign programs you published yourself' });
    const member = db.users.find(x => x.id === body.memberId);
    if (!member) return json(res, 404, { error: 'no such member' });
    const S = readState(member.id);
    if (!S) return json(res, 400, { error: 'member has never synced — nothing to assign to yet' });
    S.customEx = S.customEx || [];
    const routineIds = [];
    for (const r of post.routines) {
      (r.customExDefs || []).forEach(def => { if (!S.customEx.some(x => x.id === def.id)) S.customEx.push(def); });
      const routine = { id: crypto.randomBytes(9).toString('base64url'), name: r.name, emoji: r.emoji, ex: JSON.parse(JSON.stringify(r.ex)) };
      if (r.prog) routine.prog = r.prog;
      routineIds.push(routine.id);
      S.routines = [...(S.routines || []), routine];
    }
    S.programs = [...(S.programs || []), { id: crypto.randomBytes(9).toString('base64url'), name: post.name, emoji: post.emoji, routineIds }];
    S._ts = Date.now();
    atomicWrite(stateFile(member.id), JSON.stringify(S));
    json(res, 200, { ok: true });
  },

  /* ---------- AI Coach ---------- */
  // Routes live in coach/routes.js and are handed the helpers above rather than importing
  // them: they are closures over db and SECRET, and passing them in keeps that module free of
  // a cycle. Every one of them is inert while the feature is unconfigured.
  ...coachRoutes({ json, readBody, readSession, requireAdmin })
};

/* ---------- Coach: boot recovery, notifications, scheduled reviews ---------- */
// A job that was running when the process died is not coming back; say so rather than leaving
// a spinner that never resolves.
coachJobs.recoverOnBoot();
// A ready proposal is the one Coach event worth a notification. Failures and "nothing to
// change" stay silent on purpose (FR-38/E4).
coachJobs.setProposalHook((uid, pending) => {
  const n = (pending?.changes || []).length;
  if (!n) return;
  sendPush(uid, {
    title: 'Tu Coach ha estado leyendo',
    body: n === 1 ? '1 sugerencia tras esta semana' : `${n} sugerencias tras esta semana`,
    tag: 'coach-proposal', url: '#/coach'
  });
});
startCadence({ users: () => db.users, userNow });

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const key = req.method + ' ' + url.pathname;
  const handler = routes[key];
  if (!handler) return json(res, 404, { error: 'not found' });
  try { await handler(req, res); }
  catch (e) {
    console.error(key, e);
    if (!res.headersSent) json(res, 500, { error: 'server error' });
  }
}).listen(PORT, () => console.log(`gym-api on :${PORT} (rpID=${RP_ID}, origin=${ORIGIN})`));
