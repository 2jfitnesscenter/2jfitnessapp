// Blocks: reusable, versioned templates of a few prescribed exercises. A master block is never
// referenced live by a routine — inserting one copies its entries into the day (a snapshot)
// tagged with an instance id, so editing the day never touches the library and deleting a
// block never breaks a routine. Pure helpers shared by the builder, the server and the seed.
import { PROTOCOL_VERSION } from './rules.js'
import { classify } from './classify.js'
import { estimateSeconds, roundMinutes, restDemand, REST_DEFAULTS } from './prescribe.js'

export const FOCUS = ['glutes', 'quads', 'hamstrings', 'calves', 'chest', 'back', 'shoulders', 'biceps', 'triceps', 'arms',
  'abs', 'posterior', 'lower', 'upper', 'push', 'pull', 'fullbody', 'cardio']
// Labels are English source strings rendered through t() (Spanish in locales/es.js).
export const FOCUS_LABEL = {
  glutes: 'Glutes', quads: 'Quads', hamstrings: 'Hamstrings', calves: 'Calves', chest: 'Chest', back: 'Back muscles',
  shoulders: 'Shoulders', biceps: 'Biceps', triceps: 'Triceps', arms: 'Arms', abs: 'Core', posterior: 'Posterior chain',
  lower: 'Lower body', upper: 'Upper body', push: 'Push', pull: 'Pull', fullbody: 'Full body', cardio: 'Cardio',
}
export const GOAL_LABEL = { hypertrophy: 'Hypertrophy', strength: 'Strength', general: 'General', endurance: 'Muscular endurance', power: 'Power', beginner: 'Start / return' }
export const LEVEL_LABEL = { beginner: 'Novice', intermediate: 'Intermediate', advanced: 'Advanced' }
export const TYPE_LABEL = { strength: 'Straight sets', superset: 'Superset', circuit: 'Circuit', cardio: 'Cardio', interval: 'Intervals', hiit: 'HIIT', mobility: 'Mobility' }
export const STYLE_LABEL = {
  stable: 'Stable', mixed: 'Mixed', unilateral: 'Unilateral', tension: 'Tension', free: 'Free weights', machine: 'Machines',
  isolation: 'Isolation', density: 'Density', heavy: 'Heavy', volume: 'Volume', foundation: 'Foundation', athletic: 'Athletic',
  pairs: 'Pairs', steady: 'Steady', 'unilateral-isolation': 'Unilateral + isolation', lengthened: 'Long position', 'upper-focus': 'Upper chest',
  vertical: 'Vertical pull', horizontal: 'Horizontal pull', 'hip-dominant': 'Hip dominant', 'knee-dominant': 'Knee dominant', 'low-impact': 'Low impact',
}

/** "Glúteo · Hipertrofia · Intermedio B" — built from metadata so it follows the UI language. */
export function blockTitle(b, t = s => s) {
  if (b.name) return b.name
  const parts = [t(FOCUS_LABEL[b.focus] || b.focus), t(GOAL_LABEL[b.goal] || b.goal)]
  if (b.level) parts.push(t(LEVEL_LABEL[b.level] || b.level) + (b.variant ? ' ' + b.variant : ''))
  return parts.join(' · ')
}
export const blockSubtitle = (b, t = s => s) => b.style ? t(STYLE_LABEL[b.style] || b.style) : ''

/** Metadata computed from the entries, never trusted from input. */
export function deriveBlockMeta(b, lookup) {
  const ex = b.ex || []
  const groups = {}, equipment = new Set()
  ex.forEach(e => {
    const c = classify(e.id, lookup)
    if (c.group && !c.cardio) groups[c.group] = (groups[c.group] || 0) + (Number(e.sets) || 1)
    if (c.eq) equipment.add(c.eq)
  })
  const muscles = Object.entries(groups).sort((a, b) => b[1] - a[1]).map(([g]) => g)
  const seconds = estimateSeconds(ex, e => e.rest ?? REST_DEFAULTS[restDemand(classify(e.id, lookup), b.goal, e.role)])
  return { muscles, equipment: [...equipment].sort(), exerciseCount: ex.length, estimatedMinutes: roundMinutes(seconds) }
}

