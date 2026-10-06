import { describe, expect, it } from 'vitest'
import { cardioTestGroups, cardioWorkoutReference, formatPace, vamPaceZones } from './cardio-tests.js'

const T0 = Date.parse('2026-10-06T12:00:00')

describe('cardio test summaries', () => {
  it('turns a VAM result into valid conservative speed and pace ranges', () => {
    const zones = vamPaceZones(12)
    expect(zones).toHaveLength(4)
    expect(zones[0]).toMatchObject({ slow: 7.2, fast: 8.4 })
    expect(zones.at(-1)).toMatchObject({ slow: 10.8, fast: 12 })
    expect(zones.every(zone => zone.paceFast < zone.paceSlow)).toBe(true)
    expect(formatPace(zones[0].paceFast)).toMatch(/\/km$/)
    expect(vamPaceZones(0)).toEqual([])
  })

  it('does not create a same-as-best target when the test speed is low', () => {
    const group = cardioTestGroups([{ type: 'erg', ergType: 'row', d: '2026-10-01', avgSpeed: 1 }], T0)[0]
    expect(group.nextGoal).toBe(1.1)
  })

  it('provides contextual test references only for matching existing cardio equipment', () => {
    const tests = [
      { type: 'vam', d: '2026-10-01', avgSpeed: 12, durationSec: 360 },
      { type: 'erg', ergType: 'bike', d: '2026-10-02', avgSpeed: 20 }
    ]
    expect(cardioWorkoutReference(tests, { id: 'tread', eq: 'treadmill' }, 9)).toMatchObject({ type: 'vam', zone: { key: 'aerobic' } })
    expect(cardioWorkoutReference(tests, { id: 'bike', eq: 'stationary bike' }, 8)).toMatchObject({ type: 'erg', latest: { avgSpeed: 20 } })
    expect(cardioWorkoutReference(tests, { id: 'row', eq: 'rowing machine' }, 8)).toBeNull()
  })

  it('compares recent ergometer results with the previous test and exposes a next-test goal', () => {
    const groups = cardioTestGroups([
      { id: 'old', type: 'erg', ergType: 'row', d: '2026-09-01', avgSpeed: 10 },
      { id: 'new', type: 'erg', ergType: 'row', d: '2026-10-01', avgSpeed: 11 },
      { id: 'bike', type: 'erg', ergType: 'bike', d: '2026-10-02', avgSpeed: 20 },
      { id: 'vam', type: 'vam', d: '2026-10-01', avgSpeed: 12, durationSec: 360 }
    ], T0)
    const row = groups.find(group => group.ergType === 'row')
    expect(row).toMatchObject({ latest: { id: 'new' }, previous: { id: 'old' }, best: { id: 'new' }, changePct: 10, nextGoal: 11.1 })
    expect(groups.find(group => group.ergType === 'bike')).toBeTruthy()
    expect(groups.find(group => group.type === 'vam').zones).toHaveLength(4)
    expect(cardioTestGroups([{ type: 'vam', d: '2026-10-01', avgSpeed: 12, durationSec: 300 }], T0)[0].zones).toEqual([])
  })

  it('reminds after eight weeks, keeps reminders active, and ignores malformed legacy records', () => {
    const tests = [
      { type: 'vam', d: '2026-08-11', avgSpeed: 12 },
      { type: 'vam', d: 'bad-date', avgSpeed: 15 },
      { type: 'erg', ergType: 'unrecognized', d: '2026-08-01', avgSpeed: 10 },
      { type: '1rm', d: '2026-08-01', avgSpeed: 50 }
    ]
    expect(cardioTestGroups(tests, T0)).toMatchObject([{ type: 'vam', reminder: true, latest: { avgSpeed: 12 } }])
    expect(cardioTestGroups([{ type: 'vam', d: '2026-09-01', avgSpeed: 12 }], T0)[0].reminder).toBe(false)
    expect(cardioTestGroups(null, T0)).toEqual([])
  })
})
