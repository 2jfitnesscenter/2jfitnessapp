// The Push/Pull/Legs starter plan. Shared by the "Load starter plan" action in Settings
// and by the demo build, which seeds a history on top of exactly these routines.
import { uid } from './format.js'

const SPEC = [
  ['Push Day', 'barbell', [['0025', 4, 8], ['0047', 3, 10], ['0426', 3, 10], ['0334', 3, 12], ['0241', 3, 12], ['0251', 3, 10]]],
  ['Pull Day', 'pullup', [['2330', 4, 10], ['0027', 4, 8], ['1323', 3, 10], ['0031', 3, 10], ['0313', 3, 12]]],
  ['Leg Day', 'legs', [['0043', 4, 8], ['0085', 3, 10], ['0739', 3, 12], ['0585', 3, 12], ['0586', 3, 12], ['0605', 4, 15]]]
]

// Fresh routine objects (new ids) — [push, pull, legs]. Used as-is by the demo build's seeded
// history (frontend/src/lib/demoSeed.js) — keep this zero-arg and general-purpose; goal/day
// customization lives in buildPlan below instead of changing this signature.
export const starterRoutines = () =>
  SPEC.map(([name, emoji, list]) => ({ id: uid(), name, emoji, ex: list.map(([id, sets, reps]) => ({ id, sets, reps, weight: 0 })) }))

/* ---------------------------------------------------------------------------------------
 * Goal-aware plan builder — the same Push/Pull/Legs exercise selection, but the rep range,
 * set count and how many days a week it runs are chosen from what was actually asked for
 * instead of the fixed 3-days/general-fitness defaults above.
 *
 * Deliberately mirrors the rep/set table in api/coach/prompts/create.md — a quick plan and
 * an AI Coach plan should mean the same thing by "strength" or "hypertrophy". The api/
 * server.js admin endpoint (apply-starter-plan) duplicates this table too, for the same
 * reason payload.js duplicates other frontend logic: the two runtimes share no build step.
 * ------------------------------------------------------------------------------------- */
export const GOALS = ['strength', 'muscle', 'general', 'fatloss', 'endurance']
// [reps, sets] for the routine's first (compound) exercise vs the rest (accessories).
export const GOAL_RULES = {
  strength: { compound: [5, 5], accessory: [6, 3], superset: false },
  muscle: { compound: [8, 4], accessory: [10, 4], superset: false },
  general: { compound: [10, 3], accessory: [12, 3], superset: false },
  fatloss: { compound: [10, 3], accessory: [12, 3], superset: true },
  endurance: { compound: [15, 2], accessory: [15, 2], superset: false }
}

/**
 * @param {string} goal one of GOALS — falls back to 'general' if unrecognised
 * @param {number[]} days weekday numbers (0=Sunday..6=Saturday) to schedule, in order.
 *   The 3 routines cycle across them — 3 days is once each, 6 is twice each, 2 or 4 means
 *   the cycle doesn't divide evenly and simply continues where it left off.
 */
export function buildPlan(goal, days) {
  const rules = GOAL_RULES[goal] || GOAL_RULES.general
  const routines = SPEC.map(([name, emoji, list]) => {
    const ex = list.map(([id], i) => {
      const [reps, sets] = i === 0 ? rules.compound : rules.accessory
      return { id, sets, reps, weight: 0 }
    })
    // Density over rest for fat loss: pair up consecutive accessories (skipping the
    // compound at index 0) as supersets, two at a time.
    if (rules.superset) {
      for (let i = 1; i + 1 < ex.length; i += 2) { const tag = 'a' + i; ex[i].sg = tag; ex[i + 1].sg = tag }
    }
    return { id: uid(), name, emoji, ex }
  })
  const week = {}
  ;(days || []).forEach((d, i) => { week[d] = routines[i % routines.length].id })
  return { routines, week }
}
