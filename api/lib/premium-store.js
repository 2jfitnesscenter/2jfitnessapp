// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* Premium Training Programs — the catalogue.
 *
 * Same arrangement as Train2J (lib/guided-store.js): global, admin/trainer-authored data in its own file (DATA/premium.json), never in a member's
 * synced state. The official seed is the versioned api/lib/premium-official.json (scripts/build-premium-programs.mjs), read from the release on every
 * boot — nothing is copied, so a redeploy never duplicates anything, and an admin's edits (an overlay keyed by id) are never overwritten by a new seed.
 *
 * Who owns what (the role is checked here, on the server, before anything else):
 *   official   the 12 seeded programs — admin edits them (content as an overlay, status/featured/order separately).
 *   catalog    a program an admin created or PROMOTED from a trainer's personal one — admin only.
 *   personal   a trainer's own program — visible to its author (and to admins); the author edits, duplicates, archives or deletes it; it is never
 *              listed to members and a trainer can never publish it globally.
 * Status: draft (admin/author only) · published (listed to compatible members) · hidden (valid and usable by those already following it, not listed
 * to new members) · archived (not selectable, history kept). A member's run pins a SNAPSHOT of the definition, so no status or edit here can break a
 * program already under way. Nothing is ever deleted if it was published or used: it is archived or versioned instead.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import * as model from './premium-model.js';

const require_ = createRequire(import.meta.url);
const SEED = require_('./premium-official.json');
const LIB = new Map(require_('../coach/library.json').exercises.map(e => [e.id, e]));
const DATA = process.env.DATA_DIR || '/data';
const FILE = () => path.join(process.env.DATA_DIR || DATA, 'premium.json');
export const MAX_PERSONAL = 40;
export const MAX_CATALOG = 120;
export const HISTORY_CAP = 10;
export const BADGES = ['new', 'featured', 'recommended'];
const ctx = { exerciseExists: id => LIB.has(id), preferred: id => LIB.get(id)?.pref || id };

let cache = null;
function load() {
  if (cache) return cache;
  let s = {};
  try { s = JSON.parse(fs.readFileSync(FILE(), 'utf8')); } catch { /* absent = nothing customised yet */ }
  const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  cache = { v: 1, rev: Number.isInteger(s.rev) ? s.rev : 0, overrides: obj(s.overrides), custom: Array.isArray(s.custom) ? s.custom : [], history: obj(s.history), usage: obj(s.usage) };
  return cache;
}
function save() {
  cache.rev = (cache.rev || 0) + 1;
  const f = FILE(), tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cache));
  fs.renameSync(tmp, f);
}
export function resetCache() { cache = null; }
export const contentRev = () => `${SEED.seedVersion}.${load().rev}`;
export const seedInfo = () => ({ seedVersion: SEED.seedVersion, count: SEED.programs.length });
const now = () => new Date().toISOString();
const clone = x => JSON.parse(JSON.stringify(x));
const newId = () => 'prm-' + crypto.randomBytes(6).toString('hex');
const fail = (error, status = 400, extra = {}) => ({ error, status, ...extra });

/* ------------------------------------------------------------------------------------------------ reading */
const CURATION = ['status', 'featured', 'order', 'badge', 'publishedAt'];
function officialList() {
  const { overrides } = load();
  return SEED.programs.map(p => {
    const o = overrides[p.id];
    const base = o?.full ? { ...clone(o.full), id: p.id, sourceKind: 'official', createdBy: p.createdBy, createdAt: p.createdAt } : clone(p);
    const out = { ...base, scope: 'official', seedChanged: !!o?.full && (o.seedVersion || 0) < SEED.seedVersion };
    for (const k of CURATION) { if (o && k in o) out[k] = o[k]; else if (o?.full) out[k] = p[k]; }
    return out;
  });
}
const customList = () => load().custom.map(p => ({ ...clone(p), sourceKind: 'custom' }));
const everything = () => {
  const all = [...officialList(), ...customList()];
  return all.map((p, i) => [p, i]).sort((a, b) => (a[0].order ?? 1e6) - (b[0].order ?? 1e6) || a[1] - b[1]).map(x => x[0]);
};
const isCatalog = p => p.scope === 'official' || p.scope === 'catalog';

