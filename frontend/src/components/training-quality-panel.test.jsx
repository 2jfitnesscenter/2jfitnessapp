import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'

/* The Training Quality panel over the real analyzer: sets and days per pattern, muscles, a reference range only when it is valid, findings phrased from code + params. */
let Panel, i18n
const e = (id, sets = 3, extra = {}) => ({ id, sets, mode: 'reps', ...extra })
const week = (...days) => days.map((ex, i) => ({ id: 'd' + i, name: 'Day ' + (i + 1), ex }))
const render = props => renderToStaticMarkup(<Panel {...props} />)

beforeEach(async () => {
  vi.resetModules()
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {}, removeItem() {} })
  vi.stubGlobal('navigator', {})
  vi.stubGlobal('document', { addEventListener() {}, documentElement: {} })
  vi.stubGlobal('window', { addEventListener() {}, matchMedia: () => ({ matches: false }) })
  i18n = await import('../lib/i18n.js')
  await i18n.setLang('en')
  Panel = (await import('./TrainingQualityPanel.jsx')).default
})
afterEach(() => vi.unstubAllGlobals())

describe('TrainingQualityPanel', () => {
  it('a balanced routine shows sets and days per pattern and no point to review', () => {
    const h = render({ days: week([e('0025', 3), e('0861', 3)], [e('0198', 3), e('0043', 3), e('0032', 3)]) })
    expect(h).toContain('3 sets · 1 d')
    expect(h).toContain('No clear structural issue found')
    expect(h).not.toContain('training-quality-finding ')
  })

  it('an over-concentrated pattern is named with its sets, tagged as a rule of thumb, and never as a fact', () => {
    const h = render({ routine: { ex: [e('0025', 5), e('0047', 5), e('0861', 2)] }, goal: 'hypertrophy' })
    expect(h).toContain('of the upper-body sets are pushes')
    expect(h).toContain('Most of the upper-body volume is concentrated in pushing.')
    expect(h).toContain('tq-tag heuristic'); expect(h).toContain('Rule of thumb')
    expect(h).not.toMatch(/NaN|undefined|\{\d\}/)
  })

  it('shows the frequency of a pattern as days', () => {
    const h = render({ days: week([e('0861', 3)], [e('0861', 3)], [e('0043', 3)]) })
    expect(h).toContain('6 sets · 2 d')
    expect(h).toMatch(/\d+ direct · \d+ secondary · \d+\s+d/)
  })

  it('shows the reference range only for a hypertrophy week with a known level, labelled as a rule of thumb', () => {
    const days = week([e('0025', 8)], [e('0025', 8)])
    const h = render({ days, goal: 'hypertrophy', level: 'intermediate' })
    expect(h).toContain('Weekly direct sets'); expect(h).toContain('rule of thumb, intermediate'); expect(h).toContain('tq-ref above')
    expect(render({ days, goal: 'hypertrophy' })).not.toContain('tq-ref')              // no level: no invented range
    expect(render({ days, goal: 'hypertrophy' })).toContain('Set the level to compare')
    expect(render({ days, goal: 'strength', level: 'advanced' })).not.toContain('tq-ref')
    expect(render({ routine: { ex: [e('0025', 20)] }, goal: 'hypertrophy', level: 'advanced' })).not.toContain('Weekly direct sets')
  })

  it('without enough data it stays empty and calm', () => {
    const h = render({ routine: { ex: [] } })
    expect(h).toContain('0 planned resistance sets'); expect(h).toContain('No clear structural issue')
    expect(render({ routine: { ex: [{ id: 'unknown-x', sets: 3 }] } })).toContain('too little library data')
  })

  it('a declared specialization keeps the soft readings out', () => {
    const props = { routine: { ex: [e('0025', 5), e('0047', 5), e('0861', 2)] }, goal: 'hypertrophy' }
    expect(render(props)).toContain('upper-body sets')
    expect(render({ ...props, focus: 'chest' })).not.toContain('upper-body sets')
    expect(render({ ...props, specialization: 'powerlifting' })).not.toContain('upper-body sets')
  })

  it('findings are phrased in Spanish from the same codes', async () => {
    await i18n.setLang('es')
    const h = render({ routine: { ex: [e('0025', 5), e('0047', 5), e('0861', 2)] } })
    expect(h).toContain('Gran parte del volumen de tren superior está concentrado en empujes.')
    expect(h).toContain('Regla orientativa')
    expect(h).toContain('series')
    expect(h).not.toContain('Rule of thumb')
  })

  it('stays inside narrow screens: the layout rules wrap and never fix a width wider than the container', () => {
    const css = readFileSync(new URL('./training-quality-panel.css', import.meta.url), 'utf8')
    expect(css).toMatch(/@media \(max-width: 390px\)/)
    expect(css).toMatch(/\.tq-ref \{[^}]*display: inline-flex/); expect(css).toMatch(/\.training-quality-reference > div \{[^}]*flex-wrap: wrap/)
    expect(css).not.toMatch(/min-width:\s*\d{3,}px/)
  })
})
