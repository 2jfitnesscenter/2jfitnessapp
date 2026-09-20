/* Bunker (gym-floor kiosk) data — two very different lifetimes in one module:
 *
 * PERSISTENT (data/bunker.json, same module-cache + atomicWrite shape as friends/store.js):
 * check-in PINs (one per member, resettable) and admin kiosk codes (one per trainer/admin,
 * generated once and never reset — see routes.js for why), plus the room's own display
 * settings (column count, rest-over sound, header text).
 *
 * EPHEMERAL (in-memory, never written to disk): who is actually checked into the Bunker right
 * now and what their card on the room dashboard should show. This is deliberately NOT part of
 * a member's persisted S — it is TV-display state, gone the moment they finish or the process
 * restarts, the same way api/server.js's own `presence` map (the "training now" admin tile)
 * never survives a restart either.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA = process.env.DATA_DIR || '/data';
const FILE = path.join(DATA, 'bunker.json');

const DEFAULT_SETTINGS = {
  columns: 4,               // 'auto' | 2 | 3 | 4 | 6
  header: '2J Fitness Center',
  enableRestEndBeep: true,      // a tone when an athlete's rest countdown reaches zero
  highlightFinishedRest: true,  // a pulsing highlight on that athlete's own card, same moment
  hideWeightsInPublicView: false, // the room dashboard shows exercise + set only, no kg, when on
  autoLockSec: 60,           // how long the individual panel sits idle before it locks itself
};
const store = { pins: [], adminCodes: [], roomKey: null, settings: { ...DEFAULT_SETTINGS } };
try {
  const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  store.pins = Array.isArray(parsed.pins) ? parsed.pins : [];
  store.adminCodes = Array.isArray(parsed.adminCodes) ? parsed.adminCodes : [];
  store.roomKey = typeof parsed.roomKey === 'string' ? parsed.roomKey : null;
  store.settings = { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) };
} catch { /* first boot — no file yet */ }

function atomicWrite(file, content) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}
function save() { atomicWrite(FILE, JSON.stringify(store, null, 2)); }

function newPin() {
  let pin;
  do { pin = String(crypto.randomInt(0, 10000)).padStart(4, '0'); } while (store.pins.some(p => p.pin === pin));
  return pin;
}
// One live PIN per member — generating a new one retires the old one, same "only one active
// code" shape friends/store.js's own codeFor/resetCode already use for the friend-invite link.
export function pinFor(userId) {
  let entry = store.pins.find(p => p.userId === userId);
  if (!entry) { entry = { userId, pin: newPin(), updatedAt: Date.now() }; store.pins.push(entry); save(); }
  return entry.pin;
}
export function resetPin(userId) {
  const pin = newPin();
  const entry = store.pins.find(p => p.userId === userId);
  if (entry) { entry.pin = pin; entry.updatedAt = Date.now(); } else store.pins.push({ userId, pin, updatedAt: Date.now() });
  save();
  return pin;
}
export function userIdForPin(pin) {
  const entry = store.pins.find(p => p.pin === pin);
  return entry ? entry.userId : null;
}

// A trainer/admin's own kiosk-unlock code — generated once on first read and never reset
// through any exposed endpoint, matching the owner's own spec ("cada uno el suyo y es fijo").
// Re-issuing it would mean editing data/bunker.json by hand, the same "break glass" tier as
// server.js's own secret file.
function newAdminCode() {
  let code;
  do { code = String(crypto.randomInt(0, 1000000)).padStart(6, '0'); } while (store.adminCodes.some(c => c.code === code));
  return code;
}
export function adminCodeFor(userId) {
  let entry = store.adminCodes.find(c => c.userId === userId);
  if (!entry) { entry = { userId, code: newAdminCode(), createdAt: Date.now() }; store.adminCodes.push(entry); save(); }
  return entry.code;
}
export function userIdForAdminCode(code) {
  const entry = store.adminCodes.find(c => c.code === code);
  return entry ? entry.userId : null;
}

// The single room-pairing key behind /bunker/launch?token=... — one shared screen's worth of
// "this device is the gym's own kiosk" for now (see routes.js's own comment on why this is
// deliberately not a per-screen registry). Lazily generated on first read, same shape as the
// PIN/admin-code generators above; resettable, unlike the admin code, since a leaked launch
// link is a much smaller blast radius (it only opens the public kiosk view) but still worth
// being able to rotate.
function newRoomKey() { return crypto.randomBytes(18).toString('base64url'); }
export function getRoomKey() {
  if (!store.roomKey) { store.roomKey = newRoomKey(); save(); }
  return store.roomKey;
}
export function resetRoomKey() {
  store.roomKey = newRoomKey();
  save();
  return store.roomKey;
}
export function verifyRoomKey(key) { return !!key && key === store.roomKey; }

export function getSettings() { return store.settings; }
export function setSettings(patch) {
  store.settings = { ...store.settings, ...patch };
  save();
  return store.settings;
}

/* ---------- live sessions (ephemeral — never persisted) ---------- */
// uid -> { uid, name, checkinAt, exId, exName, setIdx, setsTotal, restEndsAt, paused,
//          pausedLeftSec, lastActivityAt }
const sessions = new Map();
const IDLE_TTL = 15 * 60000; // a session nobody has touched in 15 minutes is treated as abandoned

export function startSession(uid, name) {
  const s = {
    uid, name, checkinAt: Date.now(), exId: null, exName: null, setIdx: 0, setsTotal: 0,
    restEndsAt: null, paused: false, pausedLeftSec: null, lastActivityAt: Date.now(),
  };
  sessions.set(uid, s);
  return s;
}
export function getSession(uid) { return sessions.get(uid) || null; }
export function touchSession(uid, patch) {
  const s = sessions.get(uid);
  if (!s) return null;
  Object.assign(s, patch, { lastActivityAt: Date.now() });
  return s;
}
// Freezes/thaws the rest countdown only — an admin catching a member who stepped away without
// pausing their own phone. Pausing banks however many seconds were left so resuming picks up
// exactly where it stopped, instead of the countdown silently continuing to run out unseen.
export function pauseSession(uid) {
  const s = sessions.get(uid);
  if (!s || s.paused) return s;
  s.paused = true;
  s.pausedLeftSec = s.restEndsAt ? Math.max(0, Math.round((s.restEndsAt - Date.now()) / 1000)) : null;
  s.restEndsAt = null;
  s.lastActivityAt = Date.now();
  return s;
}
export function resumeSession(uid) {
  const s = sessions.get(uid);
  if (!s || !s.paused) return s;
  s.paused = false;
  s.restEndsAt = s.pausedLeftSec ? Date.now() + s.pausedLeftSec * 1000 : null;
  s.pausedLeftSec = null;
  s.lastActivityAt = Date.now();
  return s;
}
export function endSession(uid) { sessions.delete(uid); }
export function listSessions() {
  const now = Date.now();
  for (const [uid, s] of sessions) if (now - s.lastActivityAt > IDLE_TTL) sessions.delete(uid);
  return [...sessions.values()].sort((a, b) => a.checkinAt - b.checkinAt);
}
