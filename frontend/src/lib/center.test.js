import { describe, expect, it } from 'vitest'
import { memberStatus, filterMembers, statusCounts, daysBetween } from './center.js'

const TODAY = '2026-10-10'
const d = n => new Date(Date.parse(TODAY + 'T12:00:00Z') - n * 86400000).toISOString().slice(0, 10)
const full = (id, name, extra = {}) => ({ id, name, assigned: true, role: 'member', disabled: false, created: d(300), assignedTrainers: [], workoutCount: 5, lastWorkoutAt: d(1), activeNow: false, ...extra })
const users = [
  full('a', 'Ana', { assignedTrainers: [{ id: 't1', name: 'Coach Uno' }] }),
  full('b', 'Beto', { lastWorkoutAt: d(10), assignedTrainers: [{ id: 't2', name: 'Coach Dos' }] }),
  full('c', 'Cris', { activeNow: true, live: { name: 'Push' }, lastWorkoutAt: d(0) }),
  full('d', 'Dani', { lastWorkoutAt: null, workoutCount: 0, created: d(3) }),
  full('e', 'Edu', { lastWorkoutAt: null, workoutCount: 0, created: d(90) }),
  full('f', 'Fran', { disabled: true }),
  { id: 'g', name: 'Gus', assigned: false, assignedTrainers: [{ id: 't2', name: 'Coach Dos' }] },
]

describe('what a row says about training', () => {
  it('a status per member: training, new, never, idle, disabled, ok — and nothing for a row the viewer cannot open', () => {
    const s = id => memberStatus(users.find(u => u.id === id), TODAY)
    expect(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(s)).toEqual(['ok', 'idle', 'training', 'new', 'never', 'disabled', 'other'])
    expect(memberStatus(users[1], TODAY, 14)).toBe('ok')
    expect(memberStatus(full('x', 'X', { disabled: true, activeNow: true }), TODAY)).toBe('disabled')
  })
  it('sync is not training: a member who synced today with no workouts is never "ok"', () => {
    expect(memberStatus(full('x', 'X', { lastSync: Date.now(), lastWorkoutAt: null, workoutCount: 0 }), TODAY)).toBe('never')
  })
  it('days between two dates ignores the time of day', () => expect(daysBetween('2026-10-01', '2026-10-10T23:59:00Z')).toBe(9))
})

describe('the Members list', () => {
  const ids = f => filterMembers(users, { today: TODAY, ...f }).map(u => u.id)
  it('searches names and trainers, sorted by name', () => {
    expect(ids({})).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g'])
    expect(ids({ q: 'dos' })).toEqual(['b', 'g']); expect(ids({ q: ' ana ' })).toEqual(['a'])
  })
  it('filters by status chip: idle includes never-trained, new and disabled are their own', () => {
    expect(ids({ status: 'idle' })).toEqual(['b', 'e']); expect(ids({ status: 'training' })).toEqual(['c'])
    expect(ids({ status: 'new' })).toEqual(['d']); expect(ids({ status: 'disabled' })).toEqual(['f'])
  })
  it('filters by trainer (one, or none) and by role', () => {
    expect(ids({ trainer: 't2' })).toEqual(['b', 'g']); expect(ids({ trainer: 'none' })).toEqual(['c', 'd', 'e', 'f'])
    const staff = [...users, full('t', 'Tina', { role: 'trainer' })]
    expect(filterMembers(staff, { today: TODAY, role: 'trainer' }).map(u => u.id)).toEqual(['t'])
  })
  it('counts for the chips only count the rows the viewer can open', () => {
    expect(statusCounts(users.filter(u => u.assigned !== false), TODAY)).toEqual({ all: 6, training: 1, idle: 2, new: 1, disabled: 1 })
  })
})
