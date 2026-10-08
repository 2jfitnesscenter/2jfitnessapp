// Deterministic, read-only routine quality analysis. All exercise facts come from the existing
// protocol taxonomy, Library metadata and muscle model; this module is not a second classifier.
import { EXIDX } from './exercises.js'
import { classify, redundancyKey, MOVEMENT_BY_ID, RESTRICTION_FLAG } from './protocol/index.js'
import { facets, isDeprecated, preferredOf, similarVariants } from './library/index.js'
import { musclesOf } from './muscles.js'
import { countsForProgression } from './workout-policy.js'

const MOVE_BUCKET = {
  horizontal_push: 'push', vertical_push: 'push', horizontal_pull: 'pull', vertical_pull: 'pull',
  squat: 'knee', lunge: 'knee', knee_extension: 'knee', hinge: 'hip', hip_thrust: 'hip', hip_extension: 'hip',
  core_anti_extension: 'core', core_flexion: 'core', core_rotation: 'core', core_lateral: 'core',
  cardio: 'conditioning', conditioning: 'conditioning', jump: 'conditioning', olympic: 'power', carry: 'carry',
}
const NON_RESISTANCE = new Set(['cardio', 'conditioning', 'mobility', 'interval', 'hiit', 'tabata', 'circuit', 'time'])
const DIRECTION_MOVEMENTS = ['horizontal_push', 'vertical_push', 'horizontal_pull', 'vertical_pull']

const asDays = input => {
  if (Array.isArray(input)) return input.map((day, i) => ({ ...day, key: day?.key ?? day?.id ?? String(i) }))
  if (Array.isArray(input?.days)) return input.days.map((day, i) => ({ ...day, key: day?.key ?? day?.id ?? String(i) }))
  const routine = input?.routine || input
  return routine && Array.isArray(routine.ex) ? [{ ...routine, key: routine.id || 'routine' }] : []
}

const isGuidedNonStrength = (entry, day, blocks) => {
  const blockId = entry?.blk
  const type = blockId && (blocks.get(blockId) || day?.blocks?.find(b => b.iid === blockId)?.type)
  return NON_RESISTANCE.has(String(type || '').toLowerCase()) || NON_RESISTANCE.has(String(entry?.mode || '').toLowerCase())
}

function alternativesFor(id, availableEquipment, restrictions = []) {
  const source = EXIDX[id]
  if (!source) return []
  return similarVariants(source, Object.values(EXIDX), {
    lookup: key => EXIDX[key] || null,
    limit: 3,
    exclude: candidate => {
      if (!candidate || isDeprecated(candidate.id)) return true
      if (preferredOf(candidate.id) !== candidate.id) return true
      if (Array.isArray(availableEquipment) && !availableEquipment.includes(facets(candidate)?.equipment)) return true
      // Reuse the protocol flags. An uncurated candidate cannot be confidently checked against
      // an explicit restriction, so the conservative trainer suggestion omits it.
      if (restrictions.length) {
        const cls = classify(candidate.id, key => EXIDX[key] || null)
        if (!cls.curated || restrictions.some(r => cls.flags?.includes(RESTRICTION_FLAG[r]))) return true
      }
      return false
    },
  }).map(row => ({ id: row.ex.id, name: row.ex.n, movement: facets(row.ex)?.movement || null }))
}

/**
 * Analyze one routine or a collection of routine days without writing to state.
 * context.workouts is optional and only intended for the member's own locally available history.
 */
