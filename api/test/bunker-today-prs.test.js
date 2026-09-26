import test from 'node:test'
import assert from 'node:assert/strict'
import { publicTodayPrs } from '../bunker/today-prs.js'

const today = '2026-09-22'
const states = {
  u1: { workouts: [
    { id: 'old', d: '2026-09-20', start: 1, prs: [], entries: [{ id: 'bench', sets: [{ w: 100, r: 3, done: true }] }] },
    { id: 'new', d: today, start: 2, prs: ['bench'], entries: [{ id: 'bench', sets: [{ w: 105, r: 3, done: true }] }] },
  ] },
  u2: { workouts: [{ id: 'ordinary', d: today, start: 3, prs: [], entries: [{ id: 'squat', sets: [{ w: 120, r: 5, done: true }] }] }] },
}
const wall = [
  { id: 'public-pr', authorId: 'u1', authorName: 'Juanjo', exId: 'bench', exName: 'Press banca', mode: 'reps', value: { w: 105, r: 3 }, sourceDate: today, public: true, createdAt: 4 },
  { id: 'private-pr', authorId: 'u1', authorName: 'Juanjo', exId: 'bench', exName: 'Press banca', mode: 'reps', value: { w: 105, r: 3 }, sourceDate: today, public: false, createdAt: 5 },
  { id: 'not-a-pr', authorId: 'u2', authorName: 'Sara', exId: 'squat', exName: 'Sentadilla', mode: 'reps', value: { w: 120, r: 5 }, sourceDate: today, public: true, createdAt: 6 },
  { id: 'yesterday', authorId: 'u1', authorName: 'Juanjo', exId: 'bench', exName: 'Press banca', mode: 'reps', value: { w: 100, r: 3 }, sourceDate: '2026-09-21', public: true, createdAt: 7 },
]

test('Bunker Live exposes only explicitly public PRs from today', () => {
  const prs = publicTodayPrs({ wall, today, readState: uid => states[uid] })
  assert.deepEqual(prs.map(p => p.id), ['public-pr'])
  assert.equal(prs[0].delta, 5)
  assert.equal(prs[0].authorName, 'Juanjo')
})

test('Bunker Live has a safe empty state when no public PR qualifies', () => {
  assert.deepEqual(publicTodayPrs({ wall: wall.map(p => ({ ...p, public: false })), today, readState: uid => states[uid] }), [])
})

test('missing member state never exposes a public wall entry by itself', () => {
  assert.deepEqual(publicTodayPrs({ wall: [wall[0]], today, readState: () => null }), [])
})

test('a different PR for the same exercise and day cannot validate a wall value', () => {
  const wrongValue = { ...wall[0], value: { w: 999, r: 3 } }
  assert.deepEqual(publicTodayPrs({ wall: [wrongValue], today, readState: uid => states[uid] }), [])
})
