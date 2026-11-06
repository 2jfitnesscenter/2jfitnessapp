// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { getLang, t as tt } from './i18n.js'

// Wording for Premium programs. Editorial text of a program is data (English base in the program itself, the Spanish copy in `locales.es`);
// the app's own words are plain English keys translated at render (t()), kept in closed maps so no key is ever built at runtime.

/** A program's text in the member's language: the English base, overlaid by the translation when there is one. */
export function copyOf(p, lang) {
  const base = { ...p, ...(p?.copy || {}) }
  const tr = lang && lang !== 'en' ? p?.locales?.[lang] || {} : {}
  return { ...base, ...tr }
}

// Canonical Premium enum values stay stable in storage/API. These labels are the
// presentation layer for forms and cards, so users never see the internal slugs.
export const METHOD_LABEL = {
  'percentage-wave': 'Percentage wave', 'weekly-load': 'Weekly load progression', tiered: 'Tiered training',
  'upper-lower': 'Upper/lower split', split: 'Training split', undulating: 'Undulating periodisation',
  'full-body': 'Full body', concurrent: 'Strength and conditioning', conditioning: 'Conditioning',
  recomposition: 'Body recomposition', opposition: 'Public-service exam preparation',
}
export const SOURCE_TYPE_LABEL = { established: 'Established method', principles: 'General training principles', own: '2J original method' }
export const PROGRESSION_LABEL = {
  'training-max-cycle': 'Training Max cycle', 'weekly-linear': 'Weekly linear progression',
  'double-progression': 'Double progression', linear: 'Linear progression', tiered: 'Tiered progression',
  undulating: 'Undulating progression', none: 'No automatic progression',
}

const PROGRAM_NAME_ES = {
  '531': 'Fuerza 5/3/1', 'texas-method': 'Método Texas', 'juggernaut-method': 'Método Juggernaut 10/8/5/3',
  gzcl: 'Método GZCL', phul: 'Fuerza e hipertrofia torso/pierna (PHUL)', phat: 'Potencia e hipertrofia adaptativas (PHAT)',
  dup: 'Periodización ondulante diaria (DUP)', 'upper-lower-powerbuilding': 'Torso/pierna: fuerza e hipertrofia',
  'full-body-hypertrophy': 'Hipertrofia de cuerpo completo', '2j-recomposition': 'Recomposición corporal 2J',
  'concurrent-strength-cardio': 'Fuerza y cardio concurrentes', 'full-body-conditioning': 'Acondicionamiento de cuerpo completo',
  'linear-5x5': 'Progresión lineal 5×5', 'heavy-light-medium': 'Días pesado, ligero y medio',
  'conjugate-strength': 'Fuerza conjugada', 'block-periodization-strength': 'Periodización por bloques de fuerza',
  'dup-powerbuilding': 'Fuerza e hipertrofia con periodización ondulante', 'ppl-powerbuilding': 'Empuje, tirón y pierna: fuerza e hipertrofia',
  'high-frequency-strength': 'Fuerza de alta frecuencia', 'hst-style-hypertrophy': 'Hipertrofia con carga progresiva',
  'bfr-hypertrophy': 'Hipertrofia con restricción del flujo sanguíneo', 'polarized-endurance': 'Resistencia polarizada',
  'threshold-builder': 'Desarrollo del umbral', 'aerobic-base-intervals': 'Base aeróbica e intervalos',
  'functional-fitness-engine': 'Acondicionamiento funcional', 'fitness-race-prep': 'Preparación para carreras de fitness',
  'fitness-race-advanced': 'Preparación avanzada para carreras de fitness', 'strength-zone2-cut': 'Fuerza y zona 2 para recomposición',
  'metabolic-resistance-progression': 'Progresión de resistencia metabólica', 'entrena-tus-oposiciones': 'Entrena tus oposiciones',
}
const LIFT_LABEL_ES = { squat: 'Sentadilla', bench: 'Press banca', deadlift: 'Peso muerto', press: 'Press militar' }

export const premiumLiftLabel = (key, lang = getLang()) => lang === 'es' ? LIFT_LABEL_ES[key] || key : key

/** Localizes the name from a catalog record, run snapshot or history entry. */
export function premiumProgramName(program, lang = getLang()) {
  if (!program) return ''
  if (lang !== 'es') return program.name || ''
  const key = String(program.slug || program.programId || program.id || '').replace(/^premium-/, '')
  return program.locales?.es?.name || PROGRAM_NAME_ES[key] || program.name || ''
}

