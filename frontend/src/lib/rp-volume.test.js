import { describe, it, expect } from 'vitest'
import { zoneForVolume, landmarksFor, rollupToGroups, weeklyGroupVolume, primaryGroupOf, RP_VOLUME_DEFAULTS, LEVELS, weekRangeLabel, groupVolumeForWeek, monthlyGroupVolume, zoneCounts, clampLandmark } from './rp-volume.js'
import { todayISO, weekKey } from './format.js'
import { MUSCLE_GROUPS } from './muscles.js'

const BENCH = '0025'   // real dataset id, chest primary, barbell — same fixture other lib tests use
const DIP = '0019'     // assisted triceps dip — triceps primary, chest/shoulders secondary

describe('zoneForVolume', () => {
  const lm = { mv: 4, mev: 8, mav: 12, mrvMin: 16, mrvMax: 20 }
  it('places each boundary in the zone that starts there, not the one before it', () => {
    expect(zoneForVolume(0, lm)).toBe('below')
    expect(zoneForVolume(3, lm)).toBe('below')
    expect(zoneForVolume(4, lm)).toBe('mv')
    expect(zoneForVolume(7, lm)).toBe('mv')
    expect(zoneForVolume(8, lm)).toBe('mev')
    expect(zoneForVolume(11, lm)).toBe('mev')
    expect(zoneForVolume(12, lm)).toBe('mav')
    expect(zoneForVolume(15, lm)).toBe('mav')
    expect(zoneForVolume(16, lm)).toBe('mrv')
    expect(zoneForVolume(20, lm)).toBe('mrv')
  })
  it('still reads as MRV past the ceiling, not some undefined sixth zone', () => {
    expect(zoneForVolume(30, lm)).toBe('mrv')
  })
  it('is null with no landmarks to compare against', () => {
    expect(zoneForVolume(10, null)).toBeNull()
  })
})

describe('RP_VOLUME_DEFAULTS', () => {
  it('every level covers all 12 muscle groups with strictly increasing landmarks', () => {
    LEVELS.forEach(level => {
      const table = RP_VOLUME_DEFAULTS[level]
      expect(Object.keys(table)).toHaveLength(12)
      Object.values(table).forEach(lm => {
        expect(lm.mv).toBeLessThanOrEqual(lm.mev)
        expect(lm.mev).toBeLessThan(lm.mav)
        expect(lm.mav).toBeLessThan(lm.mrvMin)
        expect(lm.mrvMin).toBeLessThanOrEqual(lm.mrvMax)
      })
    })
  })
  it('advanced tolerates more volume than intermediate, which tolerates more than beginner', () => {
    ;['chest', 'quadriceps', 'back'].forEach(g => {
      expect(RP_VOLUME_DEFAULTS.beginner[g].mrvMax).toBeLessThan(RP_VOLUME_DEFAULTS.intermediate[g].mrvMax)
      expect(RP_VOLUME_DEFAULTS.intermediate[g].mrvMax).toBeLessThan(RP_VOLUME_DEFAULTS.advanced[g].mrvMax)
    })
  })
})

describe('landmarksFor', () => {
  it('defaults to intermediate when no level is set', () => {
    expect(landmarksFor({}, 'chest')).toEqual(RP_VOLUME_DEFAULTS.intermediate.chest)
  })
  it('reads the chosen level', () => {
    expect(landmarksFor({ trainingLevel: 'advanced' }, 'chest')).toEqual(RP_VOLUME_DEFAULTS.advanced.chest)
  })
  it('an unrecognised level falls back to intermediate rather than throwing', () => {
    expect(landmarksFor({ trainingLevel: 'bogus' }, 'chest')).toEqual(RP_VOLUME_DEFAULTS.intermediate.chest)
  })
  it('a per-muscle override (future calibration UI) wins over the level default', () => {
    const custom = { mv: 1, mev: 2, mav: 3, mrvMin: 4, mrvMax: 5 }
    expect(landmarksFor({ trainingLevel: 'beginner', rpVolumeOverrides: { chest: custom } }, 'chest')).toEqual(custom)
  })
})

describe('rollupToGroups', () => {
  it('sums a multi-slug group (back = upper-back + lower-back) into one number', () => {
    const load = { 'upper-back': 3, 'lower-back': 1, chest: 2 }
    const groups = rollupToGroups(load)
    expect(groups.back).toBe(4)
    expect(groups.chest).toBe(2)
  })
  it('a group with no matching slugs at all is zero, not missing', () => {
    const groups = rollupToGroups({ chest: 5 })
    expect(groups.calves).toBe(0)
  })
})

