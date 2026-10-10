// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { t as tt } from './i18n.js'

// Wording for Premium programs. Editorial text of a program is data (English base in the program itself, the Spanish copy in `locales.es`);
// the app's own words are plain English keys translated at render (t()), kept in closed maps so no key is ever built at runtime.

/** A program's text in the member's language: the English base, overlaid by the translation when there is one. */
export function copyOf(p, lang) {
  const base = { ...p, ...(p?.copy || {}) }
  const tr = lang && lang !== 'en' ? p?.locales?.[lang] || {} : {}
  return { ...base, ...tr }
}

export const LEVEL_KEY = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' }
export const BADGE_LABEL = { new: 'NEW', featured: 'Featured', recommended: 'Recommended' }
export const STATUS_LABEL = { draft: 'Draft', published: 'Published', hidden: 'Hidden', archived: 'Archived' }
export const SCOPE_LABEL = { official: '2J official', catalog: 'Catalogue', personal: 'Mine' }
export const PROGRESSION_TEXT = {
  'training-max-cycle': 'Loads are a percentage of a Training Max. At the end of each cycle 2J proposes a small increase and you confirm it.',
  'weekly-linear': 'Loads or reps go up a little every week inside the cycle.',
  tiered: 'Several tiers of work with different rep ranges; you move a tier up when you hit its target.',
  'double-progression': 'You add reps within a range; when you reach the top of the range you add load.',
  undulating: 'Heavy, moderate and light days rotate through the week; loads move with how the week goes.',
  linear: 'You add a small amount of load when you complete the target sets and reps.',
  none: 'No automatic progression: you choose the loads.',
}
export const REASON_LABEL = { finished: 'finished', switched: 'switched to another program' }

/** "5/3/1 · Cycle 3 · Week 2/4" from a premium summary. */
export const labelOfRun = s => (s ? `${s.name} · ${s.label.split(' · ').slice(1).map(x => x.replace(/^C(\d+)$/, 'Cycle $1').replace(/^W(\d+)\/(\d+)$/, 'Week $1/$2')).join(' · ')}` : '')

/** Where a cover is loaded from: a file shipped with the app, an upload of the app's media system (served by the API), or an https URL. Anything else → no cover (fallback art). */
export const coverSrc = p => {
  const c = String(p?.coverImage || '')
  if (c.startsWith('/premium/covers/') || /^https:\/\//i.test(c)) return c
  if (c.startsWith('media:')) return '/api/social/media?id=' + encodeURIComponent(c.slice(6))
  return null
}
export const GOAL_LABEL = { hypertrophy: 'Hypertrophy', strength: 'Strength', 'strength-muscle': 'Strength + muscle', recomposition: 'Recomposition', conditioning: 'Conditioning', health: 'Health' }
export const kickerOf = p => `${GOAL_LABEL[p?.goalTags?.[0]] || ''}|${LEVEL_KEY[p?.level] || ''}`

/** "5/3/1 · Cycle 3 · Week 2/4" for staff screens (the API sends the numbers, the wording is the app's own). */
export const runLabel = p => (p.cycle == null ? String(p.label || p.name || '') : `${p.name} · ${tt('Cycle {0}', p.cycle)} · ${tt('Week {0}/{1}', p.week, p.weeks)}`)
export const INCIDENT_LABEL = { paused: 'Paused', skipped: 'Sessions skipped', 'cycle-complete': 'Cycle complete: waiting for the member to confirm the next one', 'missing-training-max': 'A Training Max is missing' }
