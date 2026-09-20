import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { importAliasKey, localCandidates, buildImportPlan, applyImportResolutions } from './import-match.js'
import { workoutFingerprint, mergeImport } from './import-csv.js'
import { EXDB } from './exercises.js'

const LIFT = EXDB.find(e => e.bp !== 'cardio')
const LIFT2 = EXDB.filter(e => e.bp !== 'cardio')[1]

const parsedWith = (customEx, over = {}) => ({
  kind: 'workouts', source: 'Hevy', sets: 0, matched: 0, created: customEx.length,
  unmatchedNames: customEx.map(c => c.n), warmups: 0, rpeSets: 0, rirSets: 0,
  fileUnit: '', mixedUnits: false, converted: false, from: null, to: null,
  workouts: [], customEx,
  ...over,
})

const customExOf = (id, name) => ({ id, n: name.toLowerCase(), custom: true, eq: 'custom', tg: '', desc: '', bp: 'upper legs' })

describe('importAliasKey', () => {
  it('normalises case, diacritics and surrounding whitespace so the same real name always lands on one key', () => {
    expect(importAliasKey('Hevy', 'Press Inclinado')).toBe(importAliasKey('hevy', '  press inclinado  '))
    expect(importAliasKey('Hevy', 'Extensión de Tríceps')).toBe(importAliasKey('HEVY', 'extension de triceps'))
  })

  it('namespaces by source — the same raw name from two different apps is two different keys', () => {
    expect(importAliasKey('Hevy', 'Press banca')).not.toBe(importAliasKey('Gravl', 'Press banca'))
  })
})

describe('localCandidates', () => {
  it('finds the exact catalogue exercise for its own English name', () => {
    const cands = localCandidates(LIFT.n)
    expect(cands.some(c => c.id === LIFT.id)).toBe(true)
  })

  it('returns nothing for gibberish rather than forcing a low-quality guess', () => {
    expect(localCandidates('zzxxqqwwuu999')).toEqual([])
  })

  it('never returns more than the requested limit', () => {
    const cands = localCandidates(LIFT.n, 2)
    expect(cands.length).toBeLessThanOrEqual(2)
  })
})

describe('buildImportPlan — alias table (no Gemini call needed)', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('resolves straight from a confirmed alias and never calls the matching endpoint', async () => {
    const c = customExOf('im1', 'Press Inclinado Con Mancuernas')
    const key = importAliasKey('Hevy', c.n)
    fetch.mockImplementation(async url => {
      if (String(url).includes('/api/exercises/import-aliases')) {
        return { ok: true, json: async () => ({ aliases: [{ key, exerciseId: LIFT.id, source: 'Hevy', externalName: c.n }] }) }
      }
      throw new Error('should not call ' + url)
    })
    const plan = await buildImportPlan(parsedWith([c]))
    expect(plan.get('im1').status).toBe('alias')
    expect(plan.get('im1').exerciseId).toBe(LIFT.id)
    // Only the alias-table GET happened — no POST to /api/exercises/import-match.
    expect(fetch.mock.calls.every(([url]) => !String(url).includes('import-match'))).toBe(true)
  })

  it('a network failure fetching aliases falls through to local candidates, never throws', async () => {
    const c = customExOf('im1', LIFT.n)
    fetch.mockImplementation(async () => { throw new Error('offline') })
    const plan = await buildImportPlan(parsedWith([c]), { useGemini: false })
    expect(plan.get('im1').status).toBe('pending')
  })
})

describe('buildImportPlan — Gemini suggestion (optional)', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('a validated MATCH becomes a preselected "suggested" resolution', async () => {
    const c = customExOf('im1', LIFT.n)   // scores well locally against its own English name
    fetch.mockImplementation(async (url, opts) => {
      if (String(url).includes('import-aliases')) return { ok: true, json: async () => ({ aliases: [] }) }
      if (String(url).includes('import-match')) {
        const body = JSON.parse(opts.body)
        const name = body.items[0].name
        return { ok: true, json: async () => ({ results: [{ externalName: name, status: 'MATCH', exerciseId: LIFT.id, confidence: 0.9, reason: 'same lift' }] }) }
      }
      throw new Error('unexpected ' + url)
    })
    const plan = await buildImportPlan(parsedWith([c]))
    const res = plan.get('im1')
    expect(res.status).toBe('suggested')
    expect(res.exerciseId).toBe(LIFT.id)
    expect(res.confidence).toBe(0.9)
  })

  it('IA auxiliar off/failing never blocks the plan — falls back to pending with local candidates', async () => {
    const c = customExOf('im1', LIFT.n)
    fetch.mockImplementation(async url => {
      if (String(url).includes('import-aliases')) return { ok: true, json: async () => ({ aliases: [] }) }
      if (String(url).includes('import-match')) return { ok: false, json: async () => ({ error: 'la IA auxiliar no está configurada en este servidor' }) }
      throw new Error('unexpected ' + url)
    })
    const plan = await buildImportPlan(parsedWith([c]))
    const res = plan.get('im1')
    expect(res.status).toBe('pending')
    expect(res.candidates.some(cand => cand.id === LIFT.id)).toBe(true)
  })

  it('useGemini:false skips the matching call entirely, even with candidates available', async () => {
    const c = customExOf('im1', LIFT.n)
    fetch.mockImplementation(async url => {
      if (String(url).includes('import-aliases')) return { ok: true, json: async () => ({ aliases: [] }) }
      throw new Error('should not call ' + url)
    })
    const plan = await buildImportPlan(parsedWith([c]), { useGemini: false })
    expect(plan.get('im1').status).toBe('pending')
  })
})

