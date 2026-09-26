// Copyright (C) 2026 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* Guided routines — "Entrena con 2J": official 2J routines, trainers' own copies, collections.
 *
 * Same arrangement as the block library (lib/blocks-store.js): global, trainer/admin-authored
 * data in its own file (DATA/guided.json), never in a member's synced state. The official seed
 * is the versioned api/lib/guided-official.json (scripts/build-official-routines.mjs), read from
 * the release on every boot — nothing is copied, so a redeploy never duplicates anything and an
 * admin's edits (stored as an overlay keyed by id) are never overwritten by a new seed.
 *
 * A guided routine is an ordinary routine (flat `ex` + `blocks` labels) plus catalogue
 * metadata. Starting it copies it into the member's live session; assigning it copies it into
 * the member's plan (POST /api/trainer/member-routine) — nothing ever links back to the master.
 *
 * Nothing here is sensitive, but only signed-in people read it (catalogue for members), only
 * trainers keep personal routines (their own, invisible to others) and only admins change the
 * official catalogue or its collections.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { validateAgainst2JProtocol, routineFacts, blockTypesOf, ROUTINE_CATEGORIES, PART_ROLES, CURATED_TAGS, BADGES,
  GOALS, LEVELS, PROTOCOL_VERSION } from './protocol/index.js';
import { lookup, sanitizeEntries } from './blocks-store.js';
import { sanitizeRoutineBlocks } from './plan-meta.js';

const require_ = createRequire(import.meta.url);
const SEED = require_('./guided-official.json');
const DATA = process.env.DATA_DIR || '/data';
const FILE = () => path.join(process.env.DATA_DIR || DATA, 'guided.json');
export const MAX_PERSONAL = 200;
const MAX_EX = 14;
const FOCI = ['fullbody', 'lower', 'upper', 'core', 'cardio'];
const STYLES = ['start', 'tabata', 'hiit', 'circuit', 'interval', 'mobility', 'express', 'core', 'mixed'];

let cache = null;
function load() {
  if (cache) return cache;
  let s = {};
  try { s = JSON.parse(fs.readFileSync(FILE(), 'utf8')); } catch { /* absent = nothing customised yet */ }
  const obj = v => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  cache = { v: 1, overrides: obj(s.overrides), officialCustom: Array.isArray(s.officialCustom) ? s.officialCustom : [],
    personal: Array.isArray(s.personal) ? s.personal : [], collections: { overrides: obj(s.collections?.overrides), custom: Array.isArray(s.collections?.custom) ? s.collections.custom : [] } };
  return cache;
}
function save() {
  const f = FILE(), tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cache));
  fs.renameSync(tmp, f);
}
export function resetCache() { cache = null; }

const seedById = new Map(SEED.routines.map(r => [r.id, r]));
const seedCollById = new Map(SEED.collections.map(c => [c.id, c]));
export const seedInfo = () => ({ protocolVersion: SEED.protocolVersion, seedVersion: SEED.seedVersion, count: SEED.routines.length, collections: SEED.collections.length });
const now = () => new Date().toISOString();
const newId = p => p + crypto.randomBytes(8).toString('base64url');
const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const int = (v, lo, hi) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null; };

