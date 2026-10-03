import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'

/* Social V2 + Seguimiento V2: the existing Community / follow-up screens in Experience V2. Presentation only — these tests pin
 * what must not regress: loading skeletons instead of blank text, the V2 scopes, the follow-up states built only from real dates,
 * gold reserved for records / achievements / milestones, and Health staying out of Social. */
vi.mock('../lib/api.js', () => ({
  api: vi.fn(() => Promise.reject(new Error('offline'))),
  IS_APPLE: false, IS_ANDROID: true, BIO: '', VAULT: '', webauthnOK: () => false,
  passkeyRegister: vi.fn(), passkeyLogin: vi.fn(), passkeyRecover: vi.fn(),
}))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn() }))
vi.mock('../lib/friends-api.js', () => ({ fetchFriends: vi.fn(() => new Promise(() => {})), fetchSocialProfile: vi.fn(() => new Promise(() => {})), acceptFriendRequest: vi.fn(), declineFriendRequest: vi.fn(), cancelFriendRequest: vi.fn(), removeFriend: vi.fn(), sendFriendRequest: vi.fn(), blockFriend: vi.fn(), unblockFriend: vi.fn(), fetchFriendCode: vi.fn(), resetFriendCode: vi.fn() }))
vi.mock('../lib/chat-api.js', () => ({ fetchThreads: vi.fn(() => new Promise(() => {})), fetchMessages: vi.fn(() => new Promise(() => {})), sendMessage: vi.fn(), setThreadStatus: vi.fn(), startDirectThread: vi.fn(), startThread: vi.fn() }))
vi.mock('../lib/social-api.js', () => ({ fetchSocialShares: vi.fn(() => new Promise(() => {})), deleteSocialShare: vi.fn(), fetchSharedItem: vi.fn(() => new Promise(() => {})) }))

const clone = x => JSON.parse(JSON.stringify(x))
let memory, store, views, mod, F
const day = (n = 0) => { const d = new Date('2026-09-09T12:00:00'); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }
const ahead = n => day(-n)

async function boot() {
  vi.resetModules()
  vi.stubGlobal('localStorage', {
    getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: k => memory.delete(k),
    get length() { return memory.size }, key: i => [...memory.keys()][i] ?? null,
  })
  vi.stubGlobal('navigator', {})
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn(), body: { classList: { toggle: vi.fn(), remove: vi.fn() } } })
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), matchMedia: () => ({ matches: false }), localStorage: globalThis.localStorage })
  ;({ useStore: store } = await import('../store/useStore.js'))
  const { useUI } = await import('../store/useUI.js')
  ;(await import('../components/ui.jsx')).bindUI(useUI)
  F = await import('../lib/features.js')
  mod = {
    FU: await import('../components/FollowUpCard.jsx'),
    view: await import('../lib/followup-view.js'),
    V2: await import('../components/v2.jsx'),
  }
  views = {
    Social: (await import('./Social.jsx')).default, Friends: (await import('./Friends.jsx')).default, Chat: (await import('./Chat.jsx')).default,
    Moments: (await import('./SocialMoments.jsx')).default, ChatThread: (await import('./ChatThread.jsx')).default,
  }
}
async function seed(over = {}, admin = null) {
  memory = new Map()
  await boot()
  const { DEF } = await import('../store/useStore.js')
  memory.set('gym_state_v1', JSON.stringify(Object.assign(clone(DEF), { body: 'male', onboarded: true, unit: 'kg' }, over)))
  memory.set('gym_user', JSON.stringify({ id: 'u1', name: 'Ana Socia', created: '2026-01-10T00:00:00Z' }))
  if (admin) memory.set('gym_features_v1', JSON.stringify(admin))
  await boot()
}
const render = async (View, path = '/') => { await boot(); return renderToStaticMarkup(<MemoryRouter initialEntries={[path]}><View /></MemoryRouter>) }

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-09T12:00:00')) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('Social V2 — existing screens, V2 scopes and loading states', () => {
  it('Community, Friends, Chat and Moments carry their V2 scope and show skeletons while loading (no bare "Loading…")', async () => {
    await seed({})
    const community = await render(views.Social)
    expect(community).toContain('narrow v2-social'); expect(community).toContain('v2-lskel'); expect(community).toContain('community-dashboard')
    expect(community).not.toContain('>Loading…<')
    expect(await render(views.Friends)).toMatch(/v2-friends[\s\S]*v2-lskel/)
    expect(await render(views.Chat)).toMatch(/v2-chat[\s\S]*v2-lskel/)
    expect(await render(views.Moments)).toContain('v2-lskel')
  })
  it('the gates keep ruling Social: friends / chat tiles follow the admin and member switches', async () => {
    await seed({})
    let html = await render(views.Social)
    expect(html).toContain('Friends'); expect(html).toContain('Messages')
    await seed({}, { friends: false, chat: false })
    html = await render(views.Social)
    expect(html).not.toContain('community-tile-main')
  })
  it('records are gold, challenges and everyday moments use the accent: gold appears only for records / achievements / milestones', () => {
    const css = readFileSync(new URL('../v2-social.css', import.meta.url), 'utf8')
    const rules = css.split('}').filter(r => /232,187,76/.test(r)).map(r => r.split('{')[0])
    const goldKinds = new Set(rules.flatMap(sel => [...sel.matchAll(/data-share-kind="(\w+)"/g)].map(m => m[1])))
    expect(goldKinds).toEqual(new Set(['record', 'achievement', 'streak']))
    const src = readFileSync(new URL('./SocialMoments.jsx', import.meta.url), 'utf8')
    expect(src).toMatch(/GOLD = new Set\(\['record', 'achievement', 'streak'\]\)/)
  })
  it('V2 social CSS respects reduced motion and the shared tokens', () => {
    const css = readFileSync(new URL('../v2-social.css', import.meta.url), 'utf8')
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
    expect(css).toMatch(/var\(--v2-card\)/)
  })
  it('Health stays private: no Social V2 screen reads Health data or the Health presentation modules', () => {
    for (const f of ['Social.jsx', 'Friends.jsx', 'Chat.jsx', 'ChatThread.jsx', 'SocialMoments.jsx', 'SocialProfile.jsx', '../components/CommunityShareCard.jsx']) {
      const src = readFileSync(new URL('./' + f, import.meta.url), 'utf8')
      expect(src, f).not.toMatch(/health-v2|health-bridge|HealthOverview|EnergyBadge|restingHR|dailyActivity|fitnessOf|workoutEnergy/)
    }
  })
})

