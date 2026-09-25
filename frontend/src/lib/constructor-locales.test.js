import { expect, it } from 'vitest'
import es from '../locales/es.js'
import { MESSAGES, DEFAULT_REASON, RPE_LABEL, FOCUS_LABEL, GOAL_LABEL, LEVEL_LABEL, TYPE_LABEL, STYLE_LABEL, RESTRICTION_LABEL } from './protocol/index.js'


// check-locales only sees literal strings passed to t(). The builder and the validator render
// labels and messages held in tables — every one must exist in Spanish too.
it('every protocol / Constructor V2 label and validator message has a Spanish translation', () => {
  const keys = [
    ...Object.values(MESSAGES), ...Object.values(DEFAULT_REASON), ...Object.values(RPE_LABEL),
    ...Object.values(FOCUS_LABEL), ...Object.values(GOAL_LABEL), ...Object.values(LEVEL_LABEL),
    ...Object.values(TYPE_LABEL), ...Object.values(STYLE_LABEL), ...Object.values(RESTRICTION_LABEL),
    '2J Protocol · OK', '2J Protocol · with reasons', '2J Protocol · does not fit', 'Up to 20 min', 'Over 40 min',
  ]
  expect(keys.filter(k => !(k in es))).toEqual([])
  expect(es['Back muscles']).toBe('Espalda')   // never the navigation "Atrás"
  expect(es['Novice']).toBe('Iniciado')
})
