// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// The blocks of Home as a CLOSED catalogue, and the member's choice about them — the same pattern as lib/progress-cards.js. The choice lives in S.ux.home =
// { order?: string[], hidden?: string[] }, so it syncs across devices with the rest of the profile (Sync V2 keeps S opaque) and:
//   · absent (S.ux === null, a profile that never personalised, or one saved before this existed) → Home is exactly what it always was: same blocks, same order;
//   · hidden: only blocks marked `optional` can be hidden (a review that is due, the gym's follow-up and its announcements are never switched off by a layout);
//   · order: the member's sequence — ids it does not know are ignored and blocks it does not list (e.g. one added in a later release) keep their default place.
// Each block still applies its own data/feature gates; this only decides "shown by choice" and "where". The greeting at the top, the invitation to personalise
// and the welcome card of an empty profile are structural and not part of the catalogue.
export const HOME_BLOCKS = [
  { id: 'readiness', label: 'Readiness', icon: 'heart', optional: true },
  { id: 'review', label: 'Routine review', icon: 'history' },
  { id: 'followup', label: 'Follow-up', icon: 'chartLine' },
  { id: 'news', label: 'News & notices', icon: 'bell' },
  { id: 'week', label: 'My week', icon: 'calendar', optional: true },
  { id: 'reorder', label: 'Week suggestions', icon: 'calendar' },
  { id: 'train2j', label: 'Train with 2J', icon: 'dumbbell', optional: true, feature: 'train2j' },
  { id: 'premium', label: 'Premium training', icon: 'trophy', optional: true, feature: 'premium' },
  { id: 'coach', label: 'Coach', icon: 'sparkles', optional: true, feature: 'coach' },
  { id: 'intelligence', label: 'Today for you', icon: 'bolt', optional: true },
]
export const HOME_IDS = HOME_BLOCKS.map(b => b.id)
const KNOWN = new Set(HOME_IDS)
const OPTIONAL = new Set(HOME_BLOCKS.filter(b => b.optional).map(b => b.id))

/** The stored choice, cleaned: known ids only, no repeats, and only optional blocks can be hidden. Anything malformed is ignored (→ defaults). */
export function normalizeHome(h) {
  const list = (x, ok) => (Array.isArray(x) ? [...new Set(x.filter(i => typeof i === 'string' && ok.has(i)))] : [])
  return { order: list(h?.order, KNOWN), hidden: list(h?.hidden, OPTIONAL) }
}

/** The member's sequence merged with the defaults: listed blocks first in their order; any block they do not list goes after its default predecessor. */
export function homeOrder(S) {
  const { order } = normalizeHome(S?.ux?.home)
  const out = [...order]
  HOME_IDS.forEach((id, i) => {
    if (out.includes(id)) return
    let at = 0
    for (let k = i - 1; k >= 0; k--) { const p = out.indexOf(HOME_IDS[k]); if (p >= 0) { at = p + 1; break } }
    out.splice(at, 0, id)
  })
  return out
}

/** Blocks to draw, in order (the member's hidden ones removed). */
export function visibleHomeBlocks(S) {
  const { hidden } = normalizeHome(S?.ux?.home)
  return homeOrder(S).filter(id => !hidden.includes(id))
}

/** What to store for a layout: nothing when it equals the default (so an untouched profile stays untouched, and "restore" really clears it). */
export function homeChoice(order, hidden) {
  const n = normalizeHome({ order, hidden })
  const isDefault = !n.hidden.length && n.order.length === HOME_IDS.length && n.order.every((id, i) => id === HOME_IDS[i])
  return isDefault ? undefined : n
}
export const defaultHomeLayout = () => ({ order: [...HOME_IDS], hidden: [] })
