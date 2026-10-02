// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// The three Home indicators (Training · Activity · Recovery), derived only from data the member already has.
// Visibility = admin 'activity' switch ∧ member preference ∧ data presence (lib/features.js decides the first two; this
// module decides the third: an indicator with nothing real behind it is simply not returned).
import { weekKey, todayISO } from './format.js'
import { activeWeek } from './history.js'
import { recoveryOf, overallRecovery, recoveryColor } from './recovery.js'
import { dailyActivity } from './health-bridge.js'
import { uxOn } from './features.js'

// Daily steps are shown against a common reference only to give the ring a shape; the member's number is what is
// displayed. Nothing medical is implied — it is not a target set by 2J.
export const STEPS_REFERENCE = 10000

export function trainingIndicator(S, iso = todayISO()) {
  const done = (S.workouts || []).filter(w => weekKey(w.d) === weekKey(iso)).length
  const planned = Object.values(activeWeek(S)).filter(Boolean).length
  if (!planned && !done) return null
  return { key: 'training', label: 'Training', icon: 'dumbbell', color: 'var(--acc)',
    value: planned ? Math.min(1, done / planned) : 1, text: planned ? `${done}/${planned}` : String(done), done, planned }
}

export function activityIndicator(uid, now = Date.now()) {
  const a = dailyActivity(uid, now)
  if (!a || (a.steps == null && a.activeKcal == null)) return null
  if (a.steps != null) return { key: 'activity', label: 'Activity', icon: 'figureRun', color: 'var(--orange)',
    value: Math.min(1, a.steps / STEPS_REFERENCE), text: new Intl.NumberFormat().format(a.steps), unit: 'steps' }
  return { key: 'activity', label: 'Activity', icon: 'figureRun', color: 'var(--orange)', value: Math.min(1, a.activeKcal / 600), text: String(a.activeKcal), unit: 'kcal' }
}

export function recoveryIndicator(S) {
  if (!(S.workouts || []).length) return null   // nothing to recover from yet
  const v = overallRecovery(recoveryOf(S))
  return { key: 'recovery', label: 'Recovery', icon: 'bolt', color: recoveryColor(v), value: v / 100, text: v + '%' }
}

/** [] when the indicators are off (admin or member) or when no indicator has data. */
export function homeIndicators(S, uid, now = Date.now()) {
  if (!uxOn(S, 'activity')) return []
  return [
    trainingIndicator(S),
    uxOn(S, 'health') ? activityIndicator(uid, now) : null,
    uxOn(S, 'recovery') ? recoveryIndicator(S) : null,
  ].filter(Boolean)
}
