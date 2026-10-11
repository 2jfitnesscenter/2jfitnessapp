import { describe, expect, it } from 'vitest'
import seed from '../../../api/lib/opposition-official.json'
import library from '../../../api/coach/library.json'
import { validateDefinition } from './premium-model.js'
import * as m from './opposition-model.js'

const byId = new Map(library.exercises.map(e => [e.id, e]))
const ctx = { exerciseExists: id => byId.has(id), preferred: id => byId.get(id)?.pref || id }
const profile = slug => seed.profiles.find(p => p.slug === slug)
const clone = x => JSON.parse(JSON.stringify(x))
const NOW = Date.parse('2026-10-11T10:00:00Z')
const WEEK = 7 * 86400000
const test = (p, id) => p.tests.find(t => t.id === id)
const pts = (p, id, cat, v) => m.scoreMark(p, test(p, id), cat, v)

describe('official profiles: marks as printed in the official publications', () => {
  it('Policía Nacional: 1.000 m, dominadas, suspensión and agilidad follow the BOE tables (v earns the points; 0 below the first band)', () => {
    const p = profile('policia-nacional')
    expect(pts(p, '1000m', 'm', 204).points).toBe(5); expect(pts(p, '1000m', 'm', 199).points).toBe(5); expect(pts(p, '1000m', 'm', 198).points).toBe(6)
    expect(pts(p, '1000m', 'm', 174).points).toBe(10); expect(pts(p, '1000m', 'm', 175).points).toBe(9); expect(pts(p, '1000m', 'm', 229).points).toBe(0)
    expect(pts(p, '1000m', 'f', 249).points).toBe(5); expect(pts(p, '1000m', 'f', 204).points).toBe(10); expect(pts(p, '1000m', 'f', 286).points).toBe(0)
    expect([4, 5, 8, 9, 10, 17, 30].map(n => pts(p, 'dominadas', 'm', n).points)).toEqual([0, 1, 4, 4, 5, 10, 10])
    expect([35, 36, 56, 57, 95].map(n => pts(p, 'suspension', 'f', n).points)).toEqual([0, 1, 4, 5, 10])
    expect([11.7, 11.6, 10.5, 10.4, 10.1, 8.2, 8.3].map(n => pts(p, 'agilidad', 'm', n).points)).toEqual([0, 1, 5, 5, 6, 10, 9])
    expect(pts(p, 'agilidad', 'f', 12.8)?.points).toBe(0)
  })
  it('Policía Nacional: the pass rule is the average of the three tests (≥ 5) and a zero eliminates', () => {
    const p = profile('policia-nacional')
    const ok = m.overall(p, 'm', { agilidad: 10.5, dominadas: 10, '1000m': 204 })
    expect(ok.average).toBe(5); expect(ok.passed).toBe(true)
    const zero = m.overall(p, 'm', { agilidad: 8.2, dominadas: 4, '1000m': 174 })
    expect(zero.average).toBe(6.7); expect(zero.passed).toBe(false)
    const missing = m.overall(p, 'm', { agilidad: 8.2, dominadas: 17 })
    expect(missing.passed).toBeNull(); expect(missing.missing).toEqual(['1000m'])
  })
  it('only the tests of the member’s sex apply (pull-ups for men, a hang for women)', () => {
    const p = profile('policia-nacional')
    expect(m.testsFor(p, 'm').map(t => t.id)).toEqual(['agilidad', 'dominadas', '1000m'])
    expect(m.testsFor(p, 'f').map(t => t.id)).toEqual(['agilidad', 'suspension', '1000m'])
  })
  it('Guardia Civil: apto / no apto by sex AND age band; sex or age missing = no category (nothing is guessed)', () => {
    const p = profile('guardia-civil')
    expect(m.categoryOf(p, { sex: 'm', age: 28 })).toBe('m:u35'); expect(m.categoryOf(p, { sex: 'f', age: 35 })).toBe('f:m35'); expect(m.categoryOf(p, { sex: 'm', age: 40 })).toBe('m:o40')
    expect(m.categoryOf(p, { sex: 'm' })).toBeNull(); expect(m.categoryOf(p, { age: 30 })).toBeNull()
    expect(pts(p, 'carrera-2000', 'm:u35', 565).passed).toBe(true); expect(pts(p, 'carrera-2000', 'm:u35', 566).passed).toBe(false)
    expect(pts(p, 'carrera-2000', 'f:o40', 769).passed).toBe(true); expect(pts(p, 'extensiones-brazos', 'm:o40', 14).passed).toBe(true); expect(pts(p, 'extensiones-brazos', 'm:o40', 13).passed).toBe(false)
    expect(pts(p, 'natacion-50', 'f:m35', 83).passed).toBe(true); expect(pts(p, 'circuito-agilidad', 'f:o40', 17.9).passed).toBe(true)
    expect(m.overall(p, 'm:u35', { 'carrera-2000': 560, 'circuito-agilidad': 13.5, 'extensiones-brazos': 20, 'natacion-50': 65 }).passed).toBe(true)
    expect(m.overall(p, 'm:u35', { 'carrera-2000': 560, 'circuito-agilidad': 14.5, 'extensiones-brazos': 20, 'natacion-50': 65 }).passed).toBe(false)
  })
  it('Policía Local Canarias: Cooper, salto, flexiones and 50 m as printed in the BOC (oddities kept, with notes)', () => {
    const p = profile('policia-local-canarias')
    expect(pts(p, 'cooper', 'm', 2499).passed).toBe(true); expect(pts(p, 'cooper', 'm', 2498).passed).toBe(false); expect(pts(p, 'cooper', 'm', 2500).points).toBe(6); expect(pts(p, 'cooper', 'm', 2900).points).toBe(10)
    expect(pts(p, 'cooper', 'f', 2299).passed).toBe(true); expect(pts(p, 'cooper', 'f', 2400).points).toBe(7)
    expect(pts(p, 'salto-horizontal', 'm', 2.2).passed).toBe(true); expect(pts(p, 'salto-horizontal', 'm', 2.19).passed).toBe(false); expect(pts(p, 'salto-horizontal', 'm', 2.45).points).toBe(10)
    expect(pts(p, 'flexiones-barra', 'm', 8).passed).toBe(true); expect(pts(p, 'flexiones-barra', 'm', 7).passed).toBe(false); expect(pts(p, 'flexiones-barra', 'm', 17).points).toBe(10)
    expect(pts(p, 'flexion-mantenida', 'f', 44).passed).toBe(true); expect(pts(p, 'flexion-mantenida', 'f', 43).passed).toBe(false); expect(pts(p, 'flexion-mantenida', 'f', 83).points).toBe(10)
    expect(pts(p, 'natacion-50', 'm', 50).passed).toBe(true); expect(pts(p, 'natacion-50', 'm', 50.01).passed).toBe(false); expect(pts(p, 'natacion-50', 'm', 37.99).points).toBe(10); expect(pts(p, 'natacion-50', 'f', 55).passed).toBe(true)
    expect(test(p, 'cooper').notes).toMatch(/2\.499/); expect(test(p, 'flexion-mantenida').notes).toMatch(/83/); expect(test(p, 'salto-horizontal').notes).toMatch(/solape/)
  })
  it('Bomberos CEGC: five tests, 5–10 points each; the press de banca only prints its minimum and maximum, and says so', () => {
    const p = profile('bomberos-cegc')
    expect(p.tests.map(t => t.id)).toEqual(['natacion-50', 'dominadas', 'press-banca', 'velocidad-200', 'resistencia-1500'])
    expect([8, 10, 12, 14, 16, 18].map(n => pts(p, 'dominadas', 'm', n).points)).toEqual([5, 6, 7, 8, 9, 10]); expect([8, 10, 11, 12, 14, 16].map(n => pts(p, 'dominadas', 'f', n).points)).toEqual([5, 6, 7, 8, 9, 10])
    expect(pts(p, 'dominadas', 'm', 7).passed).toBe(false)
    expect([15, 39, 40].map(n => pts(p, 'press-banca', 'm', n).points)).toEqual([5, 5, 10]); expect(pts(p, 'press-banca', 'f', 10).passed).toBe(true); expect(pts(p, 'press-banca', 'f', 32).points).toBe(10); expect(pts(p, 'press-banca', 'm', 14).passed).toBe(false)
    expect(test(p, 'press-banca').notes).toMatch(/intermedios no figuran/)
    expect([52, 46, 42, 38, 34, 30].map(n => pts(p, 'natacion-50', 'm', n).points)).toEqual([5, 6, 7, 8, 9, 10]); expect(pts(p, 'natacion-50', 'm', 52.1).passed).toBe(false)
    expect([40, 37, 34, 32, 30, 28].map(n => pts(p, 'velocidad-200', 'm', n).points)).toEqual([5, 6, 7, 8, 9, 10]); expect(pts(p, 'velocidad-200', 'f', 43).passed).toBe(true)
    expect([420, 405, 390, 375, 360, 345].map(n => pts(p, 'resistencia-1500', 'm', n).points)).toEqual([5, 6, 7, 8, 9, 10]); expect(pts(p, 'resistencia-1500', 'f', 421).passed).toBe(false)
  })
  it('every official profile validates and has an official source', () => {
    for (const p of seed.profiles) { expect(m.validateProfile(p), p.id).toEqual([]); expect(p.source.kind).toBe('official') }
  })
})

