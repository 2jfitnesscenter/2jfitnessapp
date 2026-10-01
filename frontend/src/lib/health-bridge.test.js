// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getBridge, bridgeState, connectBridge, readBridge, applyMatches, disconnectBridge, sanitizeSession, recordsFrom, platformLabel, shouldShowManualHealthConnectHelp, MAX_DAYS, MAX_SESSIONS, DEFAULT_DAYS } from './health-bridge.js'
import { fitnessOf, fitnessSources } from './fitness.js'
import es from '../locales/es.js'

/* Health native bridge — web side. A fake shell stands in for Health Connect / HealthKit: the
 * point is what 2J accepts, stores and refuses, not the OS. */
const NOW = Date.parse('2026-10-02T12:00:00Z')
const h = (hh, mm = 0) => Date.parse(`2026-10-01T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`)
let mem
beforeEach(() => {
  mem = new Map()
  vi.stubGlobal('localStorage', { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) })
})
const androidSession = (over = {}) => ({ startTime: new Date(h(18, 3)).toISOString(), endTime: new Date(h(19, 8)).toISOString(), exerciseType: 80,
  metadata: { id: 'hc-1', dataOrigin: { packageName: 'com.huami.watch.hmwatchmanager' } }, aggregates: { activeCaloriesKcal: 412, hrAvg: 128, hrMax: 171 }, ...over })
const iosSession = (over = {}) => ({ uuid: 'hk-1', startDate: new Date(h(18, 3)).toISOString(), endDate: new Date(h(19, 8)).toISOString(), workoutActivityType: 50,
  sourceRevision: { source: { name: 'Apple Watch', bundleIdentifier: 'com.apple.health' } }, activeEnergyKcal: 390, hrAvg: 121, hrMax: 166, ...over })
const workout = (id = 'w1') => ({ id, name: 'Push', d: '2026-10-01', start: h(18, 1), end: h(19, 10), entries: [] })
const fakeBridge = (over = {}) => ({ platform: 'android', isAvailable: vi.fn().mockResolvedValue({ available: true }),
  requestPermissions: vi.fn().mockResolvedValue({ granted: ['workouts', 'activeCalories', 'heartRate'] }),
  readWorkouts: vi.fn().mockResolvedValue([androidSession()]), ...over })

describe('detection: nothing in a browser or the installed PWA', () => {
  it('no shell → no bridge; a partial or malformed object is not a bridge', () => {
    expect(getBridge({})).toBeNull()
    expect(getBridge(undefined)).toBeNull()
    expect(getBridge({ TwoJNative: {} })).toBeNull()
    expect(getBridge({ TwoJNative: { health: { isAvailable() {} } } })).toBeNull()
    expect(getBridge({ TwoJNative: { health: 'yes' } })).toBeNull()
  })
  it('a complete TwoJNative.health or a Capacitor TwoJHealth plugin is accepted', () => {
    const b = fakeBridge()
    expect(getBridge({ TwoJNative: { health: b } })).toBe(b)
    const wrapped = getBridge({ Capacitor: { Plugins: { TwoJHealth: b } } })   // adapted (a Capacitor call answers an object), not the raw plugin
    expect(wrapped).not.toBeNull(); expect(wrapped).not.toBe(b); expect(wrapped.platform).toBe('android')
    expect(platformLabel({ platform: 'ios' })).toBe('Apple Health')
    expect(platformLabel({ platform: 'android' })).toBe('Health Connect')
    expect(platformLabel({})).toBe('Health')
  })
  it('shows manual permission guidance only after an Android denial', () => {
    expect(shouldShowManualHealthConnectHelp({ platform: 'android' }, 'denied')).toBe(true)
    expect(shouldShowManualHealthConnectHelp({ platform: 'android' }, 'connected')).toBe(false)
    expect(shouldShowManualHealthConnectHelp({ platform: 'ios' }, 'denied')).toBe(false)
    expect(es['To allow access manually, open Settings → Health Connect → App access → 2J Fitness. The wording may vary by Android version.']).toMatch(/Ajustes → Health Connect → Acceso de apps → 2J Fitness/)
  })
})

