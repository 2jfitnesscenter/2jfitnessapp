// Persistent, bounded notification inbox and social privacy preferences.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA = process.env.DATA_DIR || '/data';
const FILE = path.join(DATA, 'notifications.json');
const state = { items: [], privacy: {}, preferences: {} };
try {
  const disk = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  state.items = Array.isArray(disk.items) ? disk.items : [];
  state.privacy = disk.privacy && typeof disk.privacy === 'object' ? disk.privacy : {};
  state.preferences = disk.preferences && typeof disk.preferences === 'object' ? disk.preferences : {};
} catch { /* first boot */ }

function save() {
  fs.mkdirSync(DATA, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
}

// Existing routines, public marks and achievements were already explicitly shared by the member;
// keep those visible to accepted friends while using conservative friends-only scope by default.
const DEFAULT_PRIVACY = Object.freeze({ profile: 'friends', activity: 'friends', prs: true, achievements: true, routines: true, workouts: false, challenges: true });
const DEFAULT_PREFERENCES = Object.freeze({ push: false, friendRequests: true, messages: true, shares: true, challenges: true, achievements: true });
export function privacyFor(uid) { return { ...DEFAULT_PRIVACY, ...(state.privacy[uid] || {}) }; }
export function setPrivacy(uid, value) {
  const clean = privacyFor(uid);
  if ('profile' in value) clean.profile = ['friends', 'community', 'private'].includes(value.profile) ? value.profile : 'friends';
  if ('activity' in value) clean.activity = ['friends', 'community', 'nobody'].includes(value.activity) ? value.activity : 'friends';
  for (const key of ['prs', 'achievements', 'routines', 'workouts', 'challenges']) if (key in value) clean[key] = value[key] === true;
  state.privacy[uid] = clean; save(); return clean;
}
export function preferencesFor(uid) { return { ...DEFAULT_PREFERENCES, ...(state.preferences[uid] || {}) }; }
export function allows(uid, type) { const p = preferencesFor(uid); return p[categoryFor(type)] !== false; }
export function setPreferences(uid, value) {
  const clean = preferencesFor(uid);
  for (const key of Object.keys(DEFAULT_PREFERENCES)) if (key in value) clean[key] = value[key] === true;
  state.preferences[uid] = clean; save(); return clean;
}
const categoryFor = type => ({ friend_request: 'friendRequests', friend_accepted: 'friendRequests', message: 'messages', share: 'shares', challenge: 'challenges', achievement: 'achievements' })[type] || 'shares';
export function create(uid, input) {
  if (!uid || !input || !['friend_request', 'friend_accepted', 'message', 'share', 'challenge', 'achievement'].includes(input.type)) return null;
  if (!allows(uid, input.type)) return null;
  const item = {
    id: crypto.randomBytes(9).toString('base64url'), userId: uid, type: input.type,
    actor: input.actor ? { id: String(input.actor.id || '').slice(0, 80), name: String(input.actor.name || '').slice(0, 80) } : null,
    target: input.target ? { kind: String(input.target.kind || '').slice(0, 32), id: String(input.target.id || '').slice(0, 100) } : null,
    deepLink: /^\/(friends|chat(?:\/[^?#]+)?|social|notifications)(?:\?[^#]*)?$/.test(input.deepLink || '') ? input.deepLink : '/notifications',
    createdAt: Date.now(), readAt: null
  };
  state.items.push(item);
  const own = state.items.filter(x => x.userId === uid);
  const retained = new Set(own.slice(-100).map(x => x.id));
  state.items = state.items.filter(x => x.userId !== uid || retained.has(x.id)).slice(-5000);
  save(); return item;
}
export function list(uid) { return state.items.filter(x => x.userId === uid).sort((a, b) => b.createdAt - a.createdAt).map(({ userId: _privateUid, ...item }) => item); }
export function unreadCount(uid) { return state.items.reduce((n, x) => n + (x.userId === uid && !x.readAt ? 1 : 0), 0); }
export function markRead(uid, id) {
  const item = state.items.find(x => x.userId === uid && x.id === id);
  if (!item) return false;
  if (!item.readAt) { item.readAt = Date.now(); save(); }
  return true;
}
export function markAllRead(uid) {
  const now = Date.now(); let changed = false;
  for (const item of state.items) if (item.userId === uid && !item.readAt) { item.readAt = now; changed = true; }
  if (changed) save(); return changed;
}
export function markTargetRead(uid, kind, id) {
  const now = Date.now(); let changed = false;
  for (const item of state.items) if (item.userId === uid && !item.readAt && item.target?.kind === kind && item.target?.id === id) { item.readAt = now; changed = true; }
  if (changed) save(); return changed;
}
export function resetForTests() { state.items = []; state.privacy = {}; state.preferences = {}; save(); }
