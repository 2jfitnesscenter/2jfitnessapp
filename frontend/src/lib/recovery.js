// Muscle recovery — a 0-100% "how ready is this muscle" estimate per muscles.js slug, shown on
// Home and the /recovery detail screen. This is a documented estimate, not a physiological
// model (same caveat the reference this was modeled on states about itself).
//
// Method: walk the last 7 days of S.workouts. Every DONE, reps-mode set (time/cardio sets are
// left out entirely, same as the reference this follows) contributes
//   musclesOf(ex)[slug] * (reps / STANDARD_REPS)
// to that muscle's fatigue — reusing muscles.js's existing primary(1)/secondary(0.4) weighting,
// with reps/STANDARD_REPS standing in for time-under-tension (a 5-rep set counts half of a
// 10-rep set, a 20-rep set counts double) rather than pulling in kg — loadOf() in muscles.js
// already deliberately ignores weight for the same reason (100kg leg press vs 12kg lateral
// raise says nothing about which muscle worked harder). Each set's contribution is then scaled
// by an exponential recency weight so recent sessions dominate: HALF_LIFE_DAYS old counts half.
// A warmup set (see history.js's `type`) is excluded — it was never meant to be real fatiguing
// work. A failure or drop set still counts fully; both are genuine work, not a data point about
// "to failure" or drop-set intensity that this estimate tries to weigh any differently.
import { EXIDX } from './exercises.js'
import { musclesOf, muscleOptsOf, MUSCLES, MUSCLE_NAME } from './muscles.js'
import { modeOf } from './history.js'

const WINDOW_DAYS = 7
const STANDARD_REPS = 10
const HALF_LIFE_DAYS = 2
// How much fresh fatigue (in reps-weighted effective sets) drops a muscle to 0% recovered.
// Tunable — there's no "correct" value, just a reasonable feel: ~4 sets of 10 on a muscle's
// primary mover today reads as fully fatigued, recovering back up over the following days.
const MAX_FATIGUE = 6

const dayMs = 24 * 60 * 60 * 1000
const recencyWeight = daysAgo => Math.pow(0.5, Math.max(0, daysAgo) / HALF_LIFE_DAYS)

/** { slug: 0-100 } recovery for every muscle in MUSCLES, from the member's own workout log. */
export function recoveryOf(S) {
  const now = Date.now()
  const cutoff = now - WINDOW_DAYS * dayMs
  const fatigue = {}
  const muscleOpts = muscleOptsOf(S)
  ;(S.workouts || []).forEach(w => {
    const at = w.start || new Date(w.d + 'T12:00:00').getTime()
    if (at < cutoff) return
    const daysAgo = (now - at) / dayMs
    const weight = recencyWeight(daysAgo)
    ;(w.entries || []).forEach(e => {
      const ex = EXIDX[e.id]
      if (!ex) return
      const mode = modeOf({ ...(e.target || {}), id: e.id })
      if (mode !== 'reps') return   // time/cardio work isn't counted, same as the reference
      const m = musclesOf(ex, muscleOpts)
      ;(e.sets || []).forEach(s => {
        if (!s.done || !s.r || s.type === 'warmup') return
        const contribution = (s.r / STANDARD_REPS) * weight
        for (const slug in m) fatigue[slug] = (fatigue[slug] || 0) + m[slug] * contribution
      })
    })
  })
  const recovery = {}
  MUSCLES.forEach(slug => {
    const f = fatigue[slug] || 0
    recovery[slug] = Math.round(100 * Math.max(0, Math.min(1, 1 - f / MAX_FATIGUE)))
  })
  return recovery
}

/** Simple average across every muscle — the one number for a Home-card ring. */
export const overallRecovery = recovery =>
  Math.round(MUSCLES.reduce((s, m) => s + (recovery[m] ?? 100), 0) / MUSCLES.length)

// Four movement-pattern groups for the detail screen, matching common push/pull/legs framing
// plus a core bucket for abs/obliques (which fit neither push nor pull).
export const GROUPS = ['push', 'pull', 'legs', 'core']
export const GROUP_LABEL = { push: 'Push muscles', pull: 'Pull muscles', legs: 'Leg muscles', core: 'Core' }
export const GROUP_MUSCLES = {
  push: ['chest', 'deltoids', 'triceps'],
  pull: ['trapezius', 'upper-back', 'serratus', 'biceps', 'forearm', 'lower-back'],
  legs: ['quadriceps', 'hamstring', 'gluteal', 'adductors', 'hip-flexors', 'calves', 'tibialis'],
  core: ['abs', 'obliques']
}

export { MUSCLE_NAME }