describe('applyImportResolutions', () => {
  it('remaps entries for an alias hit automatically, with nothing to explicitly confirm', () => {
    const c = customExOf('im1', LIFT.n)
    const parsed = parsedWith([c], {
      workouts: [{ id: 'w1', d: '2026-01-01', start: 0, end: 0, entries: [{ id: 'im1', sets: [{ w: 20, r: 10, done: true }], topW: 20 }], prs: [] }],
    })
    const plan = new Map([['im1', { name: c.n, key: importAliasKey('Hevy', c.n), status: 'alias', exerciseId: LIFT.id, candidates: [] }]])
    const out = applyImportResolutions(parsed, plan, new Map())
    expect(out.workouts[0].entries[0].id).toBe(LIFT.id)
    expect(out.customEx).toEqual([])
    // Already a confirmed alias from a previous import — nothing new to persist.
    expect(out.aliasesToSave).toEqual([])
  })

  it('a Gemini suggestion left untouched (never confirmed) stays a custom exercise — conservative by default', () => {
    const c = customExOf('im1', LIFT.n)
    const parsed = parsedWith([c], {
      workouts: [{ id: 'w1', d: '2026-01-01', start: 0, end: 0, entries: [{ id: 'im1', sets: [], topW: null }], prs: [] }],
    })
    const plan = new Map([['im1', { name: c.n, key: importAliasKey('Hevy', c.n), status: 'suggested', exerciseId: LIFT.id, candidates: [], confidence: 0.9 }]])
    const out = applyImportResolutions(parsed, plan, new Map())   // nothing confirmed
    expect(out.workouts[0].entries[0].id).toBe('im1')
    expect(out.customEx).toEqual([c])
    expect(out.aliasesToSave).toEqual([])
  })

  it('an explicit human confirmation remaps the entry AND queues a new alias to persist', () => {
    const c = customExOf('im1', LIFT.n)
    const parsed = parsedWith([c], {
      workouts: [{ id: 'w1', d: '2026-01-01', start: 0, end: 0, entries: [{ id: 'im1', sets: [], topW: null }], prs: [] }],
    })
    const key = importAliasKey('Hevy', c.n)
    const plan = new Map([['im1', { name: c.n, key, status: 'suggested', exerciseId: LIFT.id, candidates: [], confidence: 0.9 }]])
    const confirmed = new Map([['im1', LIFT.id]])
    const out = applyImportResolutions(parsed, plan, confirmed)
    expect(out.workouts[0].entries[0].id).toBe(LIFT.id)
    expect(out.customEx).toEqual([])
    expect(out.aliasesToSave).toEqual([{ key, exerciseId: LIFT.id, source: 'Hevy', externalName: c.n }])
  })

  it('"create as your own" (the \'own\' sentinel) is a no-op remap, never saves an alias', () => {
    const c = customExOf('im1', LIFT.n)
    const parsed = parsedWith([c], { workouts: [] })
    const plan = new Map([['im1', { name: c.n, key: importAliasKey('Hevy', c.n), status: 'pending', exerciseId: null, candidates: [] }]])
    const confirmed = new Map([['im1', 'own']])
    const out = applyImportResolutions(parsed, plan, confirmed)
    expect(out.customEx).toEqual([c])
    expect(out.aliasesToSave).toEqual([])
  })

  it('never invents an id — a confirmed exerciseId that does not exist in the library is ignored', () => {
    const c = customExOf('im1', LIFT.n)
    const parsed = parsedWith([c], { workouts: [] })
    const plan = new Map([['im1', { name: c.n, key: importAliasKey('Hevy', c.n), status: 'pending', exerciseId: null, candidates: [] }]])
    const confirmed = new Map([['im1', 'not-a-real-id']])
    const out = applyImportResolutions(parsed, plan, confirmed)
    expect(out.customEx).toEqual([c])
    expect(out.aliasesToSave).toEqual([])
  })
})

