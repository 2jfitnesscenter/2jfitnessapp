// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* Entrena tus Oposiciones — the profile catalogue (OppositionProfile: body, convocatoria, official tests, marks and the official source).
 *
 * Same arrangement as the Premium catalogue (lib/premium-store.js): global, administrator-authored data in its own file (DATA/opposition.json), never in a
 * member's synced state. The official seed is the versioned api/lib/opposition-official.json (scripts/build-opposition-profiles.mjs), read from the release
 * on every boot; an administrator's edits (an overlay keyed by id) are never overwritten by a new seed.
 *
 * Who may do what (checked here, on the server): administrators create, edit, version, publish, hide and archive profiles; trainers and members only READ
 * the published ones. A profile is never edited in place when it matters: any change of tests, marks, scoring, categories or official source is a NEW VERSION
 * (the previous one is kept in the history), and a member's plan pins the version it was built on, so a new convocatoria never changes a plan under way.
 * Nothing is deleted if it was published or used: it is archived.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import * as model from './opposition-model.js';

const require_ = createRequire(import.meta.url);
const SEED = require_('./opposition-official.json');
const DATA = process.env.DATA_DIR || '/data';
const FILE = () => path.join(process.env.DATA_DIR || DATA, 'opposition.json');
export const MAX_CUSTOM = 60;
export const HISTORY_CAP = 12;

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
const now = () => new Date().toISOString();
const clone = x => JSON.parse(JSON.stringify(x));
const newId = () => 'opp-' + crypto.randomBytes(5).toString('hex');
const fail = (error, status = 400, extra = {}) => ({ error, status, ...extra });

/* ------------------------------------------------------------------------------------------------ reading */
const CURATION = ['status', 'order', 'publishedAt'];
function officialList() {
  const { overrides } = load();
  return SEED.profiles.map(p => {
    const o = overrides[p.id];
    const base = o?.full ? { ...clone(o.full), id: p.id, sourceKind: 'official', createdBy: p.createdBy, createdAt: p.createdAt } : clone(p);
    const out = { ...base, scope: 'official', seedChanged: !!o?.full && (o.seedVersion || 0) < SEED.seedVersion };
    for (const k of CURATION) { if (o && k in o) out[k] = o[k]; else if (o?.full) out[k] = p[k]; }
    return out;
  });
}
const customList = () => load().custom.map(p => ({ ...clone(p), scope: 'custom', sourceKind: 'custom' }));
const everything = () => [...officialList(), ...customList()].map((p, i) => [p, i]).sort((a, b) => (a[0].order ?? 1e6) - (b[0].order ?? 1e6) || a[1] - b[1]).map(x => x[0]);

/** Admin sees every profile; everyone else the published ones (the plan of someone already following a hidden one lives in their own state). */
const canSee = (p, admin) => admin || p.status === 'published';

const summary = (p, { staff = false } = {}) => {
  const { tests, ...rest } = p;
  return { ...rest, tests: tests.map(t => ({ id: t.id, name: t.name, capacity: t.capacity, movement: t.movement, kind: t.kind, unit: t.unit, only: t.only || null })),
    usage: staff ? (load().usage[p.id] || { started: 0 }) : undefined };
};

export function listFor({ admin = false } = {}) {
  return everything().filter(p => canSee(p, admin)).map(p => summary(p, { staff: admin }));
}
export function detail(idOrSlug, { admin = false } = {}) {
  const p = everything().find(x => x.id === idOrSlug || x.slug === idOrSlug);
  return p && canSee(p, admin) ? p : null;
}

/* ------------------------------------------------------------------------------------------------ history */
function remember(id, before, by) {
  const h = load().history;
  const list = h[id] = Array.isArray(h[id]) ? h[id] : [];
  list.push({ at: now(), by: by || null, version: before.version, status: before.status, snapshot: clone(before) });
  if (list.length > HISTORY_CAP) list.splice(0, list.length - HISTORY_CAP);
}
export const historyOf = id => (load().history[id] || []).slice().reverse().map(e => ({ at: e.at, by: e.by, version: e.version, status: e.status, name: e.snapshot.name, sourceDate: e.snapshot.source?.date || null, reference: e.snapshot.source?.reference || null }));
export const versionOf = (id, version) => (load().history[id] || []).find(e => e.version === version)?.snapshot || null;

