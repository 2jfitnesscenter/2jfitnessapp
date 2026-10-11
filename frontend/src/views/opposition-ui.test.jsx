import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import seed from '../../../api/lib/opposition-official.json'

/* Entrena tus Oposiciones, member + staff screens: what each state shows. Presentation over the plan state (the rules are tested in lib/opposition*.test.js). */
vi.mock('../lib/api.js', () => ({
  api: vi.fn(() => Promise.reject(new Error('offline'))),
  IS_APPLE: false, IS_ANDROID: false, BIO: '', VAULT: '', webauthnOK: () => false,
  passkeyRegister: vi.fn(), passkeyLogin: vi.fn(), passkeyRecover: vi.fn(), passkeyDeleteAccount: vi.fn(),
}))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn() }))

const clone = x => JSON.parse(JSON.stringify(x))
const NOW = new Date('2026-10-11T12:00:00Z')
const WEEK = 7 * 86400000
/** renderToStaticMarkup reads the stores' initial state (the server snapshot): what a test sets is made the initial state too. */
const put = (store, state) => { Object.assign(store.getInitialState(), state); store.setState(state); return store }
const profile = slug => clone(seed.profiles.find(p => p.slug === slug))
let memory

async function boot() {
  vi.resetModules()
  vi.stubGlobal('localStorage', { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: k => memory.delete(k), get length() { return memory.size }, key: i => [...memory.keys()][i] ?? null })
  vi.stubGlobal('navigator', {})
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn(), body: { classList: { toggle: vi.fn(), remove: vi.fn() } } })
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), matchMedia: () => ({ matches: false }), localStorage: globalThis.localStorage, open: vi.fn() })
  const { useUI } = await import('../store/useUI.js')
  ;(await import('../components/ui.jsx')).bindUI(useUI)
}
async function seedState({ plan = false, over = {}, published = true } = {}) {
  memory = new Map(); await boot()
  const { DEF } = await import('../store/useStore.js')
  const op = await import('../lib/opposition.js')
  let S = Object.assign(clone(DEF), { body: 'male', onboarded: true, uxInviteDismissed: true, workouts: [] }, over)
  if (plan) {
    const r = op.startPlan(S, { profile: profile('bomberos-cegc'), intake: { sex: 'm', age: 29, days: 4, minutes: 60, organism: 'CEGC', convocatoria: '37 plazas' }, marks: { 'natacion-50': 58, dominadas: 5, 'press-banca': 11, 'velocidad-200': 41, 'resistencia-1500': 440 }, examDate: '2027-04-11', months: 6, now: NOW.getTime() })
    S = { ...S, opposition: r.opposition, premium: r.premium }
  }
  memory.set('gym_state_v1', JSON.stringify(S))
  memory.set('gym_user', JSON.stringify({ id: 'u1', name: 'Ana Socia', username: 'ana' }))
  await boot()
  const { useOpposition } = await import('../lib/opposition-api.js')
  const { usePremium } = await import('../lib/premium-api.js')
  const profiles = seed.profiles.map(p => ({ ...p, status: published ? 'published' : 'hidden', tests: p.tests.map(({ marks, ...t }) => t) }))
  put(useOpposition, { status: 'ready', enabled: true, profiles, uid: 'u1' })
  put(usePremium, { status: 'ready', enabled: true, uid: 'u1', programs: published ? [{ id: 'premium-entrena-tus-oposiciones', slug: 'entrena-tus-oposiciones', status: 'published', methodType: 'opposition' }] : [] })
  return S
}
const render = async (name, props = {}) => {
  const mod = await import('./Opposition.jsx')
  const View = mod[name]
  return renderToStaticMarkup(<MemoryRouter><View {...props} /></MemoryRouter>)
}
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('without a plan', () => {
  it('lists the published exams with their official source and date; nothing about a plan that does not exist', async () => {
    await seedState()
    const html = await render('OppositionHub')
    expect(html).toContain('Train for your public-service exam'); expect(html).toContain('Choose your exam')
    for (const p of seed.profiles) { expect(html).toContain(p.name.replace('&', '&amp;')); expect(html).toContain(p.source.reference) }
    expect(html).not.toContain('This week')
  })
  it('while the Premium entry is hidden (or nothing is published) the member sees "not available", never an empty or broken page', async () => {
    await seedState({ published: false })
    const html = await render('OppositionHub')
    expect(html).toContain('Not available yet'); expect(html).not.toContain('Choose your exam')
  })
})

