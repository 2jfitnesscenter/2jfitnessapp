/* The block library — official 2J blocks and trainers' personal blocks.
 *
 * Global, admin/trainer-authored data: it lives in its own file (DATA/blocks.json), never in
 * any member's synced state, so it cannot race Sync V2 and a member's plan never depends on it
 * (inserting a block copies its entries into the routine; see lib/protocol/blocks.js).
 *
 * The official seed is the versioned api/lib/blocks-official.json (built by
 * scripts/build-official-blocks.mjs). Seeding is idempotent by construction: nothing is copied
 * at boot, the seed is read from the release every time. What an admin changes is stored as an
 * overlay keyed by block id (edited content and/or active:false), so:
 *   - a redeploy never duplicates or overwrites an admin's customisation;
 *   - a new seed version updates every official block the admin did not touch;
 *   - an edited block keeps the admin's version and is flagged `seedChanged` when the seed moved.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { validateAgainst2JProtocol, deriveBlockMeta, PROTOCOL_VERSION, BLOCK_TYPES, GOALS, LEVELS, FOCUS, RPE_2J, sanitizeTiming } from './protocol/index.js';

const require_ = createRequire(import.meta.url);
const SEED = require_('./blocks-official.json');
const LIBRARY = new Map(require_('../coach/library.json').exercises.map(e => [e.id, e]));
export const lookup = id => LIBRARY.get(id) || null;

const DATA = process.env.DATA_DIR || '/data';
const FILE = () => path.join(process.env.DATA_DIR || DATA, 'blocks.json');
export const MAX_PERSONAL = 300;
const MAX_EX = 12;
const POLICIES = ['off', 'linear', 'greyskull', 'double', 'time', 'pct1rm'];
const ROLES = ['main', 'secondary', 'accessory', 'metabolic'];

let cache = null;
function load() {
  if (cache) return cache;
  let s = {};
  try { s = JSON.parse(fs.readFileSync(FILE(), 'utf8')); } catch { /* absent = nothing custom yet */ }
  cache = { v: 1, personal: Array.isArray(s.personal) ? s.personal : [], officialCustom: Array.isArray(s.officialCustom) ? s.officialCustom : [],
    overrides: s.overrides && typeof s.overrides === 'object' ? s.overrides : {}, favorites: s.favorites && typeof s.favorites === 'object' ? s.favorites : {} };
  return cache;
}
function save() {
  const f = FILE(), tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cache));
  fs.renameSync(tmp, f);
}
export function resetCache() { cache = null; }

const seedById = new Map(SEED.blocks.map(b => [b.id, b]));
export const seedInfo = () => ({ protocolVersion: SEED.protocolVersion, seedVersion: SEED.seedVersion, count: SEED.blocks.length });

function officialList() {
  const s = load();
  const fromSeed = SEED.blocks.map(b => {
    const o = s.overrides[b.id];
    if (!o) return b;
    const base = o.block ? { ...o.block, id: b.id, official: true, seedVersion: b.seedVersion, seedChanged: (o.seedVersion || 0) < b.seedVersion } : b;
    return o.active === false ? { ...base, active: false } : { ...base, active: true };
  });
  return [...fromSeed, ...s.officialCustom];
}

/** What one trainer sees: active official blocks (all of them for an admin) + their own. */
export function listFor(uid, admin) {
  const s = load();
  const official = officialList().filter(b => admin || b.active !== false);
  const mine = s.personal.filter(b => b.createdBy === uid);
  return { blocks: [...official, ...mine], favorites: s.favorites[uid] || [] };
}
export function find(id) {
  if (!id) return null;
  return officialList().find(b => b.id === id) || load().personal.find(b => b.id === id) || null;
}

const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const int = (v, lo, hi) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null; };

