// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* Guided routines — "Entrena con 2J": official 2J routines, programs, collections, trainers' own copies.
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
 * The same holds for programs: starting one pins its weeks and a snapshot of every routine in the
 * member's own state, so an admin edit never changes a plan already under way.
 *
 * Entrena con 2J Admin: the admin curates the whole catalogue from the app — routines (content,
 * status, covers, order), programs (weeks, days, status) and collections (routines AND programs).
 * Status is draft → active → hidden: members only ever see `active` content; a draft is the
 * admin's work in progress. Nothing here is sensitive, but only signed-in people read it
 * (catalogue for members), only trainers keep personal routines (their own, invisible to others)
 * and only admins change the official catalogue. Every official save passes the same 2J protocol
 * the seeds were built with, plus reference checks (real exercises, no duplicates, no broken refs).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { validateAgainst2JProtocol, routineFacts, blockTypesOf, ROUTINE_CATEGORIES, PART_ROLES, CURATED_TAGS, BADGES,
  GOALS, LEVELS, PROTOCOL_VERSION } from './protocol/index.js';
import { lookup, sanitizeEntries } from './blocks-store.js';
import { sanitizeRoutineBlocks } from './plan-meta.js';
import { equipmentIdOf } from './protocol/movements.js';
import { validateGuidedProgram, flattenProgramSessions } from './guided-program-model.js';
import * as libraryAdmin from './library-admin.js';
import * as history from './guided-history.js';

const require_ = createRequire(import.meta.url);
const SEED = require_('./guided-official.json');
const PROGRAMS = require_('./guided-programs-official.json');
const BLOCKS_SEED = require_('./blocks-official.json');
const EXERCISES = new Map(require_('../coach/library.json').exercises.map(ex => [ex.id, ex]));
const DATA = process.env.DATA_DIR || '/data';
const FILE = () => path.join(process.env.DATA_DIR || DATA, 'guided.json');
export const MAX_PERSONAL = 200;
const MAX_EX = 14;
const FOCI = ['fullbody', 'lower', 'upper', 'core', 'cardio'];
const STYLES = ['start', 'tabata', 'hiit', 'circuit', 'interval', 'mobility', 'express', 'core', 'mixed'];
// What a session is FOR, besides its format: the catalogue's warm-up / cool-down / recovery rows.
export const PURPOSES = ['warmup', 'cooldown', 'recovery', 'stretch', 'finisher'];
export const STATUSES = ['draft', 'active', 'hidden'];
const MAX_WEEKS = 12;
const MAX_CUSTOM_PROGRAMS = 100;
const MAX_CUSTOM_COLLECTIONS = 40;
const MAX_CUSTOM_OFFICIAL = 400;

let cache = null;
function load() {
  if (cache) return cache;
  let s = {};
  try { s = JSON.parse(fs.readFileSync(FILE(), 'utf8')); } catch { /* absent = nothing customised yet */ }
  const obj = v => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  const arr = v => Array.isArray(v) ? v : [];
  cache = { v: 1, rev: Number.isInteger(s.rev) ? s.rev : 0, overrides: obj(s.overrides), officialCustom: arr(s.officialCustom),
    personal: arr(s.personal), collections: { overrides: obj(s.collections?.overrides), custom: arr(s.collections?.custom) },
    programOverrides: obj(s.programOverrides), programsCustom: arr(s.programsCustom), history: obj(s.history) };
  return cache;
}
function save() {
  cache.rev = (cache.rev || 0) + 1;
  const f = FILE(), tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cache));
  fs.renameSync(tmp, f);
}
export function resetCache() { cache = null; }
// Official content keeps a short history (lib/guided-history.js): the version an admin is about to replace is remembered.
const remember = (kind, id, before, after, user) => history.record(load().history, { kind, id, before, after, by: user?.id, at: now() });

/** Changes whenever anything the catalogue shows changes: clients compare it to refresh their offline copy. */
export const contentRev = () => `${SEED.seedVersion}.${PROGRAMS.version || 1}.${load().rev}`;

const seedById = new Map(SEED.routines.map(r => [r.id, r]));
const seedCollById = new Map(SEED.collections.map(c => [c.id, c]));
const seedProgById = new Map(PROGRAMS.programs.map(p => [p.id, p]));
export const seedInfo = () => ({ protocolVersion: SEED.protocolVersion, seedVersion: SEED.seedVersion, count: SEED.routines.length, collections: SEED.collections.length, programs: PROGRAMS.programs.length });
const now = () => new Date().toISOString();
const newId = p => p + crypto.randomBytes(8).toString('base64url');
const hexId = p => p + crypto.randomBytes(6).toString('hex');   // program ids must match /^[a-z0-9-]+$/
const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const int = (v, lo, hi) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null; };
const statusOf = r => r.draft ? 'draft' : r.active === false ? 'hidden' : 'active';