describe('Seguimiento V2 — member card built only from the gym\'s real schedule', () => {
  const S = () => ({ unit: 'kg', bodyweight: [{ d: day(40), w: 82, t: 1 }, { d: day(2), w: 81.2, t: 2 }] })
  it('derives overdue / due / ok from dates only; nothing for members without follow-up', async () => {
    await boot()
    const v = mod.view.followUpView
    expect(v(null, S())).toBeNull(); expect(v({ active: false }, S())).toBeNull()
    expect(v({ active: true, template: 'basic', days: 30, nextReview: day(3) }, S(), '2026-09-09').state).toBe('overdue')
    expect(v({ active: true, template: 'basic', days: 30, nextReview: ahead(5) }, S(), '2026-09-09').state).toBe('due')
    expect(v({ active: true, template: 'basic', days: 30, nextReview: ahead(20) }, S(), '2026-09-09').state).toBe('ok')
    expect(v({ active: true, template: 'basic', days: 30, nextReview: null }, S(), '2026-09-09').state).toBe('ok')
  })
  it('weight since the last review only with a base on/before it and a later reading — never a made-up zero', async () => {
    await boot()
    const v = mod.view.followUpView
    const w = v({ active: true, template: 'basic', days: 30, lastReview: day(30), nextReview: ahead(1) }, S(), '2026-09-09').weight
    expect(w.delta).toBe(-0.8)
    expect(v({ active: true, template: 'basic', days: 30, lastReview: day(1), nextReview: ahead(1) }, S(), '2026-09-09').weight).toBeNull()   // no reading after it
    expect(v({ active: true, template: 'basic', days: 30, lastReview: day(60), nextReview: ahead(1) }, { bodyweight: [{ d: day(2), w: 81, t: 1 }] }, '2026-09-09').weight).toBeNull() // no base
  })
  it('card: full version shows when/last review/what is measured and the one action; compact (Home) only when near or overdue', async () => {
    await boot()
    const C = mod.FU.default, nav = () => {}
    const overdue = renderToStaticMarkup(<C fu={{ active: true, template: 'pro', days: 30, lastReview: day(35), nextReview: day(2) }} S={S()} nav={nav} />)
    for (const k of ['v2-fu overdue', 'Review overdue by 2 days', 'Last review', 'Add a measurement', 'Full bioimpedance']) expect(overdue).toContain(k)
    const ok = { active: true, template: 'basic', days: 30, lastReview: day(5), nextReview: ahead(25) }
    expect(renderToStaticMarkup(<C fu={ok} S={S()} nav={nav} />)).toContain('Next review')
    expect(renderToStaticMarkup(<C fu={ok} S={S()} nav={nav} compact />)).toBe('')
    const soon = renderToStaticMarkup(<C fu={{ ...ok, nextReview: ahead(3) }} S={S()} nav={nav} compact />)
    expect(soon).toContain('v2-fu due'); expect(soon).toContain('in 3 days')
    expect(renderToStaticMarkup(<C fu={{ active: false }} S={S()} nav={nav} />)).toBe('')
    expect(renderToStaticMarkup(<C fu={undefined} S={S()} nav={nav} />)).toBe('')
  })
  it('private: the member card is marked private and shows no score, percentage or verdict', async () => {
    await boot()
    const html = renderToStaticMarkup(<mod.FU.default fu={{ active: true, template: 'basic', days: 30, lastReview: day(35), nextReview: day(2) }} S={S()} nav={() => {}} />)
    expect(html).toContain('data-private="true"'); expect(html).not.toMatch(/%|score|risk|readiness/i)
  })
  it('Home never breaks without the API: offline, no follow-up card and the hero is intact', async () => {
    await seed({ routines: [{ id: 'r1', name: 'Push', emoji: '💪', prog: 'off', ex: [] }], week: { 3: 'r1' } })
    const { default: Home } = await import('./Home.jsx')
    const html = renderToStaticMarkup(<MemoryRouter><Home /></MemoryRouter>)
    expect(html).toContain('v2-hero'); expect(html).not.toContain('v2-fu')
  })
  it('the staff card keeps its exports and uses the V2 surface', () => {
    const src = readFileSync(new URL('./AdminFollowUp.jsx', import.meta.url), 'utf8')
    expect(src).toMatch(/export function alertText/); expect(src).toContain('v2-fu v2-fu-staff'); expect(src).toContain('v2-fu-alerts')
    expect(src).not.toMatch(/risk|readiness/i)
  })
})
