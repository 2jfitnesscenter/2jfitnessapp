// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { countsForProgression } from './workout-policy.js'
// Routine review loop (Seguimiento V4): routine → real workouts → plateau detection → a review notice. Pure and deterministic — no AI, no I/O —
// so the member's app and the server compute exactly the same thing (api/lib/routine-review.js mirrors its rules).
// It NEVER edits a routine, a load or a program: it only says "this routine is worth a look", and why, from numbers the member already logged.
//
// Cycle of a routine (nothing is stored when it starts — it is derived, so old data needs no migration):
//   Staff may set the dates by hand (S.routineReviews[id].startOverride / dueOverride, additive — absent = automatic). A manual start replaces the derived one; a
//   manual review date replaces the week-5/week-4 rule for that cycle. "Reviewed" clears both and restarts the cycle; setCycleDates(…, null) goes back to automatic.
//   start  = the latest of: the day the member/staff marked it reviewed (S.routineReviews[id].reviewedAt) and the day staff last replaced it (the newest
//            S.routineVersions[id] snapshot); with neither, the date of its first logged workout. No workout and no mark → no cycle, no notice.
//   week   = floor(days since start / 7) + 1.   Review is due from week 5; from week 4 when the plateau is clear. Needs ≥ MIN_SESSIONS sessions.
//
// Plateau rules (per routine, over the sessions of the current cycle; a single bad session can never trigger any of them):
//   stalled exercise   ≥ 4 exposures and the best of the LAST 3 has not beaten the best of all EARLIER ones by ≥ 2 % (estimated 1RM, or reps when unloaded)
//   repeated misses    ≥ 2 of the last 3 exposures of an exercise had a set marked "couldn't do it" or ≥ 2 sets under the rep target
//   effort getting up  ≥ 4 exposures with RPE/RIR logged: the last 2 average ≥ 1.0 RPE harder than the first 2 at a similar load (±5 %), each of them ≥ 0.5 harder
//   hard sessions      ≥ 2 of the last 3 routine sessions rated mostly "hard / couldn't" (≥ 2 rated sets, ≥ 50 % of them)
//   incomplete         ≥ 2 of the last 3 routine sessions finished < 70 % of the planned working sets (needs a planned-sets target)
//   CLEAR plateau      (stalled ≥ 2 exercises AND ≥ half of the evaluable ones) OR (stalled ≥ 1 AND at least one of the other four signals)
export const REVIEW_WEEK = 5
export const EARLY_WEEK = 4
export const MIN_SESSIONS = 3
export const LATE_DAYS = 14

const ISO = /^\d{4}-\d{2}-\d{2}$/
const DAY = 86400000
const day = iso => Date.parse(iso + 'T12:00:00Z')
const daysBetween = (a, b) => Math.round((day(b) - day(a)) / DAY)
const addDays = (iso, n) => new Date(day(iso) + n * DAY).toISOString().slice(0, 10)
const isoOfMs = ms => new Date(ms).toISOString().slice(0, 10)
const num = x => (typeof x === 'number' && Number.isFinite(x) ? x : null)

const isWork = s => s && s.done && s.type !== 'warmup'
const effortOf = s => (num(s?.rpe) != null ? s.rpe : num(s?.rir) != null ? 10 - s.rir : null)
const score = s => { const w = num(s.w), r = num(s.r); return r > 0 ? (w > 0 ? w * (1 + r / 30) : r) : null }   // Epley estimate; reps when unloaded
const repFloor = entry => {
  const tg = entry?.target || {}
  const top = num(Number(tg.targetRepsMax || tg.reps)) || null
  if (!top) return null
  return Math.min(num(Number(tg.targetRepsMin || tg.repsMin)) || top, top)
}
const entriesOf = w => (Array.isArray(w?.entries) ? w.entries : []).filter(e => e && typeof e === 'object')
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null)

const isDate = x => ISO.test(x || '') && new Date(day(x)).toISOString().slice(0, 10) === x && x >= '2000-01-01' && x <= '2100-12-31'

/** Start of the current cycle of routine `r`, or null when it has not started. { start, source: 'manual'|'reviewed'|'version'|'first', exclusive } */
export function cycleStart(S, r) {
  const id = r?.id
  if (!id) return null
  if (isDate(S?.routineReviews?.[id]?.startOverride)) return { start: S.routineReviews[id].startOverride, source: 'manual', exclusive: false }
  const reviewed = S?.routineReviews?.[id]?.reviewedAt
  const versions = Array.isArray(S?.routineVersions?.[id]) ? S.routineVersions[id] : []
  const lastVersion = versions.reduce((m, v) => (num(v?.versionedAt) && v.versionedAt > m ? v.versionedAt : m), 0)
  const candidates = []
  if (ISO.test(reviewed || '')) candidates.push({ start: reviewed, source: 'reviewed', exclusive: true })
  if (lastVersion) candidates.push({ start: isoOfMs(lastVersion), source: 'version', exclusive: true })
  if (candidates.length) return candidates.reduce((a, b) => (b.start >= a.start ? b : a))
  let first = null
  for (const w of S?.workouts || []) if (countsForProgression(w) && w?.routineId === id && ISO.test(w.d || '') && (!first || w.d < first)) first = w.d
  return first ? { start: first, source: 'first', exclusive: false } : null
}

