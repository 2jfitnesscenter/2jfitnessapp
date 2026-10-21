import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'

/* The shared exercise note: one value per member + exercise; the member (no memberId) and the staff (memberId) read and write the same text. */
const server = {}   // memberId -> { exerciseId -> note }, standing in for /api/exercise-notes
const calls = []
vi.mock('../lib/api.js', () => ({
  api: vi.fn(async (path, opts = {}) => {
    calls.push({ path, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null })
    const body = opts.body ? JSON.parse(opts.body) : {}
    const who = body.memberId || new URL('http://x' + path).searchParams.get('memberId') || 'm1'   // the signed-in member is m1
    server[who] = server[who] || {}
    if (opts.method === 'POST') {
      if (!body.text.trim()) { delete server[who][body.exerciseId]; return { ok: true, note: null } }
      return { ok: true, note: (server[who][body.exerciseId] = { text: body.text.trim(), updatedAt: 'now', updatedBy: 'x' }) }
    }
    return { notes: server[who] }
  }),
}))

let lib, Note
beforeEach(async () => {
  calls.length = 0; for (const k of Object.keys(server)) delete server[k]
  vi.resetModules()
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {}, removeItem() {} })
  vi.stubGlobal('navigator', {})
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn(), body: { classList: { toggle: vi.fn(), remove: vi.fn() } } })
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), matchMedia: () => ({ matches: false }) })
  lib = await import('../lib/exercise-notes.js')
  Note = (await import('./SharedExerciseNote.jsx')).default
})

describe('shared exercise note', () => {
  it('an exercise without a note is a quiet "Nota" link (empty never breaks the card)', async () => {
    await lib.loadNotes(null)
    const html = renderToStaticMarkup(<Note exerciseId="0025" />)
    expect(html).toContain('sx-note-add'); expect(html).not.toContain('sx-note-text')
  })

  it('the member writes it, then sees it on the next screen; deleting empties it again', async () => {
    await lib.loadNotes(null)
    await lib.saveNote(null, '0025', 'Supino')
    expect(renderToStaticMarkup(<Note exerciseId="0025" />)).toContain('Supino')
    await lib.saveNote(null, '0025', '')
    expect(renderToStaticMarkup(<Note exerciseId="0025" />)).toContain('sx-note-add')
  })

  it('staff edit the SAME value through memberId: the member sees the trainer’s text and the trainer the member’s', async () => {
    await lib.saveNote(null, '0025', 'Supino')                                  // the member (m1)
    await lib.saveNote('m1', '0025', 'Supino y neutro alternando series')      // the trainer, on m1
    lib.forgetExerciseNotes(); await lib.loadNotes(null)
    expect(renderToStaticMarkup(<Note exerciseId="0025" />)).toContain('Supino y neutro alternando series')
    await lib.saveNote(null, '0025', 'Asiento 4')                               // the member answers
    lib.forgetExerciseNotes(); await lib.loadNotes('m1')
    expect(renderToStaticMarkup(<Note exerciseId="0025" memberId="m1" />)).toContain('Asiento 4')
    const posts = calls.filter(c => c.method === 'POST')
    expect(posts[0].body).not.toHaveProperty('memberId')                       // the member never names a target
    expect(posts[1].body.memberId).toBe('m1')
  })

  it('the card is wired in the member’s workout and in the staff routine editor', () => {
    const w = readFileSync(new URL('../views/Workout.jsx', import.meta.url), 'utf8')
    const b = readFileSync(new URL('../views/trainer/TrainerRoutineBuilder.jsx', import.meta.url), 'utf8')
    expect(w.match(/<SharedExerciseNote exerciseId=\{entry\.id\} \/>/g)?.length).toBe(2)
    expect(b).toContain('<SharedExerciseNote exerciseId={e.id} memberId={memberId} />')
    const canvas = readFileSync(new URL('./constructor/DayCanvas.jsx', import.meta.url), 'utf8')
    const cons = readFileSync(new URL('../views/trainer/Constructor.jsx', import.meta.url), 'utf8')
    expect(canvas).toContain('{sharedNotesFor && <SharedExerciseNote exerciseId={e.id} memberId={sharedNotesFor} />}')   // only where a member is named: never in the block / guided libraries
    expect(cons).toContain('sharedNotesFor={memberId}')
  })
})