/** What a person may see. Admin: everything. Trainer: the published catalogue plus their own programs. Member: the published catalogue only. */
export function canSee(p, user, { admin = false, trainer = false } = {}) {
  if (admin) return true;
  if (isCatalog(p) && p.status === 'published') return true;
  return trainer && p.scope === 'personal' && p.createdBy === user?.id;
}

const summary = (p, { staff = false } = {}) => {
  const def = p.programDefinition;
  const { programDefinition, legal, ...rest } = p;
  return {
    ...rest, ...(staff ? { legal } : { legal: undefined }),
    setup: { lifts: (def.lifts || []).map(l => ({ key: l.key, exercise: l.exercise, group: l.group })), referenceLabel: def.referenceLabel || null, cycleWeeks: def.cycleWeeks,
      sessionsPerCycle: model.sessionsOf(def).length, hasCycleRule: !!def.progression?.cycleEnd },
    usage: staff ? (load().usage[p.id] || { started: 0 }) : undefined,
  };
};

export function listFor(user, { admin = false, trainer = false } = {}) {
  const staff = admin || trainer;
  return everything().filter(p => canSee(p, user, { admin, trainer })).map(p => summary(p, { staff }));
}
export function find(idOrSlug, user, roles = {}) {
  const p = everything().find(x => x.id === idOrSlug || x.slug === idOrSlug);
  return p && canSee(p, user, roles) ? p : null;
}
/** The full program (with its definition), as the person is allowed to read it. */
export const detail = (idOrSlug, user, roles = {}) => {
  const p = find(idOrSlug, user, roles);
  return p ? { ...p, ...((roles.admin || roles.trainer) ? {} : { legal: undefined }) } : null;
};

/* ------------------------------------------------------------------------------------------------ history */
const CONTENT = ['name', 'slug', 'shortDescription', 'longDescription', 'goalTags', 'level', 'daysPerWeek', 'durationDescription', 'methodType', 'sourceType', 'author',
  'evidenceSummary', 'equipmentRequirements', 'progressionModel', 'copy', 'legal', 'programDefinition'];
const contentOf = p => JSON.stringify(Object.fromEntries(CONTENT.map(k => [k, p?.[k] ?? null])));
function remember(id, before, by) {
  const h = load().history;
  const list = h[id] = Array.isArray(h[id]) ? h[id] : [];
  list.push({ at: now(), by: by || null, version: before.version, status: before.status, snapshot: clone(before) });
  if (list.length > HISTORY_CAP) list.splice(0, list.length - HISTORY_CAP);
}
export const historyOf = id => (load().history[id] || []).slice().reverse().map(e => ({ at: e.at, by: e.by, version: e.version, status: e.status, name: e.snapshot.name }));

/* ------------------------------------------------------------------------------------------------ writing */
function mustManage(p, user, admin) {
  if (admin) return null;
  if (p.scope === 'personal' && p.createdBy === user?.id) return null;
  if (p.scope === 'personal') return fail('programa no encontrado', 404);
  return fail('prohibido: solo el administrador cambia el catálogo', 403);
}
const slugTaken = (slug, exceptId) => everything().some(p => p.slug === slug && p.id !== exceptId);

/** Validates a program as it would be stored. Returns { program } or { error, issues }. */
function assemble(input, existing, user, admin, asScope) {
  const editorial = model.sanitizeEditorial(input);
  const issues = [];
  const base = existing || {};
  const program = {
    ...editorial,
    id: existing?.id || newId(),
    version: existing ? existing.version : 1,
    status: existing ? existing.status : 'draft',
    featured: existing ? !!existing.featured : false,
    badge: existing ? existing.badge || null : null,
    order: existing?.order ?? null,
    scope: existing?.scope || asScope,
    sourceKind: existing?.sourceKind || 'custom',
    createdBy: existing?.createdBy || user.id, createdAt: existing?.createdAt || now(),
    updatedBy: user.id, updatedAt: now(), publishedAt: existing?.publishedAt || null,
    ...(existing?.locales ? { locales: existing.locales } : {}),
  };
  if (!program.slug && program.name) program.slug = program.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
  issues.push(...model.validateProgram(program, ctx));
  if (slugTaken(program.slug, program.id)) issues.push('slug-taken');
  if (program.scope === 'personal' && base.scope && base.scope !== 'personal') issues.push('scope');
  return issues.length ? { error: 'programa no válido', issues: [...new Set(issues)], status: 400 } : { program };
}

