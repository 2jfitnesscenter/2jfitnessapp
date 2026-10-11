import { describe, expect, it } from 'vitest'
import { HOME_BLOCKS, HOME_IDS, HOME_DEFAULT_HIDDEN, normalizeHome, homeOrder, visibleHomeBlocks, availableHomeBlocks, homeChoice, defaultHomeLayout, homeLayoutOf, isHomeOptional } from './home-blocks.js'
import { PROGRESS_IDS, normalizeProgress, visibleProgressCards, progressOrder } from './progress-cards.js'
import { makeUx, currentUses } from './features.js'
import { setLayout, restoreLayout, guideSeen, markGuideSeen, resetGuide } from './ux-layout.js'

const withHome = home => ({ ux: { ...makeUx(currentUses({ ux: null }), 1), ...(home ? { home } : {}) } })
const draft = (S = {}) => JSON.parse(JSON.stringify(S))

describe('the default Home (clean)', () => {
  it('calendar first, Premium second (right after the greeting), then the rest in a logical order', () => {
    expect(HOME_IDS.slice(0, 2)).toEqual(['week', 'premium'])
    expect(HOME_IDS).toEqual(['week', 'premium', 'reorder', 'review', 'followup', 'news', 'readiness', 'coach', 'train2j', 'intelligence'])
  })
  it('only the essentials are shown: the promo and the daily suggestions are one tap away', () => {
    expect(HOME_DEFAULT_HIDDEN).toEqual(['train2j', 'intelligence'])
    for (const S of [{}, { ux: null }, { ux: makeUx(currentUses({ ux: null })) }]) {
      expect(visibleHomeBlocks(S)).toEqual(HOME_IDS.filter(id => !HOME_DEFAULT_HIDDEN.includes(id)))
      expect(availableHomeBlocks(S)).toEqual(['train2j', 'intelligence'])
    }
  })
  it('Premium is visible by default and can be hidden and added back without touching a running program', () => {
    expect(visibleHomeBlocks({})).toContain('premium')
    const S = draft(); setLayout(S, 'home', { order: HOME_IDS, hidden: [...HOME_DEFAULT_HIDDEN, 'premium'] })
    expect(visibleHomeBlocks(S)).not.toContain('premium'); expect(availableHomeBlocks(S)).toContain('premium')
    S.premium = { v: 1, active: { id: 'x' }, history: [] }                      // the layout never reads or changes the program
    setLayout(S, 'home', { order: HOME_IDS, hidden: HOME_DEFAULT_HIDDEN })
    expect(visibleHomeBlocks(S)).toContain('premium'); expect(S.premium.active.id).toBe('x')
  })
})

