// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// "What needs my attention today" (staff) — ranks members from the data the follow-up endpoints already return (alerts, next review, last workout,
// sessions per week). Counts, dates and the codes the server raised; no scores and no diagnosis. A member with nothing to flag is "on track".
const URGENT = new Set(['review_overdue', 'repeated_discomfort', 'high_fatigue'])
const isUrgent = a => URGENT.has(a.code) || (a.code === 'routine_review' && a.late)   // a routine review left for 2+ weeks
const WEIGHT = { review_overdue: 5, repeated_discomfort: 4, high_fatigue: 3, no_recent_workouts: 2, no_workouts_yet: 1, routine_review: 2 }

/**
 * rows: [{ user:{id,name,lastWorkout,...}, followUp, summary, alerts }] → { urgent, soon, onTrack } each sorted by what matters most.
 * urgent  = at least one urgent alert, or a review overdue          soon = review within 7 days, or inactive (no recent / no workouts)
 */
export function rankAttention(rows, today = new Date().toISOString().slice(0, 10)) {
  const days = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000)
  const out = { urgent: [], soon: [], onTrack: [] }
  for (const r of rows || []) {
    const alerts = r.alerts || []
    const score = alerts.reduce((n, a) => n + (WEIGHT[a.code] || 1) + (a.code === 'routine_review' && a.early ? 1 : 0), 0)
    const next = r.summary?.nextReview || null
    const reviewIn = next ? days(today, next) : null
    const item = { ...r, score, reviewIn, perWeek: r.summary?.perWeek ?? null, plannedPerWeek: r.summary?.plannedPerWeek ?? null,
      lastWorkout: r.summary?.lastWorkout || r.user?.lastWorkout || null }
    if (alerts.some(isUrgent)) out.urgent.push(item)
    else if (alerts.length || (reviewIn != null && reviewIn <= 7)) out.soon.push(item)
    else out.onTrack.push(item)
  }
  const byScore = (a, b) => b.score - a.score || String(a.user?.name || '').localeCompare(String(b.user?.name || ''))
  out.urgent.sort(byScore); out.soon.sort((a, b) => (a.reviewIn ?? 99) - (b.reviewIn ?? 99) || byScore(a, b)); out.onTrack.sort(byScore)
  return out
}
