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

const store = { pins: [], adminCodes: [], settings: { columns: 4, soundAlerts: true, header: '2J Fitness Center' } };
try {
  const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  store.pins = Array.isArray(parsed.pins) ? parsed.pins : [];
  store.adminCodes = Array.isArray(parsed.adminCodes) ? parsed.adminCodes : [];
  store.settings = { ...store.settings, ...(parsed.settings || {}) };
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

export function getSettings() { return store.settings; }
export function setSettings(patch) {
  store.settings = { ...store.settings, ...patch };
  save();
  return store.settings;
}

/* ---------- live sessions (ephemeral — never persisted) ---------- */
const sessions = new Map(); // uid -> { uid, name, checkinAt, exId, exName, setIdx, setsTotal, restEndsAt, lastActivityAt }
const IDLE_TTL = 15 * 60000; // a session nobody has touched in 15 minutes is treated as abandoned

export function startSession(uid, name) {
  const s = { uid, name, checkinAt: Date.now(), exId: null, exName: null, setIdx: 0, setsTotal: 0, restEndsAt: null, lastActivityAt: Date.now() };
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
export function endSession(uid) { sessions.delete(uid); }
export function listSessions() {
  const now = Date.now();
  for (const [uid, s] of sessions) if (now - s.lastActivityAt > IDLE_TTL) sessions.delete(uid);
  return [...sessions.values()].sort((a, b) => a.checkinAt - b.checkinAt);
}
