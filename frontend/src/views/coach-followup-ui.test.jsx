import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'

/* Coach & Seguimiento PRO V3 — what the staff sees: the board (who needs attention, why), the member sheet (order, collapsed sections, three kinds of statement,
   privacy lines), the words, and the rules the screens must keep (no auto-apply, no alarmism, tokens only). The decisions are computed on the server and covered
   in api/test/coach-followup*.test.js. */
vi.mock('../lib/api.js', () => ({
  api: vi.fn(() => Promise.reject(new Error('offline'))),
  IS_APPLE: false, IS_ANDROID: false, BIO: '', VAULT: '', webauthnOK: () => false,
  passkeyRegister: vi.fn(), passkeyLogin: vi.fn(), passkeyRecover: vi.fn(), passkeyDeleteAccount: vi.fn(),
}))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn() }))

let memory
async function boot(lang) {
  vi.resetModules()
  memory = new Map([['gym_user', JSON.stringify({ id: 'ad', name: 'Staff', admin: true, trainer: true })]])
  vi.stubGlobal('localStorage', { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: k => memory.delete(k), get length() { return memory.size }, key: i => [...memory.keys()][i] ?? null })
  vi.stubGlobal('navigator', {})
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn(), body: { classList: { toggle: vi.fn(), remove: vi.fn() } }, documentElement: { lang: lang || 'en' } })
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), matchMedia: () => ({ matches: false }), localStorage: globalThis.localStorage, open: vi.fn() })
  const { useUI } = await import('../store/useUI.js')
  ;(await import('../components/ui.jsx')).bindUI(useUI)
  const { setLang } = await import('../lib/i18n.js')
  if (lang) await setLang(lang)
}
afterEach(() => vi.unstubAllGlobals())

const row = (over = {}) => ({
  id: 'u1', name: 'ana lopez', avatar: null, level: 'priority', goal: { key: 'fatloss', label: null, priority: 'normal', source: 'member' },
  signals: [{ id: 'absence', severity: 'priority', explanation: 'No workouts in the last {0} days.', args: [18] }, { id: 'adherence_low', severity: 'review', explanation: 'x', args: [] }], signalCount: 2,
  adherence: { pct28: 35, done28: 4, planned28: 12, pct7: 0, done7: 0, planned7: 3, trend: 'down' }, lastWorkout: '2026-10-02', daysSince: 18, nextReview: '2026-10-12', reviewIn: -8, flagged: false, followUpActive: true, ...over,
})
const board = (over = {}) => ({ today: '2026-10-20', scope: 'all', assigned: 3, counts: { attention: 1, upcoming: 1, stable: 1 }, attention: [row()], upcoming: [row({ id: 'u2', name: 'pedro', level: 'normal', signals: [], signalCount: 0, reviewIn: 3, nextReview: '2026-10-23' })], stable: [row({ id: 'u3', name: 'marta', level: 'normal', signals: [], signalCount: 0, nextReview: null, reviewIn: null, lastWorkout: '2026-10-19', daysSince: 1 })], ...over })
const html = async (el) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>)