describe('private by default: consent is explicit, local and revocable', () => {
  it('does not create shared anonymous consent without an account', async () => {
    const b = fakeBridge()
    expect(bridgeState()).toEqual({ enabled: false, at: null, lastSync: null, granted: [] })
    expect(await connectBridge({ bridge: b, now: NOW })).toMatchObject({ status: 'unavailable', reason: 'user_required' })
    expect(await readBridge({ workouts: [workout()], bridge: b, now: NOW })).toEqual({ status: 'off' })
    expect(b.isAvailable).not.toHaveBeenCalled()
    expect(b.requestPermissions).not.toHaveBeenCalled()
    expect(b.readWorkouts).not.toHaveBeenCalled()
    expect(mem.size).toBe(0)
  })
  it('off until the person connects; nothing is read without consent', async () => {
    const b = fakeBridge()
    expect(bridgeState('u1')).toEqual({ enabled: false, at: null, lastSync: null, granted: [] })
    expect(await readBridge({ uid: 'u1', workouts: [workout()], bridge: b, now: NOW })).toEqual({ status: 'off' })
    expect(b.readWorkouts).not.toHaveBeenCalled()
    expect(b.requestPermissions).not.toHaveBeenCalled()
  })
  it('connect asks the OS for read access and stores only this device’s consent', async () => {
    const b = fakeBridge()
    expect(await connectBridge({ uid: 'u1', bridge: b, now: NOW })).toEqual({ status: 'connected', granted: ['workouts', 'activeCalories', 'heartRate'] })
    expect(b.readWorkouts).not.toHaveBeenCalled()                       // connecting never reads
    expect(bridgeState('u1')).toMatchObject({ enabled: true, at: NOW, lastSync: null })
    expect(bridgeState('u2').enabled).toBe(false)                       // per account
    disconnectBridge('u1')
    expect(bridgeState('u1').enabled).toBe(false)
    expect(await readBridge({ uid: 'u1', workouts: [], bridge: b, now: NOW })).toEqual({ status: 'off' })
  })
  it('unavailable, denied, partial and failing shells are handled; nothing is stored', async () => {
    expect(await connectBridge({ uid: 'u1', bridge: null })).toEqual({ status: 'unavailable' })
    expect(await connectBridge({ uid: 'u1', bridge: fakeBridge({ isAvailable: vi.fn().mockResolvedValue({ available: false, reason: 'not_installed' }) }) })).toEqual({ status: 'unavailable', reason: 'not_installed' })
    expect(await connectBridge({ uid: 'u1', bridge: fakeBridge({ isAvailable: vi.fn().mockRejectedValue(new Error('x')) }) })).toEqual({ status: 'unavailable' })
    expect(await connectBridge({ uid: 'u1', bridge: fakeBridge({ requestPermissions: vi.fn().mockResolvedValue({ granted: [] }) }) })).toEqual({ status: 'denied' })
    expect(await connectBridge({ uid: 'u1', bridge: fakeBridge({ requestPermissions: vi.fn().mockResolvedValue({ granted: ['heartRate'] }) }) })).toEqual({ status: 'denied' })   // workouts are required
    expect(await connectBridge({ uid: 'u1', bridge: fakeBridge({ requestPermissions: vi.fn().mockRejectedValue(new Error('no')) }) })).toEqual({ status: 'denied' })
    expect(bridgeState('u1').enabled).toBe(false)
    expect(mem.size).toBe(0)
  })
  it('a corrupt consent record reads as off', () => {
    mem.set('health_bridge_v1:u1', '{broken')
    expect(bridgeState('u1').enabled).toBe(false)
    mem.set('health_bridge_v1:u1', JSON.stringify({ enabled: 'yes' }))
    expect(bridgeState('u1').enabled).toBe(false)
    mem.set('health_bridge_v1:u1', JSON.stringify({ enabled: true, granted: ['heartRate'] }))
    expect(bridgeState('u1').enabled).toBe(false) // no workout permission means no read consent
  })
})

