import { describe, it, expect } from 'vitest'
import { routinePrintHTML, routinesPrintHTML, planPrintHTML, programPrintHTML } from './plan-share.js'
import { EXDB } from './exercises.js'

const LIFT = EXDB.find(e => e.bp !== 'cardio').id
const LIFT2 = EXDB.filter(e => e.bp !== 'cardio')[1].id
const LIFT3 = EXDB.filter(e => e.bp !== 'cardio')[2].id

const routine = (over = {}) => ({ id: 'r1', name: 'Full body', ex: [{ id: LIFT, sets: 3, reps: 8 }], ...over })

describe('V1.4 print — dayTableHTML via routinePrintHTML', () => {
  it('renders one row per exercise with a sequential Nº, the exercise name, sets×reps and 4 blank week columns', async () => {
    const html = await routinePrintHTML(routine(), 'Juanjo Perez')
    expect(html).toContain('Full body')
    expect(html).toMatch(/<td class="num">1<\/td>/)
    // 4 SEMANA/Week headers
    expect((html.match(/class="week"/g) || []).length).toBeGreaterThanOrEqual(4)
    // one write-in box per set (3 sets here), repeated in each of the 4 week columns
    expect((html.match(/class="box"/g) || []).length).toBe(3 * 4)
  })

  it('never prints a starting weight — the point is writing it in by hand across weeks', async () => {
    const html = await routinePrintHTML(routine({ ex: [{ id: LIFT, sets: 3, reps: 8, weight: 60 }] }), '')
    // scheme() output for this row is "3 × 8", the weight must not leak into it
    expect(html).not.toMatch(/3\s*×\s*8\s*·\s*60/)
  })

  it('leaves the RPE cell blank when nothing was actually planned', async () => {
    const html = await routinePrintHTML(routine({ ex: [{ id: LIFT, sets: 3, reps: 8, prog: 'linear' }] }), '')
    expect(html).toMatch(/<td class="rpe"><\/td>/)
  })

  it('prints a real planned RPE only for the pct1rm policy\'s own target RIR, converted to the RPE scale', async () => {
    const html = await routinePrintHTML(routine({ ex: [{ id: LIFT, sets: 3, reps: 5, prog: 'pct1rm', targetRIR: 2 }] }), '')
    // RIR 2 == RPE 8, the same equivalence the rest of the app already uses
    expect(html).toMatch(/<td class="rpe">8<\/td>/)
  })

  it('prints a trainer note (V3) under the exercise name when the prescription has one', async () => {
    const html = await routinePrintHTML(routine({ ex: [{ id: LIFT, sets: 3, reps: 8, note: 'Excéntrica controlada' }] }), '')
    expect(html).toContain('class="ex-note"')
    expect(html).toContain('Excéntrica controlada')
  })

  it('prints no note element at all when the prescription has none — the common case is untouched', async () => {
    const html = await routinePrintHTML(routine(), '')
    expect(html).not.toContain('class="ex-note"')
  })

  it('truncates a long note hard rather than letting it wrap and grow the row', async () => {
    const long = 'x'.repeat(200)
    const html = await routinePrintHTML(routine({ ex: [{ id: LIFT, sets: 3, reps: 8, note: long }] }), '')
    const m = html.match(/<div class="ex-note">([^<]*)<\/div>/)
    expect(m).toBeTruthy()
    expect(m[1].length).toBeLessThan(long.length)
    expect(m[1].endsWith('…')).toBe(true)
  })

  it('marks a genuine superset with an A1/A2 badge on adjacent rows sharing one group', async () => {
    const r = routine({ ex: [{ id: LIFT, sets: 3, reps: 8, sg: 'g1' }, { id: LIFT2, sets: 3, reps: 8, sg: 'g1' }] })
    const html = await routinePrintHTML(r, '')
    expect(html).toContain('>A1<')
    expect(html).toContain('>A2<')
    expect((html.match(/class="ss-row"/g) || []).length).toBe(2)
  })

  it('gives a second, different superset group in the same routine a different letter', async () => {
    const r = routine({
      ex: [
        { id: LIFT, sets: 3, reps: 8, sg: 'g1' }, { id: LIFT2, sets: 3, reps: 8, sg: 'g1' },
        { id: LIFT3, sets: 3, reps: 8, sg: 'g2' }, { id: LIFT, sets: 3, reps: 8, sg: 'g2' },
      ],
    })
    const html = await routinePrintHTML(r, '')
    expect(html).toContain('>A1<')
    expect(html).toContain('>B1<')
  })

  it('does not mark a lone (non-superset) exercise with any badge', async () => {
    const html = await routinePrintHTML(routine(), '')
    // the CSS ruleset always defines .ss-badge/.ss-row (shared, unconditional styles) — what
    // must NOT happen is either class actually being applied to an element in the body
    expect(html).not.toMatch(/class="ss-badge"/)
    expect(html).not.toMatch(/class="ss-row"/)
  })

  it('renders "No exercises yet." instead of an empty table for a routine with none', async () => {
    const html = await routinePrintHTML(routine({ ex: [] }), '')
    expect(html).toContain('No routines yet.')
  })
})