describe('board', () => {
  it('shows three counters and cards with one reason, three figures and one action; no alarmist wording', async () => {
    await boot()
    const { BoardBody, defaultTab } = await import('../components/coach/CoachBoard.jsx')
    const d = board()
    expect(defaultTab(d)).toBe('attention')
    const h = await html(<BoardBody d={d} shown="attention" />)
    for (const k of ['Need attention', 'Upcoming reviews', 'Stable follow-up', 'ana lopez', 'Lose fat', 'Priority', 'No workouts in the last 18 days.', '+1 more', 'Adherence', '35%', '4 of 12 sessions', '18 days ago', 'Next review', 'View follow-up']) expect(h).toContain(k)
    expect(h).toContain('cf-card priority')
    expect(h).toMatch(/role="tablist"/); expect((h.match(/role="tab"/g) || []).length).toBe(3)
    expect(h).not.toMatch(/GRAVE|URGENT|alarm|diagnos|overtrain|sobreentren/i)
    expect(h).not.toContain('type="search"')                                    // a search box only when the list is long
  })
  it('a calm member shows "nothing to review"; the upcoming tab lists the review date; stable never shows a reason', async () => {
    await boot()
    const { BoardBody } = await import('../components/coach/CoachBoard.jsx')
    const up = await html(<BoardBody d={board()} shown="upcoming" />)
    expect(up).toContain('pedro'); expect(up).toContain('Nothing to review right now.'); expect(up).toContain('cf-card normal'); expect(up).not.toContain('ana lopez')
    const st = await html(<BoardBody d={board()} shown="stable" />)
    expect(st).toContain('marta'); expect(st).toContain('Yesterday')
  })
  it('search appears with more than 8 members and filters by name; empty states tell a trainer what to do', async () => {
    await boot()
    const { BoardBody } = await import('../components/coach/CoachBoard.jsx')
    const many = board({ counts: { attention: 0, upcoming: 0, stable: 9 }, attention: [], upcoming: [], stable: Array.from({ length: 9 }, (_, i) => row({ id: 's' + i, name: i === 4 ? 'zoe' : 'otro' + i, level: 'normal', signals: [], signalCount: 0 })) })
    const h = await html(<BoardBody d={many} shown="stable" q="zoe" />)
    expect(h).toContain('type="search"'); expect(h).toContain('zoe'); expect(h).not.toContain('otro1')
    const none = await html(<BoardBody d={board({ scope: 'assigned', assigned: 0, counts: { attention: 0, upcoming: 0, stable: 0 }, attention: [], upcoming: [], stable: [] })} shown="stable" />)
    expect(none).toContain('No members assigned yet'); expect(none).toContain('An administrator can assign members to you from their profile.')
    const quiet = await html(<BoardBody d={board({ counts: { attention: 0, upcoming: 0, stable: 1 }, attention: [] })} shown="attention" />)
    expect(quiet).toContain('Nobody needs attention')
  })
  it('in Spanish the same board reads naturally', async () => {
    await boot('es')
    const { BoardBody } = await import('../components/coach/CoachBoard.jsx')
    const h = await html(<BoardBody d={board()} shown="attention" />)
    for (const k of ['Necesitan atención', 'Revisiones próximas', 'Seguimiento estable', 'Prioritario', 'Adherencia', 'Última sesión', 'Próxima revisión', 'Ver seguimiento', 'hace 18 días', '4 de 12 sesiones']) expect(h).toContain(k)
  })
})