/** The routine's logged sessions inside the cycle, oldest first. */
export function cycleSessions(S, r, cycle, today) {
  if (!cycle) return []
  return (S?.workouts || [])
    .filter(w => countsForProgression(w) && w?.routineId === r.id && ISO.test(w.d || '') && (cycle.exclusive ? w.d > cycle.start : w.d >= cycle.start) && w.d <= today)
    .filter(w => !(Array.isArray(w.entries) && w.entries.some(e => e?.target?.deload)))      // a deload-week session is deliberately light: not evidence about the plan
    .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : (a.start || 0) - (b.start || 0)))
}

function exposures(sessions) {
  const by = new Map()
  for (const w of sessions) {
    for (const e of entriesOf(w)) {
      if (!e.id || e.target?.deload) continue
      const sets = (Array.isArray(e.sets) ? e.sets : []).filter(isWork)
      if (!sets.length) continue
      if (!by.has(e.id)) by.set(e.id, [])
      by.get(e.id).push({ d: w.d, entry: e, sets })
    }
  }
  return by
}

/** Plateau signals of one routine's cycle. Always returns an object; `clear` is the decision, `reasons` the numbers behind it. */
export function plateau(sessions) {
  const by = exposures(sessions)
  let evaluable = 0
  const stalled = [], misses = [], effortUp = []
  for (const [id, list] of by) {
    const best = ex => Math.max(0, ...ex.sets.map(score).filter(x => x != null))
    if (list.length >= 4) {
      evaluable++
      const recent = list.slice(-3), earlier = list.slice(0, -3)
      const base = Math.max(...earlier.map(best)), now = Math.max(...recent.map(best))
      if (base > 0 && now < base * 1.02) stalled.push(id)
    }
    const last3 = list.slice(-3)
    const missed = ex => {
      const floor = repFloor(ex.entry)
      return ex.sets.some(s => s.feel === 'fail') || (floor != null && ex.sets.filter(s => num(s.r) != null && s.r < floor).length >= 2)
    }
    if (last3.length === 3 && last3.filter(missed).length >= 2) misses.push(id)
    const withEffort = list.filter(ex => ex.sets.some(s => effortOf(s) != null))
    if (withEffort.length >= 4) {
      const avg = ex => mean(ex.sets.map(effortOf).filter(x => x != null))
      const load = ex => mean(ex.sets.map(s => num(s.w)).filter(x => x != null && x > 0))
      const a = withEffort.slice(0, 2), b = withEffort.slice(-2)
      const la = mean(a.map(load).filter(x => x != null)), lb = mean(b.map(load).filter(x => x != null))
      const similar = la == null || lb == null ? la == lb : Math.abs(lb - la) / la <= 0.05
      const base = mean(a.map(avg))
      if (similar && mean(b.map(avg)) - base >= 1 && b.every(x => avg(x) - base >= 0.5)) effortUp.push(id)   // both recent exposures, not one bad day
    }
  }
  const last3 = sessions.slice(-3)
  const rated = w => entriesOf(w).flatMap(e => (Array.isArray(e.sets) ? e.sets : []).filter(s => isWork(s) && s.feel))
  const hardSession = w => { const r = rated(w); return r.length >= 2 && r.filter(s => s.feel === 'hard' || s.feel === 'fail').length / r.length >= 0.5 }
  const hard = last3.length === 3 ? last3.filter(hardSession).length : 0
  const planned = w => entriesOf(w).reduce((n, e) => n + (num(e?.target?.sets) || 0), 0)
  const doneSets = w => entriesOf(w).reduce((n, e) => n + (Array.isArray(e.sets) ? e.sets : []).filter(isWork).length, 0)
  const incomplete = last3.length === 3 ? last3.filter(w => planned(w) >= 3 && doneSets(w) < planned(w) * 0.7).length : 0
  const supporting = { misses: misses.length, effortUp: effortUp.length, hard: hard >= 2 ? hard : 0, incomplete: incomplete >= 2 ? incomplete : 0 }
  const others = Object.values(supporting).some(n => n > 0)
  const clear = (stalled.length >= 2 && stalled.length * 2 >= evaluable) || (stalled.length >= 1 && others)
  const reasons = []
  if (stalled.length) reasons.push({ code: 'stalled', n: stalled.length, of: evaluable })
  if (supporting.misses) reasons.push({ code: 'misses', n: supporting.misses })
  if (supporting.effortUp) reasons.push({ code: 'effort_up', n: supporting.effortUp })
  if (supporting.hard) reasons.push({ code: 'hard', n: supporting.hard })
  if (supporting.incomplete) reasons.push({ code: 'incomplete', n: supporting.incomplete })
  return { clear, evaluable, stalled, reasons }
}

