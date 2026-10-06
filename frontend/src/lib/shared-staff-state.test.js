import { describe, expect, it } from 'vitest'
import { isolateSharedUser, SHARED_STATE_OWNER_KEY } from './shared-staff-state.js'

function storageOf(seed = {}) {
  const data = new Map(Object.entries(seed))
  return {
    getItem: key => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key),
    has: key => data.has(key)
  }
}
const defaults = { active: null, routines: [], workouts: [], health: null }

describe('shared staff local state isolation', () => {
  it('locks one trainer, hides their active workout from another and restores only for the same uid', () => {
    const storage = storageOf({ [SHARED_STATE_OWNER_KEY]: 'trainer-a', gym_dirty: '1', gym_pending_workout_delete: '["w-a"]' })
    const a = { id: 'trainer-a', authLevel: 'pin' }
    const workA = { ...defaults, routines: [{ id: 'routine-a' }], active: { id: 'active-a', entries: [] }, workouts: [{ id: 'old-a' }] }

    const locked = isolateSharedUser(storage, { currentUser: a, nextUser: null, state: workA, defaultState: defaults, preserveActive: true })
    expect(locked).toEqual(defaults)
    expect(storage.getItem('gym_shared_active_state:trainer-a')).toContain('active-a')
    expect(storage.getItem('gym_shared_gym_dirty:trainer-a')).toBe('1')
    expect(storage.getItem('gym_dirty')).toBeNull()

    const b = isolateSharedUser(storage, { currentUser: null, nextUser: { id: 'trainer-b', authLevel: 'pin' }, state: locked, defaultState: defaults })
    expect(b).toEqual(defaults)
    expect(JSON.stringify(b)).not.toContain('trainer-a')
    expect(storage.getItem('gym_dirty')).toBeNull()

    const bLocked = isolateSharedUser(storage, { currentUser: { id: 'trainer-b', authLevel: 'pin' }, nextUser: null, state: { ...defaults, active: { id: 'active-b' } }, defaultState: defaults, preserveActive: true })
    expect(bLocked).toEqual(defaults)
    const aRestored = isolateSharedUser(storage, { currentUser: null, nextUser: { id: 'trainer-a', authLevel: 'pin' }, state: bLocked, defaultState: defaults })
    expect(aRestored.active.id).toBe('active-a')
    expect(aRestored.routines).toEqual([])
    expect(storage.getItem('gym_dirty')).toBe('1')
    expect(storage.getItem('gym_pending_workout_delete')).toBe('["w-a"]')
    expect(storage.getItem('gym_shared_active_state:trainer-a')).toBeNull()
  })

  it('a direct identity switch stores the old active session and starts the new identity clean', () => {
    const storage = storageOf({ [SHARED_STATE_OWNER_KEY]: 'trainer-a' })
    const next = isolateSharedUser(storage, {
      currentUser: { id: 'trainer-a', authLevel: 'pin' },
      nextUser: { id: 'trainer-b', authLevel: 'pin' },
      state: { ...defaults, routines: [{ id: 'a' }], active: { id: 'active-a' } },
      defaultState: defaults
    })
    expect(next).toEqual(defaults)
    expect(storage.getItem('gym_shared_active_state:trainer-a')).toContain('active-a')
  })

  it('ignores malformed cached workout snapshots', () => {
    const storage = storageOf({ 'gym_shared_active_state:trainer-a': '{broken' })
    const next = isolateSharedUser(storage, { currentUser: null, nextUser: { id: 'trainer-a', authLevel: 'pin' }, state: { ...defaults, workouts: [{ id: 'guest' }] }, defaultState: defaults })
    expect(next).toEqual(defaults)
  })

  it('restores the same user’s active workout after passkey reauthentication, never another identity', () => {
    const storage = storageOf({ 'gym_shared_active_state:trainer-a': JSON.stringify({ id: 'active-a' }) })
    const restored = isolateSharedUser(storage, {
      currentUser: null,
      nextUser: { id: 'trainer-a', authLevel: 'passkey' },
      state: { ...defaults, workouts: [{ id: 'guest' }] },
      defaultState: defaults
    })
    expect(restored.active.id).toBe('active-a')
    expect(restored.workouts).toEqual([])
    expect(storage.getItem('gym_shared_active_state:trainer-a')).toBeNull()

    const other = isolateSharedUser(storage, {
      currentUser: null,
      nextUser: { id: 'trainer-b', authLevel: 'passkey' },
      state: { ...defaults, active: { id: 'active-a' } },
      defaultState: defaults
    })
    expect(other).toEqual(defaults)
  })
})