// The admin's merchandising layer (featured/order/badge/active/draft) never changes the content.
const CURATION = ['active', 'featured', 'order', 'badge', 'draft'];
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
  return [...fromSeed, ...s.officialCustom].map(r => ({ ...r, status: statusOf(r) }));
}
function collectionList() {
  const s = load();
  const fromSeed = SEED.collections.map(c => ({ ...c, ...(s.collections.overrides[c.id] || {}), id: c.id }));
  return [...fromSeed, ...s.collections.custom].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
function programList() {
  const { programOverrides, programsCustom } = load();
  const fromSeed = PROGRAMS.programs.map(p => {
    const o = programOverrides[p.id] || {};
    const curated = {};
    for (const key of ['active', 'featured', 'name', 'description', 'draft', 'order']) if (key in o) curated[key] = o[key];
    return { ...(o.full ? { ...o.full, id: p.id } : p), ...curated, custom: false };
  });
  const all = [...fromSeed, ...programsCustom.map(p => ({ ...p, custom: true }))].map(p => ({ ...p, status: statusOf(p) }));
  return all.map((p, i) => [p, i]).sort((a, b) => (a[0].order ?? 1e6) - (b[0].order ?? 1e6) || a[1] - b[1]).map(x => x[0]);
}
export function findProgram(id) { return programList().find(p => p.id === id && p.active !== false) || null; }

/** What one person sees. Members: active official routines, programs and collections. Trainers: + their
 *  own routines. Admins: everything, drafts and hidden included (flagged by `status`). */
export function listFor(user, { trainer = false, admin = false } = {}) {
  const s = load();
  const routines = officialList().filter(r => admin || r.active !== false);
  const visible = new Set(routines.map(r => r.id));
  const programs = programList().filter(p => (admin || p.active !== false) && (p.weeks || []).every(w => (w.sessions || []).every(session => visible.has(session.routineId)))
  ).map(p => ({ ...p,
    routineIds: [...new Set((p.weeks || []).flatMap(w => (w.sessions || []).map(x => x.routineId)))],
  }));
  const shownPrograms = new Set(programs.map(p => p.id));
  const collections = collectionList().filter(c => admin || c.active !== false)
    .map(c => ({ ...c, routineIds: (c.routineIds || []).filter(id => visible.has(id)), programIds: (c.programIds || []).filter(id => shownPrograms.has(id)) }));
  const mine = trainer ? s.personal.filter(r => r.createdBy === user.id) : [];
  return { routines, collections, mine, programs };
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
  return { ...out, purpose: PURPOSES.includes(r.purpose) ? r.purpose : null,
    cover: ROUTINE_CATEGORIES.includes(r.cover) ? r.cover : null, notes: str(r.notes, 300) || null,
    estimatedMinutes: facts.minutes, equipment: facts.equipment, tags: facts.tags, parts: facts.parts,
    customExDefs: (customDefs || []).filter(d => d && typeof d.id === 'string' && typeof d.n === 'string' && ex.some(e => e.id === d.id))
      .map(d => ({ id: d.id.slice(0, 40), n: str(d.n, 60), bp: str(d.bp || 'waist', 30) })) };
}

/** The whole routine under the 2J protocol, judged as the day it is. FAIL is never stored. */
export function check(r, { official = false, unavailableEq = [] } = {}) {
  return validateAgainst2JProtocol({ kind: 'routine', goal: r.goal, level: r.level, entries: r.ex, blockTypes: blockTypesOf(r.blocks), protocolVersion: PROTOCOL_VERSION },
    { lookup, official, unavailableEq });
}

// A format promises what its main parts really are (the same rule the seed build applies).
const MAIN_TYPES = {
  tabata: parts => parts.every(p => p.type === 'hiit') && parts.every(p => p.timing?.preset === 'tabata'),
  hiit: parts => parts.every(p => p.type === 'hiit'),
  circuit: parts => parts.every(p => p.type === 'circuit'),
  interval: parts => parts.every(p => p.type === 'interval'),
  strength: parts => parts.every(p => p.type === 'strength' || p.type === 'superset'),
};
const CATEGORY_NAME = { tabata: 'Tabata', hiit: 'HIIT', circuit: 'Circuito', interval: 'Intervalos de cardio', strength: 'Fuerza', mobility: 'Movilidad' };

/**
 * What must be true of OFFICIAL content beyond the protocol: every exercise is real, current (not a
 * deprecated duplicate), offered by the gym, the format matches its parts, and the numbers are sane.
 * @returns { errors: [{ code, message }], warnings: [...] }  — errors block saving/publishing.
 */
export function officialChecks(r, { hidden = new Set(), availableEquipment = null } = {}) {
  const errors = [], warnings = [];
  const name = id => EXERCISES.get(id)?.n || id;
  for (const e of r.ex || []) {
    if (typeof e.id === 'string' && e.id.startsWith('c')) { errors.push({ code: 'custom_exercise', message: `«${name(e.id)}» es un ejercicio personal; el contenido oficial solo usa la biblioteca` }); continue; }
    const lib = libraryAdmin.byId(e.id);
    if (!lib) { errors.push({ code: 'unknown_exercise', message: `El ejercicio ${e.id} no existe en la biblioteca` }); continue; }
    if (lib.pref) errors.push({ code: 'deprecated_exercise', message: `«${lib.n}» es un duplicado; usa «${libraryAdmin.byId(lib.pref)?.n || lib.pref}»` });
    if (hidden.has(e.id)) errors.push({ code: 'hidden_exercise', message: `«${lib.n}» está oculto en el gimnasio` });
    if (availableEquipment) {
      const eq = equipmentIdOf(lib);
      if (eq && !availableEquipment.includes(eq)) warnings.push({ code: 'equipment_not_in_gym', message: `«${lib.n}» necesita material que el perfil 2J no tiene (${eq})` });
    }
  }
  const mains = (r.parts || []).filter(p => p.role === 'main');
  if ((r.blocks || []).length) {
    if (!mains.length) errors.push({ code: 'no_main_part', message: 'Falta una parte principal' });
    if (MAIN_TYPES[r.category] && mains.length && !MAIN_TYPES[r.category](mains))
      errors.push({ code: 'format_mismatch', message: `Una rutina «${CATEGORY_NAME[r.category]}» solo puede tener partes principales de ese formato` });
    if (r.category === 'mobility' && (r.parts || []).some(p => p.type !== 'mobility'))
      errors.push({ code: 'format_mismatch', message: 'Una rutina «Movilidad» solo puede contener partes de movilidad' });
  }
  if (!(r.estimatedMinutes >= 1 && r.estimatedMinutes <= 90)) errors.push({ code: 'duration', message: `La duración calculada (${r.estimatedMinutes} min) está fuera de 1–90 min` });
  if ((r.ex || []).length > 14) errors.push({ code: 'too_many', message: 'Demasiados ejercicios para una sesión' });
  const ids = (r.ex || []).map(e => e.id);
  if (new Set(ids).size !== ids.length) warnings.push({ code: 'repeated_exercise', message: 'Hay ejercicios repetidos en la sesión' });
  return { errors, warnings };
}

/**
 * Create or update. Personal routines: any trainer, only the author edits. Official: admin
 * only (a seed routine edit becomes an overlay; admin-created ones live in officialCustom).
 * `input.status` ('draft' | 'active' | 'hidden') applies to official routines; without it a new
 * one is active (as before) and an existing one keeps its status. `opts.dryRun` validates only.
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
  if (!existing && official && s.officialCustom.length >= MAX_CUSTOM_OFFICIAL) return { error: 'has llegado al máximo de rutinas oficiales propias', status: 400 };
  const v = check(clean, { official, unavailableEq: opts.unavailableEq });
  if (v.result === 'FAIL') return { error: 'la rutina no cumple el Protocolo 2J', status: 400, validation: v };
  const checks = official ? officialChecks(clean, { hidden: opts.hidden, availableEquipment: opts.availableEquipment }) : { errors: [], warnings: [] };
  if (checks.errors.length) return { error: checks.errors[0].message, status: 400, validation: v, issues: checks };
  const status = official && STATUSES.includes(input?.status) ? input.status : null;
  // Publishing needs a clean bill of health: warnings are shown, errors never get here.
  const active = status ? status === 'active' : (existing ? existing.active !== false : true);
  const draft = status ? status === 'draft' : (existing ? !!existing.draft : false);
  const routine = {
    ...clean, id: existing?.id || newId(official ? 'r2jc-' : 'r2jp-'), official, active, ...(official ? { draft } : {}),
    protocolVersion: PROTOCOL_VERSION, createdBy: existing?.createdBy || user.id, createdAt: existing?.createdAt || now(), updatedAt: now(),
    validation: { result: v.result, reasons: v.issues.filter(i => i.severity === 'reason').map(i => i.code) },
    ...(existing?.copiedFrom ? { copiedFrom: existing.copiedFrom } : {}),
  };
  if (!routine.customExDefs.length) delete routine.customExDefs;
  if (opts.dryRun) return { dryRun: true, routine: { ...routine, status: statusOf(routine) }, validation: v, issues: checks };
  // An unchanged re-save is not a new version: compare against the old routine as the save path would have written it.
  if (official && existing && history.contentOf('routine', { ...existing, ...sanitize(existing, existing.customExDefs) }) !== history.contentOf('routine', routine)) remember('routine', existing.id, existing, routine, user);
  if (official && seedById.has(routine.id)) {
    s.overrides[routine.id] = { ...(s.overrides[routine.id] || {}), routine, ...(status ? { active, draft } : {}), seedVersion: seedById.get(routine.id).seedVersion, by: user.id, at: now() };
  } else if (official) {
    if (!existing) routine.publishedAt = now().slice(0, 10);
    const i = s.officialCustom.findIndex(r => r.id === routine.id);
    if (i >= 0) s.officialCustom[i] = { ...s.officialCustom[i], ...routine }; else s.officialCustom.push(routine);
  } else {
    const i = s.personal.findIndex(r => r.id === routine.id);
    if (i >= 0) s.personal[i] = routine; else s.personal.push(routine);
  }
  save();
  return { routine: find(routine.id, user), validation: v, issues: checks };
}

/** Official or own → a new personal routine of this trainer. The master is untouched. */
export function duplicate(user, id) {
  const src = find(id, user);
  if (!src) return { error: 'esa rutina no existe', status: 404 };
  const s = load();
  if (s.personal.filter(r => r.createdBy === user.id).length >= MAX_PERSONAL) return { error: 'has llegado al máximo de rutinas propias', status: 400 };
  const copy = JSON.parse(JSON.stringify(src));
  for (const k of ['seedVersion', 'seedChanged', 'featured', 'order', 'badge', 'publishedAt', 'evidence', 'status', 'draft']) delete copy[k];
  Object.assign(copy, { id: newId('r2jp-'), official: false, active: true, createdBy: user.id, createdAt: now(), updatedAt: now(), copiedFrom: src.id });
  s.personal.push(copy);
  save();
  return { routine: copy };
}

/** Admin: an official routine becomes an editable official copy in DRAFT (the original is untouched). */
export function duplicateOfficial(user, id) {
  const src = officialList().find(r => r.id === id);
  if (!src) return { error: 'esa rutina no existe', status: 404 };
  const s = load();
  if (s.officialCustom.length >= MAX_CUSTOM_OFFICIAL) return { error: 'has llegado al máximo de rutinas oficiales propias', status: 400 };
  const copy = JSON.parse(JSON.stringify(src));
  for (const k of ['seedVersion', 'seedChanged', 'featured', 'order', 'badge', 'evidence', 'status']) delete copy[k];
  Object.assign(copy, { id: newId('r2jc-'), official: true, active: false, draft: true, name: str(src.name + ' · copy', 70), createdBy: user.id, createdAt: now(), updatedAt: now(),
    publishedAt: now().slice(0, 10), copiedFrom: src.id });
  s.officialCustom.push(copy);
  save();
  return { routine: officialList().find(r => r.id === copy.id) };
}

/** draft → active → hidden. Official: admin only. (Personal routines only toggle active.) */
export function setStatus(user, admin, id, status) {
  const s = load();
  const r = find(id, user);
  if (!r) return { error: 'esa rutina no existe', status: 404 };
  if (!STATUSES.includes(status)) return { error: 'estado no válido', status: 400 };
  if (r.official) {
    if (!admin) return { error: 'solo administración puede activar o desactivar rutinas oficiales', status: 403 };
    if (status === 'active') {
      const problems = officialChecks(r);
      if (problems.errors.length) return { error: problems.errors[0].message, status: 400, issues: problems };
    }
    const patch = { active: status === 'active', draft: status === 'draft' };
    remember('routine', id, r, { ...r, ...patch }, user);
    if (seedById.has(id)) s.overrides[id] = { ...(s.overrides[id] || {}), ...patch, by: user.id, at: now() };
    else Object.assign(s.officialCustom.find(x => x.id === id), patch, { updatedAt: now() });
  } else {
    const p = s.personal.find(x => x.id === id); p.active = status === 'active'; p.updatedAt = now();
  }
  save();
  return { routine: find(id, user) };
}
export const setActive = (user, admin, id, active) => setStatus(user, admin, id, active ? 'active' : 'hidden');

export function remove(user, admin, id) {
  const s = load();
  const r = find(id, user);
  if (!r) return { error: 'esa rutina no existe', status: 404 };
  if (r.official) {
    if (!admin) return { error: 'solo administración puede borrar rutinas oficiales', status: 403 };
    if (seedById.has(id)) return { error: 'las rutinas oficiales de la biblioteca base se desactivan, no se borran', status: 400 };
    // A routine a program or collection still points at cannot vanish under it.
    const inProgram = programList().find(p => flattenProgramSessions(p).some(x => x.routineId === id));
    if (inProgram) return { error: `la usa el programa «${inProgram.name}»; quítala de él primero`, status: 400 };
    s.officialCustom = s.officialCustom.filter(x => x.id !== id);
    history.drop(s.history, id);
    for (const c of s.collections.custom) c.routineIds = (c.routineIds || []).filter(x => x !== id);
    for (const o of Object.values(s.collections.overrides)) if (o.routineIds) o.routineIds = o.routineIds.filter(x => x !== id);
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

/** Admin: the display order of routines, programs or collections, as the position in `ids`. */
export function reorder(user, kind, ids) {
  const s = load();
  const list = Array.isArray(ids) ? [...new Set(ids.map(String))] : [];
  if (!list.length) return { error: 'no hay nada que ordenar', status: 400 };
  if (kind === 'routines') {
    const known = new Set(officialList().map(r => r.id));
    if (list.some(id => !known.has(id))) return { error: 'una de las rutinas no existe', status: 404 };
    list.forEach((id, i) => {
      if (seedById.has(id)) s.overrides[id] = { ...(s.overrides[id] || {}), order: i, by: user.id, at: now() };
      else Object.assign(s.officialCustom.find(x => x.id === id), { order: i, updatedAt: now() });
    });
  } else if (kind === 'programs') {
    const known = new Set(programList().map(p => p.id));
    if (list.some(id => !known.has(id))) return { error: 'uno de los programas no existe', status: 404 };
    list.forEach((id, i) => {
      if (seedProgById.has(id)) s.programOverrides[id] = { ...(s.programOverrides[id] || {}), order: i, by: user.id, at: now() };
      else Object.assign(s.programsCustom.find(x => x.id === id), { order: i, updatedAt: now() });
    });
  } else if (kind === 'collections') {
    const known = new Set(collectionList().map(c => c.id));
    if (list.some(id => !known.has(id))) return { error: 'una de las colecciones no existe', status: 404 };
    list.forEach((id, i) => {
      if (seedCollById.has(id)) s.collections.overrides[id] = { ...(s.collections.overrides[id] || {}), order: i, by: user.id, at: now() };
      else Object.assign(s.collections.custom.find(x => x.id === id), { order: i });
    });
  } else return { error: 'tipo de orden no válido', status: 400 };
  save();
  return { ok: true };
}

/* ---------------------------------- programs ---------------------------------- */

const EQUIPMENT_LABELS = [['Bodyweight', r => (r.equipment || []).every(q => q === 'body weight')],
  ['Gym machines', r => (r.equipment || []).some(q => ['leverage machine', 'sled machine', 'cable', 'smith machine', 'assisted'].includes(q))],
  ['Dumbbells', r => (r.equipment || []).includes('dumbbell')],
  ['Free weights', r => (r.equipment || []).some(q => ['barbell', 'ez barbell', 'weighted', 'trap bar'].includes(q))],
  ['Cardio machines', r => (r.equipment || []).some(q => ['stationary bike', 'elliptical machine', 'stepmill machine', 'treadmill', 'skierg machine', 'upper body ergometer'].includes(q))]];
const PROFILE_TYPES = ['official', 'home', 'hotel', 'other', 'custom'];
const weeksLabel = n => n === 1 ? '1 week' : `${n} weeks`;

/** Whitelist a program from the editor; counts, label, gear and impact are computed, never trusted. */
function normalizeProgram(input, routinesById) {
  const p = input && typeof input === 'object' ? input : {};
  const weeks = (Array.isArray(p.weeks) ? p.weeks : []).slice(0, MAX_WEEKS).map(w => {
    const seen = new Set();
    const sessions = (Array.isArray(w?.sessions) ? w.sessions : []).slice(0, 7).map(x => ({ day: int(x?.day, 0, 6), routineId: str(x?.routineId, 80) }))
      .filter(x => x.day != null && x.routineId && !seen.has(x.day) && seen.add(x.day))
      .sort((a, b) => (a.day || 7) - (b.day || 7) || a.day - b.day);
    return { sessions };
  });
  const routines = flattenProgramSessions({ weeks }).map(x => routinesById.get(x.routineId)).filter(Boolean);
  return {
    name: str(p.name, 70), description: str(p.description, 400),
    goal: GOALS.includes(p.goal) ? p.goal : 'general', level: LEVELS.includes(p.level) ? p.level : 'beginner',
    cover: ROUTINE_CATEGORIES.includes(p.cover) ? p.cover : 'circuit',
    weeksCount: weeks.length, sessionsPerWeek: Math.max(0, ...weeks.map(w => w.sessions.length)),
    durationLabel: weeksLabel(weeks.length),
    equipment: EQUIPMENT_LABELS.filter(([, f]) => routines.some(f)).map(([label]) => label),
    profileTypes: PROFILE_TYPES,
    lowImpact: routines.length > 0 && routines.every(r => (r.tags || []).includes('low-impact')),
    featured: !!p.featured, weeks,
  };
}

/** Errors that stop a program being saved; `publishing` also demands every routine be active. */
function programProblems(p, routinesById, { publishing = false } = {}) {
  const errors = [];
  if (!p.name) errors.push('ponle un nombre al programa');
  if (!p.description) errors.push('ponle una descripción al programa');
  if (p.weeksCount < 1) errors.push('el programa necesita al menos una semana');
  if (p.weeksCount > MAX_WEEKS) errors.push(`el programa admite como máximo ${MAX_WEEKS} semanas`);
  p.weeks.forEach((w, i) => { if (!w.sessions.length) errors.push(`la semana ${i + 1} no tiene ninguna sesión`); });
  const ids = new Set(routinesById.keys());
  const model = validateGuidedProgram({ ...p, id: p.id || 'draft-program' }, ids);
  for (const m of model) if (m.startsWith('routine:')) errors.push(`la rutina ${m.slice(8)} no existe`);
  for (const w of p.weeks) for (const x of w.sessions) {
    const r = routinesById.get(x.routineId);
    if (r && r.status === 'draft' && publishing) errors.push(`«${r.name}» sigue en borrador`);
    else if (r && r.active === false && publishing) errors.push(`«${r.name}» está oculta`);
  }
  // Every week of a program is judged under the 2J protocol, exactly like the official seeds.
  p.weeks.forEach((w, index) => {
    const rs = w.sessions.map(x => routinesById.get(x.routineId)).filter(Boolean);
    if (!rs.length) return;
    const types = Object.assign({}, ...rs.map(r => blockTypesOf(r.blocks)));
    const result = validateAgainst2JProtocol({ kind: 'program', goal: p.goal, level: p.level, days: rs.map(r => r.ex), blockTypes: types }, { lookup });
    if (result.result === 'FAIL') errors.push(`la semana ${index + 1} no cumple el Protocolo 2J: ${result.issues.filter(i => i.severity === 'fail').map(i => i.message).slice(0, 2).join(' | ')}`);
  });
  return [...new Set(errors)];
}

/**
 * Admin: create or edit an official program (custom ones live in programsCustom; a seed program's
 * edit is an overlay with the full definition, so the release's seed is never overwritten).
 * `status` is draft | active | hidden (default: draft for a new program, unchanged otherwise).
 */
export function saveProgram(user, input = {}, opts = {}) {
  const s = load();
  const routinesById = new Map(officialList().map(r => [r.id, r]));
  const existing = input.id ? programList().find(p => p.id === input.id) : null;
  if (input.id && !existing) return { error: 'ese programa no existe', status: 404 };
  if (!existing && s.programsCustom.length >= MAX_CUSTOM_PROGRAMS) return { error: 'has llegado al máximo de programas propios', status: 400 };
  const p = normalizeProgram(input, routinesById);
  const status = STATUSES.includes(input.status) ? input.status : (existing ? statusOf(existing) : 'draft');
  const problems = programProblems({ ...p, id: existing?.id }, routinesById, { publishing: status === 'active' });
  if (problems.length) return { error: problems[0], status: 400, problems };
  const program = { ...p, id: existing?.id || hexId('g2jc-'), active: status === 'active', draft: status === 'draft' };
  if (opts.dryRun) return { dryRun: true, program: { ...program, status, custom: !existing || !seedProgById.has(existing.id) }, problems: [] };
  if (existing) remember('program', existing.id, existing, program, user);
  if (existing && seedProgById.has(existing.id)) {
    const prev = s.programOverrides[existing.id] || {};
    const { name: _n, description: _d, ...rest } = prev;       // the full edit wins over earlier name/description curation
    s.programOverrides[existing.id] = { ...rest, full: { ...program, active: undefined, draft: undefined }, active: program.active, draft: program.draft, featured: program.featured, by: user.id, at: now() };
  } else if (existing) {
    const i = s.programsCustom.findIndex(x => x.id === existing.id);
    s.programsCustom[i] = { ...s.programsCustom[i], ...program, updatedAt: now() };
  } else {
    s.programsCustom.push({ ...program, createdBy: user.id, createdAt: now(), updatedAt: now() });
  }
  save();
  return { program: programList().find(x => x.id === program.id) };
}

/** Admin: an editable DRAFT copy of any program (seed or custom). The original is untouched. */
export function duplicateProgram(user, id) {
  const src = programList().find(p => p.id === id);
  if (!src) return { error: 'ese programa no existe', status: 404 };
  const s = load();
  if (s.programsCustom.length >= MAX_CUSTOM_PROGRAMS) return { error: 'has llegado al máximo de programas propios', status: 400 };
  const copy = JSON.parse(JSON.stringify(src));
  for (const k of ['status', 'custom', 'order', 'createdBy', 'createdAt', 'updatedAt']) delete copy[k];
  Object.assign(copy, { id: hexId('g2jc-'), name: str(src.name + ' · copy', 70), active: false, draft: true, featured: false, createdBy: user.id, createdAt: now(), updatedAt: now() });
  s.programsCustom.push(copy);
  save();
  return { program: programList().find(p => p.id === copy.id) };
}

/** Admin: only the programs the admin created can be deleted; the release's are hidden, never removed. */
export function removeProgram(user, id) {
  const s = load();
  const p = programList().find(x => x.id === id);
  if (!p) return { error: 'ese programa no existe', status: 404 };
  if (seedProgById.has(id)) return { error: 'los programas oficiales de la biblioteca base se ocultan, no se borran', status: 400 };
  s.programsCustom = s.programsCustom.filter(x => x.id !== id);
  history.drop(s.history, id);
  for (const c of s.collections.custom) c.programIds = (c.programIds || []).filter(x => x !== id);
  for (const o of Object.values(s.collections.overrides)) if (o.programIds) o.programIds = o.programIds.filter(x => x !== id);
  save();
  return { ok: true };
}

/** Admin-only overlay for safe program metadata (a quick toggle; full edits go through saveProgram). */
export function curateProgram(user, id, patch = {}) {
  const seed = seedProgById.get(id);
  const current = programList().find(p => p.id === id);
  if (!current) return { error: 'ese programa oficial no existe', status: 404 };
  const before = JSON.parse(JSON.stringify(current));
  if (!seed) {
    const p = load().programsCustom.find(x => x.id === id);
    if ('name' in patch) { const name = str(patch.name, 70); if (!name) return { error: 'ponle un nombre al programa', status: 400 }; p.name = name; }
    if ('description' in patch) { const d = str(patch.description, 400); if (!d) return { error: 'ponle una descripción al programa', status: 400 }; p.description = d; }
    if ('featured' in patch) p.featured = !!patch.featured;
    if ('active' in patch) {
      if (patch.active !== false) {
        const routinesById = new Map(officialList().map(r => [r.id, r]));
        const problems = programProblems(p, routinesById, { publishing: true });
        if (problems.length) return { error: problems[0], status: 400, problems };
      }
      p.active = patch.active !== false; p.draft = false;
    }
    p.updatedAt = now();
    remember('program', id, before, p, user);
    save();
    return { program: programList().find(x => x.id === id) };
  }
  const o = { ...(load().programOverrides[id] || {}) };
  if ('active' in patch) { o.active = patch.active !== false; o.draft = false; }
  if ('featured' in patch) o.featured = !!patch.featured;
  if ('name' in patch) { const name = str(patch.name, 70); if (!name) return { error: 'ponle un nombre al programa', status: 400 }; o.name = name; }
  if ('description' in patch) { const description = str(patch.description, 400); if (!description) return { error: 'ponle una descripción al programa', status: 400 }; o.description = description; }
  load().programOverrides[id] = { ...o, by: user.id, at: now() };
  remember('program', id, before, programList().find(p => p.id === id), user);
  save();
  return { program: programList().find(p => p.id === id) };
}

/* -------------------------------- collections -------------------------------- */

/** Collections: admin creates, edits, orders, (de)activates and fills them with routines AND programs. */
export function saveCollection(user, input = {}) {
  const s = load();
  const known = new Set(officialList().map(r => r.id));
  const knownPrograms = new Set(programList().map(p => p.id));
  const c = {
    name: str(input.name, 60) || null,
    description: str(input.description, 200) || null,
    style: STYLES.includes(input.style) ? input.style : 'start',
    order: int(input.order, 0, 999) ?? 0,
    active: input.active !== false,
    featured: !!input.featured,
    routineIds: [...new Set((Array.isArray(input.routineIds) ? input.routineIds : []).filter(id => known.has(id)))].slice(0, 60),
    programIds: [...new Set((Array.isArray(input.programIds) ? input.programIds : []).filter(id => knownPrograms.has(id)))].slice(0, 30),
  };
  if (!c.name) return { error: 'ponle un nombre a la colección', status: 400 };
  if (input.id) { const prev = collectionList().find(x => x.id === input.id); if (prev) remember('collection', input.id, prev, c, user); }
  if (!input.id && s.collections.custom.length >= MAX_CUSTOM_COLLECTIONS) return { error: 'has llegado al máximo de colecciones propias', status: 400 };
  if (input.id && seedCollById.has(input.id)) s.collections.overrides[input.id] = { ...(s.collections.overrides[input.id] || {}), ...c, by: user.id, at: now() };
  else if (input.id) {
    const i = s.collections.custom.findIndex(x => x.id === input.id);
    if (i < 0) return { error: 'esa colección no existe', status: 404 };
    s.collections.custom[i] = { ...s.collections.custom[i], ...c };
  } else s.collections.custom.push({ ...c, id: newId('c2jc-') });
  save();
  return { collections: collectionList() };
}

/** Only collections the admin created are deleted; the release's are deactivated. */
export function removeCollection(user, id) {
  const s = load();
  if (seedCollById.has(id)) return { error: 'las colecciones de la biblioteca base se desactivan, no se borran', status: 400 };
  if (!s.collections.custom.some(x => x.id === id)) return { error: 'esa colección no existe', status: 404 };
  s.collections.custom = s.collections.custom.filter(x => x.id !== id);
  history.drop(s.history, id);
  save();
  return { collections: collectionList() };
}

/* ---------------------------------- history ---------------------------------- */

/** The kept versions of one official item (newest first, no bodies). */
export const historyOf = id => history.list(load().history, String(id || ''));

/**
 * Admin: put a kept version back. It goes through the normal save path (the 2J protocol, reference checks), so a version that no longer holds —
 * an exercise since hidden, a routine since removed — is refused with the usual reason, and the version being replaced is itself kept.
 */
export function restoreVersion(user, id, at, opts = {}) {
  const entry = history.find(load().history, String(id || ''), String(at || ''));
  if (!entry) return { error: 'esa versión ya no está guardada', status: 404 };
  const snap = JSON.parse(JSON.stringify(entry.snapshot));
  const status = snap.draft ? 'draft' : snap.active === false ? 'hidden' : 'active';
  if (entry.kind === 'routine') return upsert(user, true, { ...snap, id, scope: 'official', status }, opts);
  if (entry.kind === 'program') return saveProgram(user, { ...snap, id, status });
  if (entry.kind === 'collection') return saveCollection(user, { ...snap, id });
  return { error: 'versión no válida', status: 400 };
}

/* ---------------------------------- the Coach ---------------------------------- */

/** Compact official routines for a model: prefer curated routines, built from official blocks. */
export function compatibleRoutines({ goal, level, max = 10, unavailableEq = [] } = {}) {
  const lv = LEVELS.includes(level) ? level : 'intermediate';
  const bad = new Set(unavailableEq);
  const order = { beginner: ['beginner'], intermediate: ['intermediate', 'beginner'], advanced: ['advanced', 'intermediate'] }[lv];
  return officialList().filter(r => r.active !== false && (r.goal === goal || r.category === 'mobility') && order.includes(r.level))
    .filter(r => !(r.equipment || []).some(q => bad.has(q)))
    .filter(r => !(r.ex || []).some(e => libraryAdmin.isDeprecated(e.id)))
    .slice(0, max)
    .map(r => ({ id: r.id, name: r.name, category: r.category, level: r.level, minutes: r.estimatedMinutes,
      blocks: (r.blocks || []).map(b => b.src).filter(x => typeof x === 'string' && x.startsWith('off-')) }));
}

/** Compact, active official program candidates for the Coach. Partial equipment fit is retained:
 * the member and trainer can review a plan even when an individual session needs a swap. */
export function compatiblePrograms({ goal, level, availableEquipment = null, max = 6 } = {}) {
  const lv = LEVELS.includes(level) ? level : 'intermediate';
  const order = { beginner: ['beginner'], intermediate: ['beginner', 'intermediate'], advanced: ['beginner', 'intermediate', 'advanced'] }[lv];
  const active = new Set(officialList().filter(r => r.active !== false).map(r => r.id));
  const byId = new Map(officialList().map(r => [r.id, r]));
  const available = Array.isArray(availableEquipment) ? new Set(availableEquipment) : null;
  return programList().filter(p => p.active !== false && (p.goal === goal || (goal === 'endurance' && p.goal === 'general'))
    && order.includes(p.level)
    && (p.weeks || []).every(w => (w.sessions || []).every(session => active.has(session.routineId))))
    .map(p => {
      const sessions = p.weeks.flatMap(w => w.sessions);
      const compatible = available ? sessions.filter(s => {
        const r = byId.get(s.routineId);
        return r?.ex?.length && r.ex.every(e => {
          const id = equipmentIdOf(libraryAdmin.byId(e.id) || EXERCISES.get(e.id));
          return id && available.has(id);
        });
      }).length : sessions.length;
      return { id: p.id, name: p.name, goal: p.goal, level: p.level, weeks: p.weeksCount,
        sessionsPerWeek: p.sessionsPerWeek, duration: p.durationLabel, equipment: p.equipment,
        equipmentFit: { compatibleSessions: compatible, totalSessions: sessions.length, partial: compatible > 0 && compatible < sessions.length },
        lowImpact: !!p.lowImpact, featured: !!p.featured };
    })
    // Featured first, then as listed: the editorial order is the admin's.
    .filter(p => p.equipmentFit.compatibleSessions > 0)
    .slice(0, max);
}

/** Minimal progress context only; no workout/set history is duplicated into the Coach payload. */
export function activeProgramContext(S) {
  const p = (S?.programs || []).find(x => x.id === S?.activeProgramId && x.source === 'guided-v2' && x.status === 'active');
  if (!p) return null;
  const sessions = (p.weeks || []).flatMap((week, weekIndex) => (week.sessions || []).map((s, dayIndex) => ({
    sessionId: `${weekIndex + 1}:${s.day}:${dayIndex}`, week: weekIndex + 1, day: s.day, routineId: s.routineId,
  })));
  const done = new Set((S.workouts || []).filter(w => w?.src2j?.program?.programId === p.id)
    .map(w => w.src2j.program.sessionId).filter(Boolean));
  const next = sessions.find(s => !done.has(s.sessionId)) || null;
  return { id: p.id, name: p.name, goal: p.meta?.goal || null, status: p.status,
    completed: sessions.filter(s => done.has(s.sessionId)).length, total: sessions.length, next };
}

/** Exercise ids that ACTIVE official content uses (official blocks and routines): the library admin
 *  refuses to mark one of them as a duplicate until the content stops using it. */
export function exerciseUsage() {
  const ids = new Set();
  for (const b of BLOCKS_SEED.blocks || []) if (b.active !== false) for (const e of b.ex || []) ids.add(e.id);
  for (const r of officialList()) if (r.active !== false) for (const e of r.ex || []) ids.add(e.id);
  return ids;
}