const SESSION_TITLE_ES = {
  'Press day': 'Día de press militar', 'Deadlift day': 'Día de peso muerto', 'Bench day': 'Día de press banca', 'Squat day': 'Día de sentadilla',
  'Volume day': 'Día de volumen', 'Recovery day': 'Día de recuperación', 'Intensity day': 'Día de intensidad',
  'Day 1 · Squat': 'Día 1 · Sentadilla', 'Day 2 · Press': 'Día 2 · Press militar', 'Day 3 · Bench': 'Día 3 · Press banca', 'Day 4 · Deadlift': 'Día 4 · Peso muerto',
  'Upper power': 'Torso · potencia', 'Lower power': 'Pierna · potencia', 'Upper hypertrophy': 'Torso · hipertrofia', 'Lower hypertrophy': 'Pierna · hipertrofia',
  'Back and shoulders hypertrophy': 'Hipertrofia de espalda y hombros', 'Chest and arms hypertrophy': 'Hipertrofia de pecho y brazos',
  'Day A · Heavy': 'Día A · Pesado', 'Day B · Moderate': 'Día B · Moderado', 'Day C · Light': 'Día C · Ligero',
  'Day A · Moderate': 'Día A · Moderado', 'Day B · Light': 'Día B · Ligero', 'Day C · Heavy': 'Día C · Pesado',
  'Day A · Light': 'Día A · Ligero', 'Day B · Heavy': 'Día B · Pesado', 'Day C · Moderate': 'Día C · Moderado',
  'Upper A': 'Torso A', 'Lower A': 'Pierna A', 'Upper B': 'Torso B', 'Lower B': 'Pierna B',
  'Full body A': 'Cuerpo completo A', 'Full body B': 'Cuerpo completo B', 'Full body C': 'Cuerpo completo C',
  'Strength A': 'Fuerza A', 'Upper hypertrophy + conditioning': 'Hipertrofia de torso + acondicionamiento',
  'Strength B': 'Fuerza B', 'Lower hypertrophy + conditioning': 'Hipertrofia de pierna + acondicionamiento',
  'Strength 1': 'Fuerza 1', 'Cardio · steady': 'Cardio · continuo', 'Strength 2': 'Fuerza 2', 'Cardio · intervals': 'Cardio · intervalos', 'Strength 3': 'Fuerza 3',
  'Workout A': 'Entrenamiento A', 'Workout B': 'Entrenamiento B', 'Heavy day': 'Día pesado', 'Light day': 'Día ligero', 'Medium day': 'Día medio',
  'Max effort · lower': 'Esfuerzo máximo · pierna', 'Dynamic effort · upper': 'Esfuerzo dinámico · torso',
  'Max effort · upper': 'Esfuerzo máximo · torso', 'Dynamic effort · lower': 'Esfuerzo dinámico · pierna',
  'Upper · strength': 'Torso · fuerza', 'Lower · strength': 'Pierna · fuerza', 'Upper · muscle': 'Torso · hipertrofia', 'Lower · muscle': 'Pierna · hipertrofia',
  'Push A': 'Empuje A', 'Pull A': 'Tirón A', 'Legs A': 'Piernas A', 'Push B': 'Empuje B', 'Pull B': 'Tirón B', 'Legs B': 'Piernas B',
  'Day 1 · Squat + Bench': 'Día 1 · Sentadilla + press banca', 'Day 2 · Deadlift + Press': 'Día 2 · Peso muerto + press militar',
  'Day 3 · Squat + Bench (light)': 'Día 3 · Sentadilla + press banca (ligero)', 'Day 4 · Press + Deadlift': 'Día 4 · Press militar + peso muerto',
  'Day 5 · Squat + Bench (heavy)': 'Día 5 · Sentadilla + press banca (pesado)',
  'Easy 1': 'Suave 1', 'Intervals 1': 'Intervalos 1', 'Easy 2': 'Suave 2', 'Intervals 2': 'Intervalos 2', 'Long easy': 'Sesión larga suave',
  'Cruise intervals': 'Intervalos a ritmo controlado', Tempo: 'Ritmo tempo', Strides: 'Progresiones', Long: 'Sesión larga', Intervals: 'Intervalos',
  'Strength A + finisher': 'Fuerza A + final de acondicionamiento', Engine: 'Acondicionamiento', 'Strength B + finisher': 'Fuerza B + final de acondicionamiento',
  'Mixed-modal': 'Trabajo multimodal', 'Easy run': 'Carrera suave', 'Strength endurance': 'Resistencia de fuerza', 'Run intervals': 'Intervalos de carrera',
  Stations: 'Estaciones', 'Run + stations': 'Carrera + estaciones', 'Long run + stations': 'Carrera larga + estaciones',
  'Zone 2 · cardio': 'Zona 2 · cardio', 'Strength C': 'Fuerza C', 'Circuit A': 'Circuito A', 'Circuit B': 'Circuito B',
  'Circuit C': 'Circuito C', 'Circuit D': 'Circuito D', Endurance: 'Resistencia', Strength: 'Fuerza', 'Control tests': 'Pruebas de control',
}