describe('validation and administration helpers', () => {
  const base = () => clone(profile('bomberos-cegc'))
  it('names what is wrong', () => {
    const p = base(); p.source = { kind: 'blog', organism: '', reference: '', date: 'x' }
    expect(m.validateProfile(p)).toContain('source')
    const q = base(); q.tests[1].marks.m = [{ p: 5, v: 10 }, { p: 6, v: 8 }]
    expect(m.validateProfile(q).some(i => i.startsWith('test-scale-order'))).toBe(true)
    const r = base(); r.tests[0].marks.zz = [{ p: 5, v: 52 }]
    expect(m.validateProfile(r).some(i => i.startsWith('test-category'))).toBe(true)
    const s = base(); s.tests[0].capacity = 'magic'
    expect(m.validateProfile(s).some(i => i.startsWith('test-capacity'))).toBe(true)
    const t = base(); t.validFrom = '2026-05-01'; t.validUntil = '2026-01-01'
    expect(m.validateProfile(t)).toContain('valid-range')
    expect(m.validateProfile(null)).toEqual(['profile'])
  })
  it('sanitizeProfile drops unknown keys and keeps a valid profile valid', () => {
    const p = base(); p.evil = 'x'; p.tests[0].evil = 1
    const clean = m.sanitizeProfile(p)
    expect('evil' in clean).toBe(false); expect('evil' in clean.tests[0]).toBe(false)
    expect(m.validateProfile({ ...clean, version: 1, status: 'draft' })).toEqual([])
  })
  it('diffProfiles and needsNewVersion: marks, tests, scoring and the source create a version; a rename or a note does not', () => {
    const a = base()
    expect(m.needsNewVersion(a, { ...a, name: 'Otro nombre', notes: ['nueva nota'] })).toBe(false)
    const b = clone(a); b.tests[1].marks.m[0].v = 9
    expect(m.diffProfiles(a, b)).toEqual([{ kind: 'marks', test: 'dominadas' }])
    const c = clone(a); c.source.date = '2026-06-30'; c.convocatoria.reference = 'Nueva convocatoria'
    expect(m.diffProfiles(a, c).map(x => x.kind)).toEqual(['source', 'convocatoria'])
    const d = clone(a); d.tests.pop()
    expect(m.diffProfiles(a, d)).toEqual([{ kind: 'test-removed', test: 'resistencia-1500' }])
    expect(m.needsNewVersion(null, a)).toBe(false)
  })
  it('the compact scale form round-trips and refuses nonsense', () => {
    const s = m.parseScale('5(Apto)=8, 6=10.5, 7=12')
    expect(s).toEqual([{ p: 5, v: 8, label: 'Apto' }, { p: 6, v: 10.5 }, { p: 7, v: 12 }])
    expect(m.parseScale(m.formatScale(s))).toEqual(s)
    expect(m.parseScale('')).toBeNull(); expect(m.parseScale('cinco=ocho')).toBeNull()
  })
})

