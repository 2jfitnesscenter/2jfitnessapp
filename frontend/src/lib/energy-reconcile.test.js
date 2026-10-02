// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { decideEnergy, scheduleEnergy, energyQueue, reconcileEnergy, applyEnergyChanges, hasMeasured, runEnergyReconcile, GRACE_MS, WATCH_MS, estimateId } from './energy-reconcile.js'
import { connectBridge, connectWrite, writeState } from './health-bridge.js'
import { attachFitness, fitnessSources, fitnessOf } from './fitness.js'
import { workoutEnergy } from './energy.js'

/* Energy reconciliation: grace period, never twice, estimate only if the store still has none,
 * replaced (only 2J's own) when a better source arrives, resilient, transitional queue. */
const T0 = Date.parse('2026-10-02T11:00:00Z')            // the workout ended at T0
let mem
beforeEach(() => {
  mem = new Map()
  vi.stubGlobal('localStorage', { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) })
})
const sets = n => Array.from({ length: n }, () => ({ w: 60, r: 8, done: true, rpe: 8 }))
const workout = (over = {}) => ({ id: 'w1', name: 'Push', start: T0 - 3600e3, end: T0, entries: [{ id: 'bench', sets: sets(12) }], ...over })
const S = () => ({ unit: 'kg', body: 'male', birthDate: '1990-05-01', bodyweight: [{ d: '2026-09-30', w: 80 }] })
const external = (kcal = 300) => ({ external: { kcal, origins: ['com.whoop.android'] }, ownEstimate: false, emptyConfirmed: true })
const bridge = (over = {}) => ({ platform: 'android', isAvailable: vi.fn().mockResolvedValue({ available: true }),
  requestPermissions: vi.fn().mockResolvedValue({ granted: ['workouts', 'activeCalories'] }),
  requestWritePermissions: vi.fn().mockResolvedValue({ granted: ['writeWorkouts', 'writeActiveCalories'] }),
  readWorkouts: vi.fn().mockResolvedValue([]), writeWorkout: vi.fn().mockResolvedValue({ written: true }),
  readEnergy: vi.fn().mockResolvedValue({ external: null, ownEstimate: false, emptyConfirmed: true }),
  writeEstimatedEnergy: vi.fn().mockResolvedValue({ written: true }), deleteEstimatedEnergy: vi.fn().mockResolvedValue({ deleted: true }), ...over })
const setup = async (b = bridge(), { write = true } = {}) => {
  await connectBridge({ uid: 'u1', bridge: b, now: T0 })
  if (write) await connectWrite({ uid: 'u1', bridge: b, now: T0 })
  return b
}

describe('the decision (pure)', () => {
  const base = { now: T0 + GRACE_MS + 1, entry: { at: T0, phase: 'waiting' }, measured: false, external: null, ownEstimate: false, estimate: { kcal: 250 }, canWriteEnergy: true }
  it('a measured figure on the workout wins; any external energy next; neither writes anything', () => {
    expect(decideEnergy({ ...base, measured: true })).toEqual({ action: 'measured', deleteOwn: false })
    expect(decideEnergy({ ...base, external: { kcal: 300 } })).toEqual({ action: 'external', deleteOwn: false })
    expect(decideEnergy({ ...base, now: T0 + 1000, external: { kcal: 300 } }).action).toBe('external')     // no need to wait for the grace period
    expect(decideEnergy({ ...base, external: { kcal: 0.5 } }).action).toBe('external')                                   // ANY external energy blocks the estimate: no coverage threshold
    expect(decideEnergy({ ...base, external: { kcal: 0 } }).action).toBe('write')
  })
  it('nothing yet: wait for the grace period; after it, write the estimate once', () => {
    expect(decideEnergy({ ...base, now: T0 + GRACE_MS - 1 })).toEqual({ action: 'wait', deleteOwn: false })
    expect(decideEnergy(base)).toEqual({ action: 'write', deleteOwn: false })
    expect(decideEnergy({ ...base, entry: { at: T0, phase: 'estimated' } })).toEqual({ action: 'keep', deleteOwn: false })   // already written: idempotent
    expect(decideEnergy({ ...base, ownEstimate: true })).toEqual({ action: 'keep', deleteOwn: false })
  })
  it('where an empty read cannot be told from "not allowed" (iOS) nothing is ever written, but a source is still picked up', () => {
    expect(decideEnergy({ ...base, emptyConfirmed: false })).toEqual({ action: 'unverified', deleteOwn: false })
    expect(decideEnergy({ ...base, emptyConfirmed: false, external: { kcal: 120 } }).action).toBe('external')
  })
  it('without permission to write energy, or without an estimate, nothing is written', () => {
    expect(decideEnergy({ ...base, canWriteEnergy: false }).action).toBe('none')
    expect(decideEnergy({ ...base, estimate: null }).action).toBe('none')
    expect(decideEnergy({ ...base, estimate: { kcal: 0 } }).action).toBe('none')
  })
  it('a better source after the estimate: delete ONLY 2J’s estimate', () => {
    expect(decideEnergy({ ...base, entry: { at: T0, phase: 'estimated' }, external: { kcal: 300 } })).toEqual({ action: 'external', deleteOwn: true })
    expect(decideEnergy({ ...base, ownEstimate: true, measured: true })).toEqual({ action: 'measured', deleteOwn: true })
  })
})