describe('what crosses the bridge is validated and whitelisted', () => {
  it('keeps only the contract’s fields; raw samples and extra metadata never survive', () => {
    const s = sanitizeSession({ ...androidSession(), heartRateSamples: [{ t: 1, v: 99 }], notes: 'private', metadata: { id: 'hc-1', dataOrigin: { packageName: 'p', x: 1 }, device: 'watch' } }, NOW)
    expect(Object.keys(s).sort()).toEqual(['aggregates', 'endTime', 'exerciseType', 'metadata', 'startTime'])
    expect(JSON.stringify(s)).not.toMatch(/heartRateSamples|private|device/)
    const k = sanitizeSession({ ...iosSession(), samples: [1, 2, 3] }, NOW)
    expect(JSON.stringify(k)).not.toMatch(/samples/)
  })
  it('rejects implausible sessions: no id, wrong order, over 24 h, in the future, before 2000, both or neither platform', () => {
    expect(sanitizeSession(androidSession({ metadata: {} }), NOW)).toBeNull()
    expect(sanitizeSession(androidSession({ endTime: androidSession().startTime }), NOW)).toBeNull()
    expect(sanitizeSession(androidSession({ endTime: new Date(h(18, 3) + 25 * 3600e3).toISOString() }), NOW)).toBeNull()
    expect(sanitizeSession(androidSession({ startTime: new Date(NOW + 3600e3).toISOString(), endTime: new Date(NOW + 7200e3).toISOString() }), NOW)).toBeNull()
    expect(sanitizeSession(androidSession({ startTime: '1990-01-01T10:00:00Z', endTime: '1990-01-01T11:00:00Z' }), NOW)).toBeNull()
    expect(sanitizeSession({ ...androidSession(), startDate: androidSession().startTime }, NOW)).toBeNull()
    expect(sanitizeSession({ foo: 1 }, NOW)).toBeNull()
    expect(sanitizeSession(null, NOW)).toBeNull()
    expect(sanitizeSession(iosSession({ uuid: '' }), NOW)).toBeNull()
  })
  it('drops out-of-range numbers instead of storing them', () => {
    const s = sanitizeSession(androidSession({ aggregates: { activeCaloriesKcal: 9e9, hrAvg: 5, hrMax: 400 } }), NOW)
    expect(s.aggregates).toEqual({ activeCaloriesKcal: null, totalCaloriesKcal: null, hrAvg: null, hrMax: null })
    const { records } = recordsFrom([androidSession({ aggregates: { activeCaloriesKcal: -1 } })], NOW)
    expect(records[0]).toMatchObject({ calories: null, avgHr: null })
  })
  it('maps both platforms through the existing mappers, de-duplicates and caps the batch', () => {
    const { records, rejected } = recordsFrom([androidSession(), androidSession(), iosSession(), { bad: true }], NOW)
    expect(records.map(r => [r.source, r.externalId, r.origin, r.calories])).toEqual([['healthconnect', 'hc-1', 'Zepp', 412], ['healthkit', 'hk-1', 'Apple Watch', 390]])
    expect(rejected).toBe(1)
    const many = Array.from({ length: MAX_SESSIONS + 20 }, (_, i) => androidSession({ metadata: { id: 'id' + i } }))
    const r = recordsFrom(many, NOW)
    expect(r.records).toHaveLength(MAX_SESSIONS); expect(r.rejected).toBe(20)
    expect(recordsFrom('nope', NOW)).toEqual({ records: [], rejected: 0 })
  })
  it('read ignores sessions outside the requested window even if the shell returns them', async () => {
    const oldStart = NOW - 100 * 86400e3, oldEnd = oldStart + 60 * 60e3
    const b = fakeBridge({ readWorkouts: vi.fn().mockResolvedValue([
      androidSession(), androidSession({ metadata: { id: 'old' }, startTime: new Date(oldStart).toISOString(), endTime: new Date(oldEnd).toISOString() }),
    ]) })
    await connectBridge({ uid: 'u1', bridge: b, now: NOW })
    const res = await readBridge({ uid: 'u1', workouts: [workout()], bridge: b, days: 30, now: NOW })
    expect(res).toMatchObject({ status: 'ok', read: 1, rejected: 1 })
    expect(res.match).toHaveLength(1)
  })
})