describe('with a running plan', () => {
  it('shows the exam, time left, phases, level per capacity, marks against the official minimum and the source with its date and version', async () => {
    await seedState({ plan: true })
    const html = await render('OppositionHub')
    expect(html).toContain('Bombero/a · Consorcio de Emergencias de Gran Canaria')
    expect(html).toContain('This week'); expect(html).toContain('What we are training'); expect(html).toContain('Fuerza inferior'); expect(html).toContain('weeks left'); expect(html).toContain('Plan phases')
    for (const l of ['Endurance', 'Speed', 'Pulling strength', 'Pushing strength', 'Swimming']) expect(html).toContain(l)
    expect(html).toContain('Tests and marks'); expect(html).toContain('Dominadas'); expect(html).toContain('Press de banca (40 kg)')
    expect(html).toContain('Official source'); expect(html).toContain('BOP Las Palmas nº 153'); expect(html).toContain('version 1')
    expect(html).toContain('Start: '); expect(html).not.toContain('Record my control marks')
    expect(html).not.toContain('Proposal for the next block')
  })
  it('marks missing are shown as "No mark yet", never as a number', async () => {
    memory = new Map(); await boot()
    const { DEF } = await import('../store/useStore.js')
    const op = await import('../lib/opposition.js')
    const S0 = Object.assign(clone(DEF), { onboarded: true, uxInviteDismissed: true, workouts: [] })
    const r = op.startPlan(S0, { profile: profile('policia-nacional'), intake: { sex: 'f', age: 30, days: 3, minutes: 45 }, marks: {}, months: 12, now: NOW.getTime() })
    memory.set('gym_state_v1', JSON.stringify({ ...S0, opposition: r.opposition, premium: r.premium }))
    await boot()
    const { useOpposition } = await import('../lib/opposition-api.js'); put(useOpposition, { status: 'ready', enabled: true, profiles: [], uid: 'u1' })
    const html = await render('OppositionHub')
    expect(html).toContain('No mark yet'); expect(html).toContain('estimated'); expect(html).toContain('Suspensión en barra (mujeres)'); expect(html).not.toContain('Dominadas (hombres)')
  })
  it('offers the control after the block, and a proposal that changes nothing until it is confirmed', async () => {
    const S = await seedState({ plan: true })
    const op = await import('../lib/opposition.js')
    const pm = await import('../lib/premium-model.js')
    const prem = await import('../lib/premium.js')
    let state = JSON.parse(memory.get('gym_state_v1'))
    let inst = prem.premiumState(state).active
    const workouts = []
    for (let i = 0; i < 40; i++) { const pos = pm.positionOf(inst, workouts); if (!pos.session) break; workouts.push({ id: 'w' + i, d: '2026-10-12', entries: [], premium: pm.originOf(inst, pm.planSession(inst, workouts)) }) }
    state = { ...state, workouts }
    memory.set('gym_state_v1', JSON.stringify(state)); await boot()
    const { useOpposition } = await import('../lib/opposition-api.js'); put(useOpposition, { status: 'ready', enabled: true, profiles: [], uid: 'u1' })
    let html = await render('OppositionHub')
    expect(html).toContain('Control week'); expect(html).toContain('Record my control marks')
    const ev = op.submitEvaluation(state, { 'natacion-50': 53, dominadas: 6, 'press-banca': 16, 'velocidad-200': 38, 'resistencia-1500': 410 }, { now: NOW.getTime() + 5 * WEEK })
    memory.set('gym_state_v1', JSON.stringify({ ...state, opposition: ev.opposition })); await boot()
    const { useOpposition: u2 } = await import('../lib/opposition-api.js'); put(u2, { status: 'ready', enabled: true, profiles: [], uid: 'u1' })
    html = await render('OppositionHub')
    expect(html).toContain('Proposal for the next block'); expect(html).toContain('Nothing changes until you confirm'); expect(html).toContain('Start the next block'); expect(html).toContain('More volume (+10%)')
    expect(html).toContain('Above target')
    expect(S.opposition).toBeTruthy()
  })
  it('a newer version of the convocatoria is only offered, not applied', async () => {
    await seedState({ plan: true })
    const { useOpposition } = await import('../lib/opposition-api.js')
    const newer = { ...seed.profiles.find(p => p.slug === 'bomberos-cegc'), version: 2, status: 'published', tests: [] }
    put(useOpposition, { status: 'ready', enabled: true, profiles: [newer], uid: 'u1' })
    const html = await render('OppositionHub')
    expect(html).toContain('There is a new version of this convocatoria'); expect(html).toContain('keeps using version 1'); expect(html).toContain('Review changes')
  })
})

