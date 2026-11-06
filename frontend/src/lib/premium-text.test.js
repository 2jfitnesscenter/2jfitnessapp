import { describe, expect, it } from 'vitest'
import catalog from '../../../api/lib/premium-official.json'
import es from '../locales/es.js'
import { BADGE_LABEL, GOAL_LABEL, LEVEL_KEY, METHOD_LABEL, premiumLiftLabel, PROGRESSION_LABEL, SCOPE_LABEL, SOURCE_TYPE_LABEL, STATUS_LABEL, premiumProgramName, premiumScheduleText } from './premium-text.js'

describe('Premium Spanish presentation', () => {
  it('has a Spanish name and copy for every official program', () => {
    expect(catalog.programs).toHaveLength(30)
    for (const program of catalog.programs) {
      expect(program.locales?.es?.name, program.slug).toBeTruthy()
      expect(premiumProgramName(program, 'es'), program.slug).toBe(program.locales.es.name)
      expect(premiumProgramName({ programId: program.id, name: program.name }, 'es'), program.slug).toBe(program.locales.es.name)
      for (const field of ['shortDescription', 'longDescription', 'evidenceSummary', 'howItWorks', 'forWhom', 'notIdealIf', 'tracking']) {
        expect(program.locales.es[field], `${program.slug}:${field}`).toBeTruthy()
      }
    }
  })

  it('translates every official schedule phase, week label and session title', () => {
    const labels = new Set()
    for (const program of catalog.programs) for (const week of program.programDefinition.weeks) {
      if (week.label) labels.add(week.label)
      if (week.phase) labels.add(week.phase)
      for (const session of week.sessions) labels.add(session.title)
    }
    for (const label of labels) {
      const localized = premiumScheduleText(label, 'es')
      if (label !== 'Base') expect(localized, label).not.toBe(label)
      else expect(localized).toBe('Base')
    }
    expect(premiumScheduleText('Week 4 · Lighter week', 'es')).toBe('Semana 4 · Semana ligera')
    expect(premiumScheduleText('5s · Accumulation', 'es')).toBe('series de 5 repeticiones · Acumulación')
    expect(premiumScheduleText('Week 1', 'en')).toBe('Week 1')
  })

  it('has Spanish labels for method, origin and progression enum values', () => {
    for (const key of [...Object.values(METHOD_LABEL), ...Object.values(SOURCE_TYPE_LABEL), ...Object.values(PROGRESSION_LABEL), ...Object.values(GOAL_LABEL), ...Object.values(LEVEL_KEY), ...Object.values(STATUS_LABEL), ...Object.values(SCOPE_LABEL), ...Object.values(BADGE_LABEL)]) {
      expect(es[key], key).toBeTruthy()
      expect(es[key], key).not.toBe(key)
    }
  })

  it('localizes legacy program history by stable program id without changing its stored name', () => {
    expect(premiumProgramName({ programId: 'premium-texas-method', name: 'Texas Method' }, 'es')).toBe('Método Texas')
    expect(premiumProgramName({ programId: 'premium-531', name: '5/3/1' }, 'es')).toBe('Fuerza 5/3/1')
  })

  it('localizes the lift keys in the trainer read-only program summary', () => {
    expect(['squat', 'bench', 'deadlift', 'press'].map(key => premiumLiftLabel(key, 'es'))).toEqual(['Sentadilla', 'Press banca', 'Peso muerto', 'Press militar'])
  })
})