describe('sync: matches conservatively, idempotently, and never writes by itself', () => {
  const connected = async b => { await connectBridge({ uid: 'u1', bridge: b, now: NOW }); return b }
  it('reads a bounded window, matches a single overlapping workout and attaches it once', async () => {
    const b = await connected(fakeBridge())
    const S = { workouts: [workout()] }
    const res = await readBridge({ uid: 'u1', workouts: S.workouts, bridge: b, now: NOW })
    const q = b.readWorkouts.mock.calls[0][0]
    expect(Date.parse(q.end) - Date.parse(q.start)).toBe(DEFAULT_DAYS * 86400e3)
    expect(res).toMatchObject({ status: 'ok', read: 1, rejected: 0 }); expect(res.match).toHaveLength(1)
    expect(S.workouts[0].fitness).toBeUndefined()                      // reading alone changes nothing
    expect(bridgeState('u1').lastSync).toBe(NOW)
    expect(applyMatches(S, res)).toBe(1)
    expect(fitnessOf(S.workouts[0])).toMatchObject({ source: 'healthconnect', calories: 412, avgHr: 128, maxHr: 171, origin: 'Zepp' })
    // the same sync again: already linked, no duplicate
    const again = await readBridge({ uid: 'u1', workouts: S.workouts, bridge: b, now: NOW })
    expect(again.match).toHaveLength(0); expect(again.linked).toHaveLength(1)
    expect(applyMatches(S, again)).toBe(0)
    expect(fitnessSources(S.workouts[0])).toHaveLength(1)
  })
  it('does not attach optional health metrics the person did not grant', async () => {
    const b = fakeBridge({ requestPermissions: vi.fn().mockResolvedValue({ granted: ['workouts'] }) })
    await connected(b)
    const S = { workouts: [workout()] }
    const res = await readBridge({ uid: 'u1', workouts: S.workouts, bridge: b, now: NOW })
    expect(res.status).toBe('ok')
    expect(applyMatches(S, res)).toBe(1)
    expect(fitnessOf(S.workouts[0])).toMatchObject({ source: 'healthconnect', calories: null, avgHr: null, maxHr: null })
  })
  it('the window is clamped to 1–90 days', async () => {
    const b = await connected(fakeBridge({ readWorkouts: vi.fn().mockResolvedValue([]) }))
    await readBridge({ uid: 'u1', workouts: [], bridge: b, days: 9999, now: NOW })
    await readBridge({ uid: 'u1', workouts: [], bridge: b, days: 0, now: NOW })
    const span = c => (Date.parse(c[0].end) - Date.parse(c[0].start)) / 86400e3
    expect(span(b.readWorkouts.mock.calls[0])).toBe(MAX_DAYS)
    expect(span(b.readWorkouts.mock.calls[1])).toBe(DEFAULT_DAYS)
  })
  it('ambiguous and unmatched sessions are returned, never linked on a guess', async () => {
    const b = await connected(fakeBridge({ readWorkouts: vi.fn().mockResolvedValue([androidSession(), androidSession({ metadata: { id: 'far' }, startTime: new Date(h(6)).toISOString(), endTime: new Date(h(7)).toISOString() })]) }))
    const two = [workout('w1'), { ...workout('w2'), start: h(18, 30), end: h(19, 20) }]
    const res = await readBridge({ uid: 'u1', workouts: two, bridge: b, now: NOW })
    expect(res.ambiguous).toHaveLength(1); expect(res.none).toHaveLength(1); expect(res.match).toHaveLength(0)
    const S = { workouts: two }
    expect(applyMatches(S, res)).toBe(0)
    expect(S.workouts.every(w => !w.fitness)).toBe(true)
  })
  it('a shell that fails or answers garbage returns an error and stores nothing', async () => {
    const bad = await connected(fakeBridge({ readWorkouts: vi.fn().mockRejectedValue(new Error('boom')) }))
    expect(await readBridge({ uid: 'u1', workouts: [workout()], bridge: bad, now: NOW })).toEqual({ status: 'error' })
    const junk = fakeBridge({ readWorkouts: vi.fn().mockResolvedValue({ not: 'an array' }) })
    expect(await readBridge({ uid: 'u1', workouts: [workout()], bridge: junk, now: NOW })).toEqual({ status: 'error' })
    expect(bridgeState('u1').lastSync).toBeNull()
    expect(await readBridge({ uid: 'u1', workouts: [], bridge: null, now: NOW })).toEqual({ status: 'unavailable' })
  })
  it('revocation during a native read discards the result and stays revoked', async () => {
    const b = await connected(fakeBridge({ readWorkouts: vi.fn().mockImplementation(async () => {
      disconnectBridge('u1')
      return [androidSession()]
    }) }))
    const res = await readBridge({ uid: 'u1', workouts: [workout()], bridge: b, now: NOW })
    expect(res).toEqual({ status: 'off' })
    expect(bridgeState('u1').enabled).toBe(false)
    expect(mem.has('health_bridge_v1:u1')).toBe(false)
  })
  it('iOS sessions work the same way and the primary source follows the existing priority', async () => {
    const b = await connected(fakeBridge({ platform: 'ios', readWorkouts: vi.fn().mockResolvedValue([iosSession()]) }))
    const S = { workouts: [{ ...workout(), fitness: { primary: { source: 'whoop', externalId: 'wh', start: h(18), end: h(19), calories: 500, importedAt: 1 }, others: [] } }] }
    const res = await readBridge({ uid: 'u1', workouts: S.workouts, bridge: b, now: NOW })
    applyMatches(S, res)
    expect(fitnessOf(S.workouts[0]).source).toBe('healthkit')           // the phone's health hub leads
    expect(fitnessSources(S.workouts[0]).map(r => r.source)).toEqual(['healthkit', 'whoop'])   // never summed
  })
})

