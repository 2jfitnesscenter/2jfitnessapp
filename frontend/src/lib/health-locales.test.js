import { expect, it } from 'vitest'
import es from '../locales/es.js'
import { SOURCE_LABEL, SEGMENTS, metricDef, availableMetrics } from './health.js'
import { SOURCE_NAME } from './fitness.js'
import { PAIN_ZONES } from './checkin.js'
import { MEASUREMENTS } from './measurements.js'

// check-locales only sees t('literal'). Health, check-in and follow-up render labels held in
// data tables through t(table[key]) — this keeps those in the Spanish catalogue too.
it('every label a Health/Fitness/check-in table renders has a Spanish translation', () => {
  const labels = new Set([
    ...Object.values(SOURCE_LABEL), ...Object.values(SOURCE_NAME), ...PAIN_ZONES.map(z => z.label),
    ...(SEGMENTS || []).map(s => s.label).filter(Boolean),
    ...MEASUREMENTS.map(m => m.label),
    'workout', 'recorded in 1 session', 'recorded in {0} sessions',
    'Energy', 'Low', 'High', 'Sleep / rest', 'Poor', 'Great', 'Fatigue', 'Fresh', 'Very tired',
    'Basic', 'Intermediate', 'Pro', 'Custom', 'Weight and waist', 'Weekly', 'Every two weeks', 'Monthly',
    '1M', '3M', '6M', '1Y', 'All', 'Difference',
  ])
  const S = { bodyweight: [{ d: '2026-01-01', w: 1 }], measurements: Object.fromEntries(MEASUREMENTS.map(m => [m.key, [{ d: '2026-01-01', v: 1 }]])) }
  for (const k of availableMetrics(S)) labels.add(metricDef(k).label)
  const brands = new Set(['WHOOP', 'Strava', 'Tanita', 'Health Connect', '1M', '3M', '6M', '1Y', 'Pro'])
  expect([...labels].filter(l => l && !brands.has(l) && !(l in es))).toEqual([])
})