describe('levels per capacity: computed from the marks, with self-perception only as a flagged fallback', () => {
  const p = profile('bomberos-cegc')
  it('a mix of levels: running advanced, pull-ups beginner', () => {
    const l = m.levelsOf(p, 'm', { 'natacion-50': 38, dominadas: 5, 'press-banca': 20, 'velocidad-200': 29, 'resistencia-1500': 350 }, 'beginner')
    expect(l.byCapacity.endurance.level).toBe('advanced'); expect(l.byCapacity.speed.level).toBe('advanced')
    expect(l.byCapacity.pull.level).toBe('beginner'); expect(l.byCapacity.swim.level).toBe('intermediate')
    expect(l.byCapacity.pull.estimated).toBe(false); expect(l.global.estimated).toBe(false)
  })
  it('no marks: the self-perception is used and flagged as estimated; a missing mark never counts as a measured one', () => {
    const l = m.levelsOf(p, 'm', {}, 'intermediate')
    expect(l.global.level).toBe('intermediate'); expect(l.global.estimated).toBe(true); expect(Object.values(l.byCapacity).every(x => x.estimated)).toBe(true)
    const partial = m.levelsOf(p, 'm', { dominadas: 18 }, 'beginner')
    expect(partial.byCapacity.pull.estimated).toBe(false); expect(partial.byCapacity.endurance.estimated).toBe(true); expect(partial.global.estimated).toBe(false)
  })
})