/**
 * Review state of every routine the member has started. status: 'idle' (too few sessions) · 'ok' · 'soon' (week 4, no plateau) · 'early' (week 4, clear plateau)
 * · 'due' (week 5+). `reasons` start with { code: 'week' , week } for a normal review and carry the plateau numbers. `late` = due for ≥ LATE_DAYS days.
 */
export function routineReviews(S, today) {
  const out = []
  for (const r of S?.routines || []) {
    const cycle = cycleStart(S, r)
    if (!cycle) continue
    const sessions = cycleSessions(S, r, cycle, today)
    const days = Math.max(0, daysBetween(cycle.start, today))
    const week = Math.floor(days / 7) + 1
    const manualDue = S?.routineReviews?.[r.id]?.dueOverride
    const dueManual = isDate(manualDue) && manualDue >= cycle.start ? manualDue : null
    const dueDate = dueManual || addDays(cycle.start, (REVIEW_WEEK - 1) * 7)
    const base = { routineId: r.id, name: r.name || '', start: cycle.start, source: cycle.source, startManual: cycle.source === 'manual', dueDate, dueManual: !!dueManual, week, days, sessions: sessions.length }
    if (dueManual) {      // the staff date decides, whatever the session count or plateau
      const p0 = plateau(sessions)
      const left = daysBetween(today, dueManual)
      if (left <= 0) out.push({ ...base, status: 'due', early: false, late: -left >= LATE_DAYS, reasons: [{ code: 'date', due: dueManual }, ...p0.reasons] })
      else out.push({ ...base, status: left <= 7 ? 'soon' : 'ok', early: false, late: false, reasons: p0.reasons })
      continue
    }
    if (sessions.length < MIN_SESSIONS) { out.push({ ...base, status: 'idle', reasons: [] }); continue }
    const p = plateau(sessions)
    if (week >= REVIEW_WEEK) out.push({ ...base, status: 'due', early: false, late: daysBetween(dueDate, today) >= LATE_DAYS, reasons: [{ code: 'week', week }, ...p.reasons] })
    else if (week >= EARLY_WEEK && p.clear) out.push({ ...base, status: 'early', early: true, late: false, reasons: p.reasons })
    else if (week >= EARLY_WEEK) out.push({ ...base, status: 'soon', early: false, late: false, reasons: p.reasons })
    else out.push({ ...base, status: 'ok', reasons: p.reasons })
  }
  return out
}

/** Reviews that need a notice now (due, or advanced by a clear plateau), most overdue first. */
export const pendingReviews = (S, today) =>
  routineReviews(S, today).filter(r => r.status === 'due' || r.status === 'early').sort((a, b) => b.days - a.days)

/** "Rutina revisada" (staff): closes the notice and restarts the cycle from today; the manual dates of the closed cycle are cleared. Writes only S.routineReviews. */
export function markReviewed(S, routineId, today, by) {
  if (!(S?.routines || []).some(r => r.id === routineId) || !isDate(today)) return false
  S.routineReviews = S.routineReviews || {}
  const prev = S.routineReviews[routineId]
  S.routineReviews[routineId] = { reviewedAt: today, by: by || 'staff', n: (prev?.n || 0) + 1 }
  return true
}

/**
 * Manual control of the cycle (staff). patch = { start?, due? }: a YYYY-MM-DD sets it, null / '' goes back to automatic, undefined leaves it. Additive fields on
 * S.routineReviews[id]; nothing else is written and the routine is never touched. false when the routine is unknown, a date is invalid, or review < start.
 */
export function setCycleDates(S, routineId, patch, by) {
  const r = (S?.routines || []).find(x => x.id === routineId)
  if (!r || !patch || typeof patch !== 'object') return false
  const cur = { ...(S.routineReviews?.[routineId] || {}) }
  for (const [k, field] of [['start', 'startOverride'], ['due', 'dueOverride']]) {
    const v = patch[k]
    if (v === undefined) continue
    if (v === null || v === '') delete cur[field]
    else if (isDate(v)) cur[field] = v
    else return false
  }
  const probe = { ...S, routineReviews: { ...(S.routineReviews || {}), [routineId]: cur } }
  const start = cycleStart(probe, r)?.start
  if (cur.dueOverride && start && cur.dueOverride < start) return false
  if (cur.startOverride || cur.dueOverride) cur.manualBy = by || 'staff'; else delete cur.manualBy
  S.routineReviews = S.routineReviews || {}
  if (Object.keys(cur).length) S.routineReviews[routineId] = cur; else delete S.routineReviews[routineId]
  if (!Object.keys(S.routineReviews).length) delete S.routineReviews
  return true
}