describe('policy end to end', () => {
  it('queues only with consent, once, and never for imports or empty workouts', async () => {
    expect(scheduleEnergy({ uid: 'u1', workout: workout(), now: T0 })).toBe(false)           // no consent: nothing is queued
    const b = await setup()
    expect(scheduleEnergy({ uid: 'u1', workout: workout(), now: T0 })).toBe(true)
    expect(scheduleEnergy({ uid: 'u1', workout: workout(), now: T0 + 5 })).toBe(true)
    expect(Object.keys(energyQueue('u1'))).toEqual(['w1']); expect(energyQueue('u1').w1.at).toBe(T0)
    expect(scheduleEnergy({ uid: 'u1', workout: workout({ id: 'w2', imported: true }), now: T0 })).toBe(false)
    expect(scheduleEnergy({ uid: 'u1', workout: workout({ id: 'w3', end: T0 - 3600e3 }), now: T0 })).toBe(false)
    expect(scheduleEnergy({ workout: workout() })).toBe(false)
    void b
  })
  it('too early: nothing is written and the entry stays', async () => {
    const b = await setup(); const w = workout()
    scheduleEnergy({ uid: 'u1', workout: w, now: T0 })
    const r = await reconcileEnergy({ uid: 'u1', workouts: [w], S: S(), bridge: b, now: T0 + 5 * 60e3 })
    expect(r.changes).toEqual([]); expect(b.writeEstimatedEnergy).not.toHaveBeenCalled(); expect(energyQueue('u1').w1).toBeTruthy()
  })
  it('external energy is already there: it is used locally, 2J writes no second sample', async () => {
    const b = await setup(bridge({ readEnergy: vi.fn().mockResolvedValue(external(312.4)) })); const w = workout()
    scheduleEnergy({ uid: 'u1', workout: w, now: T0 })
    const r = await reconcileEnergy({ uid: 'u1', workouts: [w], S: S(), bridge: b, now: T0 + 60e3 })
    expect(b.writeEstimatedEnergy).not.toHaveBeenCalled(); expect(b.deleteEstimatedEnergy).not.toHaveBeenCalled()
    expect(r.changes).toHaveLength(1)
    const S2 = { workouts: [w] }; applyEnergyChanges(S2, r.changes)
    expect(fitnessOf(w)).toMatchObject({ source: 'healthconnect', energyKind: 'aggregated', calories: 312, origin: 'com.whoop.android' })
    expect(workoutEnergy(w, S())).toMatchObject({ kcal: 312, kind: 'aggregate' })
    expect(energyQueue('u1').w1).toBeUndefined()                                  // resolved: the queue entry is gone
  })
  it('nothing after the grace period: the estimate is written once, as an ESTIMATE, and recorded as such', async () => {
    const b = await setup(); const w = workout()
    scheduleEnergy({ uid: 'u1', workout: w, now: T0 })
    const r = await reconcileEnergy({ uid: 'u1', workouts: [w], S: S(), bridge: b, now: T0 + GRACE_MS + 1 })
    expect(b.writeEstimatedEnergy).toHaveBeenCalledTimes(1)
    const call = b.writeEstimatedEnergy.mock.calls[0][0]
    expect(call).toMatchObject({ id: estimateId('w1'), version: 1, start: w.start, end: w.end }); expect(call.kcal % 5).toBe(0)
    applyEnergyChanges({ workouts: [w] }, r.changes)
    expect(fitnessOf(w)).toMatchObject({ source: 'twoj', energyKind: 'estimated', kind: 'estimated', calories: call.kcal })
    expect(workoutEnergy(w, S())).toMatchObject({ kind: 'estimated', kcal: call.kcal })
    expect(energyQueue('u1').w1.phase).toBe('estimated')
    // reopening: idempotent — no second write
    await reconcileEnergy({ uid: 'u1', workouts: [w], S: S(), bridge: b, now: T0 + 2 * GRACE_MS })
    expect(b.writeEstimatedEnergy).toHaveBeenCalledTimes(1)
  })
  it('iOS-style store (empty read is unverifiable): never writes, keeps the estimate as ESTIMATED inside 2J, still picks up a source later', async () => {
    const b = await setup(bridge({ platform: 'ios', readEnergy: vi.fn().mockResolvedValue({ external: null, ownEstimate: false, emptyConfirmed: false }) }))
    const w = workout()
    scheduleEnergy({ uid: 'u1', workout: w, now: T0 })
    const r = await reconcileEnergy({ uid: 'u1', workouts: [w], S: S(), bridge: b, now: T0 + GRACE_MS + 1 })
    expect(b.writeEstimatedEnergy).not.toHaveBeenCalled(); expect(r.changes).toEqual([])
    expect(energyQueue('u1').w1).toBeTruthy()                                       // still watched
    expect(workoutEnergy(w, S())).toMatchObject({ kind: 'estimated' })              // visible in 2J, labelled
    b.readEnergy.mockResolvedValue({ external: { kcal: 210, origins: ['com.apple.health'] }, ownEstimate: false, emptyConfirmed: false })
    const r2 = await reconcileEnergy({ uid: 'u1', workouts: [w], S: S(), bridge: b, now: T0 + 2 * GRACE_MS })
    expect(r2.changes[0]).toMatchObject({ op: 'attach', rec: { energyKind: 'aggregated', calories: 210 } })
    expect(b.writeEstimatedEnergy).not.toHaveBeenCalled()
  })
  it('the wearable syncs late: the next open replaces the estimate — 2J deletes only its own and keeps the external figure', async () => {
    const b = await setup(); const w = workout()
    scheduleEnergy({ uid: 'u1', workout: w, now: T0 })
    applyEnergyChanges({ workouts: [w] }, (await reconcileEnergy({ uid: 'u1', workouts: [w], S: S(), bridge: b, now: T0 + GRACE_MS + 1 })).changes)
    expect(fitnessOf(w).source).toBe('twoj')
    b.readEnergy.mockResolvedValue(external(340))
    const r = await reconcileEnergy({ uid: 'u1', workouts: [w], S: S(), bridge: b, now: T0 + 3 * 3600e3 })
    expect(b.deleteEstimatedEnergy).toHaveBeenCalledTimes(1); expect(b.deleteEstimatedEnergy).toHaveBeenCalledWith({ id: estimateId('w1') })
    applyEnergyChanges({ workouts: [w] }, r.changes)
    expect(fitnessSources(w).map(x => x.source)).toEqual(['healthconnect'])      // the estimate is gone from the workout too
    expect(fitnessOf(w)).toMatchObject({ energyKind: 'aggregated', calories: 340 })
    expect(b.writeEstimatedEnergy).toHaveBeenCalledTimes(1)                        // external value was never written back
    expect(energyQueue('u1').w1).toBeUndefined()
  })
  it('a measured session matched to the workout later also retires the estimate', async () => {
    const b = await setup(); const w = workout()
    scheduleEnergy({ uid: 'u1', workout: w, now: T0 })
    applyEnergyChanges({ workouts: [w] }, (await reconcileEnergy({ uid: 'u1', workouts: [w], S: S(), bridge: b, now: T0 + GRACE_MS + 1 })).changes)
    attachFitness(w, { source: 'whoop', externalId: 's', start: w.start, end: w.end, calories: 410, importedAt: 1 })
    expect(hasMeasured(w)).toBe(true)
    const r = await reconcileEnergy({ uid: 'u1', workouts: [w], S: S(), bridge: b, now: T0 + 4 * 3600e3 })
    applyEnergyChanges({ workouts: [w] }, r.changes)
    expect(b.deleteEstimatedEnergy).toHaveBeenCalledTimes(1)
    expect(workoutEnergy(w, S())).toMatchObject({ kcal: 410, kind: 'measured', source: 'whoop' })
    expect(fitnessSources(w).some(x => x.source === 'twoj')).toBe(false)
  })
  it('the estimate is never written without the energy-write consent, and a wearable figure stays the one shown', async () => {
    const b = await setup(bridge({ requestWritePermissions: vi.fn().mockResolvedValue({ granted: ['writeWorkouts'] }) })); const w = workout()
    expect(writeState('u1')).toMatchObject({ enabled: true, energy: false })
    scheduleEnergy({ uid: 'u1', workout: w, now: T0 })
    const r = await reconcileEnergy({ uid: 'u1', workouts: [w], S: S(), bridge: b, now: T0 + GRACE_MS + 1 })
    expect(b.writeEstimatedEnergy).not.toHaveBeenCalled(); expect(r.changes).toEqual([])
    expect(energyQueue('u1').w1).toBeUndefined()                                  // resolved without writing
  })
  it('never writes an estimate with write consent alone when external-energy read consent is absent', async () => {
    const b = bridge({
      requestPermissions: vi.fn().mockResolvedValue({ granted: ['workouts'] }),
      requestWritePermissions: vi.fn().mockResolvedValue({ granted: ['writeWorkouts', 'writeActiveCalories'] }),
    })
    await setup(b)
    const w = workout()
    scheduleEnergy({ uid: 'u1', workout: w, now: T0 })
    const r = await reconcileEnergy({ uid: 'u1', workouts: [w], S: S(), bridge: b, now: T0 + GRACE_MS + 1 })
    expect(r.changes).toEqual([])
    expect(b.readEnergy).not.toHaveBeenCalled()
    expect(b.writeEstimatedEnergy).not.toHaveBeenCalled()
    expect(energyQueue('u1').w1).toMatchObject({ phase: 'waiting' }) // retry after explicit read permission
  })
  it('read-only users still get the external total locally; no write consent is needed for that', async () => {
    const b = await setup(bridge({ readEnergy: vi.fn().mockResolvedValue(external(280)) }), { write: false }); const w = workout()
    expect(scheduleEnergy({ uid: 'u1', workout: w, now: T0 })).toBe(true)        // reading consent is enough to queue
    const r = await reconcileEnergy({ uid: 'u1', workouts: [w], S: S(), bridge: b, now: T0 + 60e3 })
    expect(r.changes).toHaveLength(1); expect(b.writeEstimatedEnergy).not.toHaveBeenCalled()
  })
  it('store says refused (external appeared while writing): nothing is recorded, decided again next time', async () => {
    const b = await setup(bridge({ writeEstimatedEnergy: vi.fn().mockRejectedValue(Object.assign(new Error('x'), { code: 'external_available' })) })); const w = workout()
    scheduleEnergy({ uid: 'u1', workout: w, now: T0 })
    const r = await reconcileEnergy({ uid: 'u1', workouts: [w], S: S(), bridge: b, now: T0 + GRACE_MS + 1 })
    expect(r.changes).toEqual([]); expect(energyQueue('u1').w1.phase).toBe('waiting')
  })
  it('native failures never throw and never touch the workout; entries expire after a week or when the workout is gone', async () => {
    const boom = bridge({ readEnergy: vi.fn().mockRejectedValue(new Error('Health closed')) }); const b = await setup(boom); const w = workout()
    scheduleEnergy({ uid: 'u1', workout: w, now: T0 })
    await expect(reconcileEnergy({ uid: 'u1', workouts: [w], S: S(), bridge: b, now: T0 + GRACE_MS + 1 })).resolves.toMatchObject({ changes: [] })
    expect(energyQueue('u1').w1).toBeTruthy()
    await reconcileEnergy({ uid: 'u1', workouts: [w], S: S(), bridge: b, now: T0 + WATCH_MS + 1 })
    expect(energyQueue('u1').w1).toBeUndefined()
    scheduleEnergy({ uid: 'u1', workout: w, now: T0 })
    await reconcileEnergy({ uid: 'u1', workouts: [], S: S(), bridge: b, now: T0 + 1 })
    expect(energyQueue('u1').w1).toBeUndefined()
    await expect(reconcileEnergy({ uid: 'u1', workouts: [w], S: S(), bridge: null })).resolves.toEqual({ changes: [], checked: 0 })
    await expect(reconcileEnergy({})).resolves.toEqual({ changes: [], checked: 0 })
  })
  it('the live runner applies outcomes to the store and survives a broken one', async () => {
    const b = await setup(bridge({ readEnergy: vi.fn().mockResolvedValue(external(290)) })); const w = workout()
    scheduleEnergy({ uid: 'u1', workout: w, now: T0 })
    const state = { user: { id: 'u1' }, S: { workouts: [w] } }
    const update = vi.fn(fn => fn(state.S))
    const r = await runEnergyReconcile({ getState: () => state, update, bridge: b, now: T0 + 60e3 })
    expect(r.changes).toHaveLength(1); expect(update).toHaveBeenCalledTimes(1); expect(fitnessOf(w).calories).toBe(290)
    expect(await runEnergyReconcile({ getState: () => { throw new Error('x') }, update, bridge: b })).toEqual({ changes: [], checked: 0 })
  })
})
