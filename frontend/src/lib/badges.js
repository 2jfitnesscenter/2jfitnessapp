// The badge evaluator — turns a profile's real history into unlock/progress state for every
// badge in badges-data.js. Every conditionType except 'first_action'-by-superset is a pure
// function of S (the whole store state), recomputed from scratch on every call rather than
// tracked incrementally — simplest to get right, and the only way that's automatically also
// correct for a CSV/Apple Health import that adds many workouts at once, or for an existing
// profile with years of history from before this feature shipped (see ensureBadgesCurrent).
import { BADGES } from './badges-data.js'
import { streakWeeks, modeOf } from './history.js'
import { rirOf } from './effort.js'
import { loadOfWorkouts, muscleOptsOf } from './muscles.js'
import { globalRank } from './rank.js'
import { GROUPS, GROUP_MUSCLES } from './recovery.js'

export const totalWorkouts = S => (S.workouts || []).length
export const totalVolumeKg = S => (S.workouts || []).reduce((a, w) => a + (w.vol || 0), 0)

// globalRank's own 0-24 continuous scale (lib/rank.js — 4 tiers-worth of intervals × 6
// divisions), rescaled to 0-300 so the brief's 100/150/200/250 thresholds land at sensible
// points across it (roughly Silver/Gold/Diamond/near-max) instead of introducing a second,
// unrelated strength formula. 0 while locked (fewer than GLOBAL_UNLOCK_MIN ranked lifts) —
// same gate the Rank screen itself uses, so a strength badge never unlocks off less data
// than the Rank screen would trust.
export function strengthScore(S) {
  const r = globalRank(S)
  return r.locked ? 0 : Math.round(r.continuous / 24 * 300)
}

// { exerciseId: number of distinct workouts it appears in with at least one done set } —
// the shared source for both exercise-breadth ("10 different exercises") and exercise-depth
// ("the same one 25 times") badges.
export function exerciseSessionCounts(S) {
  const counts = {}
  ;(S.workouts || []).forEach(w => {
    const seen = new Set()
    ;(w.entries || []).forEach(e => { if ((e.sets || []).some(s => s.done)) seen.add(e.id) })
    seen.forEach(id => { counts[id] = (counts[id] || 0) + 1 })
  })
  return counts
}
export const distinctExerciseCount = S => Object.keys(exerciseSessionCounts(S)).length
export const maxExerciseRepeatCount = S => Math.max(0, ...Object.values(exerciseSessionCounts(S)))

// A workout counts as "full body" once it has at least one done, non-warmup set touching
// each of recovery.js's four movement-pattern groups (push/pull/legs/core) — the same
// grouping the /recovery screen already uses to summarise a session, rather than inventing
// a second push/pull/legs taxonomy just for this badge.
export function isFullBodyWorkout(S, w) {
  const load = loadOfWorkouts([w], null, muscleOptsOf(S))
  return GROUPS.every(g => GROUP_MUSCLES[g].some(slug => (load[slug] || 0) > 0))
}
const hasDropSet = w => (w.entries || []).some(e => (e.sets || []).some(s => s.done && s.type === 'drop'))
const hasFailureSet = w => (w.entries || []).some(e => (e.sets || []).some(s => s.done && rirOf(s) === 0))
const hasCardio = w => (w.entries || []).some(e => modeOf({ ...(e.target || {}), id: e.id }) === 'cardio')

// The five 'first_action' milestones. Four are plain history scans (true the moment any past
// or present workout qualifies — CSV imports included). The superset check is the exception:
// a finished workout's entries drop their superset grouping (`sg`) once saved (see
// doFinishWorkout, sheets.jsx — only the live/just-finished session still has it), so that one
// only ever fires from `justFinishedLiveEntries`, never retroactively from S.workouts alone.
// An old workout that happened to include a superset before this feature existed just won't
// retroactively unlock it — there's genuinely no data left to detect it from.
const MILESTONE_CHECKS = {
  first_superset: (S, ctx) => (ctx.justFinishedLiveEntries || []).some(e => !!e.sg),
  first_dropset: S => (S.workouts || []).some(hasDropSet),
  first_cardio: S => (S.workouts || []).some(hasCardio),
  first_failure_set: S => (S.workouts || []).some(hasFailureSet),
  first_full_body: S => (S.workouts || []).some(w => isFullBodyWorkout(S, w)),
}

// One badge's current { value, target, unlocked } against S (+ ctx for the live-only checks).
function evalCondition(b, S, ctx) {
  switch (b.conditionType) {
    case 'total_workouts': { const v = totalWorkouts(S); return { value: v, target: b.threshold, unlocked: v >= b.threshold } }
    case 'weekly_streak': { const v = streakWeeks(S); return { value: v, target: b.threshold, unlocked: v >= b.threshold } }
    case 'total_volume_kg': { const v = totalVolumeKg(S); return { value: v, target: b.threshold, unlocked: v >= b.threshold } }
    case 'strength_score': { const v = strengthScore(S); return { value: v, target: b.threshold, unlocked: v >= b.threshold } }
    case 'specific_exercise_count': {
      const v = b.metric === 'repeat' ? maxExerciseRepeatCount(S) : distinctExerciseCount(S)
      return { value: v, target: b.threshold, unlocked: v >= b.threshold }
    }
    case 'first_action': {
      const check = MILESTONE_CHECKS[b.threshold]
      const done = !!check && check(S, ctx)
      return { value: done ? 1 : 0, target: 1, unlocked: done }
    }
    default: return { value: 0, target: 1, unlocked: false }
  }
}

/**
 * Re-evaluates every badge against S (which must already include whatever just
 * happened — the new workout pushed, the import merged in). Returns the next S.badges map
 * and the badges that transitioned from locked to unlocked just now (for the celebration —
 * see sheets.jsx's celebrateBadges). Call from inside the same update() mutation that just
 * changed S.workouts, assigning the result back to s.badges (see doFinishWorkout/doImport).
 *
 * `justFinishedLiveEntries` — the just-finished session's *pre-save* entries (S().active's,
 * before doFinishWorkout strips them down) — is the one piece of context that can't be read
 * back out of S itself; omit it (e.g. when evaluating after an import) and superset detection
 * simply can't fire this round, which is correct — an import never carries that information.
 */
export function evaluateBadges(S, { justFinishedLiveEntries } = {}) {
  const prev = S.badges || {}
  const next = { ...prev }
  const newlyUnlocked = []
  BADGES.forEach(b => {
    if (prev[b.id]?.unlockedAt) return   // already unlocked — never re-evaluates, never locks back
    const { value, target, unlocked } = evalCondition(b, S, { justFinishedLiveEntries })
    const progress = target > 0 ? Math.max(0, Math.min(1, value / target)) : (unlocked ? 1 : 0)
    if (unlocked) {
      next[b.id] = { badgeId: b.id, unlockedAt: new Date().toISOString(), progress: 1 }
      newlyUnlocked.push(b)
    } else if (progress !== (prev[b.id]?.progress || 0)) {
      next[b.id] = { badgeId: b.id, unlockedAt: null, progress }
    }
  })
  return { badges: next, newlyUnlocked }
}