describe('the intake', () => {
  it('starts with the exam: organism, convocatoria, official source and date, the real tests, the warning about changing bases — and asks what the profile says to ask', async () => {
    await seedState()
    const { OppositionWizard } = await import('./Opposition.jsx')
    const p = profile('bomberos-cegc')
    const html = renderToStaticMarkup(<MemoryRouter><OppositionWizard summary={p} initialProfile={p} close={() => {}} /></MemoryRouter>)
    expect(html).toContain('Step 1 of 6'); expect(html).toContain('Consorcio de Emergencias de Gran Canaria'); expect(html).toContain('BOP Las Palmas nº 153'); expect(html).toContain('version 1')
    for (const x of p.tests) expect(html).toContain(x.name.replace('&', '&amp;'))
    expect(html).toContain('Each convocatoria can change the tests or the marks')
    expect(html).toContain('Which organism is your exam for?'); expect(html).toContain('Which convocatoria or year?'); expect(html).toContain('Version of the tests')
    expect(html).toContain('disabled=""')   // Continue stays disabled until the organism and the convocatoria are filled in
    const pn = profile('policia-nacional')
    const html2 = renderToStaticMarkup(<MemoryRouter><OppositionWizard summary={pn} initialProfile={pn} close={() => {}} /></MemoryRouter>)
    expect(html2).not.toContain('Which organism is your exam for?'); expect(html2).not.toContain('disabled=""')
  })
})

describe('staff screens', () => {
  it('Administration → Oposiciones lists every profile with status, version, source and the actions; members get a refusal', async () => {
    await seedState({ published: false })
    const { useOpposition } = await import('../lib/opposition-api.js')
    put(useOpposition, { status: 'ready', enabled: true, canEdit: true, uid: 'u1', profiles: seed.profiles.map(p => ({ ...p, tests: p.tests.map(({ marks, ...t }) => t), usage: { started: 0 } })) })
    const { useStore } = await import('../store/useStore.js')
    put(useStore, { user: { id: 'u1', name: 'Admin', admin: true } })
    const { OppositionManage } = await import('./OppositionManage.jsx')
    const html = renderToStaticMarkup(<MemoryRouter><OppositionManage /></MemoryRouter>)
    expect(html).toContain('Official profiles'); for (const p of seed.profiles) expect(html).toContain(p.source.reference)
    expect(html).toContain('Publish'); expect(html).toContain('Versions'); expect(html).toContain('Hidden')
    put(useStore, { user: { id: 'u1', name: 'Ana' } })
    expect(renderToStaticMarkup(<MemoryRouter><OppositionManage /></MemoryRouter>)).toContain('Only administrators manage the profiles')
  })
  it('the Coach sheet shows version, source date, time left, phase, level per capacity, marks against minimum and target, and the review alert', async () => {
    const S = await seedState({ plan: true })
    const model = await import('../lib/opposition-model.js')
    const { OppositionRun } = await import('../components/coach/CoachMember.jsx')
    const state = JSON.parse(memory.get('gym_state_v1'))
    const summary = model.summarizePlan({ ...state.opposition.plan, alerts: ['review'] }, { adherence: 80, now: NOW.getTime() })
    const html = renderToStaticMarkup(<OppositionRun o={summary} />)
    expect(html).toContain('version 1'); expect(html).toContain('Consorcio de Emergencias de Gran Canaria'); expect(html).toContain('weeks left'); expect(html).toContain('Base')
    expect(html).toContain('Dominadas'); expect(html).toContain('min'); expect(html).toContain('target'); expect(html).toContain('80%'); expect(html).toContain('needs a person to look at it')
    expect(S).toBeTruthy()
  })
})