/** Whitelist a block coming from a client. Metadata that can be computed is never trusted. */
export function sanitize(input, customDefs = []) {
  const b = input && typeof input === 'object' ? input : {};
  const customIds = new Set((customDefs || []).map(d => d.id));
  const ex = (Array.isArray(b.ex) ? b.ex : []).slice(0, MAX_EX).map(e => {
    if (!e || typeof e.id !== 'string') return null;
    const id = e.id.slice(0, 40);
    if (!lookup(id) && !customIds.has(id)) return null;
    const out = { id, sets: int(e.sets, 1, 10) || 3 };
    if (e.mode === 'time') { out.mode = 'time'; out.sec = int(e.sec, 5, 600) || 45; out.weight = 0; }
    else if (e.min != null && e.speed != null && e.mode !== 'reps') { out.min = int(e.min, 1, 180) || 20; out.speed = Math.max(0, Math.min(40, Number(e.speed) || 0)); }
    else {
      out.mode = 'reps';
      out.reps = int(e.reps ?? e.targetRepsMax, 1, 100) || 10;
      const lo = int(e.targetRepsMin, 1, 100), hi = int(e.targetRepsMax, 1, 100);
      if (lo != null && hi != null && lo <= hi) { out.targetRepsMin = lo; out.targetRepsMax = hi; out.reps = hi; }
      const rm = int(e.repsMin, 1, 100); if (rm != null) out.repsMin = Math.min(rm, out.reps);
    }
    if (POLICIES.includes(e.prog)) out.prog = e.prog;
    if (Array.isArray(e.rpe)) out.rpe = e.rpe.slice(0, 10).map(Number).filter(v => RPE_2J.includes(v));
    const rest = int(e.rest, 0, 600); if (rest != null && e.rest != null) out.rest = rest;
    if (typeof e.sg === 'string' && e.sg) out.sg = e.sg.slice(0, 20);
    if (ROLES.includes(e.role)) out.role = e.role;
    if (e.note) out.note = str(e.note, 200);
    if (e.why) out.why = str(e.why, 300);
    return out;
  }).filter(Boolean);
  return {
    name: str(b.name, 60) || null,
    description: str(b.description, 300) || null,
    type: BLOCK_TYPES.includes(b.type) ? b.type : 'strength',
    goal: GOALS.includes(b.goal) ? b.goal : 'hypertrophy',
    level: LEVELS.includes(b.level) ? b.level : 'intermediate',
    focus: FOCUS.includes(b.focus) ? b.focus : null,
    variant: /^[A-D]$/.test(b.variant || '') ? b.variant : null,
    style: str(b.style, 30) || null,
    reason: str(b.reason, 300) || null,
    // Guided blocks (Constructor V2.1) keep their pacing; other types never carry one.
    ...(sanitizeTiming(b.timing, b.type) ? { timing: sanitizeTiming(b.timing, b.type) } : {}),
    ex,
    customExDefs: (customDefs || []).filter(d => d && typeof d.id === 'string' && typeof d.n === 'string' && ex.some(e => e.id === d.id))
      .map(d => ({ id: d.id.slice(0, 40), n: str(d.n, 60), bp: str(d.bp || 'waist', 30), ...(d.desc ? { desc: str(d.desc, 400) } : {}) })),
  };
}

/** Validate under the protocol; FAIL is never stored. */
export function check(b, { official = false, unavailableEq = [] } = {}) {
  const reasons = b.reason ? Object.fromEntries(['reps_outside_preferred', 'rest_outside_preferred', 'rpe10_share', 'rpe10_technical', 'redundant_pair', 'redundant_many', 'duplicate_exercise', 'superset_heavy_same', 'volume_high', 'block_too_big'].map(c => [c, b.reason])) : {};
  return validateAgainst2JProtocol({ kind: 'block', goal: b.goal, level: b.level, type: b.type, focus: b.focus, entries: b.ex, protocolVersion: PROTOCOL_VERSION, reasons },
    { lookup, official, unavailableEq });
}

const now = () => new Date().toISOString();
const newId = () => 'b' + crypto.randomBytes(8).toString('base64url');

/**
 * Create or update. Returns { block } | { error, status, validation? }.
 * Permission model (server.js requireTrainer/requireAdmin, nothing new):
 *   personal blocks — any trainer creates; only the author edits/deletes;
 *   official blocks — admin only (seed edits become an overlay; admin-created live in officialCustom).
 */
export function upsert(user, admin, input, opts = {}) {
  const s = load();
  const clean = sanitize(input, input?.customExDefs);
  if (!clean.ex.length) return { error: 'un bloque necesita al menos un ejercicio de la biblioteca', status: 400 };
  const existing = input?.id ? find(input.id) : null;
  if (input?.id && !existing) return { error: 'ese bloque no existe', status: 404 };
  const official = existing ? !!existing.official : (input?.scope === 'official');
  if (official && !admin) return { error: 'solo administración puede crear o editar bloques oficiales', status: 403 };
  if (existing && !existing.official && existing.createdBy !== user.id) return { error: 'solo el autor puede editar este bloque', status: 403 };
  if (!existing && !official && s.personal.filter(b => b.createdBy === user.id).length >= MAX_PERSONAL) return { error: 'has llegado al máximo de bloques propios', status: 400 };
  if (!official && !clean.name) return { error: 'ponle un nombre al bloque', status: 400 };

  const v = check(clean, { official, unavailableEq: opts.unavailableEq });
  if (v.result === 'FAIL') return { error: 'el bloque no cumple el Protocolo 2J', status: 400, validation: v };

  const block = {
    ...clean, id: existing?.id || newId(), official, active: existing ? existing.active !== false : true,
    protocolVersion: PROTOCOL_VERSION, createdBy: existing?.createdBy || user.id,
    createdAt: existing?.createdAt || now(), updatedAt: now(),
    validation: { result: v.result, reasons: v.issues.filter(i => i.severity === 'reason').map(i => ({ code: i.code, reason: i.reason })) },
    evidence: [...new Set(v.issues.flatMap(i => i.evidence))].sort(),
  };
  Object.assign(block, deriveBlockMeta(block, lookup));
  if (!block.customExDefs.length) delete block.customExDefs;

  if (official && seedById.has(block.id)) {
    s.overrides[block.id] = { ...(s.overrides[block.id] || {}), block: { ...block, createdBy: seedById.get(block.id).createdBy }, seedVersion: seedById.get(block.id).seedVersion, by: user.id, at: now() };
  } else if (official) {
    const i = s.officialCustom.findIndex(b => b.id === block.id);
    if (i >= 0) s.officialCustom[i] = block; else s.officialCustom.push(block);
  } else {
    const i = s.personal.findIndex(b => b.id === block.id);
    if (i >= 0) s.personal[i] = block; else s.personal.push(block);
  }
  save();
  return { block: find(block.id), validation: v };
}