describe('horizons: 6, 12, 18 and 24 months as phases, not four giant routines', () => {
  it('each horizon gives Base · Development · Specificity · Competitive covering every week', () => {
    for (const months of m.HORIZONS) {
      const weeks = m.totalWeeks(months, null, NOW)
      const phases = m.phasePlan(weeks, months)
      expect(phases.map(x => x.phase)).toEqual(['base', 'development', 'specificity', 'competitive'])
      expect(phases.reduce((a, x) => a + x.weeks, 0)).toBe(weeks)
      expect(phases[0].from).toBe(1); expect(phases[3].to).toBe(weeks); expect(phases.every(x => x.weeks >= 1)).toBe(true)
      expect(m.phaseAtWeek(phases, 1)).toBe('base'); expect(m.phaseAtWeek(phases, weeks)).toBe('competitive')
    }
    expect(m.totalWeeks(6, null, NOW)).toBe(26); expect(m.totalWeeks(24, null, NOW)).toBe(104)
    expect(m.phasePlan(104, 24)[0].weeks).toBeGreaterThan(m.phasePlan(26, 6)[0].weeks)
  })
  it('an exam date sets the length and the closest horizon; short and absurd dates stay in range', () => {
    expect(m.horizonFor('2027-04-11', NOW)).toBe(6); expect(m.horizonFor('2027-10-10', NOW)).toBe(12); expect(m.horizonFor('2028-04-10', NOW)).toBe(18); expect(m.horizonFor('2028-10-10', NOW)).toBe(24); expect(m.horizonFor(null, NOW)).toBeNull()
    expect(m.totalWeeks(12, '2026-11-01', NOW)).toBe(3); expect(m.totalWeeks(12, '2040-01-01', NOW)).toBe(110)
    expect(m.phasePlan(3, 6).reduce((a, x) => a + x.weeks, 0)).toBe(3)
  })
})