describe('primaryGroupOf', () => {
  it('picks the group of the single highest-weighted slug', () => {
    expect(primaryGroupOf({ chest: 1, triceps: 0.4, deltoids: 0.4 })).toBe('chest')
  })
  it('a tricep-dominant load rolls up to the triceps group', () => {
    expect(primaryGroupOf({ triceps: 1, chest: 0.4, deltoids: 0.4 })).toBe('triceps')
  })
  it('is null for an empty load', () => {
    expect(primaryGroupOf({})).toBeNull()
  })
})

describe('weeklyGroupVolume', () => {
  const S = (over = {}) => ({ workouts: [], active: null, ...over })
  const doneSets = n => Array.from({ length: n }, () => ({ w: 40, r: 10, done: true }))
  it('counts a finished workout from this week', () => {
    const w = { id: 'w1', d: todayISO(), entries: [{ id: BENCH, sets: doneSets(4) }] }
    const vol = weeklyGroupVolume(S({ workouts: [w] }))
    expect(vol.chest).toBe(4)
  })
  it('ignores a finished workout from a different week', () => {
    const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10)
    const w = { id: 'w2', d: twoWeeksAgo, entries: [{ id: BENCH, sets: doneSets(4) }] }
    const vol = weeklyGroupVolume(S({ workouts: [w] }))
    expect(vol.chest).toBe(0)
  })
  it('adds the still-open session on top of this week’s finished workouts', () => {
    const finished = { id: 'w3', d: todayISO(), entries: [{ id: BENCH, sets: doneSets(2) }] }
    const active = { entries: [{ id: BENCH, sets: [{ done: true }, { done: true }, { done: false }] }] }
    const vol = weeklyGroupVolume(S({ workouts: [finished], active }))
    expect(vol.chest).toBe(4)   // 2 finished + 2 done-so-far (the 3rd set isn't done yet)
  })
  it('a triceps-dominant exercise credits the triceps group, chest only at the secondary factor', () => {
    const w = { id: 'w4', d: todayISO(), entries: [{ id: DIP, sets: doneSets(3) }] }
    const vol = weeklyGroupVolume(S({ workouts: [w] }))
    expect(vol.triceps).toBe(3)
    expect(vol.chest).toBeGreaterThan(0)
    expect(vol.chest).toBeLessThan(3)
  })
})

// Independent copies of rp-volume.js's own private date math (weekDates/the month-membership
// loop) — deliberately duplicated here rather than exported from the module, so these tests
// confirm the *contract* ("this week's Monday", "which weeks belong to this calendar month")
// against a from-scratch computation, not just that the implementation agrees with itself.
function mondayOf(offset) {
  const base = new Date(todayISO() + 'T12:00:00')
  base.setDate(base.getDate() - offset * 7)
  const day = (base.getDay() + 6) % 7
  base.setDate(base.getDate() - day)
  return base
}
function offsetsInThisMonth() {
  const now = new Date(todayISO() + 'T12:00:00')
  const out = []
  for (let offset = 0; offset < 6; offset++) {
    const m = mondayOf(offset)
    if (m.getMonth() === now.getMonth() && m.getFullYear() === now.getFullYear()) out.push(offset)
  }
  return out
}

describe('weekRangeLabel', () => {
  it('is a day-to-day range spanning the Monday..Sunday that contains today', () => {
    const label = weekRangeLabel(0)
    expect(label).toMatch(/-/)
    const { monday, sunday } = { monday: mondayOf(0), sunday: (() => { const d = mondayOf(0); d.setDate(d.getDate() + 6); return d })() }
    const today = new Date(todayISO() + 'T12:00:00')
    expect(today.getTime()).toBeGreaterThanOrEqual(monday.getTime())
    expect(today.getTime()).toBeLessThanOrEqual(sunday.getTime())
    expect(label).toMatch(new RegExp(`(^|[^0-9])${sunday.getDate()}([^0-9]|$)`))
  })
  it('a week further back has an earlier range than the current week', () => {
    // Loose check that doesn't depend on exact formatting: the two labels differ, and asking
    // for a week 8 offsets back never throws (crosses a year boundary in some months).
    expect(weekRangeLabel(0)).not.toBe(weekRangeLabel(4))
    expect(() => weekRangeLabel(8)).not.toThrow()
  })
})

