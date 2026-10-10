import { describe, expect, it } from 'vitest'
import { HOME_BLOCKS, HOME_IDS, normalizeHome, homeOrder, visibleHomeBlocks, homeChoice, defaultHomeLayout } from './home-blocks.js'
import { makeUx, currentUses } from './features.js'

const withHome = home => ({ ux: makeUx(currentUses({ ux: null }), 1, { home }) })

describe('Home layout (S.ux.home)', () => {
  it('the default order is the order Home always had, with the Premium card right after Train with 2J', () => {
    expect(HOME_IDS).toEqual(['readiness', 'review', 'followup', 'news', 'week', 'reorder', 'train2j', 'premium', 'coach', 'intelligence'])
    for (const S of [{}, { ux: null }, { ux: makeUx(currentUses({ ux: null })) }]) expect(visibleHomeBlocks(S)).toEqual(HOME_IDS)
  })
  it('reorders: the member\'s sequence wins, unlisted blocks keep their default place', () => {
    const S = withHome(homeChoice(['premium', 'week', ...HOME_IDS.filter(i => !['premium', 'week'].includes(i))], []))
    expect(homeOrder(S).slice(0, 3)).toEqual(['premium', 'week', 'readiness'])
    expect(homeOrder({ ux: { home: { order: ['coach'] } } })).toEqual(['coach', ...HOME_IDS.filter(i => i !== 'coach')].length === HOME_IDS.length ? homeOrder({ ux: { home: { order: ['coach'] } } }) : [])
    // a block added in a later release (not in the stored order) lands after its default predecessor
    const stored = HOME_IDS.filter(i => i !== 'premium')
    const order = homeOrder({ ux: { home: { order: stored } } })
    expect(order.indexOf('premium')).toBe(order.indexOf('train2j') + 1)
  })
  it('hides optional blocks and shows them again; required blocks can never be hidden', () => {
    const hidden = withHome(homeChoice(HOME_IDS, ['premium', 'coach', 'review', 'followup', 'news']))
    const v = visibleHomeBlocks(hidden)
    expect(v).not.toContain('premium'); expect(v).not.toContain('coach')
    for (const id of ['review', 'followup', 'news']) expect(v).toContain(id)
    expect(visibleHomeBlocks(withHome(homeChoice(HOME_IDS, [])))).toContain('premium')
    expect(HOME_BLOCKS.filter(b => !b.optional).map(b => b.id)).toEqual(['review', 'followup', 'news', 'reorder'])
  })
  it('restore default stores nothing, so an untouched profile stays untouched', () => {
    expect(homeChoice(HOME_IDS, [])).toBeUndefined()
    const d = defaultHomeLayout(); expect(homeChoice(d.order, d.hidden)).toBeUndefined()
    expect(makeUx(currentUses({ ux: null }), 1, { home: undefined }).home).toBeUndefined()
    expect(homeChoice(['premium', ...HOME_IDS.filter(i => i !== 'premium')], [])).toEqual({ order: ['premium', ...HOME_IDS.filter(i => i !== 'premium')], hidden: [] })
  })
  it('persists inside S.ux (so it syncs with the profile) and survives a JSON round trip', () => {
    const choice = homeChoice(['week', ...HOME_IDS.filter(i => i !== 'week')], ['intelligence'])
    const S = JSON.parse(JSON.stringify(withHome(choice)))
    expect(S.ux.home).toEqual(choice); expect(visibleHomeBlocks(S)[0]).toBe('week'); expect(visibleHomeBlocks(S)).not.toContain('intelligence')
  })
  it('garbage in storage is ignored', () => {
    expect(normalizeHome({ order: ['nope', 5, 'week', 'week'], hidden: ['news', 'premium', 'zzz'] })).toEqual({ order: ['week'], hidden: ['premium'] })
    expect(visibleHomeBlocks({ ux: { home: 'x' } })).toEqual(HOME_IDS)
    expect(visibleHomeBlocks({ ux: { home: { order: 'x', hidden: 3 } } })).toEqual(HOME_IDS)
  })
})