const view = (over = {}) => ({
  today: '2026-10-20', level: 'priority',
  signals: [{ id: 'absence', severity: 'priority', source: 'workouts', evidence: { daysSince: 18 }, explanation: 'No workouts in the last {0} days.', args: [18], suggestedAction: 'Get in touch and ask what is getting in the way.' },
    { id: 'checkin_discomfort', severity: 'priority', source: 'checkin', evidence: { zone: 'knee', count: 3 }, explanation: 'Discomfort in {0} reported {1} times in the last 14 days.', args: ['knee', 3], suggestedAction: 'Ask about it and consider adapting the exercises involved.' }],
  goal: { key: 'fatloss', raw: 'fatloss', label: 'Evento en diciembre', targetDate: '2026-12-05', priority: 'high', source: 'staff', lens: 'body' },
  adherence: { plannedPerWeek: 3, otherPerWeek: 0, d7: { days: 7, planned: 3, full: 0, partial: 0, cardio: 0, moved: 0, excluded: 0, pct: 0 }, d28: { days: 28, planned: 12, full: 3, partial: 1, cardio: 2, moved: 1, excluded: 1, pct: 30 }, trend: 'down', weekly: [3, 3, 2, 3, 2, 1, 1, 0], perWeek: { last: 0.5, before: 2 }, lastWorkout: '2026-10-02', daysSince: 18, historyDays: 120 },
  progress: { prs28: 0, prsPrev28: 2, progression: { status: 'stable', improved: 0, evaluated: 3 }, plateau: { clear: true, stalled: 2, evaluable: 3 }, sessions28: 4, cardio28: 2, body: { n: 3, from: '2026-09-01', to: '2026-10-18', first: 82, last: 82.6, delta: 0.6, span: 47 }, targetWeight: 78 },
  review: { next: '2026-10-12', reviewIn: -8, cycles: [], measurement: { next: '2026-10-25', last: '2026-09-25' } },
  fatigue: { level: 'elevated', points: 3, signals: ['effort_up'] },
  checkin: { shared: true, count: 3, avg: { energy: 2, sleep: 2.3, fatigue: 4.7 }, highFatigue14: 3, pain14: [{ zone: 'knee', n: 3 }] },
  hasPlan: true, created: '2026-06-22', joinedDays: 120,
  analysis: { facts: [{ id: 'f_adherence', text: 'Completed {0} of {1} planned sessions in the last 28 days.', args: [4, 12] }], inference: [{ id: 'i_absence', text: 'No workouts in the last {0} days.', args: [18] }], suggestion: [{ id: 's_absence', text: 'Get in touch and ask what is getting in the way.', args: [] }], goal: 'fatloss' },
  ...over,
})
const cycle = { kind: 'program', programId: 'p1', routineIds: ['r1'], name: 'Programa A', start: '2026-09-01', startManual: false, dueDate: '2026-10-12', nextReviewAt: '2026-10-12', dueManual: false, lastReviewAt: null, reviewed: false, adherence: { completed: 4, total: 12, percent: 33 }, progression: { status: 'stable' }, plateau: { clear: true, stalled: ['a', 'b'], evaluable: 3, reasons: [{ code: 'stalled', n: 2, of: 3 }] }, reasons: [{ code: 'week', week: 8 }, { code: 'stalled', n: 2, of: 3 }], status: 'overdue', week: 8, sessions: 6, early: false, late: false }
const sheet = (over = {}) => ({
  member: { id: 'u1', name: 'ana lopez', avatar: null, created: '2026-06-22T10:00:00.000Z', disabled: false, synced: true }, view: view(),
  followUp: { template: 'basic', cadence: 'monthly', days: 30, startedAt: '2026-09-01', reviews: [], keys: ['waist'], goalPlan: { primary: 'fatloss' } }, routineCycles: [cycle],
  privateAvailable: true, legacyNote: 'Nota general antigua', notes: [{ id: 'n1', at: '2026-10-01T10:00:00.000Z', by: 'Marta', mine: true, text: 'Habló de horarios', ref: { kind: 'program', id: 'p1' } }],
  timeline: [{ d: '2026-10-14', at: '2026-10-14T09:00:00.000Z', kind: 'recommendation_rejected', text: 'No hay tiempo', by: 'Marta', ref: null }, { d: '2026-10-10', kind: 'review_done', ref: { kind: 'program', id: 'p1', name: 'Programa A' }, by: 'Juan' }],
  sync: { revision: 3, generation: 1 }, trainers: { assigned: ['tr1'], options: [{ id: 'tr1', name: 'Marta' }, { id: 'tr2', name: 'Pablo' }] }, ai: { available: false }, ...over,
})

