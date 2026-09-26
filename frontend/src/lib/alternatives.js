// Exercise alternatives — "Swap exercise" ranks the catalogue against one reference exercise
// instead of just browsing everything (see sheets.jsx's ExercisePicker, the plain add-exercise
// browser this reuses for its list styling but not its logic).
//
// No `movementPattern`/`targetMuscleGroup` field exists on the exercise dataset (it's a large
// scraped catalogue — hand-tagging every entry isn't realistic), and no TypeScript in this
// project either. Ranking instead reuses two fields the catalogue already has for certain:
//   tg  — primary target muscle (exact match is the strongest signal a swap is a genuine
//         like-for-like — same prime mover almost always means the same movement pattern too)
//   sm  — secondary muscles, compared via lib/muscles.js's musclesOf() so the overlap already
//         accounts for the app's own muscle-alias table instead of a second one
// `eq` (equipment) never gates a result out — a exercise on different equipment for the same
// muscle is exactly the "alternative with dumbbells" case the brief asks for — but it does
// break score ties and label the match.
import { EXIDX, allExercises, isUnavailable } from './exercises.js'
import { musclesOf, muscleOptsOf } from './muscles.js'

// 'exact' — same primary muscle AND same equipment (a true drop-in replacement)
// 'sameMuscle' — same primary muscle, different equipment (the common case: "I don't have a
//                barbell today, what else hits chest the same way")
// 'related' — no shared primary muscle, but real secondary-muscle overlap with the reference
export const MATCH_KEYS = ['exact', 'sameMuscle', 'related']

/**
 * Ranked alternatives for `exerciseId`, best match first. Excludes the exercise itself and
 * anything unavailable right now — gym-wide hidden by admin, or needing equipment currently
 * marked unavailable (lib/exercises.js's isUnavailable — a Smith-machine block must not offer
 * another Smith-machine exercise as the "fix"). Each result is
 * `{ ex, matchKey, sameEquipment }` — matchKey is one of MATCH_KEYS, sameEquipment tells the UI
 * whether to phrase a 'sameMuscle' result as "alternative with {equipment}".
 */
export function getExerciseAlternatives(S, exerciseId) {
  const ref = EXIDX[exerciseId]
  if (!ref) return []
  const muscleOpts = muscleOptsOf(S)
  const refMuscles = musclesOf(ref, muscleOpts)
  const results = []
  allExercises(S).forEach(e => {
    if (e.id === exerciseId || isUnavailable(e)) return
    const sameTarget = !!ref.tg && e.tg === ref.tg
    const sameEquipment = e.eq === ref.eq
    let overlap = 0
    const m = musclesOf(e, muscleOpts)
    for (const slug in refMuscles) if (m[slug]) overlap += Math.min(refMuscles[slug], m[slug])
    if (!sameTarget && overlap <= 0) return   // not a real alternative for this exercise
    const score = (sameTarget ? 100 : 0) + overlap * 20 + (sameEquipment ? 5 : 0)
    const matchKey = sameTarget ? (sameEquipment ? 'exact' : 'sameMuscle') : 'related'
    results.push({ ex: e, matchKey, sameEquipment, score })
  })
  results.sort((a, b) => b.score - a.score)
  return results.map(({ ex, matchKey, sameEquipment }) => ({ ex, matchKey, sameEquipment }))
}

/** The three user-facing levels in Change exercise V2. The complete catalogue is always the
 * same allExercises() source used everywhere else; relatedIds lets the UI warn discreetly when
 * someone deliberately chooses a movement outside the biomechanical suggestions. */
export function getReplacementGroups(S, exerciseId) {
  const alternatives = getExerciseAlternatives(S, exerciseId)
  const relatedById = new Map(alternatives.map(a => [a.ex.id, a]))
  const relatedIds = new Set(relatedById.keys())
  return {
    recommended: alternatives.slice(0, 8),
    related: alternatives,
    all: allExercises(S)
      .filter(ex => ex.id !== exerciseId && !isUnavailable(ex))
      .map(ex => ({ ex, matchKey: relatedById.get(ex.id)?.matchKey || 'unrelated' })),
    relatedIds,
  }
}

// The four quick filter pills the brief asks for. 'same' is resolved against the reference
// exercise's own `eq` at call time (see sheets.jsx); the other three are fixed equipment
// buckets — 'machine' covers both a leverage machine and a Smith machine, the two the catalogue
// actually uses for a machine-based strength alternative (cardio-only machines never turn up
// here since they share no muscle overlap with a strength exercise to begin with).
export const QUICK_FILTERS = [
  { key: 'same', label: 'Same equipment' },
  { key: 'dumbbell', label: 'Dumbbells', eq: ['dumbbell'] },
  { key: 'cable', label: 'Cables', eq: ['cable'] },
  { key: 'machine', label: 'Machines', eq: ['leverage machine', 'smith machine'] },
]