/** Official or personal → a new personal block of this trainer. The master is untouched. */
export function duplicate(user, id) {
  const src = find(id);
  if (!src) return { error: 'ese bloque no existe', status: 404 };
  if (!src.official && src.createdBy !== user.id) return { error: 'ese bloque no es tuyo', status: 403 };
  const s = load();
  if (s.personal.filter(b => b.createdBy === user.id).length >= MAX_PERSONAL) return { error: 'has llegado al máximo de bloques propios', status: 400 };
  const copy = JSON.parse(JSON.stringify(src));
  Object.assign(copy, { id: newId(), official: false, active: true, createdBy: user.id, createdAt: now(), updatedAt: now(), copiedFrom: src.id });
  delete copy.seedVersion; delete copy.seedChanged;
  s.personal.push(copy);
  save();
  return { block: copy };
}

export function setActive(user, admin, id, active) {
  const s = load();
  const b = find(id);
  if (!b) return { error: 'ese bloque no existe', status: 404 };
  if (b.official) {
    if (!admin) return { error: 'solo administración puede activar o desactivar bloques oficiales', status: 403 };
    if (seedById.has(id)) s.overrides[id] = { ...(s.overrides[id] || {}), active: !!active, by: user.id, at: now() };
    else { const c = s.officialCustom.find(x => x.id === id); c.active = !!active; c.updatedAt = now(); }
  } else {
    if (b.createdBy !== user.id) return { error: 'solo el autor puede cambiar este bloque', status: 403 };
    const p = s.personal.find(x => x.id === id); p.active = !!active; p.updatedAt = now();
  }
  save();
  return { block: find(id) };
}

/** Routines that used a block keep their own copy, so deleting never breaks them. */
export function remove(user, admin, id) {
  const s = load();
  const b = find(id);
  if (!b) return { error: 'ese bloque no existe', status: 404 };
  if (b.official) {
    if (!admin) return { error: 'solo administración puede borrar bloques oficiales', status: 403 };
    if (seedById.has(id)) return { error: 'los bloques oficiales de la biblioteca base se desactivan, no se borran', status: 400 };
    s.officialCustom = s.officialCustom.filter(x => x.id !== id);
  } else {
    if (b.createdBy !== user.id) return { error: 'solo el autor puede borrar este bloque', status: 403 };
    s.personal = s.personal.filter(x => x.id !== id);
  }
  for (const k of Object.keys(s.favorites)) s.favorites[k] = s.favorites[k].filter(x => x !== id);
  save();
  return { ok: true };
}

export function favorite(user, id, on) {
  const s = load();
  const b = find(id);
  if (!b || (!b.official && b.createdBy !== user.id)) return { error: 'ese bloque no existe', status: 404 };
  const list = new Set(s.favorites[user.id] || []);
  if (on) list.add(id); else list.delete(id);
  s.favorites[user.id] = [...list].slice(0, 500);
  save();
  return { favorites: s.favorites[user.id] };
}

/** Compact official blocks for a model to reuse before inventing (AI integration). */
export function compatibleOfficial({ goal, level, focus = [], max = 12, unavailableEq = [] } = {}) {
  const lv = LEVELS.includes(level) ? level : 'intermediate';
  const bad = new Set(unavailableEq);
  return officialList()
    .filter(b => b.active !== false && b.goal === goal && (b.level === lv || (lv === 'advanced' && b.level === 'intermediate')))
    .filter(b => !(b.equipment || []).some(eq => bad.has(eq)))
    .sort((a, b) => (focus.includes(b.focus) ? 1 : 0) - (focus.includes(a.focus) ? 1 : 0))
    .slice(0, max)
    .map(b => ({ id: b.id, focus: b.focus, level: b.level, variant: b.variant, style: b.style, minutes: b.estimatedMinutes,
      // Guided blocks say so: the app runs them timed, paced by `timing` (never rebuilt by hand).
      ...(b.type && b.type !== 'strength' ? { type: b.type } : {}), ...(b.timing ? { timing: b.timing } : {}),
      ex: b.ex.map(e => [e.id, lookup(e.id)?.n || e.id, e.sets + 'x' + (e.targetRepsMin ? e.targetRepsMin + '-' + e.targetRepsMax : e.sec ? e.sec + 's' : e.min + 'min'), e.sg || ''].filter(Boolean)) }));
}