/* ------------------------------------------------------------------------------------------------ writing (administrator only: the route checks the role before anything else) */
const slugTaken = (slug, exceptId) => everything().some(p => p.slug === slug && p.id !== exceptId);
const slugify = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
const stripSystem = p => { const { seedChanged, sourceKind, scope, ...rest } = p; return rest; };

/** Creates or edits a profile. A change of tests/marks/scoring/categories/source is a new version; a rename or a note is not. `dryRun` validates only. */
export function upsert(user, input = {}, { dryRun = false } = {}) {
  const s = load();
  const existing = input.id ? everything().find(p => p.id === String(input.id)) : null;
  if (input.id && !existing) return fail('perfil no encontrado', 404);
  if (!existing && s.custom.length >= MAX_CUSTOM) return fail('límite de perfiles alcanzado', 409);
  const clean = model.sanitizeProfile(input);
  if (!clean.slug && clean.name) clean.slug = slugify(clean.name);
  const profile = {
    ...clean,
    id: existing?.id || newId(),
    version: existing ? existing.version : 1,
    status: existing ? existing.status : 'draft',
    order: existing?.order ?? null,
    sourceKind: existing?.sourceKind || 'custom', scope: existing?.scope || 'custom',
    createdBy: existing?.createdBy || user.id, createdAt: existing?.createdAt || now(), updatedBy: user.id, updatedAt: now(), publishedAt: existing?.publishedAt || null,
  };
  const issues = model.validateProfile(profile);
  if (slugTaken(profile.slug, profile.id)) issues.push('slug-taken');
  if (issues.length) return fail('perfil no válido', 400, { issues: [...new Set(issues)] });
  const bump = !!existing && model.needsNewVersion(existing, profile);
  if (bump) profile.version = existing.version + 1;
  if (dryRun) return { ok: true, dryRun: true, newVersion: bump, changes: existing ? model.diffProfiles(existing, profile) : [], profile };
  if (existing) {
    if (bump) remember(existing.id, existing, user.id);
    if (existing.scope === 'official') {
      const o = s.overrides[existing.id] = s.overrides[existing.id] || {};
      const { status, order, publishedAt, scope: _s, seedChanged, ...full } = profile;
      o.full = full; o.seedVersion = SEED.seedVersion;
    } else s.custom[s.custom.findIndex(p => p.id === existing.id)] = stripSystem(profile);
  } else s.custom.push(stripSystem(profile));
  save();
  return { ok: true, newVersion: bump, profile: summary(everything().find(p => p.id === profile.id), { staff: true }) };
}

/** draft ↔ published ↔ hidden ↔ archived. Publishing re-validates (an official source with organism, reference and date is mandatory). */
export function setStatus(user, id, status) {
  if (!model.STATUSES.includes(status)) return fail('estado no válido');
  const p = everything().find(x => x.id === id);
  if (!p) return fail('perfil no encontrado', 404);
  if (status === 'published') {
    const issues = model.validateProfile({ ...p, status: 'published' });
    if (issues.length) return fail('perfil no válido', 400, { issues });
  }
  if (p.status === status) return { ok: true, profile: summary(p, { staff: true }) };
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
  return { ok: true, profile: summary(everything().find(x => x.id === id), { staff: true }) };
}

/** Delete only what was never published nor used; everything else is archived (the history and any member's pinned snapshot stay valid). */
export function remove(user, id) {
  const s = load();
  const c = s.custom.find(x => x.id === id);
  if (!c) return everything().some(p => p.id === id) ? fail('los perfiles oficiales no se borran: archívalos', 409) : fail('perfil no encontrado', 404);
  if (c.publishedAt || (s.usage[id]?.started || 0) > 0) return fail('el perfil se publicó o se usó: archívalo en lugar de borrarlo', 409, { code: 'in_use' });
  s.custom.splice(s.custom.indexOf(c), 1);
  delete s.history[id];
  save();
  return { ok: true };
}

/** A member started a plan on this profile (best effort, reported by the app): keeps deletion honest. */
export function noteStarted(profileId) {
  if (!everything().some(p => p.id === profileId)) return;
  const s = load();
  const u = s.usage[profileId] = s.usage[profileId] || { started: 0 };
  u.started += 1; u.lastAt = now();
  save();
}
