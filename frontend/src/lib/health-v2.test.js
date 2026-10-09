// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { workoutEnergy, estimateWorkoutEnergy, ENERGY_KIND } from './energy.js'
import { attachFitness } from './fitness.js'
import { connectBridge, connectWrite, writeState, disconnectWrite, exportPayload, exportType, exportWorkout, retryPendingExports, readDailyActivity, dailyActivity,
  isOwnSession, recordsFrom, readBridge, getBridge, bridgeCanWrite, OWN_ID_PREFIX } from './health-bridge.js'

/* Health native bridge V2 — energy by source priority, 2J → Health export, idempotency and
 * de-duplication of what 2J itself wrote, and the day's activity. Fake shell, no OS. */
const NOW = Date.parse('2026-10-02T12:00:00Z')
const H = (hh, mm = 0) => Date.parse(`2026-10-02T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`)
let mem
beforeEach(() => {
  mem = new Map()
  vi.stubGlobal('localStorage', { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) })
})
const sets = (n, rpe = 8) => Array.from({ length: n }, () => ({ w: 60, r: 8, done: true, rpe }))
const workout = (over = {}) => ({ id: 'w1', name: 'Push', d: '2026-10-02', start: H(10), end: H(11), entries: [{ id: 'bench', sets: sets(12) }], ...over })
const S = (over = {}) => ({ unit: 'kg', body: 'male', birthDate: '1990-05-01', bodyweight: [{ d: '2026-09-30', w: 80 }], ...over })
const bridge = (over = {}) => ({ platform: 'android', isAvailable: vi.fn().mockResolvedValue({ available: true }),
  requestPermissions: vi.fn().mockResolvedValue({ granted: ['workouts', 'activeCalories', 'heartRate', 'steps'] }),
  readWorkouts: vi.fn().mockResolvedValue([]),
  requestWritePermissions: vi.fn().mockResolvedValue({ granted: ['writeWorkouts'] }),
  writeWorkout: vi.fn().mockResolvedValue({ written: true }),
  readActivity: vi.fn().mockResolvedValue({ steps: 6400, activeCaloriesKcal: 310 }), ...over })