/** Creates or edits a program. A trainer only ever works on their own personal programs; an admin on the catalogue. */
export function upsert(user, admin, input = {}, { dryRun = false } = {}) {
  const s = load();
  const existing = input.id ? everything().find(p => p.id === String(input.id)) : null;
  if (input.id && !existing) return fail('programa no encontrado', 404);
  if (existing) { const denied = mustManage(existing, user, admin); if (denied) return denied; }
  const scope = existing ? existing.scope : admin && input.scope === 'catalog' ? 'catalog' : admin ? 'catalog' : 'personal';
  if (!existing) {
    if (scope === 'personal' && s.custom.filter(p => p.scope === 'personal' && p.createdBy === user.id).length >= MAX_PERSONAL) return fail('límite de programas propios alcanzado', 409);
    if (scope === 'catalog' && s.custom.filter(p => p.scope === 'catalog').length >= MAX_CATALOG) return fail('límite del catálogo alcanzado', 409);
  }
  const r = assemble(input, existing, user, admin, scope);
  if (r.error) return r;
  const next = r.program;
  if (existing && contentOf(existing) !== contentOf(next)) next.version = existing.version + 1;
  if (dryRun) return { ok: true, dryRun: true, program: next };
  if (existing) {
    if (contentOf(existing) !== contentOf(next)) remember(existing.id, existing, user.id);
    if (existing.scope === 'official') {
      const o = s.overrides[existing.id] = s.overrides[existing.id] || {};
      const { status, featured, order, badge, publishedAt, scope: _s, seedChanged, ...full } = next;
      o.full = full; o.seedVersion = SEED.seedVersion;
    } else {
      s.custom[s.custom.findIndex(p => p.id === existing.id)] = stripSystem(next);
    }
  } else {
    s.custom.push(stripSystem(next));
  }
  save();
  return { ok: true, program: summary(everything().find(p => p.id === next.id), { staff: true }) };
}
const stripSystem = p => { const { seedChanged, sourceKind, ...rest } = p; return rest; };

/** draft ↔ published ↔ hidden ↔ archived. A trainer moves their own program between draft, hidden and archived only: publishing is the admin's. */
export function setStatus(user, admin, id, status) {
  if (!model.STATUSES.includes(status)) return fail('estado no válido');
  const p = everything().find(x => x.id === id);
  if (!p) return fail('programa no encontrado', 404);
  const denied = mustManage(p, user, admin); if (denied) return denied;
  if (status === 'published') {
    if (!admin) return fail('prohibido: solo el administrador publica', 403);
    if (p.scope === 'personal') return fail('un programa personal no se publica: promuévelo primero al catálogo', 409);
    const issues = model.validateProgram({ ...p, status: 'published' }, ctx);
    if (issues.length) return fail('programa no válido', 400, { issues });
  }
  if (p.status === status) return { ok: true, program: summary(p, { staff: true }) };
  const s = load();
  if (p.scope === 'official') {
    const o = s.overrides[p.id] = s.overrides[p.id] || {};
    o.status = status; if (status === 'published' && !p.publishedAt) o.publishedAt = now();
  } else {
    const c = s.custom.find(x => x.id === id);
    c.status = status; c.updatedBy = user.id; c.updatedAt = now();
    if (status === 'published' && !c.publishedAt) c.publishedAt = now();
  }
  save();
  return { ok: true, program: summary(everything().find(x => x.id === id), { staff: true }) };
}