describe('plan generation from a profile', () => {
  const intake = (o = {}) => ({ sex: 'm', age: 29, days: 4, minutes: 60, organism: 'CEGC', convocatoria: '37 plazas', testVersion: '2025', selfLevel: 'beginner', ...o })
  const marks = { 'natacion-50': 58, dominadas: 5, 'press-banca': 11, 'velocidad-200': 41, 'resistencia-1500': 440 }

  it('builds a valid 5-week block for every profile, horizon and sex (4 training weeks + a control week), with exercises from the real library', () => {
    for (const p of seed.profiles) for (const sex of ['m', 'f']) for (const months of m.HORIZONS) {
      const r = m.newPlan({ profile: p, intake: intake({ sex, age: 36 }), marks: {}, months, now: NOW })
      expect(r.error, `${p.slug} ${sex} ${months}`).toBeUndefined()
      expect(validateDefinition(r.block.definition, ctx), `${p.slug} ${sex} ${months}`).toEqual([])
      const weeks = r.block.definition.weeks
      expect(weeks).toHaveLength(5); expect(weeks[4].phase).toBe('control'); expect(weeks[4].sessions[0].key.startsWith('control')).toBe(true)
      expect(r.plan.weeksTotal).toBe(m.totalWeeks(months, null, NOW)); expect(r.plan.phases).toHaveLength(4)
      expect(weeks.slice(0, 4).every(w => w.sessions.length === 4)).toBe(true)
    }
  })
  it('the control week carries every test of the member’s category, with the official name and the target', () => {
    const r = m.newPlan({ profile: profile('bomberos-cegc'), intake: intake(), marks, months: 12, now: NOW })
    const notes = r.block.definition.weeks[4].sessions.flatMap(s => s.blocks.map(b => b.note || '')).filter(n => n.startsWith('PRUEBA'))
    expect(notes).toHaveLength(5); expect(notes.some(n => /Dominadas/.test(n) && /Objetivo: 8/.test(n))).toBe(true)
    const pn = m.newPlan({ profile: profile('policia-nacional'), intake: intake({ sex: 'f' }), marks: {}, months: 12, now: NOW })
    const pnTests = pn.block.definition.weeks[4].sessions.flatMap(s => s.blocks.map(b => b.note || '')).filter(n => n.startsWith('PRUEBA')).join('|')
    expect(pnTests).toMatch(/Suspensión/); expect(pnTests).not.toMatch(/Dominadas/)
  })
  it('missing facts are asked for, never guessed', () => {
    expect(m.newPlan({ profile: profile('guardia-civil'), intake: intake({ age: null }), months: 12, now: NOW })).toMatchObject({ error: 'missing', missing: ['age'] })
    expect(m.newPlan({ profile: profile('guardia-civil'), intake: intake({ sex: null }), months: 12, now: NOW })).toMatchObject({ error: 'missing', missing: ['sex'] })
    expect(m.newPlan({ profile: profile('bomberos-cegc'), intake: intake({ organism: '' }), months: 12, now: NOW })).toMatchObject({ error: 'missing', missing: ['organism'] })
    expect(m.newPlan({ profile: profile('bomberos-cegc'), intake: intake(), now: NOW })).toMatchObject({ error: 'missing', missing: ['horizon'] })
    expect(m.newPlan({ profile: { ...profile('bomberos-cegc'), source: null }, intake: intake(), months: 12, now: NOW }).error).toBe('profile')
  })
  it('the plan is driven by the marks: the paces and targets in the notes come from the member and the official target', () => {
    const r = m.newPlan({ profile: profile('bomberos-cegc'), intake: intake(), marks, months: 12, ambition: 'pass', now: NOW })
    const flat = r.block.definition.weeks.flatMap(w => w.sessions.flatMap(s => s.blocks))
    expect(flat.some(b => /Objetivo: 8/.test(b.note || ''))).toBe(true)
    const run = flat.find(b => b.exercise === '0684' && b.conditioning?.speed)
    expect(run.conditioning.speed).toBeGreaterThan(3); expect(run.conditioning.speed).toBeLessThan(12)
    const strong = m.newPlan({ profile: profile('bomberos-cegc'), intake: intake(), marks: { ...marks, 'resistencia-1500': 340 }, months: 12, now: NOW })
    const speedOf = d => d.weeks[0].sessions.flatMap(s => s.blocks).find(b => b.exercise === '0684' && b.conditioning?.speed).conditioning.speed
    expect(speedOf(strong.block.definition)).toBeGreaterThan(speedOf(r.block.definition))
  })
  it('weak capacities are trained more often than strong ones', () => {
    const r = m.newPlan({ profile: profile('bomberos-cegc'), intake: intake({ days: 5, minutes: 90 }), marks: { 'natacion-50': 40, dominadas: 2, 'press-banca': 38, 'velocidad-200': 28, 'resistencia-1500': 340 }, months: 12, now: NOW })
    const titles = r.block.definition.weeks[0].sessions.map(s => s.title).join('|')
    const count = word => (titles.match(new RegExp(word, 'g')) || []).length
    expect(count('Dominadas')).toBeGreaterThanOrEqual(count('Natación')); expect(count('Dominadas')).toBeGreaterThanOrEqual(2)
  })
  it('availability and restrictions shape the plan: days/week, a knee restriction removes jumps, an ankle restriction removes running', () => {
    const three = m.newPlan({ profile: profile('policia-local-canarias'), intake: intake({ days: 3, minutes: 45 }), marks: {}, months: 12, now: NOW })
    expect(three.block.definition.weeks[0].sessions).toHaveLength(3)
    const knee = m.newPlan({ profile: profile('policia-local-canarias'), intake: intake({ restrictions: ['knee'], days: 6 }), marks: {}, months: 12, now: NOW })
    const ids = d => new Set(d.weeks.flatMap(w => w.sessions.flatMap(s => s.blocks.map(b => b.exercise))))
    expect(ids(knee.block.definition).has('0514')).toBe(false)
    const ankle = m.newPlan({ profile: profile('bomberos-cegc'), intake: intake({ restrictions: ['ankle'], days: 6 }), marks: {}, months: 12, now: NOW })
    expect(ids(ankle.block.definition).has('0003')).toBe(true)
    expect(ankle.block.definition.weeks[0].sessions.flatMap(s => s.blocks).some(b => /restricción de tobillo/.test(b.note || ''))).toBe(true)
    for (const r of [three, knee, ankle]) expect(validateDefinition(r.block.definition, ctx)).toEqual([])
  })
  it('the plan pins a snapshot of the profile: a later change of the profile object never reaches it', () => {
    const p = clone(profile('bomberos-cegc'))
    const r = m.newPlan({ profile: p, intake: intake(), marks, months: 12, now: NOW })
    p.tests[1].marks.m[0].v = 99; p.version = 5
    expect(r.plan.profile.tests[1].marks.m[0].v).toBe(8); expect(r.plan.profileVersion).toBe(1)
    expect(m.summarizePlan(r.plan, { now: NOW }).officialThresholds.dominadas.minimum).toBe(8)
  })
})