const PHASE_PART_ES = {
  '5s': 'series de 5 repeticiones', '3s': 'series de 3 repeticiones', '5/3/1': '5/3/1',
  '10s': 'series de 10 repeticiones', '8s': 'series de 8 repeticiones', 'Deload': 'Descarga',
  Accumulation: 'Acumulación', Intensification: 'Intensificación', Realization: 'Realización',
  'Lighter week': 'Semana ligera', '15-rep block': 'Bloque de 15 repeticiones', '10-rep block': 'Bloque de 10 repeticiones',
  '15s': 'series de 15 repeticiones',
  '5-rep block': 'Bloque de 5 repeticiones', Base: 'Base', Intervals: 'Intervalos', Taper: 'Puesta a punto',
  Volume: 'Volumen', Specificity: 'Especificidad', Sharpen: 'Afinamiento', Plan: 'Planificación',
}

/** Translates the finite, authored labels in the official Premium schedule. Free-form trainer copy is preserved verbatim. */
export function premiumScheduleText(value, lang = getLang()) {
  const text = String(value || '')
  if (lang !== 'es' || !text) return text
  if (SESSION_TITLE_ES[text]) return SESSION_TITLE_ES[text]
  const localizePart = part => {
    const week = part.match(/^Week (\d+)$/)
    return week ? `Semana ${week[1]}` : PHASE_PART_ES[part] || part
  }
  if (text.includes(' · ')) {
    const original = text.split(' · ')
    const parts = original.map(localizePart)
    return parts.some((part, i) => part !== original[i]) ? parts.join(' · ') : text
  }
  const week = text.match(/^Week (\d+)(?: · (.+))?$/)
  if (week) {
    const suffix = week[2] ? PHASE_PART_ES[week[2]] || week[2] : ''
    return `Semana ${week[1]}${suffix ? ' · ' + suffix : ''}`
  }
  return localizePart(text)
}

export const LEVEL_KEY = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' }
export const BADGE_LABEL = { new: 'New', featured: 'Featured', recommended: 'Recommended' }
export const STATUS_LABEL = { draft: 'Draft', published: 'Published', hidden: 'Hidden', archived: 'Archived' }
export const SCOPE_LABEL = { official: '2J official', catalog: 'Catalogue', personal: 'Mine' }
export const PROGRESSION_TEXT = {
  'training-max-cycle': 'Loads are a percentage of a Training Max. At the end of each cycle 2J proposes a small increase and you confirm it.',
  'weekly-linear': 'Loads or reps go up a little every week inside the cycle.',
  tiered: 'Several tiers of work with different rep ranges; you move a tier up when you hit its target.',
  'double-progression': 'You add reps within a range; when you reach the top of the range you add load.',
  undulating: 'Heavy, moderate and light days rotate through the week; loads move with how the week goes.',
  linear: 'You add a small amount of load when you complete the target sets and reps.',
  none: 'No automatic progression: you choose the loads.',
}
export const REASON_LABEL = { finished: 'Finished', switched: 'Switched to another program' }

/** "5/3/1 · Cycle 3 · Week 2/4" from a premium summary. */
export const labelOfRun = s => (s ? `${premiumProgramName(s)} · ${tt('Cycle {0}', s.cycle)} · ${tt('Week {0}/{1}', s.week, s.weeks)}` : '')

/** Where a cover is loaded from: a file shipped with the app, an upload of the app's media system (served by the API), or an https URL. Anything else → no cover (fallback art). */
export const coverSrc = p => {
  const c = String(p?.coverImage || '')
  if (c.startsWith('/premium/covers/') || /^https:\/\//i.test(c)) return c
  if (c.startsWith('media:')) return '/api/social/media?id=' + encodeURIComponent(c.slice(6))
  return null
}
export const GOAL_LABEL = { hypertrophy: 'Hypertrophy', strength: 'Strength', 'strength-muscle': 'Strength + muscle', recomposition: 'Recomposition', conditioning: 'Conditioning', health: 'Health' }
export const kickerOf = p => `${GOAL_LABEL[p?.goalTags?.[0]] || ''}|${LEVEL_KEY[p?.level] || ''}`

/** "5/3/1 · Cycle 3 · Week 2/4" for staff screens (the API sends the numbers, the wording is the app's own). */
export const runLabel = p => (p.cycle == null ? String(p.label || premiumProgramName(p) || '') : `${premiumProgramName(p)} · ${tt('Cycle {0}', p.cycle)} · ${tt('Week {0}/{1}', p.week, p.weeks)}`)
export const INCIDENT_LABEL = { paused: 'Paused', skipped: 'Sessions skipped', 'cycle-complete': 'Cycle complete: waiting for the member to confirm the next one', 'missing-training-max': 'A Training Max is missing' }