describe('member sheet', () => {
  it('keeps the order: summary · now · progress · adherence · review · analysis · check-in · history · notes, with only the useful ones open', async () => {
    await boot()
    const { MemberView } = await import('../components/coach/CoachMember.jsx')
    const h = await html(<MemberView d={sheet()} id="u1" back="/admin/attention" />)
    const order = ['Summary', 'Now', 'Progress', 'Adherence', 'Review cycle', '2J analysis', 'Check-in', 'Professional history', 'Notes'].map(k => h.indexOf(k === 'Summary' ? 'aria-label="Summary"' : '<span class="tt">' + k))
    expect(order.every(i => i >= 0)).toBe(true); expect([...order].sort((a, b) => a - b)).toEqual(order)
    const open = [...h.matchAll(/<details class="cf-acc"( id="[^"]*")? open=""/g)].length
    expect(open).toBe(3)                                                         // Now, Review (a review is overdue) and the analysis; the rest stays collapsed
    expect(h).toContain('role="progressbar"')
    expect(h).toContain('class="v2-spark"')                                       // the 8-week micro-graphic
  })
  it('the summary shows level, goal in the staff’s words, the reasons with their suggested action, and the staff actions', async () => {
    await boot()
    const { MemberView } = await import('../components/coach/CoachMember.jsx')
    const h = await html(<MemberView d={sheet()} id="u1" back="/admin/attention" />)
    for (const k of ['Evento en diciembre', 'High priority', 'Priority', 'No workouts in the last 18 days.', 'Get in touch and ask what is getting in the way.', 'Discomfort in knee reported 3 times in the last 14 days.',
      'Open plan', 'Edit goal', 'Mark for follow-up', 'Trainers: Marta', 'Manage']) expect(h).toContain(k)
    expect(h).not.toContain('Start follow-up')
    const none = await html(<MemberView d={sheet({ followUp: null })} id="u1" back="/x" />)
    expect(none).toContain('Start follow-up'); expect(none).toContain('Start the follow-up to keep a goal, notes and decisions for this member.'); expect(none).not.toContain('Edit goal')
  })
  it('adherence separates what was planned, partial, cardio, moved and excluded; body weight is context, never performance', async () => {
    await boot()
    const { MemberView } = await import('../components/coach/CoachMember.jsx')
    const h = await html(<MemberView d={sheet()} id="u1" back="/x" />)
    for (const k of ['30%', '4 of 12 planned sessions', 'Partial: 1', 'Cardio, counted apart: 2', 'Moved: 1', 'Excluded from progression: 1', 'Adherence is falling', 'rounded to 5',
      'Context', 'Body weight', 'not a measure of performance', 'Plateau signals to review', '0 records in 28 days']) expect(h).toContain(k)
  })
  it('the analysis keeps fact · inference · suggestion apart, and offers the AI only when it is connected; the review brief appears when a review is due', async () => {
    await boot()
    const { MemberView } = await import('../components/coach/CoachMember.jsx')
    const off = await html(<MemberView d={sheet()} id="u1" back="/x" />)
    for (const k of ['>Fact<', '>Inference<', '>Suggestion<', 'Completed 4 of 12 planned sessions in the last 28 days.', 'The professional AI is not connected.', 'Review brief', 'What to look at', 'Open program']) expect(off).toContain(k)
    expect(off).not.toContain('Analyze follow-up')
    const on = await html(<MemberView d={sheet({ ai: { available: true } })} id="u1" back="/x" />)
    expect(on).toContain('Analyze follow-up'); expect(on).not.toContain('is not connected')
    expect(on).toContain('Accept'); expect(on).toContain('Dismiss')               // each suggestion can be accepted or dismissed (logged as a decision)
    const calm = await html(<MemberView d={sheet({ routineCycles: [{ ...cycle, reviewed: true, status: 'ok' }] })} id="u1" back="/x" />)
    expect(calm).not.toContain('Review brief')
  })
  it('check-ins, the professional history and the notes carry their privacy lines', async () => {
    await boot()
    const { MemberView } = await import('../components/coach/CoachMember.jsx')
    const h = await html(<MemberView d={sheet()} id="u1" back="/x" />)
    for (const k of ['Fatigue', '4,7/5', 'Knee · 3', 'Recommendation dismissed', 'No hay tiempo', 'Review completed', 'Programa A', 'Only staff with access see these notes', 'never shared with the member, the AI, Community or exports',
      'Habló de horarios', 'General note', 'Nota general antigua', 'Add note']) expect(h).toContain(k)
    const priv = await html(<MemberView d={sheet({ view: view({ checkin: { shared: false } }) })} id="u1" back="/x" />)
    expect(priv).toContain('The member does not share check-ins.')
    expect(priv).not.toContain('4,7/5')
    const cold = await html(<MemberView d={sheet({ followUp: null, notes: [], legacyNote: '', timeline: [] })} id="u1" back="/x" />)
    expect(cold).toContain('Start the follow-up to keep notes.'); expect(cold).toContain('Decisions and reviews will appear here.')
  })
  it('a trainer (not admin) does not see the access manager; a disabled account says so', async () => {
    await boot()
    memory.set('gym_user', JSON.stringify({ id: 'tr1', name: 'Marta', trainer: true }))
    vi.resetModules()
    const { MemberView } = await import('../components/coach/CoachMember.jsx')
    const h = await html(<MemberView d={sheet({ trainers: null, member: { ...sheet().member, disabled: true } })} id="u1" back="/x" />)
    expect(h).not.toContain('Manage'); expect(h).toContain('Account disabled')
  })
  it('in Spanish the sheet and every server sentence are translated', async () => {
    await boot('es')
    const { MemberView } = await import('../components/coach/CoachMember.jsx')
    const h = await html(<MemberView d={sheet({ ai: { available: true } })} id="u1" back="/x" />)
    for (const k of ['Resumen', 'Ahora', 'Evolución', 'Adherencia', 'Ciclo de revisión', 'Análisis 2J', 'Historial profesional', 'Notas', 'Hecho', 'Inferencia', 'Sugerencia', 'Analizar seguimiento',
      'Sin entrenamientos en los últimos 18 días.', 'Ha indicado molestias en rodilla 3 veces en los últimos 14 días.', 'Abrir plan', 'Editar objetivo', 'Peso corporal', 'no mide el rendimiento',
      'Solo el personal con acceso ve estas notas']) expect(h.toLowerCase()).toContain(k.toLowerCase())
    expect(h).not.toContain('No workouts in the last')
  })
})

describe('rules the screens keep', () => {
  const read = f => readFileSync(new URL(f, import.meta.url), 'utf8')
  it('every sentence the server can produce is in the Spanish catalogue', async () => {
    const es = (await import('../locales/es.js')).default
    const { SIGNAL_TEXT, INFERENCE_TEXT, ANALYSIS_TEXT } = await import('../../../api/lib/coach-followup.js')
    for (const [id, pair] of Object.entries(SIGNAL_TEXT)) for (const s of pair) expect(es[s], id + ': ' + s).toBeTruthy()
    for (const [id, s] of [...Object.entries(INFERENCE_TEXT), ...Object.entries(ANALYSIS_TEXT)]) expect(es[s], id + ': ' + s).toBeTruthy()
    expect(Object.keys(INFERENCE_TEXT).sort()).toEqual(Object.keys(SIGNAL_TEXT).sort())      // every signal has its hedged reading
    const { EVENT_TEXT, TREND_TEXT, PROGRESSION_TEXT, LEVEL, TAG } = await import('../lib/coach-followup.js')
    for (const s of [...Object.values(EVENT_TEXT), ...Object.values(TREND_TEXT), ...Object.values(PROGRESSION_TEXT), ...Object.values(TAG), ...Object.values(LEVEL).map(l => l.word)]) expect(es[s], s).toBeTruthy()
  })
  it('nothing on the sheet applies a change: the AI proposals only open screens or record a decision', () => {
    const src = read('../components/coach/CoachMember.jsx')
    expect(src).not.toMatch(/saveMemberRoutine|saveMemberProgram|assign-routine|assign-program|apply-starter|applyDeload|S\.deload/)
    expect(src).toContain("nav('/trainer/' + id + '/ai')")                      // "Create proposal" opens the existing trainer AI screen: the trainer reviews and saves
    expect(src).not.toMatch(/Aplicar cambios|Apply changes/)
  })
  it('the styles use theme tokens only (light and dark follow the app) and adapt at phone, tablet and desktop widths', () => {
    const css = read('../components/coach/coach-followup.css').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(css).not.toMatch(/\bred\b|var\(--red\)/)                              // attention is a reading, not an alarm
    for (const bp of ['max-width: 420px', 'min-width: 720px', 'min-width: 1180px']) expect(css).toContain(bp)
    expect(css).toContain('prefers-reduced-motion')
  })
  it('routes: admin board and sheet behind the admin gate; the trainer panel has its own entry', () => {
    const app = read('../App.jsx')
    expect(app).toMatch(/path="\/admin\/attention\/:id" element=\{user\?\.admin \? <AdminAttentionMember \/> : <Navigate to="\/home" replace \/>\}/)
    expect(app).toContain('path="/trainer/seguimiento" element={<TrainerFollowBoard />}'); expect(app).toContain('path="/trainer/seguimiento/:id" element={<TrainerFollowMember />}')
    expect(read('./trainer/TrainerClients.jsx')).toContain('#/trainer/seguimiento')
    expect(read('./AdminAttention.jsx')).toContain('if (!user?.admin) return null')
  })
})