/** Merchandising only: featured, badge, order. Never changes content, never creates a version. Admin only. */
export function curate(user, id, patch = {}) {
  const p = everything().find(x => x.id === id);
  if (!p) return fail('programa no encontrado', 404);
  if (p.scope === 'personal') return fail('un programa personal no se destaca: promuévelo primero al catálogo', 409);
  const s = load();
  const target = p.scope === 'official' ? (s.overrides[p.id] = s.overrides[p.id] || {}) : s.custom.find(x => x.id === id);
  if ('featured' in patch) target.featured = !!patch.featured;
  if ('badge' in patch) target.badge = BADGES.includes(patch.badge) ? patch.badge : null;
  if ('order' in patch) target.order = Number.isFinite(Number(patch.order)) ? Math.round(Number(patch.order)) : null;
  save();
  return { ok: true, program: summary(everything().find(x => x.id === id), { staff: true }) };
}
export function reorder(user, ids) {
  if (!Array.isArray(ids) || ids.some(i => typeof i !== 'string')) return fail('lista no válida');
  const known = new Map(everything().map(p => [p.id, p]));
  const s = load();
  ids.filter(i => known.has(i) && isCatalog(known.get(i))).forEach((id, i) => {
    const p = known.get(id);
    const target = p.scope === 'official' ? (s.overrides[id] = s.overrides[id] || {}) : s.custom.find(x => x.id === id);
    target.order = i + 1;
  });
  save();
  return { ok: true };
}

/** A copy anyone who can see a program may keep: a trainer's personal draft, or (admin, `catalog`) a catalogue draft. */
export function duplicate(user, admin, trainer, id, { catalog = false } = {}) {
  const src = find(id, user, { admin, trainer });
  if (!src) return fail('programa no encontrado', 404);
  const scope = admin && catalog ? 'catalog' : 'personal';
  if (scope === 'personal' && !trainer && !admin) return fail('prohibido', 403);
  let slug = `${src.slug}-copy`, n = 1;
  while (slugTaken(slug, null)) slug = `${src.slug}-copy-${++n}`;
  const copy = { ...clone(src), name: `${src.name} (copy)`, slug };
  delete copy.locales; delete copy.id;
  const r = assemble({ ...copy }, null, user, admin, scope);
  if (r.error) return r;
  const s = load();
  const mineCount = s.custom.filter(p => p.scope === 'personal' && p.createdBy === user.id).length;
  if (scope === 'personal' && mineCount >= MAX_PERSONAL) return fail('límite de programas propios alcanzado', 409);
  s.custom.push(stripSystem({ ...r.program, status: 'draft', featured: false, badge: null, publishedAt: null }));
  save();
  return { ok: true, program: summary(everything().find(p => p.id === r.program.id), { staff: true }) };
}

/** Admin: a trainer's personal program becomes a catalogue program (still a draft until published). The author keeps authorship. */
export function promote(user, id) {
  const s = load();
  const c = s.custom.find(x => x.id === id);
  if (!c) return fail('programa no encontrado', 404);
  if (c.scope !== 'personal') return fail('ya está en el catálogo', 409);
  c.scope = 'catalog'; c.status = 'draft'; c.updatedBy = user.id; c.updatedAt = now();
  save();
  return { ok: true, program: summary(everything().find(x => x.id === id), { staff: true }) };
}

/** Delete only what was never published nor used; everything else is archived (the history and any member's snapshot stay valid). */
export function remove(user, admin, id) {
  const s = load();
  const c = s.custom.find(x => x.id === id);
  if (!c) return everything().some(p => p.id === id) ? fail('los programas oficiales no se borran: archívalos', 409) : fail('programa no encontrado', 404);
  const denied = mustManage({ ...c, scope: c.scope }, user, admin); if (denied) return denied;
  if (c.publishedAt || (s.usage[id]?.started || 0) > 0) return fail('el programa se publicó o se usó: archívalo en lugar de borrarlo', 409, { code: 'in_use' });
  s.custom.splice(s.custom.indexOf(c), 1);
  delete s.history[id];
  save();
  return { ok: true };
}

/** A member started a program (best effort, reported by the app): lets the admin see use and keeps deletion honest. */
export function noteStarted(programId) {
  if (!everything().some(p => p.id === programId)) return;
  const s = load();
  const u = s.usage[programId] = s.usage[programId] || { started: 0 };
  u.started += 1; u.lastAt = now();
  save();
}

/** Puts a kept version back through the normal (validated) save path. Admin. */
export function restoreVersion(user, id, at) {
  const entry = (load().history[id] || []).find(e => e.at === at);
  const p = everything().find(x => x.id === id);
  if (!entry || !p) return fail('versión no encontrada', 404);
  return upsert(user, true, { ...clone(entry.snapshot), id });
}

export const contentOfProgram = contentOf;
