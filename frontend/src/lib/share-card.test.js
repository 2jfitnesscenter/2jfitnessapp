import { describe, it, expect } from 'vitest'
import { buildShareCardData } from './share-card.js'

const BENCH = '0025'    // real dataset id, chest, barbell — the fixture other lib tests use too
const DIP = '0019'      // assisted triceps dip, no weight logged in some cases below
const baseS = (over = {}) => ({ unit: 'kg', countSecondaryMuscles: true, ...over })
const set = (over = {}) => ({ w: 40, r: 10, done: true, ...over })

const baseWorkout = (over = {}) => ({
  id: 'w1', d: '2026-09-18', start: 0, end: 45 * 60000, name: 'Día de empuje',
  entries: [], vol: 0, ...over,
})

describe('buildShareCardData', () => {
  it('ranks lifts by weight × reps, not entry order', () => {
    const w = baseWorkout({
      entries: [
        { id: DIP, sets: [set({ w: 20, r: 12 })] },          // vol 240
        { id: BENCH, sets: [set({ w: 80, r: 10 })] },        // vol 800 — should come first
      ],
    })
    const data = buildShareCardData(baseS(), w, [], [], [])
    expect(data.lifts[0].id).toBe(BENCH)
    expect(data.lifts[1].id).toBe(DIP)
  })

  it('picks the heaviest-volume set among several for the same exercise', () => {
    const w = baseWorkout({
      entries: [{ id: BENCH, sets: [set({ w: 60, r: 10 }), set({ w: 80, r: 8 }), set({ w: 40, r: 5 })] }],
    })
    const data = buildShareCardData(baseS(), w, [], [], [])
    expect(data.lifts[0]).toMatchObject({ w: 80, r: 8 })
  })

  it('ignores warmup sets, undone sets, and zero-weight/zero-rep sets', () => {
    const w = baseWorkout({
      entries: [{
        id: BENCH,
        sets: [
          set({ w: 20, r: 8, type: 'warmup' }),
          set({ w: 80, r: 10, done: false }),
          set({ w: 0, r: 10 }),
          set({ w: 80, r: 0 }),
          set({ w: 60, r: 12 }),
        ],
      }],
    })
    const data = buildShareCardData(baseS(), w, [], [], [])
    expect(data.lifts).toHaveLength(1)
    expect(data.lifts[0]).toMatchObject({ w: 60, r: 12 })
  })

  it('caps lifts at 4, keeping the top ones by volume', () => {
    const ids = ['0025', '0033', '1274', '0151', '0019']
    const w = baseWorkout({
      entries: ids.map((id, i) => ({ id, sets: [set({ w: 10 * (i + 1), r: 10 })] })),
    })
    const data = buildShareCardData(baseS(), w, [], [], [])
    expect(data.lifts).toHaveLength(4)
    expect(data.lifts[0].id).toBe('0019')   // heaviest (50kg×10)
  })

  it('flags a lift as a PR from either prs or e1prs, deduping the count', () => {
    const w = baseWorkout({
      entries: [
        { id: BENCH, sets: [set({ w: 80, r: 10 })] },
        { id: DIP, sets: [set({ w: 20, r: 12 })] },
      ],
    })
    const data = buildShareCardData(baseS(), w, [BENCH], [{ id: BENCH, est: 100 }, { id: DIP, est: 30 }], [])
    expect(data.lifts.find(l => l.id === BENCH).isPR).toBe(true)
    expect(data.lifts.find(l => l.id === DIP).isPR).toBe(true)
    // BENCH appears in both prs and e1prs — prCount counts it once.
    expect(data.prCount).toBe(2)
  })

  it('sums total reps across done, non-warmup sets only', () => {
    const w = baseWorkout({
      entries: [{
        id: BENCH,
        sets: [set({ w: 20, r: 8, type: 'warmup' }), set({ w: 80, r: 10 }), set({ w: 80, r: 9, done: false }), set({ w: 80, r: 8 })],
      }],
    })
    const data = buildShareCardData(baseS(), w, [], [], [])
    expect(data.totalReps).toBe(18)
  })

  it('caps badges at 4 and keeps only id/title/image', () => {
    const w = baseWorkout()
    const newBadges = Array.from({ length: 6 }, (_, i) => ({ id: 'b' + i, title: 'Badge ' + i, image: '/badges/b' + i + '.png', category: 'x', threshold: 1 }))
    const data = buildShareCardData(baseS(), w, [], [], newBadges)
    expect(data.badges).toHaveLength(4)
    expect(data.badges[0]).toEqual({ id: 'b0', title: 'Badge 0', image: '/badges/b0.png' })
  })

  it('carries routine name, date and duration straight through', () => {
    const w = baseWorkout({ name: 'Día de tirón', start: 1000, end: 1000 + 30 * 60000 })
    const data = buildShareCardData(baseS(), w, [], [], [])
    expect(data.routineName).toBe('Día de tirón')
    expect(data.duration).toBe('30 min')
  })
})