export function analyzeRoutineStructure(input, context = {}) {
  const days = asDays(input)
  const goal = context.goal || input?.goal || input?.routine?.meta?.goal || 'general'
  const equipment = Array.isArray(context.availableEquipment) ? context.availableEquipment : null
  const restrictions = Array.isArray(context.restrictions) ? context.restrictions.filter(r => RESTRICTION_FLAG[r]) : []
  const blocks = new Map()
  for (const day of days) for (const b of day.blocks || []) if (b?.iid) blocks.set(b.iid, b.type)

  const weeklyMovements = {}
  const weeklyPatterns = {}
  const muscleSets = {}
  const dayResults = []
  const findings = []
  let unclassifiedExercises = 0
  const seenFindings = new Set()
  const add = finding => {
    if (seenFindings.has(finding.id)) return
    seenFindings.add(finding.id)
    findings.push(finding)
  }

  for (const [dayIndex, day] of days.entries()) {
    const movements = {}
    const patterns = {}
    const sameStimulus = new Map()
    const exercises = []
    let programmedResistanceSets = 0

    for (const entry of Array.isArray(day?.ex) ? day.ex : []) {
      const ex = EXIDX[entry?.id]
      if (!ex) { unclassifiedExercises++; continue }
      const taxonomy = classify(ex.id, id => EXIDX[id] || null)
      const f = facets(ex)
      if (f?.movement) {
        movements[f.movement] = (movements[f.movement] || 0) + 1
        weeklyMovements[f.movement] = (weeklyMovements[f.movement] || 0) + 1
      }
      if (taxonomy.pattern && taxonomy.pattern !== 'other' && taxonomy.pattern !== 'unknown') {
        patterns[taxonomy.pattern] = (patterns[taxonomy.pattern] || 0) + 1
        weeklyPatterns[taxonomy.pattern] = (weeklyPatterns[taxonomy.pattern] || 0) + 1
      }
      const setCount = Math.max(0, Math.min(30, Math.floor(Number(entry.sets) || 0)))
      const resistanceWork = !isGuidedNonStrength(entry, day, blocks)
        && entry?.mode !== 'time' && entry?.mode !== 'cardio'
        && !['mobility', 'cardio', 'conditioning'].includes(f?.movement)
        && taxonomy.pattern !== 'mobility' && taxonomy.pattern !== 'cardio'
      if (resistanceWork && setCount) {
        programmedResistanceSets += setCount
        for (const [muscle, weight] of Object.entries(musclesOf(ex))) {
          const target = muscleSets[muscle] || (muscleSets[muscle] = { direct: 0, secondary: 0, exposure: 0 })
          const sets = setCount * weight
          target.exposure += sets
          if (weight >= 0.99) target.direct += setCount
          else target.secondary += sets
        }
      }
      const key = redundancyKey(taxonomy)
      if (taxonomy.known && taxonomy.pattern !== 'other' && taxonomy.pattern !== 'unknown' && !isGuidedNonStrength(entry, day, blocks)) {
        const group = sameStimulus.get(key) || []
        group.push(entry)
        sameStimulus.set(key, group)
      }
      const row = { id: ex.id, name: ex.n, movement: f?.movement || null, pattern: taxonomy.pattern, equipment: f?.equipment || null,
        sets: resistanceWork ? setCount : 0, deprecated: isDeprecated(ex.id), preferredId: preferredOf(ex.id), compatible: equipment ? equipment.includes(f?.equipment) : null }
      exercises.push(row)
      if (equipment && row.compatible === false) {
        const id = `equipment:${day.key}:${ex.id}`
        add({ id, category: 'equipment', severity: 'revisar', evidence: { exerciseId: ex.id, required: f?.equipment, available: equipment },
          message: 'Este ejercicio requiere una categoría de material que no figura en el perfil activo.',
          suggestion: 'Revisa una variante compatible antes de guardar.', alternatives: alternativesFor(ex.id, equipment, restrictions) })
      }
      if (row.deprecated) {
        add({ id: `deprecated:${day.key}:${ex.id}`, category: 'library', severity: 'revisar', evidence: { exerciseId: ex.id, preferredId: row.preferredId },
          message: 'La Library marca este ejercicio como sustituido por una opción preferida.', suggestion: 'Revisa la opción preferida de la Library.', alternatives: alternativesFor(row.preferredId, equipment, restrictions) })
      }
    }

    for (const [key, rows] of sameStimulus) if (rows.length >= 3) {
      const protectedIds = new Set(day.anchorIds || [])
      const unprotected = rows.filter(e => !e.anchor && !e.priority && !protectedIds.has(e.id))
      if (unprotected.length >= 3) add({ id: `redundancy:${day.key}:${key}`, category: 'redundancy', severity: 'revisar',
        evidence: { day: day.name || `Día ${dayIndex + 1}`, exerciseIds: rows.map(e => e.id), count: rows.length },
        message: 'Este día concentra tres o más ejercicios con un estímulo muy parecido según la Library.',
        suggestion: 'Valora si todas las variantes cumplen una función distinta; los ejercicios ancla se conservan.' })
    }
    dayResults.push({ id: day.key, name: day.name || `Día ${dayIndex + 1}`, movements, patterns, exercises, programmedResistanceSets })
  }

  const buckets = {}
  for (const [movement, count] of Object.entries(weeklyMovements)) {
    const bucket = MOVE_BUCKET[movement]
    if (bucket) buckets[bucket] = (buckets[bucket] || 0) + count
  }
  const pushCount = buckets.push || 0, pullCount = buckets.pull || 0
  const focus = String(context.focus || input?.meta?.focus || input?.routine?.meta?.focus || '').toLowerCase()
  const pushSpecialization = ['chest', 'shoulders', 'triceps', 'arms', 'push', 'upper'].includes(focus)
  const pullSpecialization = ['back', 'pull', 'upper'].includes(focus)
  const kneeSpecialization = ['quads', 'lower'].includes(focus)
  if (pushCount >= 2 && pullCount === 0 && !pushSpecialization) add({ id: 'balance:push-without-pull', category: 'balance', severity: 'importante',
    evidence: { pushExercises: pushCount, pullExercises: pullCount }, message: 'La semana incluye varios empujes y no aparecen ejercicios de tracción.',
    suggestion: 'Revisa si falta una tracción adecuada al objetivo y al material disponible.' })
  for (const [source, target] of [['horizontal_pull', 'vertical_pull'], ['vertical_pull', 'horizontal_pull']]) {
    if (!pullSpecialization && (weeklyMovements[source] || 0) >= 2 && !(weeklyMovements[target] || 0)) add({
      id: `balance:${source}-without-${target}`, category: 'balance', severity: 'revisar',
      evidence: { present: source, presentCount: weeklyMovements[source], absent: target },
      message: 'La rutina repite una dirección de tracción y no muestra la otra.',
      suggestion: 'Comprueba si la selección responde a una especialización intencional.'
    })
  }
  if ((buckets.knee || 0) >= 3 && (buckets.hip || 0) === 0 && ['hypertrophy', 'strength', 'general', 'endurance'].includes(goal) && !kneeSpecialization)
    add({ id: 'balance:knee-without-hip', category: 'balance', severity: 'revisar', evidence: { kneeExercises: buckets.knee, hipExercises: 0, goal },
      message: 'Hay trabajo dominante de rodilla, pero no aparece una variante dominante de cadera.', suggestion: 'Comprueba si esta selección es intencional para el objetivo de la rutina.' })
  if (unclassifiedExercises) add({ id: 'catalog:unclassified-exercises', category: 'library', severity: 'info',
    evidence: { count: unclassifiedExercises }, message: 'Hay ejercicios sin datos suficientes en la Library para incluirlos en el análisis.',
    suggestion: 'La revisión los deja fuera de los recuentos y no supone su patrón ni material.' })

  const scheduled = Array.isArray(input?.scheduledDays) ? input.scheduledDays : null
  const consecutive = []
  if (scheduled) {
    const sorted = [...scheduled].filter(x => Number.isFinite(x?.day) && x.routineKey != null).sort((a, b) => a.day - b.day)
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].day - sorted[i - 1].day !== 1) continue
      const a = dayResults.find(x => x.id === String(sorted[i - 1].routineKey))
      const b = dayResults.find(x => x.id === String(sorted[i].routineKey))
      if (!a || !b) continue
      const overlap = Object.keys(a.movements).filter(m => b.movements[m])
      if (overlap.length) consecutive.push({ from: sorted[i - 1].day, to: sorted[i].day, movements: overlap })
    }
    for (const row of consecutive) add({ id: `distribution:consecutive:${row.from}:${row.to}`, category: 'distribution', severity: 'info', evidence: row,
      message: 'Hay movimientos repetidos en días consecutivos; revisa si la recuperación prevista encaja con la programación.',
      suggestion: 'Considera el descanso y las prioridades del programa antes de cambiar el orden.' })
  }

  const recentWorkouts = Array.isArray(context.workouts) ? context.workouts.filter(countsForProgression).slice(-12) : null
  if (recentWorkouts?.length && input?.routine?.id) {
    const routineWorkouts = recentWorkouts.filter(w => w.routineId === input.routine.id)
    const window = routineWorkouts.slice(-3)
    const planned = [...new Set(days.flatMap(d => (d.ex || []).map(e => e.id).filter(Boolean)))]
    const omissionCounts = planned.map(id => ({ id, count: window.filter(w => !(w.entries || []).some(e => e.id === id && (e.sets || []).some(s => s.done && s.type !== 'warmup'))).length }))
      .filter(x => x.count >= 2)
    if (window.length >= 2 && omissionCounts.length) add({ id: `history:omitted:${input.routine.id}`, category: 'history', severity: 'info', evidence: { omittedExerciseIds: omissionCounts.map(x => x.id), exposures: window.length },
      message: 'Algunos ejercicios planificados no aparecen en las sesiones recientes incluidas en este análisis.', suggestion: 'Confirma primero que el periodo revisado sea representativo.' })
  }

  const applicableCoverage = ['push', 'pull', 'knee', 'hip'].map(id => ({ id, count: buckets[id] || 0 }))
  const severityRank = { importante: 0, revisar: 1, info: 2 }
  const sortedFindings = findings.sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || a.id.localeCompare(b.id))
  const movementSummary = {
    horizontal_push: weeklyMovements.horizontal_push || 0,
    vertical_push: weeklyMovements.vertical_push || 0,
    horizontal_pull: weeklyMovements.horizontal_pull || 0,
    vertical_pull: weeklyMovements.vertical_pull || 0,
    knee_dominant: (weeklyMovements.squat || 0) + (weeklyMovements.lunge || 0) + (weeklyMovements.knee_extension || 0),
    hip_dominant: (weeklyMovements.hinge || 0) + (weeklyMovements.hip_thrust || 0) + (weeklyMovements.hip_extension || 0),
    core: Object.entries(weeklyMovements).filter(([id]) => id.startsWith('core_')).reduce((sum, [, count]) => sum + count, 0),
    conditioning: (weeklyMovements.cardio || 0) + (weeklyMovements.conditioning || 0),
    power: weeklyMovements.olympic || 0,
    carry: weeklyMovements.carry || 0,
  }
  return { version: 1, goal, source: '2j-protocol-library-muscles-v1', days: dayResults, movements: weeklyMovements, movementSummary, patterns: weeklyPatterns,
    buckets, applicableCoverage, muscleSets, programmedResistanceSets: dayResults.reduce((n, d) => n + d.programmedResistanceSets, 0),
    scheduledDayFindings: consecutive, findings: sortedFindings }
}

export const structuralFactsForAI = analysis => ({
  version: 1,
  goal: analysis?.goal || 'general',
  movements: analysis?.movements || {},
  movementSummary: analysis?.movementSummary || {},
  patterns: analysis?.patterns || {},
  days: (analysis?.days || []).map(d => ({ name: d.name, movements: d.movements, patterns: d.patterns, programmedResistanceSets: d.programmedResistanceSets })),
  findings: (analysis?.findings || []).map(f => ({ id: f.id, category: f.category, severity: f.severity, evidence: f.evidence, message: f.message })),
  source: 'deterministic-2j-analysis',
})
