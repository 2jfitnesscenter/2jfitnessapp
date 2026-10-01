// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* Exercise Library admin — the gym-wide overlay of the admin's corrections to the 2J layer.
 *
 * One small file, DATA/library-admin.json, outside every member's synced state (like
 * gym-profile.json and guided.json): names, aliases, canonical movement, equipment, Recommended
 * 2J and duplicate decisions an admin curates in the app instead of in code. The rules (what may
 * change, no chains or cycles, same movement, unambiguous names) are the pure module the client
 * runs too (library-overlay.js, generated from the frontend); they run here before anything is
 * written, so the UI is never the only gate.
 *
 * Identity never changes: an exercise is its dataset id. A "duplicate" is only ever deprecated →
 * preferred: it keeps resolving everywhere (history, PRs, plans) and is hidden from new selection.
 * Nothing here deletes a record or rewrites a workout.
 *
 * The effective library (code + overlay) is what the server reads: the AI payload, the check that
 * official content never uses a duplicate, and /api/config for every client.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { MOVEMENT_BY_ID, EQUIPMENT_BY_ID, EQUIPMENT_OVERRIDE } from './protocol/movements.js';
import * as O from './library-overlay.js';

const require_ = createRequire(import.meta.url);
const LIB = require_('../coach/library.json').exercises;
const BASE_BY_ID = new Map(LIB.map(e => [e.id, e]));
const BASE_EQUIPMENT = { ...EQUIPMENT_OVERRIDE };
const file = () => path.join(process.env.DATA_DIR || '/data', 'library-admin.json');

// Which exercises active official content uses (blocks, routines, programs' routines). Wired by
// server.js so this module does not import the stores that import it.
let usage = () => false;
export const setUsageProbe = fn => { usage = typeof fn === 'function' ? fn : () => false; };

export function baseContext() {
  return {
    has: id => BASE_BY_ID.has(id),
    allIds: () => LIB.map(e => e.id),
    movements: new Set(Object.keys(MOVEMENT_BY_ID)),
    equipment: new Set(Object.keys(EQUIPMENT_BY_ID)),
    baseMovement: id => BASE_BY_ID.get(id)?.mv || null,
    basePref: id => BASE_BY_ID.get(id)?.pref || null,
    baseNames: () => { const m = new Map(); for (const e of LIB) m.set(O.norm(e.n), [...(m.get(O.norm(e.n)) || []), e.id]); return m; },
    baseAliases: () => { const m = new Map(); for (const e of LIB) for (const a of e.al || []) m.set(O.norm(a), e.id); return m; },
    usedByOfficial: id => usage(id),
  };
}

let state = null;
function build(overlay) {
  for (const k of Object.keys(EQUIPMENT_OVERRIDE)) delete EQUIPMENT_OVERRIDE[k];
  Object.assign(EQUIPMENT_OVERRIDE, BASE_EQUIPMENT);
  const entries = LIB.map(e => {
    const o = overlay.entries[e.id];
    if (!o) return e;
    const out = { ...e };
    if (o.n) out.n = o.n;
    if (o.movement === '') delete out.mv; else if (o.movement) out.mv = o.movement;
    if (o.preferredId === false) delete out.pref; else if (o.preferredId) out.pref = o.preferredId;
    if (o.recommended === true) out.rec = 1; else if (o.recommended === false) delete out.rec;
    if (out.pref) delete out.rec;                 // a duplicate is never recommended
    if (o.aliases?.length) out.al = [...new Set([...(e.al || []), ...o.aliases])];
    if (o.equipment) EQUIPMENT_OVERRIDE[e.id] = o.equipment;
    return out;
  });
  return { overlay, entries, byId: new Map(entries.map(e => [e.id, e])) };
}

export function load() {
  if (state) return state;
  let raw = null;
  try { raw = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { /* absent = nothing curated yet */ }
  // A release can change the code's decisions under a stored overlay: entries that no longer hold
  // are ignored one by one (the file itself is not rewritten until the next admin edit).
  state = build(O.sanitizeAgainstBase(raw, baseContext()));
  return state;
}
export function resetCache() { state = null; }

export const overlay = () => load().overlay;
/** The effective library: code + overlay, same record shape as coach/library.json. */
export const entries = () => load().entries;
export const byId = id => load().byId.get(id) || null;
export const prefOf = id => load().byId.get(id)?.pref || null;
export const isDeprecated = id => !!prefOf(id);
/** What every client may read: the overlay without the admin-only curatorial notes. */
export function publicOverlay() {
  const o = overlay();
  const entries_ = {};
  for (const [id, e] of Object.entries(o.entries)) { const { note: _note, ...rest } = e; if (Object.keys(rest).length) entries_[id] = rest; }
  return { v: o.v, rev: o.rev, entries: entries_, variants: o.variants };
}

/** One admin edit ({ id, patch } | { id, reset } | { variant: [a, b], keep }). */
export function edit(input) {
  const cur = overlay();
  const r = O.applyEdit(cur, input, baseContext());
  if (!r.ok) return { error: r.error, errors: r.errors, status: 400 };
  const target = file(), tmp = target + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(r.overlay));
  fs.renameSync(tmp, target);
  state = build(r.overlay);
  return { overlay: r.overlay };
}
