// Progressive Overload Coach — a live, per-set companion to lib/progression.js's routine-level
// policy engine, not a replacement for it. `nextPrescription` (progression.js) decides what
// weight a whole SESSION starts at, once, when the workout is built, and only for exercises
// whose routine actually opted into a progression rule. This module answers a narrower,
// always-on question instead: right now, mid-set, with last time's numbers in front of you,
// what's a sane next target, and did what you just did beat it? No TypeScript in this project
// (plain .js/.jsx, no tsconfig) — documented the same way every other lib/*.js module is.
import { stepWeight } from './equipment.js'
import { estimate1RM, bestKnownOneRM } from './onerm.js'

/**
 * The two-branch coaching suggestion the brief asks for: hit the top of your rep target last
 * time -> suggest the next loadable weight up (lib/equipment.js's own stepWeight, so it's a
 * real barbell/dumbbell/machine jump, not a guessed "+1-2kg"), same reps; fell short -> hold
 * the weight and suggest one more rep. `topReps` is the exercise's configured rep ceiling (a
 * range's max, or the plain target reps) — null when there's no reference to compare against.
 */
export function suggestOverload(S, eq, last, topReps) {
  if (!last || !last.sets?.length) return null
  // The heaviest working set from last time is the one that actually tested the rep target —
  // an early back-off set shouldn't drive today's suggestion.
  const ref = last.sets.reduce((a, b) => (b.w || 0) > (a.w || 0) ? b : a, last.sets[0])
  if (!(ref.w > 0) || !(ref.r > 0)) return null
  const hitTop = topReps ? ref.r >= topReps : true
  return hitTop
    ? { w: stepWeight(S, eq, ref.w, 1), r: ref.r, strategy: 'weight' }
    : { w: ref.w, r: ref.r + 1, strategy: 'volume' }
}

/**
 * Did this just-logged set beat the equivalent one (same working-set position) from last time —
 * more weight at the same or better reps, or the same weight with more reps? Either counts as
 * "sobrecarga lograda"; a set with nothing to compare against (no prior set at that position)
 * never does.
 */
export function isOverloadSet(lastSet, set) {
  if (!lastSet || !set || !(set.w > 0) || !(set.r > 0)) return false
  if (!(lastSet.w > 0)) return false
  const moreWeight = set.w > lastSet.w && set.r >= lastSet.r
  const moreReps = set.w >= lastSet.w && set.r > lastSet.r
  return moreWeight || moreReps
}

/**
 * Does this set's estimated 1RM beat the exercise's best known 1RM on record? A weight-only
 * set (bodyweight, or more reps than onerm.js's REP_CAP can honestly estimate from) simply
 * never produces an estimate, so it never flags as a PR here — same restraint estimate1RM
 * itself applies everywhere else in the app.
 */
export function isPotentialPR(S, exId, set) {
  const est = estimate1RM(set.w, set.r)
  if (est == null) return false
  const best = bestKnownOneRM(S, exId)
  return best == null || est > best
}