describe('energy: one number, by source priority, never summed, always labelled', () => {
  it('1. a wearable’s measured figure wins over everything else', () => {
    const w = workout()
    attachFitness(w, { source: 'whoop', origin: 'Run', externalId: 'a', start: w.start, end: w.end, calories: 412, importedAt: 1 })
    const e = workoutEnergy(w, S(), { aggregate: { activeCaloriesKcal: 999 } })
    expect(e).toEqual({ kcal: 412, kind: 'measured', scope: 'active', source: 'whoop', origin: 'Run' })
  })
  it('several sources for one session: the primary figure, never their sum', () => {
    const w = workout()
    attachFitness(w, { source: 'whoop', externalId: 'a', start: w.start, end: w.end, calories: 400, importedAt: 1 })
    attachFitness(w, { source: 'healthconnect', externalId: 'b', start: w.start, end: w.end, calories: 380, importedAt: 1 })
    expect(workoutEnergy(w, S()).kcal).toBe(380)       // the phone's health hub leads (existing priority), 400 is not added
  })
  it('a source without calories (a Bluetooth strap, only heart rate) is not a measured energy', () => {
    const w = workout()
    attachFitness(w, { source: 'ble', kind: 'measured', start: w.start, end: w.end, avgHr: 130, maxHr: 160, importedAt: 1 })
    expect(workoutEnergy(w, S()).kind).not.toBe('measured')
  })
  it('2. else the health store’s aggregate over the interval', () => {
    expect(workoutEnergy(workout(), S(), { aggregate: { activeCaloriesKcal: 287.4 } })).toMatchObject({ kcal: 287, kind: 'aggregate', scope: 'active' })
    expect(workoutEnergy(workout(), S(), { aggregate: { activeCaloriesKcal: 0 } }).kind).toBe('estimated')
    expect(workoutEnergy(workout(), S(), { aggregate: { activeCaloriesKcal: 9e9 } }).kind).toBe('estimated')
  })
  it('3. else 2J’s estimate: a rounded number with a range, labelled estimated', () => {
    const e = workoutEnergy(workout(), S())
    expect(e).toMatchObject({ kind: 'estimated', scope: 'active', basis: 'strength-effort' })
    expect(e.kcal % 5).toBe(0); expect(e.low).toBeLessThan(e.kcal); expect(e.high).toBeGreaterThan(e.kcal)
    expect(e.kcal).toBeGreaterThan(60); expect(e.kcal).toBeLessThan(500)          // an hour of lifting: tens to a few hundred, not thousands
  })
  it('the estimate follows effort, density and type; heart rate replaces the guess when it exists', () => {
    const base = { ...workout(), entries: [{ id: 'x', sets: sets(12, 6) }] }
    const hard = { ...workout(), entries: [{ id: 'x', sets: sets(12, 9) }] }
    expect(estimateWorkoutEnergy(hard, S()).kcal).toBeGreaterThan(estimateWorkoutEnergy(base, S()).kcal)
    const dense = { ...workout({ start: H(10), end: H(10, 30) }), entries: [{ id: 'x', sets: sets(24, 8) }] }
    const sparse = { ...workout({ start: H(10), end: H(12) }), entries: [{ id: 'x', sets: sets(12, 8) }] }
    expect(estimateWorkoutEnergy(dense, S()).kcal / 30).toBeGreaterThan(estimateWorkoutEnergy(sparse, S()).kcal / 120)   // per minute
    const hiit = { ...workout({ start: H(10), end: H(10, 20) }), entries: [], guided: [{ type: 'hiit', bouts: 8 }] }
    expect(estimateWorkoutEnergy(hiit, S())).toMatchObject({ basis: 'guided-hiit' })
    expect(estimateWorkoutEnergy({ ...hiit, guided: [{ type: 'mobility', bouts: 4 }] }, S()).kcal).toBeLessThan(estimateWorkoutEnergy(hiit, S()).kcal)
    const withHr = workout(); attachFitness(withHr, { source: 'ble', kind: 'measured', start: withHr.start, end: withHr.end, avgHr: 128, importedAt: 1 })
    expect(estimateWorkoutEnergy(withHr, S())).toMatchObject({ basis: 'heart-rate' })
  })
  it('says nothing it cannot support: no weight, no duration, no work → null, never a made-up default', () => {
    expect(estimateWorkoutEnergy(workout(), S({ bodyweight: [] }))).toBeNull()
    expect(estimateWorkoutEnergy(workout({ end: H(10) }), S())).toBeNull()
    expect(estimateWorkoutEnergy(workout({ entries: [] }), S())).toBeNull()
    expect(workoutEnergy(workout({ entries: [] }), S({ bodyweight: [] }))).toBeNull()
    expect(estimateWorkoutEnergy(workout(), S({ unit: 'lb', bodyweight: [{ d: '2026-01-01', w: 176 }] })).kcal).toBeCloseTo(estimateWorkoutEnergy(workout(), S()).kcal, -1)   // lb is converted
  })
  it('it is ACTIVE energy: nothing here reads or adds a daily total', () => {
    expect(workoutEnergy(workout(), S()).scope).toBe('active')
    const a = estimateWorkoutEnergy(workout(), S()).kcal
    expect(a).toBeLessThan(80 * 1.2 * 1 * 4)    // far below a basal-inclusive hour (~80 kcal/h resting + work)
  })
})