describe('Home layout (S.ux.home)', () => {
  it('reorders: the member\'s sequence wins, unlisted blocks keep their default place', () => {
    const S = withHome(homeChoice(['coach', 'premium', ...HOME_IDS.filter(i => !['coach', 'premium'].includes(i))], HOME_DEFAULT_HIDDEN))
    expect(visibleHomeBlocks(S).slice(0, 2)).toEqual(['coach', 'premium'])
    const order = homeOrder({ ux: { home: { order: HOME_IDS.filter(i => i !== 'premium') } } })
    expect(order.indexOf('premium')).toBe(order.indexOf('week') + 1)
  })
  it('hides optional blocks and shows them again; required blocks can never be hidden', () => {
    const hidden = withHome(homeChoice(HOME_IDS, ['premium', 'coach', 'review', 'followup', 'news', 'reorder']))
    const v = visibleHomeBlocks(hidden)
    expect(v).not.toContain('premium'); expect(v).not.toContain('coach')
    for (const id of ['review', 'followup', 'news', 'reorder']) expect(v).toContain(id)
    expect(HOME_BLOCKS.filter(b => !b.optional).map(b => b.id)).toEqual(['reorder', 'review', 'followup', 'news'])
    expect(isHomeOptional('news')).toBe(false); expect(isHomeOptional('premium')).toBe(true)
  })
  it('adds a block that was off, and an explicit V1 choice keeps what the member had (a stored layout wins over the new default)', () => {
    const S = draft(); setLayout(S, 'home', { order: HOME_IDS, hidden: [] })
    expect(visibleHomeBlocks(S)).toEqual(HOME_IDS)
    const v1 = { ux: { home: { order: ['readiness', 'review', 'followup', 'news', 'week', 'reorder', 'train2j', 'premium', 'coach', 'intelligence'], hidden: [] } } }
    expect(visibleHomeBlocks(v1)).toContain('train2j'); expect(visibleHomeBlocks(v1)[0]).toBe('readiness')
  })
  it('a block the member never saw keeps its default visibility; unknown or deprecated ids never break anything', () => {
    const old = { ux: { home: { order: ['week', 'premium', 'news'], hidden: [] } } }                      // saved before the other blocks existed
    expect(visibleHomeBlocks(old)).not.toContain('train2j'); expect(visibleHomeBlocks(old)).toContain('coach')
    expect(normalizeHome({ order: ['nope', 5, 'week', 'week', null], hidden: ['news', 'premium', 'zzz'] })).toEqual({ order: ['week'], hidden: ['premium'] })
    expect(visibleHomeBlocks({ ux: { home: 'x' } })).toEqual(visibleHomeBlocks({}))
    expect(visibleHomeBlocks({ ux: { home: { order: 'x', hidden: 3 } } })).toEqual(visibleHomeBlocks({}))
    expect(visibleHomeBlocks({ ux: { home: { order: ['deprecated', 'week'], hidden: ['deprecated'] } } })).toContain('week')
  })
  it('restore default stores nothing, so an untouched profile stays untouched', () => {
    const d = defaultHomeLayout(); expect(homeChoice(d.order, d.hidden)).toBeUndefined()
    expect(homeLayoutOf({})).toEqual(d)
    const S = draft(); setLayout(S, 'home', { order: ['coach', ...HOME_IDS.filter(i => i !== 'coach')], hidden: [] })
    expect(S.ux.home).toBeTruthy(); restoreLayout(S, 'home'); expect(S.ux.home).toBeUndefined(); expect(visibleHomeBlocks(S)).toEqual(visibleHomeBlocks({}))
  })
  it('persists inside S.ux (so it syncs with the profile) and survives a JSON round trip', () => {
    const S = draft(); setLayout(S, 'home', { order: ['week', ...HOME_IDS.filter(i => i !== 'week')], hidden: ['intelligence', 'train2j', 'readiness'] })
    const back = JSON.parse(JSON.stringify(S))
    expect(visibleHomeBlocks(back)).not.toContain('readiness'); expect(back.ux.uses).toBeTruthy()
  })
})

describe('Progress layout and the first-use guide', () => {
  it('the muscle recovery is its own block (right after the last workout, so the page looks as it always did)', () => {
    expect(PROGRESS_IDS.indexOf('recovery')).toBe(PROGRESS_IDS.indexOf('last') + 1)
    expect(visibleProgressCards({})).toEqual(PROGRESS_IDS)
    // a layout saved before the split has no 'recovery': it lands after 'last'
    const old = { ux: { progress: { order: PROGRESS_IDS.filter(i => i !== 'recovery'), hidden: [] } } }
    const o = progressOrder(old); expect(o.indexOf('recovery')).toBe(o.indexOf('last') + 1)
  })
  it('shows, hides, reorders and restores', () => {
    const S = draft(); setLayout(S, 'progress', { order: ['muscles', ...PROGRESS_IDS.filter(i => i !== 'muscles')], hidden: ['recovery', 'cardio'] })
    const v = visibleProgressCards(S)
    expect(v[0]).toBe('muscles'); expect(v).not.toContain('recovery'); expect(v).not.toContain('cardio')
    restoreLayout(S, 'progress'); expect(visibleProgressCards(S)).toEqual(PROGRESS_IDS); expect(normalizeProgress(S.ux.progress)).toEqual({ order: [], hidden: [] })
  })
  it('the guide is shown once: marking it seen persists, resetting re-arms it, and the other choices are kept', () => {
    const S = draft(); setLayout(S, 'home', { order: ['coach', ...HOME_IDS.filter(i => i !== 'coach')], hidden: HOME_DEFAULT_HIDDEN })
    expect(guideSeen(S)).toBe(false)
    markGuideSeen(S); expect(guideSeen(JSON.parse(JSON.stringify(S)))).toBe(true); expect(S.ux.home).toBeTruthy()
    resetGuide(S); expect(guideSeen(S)).toBe(false); expect(S.ux.home).toBeTruthy()
    const fresh = draft(); markGuideSeen(fresh); expect(fresh.ux.uses).toBeTruthy(); expect(guideSeen(fresh)).toBe(true)   // a never-personalised profile gets a complete S.ux
  })
})
