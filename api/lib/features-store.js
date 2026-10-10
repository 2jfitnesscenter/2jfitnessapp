// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* App features the ADMIN can switch on or off for the whole gym ("Funciones de la app").
 *
 * Global, admin-authored configuration: DATA/features.json, outside every member's synced state (like
 * news.json / gym-profile.json), so it never races Sync V2. Only real modules are listed — not every
 * button. A feature that is absent from the file is ON, so a missing or older file keeps today's
 * behaviour for every user. A member can only ever narrow what the admin leaves on (their own
 * preferences live in their own state); nothing here can be re-enabled from the client.
 *
 * The same keys exist in frontend/src/lib/features.js (a test keeps the two lists identical).
 */
import fs from 'node:fs';
import path from 'node:path';

const FILE = () => path.join(process.env.DATA_DIR || '/data', 'features.json');

export const FEATURE_KEYS = [
  'coach', 'suggestions', 'effort', 'volume', 'train2j', 'health', 'bioimpedance', 'recovery',
  'bodyweight', 'social', 'chat', 'friends', 'challenges', 'activity', 'timeline', 'premium',
];

let cache = null;
function load() {
  if (cache) return cache;
  let s = {};
  try { s = JSON.parse(fs.readFileSync(FILE(), 'utf8')); } catch { /* absent = everything on */ }
  const off = new Set(Array.isArray(s.off) ? s.off.filter(k => FEATURE_KEYS.includes(k)) : []);
  cache = { off, updatedAt: Number(s.updatedAt) || 0 };
  return cache;
}
function save() {
  const f = FILE(), tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ v: 1, off: [...cache.off].sort(), updatedAt: cache.updatedAt }));
  fs.renameSync(tmp, f);
}
export function resetCache() { cache = null; }

/** Every feature with its current state: { coach: true, social: false, … }. Absent = on. */
export function all() {
  const { off } = load();
  return Object.fromEntries(FEATURE_KEYS.map(k => [k, !off.has(k)]));
}
export const updatedAt = () => load().updatedAt;
export const isOn = key => !load().off.has(key);

/** patch = { key: boolean, … } — unknown keys or non-boolean values refuse the whole change. */
export function set(patch, now = Date.now()) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !Object.keys(patch).length)
    return { error: 'no hay cambios que aplicar', status: 400 };
  for (const [k, v] of Object.entries(patch)) {
    if (!FEATURE_KEYS.includes(k)) return { error: 'función desconocida: ' + k, status: 400 };
    if (typeof v !== 'boolean') return { error: 'valor no válido para ' + k, status: 400 };
  }
  const s = load();
  for (const [k, v] of Object.entries(patch)) { if (v) s.off.delete(k); else s.off.add(k); }
  s.updatedAt = now;
  save();
  return { features: all(), updatedAt: s.updatedAt };
}