describe('export: the session, never invented measurements; consent apart from reading', () => {
  it('payload: id with the 2J prefix, type, times — and no energy at all (energy is reconciled later)', () => {
    const p = exportPayload(workout(), S(), NOW)
    expect(p).toMatchObject({ id: OWN_ID_PREFIX + 'w1', version: 1, start: H(10), end: H(11), type: 'strength', title: 'Push' })
    expect(p.estimatedActiveKcal).toBeUndefined()
    expect(Object.keys(p)).not.toContain('activeCaloriesKcal'); expect(Object.keys(p)).not.toContain('calories')
    const measured = workout(); attachFitness(measured, { source: 'whoop', externalId: 'a', start: measured.start, end: measured.end, calories: 400, importedAt: 1 })
    expect(exportPayload(measured, S(), NOW).estimatedActiveKcal).toBeUndefined()      // already measured elsewhere: nothing added
    expect(exportPayload(workout(), S({ bodyweight: [] }), NOW).estimatedActiveKcal).toBeUndefined()
  })
  it('type follows the guided blocks', () => {
    expect(exportType(workout({ guided: [{ type: 'hiit' }] }))).toBe('hiit')
    expect(exportType(workout({ guided: [{ type: 'tabata' }] }))).toBe('hiit')
    expect(exportType(workout({ guided: [{ type: 'mobility' }, { type: 'mobility' }] }))).toBe('mobility')
    expect(exportType(workout({ guided: [{ type: 'mobility' }, { type: 'circuit' }] }))).toBe('strength')
    expect(exportType(workout())).toBe('strength')
  })
  it('what must not be exported: imported logs, too short, in the future, too old, invalid', () => {
    expect(exportPayload(workout({ imported: true }), S(), NOW)).toBeNull()
    expect(exportPayload(workout({ src: 'import' }), S(), NOW)).toBeNull()
    expect(exportPayload(workout({ end: H(10, 0) + 30e3 }), S(), NOW)).toBeNull()
    expect(exportPayload(workout({ start: NOW + 3600e3, end: NOW + 7200e3 }), S(), NOW)).toBeNull()
    expect(exportPayload(workout({ start: NOW - 20 * 86400e3, end: NOW - 20 * 86400e3 + 3600e3 }), S(), NOW)).toBeNull()
    expect(exportPayload(workout({ id: undefined }), S(), NOW)).toBeNull()
    expect(exportPayload(null, S(), NOW)).toBeNull()
  })
  it('write consent is separate from read consent, explicit and revocable', async () => {
    const b = bridge()
    expect(writeState('u1').enabled).toBe(false)
    expect(await exportWorkout({ uid: 'u1', workout: workout(), S: S(), bridge: b, now: NOW })).toEqual({ status: 'off' })
    expect(b.writeWorkout).not.toHaveBeenCalled()
    expect(await connectWrite({ uid: 'u1', bridge: b, now: NOW })).toEqual({ status: 'connected', granted: ['writeWorkouts'] })
    expect(writeState('u1').enabled).toBe(true)
    expect((await readBridge({ uid: 'u1', workouts: [], bridge: b, now: NOW })).status).toBe('off')       // reading was never consented
    await connectBridge({ uid: 'u2', bridge: b, now: NOW })
    expect(writeState('u2').enabled).toBe(false)                                                            // reading does not grant writing
    disconnectWrite('u1'); expect(writeState('u1').enabled).toBe(false)
    expect(await connectWrite({ uid: 'u1', bridge: bridge({ requestWritePermissions: vi.fn().mockResolvedValue({ granted: [] }) }) })).toEqual({ status: 'denied' })
    expect(await connectWrite({ uid: 'u1', bridge: null })).toEqual({ status: 'unavailable' })
    expect(await connectWrite({ uid: 'u1', bridge: { ...bridge(), writeWorkout: undefined } })).toEqual({ status: 'unavailable' })     // an older shell without writing
    expect(bridgeCanWrite(bridge())).toBe(true); expect(bridgeCanWrite({ isAvailable() {} })).toBe(false)
  })
  it('exports once; the same workout again is idempotent (the native side upserts by id) and never throws', async () => {
    const b = bridge()
    await connectWrite({ uid: 'u1', bridge: b, now: NOW })
    const w = workout()
    expect(await exportWorkout({ uid: 'u1', workout: w, S: S(), bridge: b, now: NOW })).toEqual({ status: 'ok', duplicate: false })
    b.writeWorkout.mockResolvedValueOnce({ written: true, duplicate: true })
    expect(await exportWorkout({ uid: 'u1', workout: w, S: S(), bridge: b, now: NOW })).toEqual({ status: 'ok', duplicate: true })
    expect(b.writeWorkout.mock.calls.map(c => c[0].id)).toEqual(['2j:w1', '2j:w1'])
  })
  it('a failed export never breaks anything: it is queued and retried; denial is not retried; skipped ones are dropped', async () => {
    const b = bridge({ writeWorkout: vi.fn().mockRejectedValueOnce(new Error('Health closed')).mockResolvedValue({ written: true }) })
    await connectWrite({ uid: 'u1', bridge: b, now: NOW })
    const w = workout()
    await expect(exportWorkout({ uid: 'u1', workout: w, S: S(), bridge: b, now: NOW })).resolves.toEqual({ status: 'error' })
    expect(JSON.parse(mem.get('health_bridge_pending_v1:u1'))).toEqual(['w1'])
    expect(await retryPendingExports({ uid: 'u1', workouts: [w], S: S(), bridge: b, now: NOW })).toEqual({ retried: 1, ok: 1 })
    expect(JSON.parse(mem.get('health_bridge_pending_v1:u1'))).toEqual([])
    const denied = bridge({ writeWorkout: vi.fn().mockRejectedValue(Object.assign(new Error('x'), { code: 'permission_denied' })) })
    expect(await exportWorkout({ uid: 'u1', workout: workout({ id: 'w2' }), S: S(), bridge: denied, now: NOW })).toEqual({ status: 'denied' })
    expect(JSON.parse(mem.get('health_bridge_pending_v1:u1'))).toEqual([])
    const odd = bridge({ writeWorkout: vi.fn().mockResolvedValue({ nope: 1 }) })
    expect((await exportWorkout({ uid: 'u1', workout: workout({ id: 'w3' }), S: S(), bridge: odd, now: NOW })).status).toBe('error')
    expect(await exportWorkout({ uid: 'u1', workout: workout({ id: 'w4', imported: true }), S: S(), bridge: b, now: NOW })).toEqual({ status: 'skipped' })
  })
})

