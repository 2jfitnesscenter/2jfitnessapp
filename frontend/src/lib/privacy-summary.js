// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// "What can my friends see?" in one glance — a plain reading of the member's EXISTING social preferences (GET /api/social/preferences).
// Health, measurements and private notes are never part of the list: they are not shareable at all, and the card says so.
const ITEMS = [
  { key: 'prs', label: 'Personal records' },
  { key: 'achievements', label: 'Achievements' },
  { key: 'routines', label: 'Routines' },
  { key: 'workouts', label: 'Workouts' },
]
const AUDIENCE = { nobody: 'Nobody', private: 'Only you', friends: 'Friends', community: 'Community' }

/** → { profile, activity, items:[{key,label,on}], visibleCount, audience } ; null while preferences are unknown. */
export function privacySummary(prefs) {
  const p = prefs?.privacy
  if (!p) return null
  const items = ITEMS.map(i => ({ ...i, on: !!p[i.key] }))
  return { profile: AUDIENCE[p.profile] ? p.profile : 'friends', activity: AUDIENCE[p.activity] ? p.activity : 'friends', items, visibleCount: items.filter(i => i.on).length, audience: AUDIENCE }
}