describe('groupVolumeForWeek', () => {
  const S = (over = {}) => ({ workouts: [], active: null, ...over })
  const doneSets = n => Array.from({ length: n }, () => ({ w: 40, r: 10, done: true }))
  it('offset 0 is exactly weeklyGroupVolume, active session included', () => {
    const active = { entries: [{ id: BENCH, sets: [{ done: true }] }] }
    const s = S({ active })
    expect(groupVolumeForWeek(s, 0)).toEqual(weeklyGroupVolume(s))
  })
  it('a positive offset reads only that past week’s finished workouts, ignoring this week', () => {
    const mondayLastWeek = mondayOf(1).toISOString().slice(0, 10)
    const lastWeek = { id: 'wlw', d: mondayLastWeek, entries: [{ id: BENCH, sets: doneSets(5) }] }
    const thisWeek = { id: 'wtw', d: todayISO(), entries: [{ id: BENCH, sets: doneSets(9) }] }
    const vol = groupVolumeForWeek(S({ workouts: [lastWeek, thisWeek] }), 1)
    expect(vol.chest).toBe(5)
  })
  it('a past week ignores the still-open session (there is no "still open" for a finished week)', () => {
    const mondayLastWeek = mondayOf(1).toISOString().slice(0, 10)
    const lastWeek = { id: 'wlw', d: mondayLastWeek, entries: [{ id: BENCH, sets: doneSets(3) }] }
    const active = { entries: [{ id: BENCH, sets: [{ done: true }] }] }
    const vol = groupVolumeForWeek(S({ workouts: [lastWeek], active }), 1)
    expect(vol.chest).toBe(3)
  })
})

describe('monthlyGroupVolume', () => {
  const S = (over = {}) => ({ workouts: [], active: null, ...over })
  const doneSets = n => Array.from({ length: n }, () => ({ w: 40, r: 10, done: true }))
  it('averages a fixed 4-set week across exactly the weeks that belong to this calendar month', () => {
    const offsets = offsetsInThisMonth()
    const workouts = offsets.map(offset => ({
      id: 'w' + offset, d: mondayOf(offset).toISOString().slice(0, 10),
      entries: [{ id: BENCH, sets: doneSets(4) }],
    }))
    const vol = monthlyGroupVolume(S({ workouts }))
    expect(vol.chest).toBeCloseTo(4, 5)   // every counted week contributed exactly 4 — average is 4
  })
  it('a week from a different month doesn’t drag the average down', () => {
    const offsets = offsetsInThisMonth()
    const inMonth = offsets.map(offset => ({
      id: 'w' + offset, d: mondayOf(offset).toISOString().slice(0, 10),
      entries: [{ id: BENCH, sets: doneSets(4) }],
    }))
    const farBack = { id: 'wfar', d: mondayOf(20).toISOString().slice(0, 10), entries: [{ id: BENCH, sets: doneSets(99) }] }
    const vol = monthlyGroupVolume(S({ workouts: [...inMonth, farBack] }))
    expect(vol.chest).toBeCloseTo(4, 5)
  })
})

describe('zoneCounts', () => {
  it('tallies all 12 groups into the five zone buckets, summing back to 12', () => {
    const S = { trainingLevel: 'intermediate', rpVolumeOverrides: {} }
    // Everything at 0 sets — with intermediate's landmarks, most groups have mv > 0 so read as
    // "below"; the handful with mv === 0 (forearm/abs) read as "mv" instead (see RP_VOLUME_DEFAULTS'
    // own comment on why those start at zero).
    const volumeByGroup = {}
    MUSCLE_GROUPS.forEach(g => { volumeByGroup[g.key] = 0 })
    const counts = zoneCounts(S, volumeByGroup)
    const total = Object.values(counts).reduce((a, b) => a + b, 0)
    expect(total).toBe(12)
    expect(counts.mrv).toBe(0)
  })
})

describe('clampLandmark', () => {
  const lm = { mv: 4, mev: 8, mav: 12, mrvMin: 16, mrvMax: 20 }
  it('allows a move that keeps every boundary strictly ordered', () => {
    expect(clampLandmark(lm, 'mv', 1)).toEqual({ ...lm, mv: 5 })
  })
  it('blocks mv from crossing mev', () => {
    expect(clampLandmark(lm, 'mv', 5)).toEqual(lm)   // 4+5=9 > mev(8)
  })
  it('lets mev drop down to meet mv (mv<=mev is fine), but not below it', () => {
    expect(clampLandmark(lm, 'mev', -4)).toEqual({ ...lm, mev: 4 })   // 8-4=4, equals mv — allowed
    expect(clampLandmark(lm, 'mev', -5)).toEqual(lm)                   // 8-5=3 < mv(4) — blocked
  })
  it('blocks mev from reaching or passing mav', () => {
    expect(clampLandmark(lm, 'mev', 4)).toEqual(lm)    // 8+4=12, equals mav
  })
  it('blocks mrvMin from crossing mrvMax', () => {
    expect(clampLandmark(lm, 'mrvMin', 5)).toEqual(lm)   // 16+5=21 > mrvMax(20)
  })
  it('lets mrvMax grow freely upward', () => {
    expect(clampLandmark(lm, 'mrvMax', 10)).toEqual({ ...lm, mrvMax: 30 })
  })
  it('never lets a field go negative', () => {
    expect(clampLandmark({ mv: 0, mev: 2, mav: 4, mrvMin: 6, mrvMax: 8 }, 'mv', -1)).toEqual({ mv: 0, mev: 2, mav: 4, mrvMin: 6, mrvMax: 8 })
  })
})