describe('control, projection and adaptation', () => {
  const p = profile('bomberos-cegc')
  const mk = () => m.newPlan({ profile: p, intake: { sex: 'm', age: 29, days: 4, minutes: 60, organism: 'CEGC', convocatoria: 'x', testVersion: 'y' }, marks: { 'natacion-50': 58, dominadas: 5, 'press-banca': 11, 'velocidad-200': 41, 'resistencia-1500': 440 }, examDate: '2027-04-11', months: 6, ambition: 'pass', now: NOW }).plan
  const later = NOW + 5 * WEEK

  it('compares initial, previous, current, official minimum and target and gives a status per test', () => {
    const plan = mk()
    const ev = m.evaluate(plan, { 'natacion-50': 49, dominadas: 5, 'press-banca': 16, 'velocidad-200': 41, 'resistencia-1500': 400 }, { now: later, adherence: 90 })
    const swim = ev.perTest['natacion-50'], pull = ev.perTest.dominadas, bench = ev.perTest['press-banca']
    expect(swim).toMatchObject({ value: 49, initial: 58, minimum: 52, target: 52, points: 5, status: 'above-target' })
    expect(pull).toMatchObject({ value: 5, initial: 5, minimum: 8, status: expect.stringMatching(/^(at-risk|stalled)$/) })
    expect(bench.status).toBe('above-target')
    expect(ev.perTest['resistencia-1500'].points).toBe(6); expect(ev.overall.passed).toBe(false)
    expect(ev.weak).toContain('dominadas'); expect(typeof pull.projected).toBe('number')
    expect(ev.weeksLeft).toBeGreaterThan(20)
  })
  it('stalled, on-track and at-risk are told apart; a test without a mark is "no-data" and never scored', () => {
    let plan = mk()
    plan = m.recordEvaluation(plan, m.evaluate(plan, { dominadas: 6, 'natacion-50': 55 }, { now: later }))
    const second = m.evaluate(plan, { dominadas: 6, 'natacion-50': 53 }, { now: later + 5 * WEEK })
    expect(second.perTest.dominadas.status).toBe('stalled'); expect(second.perTest['natacion-50'].status).toBe('on-track')
    expect(second.perTest['press-banca']).toEqual({ value: null, status: 'no-data' })
    const farAway = mk(); const near = m.evaluate(farAway, { dominadas: 4 }, { now: NOW + 40 * WEEK })
    expect(near.perTest.dominadas.status).toBe('at-risk')
  })
  it('a proposal is capped and never applies itself: pain or high fatigue lower the volume, good adherence raises it by at most 10 %', () => {
    const plan = mk()
    const base = { 'natacion-50': 50, dominadas: 8, 'press-banca': 20, 'velocidad-200': 38, 'resistencia-1500': 410 }
    const tired = m.recordEvaluation(plan, m.evaluate(plan, base, { now: later, adherence: 90, fatigue: 'high' }))
    const a = m.proposeNext(tired, tired.evaluations[0], { now: later })
    expect(a.scale).toBe(0.8); expect(a.changes.some(c => c.kind === 'volume' && c.pct === -20)).toBe(true); expect(a.confirmed).toBe(false)
    const lazy = m.recordEvaluation(plan, m.evaluate(plan, base, { now: later, adherence: 40 }))
    expect(m.proposeNext(lazy, lazy.evaluations[0], { now: later }).scale).toBe(0.85)
    const good = m.recordEvaluation(plan, m.evaluate(plan, base, { now: later, adherence: 95 }))
    const g = m.proposeNext(good, good.evaluations[0], { now: later })
    expect(g.scale).toBe(1.1); expect(g.changes.some(c => c.kind === 'volume' && c.pct === 10)).toBe(true)
    const pain = m.recordEvaluation(plan, m.evaluate(plan, base, { now: later, pain: true }))
    expect(pain.evaluations[0].needsReview).toBe(true); expect(pain.alerts).toEqual(['review'])
    expect(m.proposeNext(pain, pain.evaluations[0], { now: later }).changes.some(c => c.kind === 'review')).toBe(true)
  })
  it('weak capacities get more weight in the next block and the block is deterministic from the stored proposal', () => {
    const plan0 = mk()
    const ev = m.evaluate(plan0, { 'natacion-50': 49, dominadas: 5, 'press-banca': 16, 'velocidad-200': 36, 'resistencia-1500': 400 }, { now: later, adherence: 80 })
    const plan = m.recordEvaluation(plan0, ev)
    const prop = m.proposeNext(plan, ev, { now: later })
    expect(prop.changes.some(c => c.kind === 'focus' && c.capacity === 'pull')).toBe(true)
    const a = m.blockFor(plan, prop), b = m.blockFor(plan, prop)
    expect(a).toEqual(b); expect(validateDefinition(a.definition, ctx)).toEqual([])
    expect(JSON.stringify(prop).length).toBeLessThan(1500)
  })
  it('a new convocatoria is a new version: the plan keeps its pinned one until the member moves, and the old version stays in its history', () => {
    const plan = mk()
    const next = clone(p); next.version = 2; next.tests[1].marks.m = [{ p: 5, v: 10 }, { p: 10, v: 20 }]; next.source.date = '2026-09-01'
    expect(m.diffProfiles(plan.profile, next).map(x => x.kind)).toEqual(['source', 'marks'])
    expect(m.summarizePlan(plan, { now: NOW }).officialThresholds.dominadas.minimum).toBe(8)
    const moved = m.moveToVersion(plan, next, { now: later })
    expect(moved.profileVersion).toBe(2); expect(moved.profileHistory.map(h => h.version)).toEqual([1]); expect(moved.profileHistory[0].snapshot.tests[1].marks.m[0].v).toBe(8)
    expect(m.summarizePlan(moved, { now: later }).officialThresholds.dominadas.minimum).toBe(10)
    expect(plan.profileVersion).toBe(1)
  })
})
