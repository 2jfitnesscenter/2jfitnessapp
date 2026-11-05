import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  GYM_REMINDER_KEY, GYM_RADIUS_M, MIN_CHECK_MS, readGymReminder, writeGymReminder, clearGymReminder,
  distanceMeters, isNearGym, checkGymReminder,
} from './gym-reminder.js'

// Minimal localStorage stand-in. Every stored value is visible to the tests.
const memStorage = () => {
  const m = new Map()
  return { m, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}
const GYM = { lat: 28.1235, lng: -15.4363 }
const ON = { on: true, lat: GYM.lat, lng: GYM.lng, radius: GYM_RADIUS_M, lastCheckAt: 0, nudgedDay: null }
const NOW = Date.UTC(2026, 10, 5, 18, 0)

describe('gym reminder: settings storage', () => {
  it('is off when nothing is stored, or the stored value is malformed', () => {
    const s = memStorage()
    expect(readGymReminder(s).on).toBe(false)
    s.setItem(GYM_REMINDER_KEY, '{not json')
    expect(readGymReminder(s).on).toBe(false)
    s.setItem(GYM_REMINDER_KEY, JSON.stringify({ on: true, lat: 'x', lng: 1 }))
    expect(readGymReminder(s).on).toBe(false)
  })

  it('round-trips a valid location and clears it on request', () => {
    const s = memStorage()
    writeGymReminder(s, ON)
    expect(readGymReminder(s)).toMatchObject({ on: true, lat: GYM.lat, lng: GYM.lng })
    clearGymReminder(s)
    expect(s.m.has(GYM_REMINDER_KEY)).toBe(false)
    expect(readGymReminder(s).on).toBe(false)
  })

  it('survives storage that throws (private mode)', () => {
    const broken = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') }, removeItem() { throw new Error('denied') } }
    expect(readGymReminder(broken).on).toBe(false)
    expect(writeGymReminder(broken, ON)).toBe(false)
    expect(() => clearGymReminder(broken)).not.toThrow()
  })
})

describe('gym reminder: distance', () => {
  it('is zero for the same point and about 111 m per 0.001 degree of latitude', () => {
    expect(distanceMeters(GYM, GYM)).toBe(0)
    const d = distanceMeters({ lat: 28.1245, lng: GYM.lng }, GYM)
    expect(d).toBeGreaterThan(105)
    expect(d).toBeLessThan(118)
  })

  it('counts a position inside the radius as near and outside as far', () => {
    expect(isNearGym(GYM, ON)).toBe(true)
    expect(isNearGym({ lat: GYM.lat + 0.01, lng: GYM.lng }, ON)).toBe(false)
    expect(isNearGym(null, ON)).toBe(false)
    expect(isNearGym(GYM, { ...ON, on: false })).toBe(false)
  })
})

describe('gym reminder: the check', () => {
  let fetchSpy
  beforeEach(() => { fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('no network in this test') }) })
  afterEach(() => { fetchSpy.mockRestore() })

  it('is inert when the feature is off: no browser location request, no notice', async () => {
    const s = memStorage()
    const getPosition = vi.fn()
    const notify = vi.fn()
    const status = await checkGymReminder({ storage: s, now: NOW, today: '2026-11-05', getPosition, notify })
    expect(status).toBe('off')
    expect(getPosition).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
    expect(s.m.size).toBe(0)
  })

  it('does not ask for location during a workout', async () => {
    const s = memStorage(); writeGymReminder(s, ON)
    const getPosition = vi.fn()
    expect(await checkGymReminder({ storage: s, now: NOW, today: '2026-11-05', inWorkout: true, getPosition })).toBe('in_workout')
    expect(getPosition).not.toHaveBeenCalled()
  })

  it('nudges once when the user is at the gym, then stays quiet for the rest of the day', async () => {
    const s = memStorage(); writeGymReminder(s, ON)
    const notify = vi.fn()
    const getPosition = vi.fn().mockResolvedValue({ lat: GYM.lat, lng: GYM.lng })
    expect(await checkGymReminder({ storage: s, now: NOW, today: '2026-11-05', getPosition, notify })).toBe('nudge')
    expect(notify).toHaveBeenCalledTimes(1)
    const later = NOW + MIN_CHECK_MS + 1
    expect(await checkGymReminder({ storage: s, now: later, today: '2026-11-05', getPosition, notify })).toBe('already')
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('does nothing when the user is elsewhere, and stores no position', async () => {
    const s = memStorage(); writeGymReminder(s, ON)
    const notify = vi.fn()
    const getPosition = vi.fn().mockResolvedValue({ lat: 40.4, lng: -3.7 })
    expect(await checkGymReminder({ storage: s, now: NOW, today: '2026-11-05', getPosition, notify })).toBe('far')
    expect(notify).not.toHaveBeenCalled()
    expect(Object.keys(readGymReminder(s)).sort()).toEqual(['lastCheckAt', 'lat', 'lng', 'nudgedDay', 'on', 'radius'])
    expect(readGymReminder(s)).toMatchObject({ lat: GYM.lat, lng: GYM.lng, nudgedDay: null })
  })

  it('is inert when permission is denied: no notice, nothing new stored', async () => {
    const s = memStorage(); writeGymReminder(s, ON)
    const before = s.getItem(GYM_REMINDER_KEY)
    const notify = vi.fn()
    const getPosition = vi.fn().mockRejectedValue({ code: 1 })
    expect(await checkGymReminder({ storage: s, now: NOW, today: '2026-11-05', getPosition, notify })).toBe('no_permission')
    expect(notify).not.toHaveBeenCalled()
    expect(JSON.parse(s.getItem(GYM_REMINDER_KEY)).nudgedDay).toBeNull()
    expect(before).not.toBeNull()
  })

  it('throttles repeated checks, so the browser is not polled on every visibility change', async () => {
    const s = memStorage(); writeGymReminder(s, ON)
    const getPosition = vi.fn().mockRejectedValue({ code: 2 })
    expect(await checkGymReminder({ storage: s, now: NOW, today: '2026-11-05', getPosition })).toBe('unavailable')
    expect(await checkGymReminder({ storage: s, now: NOW + 1000, today: '2026-11-05', getPosition })).toBe('throttled')
    expect(getPosition).toHaveBeenCalledTimes(1)
  })

  it('never sends the location anywhere: no fetch is made by the check', async () => {
    const s = memStorage(); writeGymReminder(s, ON)
    await checkGymReminder({ storage: s, now: NOW, today: '2026-11-05', getPosition: async () => ({ lat: GYM.lat, lng: GYM.lng }), notify: () => {} })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('reports only a status word, never the coordinates', async () => {
    const s = memStorage(); writeGymReminder(s, ON)
    const status = await checkGymReminder({ storage: s, now: NOW, today: '2026-11-05', getPosition: async () => ({ lat: 1, lng: 2 }) })
    expect(typeof status).toBe('string')
  })
})
