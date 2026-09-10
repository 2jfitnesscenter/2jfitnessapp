// The Push/Pull/Legs starter plan. Shared by the "Load starter plan" action in Settings
// and by the demo build, which seeds a history on top of exactly these routines.
import { uid } from './format.js'

const SPEC = [
  ['Push Day', 'barbell', [['0025', 4, 8], ['0047', 3, 10], ['0426', 3, 10], ['0334', 3, 12], ['0241', 3, 12], ['0251', 3, 10]]],
  ['Pull Day', 'pullup', [['2330', 4, 10], ['0027', 4, 8], ['1323', 3, 10], ['0031', 3, 10], ['0313', 3, 12]]],
  ['Leg Day', 'legs', [['0043', 4, 8], ['0085', 3, 10], ['0739', 3, 12], ['0585', 3, 12], ['0586', 3, 12], ['0605', 4, 15]]]
]

// A second pass through the same 3 days, same body parts and slot order as SPEC (so
// GOAL_RULES' compound/accessory-by-index logic still applies identically), but different
// specific exercises — for 4-6 day plans, where the 3-routine pool has to run more than once
// a week. Reusing SPEC verbatim on a repeat day looked like a bug (same routine, same id,
// same exercises on two different weekdays) rather than a deliberate higher-frequency week.
const SPEC_B = [
  ['Push Day B', 'barbell', [['0289', 4, 8], ['0314', 3, 10], ['0405', 3, 10], ['0178', 3, 12], ['0060', 3, 12], ['0308', 3, 10]]],
  ['Pull Day B', 'pullup', [['0818', 4, 10], ['3017', 4, 8], ['0861', 3, 10], ['0070', 3, 10], ['0165', 3, 12]]],
  ['Leg Day B', 'legs', [['0046', 4, 8], ['1459', 3, 10], ['0760', 3, 12], ['0585', 3, 12], ['0599', 3, 12], ['0594', 4, 15]]]
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
 * The 6 goals and their rep/set/RIR ranges come from Juanjo's own reference table (exact
 * source, not an approximation) and are deliberately mirrored in api/coach/prompts/create.md
 * — a quick plan and an AI Coach plan should mean the same thing by "hypertrophy" or "power".
 * The api/server.js admin endpoint (apply-starter-plan) duplicates this table too, for the
 * same reason payload.js duplicates other frontend logic: the two runtimes share no build step.
 *
 * The table gives one series/rep/RIR range per exercise, not a compound-vs-accessory split —
 * this app's routines put the main lift first and accessories after, so the compound side
 * below uses the lower-reps/higher-sets end of each range (more work on the exercise that
 * matters most) and accessory uses the higher-reps/lower-sets end. RIR/RPE has no field in the
 * plan schema (sets/reps/weight only) — it's carried in create.md as guidance for the AI Coach
 * to write into its own `why` text and pacing, not something this deterministic tool can set.
 * ------------------------------------------------------------------------------------- */
export const GOALS = ['hypertrophy', 'toning', 'fatloss', 'power', 'plyometrics', 'longevity']
// [reps, sets] for the routine's first (compound) exercise vs the rest (accessories).
export const GOAL_RULES = {
  hypertrophy: { compound: [8, 4], accessory: [12, 3], superset: false },
  toning: { compound: [10, 4], accessory: [15, 3], superset: false },
  fatloss: { compound: [8, 4], accessory: [12, 3], superset: true },
  power: { compound: [3, 5], accessory: [5, 3], superset: false },
  // Juanjo's framing: plyometrics here means loaded strength patterns done explosively,
  // combining strength with power — not bodyweight jump-contact training — so it uses the
  // same barbell/dumbbell pool as every other goal rather than needing its own exercise set.
  plyometrics: { compound: [5, 4], accessory: [5, 3], superset: false },
  longevity: { compound: [10, 3], accessory: [12, 2], superset: false }
}

function makeRoutine(spec, slot, rules) {
  const [name, emoji, list] = spec[slot]
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
}

// Which of the 3 SPEC slots (0=Push, 1=Pull, 2=Legs) each muscle-priority pick (see
// frontend/src/lib/muscle-priority.js) actually trains here. `abs` isn't covered by any of the 3
// PPL days, so it can't move which day gets picked — it only ever matters to the AI Coach,
// which builds exercise-by-exercise instead of picking between 3 fixed templates.
const MUSCLE_ROUTINE = {
  chest: 0, shoulders: 0, triceps: 0,
  back: 1, biceps: 1,
  quads: 2, glutes: 2, hamstrings: 2, calves: 2
}

// Ranks the 3 routine slots by how much the member's priorities point at them — primary picks
// count double a secondary one. Ties keep the natural Push→Pull→Legs order, so with no
// priorities set this is just [0, 1, 2] and every plan behaves exactly as before.
function routineOrder(primary, secondary) {
  const score = [0, 0, 0]
  ;(primary || []).forEach(m => { const s = MUSCLE_ROUTINE[m]; if (s !== undefined) score[s] += 2 })
  ;(secondary || []).forEach(m => { const s = MUSCLE_ROUTINE[m]; if (s !== undefined) score[s] += 1 })
  return [0, 1, 2].sort((a, b) => score[b] - score[a] || a - b)
}

/**
 * @param {string} goal one of GOALS — falls back to 'longevity' if unrecognised
 * @param {number[]} days weekday numbers (0=Sunday..6=Saturday) to schedule, in order.
 * @param {string[]} [primary] muscle slugs (muscles.js) the member most wants to prioritize.
 * @param {string[]} [secondary] muscle slugs they want a smaller bump to.
 *
 * With no priorities, the 3 routines run in the natural Push→Pull→Legs order: 2 or 3 days
 * picks that many of the 3, 4-6 days cycles back through them (see SPEC_B above for how a
 * repeat day avoids literally reusing the same routine). With priorities set, the routine(s)
 * that train the prioritized muscles are the ones kept when the day count is under 3, and the
 * ones repeated first when it's over 3 — so "quads/glutes" at 4 days a week gets Push, Pull,
 * Legs, Legs(B) instead of a second Push day, and at 2 days a week gets Push+Legs instead of
 * dropping Legs entirely.
 */
export function buildPlan(goal, days, primary, secondary) {
  const rules = GOAL_RULES[goal] || GOAL_RULES.longevity
  const order = routineOrder(primary, secondary)
  const n = (days || []).length
  let slots
  if (n <= 3) {
    const chosen = new Set(order.slice(0, n))
    slots = [0, 1, 2].filter(s => chosen.has(s))
  } else {
    slots = [0, 1, 2]
    for (let extra = 0; slots.length < n; extra++) slots.push(order[extra % 3])
  }
  const routines = []
  const week = {}
  ;(days || []).forEach((d, i) => {
    const slot = slots[i]
    const lap = slots.slice(0, i).filter(s => s === slot).length
    const r = makeRoutine(lap === 0 ? SPEC : SPEC_B, slot, rules)
    routines.push(r)
    week[d] = r.id
  })
  return { routines, week }
}
