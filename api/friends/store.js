/* Amigos (friends) data store — a request graph plus one regenerable invite code per user, in
   its own data/friends.json rather than db.json. Same module-level-cache + atomicWrite-the-
   whole-object shape as server.js's own social.json / api/coach/config.js's coach.json.

   A friendship has no row of its own: it is just an accepted request. "Are we friends?" and
   "is there a pending request?" are both answered by looking at the one requests array. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA = process.env.DATA_DIR || '/data';
const FILE = path.join(DATA, 'friends.json');

const store = { codes: [], requests: [] };
try {
  const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  store.codes = Array.isArray(parsed.codes) ? parsed.codes : [];
  store.requests = Array.isArray(parsed.requests) ? parsed.requests : [];
} catch { /* first boot — no file yet */ }

function atomicWrite(file, content) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}
function save() { atomicWrite(FILE, JSON.stringify(store, null, 2)); }

function newCode() {
  let code;
  do { code = crypto.randomBytes(6).toString('base64url'); } while (store.codes.some(c => c.code === code));
  return code;
}

// One live code per user — generating a new one retires the old one, same "only one active
// link" shape as server.js's admin recovery links (db.recoveries).
export function codeFor(userId) {
  let entry = store.codes.find(c => c.userId === userId);
  if (!entry) { entry = { userId, code: newCode(), createdAt: Date.now() }; store.codes.push(entry); save(); }
  return entry.code;
}
export function resetCode(userId) {
  const code = newCode();
  const entry = store.codes.find(c => c.userId === userId);
  if (entry) entry.code = code; else store.codes.push({ userId, code, createdAt: Date.now() });
  save();
  return code;
}
export function userIdForCode(code) {
  const entry = store.codes.find(c => c.code === code);
  return entry ? entry.userId : null;
}

// Only a pending or accepted request blocks sending a new one — a declined request is left in
// place as history but doesn't stop either side from trying again later.
export function activeStatusBetween(aId, bId) {
  return store.requests.find(r =>
    (r.status === 'pending' || r.status === 'accepted') &&
    ((r.fromId === aId && r.toId === bId) || (r.fromId === bId && r.toId === aId))
  ) || null;
}
export function friendIdsOf(userId) {
  return store.requests
    .filter(r => r.status === 'accepted' && (r.fromId === userId || r.toId === userId))
    .map(r => (r.fromId === userId ? r.toId : r.fromId));
}
export function incomingOf(userId) {
  return store.requests.filter(r => r.toId === userId && r.status === 'pending');
}
export function outgoingOf(userId) {
  return store.requests.filter(r => r.fromId === userId && r.status === 'pending');
}
export function createRequest(fromId, toId) {
  const req = { id: crypto.randomBytes(9).toString('base64url'), fromId, toId, status: 'pending', createdAt: Date.now(), respondedAt: null };
  store.requests.push(req);
  save();
  return req;
}
export function findRequest(id) {
  return store.requests.find(r => r.id === id) || null;
}
export function respond(id, status) {
  const req = store.requests.find(r => r.id === id);
  if (!req) return null;
  req.status = status;
  req.respondedAt = Date.now();
  save();
  return req;
}
export function removeFriendship(aId, bId) {
  const before = store.requests.length;
  store.requests = store.requests.filter(r =>
    !(r.status === 'accepted' && ((r.fromId === aId && r.toId === bId) || (r.fromId === bId && r.toId === aId)))
  );
  if (store.requests.length !== before) save();
}
