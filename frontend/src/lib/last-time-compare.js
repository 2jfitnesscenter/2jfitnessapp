// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// "Compare with last time" on the finish screen (optional, off by default). For each exercise of the
// just-finished session, whether its best working set went up, stayed the same or went down against
// the previous session of that exercise. Display only: nothing here reads a stored figure it could
// change, and nothing it returns is written anywhere.
//
// "Best set" = heaviest working load, then most reps at that load. Load is the first criterion because
// it is what a member progresses on; reps only break a tie at the same weight, so a bodyweight or
// reps-only exercise (w = 0) still compares by reps. Total volume was rejected: a session with one extra
// easy set would read as "up" even when every heavy set got lighter.
import { recentEntriesFor, workingSets } from './history.js'

// The heaviest done working set (warmups and drops never count), or null when nothing was done.
export function bestSetOf(sets) {
  let best = null
  for (const s of workingSets(sets)) {
    if (!s.done) continue
    const w = Number(s.w) || 0
    const r = Number(s.r) || 0
    if (!best || w > best.w || (w === best.w && r > best.r)) best = { w, r }
  }
  return best
}

// 'up' | 'same' | 'down' comparing two best sets; null when either side is missing (no label then).
export function compareBest(cur, prev) {
  if (!cur || !prev) return null
  if (cur.w !== prev.w) return cur.w > prev.w ? 'up' : 'down'
  if (cur.r !== prev.r) return cur.r > prev.r ? 'up' : 'down'
  return 'same'
}

// Per exercise of `w` (a saved workout already in S.workouts): { id, trend } for each exercise that has
// a previous session to compare with. The previous session is the most recent earlier one that
// logged the same exercise id, found by the same walk the progression engine uses (recentEntriesFor);
// "earlier" means it ended before `w` started, as previousSession() in components/PostWorkoutSummary.jsx does.
export function lastTimeComparison(S, w) {
  const at = w.start || w.end || Infinity
  const earlier = { workouts: (S.workouts || []).filter(x => x.id !== w.id && (x.end || 0) <= at) }
  const out = []
  for (const en of w.entries || []) {
    const prev = recentEntriesFor(earlier, en.id, 1)[0]
    const trend = compareBest(bestSetOf(en.sets), prev && bestSetOf(prev.sets))
    if (trend) out.push({ id: en.id, trend })
  }
  return out
}
