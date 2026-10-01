// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Exercise Library quality, as data: which records need a curator's eye and why. Pure and
// deterministic (no model): the admin tool lists them, the API enforces what may change.
import { EXDB } from './exercises.js'
import { facets, isRecommended, isDeprecated, MOVEMENT_BY_ID, EQUIPMENT_BY_ID } from './library/index.js'
import { aliasesOf, norm } from './library/core.js'
import { REVIEWED_VARIANTS } from './library/overrides.js'
import { api } from './api.js'
import { applyAdminOverlay } from './library/overlay-sync.js'

export const QUALITY_FILTERS = ['duplicate', 'noMovement', 'deprecated', 'noMedia', 'ambiguousEquipment', 'oddName', 'noAlias', 'recommended', 'notRecommended']
export const FILTER_LABEL = {
  duplicate: 'Possible duplicate', noMovement: 'No movement', deprecated: 'Deprecated', noMedia: 'No media', ambiguousEquipment: 'Ambiguous equipment',
  oddName: 'Odd name', noAlias: 'Recommended without alias', recommended: 'Recommended 2J', notRecommended: 'Not recommended',
}

const STOP = new Set(['the', 'a', 'an', 'with', 'on', 'of', 'and', 'v', '2', '3'])
const words = n => new Set(norm(n).split(' ').filter(w => w && !STOP.has(w)))
const jaccard = (a, b) => { let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i || 1) }
// Mojibake, doubled spaces, upstream "v. 2" suffixes, shouting or a stub of a name.
export const oddName = n => {
  const s = String(n || '')
  return !s.trim() || s.length < 4 || s.length > 64 || /[ÃÂ�]/.test(s) || /\s{2,}/.test(s) || /[A-Z]{5,}/.test(s) || /^[\W_]|[-–—.,:;/\\_]$/.test(s.trim())
}

/** One row per live-or-deprecated dataset record with its flags; `groups` lists likely duplicates. */
export function qualityIndex(list = EXDB) {
  const rows = []
  const kept = new Set(REVIEWED_VARIANTS.map(p => [...p].sort().join('|')))
  const buckets = new Map()
  for (const ex of list) {
    const f = facets(ex)
    const flags = new Set()
    const dep = isDeprecated(ex.id)
    if (dep) flags.add('deprecated')
    if (!dep && !f?.movement) flags.add('noMovement')
    if (!ex.gif && !ex.img) flags.add('noMedia')
    if (!f?.equipment || f.equipment === 'custom' || f.equipment === 'ergometer') flags.add('ambiguousEquipment')
    if (oddName(ex.n)) flags.add('oddName')
    const rec = isRecommended(ex.id)
    flags.add(rec ? 'recommended' : 'notRecommended')
    if (rec && !aliasesOf(ex.id).length) flags.add('noAlias')
    const row = { id: ex.id, ex, f, flags, rec, dep, dupes: [] }
    rows.push(row)
    if (!dep && f?.movement) {
      const k = [f.movement, f.equipment, f.variant, f.uni, f.angle].join('|')
      if (!buckets.has(k)) buckets.set(k, [])
      buckets.get(k).push({ row, w: words(ex.n) })
    }
  }
  for (const group of buckets.values()) for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
    const a = group[i], b = group[j]
    if (jaccard(a.w, b.w) >= 0.9 && !kept.has([a.row.id, b.row.id].sort().join('|'))) { a.row.dupes.push(b.row.id); b.row.dupes.push(a.row.id); a.row.flags.add('duplicate'); b.row.flags.add('duplicate') }
  }
  return rows
}

export const countsOf = rows => Object.fromEntries(QUALITY_FILTERS.map(k => [k, rows.reduce((n, r) => n + (r.flags.has(k) ? 1 : 0), 0)]))
export const movementName = id => MOVEMENT_BY_ID[id]?.label || ''
export const equipmentName = id => (id === 'custom' ? 'Custom' : EQUIPMENT_BY_ID[id]?.label || '')

/** Rows matching every active filter and the text (name, alias, id). */
export function filterQuality(rows, { filters = [], q = '' } = {}) {
  const needle = norm(q)
  return rows.filter(r => filters.every(k => r.flags.has(k))
    && (!needle || r.id === needle || norm(r.ex.n).includes(needle) || aliasesOf(r.id).some(a => norm(a).includes(needle))))
}

/** Persist one edit and apply the answer locally, so the whole app reflects it at once. */
export async function saveLibraryEdit(body) {
  const r = await api('/api/admin/library/save', { method: 'POST', body: JSON.stringify(body) })
  applyAdminOverlay(r.overlay)
  return r
}
export async function loadAdminOverlay() {
  const r = await api('/api/admin/library')
  applyAdminOverlay(r.overlay)
  return r.overlay
}