describe('what 2J wrote must not come back as a second workout', () => {
  const own = { startTime: new Date(H(10)).toISOString(), endTime: new Date(H(11)).toISOString(), exerciseType: 70, metadata: { id: 'hc-own', clientRecordId: '2j:w1', dataOrigin: { packageName: 'com.twojfitnesscenter.app' } }, aggregates: {} }
  const foreign = { startTime: new Date(H(10)).toISOString(), endTime: new Date(H(11)).toISOString(), exerciseType: 70, metadata: { id: 'hc-ext', dataOrigin: { packageName: 'com.whoop.android' } }, aggregates: { activeCaloriesKcal: 300 } }
  it('Android: by client record id or by the writing app', () => {
    expect(isOwnSession(own)).toBe(true)
    expect(isOwnSession({ metadata: { id: 'x', clientRecordId: '2j:other', dataOrigin: { packageName: 'x' } } })).toBe(true)
    expect(isOwnSession({ metadata: { id: 'x', dataOrigin: { packageName: 'com.twojfitnesscenter.app' } } })).toBe(true)
    expect(isOwnSession(foreign)).toBe(false)
  })
  it('iOS: by sync identifier or by the writing bundle', () => {
    expect(isOwnSession({ uuid: 'u', syncIdentifier: '2j:w1' })).toBe(true)
    expect(isOwnSession({ uuid: 'u', sourceRevision: { source: { bundleIdentifier: 'com.twojfitnesscenter.app' } } })).toBe(true)
    expect(isOwnSession({ uuid: 'u', sourceRevision: { source: { bundleIdentifier: 'com.apple.health' } } })).toBe(false)
  })
  it('reading back: own sessions are counted and dropped, others kept; the sync match is unaffected', async () => {
    const r = recordsFrom([own, foreign], NOW)
    expect(r.own).toBe(1); expect(r.records).toHaveLength(1); expect(r.records[0].externalId).toBe('hc-ext')
    const b = bridge({ readWorkouts: vi.fn().mockResolvedValue([own, foreign]) })
    await connectBridge({ uid: 'u1', bridge: b, now: NOW })
    const w = workout()
    const res = await readBridge({ uid: 'u1', workouts: [w], bridge: b, now: NOW })
    expect(res).toMatchObject({ status: 'ok', own: 1, read: 1 }); expect(res.match).toHaveLength(1)
  })
})

