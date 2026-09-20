/* 2jfitness-api — passkey (WebAuthn) auth + per-user state storage for 2J Fitness Center
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
import { trainerAIRoutes } from './coach/trainer-routes.js';
import { scanBioimpedanceImage } from './lib/measurements-scan.js';
import { scanRoutineDocument } from './lib/routine-scan.js';
import { scanMachineImage } from './lib/machine-scan.js';
import { readState, writeState } from './lib/state-store.js';
import { startCadence } from './coach/cadence.js';
import { friendsRoutes } from './friends/routes.js';
import { chatRoutes } from './chat/routes.js';
import { bunkerRoutes } from './bunker/routes.js';
import * as stravaConfig from './strava/config.js';
import { stravaRoutes } from './strava/routes.js';
import * as whoopConfig from './whoop/config.js';
import { whoopRoutes } from './whoop/routes.js';

const PORT = +(process.env.PORT || 3000);
const DATA = process.env.DATA_DIR || '/data';
const RP_ID = process.env.RP_ID || 'localhost';
const ORIGIN = process.env.ORIGIN || 'http://localhost:8080';
const RP_NAME = process.env.RP_NAME || '2J Fitness Center';
// Admin dashboard (issue): admins are matched by uid; INVITE_ONLY gates new signups behind a
// code the admin generates. Both default off so a fresh self-hosted instance stays open.
const ADMIN_UIDS = (process.env.ADMIN_UIDS || '').split(',').map(s => s.trim()).filter(Boolean);
const INVITE_ONLY = /^(1|true|yes|on)$/i.test(process.env.INVITE_ONLY || '');
// 90 days keeps someone who trains a few times a week permanently signed in without a stolen
// cookie staying good for a year. Overridable because a family instance and one on the open
// internet don't want the same number. Only affects cookies minted from now on — the expiry is
// baked into each cookie when it's issued, so lowering this never cuts an existing session short.
const SESSION_DAYS = Math.max(1, +(process.env.SESSION_DAYS || 90) || 90);
// A phone photo of a printed report comfortably clears the old 5MB ceiling once base64-encoded
// (~33% larger than the raw file) — raised for every route rather than adding a per-route
// override, matching this app's existing "single household's gym" trust level (see jobs.js's own
// framing) rather than treating a self-hosted single-tenant instance like public-internet SaaS.
const MAX_BODY = 12 * 1024 * 1024;
const MAX_SCAN_BYTES = 8 * 1024 * 1024;
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
db.recoveryRequests = db.recoveryRequests || [];
// Scanned-machine → library-exercise links (frontend/src/lib/machine-scan.js) — gym-wide, not
// per-member: it's the same physical machine for every socio who scans it, so one member's
// pick benefits everyone's next scan. Keyed by a normalised form of the AI's own recognised
// name (see machine-scan.js's norm()) since there's no physical id printed on the equipment
// itself to key off instead. { key, exId, name, updatedAt }.
db.machineAliases = db.machineAliases || [];
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
// Amigos add-by-username needs a short, unique handle — display names aren't unique and never
// were. Derived from the name (accents stripped, lowercased, non-alphanumerics dropped) with a
// numeric suffix on collision; editable later from Perfil (POST /api/me/username) for anyone who
// wants a nicer one.
function slugifyUsername(name) {
  return String(name || 'user').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '').slice(0, 20) || 'user';
}
function generateUsername(name) {
  const base = slugifyUsername(name);
  let candidate = base, i = 0;
  while (db.users.some(u => u.username === candidate)) { i++; candidate = base + i; }
  return candidate;
}
// One-time backfill for accounts created before usernames existed.
if (db.users.some(u => !u.username)) {
  db.users.forEach(u => { if (!u.username) u.username = generateUsername(u.name); });
  saveDb();
}
// Gym-wide exercise blacklist — ids the owner has hidden from every member's search/picker
// (equipment this gym doesn't have, movements they'd rather not offer). Not a deletion: a
// hidden id still resolves fine for anyone who already has it logged or in a routine.
const hiddenExFile = path.join(DATA, 'hidden-exercises.json');
let hiddenEx = [];
try { hiddenEx = JSON.parse(fs.readFileSync(hiddenExFile, 'utf8')); if (!Array.isArray(hiddenEx)) hiddenEx = []; } catch {}
function saveHiddenEx() { atomicWrite(hiddenExFile, JSON.stringify(hiddenEx)); }

// state-<uid>.json (the member's own workout history, body-weight log and measurements) is
// encrypted at rest — readState/writeState live in lib/state-store.js, the one place that
// knows the on-disk format, so nothing here parses it as plain JSON directly.

// Social: routines and programs members publish for each other (and trainers publish
// separately), plus the Wall of real logged PRs. Shared across every user, unlike
// state-<uid>.json — same module-level cache + atomicWrite-the-whole-object shape as hiddenEx
// above, just with content many different users contribute to instead of only the admin.
const socialFile = path.join(DATA, 'social.json');
let social = { routines: [], programs: [], wall: [], challenges: [], goals: [], topics: [], board: [] };
try {
  const parsed = JSON.parse(fs.readFileSync(socialFile, 'utf8'));
  social.routines = Array.isArray(parsed.routines) ? parsed.routines : [];
  social.programs = Array.isArray(parsed.programs) ? parsed.programs : [];
  // Wall now doubles as "Marcas": every post predating the public/private toggle was shared
  // under the old always-public behaviour, so it defaults `public` to true rather than silently
  // hiding things members already chose to share.
  social.wall = (Array.isArray(parsed.wall) ? parsed.wall : []).map(w => ({ public: true, ...w }));
  social.challenges = Array.isArray(parsed.challenges) ? parsed.challenges : [];
  social.goals = Array.isArray(parsed.goals) ? parsed.goals : [];
  social.topics = Array.isArray(parsed.topics) ? parsed.topics : [];
  social.board = Array.isArray(parsed.board) ? parsed.board : [];
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
// Duplicated (not imported) from frontend/src/lib/history.js activeWeek/effectiveRoutineId — tiny pure helpers, not worth sharing across the two runtimes.
function activeWeek(S) {
  const p = S.activeProgramId && (S.programs || []).find(x => x.id === S.activeProgramId);
  return p ? (p.week || {}) : (S.week || {});
}
function effectiveRoutineId(S, iso) {
  const ov = S.dayPlan?.[iso];
  if (ov === 'rest') return null;
  if (ov && S.routines?.some(r => r.id === ov)) return ov;
  const wd = new Date(iso + 'T12:00:00').getDay();
  return activeWeek(S)[wd] || null;
}

// ---------- challenge/goal progress (Social's "Desafíos y Metas") ----------
// Computed fresh from each participant's own workouts every time a challenge/goal is read,
// never stored — the workout log is already the source of truth, and a stored running total
// would just be one more thing to keep in sync with it. Same "duplicate the tiny pure helper
// instead of importing the frontend module" precedent as activeWeek/effectiveRoutineId above.
function workoutsInRange(S, from, to) {
  return (S.workouts || []).filter(w => w.d && w.d >= from && w.d <= to);
}
// Sets/reps/volume for one exercise, within a date range, same "done && not warmup" inclusion
// rule as frontend/src/lib/history.js's workoutVolume (a drop set still counts, a warmup never does).
function exerciseTotals(S, exId, from, to) {
  let sets = 0, reps = 0, volume = 0;
  workoutsInRange(S, from, to).forEach(w => (w.entries || []).forEach(e => {
    if (e.id !== exId) return;
    (e.sets || []).forEach(s => {
      if (!s.done || s.type === 'warmup') return;
      sets++; reps += (s.r || 0); volume += (s.w || 0) * (s.r || 0);
    });
  }));
  return { sets, reps, volume };
}
// A challenge participant's single progress number, whatever its metric is.
function challengeProgress(ch, S) {
  if (!S) return 0;
  if (ch.type === 'frequency') return workoutsInRange(S, ch.startDate, ch.endDate).length;
  const t = exerciseTotals(S, ch.exId, ch.startDate, ch.endDate);
  return t[ch.metric] || 0;
}
// Best weight ever logged for one exercise — same "heaviest done, non-warmup set" idea
// frontend/src/lib/history.js's bestWeightFor uses, for comparing a published exercise goal
// against what the person has actually lifted.
function bestWeightForServer(S, exId) {
  let best = 0;
  (S.workouts || []).forEach(w => (w.entries || []).forEach(e => {
    if (e.id !== exId) return;
    (e.sets || []).forEach(s => { if (s.done && s.type !== 'warmup' && s.w > best) best = s.w; });
  }));
  return best;
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
  if (!user) { json(res, 401, { error: 'no has iniciado sesión' }); return null; }
  if (!isAdmin(user)) { json(res, 403, { error: 'prohibido' }); return null; }
  return user;
}
// Guard for /api/trainer/* — resolves the caller and 401/403s if they aren't a trainer (or admin).
function requireTrainer(req, res) {
  const user = readSession(req);
  if (!user) { json(res, 401, { error: 'no has iniciado sesión' }); return null; }
  if (!isTrainer(user)) { json(res, 403, { error: 'prohibido' }); return null; }
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
    json(res, 200, {
      invite_only: INVITE_ONLY, hiddenExercises: hiddenEx, ...(coach ? { coach } : {}),
      strava: stravaConfig.isConfigured(), whoop: whoopConfig.isConfigured()
    });
  },

  'GET /api/me': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
    json(res, 200, { user: {
      id: user.id, name: user.name, username: user.username || null, created: user.created || null,
      avatar: user.avatar || null,
      admin: isAdmin(user), trainer: isTrainer(user),
      strava: !!user.stravaAuth, whoop: !!user.whoopAuth
    } });
  },

  // Lets someone pick a nicer handle than the auto-generated one — the only thing "Nombre de
  // usuario" friend-adding actually needs from them.
  'POST /api/me/username': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
    const body = await readBody(req);
    const username = String(body.username || '').trim().toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(username)) return json(res, 400, { error: 'usa 3–20 letras minúsculas, números o guiones bajos' });
    if (db.users.some(u => u.id !== user.id && u.username === username)) return json(res, 409, { error: 'ese nombre de usuario ya está en uso' });
    user.username = username;
    saveDb();
    json(res, 200, { username });
  },

  // Profile photo. body: { avatar: '<dataURL>' } to set one, or { avatar: null } to remove it.
  // Reuses the exact same private-upload storage as a routine/program cover
  // (saveUploadedImage/GET /api/social/media) — an avatar is just another opaque file id, this
  // time stored on the user record instead of on a routine, so it survives in `user` on every
  // login/GET /api/me rather than needing its own sync path.
  'POST /api/me/avatar': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
    const body = await readBody(req);
    if (body.avatar === null) {
      deleteUploadedImage(user.avatar);
      user.avatar = null;
      saveDb();
      return json(res, 200, { avatar: null });
    }
    try {
      const id = saveUploadedImage(body.avatar);
      const old = user.avatar;
      user.avatar = id;
      saveDb();
      deleteUploadedImage(old);
      json(res, 200, { avatar: id });
    } catch (e) { json(res, 400, { error: e.message }); }
  },

  'POST /api/register/options': async (req, res) => {
    const body = await readBody(req);
    const name = String(body.name || '').trim().slice(0, 60);
    if (!name) return json(res, 400, { error: 'se requiere un nombre' });
    const code = String(body.code || '').trim().toUpperCase();
    if (INVITE_ONLY && !db.invites.some(i => i.code === code && !i.usedBy && !i.revoked))
      return json(res, 403, { error: 'se necesita un código de invitación válido' });
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
    if (!c || !c.uid) return json(res, 400, { error: 'el desafío ha caducado — inténtalo de nuevo' });
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body.credential,
        expectedChallenge: c.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: false
      });
    } catch (e) { return json(res, 400, { error: 'verificación fallida: ' + e.message }); }
    if (!verification.verified) return json(res, 400, { error: 'no verificado' });
    const { credential } = verification.registrationInfo;
    if (db.creds.find(x => x.id === credential.id)) return json(res, 409, { error: 'esta credencial ya está registrada' });
    // Re-check the invite at the last moment (it may have been used/revoked since options), then burn it.
    let invite = null;
    if (INVITE_ONLY) {
      invite = db.invites.find(i => i.code === c.code && !i.usedBy && !i.revoked);
      if (!invite) return json(res, 403, { error: 'el código de invitación ya no es válido — pide uno nuevo' });
    }
    const user = { id: c.uid, name: c.name, created: new Date().toISOString(), username: generateUsername(c.name) };
    if (invite) { user.invitedBy = invite.code; invite.usedBy = user.id; invite.usedAt = user.created; }
    db.users.push(user);
    db.creds.push({
      id: credential.id, userId: user.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter || 0,
      transports: body.credential?.response?.transports || []
    });
    saveDb();
    json(res, 200, { user: {
      id: user.id, name: user.name, username: user.username || null, created: user.created || null,
      avatar: user.avatar || null,
      admin: isAdmin(user), trainer: isTrainer(user),
      strava: !!user.stravaAuth, whoop: !!user.whoopAuth
    } }, { 'Set-Cookie': sessionCookie(user) });
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
    if (!c) return json(res, 400, { error: 'el desafío ha caducado — inténtalo de nuevo' });
    const cred = db.creds.find(x => x.id === body.credential?.id);
    if (!cred) return json(res, 404, { error: 'passkey desconocida — crea un perfil primero' });
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
    } catch (e) { return json(res, 400, { error: 'verificación fallida: ' + e.message }); }
    if (!verification.verified) return json(res, 400, { error: 'no verificado' });
    cred.counter = verification.authenticationInfo.newCounter;
    saveDb();
    const user = db.users.find(u => u.id === cred.userId);
    if (!user) return json(res, 500, { error: 'falta el usuario' });
    if (user.disabled) return json(res, 403, { error: 'esta cuenta ha sido desactivada' });
    json(res, 200, { user: {
      id: user.id, name: user.name, username: user.username || null, created: user.created || null,
      avatar: user.avatar || null,
      admin: isAdmin(user), trainer: isTrainer(user),
      strava: !!user.stravaAuth, whoop: !!user.whoopAuth
    } }, { 'Set-Cookie': sessionCookie(user) });
  },

  // ---------- admin-assisted account recovery ----------
  // Passkeys have no "forgotten password" — the one gap that leaves is a member who loses
  // their only device with no synced backup (iCloud Keychain / Google Password Manager cover
  // every other case on their own). This is the deliberate alternative to adding real
  // passwords + email back into the app: a short-lived, single-use, admin-issued token that
  // lets that member register a brand-new passkey onto their EXISTING account in person at the
  // gym, instead of creating a second, empty one. Same shape as an invite code, but it grants
  // access to an existing profile rather than creating a fresh one, hence the short expiry.
  // The member-facing half of the flow above: someone locked out taps "I lost my passkey" on
  // the login screen and types their name. This never issues a recovery link itself (only an
  // admin, standing with the member or otherwise sure who they're talking to, does that via
  // POST /api/admin/user/recovery-link) — it just raises a hand. Public/unauthenticated by
  // necessity (the whole point is the caller can't sign in), and deliberately answers the same
  // way whether or not the name matches anyone, so this can't be used to probe the member list.
  'POST /api/recover/request': async (req, res) => {
    const body = await readBody(req);
    const name = String(body.name || '').trim().slice(0, 60);
    if (!name) return json(res, 400, { error: 'escribe tu nombre' });
    const matches = db.users.filter(u => !u.disabled && u.name.trim().toLowerCase() === name.toLowerCase());
    const reqRecord = {
      id: crypto.randomBytes(9).toString('base64url'),
      name, matchedUserId: matches.length === 1 ? matches[0].id : null,
      at: new Date().toISOString(), resolved: false
    };
    db.recoveryRequests.push(reqRecord);
    saveDb();
    db.users.filter(isAdmin).forEach(a => sendPush(a.id, {
      title: 'Solicitud de recuperación', body: `${name} ha perdido su passkey`,
      tag: 'recovery-request-' + reqRecord.id, url: '#/admin/members'
    }));
    json(res, 200, { ok: true });
  },

  'POST /api/recover/options': async (req, res) => {
    const body = await readBody(req);
    const token = String(body.token || '').trim().toUpperCase();
    const rec = db.recoveries.find(r => r.token === token && !r.usedAt && !r.revoked);
    if (!rec || rec.expiresAt < Date.now()) return json(res, 400, { error: 'este enlace de recuperación ya no es válido — pide uno nuevo al personal' });
    const user = db.users.find(u => u.id === rec.userId);
    if (!user) return json(res, 404, { error: 'la cuenta ya no existe' });
    if (user.disabled) return json(res, 403, { error: 'esta cuenta ha sido desactivada' });
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
    if (!c || !c.uid || !c.recoveryToken) return json(res, 400, { error: 'el desafío ha caducado — inténtalo de nuevo' });
    // Re-checked at the last moment — same reasoning as the invite-code re-check: it may have
    // been used or have expired in the seconds since the options were issued.
    const rec = db.recoveries.find(r => r.token === c.recoveryToken && !r.usedAt && !r.revoked);
    if (!rec || rec.expiresAt < Date.now()) return json(res, 400, { error: 'este enlace de recuperación ya no es válido — pide uno nuevo al personal' });
    const user = db.users.find(u => u.id === c.uid);
    if (!user) return json(res, 404, { error: 'la cuenta ya no existe' });
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body.credential,
        expectedChallenge: c.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: false
      });
    } catch (e) { return json(res, 400, { error: 'verificación fallida: ' + e.message }); }
    if (!verification.verified) return json(res, 400, { error: 'no verificado' });
    const { credential } = verification.registrationInfo;
    if (db.creds.find(x => x.id === credential.id)) return json(res, 409, { error: 'esta credencial ya está registrada' });
    db.creds.push({
      id: credential.id, userId: user.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter || 0,
      transports: body.credential?.response?.transports || []
    });
    rec.usedAt = new Date().toISOString();
    saveDb();
    json(res, 200, { user: {
      id: user.id, name: user.name, username: user.username || null, created: user.created || null,
      avatar: user.avatar || null,
      admin: isAdmin(user), trainer: isTrainer(user),
      strava: !!user.stravaAuth, whoop: !!user.whoopAuth
    } }, { 'Set-Cookie': sessionCookie(user) });
  },

  'POST /api/logout': async (req, res) => json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie }),

  // "Sign out everywhere" — bumps this user's session version, which invalidates every cookie
  // ever issued for the account, on every device, including a copy someone else walked off with.
  // The caller's own cookie is cleared here too, so the browser doing it doesn't sit on a token
  // it no longer accepts. Passkeys are untouched: signing back in works immediately.
  'POST /api/logout/all': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
    user.sv = sessionVersion(user) + 1;
    saveDb();
    json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie });
  },

  'GET /api/data': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
    json(res, 200, { state: readState(user.id) });
  },

  'PUT /api/data': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
    const body = await readBody(req);
    if (!body.state || typeof body.state !== 'object') return json(res, 400, { error: 'se requiere el estado' });
    delete body.state.active;              // the client never has authority over this field
    // A normal push still never lets the client SET `active` — but until now it also wiped
    // whatever the server already had there, because this write replaces the whole state file.
    // That silently erased a session the Bunker (or a V3.1-B handoff) had put there, the moment
    // the phone synced anything else at all (E2E finding, Bunker V3.1-B). Carry the server's own
    // current value forward instead of discarding it — not a merge of the rest of the state,
    // just this one field surviving its own deletion. A finished session already wrote `active:
    // null` (not absent) via POST /api/bunker/finish, and `null` is falsy, so this never
    // resurrects one that has already ended.
    const current = readState(user.id);
    if (current && current.active) body.state.active = current.active;
    writeState(user.id, body.state);
    json(res, 200, { ok: true, ts: body.state._ts || null });
  },

  'GET /api/push/public-key': async (req, res) => json(res, 200, { key: vapid.publicKey }),

  'POST /api/push/subscribe': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
    const body = await readBody(req);
    const sub = body.subscription;
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return json(res, 400, { error: 'suscripción no válida' });
    db.subs = db.subs.filter(s => s.endpoint !== sub.endpoint);
    db.subs.push({ userId: user.id, endpoint: sub.endpoint, keys: sub.keys, created: new Date().toISOString() });
    saveDb();
    json(res, 200, { ok: true });
  },

  'POST /api/push/unsubscribe': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
    const body = await readBody(req);
    db.subs = db.subs.filter(s => !(s.userId === user.id && s.endpoint === body.endpoint));
    saveDb();
    json(res, 200, { ok: true });
  },

  'POST /api/push/test': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
    await sendPush(user.id, { title: '2J Fitness Center', body: 'Notificación de prueba ✅ — así se ven las alertas.', tag: 'test' });
    json(res, 200, { ok: true });
  },

  'POST /api/push/rest-timer': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
    const body = await readBody(req);
    const sec = Math.max(1, Math.min(3600, Math.round(+body.seconds || 0)));
    if (!sec) return json(res, 400, { error: 'se requieren los segundos' });
    const exercise = String(body.exercise || '').slice(0, 60).trim() || null;
    scheduleRestTimer(user.id, sec, exercise);
    json(res, 200, { ok: true });
  },

  'POST /api/push/rest-timer/cancel': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
    cancelRestTimer(user.id);
    json(res, 200, { ok: true });
  },

  // Live-workout heartbeat: client pings while a workout is on screen; { active:false } drops it.
  'POST /api/activity': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
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
    if (!u) return json(res, 404, { error: 'ese usuario no existe' });
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
      // The two per-member toggles POST /api/admin/user/features can flip remotely.
      enableTrainingZones: S.enableTrainingZones !== false,
      enableRpVolumeZones: !!S.enableRpVolumeZones,
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
    if (!u) return json(res, 404, { error: 'ese usuario no existe' });
    if (body.name !== undefined) {
      const name = String(body.name).trim().slice(0, 60);
      if (!name) return json(res, 400, { error: 'se requiere un nombre' });
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
    writeState(u.id, S);
    json(res, 200, { ok: true });
  },

  // Admin/trainer switching Training zones or Weekly volume zones on or off for one member
  // remotely (AdminMembers.jsx) — the same two Settings toggles the member has themselves,
  // just reachable from the gym side for someone who'd otherwise never find or use them.
  // body: { id, enableTrainingZones?, enableRpVolumeZones? }.
  'POST /api/admin/user/features': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const u = db.users.find(x => x.id === body.id);
    if (!u) return json(res, 404, { error: 'ese usuario no existe' });
    const S = readState(u.id);
    if (!S) return json(res, 404, { error: 'este socio aún no ha sincronizado ningún dato' });
    if (typeof body.enableTrainingZones === 'boolean') S.enableTrainingZones = body.enableTrainingZones;
    if (typeof body.enableRpVolumeZones === 'boolean') S.enableRpVolumeZones = body.enableRpVolumeZones;
    S._ts = Date.now();
    writeState(u.id, S);
    json(res, 200, { ok: true, enableTrainingZones: S.enableTrainingZones !== false, enableRpVolumeZones: !!S.enableRpVolumeZones });
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
    if (!u) return json(res, 404, { error: 'ese usuario no existe' });
    const S = readState(u.id);
    if (!S) return json(res, 400, { error: 'este miembro nunca ha sincronizado — todavía no hay nada donde añadir medidas' });
    const KEYS = ['neck', 'shoulders', 'chest', 'bicepsL', 'bicepsR', 'forearmL', 'forearmR', 'waist', 'hips',
      'thighL', 'thighR', 'calfL', 'calfR', 'bodyFat', 'muscleMass', 'waterPct', 'visceralFat', 'boneMass',
      'segFatArmL', 'segFatArmR', 'segFatLegL', 'segFatLegR', 'segFatTrunk',
      'segMuscleArmL', 'segMuscleArmR', 'segMuscleLegL', 'segMuscleLegR', 'segMuscleTrunk',
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
    // Same upsert-by-date, but onto S.bodyweight (shape {d, w, t}) rather than S.measurements —
    // a bioimpedance scan prints the member's weight too, and BwSheet already writes exactly this
    // shape from the client side.
    const weight = body.weight;
    if (weight !== undefined && weight !== null && weight !== '') {
      const w = Math.round(Number(weight) * 10) / 10;
      if (Number.isFinite(w) && w > 0) {
        S.bodyweight = S.bodyweight || [];
        const ex = S.bodyweight.find(x => x.d === iso);
        if (ex) { ex.w = w; ex.t = Date.now(); } else S.bodyweight.push({ d: iso, w, t: Date.now() });
        S.bodyweight.sort((a, b) => (a.d < b.d ? -1 : 1));
        n++;
      }
    }
    if (!n) return json(res, 400, { error: 'no se han dado valores válidos' });
    S._ts = Date.now();
    writeState(u.id, S);
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
    if (!u) return json(res, 404, { error: 'ese usuario no existe' });
    const S = readState(u.id);
    if (!S) return json(res, 400, { error: 'este miembro nunca ha sincronizado — todavía no hay nada donde añadir un plan' });
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
    // Mirrors frontend/src/locales/es.js's goal labels, for the auto-created program's name.
    const GOAL_LABEL_ES = {
      hypertrophy: 'Ganar músculo', toning: 'Tonificar', fatloss: 'Perder grasa',
      power: 'Potencia', plyometrics: 'Pliometría', longevity: 'Salud y longevidad'
    };
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
    const week = {};
    days.forEach((d, i) => { week[d] = routines[i].id; });
    const program = {
      id: crypto.randomBytes(9).toString('base64url'),
      name: `Plan rápido (${GOAL_LABEL_ES[body.goal] || GOAL_LABEL_ES.longevity})`,
      emoji: 'sparkles', routineIds: routines.map(r => r.id), week
    };
    S.programs = [...(S.programs || []), program];
    S.activeProgramId = program.id;
    S._ts = Date.now();
    writeState(u.id, S);
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
    if (!id) return json(res, 400, { error: 'se requiere un id' });
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
    if (!u) return json(res, 404, { error: 'ese usuario no existe' });
    if (isAdmin(u)) return json(res, 400, { error: 'no se puede desactivar a un administrador' });
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
    if (!u) return json(res, 404, { error: 'ese usuario no existe' });
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
    if (!u) return json(res, 404, { error: 'ese usuario no existe' });
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

  // Pending "I lost my passkey" requests raised from the login screen — see POST
  // /api/recover/request above. Newest first; resolved ones drop off after being marked so this
  // never grows without bound.
  'GET /api/admin/recovery-requests': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const open = db.recoveryRequests.filter(r => !r.resolved).map(r => ({
      ...r, matchedUserName: r.matchedUserId ? (db.users.find(u => u.id === r.matchedUserId) || {}).name || null : null
    })).reverse();
    json(res, 200, { requests: open });
  },

  'POST /api/admin/recovery-requests/resolve': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const r = db.recoveryRequests.find(x => x.id === body.id);
    if (!r) return json(res, 404, { error: 'esa solicitud ya no existe' });
    r.resolved = true;
    saveDb();
    json(res, 200, { ok: true });
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
    if (!inv) return json(res, 404, { error: 'ese código no existe' });
    if (inv.usedBy) return json(res, 400, { error: 'ya se ha usado — no se puede revocar' });
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
    if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
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
    if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
    const body = await readBody(req);
    const name = String(body.name || '').trim().slice(0, 60);
    const ex = Array.isArray(body.ex) ? body.ex : null;
    if (!name || !ex || !ex.length) return json(res, 400, { error: 'una rutina necesita un nombre y al menos un ejercicio' });
    const customExDefs = Array.isArray(body.customExDefs)
      ? body.customExDefs.filter(d => d && typeof d.id === 'string' && typeof d.n === 'string') : [];
    const customIds = new Set(customExDefs.map(d => d.id));
    // Every custom-exercise id the routine references has to travel with its full definition —
    // EXIDX is per-browser-tab and rebuilt from whichever user's customEx last loaded, so a
    // custom exercise id alone would resolve to "Unknown exercise" for anyone else.
    if (ex.some(e => typeof e.id === 'string' && e.id.startsWith('c') && !customIds.has(e.id)))
      return json(res, 400, { error: 'faltan definiciones de uno o más ejercicios personalizados en esta rutina' });
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
    if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
    const body = await readBody(req);
    const stars = Math.round(Number(body.stars));
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) return json(res, 400, { error: 'las estrellas deben ser de 1 a 5' });
    const post = social.routines.find(r => r.id === body.id);
    if (!post) return json(res, 404, { error: 'esa rutina no existe' });
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
    if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
    const body = await readBody(req);
    const post = social.routines.find(r => r.id === body.id);
    if (!post) return json(res, 404, { error: 'esa rutina no existe' });
    if (post.authorId !== user.id && !isAdmin(user)) return json(res, 403, { error: 'prohibido' });
    deleteUploadedImage(post.image);
    social.routines = social.routines.filter(r => r.id !== body.id);
    saveSocial();
    json(res, 200, { ok: true });
  },

  // A routine's/program's image lives on disk, not in social.json — DATA is a private volume
  // nginx never sees, so this is the one place an uploaded file gets served back.
  'GET /api/social/media': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
    const id = String(new URL(req.url, 'http://x').searchParams.get('id') || '').replace(/[^a-zA-Z0-9_.-]/g, '');
    if (!id) return json(res, 400, { error: 'se requiere un id' });
    try {
      const buf = fs.readFileSync(path.join(uploadsDir, id));
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=31536000, immutable' });
      res.end(buf);
    } catch { json(res, 404, { error: 'esa imagen no existe' }); }
  },

  // A routine's or program's own cover photo, set from Plan (not tied to publishing it to
  // Social — see frontend/src/sheets.jsx's glyphPicker) — any signed-in member, body: { image }
  // a data URL. Nothing here tracks which routine/program a file belongs to (the client stores
  // just the returned id on the routine/program itself, same as every other opaque S field), so
  // an orphaned cover from a since-deleted routine is never cleaned up — an accepted trade-off
  // for a small single-gym instance rather than building real reference-counted GC for it.
  'POST /api/media/upload': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
    const body = await readBody(req);
    try { json(res, 200, { id: saveUploadedImage(body.image) }); }
    catch (e) { json(res, 400, { error: e.message }); }
  },

  // Bioimpedance-report scan (photo or PDF) → structured values, for Admin's BioimpedanceSheet
  // and Measurements' own "scan a report" sheet. Any signed-in user, member or admin — this only
  // reads the file and hands back numbers, it never writes anyone's data itself. Saving still
  // goes through the existing paths (POST /api/admin/user/measurements, or the client's own
  // update() for a member's own profile) once the caller has reviewed the extracted values.
  // body: { file: '<dataURL>' }.
  'POST /api/measurements/scan': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
    const body = await readBody(req);
    const dataUrl = typeof body.file === 'string' ? body.file : '';
    const m = dataUrl.match(/^data:([a-zA-Z0-9.+/-]+);base64,([\s\S]+)$/);
    if (!m) return json(res, 400, { error: 'archivo no válido' });
    const [, mimeType, b64] = m;
    if (!/^image\//.test(mimeType) && mimeType !== 'application/pdf') {
      return json(res, 400, { error: 'solo se aceptan imágenes o un PDF' });
    }
    if (Buffer.byteLength(b64, 'base64') > MAX_SCAN_BYTES) return json(res, 400, { error: 'el archivo es demasiado grande' });
    const r = await scanBioimpedanceImage({ data: b64, mimeType });
    if (!r.ok) return json(res, 400, { error: r.error });
    json(res, 200, { values: r.values });
  },

  // Printed/handwritten/photographed routine scan (photo or PDF) → raw exercise text, for the
  // member's own "scan a routine" flow and the trainer panel's "scan a routine for this member".
  // Same shape as /api/measurements/scan: any signed-in user, reads the file and hands back what
  // it read, never writes anyone's plan itself — matching exercise names to real ids and saving
  // happens client-side (frontend/src/lib/routine-scan.js's matchScannedRoutine(), then either
  // mergePlan() for the member's own routines or the existing trainer/member-routine endpoints).
  // body: { file: '<dataURL>' }.
  'POST /api/routines/scan': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
    const body = await readBody(req);
    const dataUrl = typeof body.file === 'string' ? body.file : '';
    const m = dataUrl.match(/^data:([a-zA-Z0-9.+/-]+);base64,([\s\S]+)$/);
    if (!m) return json(res, 400, { error: 'archivo no válido' });
    const [, mimeType, b64] = m;
    if (!/^image\//.test(mimeType) && mimeType !== 'application/pdf') {
      return json(res, 400, { error: 'solo se aceptan imágenes o un PDF' });
    }
    if (Buffer.byteLength(b64, 'base64') > MAX_SCAN_BYTES) return json(res, 400, { error: 'el archivo es demasiado grande' });
    const r = await scanRoutineDocument({ data: b64, mimeType });
    if (!r.ok) return json(res, 400, { error: r.error });
    json(res, 200, { routine: r.value });
  },

  // Single gym-machine/exercise photo → a raw name (no OCR, one Gemini vision call), for the
  // member-facing "scan this machine" flow. Same shape/permissions as the two scans above —
  // any signed-in user, reads the file and hands back what it read; matching against the
  // library, the alias lookup below and any save both happen client-side.
  // body: { file: '<dataURL>' }.
  'POST /api/exercises/scan-machine': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
    const body = await readBody(req);
    const dataUrl = typeof body.file === 'string' ? body.file : '';
    const m = dataUrl.match(/^data:([a-zA-Z0-9.+/-]+);base64,([\s\S]+)$/);
    if (!m) return json(res, 400, { error: 'archivo no válido' });
    const [, mimeType, b64] = m;
    if (!/^image\//.test(mimeType) && mimeType !== 'application/pdf') {
      return json(res, 400, { error: 'solo se aceptan imágenes o un PDF' });
    }
    if (Buffer.byteLength(b64, 'base64') > MAX_SCAN_BYTES) return json(res, 400, { error: 'el archivo es demasiado grande' });
    const r = await scanMachineImage({ data: b64, mimeType });
    if (!r.ok) return json(res, 400, { error: r.error });
    json(res, 200, { name: r.value.name, nameEn: r.value.nameEn });
  },

  // Gym-wide machine→exercise alias lookup/save (db.machineAliases above) — any signed-in
  // member can read or write one, since the whole point is that the first member to resolve a
  // given machine saves everyone else the same picker next time.
  'GET /api/exercises/alias': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
    const key = String(new URL(req.url, 'http://x').searchParams.get('key') || '').trim();
    if (!key) return json(res, 400, { error: 'falta key' });
    const alias = db.machineAliases.find(a => a.key === key);
    json(res, 200, { exId: alias ? alias.exId : null });
  },
  'POST /api/exercises/alias': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
    const body = await readBody(req);
    const key = String(body.key || '').trim();
    const exId = String(body.exId || '').trim();
    const name = String(body.name || '').trim().slice(0, 100);
    if (!key || !exId) return json(res, 400, { error: 'faltan datos' });
    const existing = db.machineAliases.find(a => a.key === key);
    if (existing) { existing.exId = exId; existing.name = name; existing.updatedAt = Date.now(); }
    else db.machineAliases.push({ key, exId, name, updatedAt: Date.now() });
    saveDb();
    json(res, 200, { ok: true });
  },

  /* ---------- Social: Programs (a named group of routines, published as one unit) ---------- */
  'GET /api/social/programs': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
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
    if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
    const body = await readBody(req);
    const name = String(body.name || '').trim().slice(0, 60);
    const routinesIn = Array.isArray(body.routines) ? body.routines : null;
    if (!name || !routinesIn || !routinesIn.length) return json(res, 400, { error: 'un programa necesita un nombre y al menos una rutina' });
    const routines = [];
    for (const r of routinesIn) {
      const rname = String(r?.name || '').trim().slice(0, 60);
      const ex = Array.isArray(r?.ex) ? r.ex : null;
      if (!rname || !ex || !ex.length) return json(res, 400, { error: 'cada rutina necesita un nombre y al menos un ejercicio' });
      const customExDefs = Array.isArray(r.customExDefs)
        ? r.customExDefs.filter(d => d && typeof d.id === 'string' && typeof d.n === 'string') : [];
      const customIds = new Set(customExDefs.map(d => d.id));
      if (ex.some(e => typeof e.id === 'string' && e.id.startsWith('c') && !customIds.has(e.id)))
        return json(res, 400, { error: 'faltan definiciones de uno o más ejercicios personalizados en este programa' });
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
    if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
    const body = await readBody(req);
    const stars = Math.round(Number(body.stars));
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) return json(res, 400, { error: 'las estrellas deben ser de 1 a 5' });
    const post = social.programs.find(p => p.id === body.id);
    if (!post) return json(res, 404, { error: 'ese programa no existe' });
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
    if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
    const body = await readBody(req);
    const post = social.programs.find(p => p.id === body.id);
    if (!post) return json(res, 404, { error: 'ese programa no existe' });
    if (post.authorId !== user.id && !isAdmin(user)) return json(res, 403, { error: 'prohibido' });
    deleteUploadedImage(post.image);
    social.programs = social.programs.filter(p => p.id !== body.id);
    saveSocial();
    json(res, 200, { ok: true });
  },

  // "Marcas": a caller sees every public mark plus their own regardless of visibility — privacy
  // is a personal choice, so even staff's moderation rights (delete-by-id, no browsing) don't
  // bypass it here.
  'GET /api/social/wall': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
    const visible = social.wall.filter(w => w.public || w.authorId === user.id);
    json(res, 200, { wall: [...visible].sort((a, b) => b.createdAt - a.createdAt) });
  },

  // body: { exId, exName, mode, value, sourceDate, note?, public? } — re-checked against the
  // CALLER's own logged history below, so this can never be a made-up number: the picker in the
  // app is a convenience, this check is the actual guarantee. `public` defaults to false: a Marca
  // is private unless the member deliberately shares it.
  'POST /api/social/wall': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
    const body = await readBody(req);
    const exId = String(body.exId || '');
    const mode = ['reps', 'time', 'cardio'].includes(body.mode) ? body.mode : null;
    const sourceDate = String(body.sourceDate || '');
    const value = body.value && typeof body.value === 'object' ? body.value : null;
    if (!exId || !mode || !value || !/^\d{4}-\d{2}-\d{2}$/.test(sourceDate))
      return json(res, 400, { error: 'se necesitan un ejercicio, modo, valor y fecha válidos' });
    const S = readState(user.id);
    if (!S) return json(res, 400, { error: 'todavía no hay nada sincronizado' });
    const workout = (S.workouts || []).find(w => w.d === sourceDate);
    const entry = workout && workout.entries.find(e => e.id === exId);
    const matches = s => {
      if (!s.done) return false;
      if (mode === 'cardio') return Number(s.min) === Number(value.min) && Number(s.speed) === Number(value.speed);
      if (mode === 'time') return Number(s.sec) === Number(value.sec) && Number(s.w || 0) === Number(value.w || 0);
      return Number(s.w) === Number(value.w) && Number(s.r) === Number(value.r);
    };
    if (!entry || !entry.sets.some(matches)) return json(res, 400, { error: 'esto no coincide con ninguna serie de tu propio historial registrado' });
    const post = {
      id: crypto.randomBytes(9).toString('base64url'),
      authorId: user.id, authorName: user.name, authorKind: isTrainer(user) ? 'trainer' : 'member',
      exId, exName: String(body.exName || '').trim().slice(0, 60) || exId, mode, value, sourceDate,
      note: String(body.note || '').trim().slice(0, 140) || null,
      public: !!body.public,
      createdAt: Date.now(),
      comments: []
    };
    social.wall.push(post);
    saveSocial();
    json(res, 200, { ok: true, id: post.id });
  },

  'POST /api/social/wall/visibility': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
    const body = await readBody(req);
    const post = social.wall.find(w => w.id === body.id);
    if (!post) return json(res, 404, { error: 'esa marca ya no existe' });
    if (post.authorId !== user.id && !isAdmin(user)) return json(res, 403, { error: 'prohibido' });
    post.public = !!body.public;
    saveSocial();
    json(res, 200, { ok: true, public: post.public });
  },

  // body: { id, text } — id is the Wall post, not a comment id. A flat list, no replies/likes:
  // this is meant to be a quick "nice work" / "how many reps did that leave you" thread, not a
  // forum.
  'POST /api/social/wall/comment': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
    const body = await readBody(req);
    const text = String(body.text || '').trim().slice(0, 300);
    if (!text) return json(res, 400, { error: 'el comentario no puede estar vacío' });
    const post = social.wall.find(w => w.id === body.id);
    if (!post) return json(res, 404, { error: 'esa publicación no existe' });
    post.comments = post.comments || [];
    const comment = { id: crypto.randomBytes(9).toString('base64url'), authorId: user.id, authorName: user.name, authorKind: isTrainer(user) ? 'trainer' : 'member', text, createdAt: Date.now() };
    post.comments.push(comment);
    saveSocial();
    json(res, 200, { ok: true, comment });
  },

  'POST /api/social/wall/comment/delete': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
    const body = await readBody(req);
    const post = social.wall.find(w => w.id === body.postId);
    if (!post) return json(res, 404, { error: 'esa publicación no existe' });
    const comment = (post.comments || []).find(c => c.id === body.commentId);
    if (!comment) return json(res, 404, { error: 'ese comentario no existe' });
    if (comment.authorId !== user.id && !isAdmin(user)) return json(res, 403, { error: 'prohibido' });
    post.comments = post.comments.filter(c => c.id !== body.commentId);
    saveSocial();
    json(res, 200, { ok: true });
  },

  'POST /api/social/wall/delete': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
    const body = await readBody(req);
    const post = social.wall.find(w => w.id === body.id);
    if (!post) return json(res, 404, { error: 'esa publicación no existe' });
    if (post.authorId !== user.id && !isAdmin(user)) return json(res, 403, { error: 'prohibido' });
    social.wall = social.wall.filter(w => w.id !== body.id);
    saveSocial();
    json(res, 200, { ok: true });
  },

  /* ---------- Muro ("Wall" chat): members open topics and comment on each other's. Gym-wide,
     flat comments same shape as the Wall's own — moderation is wider than Wall's though: any
     trainer or admin can remove any topic/comment, not just its own author. ---------- */

  'GET /api/social/topics': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
    json(res, 200, { topics: [...social.topics].sort((a, b) => b.createdAt - a.createdAt) });
  },

  'POST /api/social/topics': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
    const body = await readBody(req);
    const title = String(body.title || '').trim().slice(0, 80);
    const text = String(body.text || '').trim().slice(0, 1000);
    if (!title || !text) return json(res, 400, { error: 'el tema necesita un título y un mensaje' });
    const topic = {
      id: crypto.randomBytes(9).toString('base64url'),
      authorId: user.id, authorName: user.name, authorKind: isTrainer(user) ? 'trainer' : 'member',
      title, text, createdAt: Date.now(), comments: []
    };
    social.topics.push(topic);
    saveSocial();
    json(res, 200, { ok: true, id: topic.id });
  },

  'POST /api/social/topics/comment': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
    const body = await readBody(req);
    const text = String(body.text || '').trim().slice(0, 300);
    if (!text) return json(res, 400, { error: 'el comentario no puede estar vacío' });
    const topic = social.topics.find(t => t.id === body.id);
    if (!topic) return json(res, 404, { error: 'ese tema ya no existe' });
    topic.comments = topic.comments || [];
    const comment = { id: crypto.randomBytes(9).toString('base64url'), authorId: user.id, authorName: user.name, authorKind: isTrainer(user) ? 'trainer' : 'member', text, createdAt: Date.now() };
    topic.comments.push(comment);
    saveSocial();
    json(res, 200, { ok: true, comment });
  },

  'POST /api/social/topics/comment/delete': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
    const body = await readBody(req);
    const topic = social.topics.find(t => t.id === body.topicId);
    if (!topic) return json(res, 404, { error: 'ese tema ya no existe' });
    const comment = (topic.comments || []).find(c => c.id === body.commentId);
    if (!comment) return json(res, 404, { error: 'ese comentario no existe' });
    if (comment.authorId !== user.id && !isAdmin(user) && !isTrainer(user)) return json(res, 403, { error: 'prohibido' });
    topic.comments = topic.comments.filter(c => c.id !== body.commentId);
    saveSocial();
    json(res, 200, { ok: true });
  },

  'POST /api/social/topics/delete': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
    const body = await readBody(req);
    const topic = social.topics.find(t => t.id === body.id);
    if (!topic) return json(res, 404, { error: 'ese tema ya no existe' });
    if (topic.authorId !== user.id && !isAdmin(user) && !isTrainer(user)) return json(res, 403, { error: 'prohibido' });
    social.topics = social.topics.filter(t => t.id !== body.id);
    saveSocial();
    json(res, 200, { ok: true });
  },

  /* ---------- Tablón de Entrenadores: news/tests trainers post for the gym to read. Read-only
     by default — a trainer/admin can flip `commentsEnabled` on their own post, and only then does
     the comment endpoint below accept anything, enforced server-side, not just hidden in the UI.
     ---------- */

  'GET /api/social/board': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
    json(res, 200, { board: [...social.board].sort((a, b) => b.createdAt - a.createdAt) });
  },

  'POST /api/social/board': async (req, res) => {
    const trainer = requireTrainer(req, res); if (!trainer) return;
    const body = await readBody(req);
    const title = String(body.title || '').trim().slice(0, 80);
    const text = String(body.text || '').trim().slice(0, 2000);
    if (!title || !text) return json(res, 400, { error: 'el aviso necesita un título y un mensaje' });
    const post = {
      id: crypto.randomBytes(9).toString('base64url'),
      authorId: trainer.id, authorName: trainer.name, authorKind: isTrainer(trainer) ? 'trainer' : 'member',
      title, text, commentsEnabled: false, createdAt: Date.now(), comments: []
    };
    social.board.push(post);
    saveSocial();
    json(res, 200, { ok: true, id: post.id });
  },

  'POST /api/social/board/toggle-comments': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
    if (!isTrainer(user) && !isAdmin(user)) return json(res, 403, { error: 'prohibido' });
    const body = await readBody(req);
    const post = social.board.find(b => b.id === body.id);
    if (!post) return json(res, 404, { error: 'ese aviso ya no existe' });
    post.commentsEnabled = !!body.commentsEnabled;
    saveSocial();
    json(res, 200, { ok: true, commentsEnabled: post.commentsEnabled });
  },

  'POST /api/social/board/comment': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
    const body = await readBody(req);
    const post = social.board.find(b => b.id === body.id);
    if (!post) return json(res, 404, { error: 'ese aviso ya no existe' });
    if (!post.commentsEnabled) return json(res, 403, { error: 'los comentarios están desactivados en este aviso' });
    const text = String(body.text || '').trim().slice(0, 300);
    if (!text) return json(res, 400, { error: 'el comentario no puede estar vacío' });
    post.comments = post.comments || [];
    const comment = { id: crypto.randomBytes(9).toString('base64url'), authorId: user.id, authorName: user.name, authorKind: isTrainer(user) ? 'trainer' : 'member', text, createdAt: Date.now() };
    post.comments.push(comment);
    saveSocial();
    json(res, 200, { ok: true, comment });
  },

  'POST /api/social/board/comment/delete': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
    const body = await readBody(req);
    const post = social.board.find(b => b.id === body.postId);
    if (!post) return json(res, 404, { error: 'ese aviso ya no existe' });
    const comment = (post.comments || []).find(c => c.id === body.commentId);
    if (!comment) return json(res, 404, { error: 'ese comentario no existe' });
    if (comment.authorId !== user.id && !isAdmin(user) && !isTrainer(user)) return json(res, 403, { error: 'prohibido' });
    post.comments = post.comments.filter(c => c.id !== body.commentId);
    saveSocial();
    json(res, 200, { ok: true });
  },

  'POST /api/social/board/delete': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
    const body = await readBody(req);
    const post = social.board.find(b => b.id === body.id);
    if (!post) return json(res, 404, { error: 'ese aviso ya no existe' });
    if (post.authorId !== user.id && !isAdmin(user)) return json(res, 403, { error: 'prohibido' });
    social.board = social.board.filter(b => b.id !== body.id);
    saveSocial();
    json(res, 200, { ok: true });
  },

  /* ---------- Challenges & Goals ("Desafíos y Metas") ---------- */
  // A challenge is gym-wide and trainer-authored (same requireTrainer gate as assigning a
  // routine directly) — members opt in, and progress is never typed in by hand, only ever
  // computed fresh from what they already logged (challengeProgress above). A goal is the
  // opposite direction: personal and private by default (mirrors S.targetW's bodyweight goal,
  // now generalised to a target weight on any exercise too) — publishing one is the one
  // deliberate act that puts a single number of theirs in front of the rest of the gym.

  'GET /api/social/challenges': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
    const today = new Date().toISOString().slice(0, 10);
    const list = social.challenges.map(c => ({
      id: c.id, name: c.name, description: c.description, type: c.type,
      targetWorkouts: c.targetWorkouts || null, exId: c.exId || null, exName: c.exName || null,
      metric: c.metric || null, targetValue: c.targetValue || null,
      startDate: c.startDate, endDate: c.endDate, authorName: c.authorName, createdAt: c.createdAt,
      participantCount: c.participants.length, joined: c.participants.includes(user.id),
      active: c.endDate >= today
    })).sort((a, b) => b.createdAt - a.createdAt);
    json(res, 200, { challenges: list });
  },

  // Full leaderboard — reads every participant's own state file, same cross-user read the
  // trainer/admin routes already rely on (readState), just fanned out over a whole list.
  'GET /api/social/challenges/detail': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
    const id = new URL(req.url, 'http://x').searchParams.get('id') || '';
    const c = social.challenges.find(x => x.id === id);
    if (!c) return json(res, 404, { error: 'ese desafío ya no existe' });
    const leaderboard = c.participants.map(uid => {
      const u = db.users.find(x => x.id === uid);
      return { userId: uid, userName: u ? u.name : 'Socio', value: challengeProgress(c, readState(uid)) };
    }).sort((a, b) => b.value - a.value);
    json(res, 200, {
      challenge: {
        id: c.id, name: c.name, description: c.description, type: c.type,
        targetWorkouts: c.targetWorkouts || null, exId: c.exId || null, exName: c.exName || null,
        metric: c.metric || null, targetValue: c.targetValue || null,
        startDate: c.startDate, endDate: c.endDate, authorId: c.authorId, authorName: c.authorName
      },
      leaderboard, joined: c.participants.includes(user.id)
    });
  },

  'POST /api/social/challenges/new': async (req, res) => {
    const trainer = requireTrainer(req, res); if (!trainer) return;
    const body = await readBody(req);
    const name = String(body.name || '').trim().slice(0, 60);
    const description = String(body.description || '').trim().slice(0, 300);
    const type = ['frequency', 'exercise'].includes(body.type) ? body.type : null;
    const startDate = String(body.startDate || '');
    const endDate = String(body.endDate || '');
    if (!name || !type || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < startDate)
      return json(res, 400, { error: 'faltan datos o las fechas no son válidas' });
    const ch = {
      id: crypto.randomBytes(9).toString('base64url'), name, description, type, startDate, endDate,
      authorId: trainer.id, authorName: trainer.name, authorKind: isTrainer(trainer) ? 'trainer' : 'member',
      createdAt: Date.now(), participants: []
    };
    if (type === 'frequency') {
      const n = Math.round(+body.targetWorkouts);
      if (!(n > 0)) return json(res, 400, { error: 'indica cuántos entrenos hay que completar' });
      ch.targetWorkouts = Math.min(60, n);
    } else {
      const exId = String(body.exId || '');
      const metric = ['sets', 'reps', 'volume'].includes(body.metric) ? body.metric : null;
      const targetValue = +body.targetValue;
      if (!exId || !metric || !(targetValue > 0)) return json(res, 400, { error: 'indica el ejercicio, la métrica y el objetivo' });
      ch.exId = exId; ch.exName = String(body.exName || '').trim().slice(0, 60) || exId; ch.metric = metric; ch.targetValue = targetValue;
    }
    social.challenges.push(ch);
    saveSocial();
    json(res, 200, { ok: true, id: ch.id });
  },

  'POST /api/social/challenges/join': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
    const body = await readBody(req);
    const c = social.challenges.find(x => x.id === body.id);
    if (!c) return json(res, 404, { error: 'ese desafío ya no existe' });
    if (!c.participants.includes(user.id)) c.participants.push(user.id);
    saveSocial();
    json(res, 200, { ok: true });
  },

  'POST /api/social/challenges/leave': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
    const body = await readBody(req);
    const c = social.challenges.find(x => x.id === body.id);
    if (!c) return json(res, 404, { error: 'ese desafío ya no existe' });
    c.participants = c.participants.filter(id => id !== user.id);
    saveSocial();
    json(res, 200, { ok: true });
  },

  'POST /api/social/challenges/delete': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
    const body = await readBody(req);
    const c = social.challenges.find(x => x.id === body.id);
    if (!c) return json(res, 404, { error: 'ese desafío ya no existe' });
    if (c.authorId !== user.id && !isAdmin(user)) return json(res, 403, { error: 'prohibido' });
    social.challenges = social.challenges.filter(x => x.id !== body.id);
    saveSocial();
    json(res, 200, { ok: true });
  },

  // Published goals only ever hold ONE number — the target — snapshotted at publish time;
  // "current" is always read live off the publisher's own state, same live-computation
  // principle as challenges, just for a party of one instead of a leaderboard.
  'GET /api/social/goals': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
    const list = social.goals.map(g => {
      const S = readState(g.userId);
      const current = !S ? 0 : g.kind === 'bodyweight'
        ? ((S.bodyweight || []).length ? S.bodyweight[S.bodyweight.length - 1].w : 0)
        : bestWeightForServer(S, g.exId);
      return { ...g, current, unit: S?.unit || 'kg' };
    }).sort((a, b) => b.createdAt - a.createdAt);
    json(res, 200, { goals: list });
  },

  'POST /api/social/goals/publish': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
    const body = await readBody(req);
    const kind = ['bodyweight', 'exercise'].includes(body.kind) ? body.kind : null;
    if (!kind) return json(res, 400, { error: 'tipo de meta no válido' });
    const target = +body.target;
    if (!(target > 0)) return json(res, 400, { error: 'indica un objetivo válido' });
    const exId = kind === 'exercise' ? String(body.exId || '') : null;
    if (kind === 'exercise' && !exId) return json(res, 400, { error: 'indica el ejercicio' });
    const exName = kind === 'exercise' ? (String(body.exName || '').trim().slice(0, 60) || exId) : null;
    // One published goal per person per kind (and per exercise, for exercise goals) —
    // publishing again just updates the target instead of piling up duplicates.
    let g = social.goals.find(x => x.userId === user.id && x.kind === kind && (kind !== 'exercise' || x.exId === exId));
    if (g) { g.target = target; g.updatedAt = Date.now(); }
    else {
      g = {
        id: crypto.randomBytes(9).toString('base64url'), userId: user.id, userName: user.name,
        authorKind: isTrainer(user) ? 'trainer' : 'member', kind, exId, exName, target, createdAt: Date.now()
      };
      social.goals.push(g);
    }
    saveSocial();
    json(res, 200, { ok: true, id: g.id });
  },

  'POST /api/social/goals/unpublish': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
    const body = await readBody(req);
    const g = social.goals.find(x => x.id === body.id);
    if (!g) return json(res, 200, { ok: true });
    if (g.userId !== user.id && !isAdmin(user)) return json(res, 403, { error: 'prohibido' });
    social.goals = social.goals.filter(x => x.id !== body.id);
    saveSocial();
    json(res, 200, { ok: true });
  },

  // Trimmed member list for a trainer's "assign to..." picker — just enough to search/identify
  // someone, not the full admin detail view.
  'GET /api/trainer/members': async (req, res) => {
    if (!requireTrainer(req, res)) return;
    const members = db.users.filter(u => !u.disabled).map(u => ({ id: u.id, name: u.name, avatar: u.avatar || null }));
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
    if (!post) return json(res, 404, { error: 'esa rutina no existe' });
    if (post.authorId !== trainer.id) return json(res, 403, { error: 'solo puedes asignar rutinas que hayas publicado tú mismo' });
    const member = db.users.find(x => x.id === body.memberId);
    if (!member) return json(res, 404, { error: 'ese miembro no existe' });
    const S = readState(member.id);
    if (!S) return json(res, 400, { error: 'este miembro nunca ha sincronizado — todavía no hay nada donde asignar' });
    S.customEx = S.customEx || [];
    (post.customExDefs || []).forEach(def => { if (!S.customEx.some(x => x.id === def.id)) S.customEx.push(def); });
    const routine = { id: crypto.randomBytes(9).toString('base64url'), name: post.name, emoji: post.emoji, ex: JSON.parse(JSON.stringify(post.ex)) };
    if (post.prog) routine.prog = post.prog;
    S.routines = [...(S.routines || []), routine];
    S._ts = Date.now();
    writeState(member.id, S);
    json(res, 200, { ok: true, routineId: routine.id });
  },

  // Same as assign-routine, but for a whole Program: every embedded routine lands in the
  // member's S.routines with a fresh id, then one new S.programs entry groups them — so the
  // member gets the whole plan, not loose routines they'd have to group themselves.
  'POST /api/trainer/assign-program': async (req, res) => {
    const trainer = requireTrainer(req, res); if (!trainer) return;
    const body = await readBody(req);
    const post = social.programs.find(p => p.id === body.programId);
    if (!post) return json(res, 404, { error: 'ese programa no existe' });
    if (post.authorId !== trainer.id) return json(res, 403, { error: 'solo puedes asignar programas que hayas publicado tú mismo' });
    const member = db.users.find(x => x.id === body.memberId);
    if (!member) return json(res, 404, { error: 'ese miembro no existe' });
    const S = readState(member.id);
    if (!S) return json(res, 400, { error: 'este miembro nunca ha sincronizado — todavía no hay nada donde asignar' });
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
    writeState(member.id, S);
    json(res, 200, { ok: true });
  },

  /* ---------- Trainer panel (desktop): build/edit a member's plan directly ---------- */
  // Same "mutate the member's state file directly" mechanism as assign-routine/assign-program
  // above, but for the desktop trainer panel: the trainer supplies the routine/program content
  // themselves instead of pointing at something already published to Social. Read-only here on
  // purpose — never the member's workout history or body weight, same reduced blast radius
  // GET /api/trainer/members already keeps to.
  'GET /api/trainer/member-plan': async (req, res) => {
    if (!requireTrainer(req, res)) return;
    const memberId = new URL(req.url, 'http://x').searchParams.get('id') || '';
    const member = db.users.find(x => x.id === memberId);
    if (!member) return json(res, 404, { error: 'ese miembro no existe' });
    const S = readState(member.id);
    json(res, 200, { routines: S?.routines || [], programs: S?.programs || [] });
  },

  // body: { memberId, routineId?, name, emoji, ex, customExDefs?, prog? } — same validation as
  // POST /api/social/routines. Passing `routineId` for a routine already on that member's plan
  // replaces it in place (same id, so a program's routineIds referencing it stay valid);
  // omitting it (or passing one that doesn't match) appends a new routine instead.
  'POST /api/trainer/member-routine': async (req, res) => {
    if (!requireTrainer(req, res)) return;
    const body = await readBody(req);
    const member = db.users.find(x => x.id === body.memberId);
    if (!member) return json(res, 404, { error: 'ese miembro no existe' });
    const name = String(body.name || '').trim().slice(0, 60);
    const ex = Array.isArray(body.ex) ? body.ex : null;
    if (!name || !ex || !ex.length) return json(res, 400, { error: 'una rutina necesita un nombre y al menos un ejercicio' });
    const customExDefs = Array.isArray(body.customExDefs)
      ? body.customExDefs.filter(d => d && typeof d.id === 'string' && typeof d.n === 'string') : [];
    const customIds = new Set(customExDefs.map(d => d.id));
    if (ex.some(e => typeof e.id === 'string' && e.id.startsWith('c') && !customIds.has(e.id)))
      return json(res, 400, { error: 'faltan definiciones de uno o más ejercicios personalizados en esta rutina' });
    const S = readState(member.id);
    if (!S) return json(res, 400, { error: 'este miembro nunca ha sincronizado — todavía no hay nada donde asignar' });
    S.customEx = S.customEx || [];
    customExDefs.forEach(def => { if (!S.customEx.some(x => x.id === def.id)) S.customEx.push(def); });
    S.routines = S.routines || [];
    const existingIdx = body.routineId ? S.routines.findIndex(r => r.id === body.routineId) : -1;
    const routine = { id: existingIdx >= 0 ? body.routineId : crypto.randomBytes(9).toString('base64url'), name, emoji: String(body.emoji || 'dumbbell').slice(0, 20), ex };
    if (body.prog) routine.prog = String(body.prog).slice(0, 20);
    if (existingIdx >= 0) S.routines[existingIdx] = routine; else S.routines.push(routine);
    S._ts = Date.now();
    writeState(member.id, S);
    json(res, 200, { ok: true, routineId: routine.id });
  },

  // body: { memberId, programId?, name, emoji, routineIds, week? } — routineIds must already be
  // on this member's plan (build them with member-routine first). Unlike assign-program above,
  // `week` travels with it (weekday -> routineId), since here the trainer is scheduling it
  // directly rather than leaving that step for the member to do afterward.
  'POST /api/trainer/member-program': async (req, res) => {
    if (!requireTrainer(req, res)) return;
    const body = await readBody(req);
    const member = db.users.find(x => x.id === body.memberId);
    if (!member) return json(res, 404, { error: 'ese miembro no existe' });
    const name = String(body.name || '').trim().slice(0, 60);
    const routineIds = Array.isArray(body.routineIds) ? body.routineIds : null;
    if (!name || !routineIds || !routineIds.length) return json(res, 400, { error: 'un programa necesita un nombre y al menos una rutina' });
    const S = readState(member.id);
    if (!S) return json(res, 400, { error: 'este miembro nunca ha sincronizado — todavía no hay nada donde asignar' });
    const memberRoutineIds = new Set((S.routines || []).map(r => r.id));
    if (routineIds.some(id => !memberRoutineIds.has(id))) return json(res, 400, { error: 'una de las rutinas no pertenece a este miembro' });
    const week = {};
    if (body.week && typeof body.week === 'object') {
      for (const [d, rid] of Object.entries(body.week)) { if (routineIds.includes(rid)) week[d] = rid; }
    }
    S.programs = S.programs || [];
    const existingIdx = body.programId ? S.programs.findIndex(p => p.id === body.programId) : -1;
    const program = { id: existingIdx >= 0 ? body.programId : crypto.randomBytes(9).toString('base64url'), name, emoji: String(body.emoji || 'folder').slice(0, 20), routineIds, week };
    if (existingIdx >= 0) S.programs[existingIdx] = program; else S.programs.push(program);
    S._ts = Date.now();
    writeState(member.id, S);
    json(res, 200, { ok: true, programId: program.id });
  },

  /* ---------- AI Coach ---------- */
  // Routes live in coach/routes.js and are handed the helpers above rather than importing
  // them: they are closures over db and SECRET, and passing them in keeps that module free of
  // a cycle. Every one of them is inert while the feature is unconfigured.
  ...coachRoutes({ json, readBody, readSession, requireAdmin }),

  /* ---------- IA del panel de entrenador (siempre Claude, independiente del Coach) ---------- */
  // Same factory shape as coachRoutes, but its own file (coach/trainer-ai.js) so this instance's
  // member-facing Coach and the trainer panel's "Generate with AI" can be configured, connected
  // and even enabled/disabled completely independently of each other.
  ...trainerAIRoutes({ json, readBody, requireAdmin, requireTrainer }),

  /* ---------- Amigos + chat con entrenadores ---------- */
  // Same factory shape as coachRoutes — their own data/friends.json and data/chat.json, no
  // per-member/per-trainer assignment concept to hook into (trainer status is global, see
  // isTrainer above), so chat is one shared inbox every trainer/admin can see and reply to.
  ...friendsRoutes({ json, readBody, readSession, sendPush, users: () => db.users }),
  ...chatRoutes({ json, readBody, readSession, sendPush, isTrainer, users: () => db.users }),

  /* ---------- Bunker (gym-floor kiosk) ---------- */
  // Its own data/bunker.json (PINs, admin codes, room settings) — see bunker/store.js's doc
  // comment for why the live session board itself is in-memory instead, same as `presence`
  // above. sign/verifySig are the exact functions the signed session cookie itself uses, reused
  // for the kiosk's own short-lived, narrowly-scoped tokens (never a full login).
  ...bunkerRoutes({ json, readBody, readSession, sign, verifySig, isTrainer, users: () => db.users }),

  /* ---------- connected apps: Strava (push workouts), Whoop (pull recovery) ---------- */
  ...stravaRoutes({ json, readBody, readSession, requireAdmin, saveDb, origin: ORIGIN }),
  ...whoopRoutes({ json, readBody, readSession, requireAdmin, saveDb, origin: ORIGIN })
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
  if (!handler) return json(res, 404, { error: 'no encontrado' });
  try { await handler(req, res); }
  catch (e) {
    console.error(key, e);
    if (!res.headersSent) json(res, 500, { error: 'error del servidor' });
  }
}).listen(PORT, () => console.log(`gym-api on :${PORT} (rpID=${RP_ID}, origin=${ORIGIN})`));