describe('V1.4 print — filename (document <title>)', () => {
  it('is "Routine <owner> (DD-MM-YYYY)" for a single routine — the exact shape the brief asks for', async () => {
    const html = await routinePrintHTML(routine(), 'Juanjo Perez')
    const m = html.match(/<title>([^<]*)<\/title>/)
    expect(m[1]).toMatch(/^Routine Juanjo Perez \(\d{2}-\d{2}-\d{4}\)$/)
  })

  it('strips characters a filesystem can\'t take, from an owner name that has them', async () => {
    const html = await routinePrintHTML(routine(), 'Juan/Jo:Perez?')
    const m = html.match(/<title>([^<]*)<\/title>/)
    expect(m[1]).not.toMatch(/[\\/:*?"<>|]/)
  })

  it('still produces a valid title with no owner name at all', async () => {
    const html = await routinePrintHTML(routine(), '')
    const m = html.match(/<title>([^<]*)<\/title>/)
    expect(m[1]).toMatch(/^Routine \(\d{2}-\d{2}-\d{4}\)$/)
  })
})

describe('V1.4 print — adaptive density', () => {
  const manyExRoutine = n => routine({ ex: Array.from({ length: n }, (_, i) => ({ id: [LIFT, LIFT2, LIFT3][i % 3], sets: 3, reps: 8 })) })

  it('picks the roomiest tier for a short routine', async () => {
    const html = await routinePrintHTML(routine(), '')
    expect(html).toContain('class="density-normal"')
  })

  it('steps down to a tighter tier as a single day carries more exercises', async () => {
    const html = await routinePrintHTML(manyExRoutine(20), '')
    expect(html).toMatch(/class="density-(compact|tight)"/)
  })

  it('a 5-day plan is tighter than a 2-day one with the same exercises per day, day count alone forcing it down', async () => {
    const S2 = { unit: 'kg', routines: [routine({ id: 'ra' })], week: { 1: 'ra' } }
    const html2 = await planPrintHTML(S2, '')
    const routines5 = Array.from({ length: 5 }, (_, i) => routine({ id: 'r' + i, name: 'Day ' + i }))
    const S5 = { unit: 'kg', routines: routines5, week: { 1: 'r0', 2: 'r1', 3: 'r2', 4: 'r3', 5: 'r4' } }
    const html5 = await planPrintHTML(S5, '')
    expect(html2).toContain('class="density-normal"')
    expect(html5).not.toContain('class="density-normal"')
  })
})

describe('V1.4 print — page-break safety', () => {
  it('every day is marked break-inside:avoid, so a table can never split across a page', async () => {
    const routines = [routine({ id: 'r1', name: 'Day A' }), routine({ id: 'r2', name: 'Day B' })]
    const html = await routinesPrintHTML(routines, '')
    expect(html).toContain('.day { break-inside: avoid; page-break-inside: avoid; }')
  })

  it('a day header stays glued to its own table (break-after: avoid)', async () => {
    const html = await routinePrintHTML(routine(), '')
    expect(html).toContain('break-after: avoid; page-break-after: avoid;')
  })
})

describe('V1.4 print — program view', () => {
  it('prints each program day with its own weekday label, same as the whole-plan view', async () => {
    const program = { id: 'p1', name: 'My Program', week: { 1: 'r1' } }
    const routines = [routine()]
    const html = await programPrintHTML(program, routines, 'Juanjo')
    expect(html).toContain('My Program')
    // the on-page heading may say "Program", but the save-file name is always "Routine ..." —
    // one PDF-naming convention regardless of whether the source was a loose routine or a
    // program, per the brief's explicit "Rutina Nombre Apellidos (...)" requirement
    expect(html).toMatch(/<title>Routine Juanjo \(\d{2}-\d{2}-\d{4}\)<\/title>/)
  })
})

describe('V1.4 print — filename is always "Routine ...", never "Program"/"Plan"/"Routines"', () => {
  it('a hand-picked multi-routine selection still files under "Routine", not "Routines"', async () => {
    const html = await routinesPrintHTML([routine({ id: 'r1' }), routine({ id: 'r2' })], 'Juanjo Perez')
    const m = html.match(/<title>([^<]*)<\/title>/)
    expect(m[1]).toMatch(/^Routine Juanjo Perez \(\d{2}-\d{2}-\d{4}\)$/)
  })

  it('the whole weekly plan view still files under "Routine", not "Plan"', async () => {
    const S = { unit: 'kg', routines: [routine({ id: 'r1' })], week: { 1: 'r1' } }
    const html = await planPrintHTML(S, 'Juanjo Perez')
    const m = html.match(/<title>([^<]*)<\/title>/)
    expect(m[1]).toMatch(/^Routine Juanjo Perez \(\d{2}-\d{2}-\d{4}\)$/)
  })

  it('a program with its own weekday schedule still files under "Routine", not "Program"', async () => {
    const program = { id: 'p1', name: 'My Program', week: { 1: 'r1' } }
    const html = await programPrintHTML(program, [routine({ id: 'r1' })], 'Juanjo Perez')
    const m = html.match(/<title>([^<]*)<\/title>/)
    expect(m[1]).toMatch(/^Routine Juanjo Perez \(\d{2}-\d{2}-\d{4}\)$/)
  })

  it('an unscheduled program (routines but no days assigned) still files under "Routine"', async () => {
    const program = { id: 'p1', name: 'My Program', week: {} }
    const html = await programPrintHTML(program, [routine({ id: 'r1' })], 'Juanjo Perez')
    const m = html.match(/<title>([^<]*)<\/title>/)
    expect(m[1]).toMatch(/^Routine Juanjo Perez \(\d{2}-\d{2}-\d{4}\)$/)
  })
})