// The admin's merchandising layer (featured/order/badge/active) never changes the content.
const CURATION = ['active', 'featured', 'order', 'badge'];
function officialList() {
  const s = load();
  const fromSeed = SEED.routines.map(r => {
    const o = s.overrides[r.id];
    if (!o) return r;
    const base = o.routine ? { ...o.routine, id: r.id, official: true, seedVersion: r.seedVersion, publishedAt: r.publishedAt, seedChanged: (o.seedVersion || 0) < r.seedVersion } : r;
    const out = { ...base };
    for (const k of CURATION) if (k in o) out[k] = o[k];
    return out;
  });
  return [...fromSeed, ...s.officialCustom];
}
function collectionList() {
  const s = load();
  const fromSeed = SEED.collections.map(c => ({ ...c, ...(s.collections.overrides[c.id] || {}), id: c.id }));
  return [...fromSeed, ...s.collections.custom].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/** What one person sees. Members: active official routines and collections. Trainers: + their
 *  own routines. Admins: everything, inactive included (flagged). */
export function listFor(user, { trainer = false, admin = false } = {}) {
  const s = load();
  const routines = officialList().filter(r => admin || r.active !== false);
  const visible = new Set(routines.map(r => r.id));
  const collections = collectionList().filter(c => admin || c.active !== false)
    .map(c => ({ ...c, routineIds: (c.routineIds || []).filter(id => visible.has(id)) }));
  const mine = trainer ? s.personal.filter(r => r.createdBy === user.id) : [];
  return { routines, collections, mine };
}
export function find(id, user) {
  if (!id) return null;
  const off = officialList().find(r => r.id === id);
  if (off) return off;
  const p = load().personal.find(r => r.id === id);
  return p && user && p.createdBy === user.id ? p : null;
}

/** Whitelist a routine coming from a client; duration/equipment/tags are always recomputed. */
export function sanitize(input, customDefs = []) {
  const r = input && typeof input === 'object' ? input : {};
  const customIds = new Set((customDefs || []).map(d => d.id));
  const raw = Array.isArray(r.ex) ? r.ex.slice(0, MAX_EX) : [];
  const ex = [];
  raw.forEach(e => {
    const [clean] = sanitizeEntries([e], customIds, 1);
    if (!clean) return;
    if (typeof e.blk === 'string' && e.blk) clean.blk = e.blk.slice(0, 24);
    ex.push(clean);
  });
  const roles = new Map((Array.isArray(r.blocks) ? r.blocks : []).map(b => [b?.iid, PART_ROLES.includes(b?.role) ? b.role : 'main']));
  const blocks = sanitizeRoutineBlocks(r.blocks, ex).map(b => ({ ...b, role: roles.get(b.iid) || 'main' }));
  const curated = (Array.isArray(r.curatedTags) ? r.curatedTags : []).filter(t => CURATED_TAGS.includes(t));
  const out = {
    name: str(r.name, 70) || null,
    subtitle: str(r.subtitle, 70) || null,
    description: str(r.description, 400) || null,
    category: ROUTINE_CATEGORIES.includes(r.category) ? r.category : 'circuit',
    goal: GOALS.includes(r.goal) ? r.goal : 'general',
    level: LEVELS.includes(r.level) ? r.level : 'intermediate',
    focus: FOCI.includes(r.focus) ? r.focus : 'fullbody',
    ex, blocks,
  };
  const facts = routineFacts(out, lookup, curated);
  return { ...out, estimatedMinutes: facts.minutes, equipment: facts.equipment, tags: facts.tags, parts: facts.parts,
    customExDefs: (customDefs || []).filter(d => d && typeof d.id === 'string' && typeof d.n === 'string' && ex.some(e => e.id === d.id))
      .map(d => ({ id: d.id.slice(0, 40), n: str(d.n, 60), bp: str(d.bp || 'waist', 30) })) };
}

/** The whole routine under the 2J protocol, judged as the day it is. FAIL is never stored. */
export function check(r, { official = false, unavailableEq = [] } = {}) {
  return validateAgainst2JProtocol({ kind: 'routine', goal: r.goal, level: r.level, entries: r.ex, blockTypes: blockTypesOf(r.blocks), protocolVersion: PROTOCOL_VERSION },
    { lookup, official, unavailableEq });
}

/**
 * Create or update. Personal routines: any trainer, only the author edits. Official: admin
 * only (a seed routine edit becomes an overlay; admin-created ones live in officialCustom).
 */
export function upsert(user, admin, input, opts = {}) {
  const s = load();
  const clean = sanitize(input, input?.customExDefs);
  if (!clean.ex.length) return { error: 'una rutina guiada necesita al menos un ejercicio', status: 400 };
  if (!clean.name) return { error: 'ponle un nombre a la rutina', status: 400 };
  const existing = input?.id ? find(input.id, user) : null;
  if (input?.id && !existing) return { error: 'esa rutina no existe', status: 404 };
  const official = existing ? !!existing.official : input?.scope === 'official';
  if (official && !admin) return { error: 'solo administración puede crear o editar rutinas oficiales', status: 403 };
  if (existing && !existing.official && existing.createdBy !== user.id) return { error: 'solo el autor puede editar esta rutina', status: 403 };
  if (!existing && !official && s.personal.filter(r => r.createdBy === user.id).length >= MAX_PERSONAL) return { error: 'has llegado al máximo de rutinas propias', status: 400 };
  const v = check(clean, { official, unavailableEq: opts.unavailableEq });
  if (v.result === 'FAIL') return { error: 'la rutina no cumple el Protocolo 2J', status: 400, validation: v };
  const routine = {
    ...clean, id: existing?.id || newId(official ? 'r2jc-' : 'r2jp-'), official, active: existing ? existing.active !== false : true,
    protocolVersion: PROTOCOL_VERSION, createdBy: existing?.createdBy || user.id, createdAt: existing?.createdAt || now(), updatedAt: now(),
    validation: { result: v.result, reasons: v.issues.filter(i => i.severity === 'reason').map(i => i.code) },
    ...(existing?.copiedFrom ? { copiedFrom: existing.copiedFrom } : {}),
  };
  if (!routine.customExDefs.length) delete routine.customExDefs;
  if (official && seedById.has(routine.id)) {
    s.overrides[routine.id] = { ...(s.overrides[routine.id] || {}), routine, seedVersion: seedById.get(routine.id).seedVersion, by: user.id, at: now() };
  } else if (official) {
    if (!existing) routine.publishedAt = now().slice(0, 10);
    const i = s.officialCustom.findIndex(r => r.id === routine.id);
    if (i >= 0) s.officialCustom[i] = { ...s.officialCustom[i], ...routine }; else s.officialCustom.push(routine);
  } else {
    const i = s.personal.findIndex(r => r.id === routine.id);
    if (i >= 0) s.personal[i] = routine; else s.personal.push(routine);
  }
  save();
  return { routine: find(routine.id, user), validation: v };
}

/** Official or own → a new personal routine of this trainer. The master is untouched. */
export function duplicate(user, id) {
  const src = find(id, user);
  if (!src) return { error: 'esa rutina no existe', status: 404 };
  const s = load();
  if (s.personal.filter(r => r.createdBy === user.id).length >= MAX_PERSONAL) return { error: 'has llegado al máximo de rutinas propias', status: 400 };
  const copy = JSON.parse(JSON.stringify(src));
  for (const k of ['seedVersion', 'seedChanged', 'featured', 'order', 'badge', 'publishedAt', 'evidence']) delete copy[k];
  Object.assign(copy, { id: newId('r2jp-'), official: false, active: true, createdBy: user.id, createdAt: now(), updatedAt: now(), copiedFrom: src.id });
  s.personal.push(copy);
  save();
  return { routine: copy };
}

export function setActive(user, admin, id, active) {
  const s = load();
  const r = find(id, user);
  if (!r) return { error: 'esa rutina no existe', status: 404 };
  if (r.official) {
    if (!admin) return { error: 'solo administración puede activar o desactivar rutinas oficiales', status: 403 };
    if (seedById.has(id)) s.overrides[id] = { ...(s.overrides[id] || {}), active: !!active, by: user.id, at: now() };
    else { const c = s.officialCustom.find(x => x.id === id); c.active = !!active; c.updatedAt = now(); }
  } else {
    const p = s.personal.find(x => x.id === id); p.active = !!active; p.updatedAt = now();
  }
  save();
  return { routine: find(id, user) };
}

export function remove(user, admin, id) {
  const s = load();
  const r = find(id, user);
  if (!r) return { error: 'esa rutina no existe', status: 404 };
  if (r.official) {
    if (!admin) return { error: 'solo administración puede borrar rutinas oficiales', status: 403 };
    if (seedById.has(id)) return { error: 'las rutinas oficiales de la biblioteca base se desactivan, no se borran', status: 400 };
    s.officialCustom = s.officialCustom.filter(x => x.id !== id);
  } else {
    s.personal = s.personal.filter(x => x.id !== id);
  }
  save();
  return { ok: true };
}

/** Editorial curation of an official routine: featured (order in the hero), order, badge. */
export function curate(user, id, patch = {}) {
  const s = load();
  const r = officialList().find(x => x.id === id);
  if (!r) return { error: 'esa rutina no existe', status: 404 };
  const o = {};
  if ('featured' in patch) o.featured = patch.featured ? int(patch.featured, 1, 99) : null;
  if ('order' in patch) o.order = patch.order == null ? null : int(patch.order, 0, 9999);
  if ('badge' in patch) o.badge = BADGES.includes(patch.badge) ? patch.badge : null;
  if (seedById.has(id)) s.overrides[id] = { ...(s.overrides[id] || {}), ...o, by: user.id, at: now() };
  else Object.assign(s.officialCustom.find(x => x.id === id), o, { updatedAt: now() });
  save();
  return { routine: officialList().find(x => x.id === id) };
}

/** Collections: admin creates, edits, orders, (de)activates and fills them. Nothing more. */
export function saveCollection(user, input = {}) {
  const s = load();
  const known = new Set(officialList().map(r => r.id));
  const c = {
    name: str(input.name, 60) || null,
    description: str(input.description, 200) || null,
    style: STYLES.includes(input.style) ? input.style : 'start',
    order: int(input.order, 0, 999) ?? 0,
    active: input.active !== false,
    routineIds: [...new Set((Array.isArray(input.routineIds) ? input.routineIds : []).filter(id => known.has(id)))].slice(0, 60),
  };
  if (!c.name) return { error: 'ponle un nombre a la colección', status: 400 };
  if (input.id && seedCollById.has(input.id)) s.collections.overrides[input.id] = { ...c, by: user.id, at: now() };
  else if (input.id) {
    const i = s.collections.custom.findIndex(x => x.id === input.id);
    if (i < 0) return { error: 'esa colección no existe', status: 404 };
    s.collections.custom[i] = { ...s.collections.custom[i], ...c };
  } else s.collections.custom.push({ ...c, id: newId('c2jc-') });
  save();
  return { collections: collectionList() };
}

/** Compact official routines for a model: prefer curated routines, built from official blocks. */
export function compatibleRoutines({ goal, level, max = 10, unavailableEq = [] } = {}) {
  const lv = LEVELS.includes(level) ? level : 'intermediate';
  const bad = new Set(unavailableEq);
  const order = { beginner: ['beginner'], intermediate: ['intermediate', 'beginner'], advanced: ['advanced', 'intermediate'] }[lv];
  return officialList().filter(r => r.active !== false && (r.goal === goal || r.category === 'mobility') && order.includes(r.level))
    .filter(r => !(r.equipment || []).some(q => bad.has(q)))
    .slice(0, max)
    .map(r => ({ id: r.id, name: r.name, category: r.category, level: r.level, minutes: r.estimatedMinutes,
      blocks: (r.blocks || []).map(b => b.src).filter(x => typeof x === 'string' && x.startsWith('off-')) }));
}