describe('daily activity: context only, per permission, never as total expenditure', () => {
  it('reads today’s window with consent; each figure only if its permission was granted', async () => {
    const b = bridge()
    expect(await readDailyActivity({ uid: 'u1', bridge: b, now: NOW })).toEqual({ status: 'off' })
    expect(b.readActivity).not.toHaveBeenCalled()
    await connectBridge({ uid: 'u1', bridge: b, now: NOW })
    const r = await readDailyActivity({ uid: 'u1', bridge: b, now: NOW })
    expect(r).toMatchObject({ status: 'ok', steps: 6400, activeKcal: 310 })
    const q = b.readActivity.mock.calls[0][0]
    expect(Date.parse(q.end)).toBe(NOW); expect(Date.parse(q.start)).toBeLessThanOrEqual(NOW); expect(NOW - Date.parse(q.start)).toBeLessThanOrEqual(24 * 3600e3)
    expect(dailyActivity('u1', NOW)).toMatchObject({ steps: 6400, activeKcal: 310 })
    expect(dailyActivity('u1', NOW + 2 * 86400e3)).toBeNull()                    // never yesterday's number as today's
    // partial grants: calories only
    const partial = bridge({ requestPermissions: vi.fn().mockResolvedValue({ granted: ['workouts', 'activeCalories'] }) })
    await connectBridge({ uid: 'u2', bridge: partial, now: NOW })
    expect(await readDailyActivity({ uid: 'u2', bridge: partial, now: NOW })).toMatchObject({ steps: null, activeKcal: 310 })
  })
  it('absurd values are dropped, failures and revoked access are statuses', async () => {
    const b = bridge({ readActivity: vi.fn().mockResolvedValue({ steps: 9e9, activeCaloriesKcal: -4 }) })
    await connectBridge({ uid: 'u1', bridge: b, now: NOW })
    expect(await readDailyActivity({ uid: 'u1', bridge: b, now: NOW })).toMatchObject({ status: 'ok', steps: null, activeKcal: null })
    b.readActivity.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'permission_denied' }))
    expect(await readDailyActivity({ uid: 'u1', bridge: b, now: NOW })).toEqual({ status: 'denied' })
    b.readActivity.mockRejectedValueOnce(new Error('boom'))
    expect(await readDailyActivity({ uid: 'u1', bridge: b, now: NOW })).toEqual({ status: 'error' })
    expect(await readDailyActivity({ uid: 'u1', bridge: { isAvailable() {} }, now: NOW })).toEqual({ status: 'unavailable' })
  })
  it('the Capacitor adapter exposes the new methods; an old shell simply lacks them', async () => {
    const calls = []
    const nativePromise = vi.fn(async (n, m, o) => { calls.push([m, o]); return m === 'readActivity' ? { steps: 10 } : { written: true } })
    const a = getBridge({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android', nativePromise, isPluginAvailable: () => true } })
    await a.writeWorkout({ id: '2j:x' }); await a.readActivity({ start: 'a', end: 'b' }); await a.requestWritePermissions()
    expect(calls.map(c => c[0])).toEqual(['writeWorkout', 'readActivity', 'requestWritePermissions'])
    expect(bridgeCanWrite(a)).toBe(true)
  })
})