describe('Android Capacitor plugin (TwoJHealth) adapter', () => {
  const plugin = (over = {}) => ({
    isAvailable: vi.fn().mockResolvedValue({ available: true }),
    requestPermissions: vi.fn().mockResolvedValue({ granted: ['workouts', 'heartRate'] }),
    readWorkouts: vi.fn().mockResolvedValue({ sessions: [androidSession()] }), ...over })
  const cap = (extra = {}) => ({ isNativePlatform: () => true, getPlatform: () => 'android', ...extra })

  it('wraps the plugin: the object answer { sessions } becomes the contract’s array; platform is android', async () => {
    const p = plugin()
    const b = getBridge({ Capacitor: cap({ Plugins: { TwoJHealth: p } }) })
    expect(b.platform).toBe('android')
    expect(await b.isAvailable()).toEqual({ available: true })
    expect(await b.requestPermissions()).toEqual({ granted: ['workouts', 'heartRate'] })
    const q = { start: '2026-09-01T00:00:00.000Z', end: '2026-10-01T00:00:00.000Z' }
    const sessions = await b.readWorkouts(q)
    expect(p.readWorkouts).toHaveBeenCalledWith(q)
    expect(Array.isArray(sessions)).toBe(true); expect(recordsFrom(sessions, NOW).records).toHaveLength(1)
    // an array answer (older shell) and a missing field both behave
    expect(await getBridge({ Capacitor: cap({ Plugins: { TwoJHealth: plugin({ readWorkouts: vi.fn().mockResolvedValue([androidSession()]) }) } }) }).readWorkouts({})).toHaveLength(1)
    expect(await getBridge({ Capacitor: cap({ Plugins: { TwoJHealth: plugin({ readWorkouts: vi.fn().mockResolvedValue({}) }) } }) }).readWorkouts({})).toBeUndefined()
  })
  it('a shell that loads the 2J PWA by URL has no Plugins entry: nativePromise is used', async () => {
    const nativePromise = vi.fn(async (name, method) => method === 'readWorkouts' ? { sessions: [androidSession()] } : { available: true })
    const b = getBridge({ Capacitor: cap({ nativePromise, isPluginAvailable: n => n === 'TwoJHealth' }) })
    expect((await b.readWorkouts({ start: 'a', end: 'b' })).length).toBe(1)
    expect(nativePromise).toHaveBeenCalledWith('TwoJHealth', 'readWorkouts', { start: 'a', end: 'b' })
    await b.isAvailable()
    expect(nativePromise).toHaveBeenCalledWith('TwoJHealth', 'isAvailable', {})
  })
  it('plain web (Capacitor stub, not native, or no plugin) is not a bridge', () => {
    expect(getBridge({ Capacitor: { isNativePlatform: () => false, Plugins: { TwoJHealth: plugin() } } })).toBeNull()
    expect(getBridge({ Capacitor: cap({ Plugins: {} }) })).toBeNull()
    expect(getBridge({ Capacitor: cap({ nativePromise: vi.fn(), isPluginAvailable: () => false }) })).toBeNull()
    expect(getBridge({ Capacitor: {} })).toBeNull()
  })
  it('end to end through the adapter: partial grant connects, revoked access reads as denied, nothing is attached', async () => {
    const denied = Object.assign(new Error('Workout access is not granted'), { code: 'permission_denied' })
    const p = plugin()
    const b = getBridge({ Capacitor: cap({ Plugins: { TwoJHealth: p } }) })
    expect(await connectBridge({ uid: 'u1', bridge: b, now: NOW })).toEqual({ status: 'connected', granted: ['workouts', 'heartRate'] })
    p.readWorkouts.mockRejectedValueOnce(denied)
    expect(await readBridge({ uid: 'u1', workouts: [workout()], bridge: b, now: NOW })).toEqual({ status: 'denied' })
    const ok = await readBridge({ uid: 'u1', workouts: [workout()], bridge: b, now: NOW })
    expect(ok.match).toHaveLength(1)
    // workouts denied at the system sheet: the plugin answers the other grants only
    p.requestPermissions.mockResolvedValueOnce({ granted: ['heartRate'] })
    disconnectBridge('u1')
    expect(await connectBridge({ uid: 'u1', bridge: b, now: NOW })).toEqual({ status: 'denied' })
    expect(bridgeState('u1').enabled).toBe(false)
  })
})