const rid = () => Math.random().toString(36).slice(2, 10)

/**
 * Copy a master block into a routine: fresh instance id on every entry, fresh superset ids
 * (so two inserts of the same block never merge their pairs), metadata snapshot for the day.
 */
export function instantiateBlock(b, t = s => s, newId = rid) {
  const iid = 'k' + newId()
  const sgMap = {}
  const ex = (b.ex || []).map(e => {
    const out = { ...JSON.parse(JSON.stringify(e)), blk: iid }
    if (e.sg) out.sg = sgMap[e.sg] || (sgMap[e.sg] = 'sg' + newId())
    delete out.why
    return out
  })
  const meta = {
    iid, src: b.id || null, name: blockTitle(b, t), type: b.type || 'strength', goal: b.goal || null, level: b.level || null,
    focus: b.focus || null, variant: b.variant || null, style: b.style || null, v: b.protocolVersion || PROTOCOL_VERSION,
  }
  return { meta, ex }
}

/** Drop block metadata that no longer has entries (after deletes/moves). */
export function pruneBlocks(routine) {
  const used = new Set((routine.ex || []).map(e => e.blk).filter(Boolean))
  return (routine.blocks || []).filter(b => used.has(b.iid))
}

/** Contiguous runs of entries by block instance, in order — what the builder draws. */
export function segmentsOf(routine) {
  const out = []
  ;(routine.ex || []).forEach((e, i) => {
    const key = e.blk || null
    const last = out[out.length - 1]
    if (last && last.blk === key) last.idx.push(i)
    else out.push({ blk: key, idx: [i] })
  })
  const meta = Object.fromEntries((routine.blocks || []).map(b => [b.iid, b]))
  return out.map(s => ({ ...s, meta: s.blk ? meta[s.blk] || null : null }))
}

// ---- search / filter ---------------------------------------------------------------------
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/**
 * Filters: { q, goal, level, focus, type, maxMinutes, minMinutes, equipment, source ('official'|'mine'),
 * favorites (Set), onlyFavorites, uid }. Text search matches the translated title, subtitle,
 * focus/goal/level words and "N min" against the estimate.
 */
export function filterBlocks(list, f = {}, t = s => s) {
  const words = norm(f.q).split(/\s+/).filter(Boolean)
  return list.filter(b => {
    if (b.active === false && !f.includeInactive) return false
    if (f.goal && b.goal !== f.goal) return false
    if (f.level && b.level !== f.level) return false
    if (f.focus && b.focus !== f.focus && !(b.muscles || []).includes(f.focus)) return false
    if (f.type && b.type !== f.type) return false
    if (f.maxMinutes && (b.estimatedMinutes || 0) > f.maxMinutes) return false
    if (f.minMinutes && (b.estimatedMinutes || 0) < f.minMinutes) return false
    if (f.equipment && !(b.equipment || []).every(eq => f.equipment.includes(eq))) return false
    if (f.source === 'official' && !b.official) return false
    if (f.source === 'mine' && (b.official || (f.uid && b.createdBy !== f.uid))) return false
    if (f.onlyFavorites && !(f.favorites && f.favorites.has(b.id))) return false
    if (words.length) {
      const hay = norm([blockTitle(b, t), blockSubtitle(b, t), t(FOCUS_LABEL[b.focus] || ''), t(GOAL_LABEL[b.goal] || ''),
        t(LEVEL_LABEL[b.level] || ''), t(TYPE_LABEL[b.type] || ''), b.focus, b.goal, b.level, b.type, b.style, b.description,
        ...(b.muscles || []).map(m => t(FOCUS_LABEL[m] || m)), `${b.estimatedMinutes} min`].join(' '))
      for (const w of words) {
        const mins = w.match(/^(\d+)(min)?$/)
        if (mins) { if (Math.abs((b.estimatedMinutes || 0) - Number(mins[1])) > 7) return false; continue }
        if (w === 'min') continue
        if (!hay.includes(w)) return false
      }
    }
    return true
  })
}
