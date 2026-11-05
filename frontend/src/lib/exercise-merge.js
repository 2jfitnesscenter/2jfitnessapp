// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Merge two exercises by redirection (owner-approved). The merged-away exercise is stored ONLY as a personal mapping in the
// member's state, S.exMerges = { fromId: toId } (a normal personal key, saved through the existing Sync V2 path).
// Nothing stored is rewritten: workouts, history, PRs, routine snapshots and notes keep their original ids. Every view that
// displays or aggregates an exercise by id resolves it through exResolverOf(S) — one helper, no ad-hoc lookups.
// Rules: chains resolve (A→B, B→C gives C); a cycle is refused when the mapping is created; a mapping whose target no longer
// exists is ignored (the original id is shown). Undo removes the mapping and the original reappears with its old data.
import { EXIDX } from './exercises.js'

export const MERGES_KEY = 'exMerges'

/** The stored mapping, sanitised: only non-empty string → string entries that point somewhere else. */
export function mergeMapOf(S) {
  const raw = S?.[MERGES_KEY]
  const out = {}
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const from of Object.keys(raw)) {
      const to = raw[from]
      if (typeof to === 'string' && to && to !== from) out[from] = to
    }
  }
  return out
}

/** Does an exercise id exist for this member: catalogue or one of their own custom exercises. */
export const existsIn = S => id => !!EXIDX[id] || (S?.customEx || []).some(c => c && c.id === id)

/**
 * Follow the mapping from `id` to its final target. Stops at an id without a mapping, at a repeat
 * (a cycle that somehow got stored is cut, never looped) and at a target that does not exist
 * (that link is ignored, so the last existing id is shown).
 */
export function resolveExId(map, id, exists = () => true) {
  let cur = id
  const seen = new Set([id])
  for (;;) {
    const next = map[cur]
    if (!next || seen.has(next) || !exists(next)) return cur
    seen.add(next)
    cur = next
  }
}

/** The resolver for one member's state: id → the exercise id to show. Identity when nothing is merged. */
export function exResolverOf(S) {
  const map = mergeMapOf(S)
  if (!Object.keys(map).length) return id => id
  const exists = existsIn(S)
  return id => resolveExId(map, id, exists)
}

/** Ids the member has merged away, with the mapping in effect (their target exists). They stay out of lists, still resolve. */
export function mergedAwayIds(S) {
  const map = mergeMapOf(S), exists = existsIn(S)
  return Object.keys(map).filter(from => resolveExId(map, from, exists) !== from)
}

/** Why `from` cannot be merged into `to` (a short Spanish reason), or null when it can. */
export function mergeProblem(S, from, to) {
  if (!from || !to) return 'missing'
  if (from === to) return 'self'
  const exists = existsIn(S)
  if (!exists(from) || !exists(to)) return 'missing'
  const map = mergeMapOf(S)
  if (map[from] && resolveExId(map, from, exists) !== from) return 'already'
  // Adding from→to closes a loop exactly when `to` already leads back to `from` (followed on the raw mapping).
  if (resolveExId(map, to) === from) return 'cycle'
  return null
}

export const MERGE_PROBLEM_TEXT = {
  missing: 'Uno de los dos ejercicios ya no está en tu biblioteca.',
  self: 'Elige otro ejercicio para la fusión.',
  already: 'Ese ejercicio ya está fusionado. Deshaz la fusión primero si quieres cambiarla.',
  cycle: 'Esa fusión crearía un bucle entre ejercicios. Elige otro destino.',
}

/**
 * Draft mutation for a state producer (update(s => …)): record from → to. Returns the problem code, or null when saved.
 * Only S.exMerges is touched; no workout, history entry, PR, routine or note is modified.
 */
export function mergeExercise(s, from, to) {
  const problem = mergeProblem(s, from, to)
  if (problem) return problem
  s[MERGES_KEY] = { ...mergeMapOf(s), [from]: to }
  return null
}

/** Draft mutation: remove the mapping for `from` (undo). Returns true when something was removed. */
export function unmergeExercise(s, from) {
  const map = { ...mergeMapOf(s) }
  if (!(from in map)) return false
  delete map[from]
  if (Object.keys(map).length) s[MERGES_KEY] = map
  else delete s[MERGES_KEY]
  return true
}

/** The mappings in effect, for the Library's list: [{ from, to }]. */
export function activeMerges(S) {
  const map = mergeMapOf(S), exists = existsIn(S)
  return mergedAwayIds(S).map(from => ({ from, to: resolveExId(map, from, exists) }))
}
