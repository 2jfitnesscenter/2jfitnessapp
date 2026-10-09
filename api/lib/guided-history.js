// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* A short memory for the official catalogue: before an admin changes an official routine, program or collection, the version it had is kept,
 * so a bad edit can be looked at and put back. Same idea as the member-plan versions (server.js snapshotVersionIfChanged: the old object, only
 * when the content really changed, capped per id) — not a CMS: ten versions per item, only for items that were edited, nothing for merchandising
 * (featured, order, badge), nothing for what a member does. Restoring goes through the normal save path, so it is validated like any edit. */

export const HISTORY_CAP = 10          // versions kept per item
export const HISTORY_ITEMS = 300       // items with a history; the least recently edited are forgotten first

// What counts as "the content" of each kind (a change to anything else is not worth a version).
const CONTENT = {
  routine: ['name', 'subtitle', 'description', 'category', 'goal', 'level', 'focus', 'purpose', 'cover', 'notes', 'ex', 'blocks', 'curatedTags', 'active', 'draft'],
  program: ['name', 'description', 'goal', 'level', 'cover', 'weeks', 'sessionsPerWeek', 'active', 'draft'],
  collection: ['name', 'description', 'style', 'routineIds', 'programIds', 'active'],
}
const clone = x => JSON.parse(JSON.stringify(x))
// `active` and `draft` have defaults (active unless false, draft only when true): a record that never wrote them equals one that wrote the default.
const valueOf = (o, k) => (k === 'active' ? o?.active !== false : k === 'draft' ? !!o?.draft : o?.[k] ?? null)
export const contentOf = (kind, o) => JSON.stringify(Object.fromEntries((CONTENT[kind] || []).map(k => [k, valueOf(o, k)])))

/** Keeps `before` as a version of `id` when `after` differs from it in content. Returns true when a version was kept. */
export function record(history, { kind, id, before, after, by, at }) {
  if (!CONTENT[kind] || !id || !before) return false
  if (contentOf(kind, before) === contentOf(kind, after)) return false
  const list = history[id] = Array.isArray(history[id]) ? history[id] : []
  const last = list[list.length - 1]
  if (last && contentOf(kind, last.snapshot) === contentOf(kind, before)) return false
  list.push({ at, by: by || null, kind, snapshot: clone(before) })
  if (list.length > HISTORY_CAP) list.splice(0, list.length - HISTORY_CAP)
  const ids = Object.keys(history)
  if (ids.length > HISTORY_ITEMS) {
    ids.sort((a, b) => String(history[a][history[a].length - 1]?.at).localeCompare(String(history[b][history[b].length - 1]?.at)))
    for (const old of ids.slice(0, ids.length - HISTORY_ITEMS)) delete history[old]
  }
  return true
}

const summary = e => {
  const s = e.snapshot
  return { name: s.name || null, status: s.draft ? 'draft' : s.active === false ? 'hidden' : 'active',
    ...(Array.isArray(s.ex) ? { exercises: s.ex.length } : {}), ...(Array.isArray(s.weeks) ? { weeks: s.weeks.length } : {}),
    ...(Array.isArray(s.routineIds) ? { routines: s.routineIds.length } : {}) }
}
/** The versions of one item, newest first, without their bodies. */
export const list = (history, id) => (history[id] || []).slice().reverse().map(e => ({ at: e.at, by: e.by, kind: e.kind, ...summary(e) }))
export const find = (history, id, at) => (history[id] || []).find(e => e.at === at) || null
export const drop = (history, id) => { delete history[id] }
