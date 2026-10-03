// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Seguimiento V2 (member side) — presentation of the follow-up the gym already runs. Data: GET /api/followup (the schedule only:
// template, cadence days, last and next review) plus the member's own weigh-ins. Dates and differences only: no score, no verdict.
import { useEffect, useState } from 'react'
import { api } from './api.js'
import { todayISO } from './format.js'
import { lastBW } from './history.js'

let cache = null
/** The member's own follow-up schedule (read-only; offline or no follow-up → undefined / { active:false }). */
export function useFollowUp() {
  const [fu, setFu] = useState(cache?.fu)
  useEffect(() => {
    if (cache && Date.now() - cache.at < 60000) { setFu(cache.fu); return }
    let live = true
    api('/api/followup').then(r => { cache = { fu: r, at: Date.now() }; if (live) setFu(r) }).catch(() => {})
    return () => { live = false }
  }, [])
  return fu
}

const DAY = 86400000
const dayDiff = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / DAY)

/**
 * overdue  the next review date has passed            due   within the next 7 days (or today)            ok  later / unknown
 * `weight`: the change since the last review, only if there is a weigh-in on/before it and a later one (never a made-up zero).
 */
export function followUpView(fu, S, today = todayISO()) {
  if (!fu?.active) return null
  const next = fu.nextReview || null, last = fu.lastReview || null
  const daysLeft = next ? dayDiff(today, next) : null
  const state = daysLeft == null ? 'ok' : daysLeft < 0 ? 'overdue' : daysLeft <= 7 ? 'due' : 'ok'
  let weight = null
  const bw = (S?.bodyweight || []).slice().sort((a, b) => a.d < b.d ? -1 : 1)
  const now = lastBW(S || {})
  if (last && now) {
    const base = [...bw].reverse().find(b => b.d <= last)
    if (base && now.d > base.d) weight = { delta: Math.round((now.w - base.w) * 10) / 10, now: now.w, since: base.d }
  }
  return { state, daysLeft, next, last, template: fu.template, days: fu.days, weight }
}