describe('mergeImport — fingerprint-based antiduplicados (V2)', () => {
  const mkWorkout = (id, d, start, exId, n) => ({
    id, d, start, end: start, routineId: null, name: 'x',
    entries: [{ id: exId, sets: Array.from({ length: n }, () => ({ w: 20, r: 10, done: true })), topW: 20 }],
    prs: [], vol: 200 * n,
  })

  it('reimporting the exact same file never duplicates a workout', () => {
    const w = mkWorkout('iw1', '2026-06-01', 1000, LIFT.id, 3)
    const S = { workouts: [], customEx: [], exWeights: {} }
    const r1 = mergeImport(S, { kind: 'workouts', workouts: [w], customEx: [] })
    expect(r1.added).toBe(1)
    // Reimport: same content, but a brand-new random `id` (uid()) — exactly what parsing the
    // same file a second time produces. The fingerprint must still catch it.
    const w2 = { ...w, id: 'iw2' }
    const r2 = mergeImport(S, { kind: 'workouts', workouts: [w2], customEx: [] })
    expect(r2.added).toBe(0)
    expect(S.workouts).toHaveLength(1)
  })

  it('two genuinely different sessions logged the same day are both kept, not merged into one', () => {
    const morning = mkWorkout('iw1', '2026-06-01', 8 * 3600000, LIFT.id, 3)
    const evening = mkWorkout('iw2', '2026-06-01', 19 * 3600000, LIFT2.id, 4)
    const S = { workouts: [], customEx: [], exWeights: {} }
    const r = mergeImport(S, { kind: 'workouts', workouts: [morning, evening], customEx: [] })
    expect(r.added).toBe(2)
    expect(S.workouts).toHaveLength(2)
  })

  // Regression — caught in a real E2E run, not in review: reimporting a Hevy file where most
  // exercise names still had NO alias (stayed custom, exactly as V1 always did) showed every
  // one of those workouts as "new" again, forever. Cause: parseWorkoutCSV mints a fresh random
  // customEx id ('im'+uid()) on every parse for anything unresolved — fingerprinting by entry
  // id therefore never matches between two parses of the very same file whenever a workout
  // contains so much as one still-unresolved exercise (the common case for a Spanish export).
  // Fix: fingerprint by the exercise's NAME, not its id — stable either way, whether the name
  // resolves through EXIDX (a real id) or comes straight from the CSV's own exercise-name text
  // (an unresolved placeholder, via the customEx list passed as the second argument).
  it('a workout with an unresolved custom exercise fingerprints identically across two separate parses of the same file', () => {
    const c1 = customExOf('im' + Math.random(), 'extensión de tríceps en polea')
    const w1 = { id: 'iw1', d: '2026-06-01', start: 1000, end: 1000, entries: [{ id: c1.id, sets: [{ w: 20, r: 10, done: true }], topW: 20 }], prs: [] }
    // A second, independent parse of the same file: identical exercise NAME, but parseWorkoutCSV
    // hands it a brand-new random placeholder id, same as it would for a real reimport.
    const c2 = customExOf('im' + Math.random(), 'extensión de tríceps en polea')
    const w2 = { id: 'iw2', d: '2026-06-01', start: 1000, end: 1000, entries: [{ id: c2.id, sets: [{ w: 20, r: 10, done: true }], topW: 20 }], prs: [] }
    expect(c1.id).not.toBe(c2.id)   // the very thing that broke the old id-based fingerprint
    expect(workoutFingerprint(w1, [c1])).toBe(workoutFingerprint(w2, [c2]))
  })

  it('reimporting a file with mostly-unresolved exercises still detects every workout as a duplicate', () => {
    const c1 = customExOf('imA', 'curl predicador (máquina)')
    const stored = { id: 'iwFirst', d: '2026-06-01', start: 1000, end: 1000, routineId: null, name: 'x', entries: [{ id: c1.id, sets: [{ w: 20, r: 10, done: true }], topW: 20 }], prs: [], vol: 200 }
    const S = { workouts: [stored], customEx: [c1], exWeights: {} }

    // A second parse of the same file — same exercise name, unrelated fresh placeholder id.
    const c2 = customExOf('imB', 'curl predicador (máquina)')
    const reparsed = { id: 'iwSecond', d: '2026-06-01', start: 1000, end: 1000, routineId: null, name: 'x', entries: [{ id: c2.id, sets: [{ w: 20, r: 10, done: true }], topW: 20 }], prs: [], vol: 200 }
    const r = mergeImport(S, { kind: 'workouts', workouts: [reparsed], customEx: [c2] })
    expect(r.added).toBe(0)
    expect(S.workouts).toHaveLength(1)
  })

  it('workoutFingerprint is stable for identical content and differs when the exercise set differs', () => {
    const a = mkWorkout('x1', '2026-06-01', 1000, LIFT.id, 3)
    const b = mkWorkout('x2', '2026-06-01', 1000, LIFT.id, 3)   // same content, different id
    const c = mkWorkout('x3', '2026-06-01', 1000, LIFT.id, 4)   // different set count
    expect(workoutFingerprint(a)).toBe(workoutFingerprint(b))
    expect(workoutFingerprint(a)).not.toBe(workoutFingerprint(c))
  })
})
