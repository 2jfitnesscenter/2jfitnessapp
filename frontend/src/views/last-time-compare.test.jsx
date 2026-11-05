import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

/* Compare with last time, rendered on the finish summary: off → no comparison card at all (today's screen);
 * on → one line per exercise with a previous session, labelled up / same / down; no previous session → no line. */
vi.mock('../lib/api.js', () => ({
  api: vi.fn(() => Promise.reject(new Error('offline'))),
  IS_APPLE: false, IS_ANDROID: true, BIO: '', VAULT: '', webauthnOK: () => false,
  passkeyRegister: vi.fn(), passkeyLogin: vi.fn(), passkeyRecover: vi.fn(),
}))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn() }))

const set = (w, r) => ({ w, r, done: true, type: 'normal' })
const workout = (id, end, entries) => ({ id, d: '2026-10-0' + (id === 'prev' ? 1 : 5), name: 'Push', routineId: 'r1',
  start: end - 100, end, vol: 1000, prs: [], entries })
const prev = workout('prev', 1000, [{ id: '0025', sets: [set(80, 10)] }, { id: '0294', sets: [set(20, 12)] }])
const now = workout('now', 5000, [{ id: '0025', sets: [set(85, 8)] }, { id: '0294', sets: [set(20, 10)] }, { id: '0046', sets: [set(40, 8)] }])

async function render(compareLastTime) {
  const { default: PostWorkoutSummary } = await import('../components/PostWorkoutSummary.jsx')
  const S = { unit: 'kg', workouts: [prev, now], ...(compareLastTime === undefined ? {} : { compareLastTime }) }
  return renderToStaticMarkup(<MemoryRouter><PostWorkoutSummary w={now} S={S} events={[]} onDone={() => {}} onShare={() => {}} onSeeProgress={() => {}} /></MemoryRouter>)
}

describe('compare with last time on the finish summary', () => {
  it('is off by default: no comparison card and no labels', async () => {
    const html = await render()
    expect(html).not.toContain('Compared with last time')
    expect(html).not.toContain('vs last time')
  })

  it('when on: each exercise with a previous session shows up, same or down; the first-ever exercise shows no label', async () => {
    const html = await render(true)
    expect(html).toContain('Compared with last time')
    expect(html).toMatch(/Up vs last time/)                 // 0025: 85×8 vs 80×10 → load up
    expect(html).toMatch(/Down vs last time/)               // 0294: 20×10 vs 20×12 → reps down
    expect((html.match(/vs last time/g) || []).length).toBe(2)   // 0046 has no previous session: no label
  })

  it('same load and reps reads as same', async () => {
    const same = workout('now', 5000, [{ id: '0025', sets: [set(80, 10)] }])
    const { default: PostWorkoutSummary } = await import('../components/PostWorkoutSummary.jsx')
    const html = renderToStaticMarkup(<MemoryRouter><PostWorkoutSummary w={same} S={{ unit: 'kg', workouts: [prev, same], compareLastTime: true }} events={[]} onDone={() => {}} onShare={() => {}} onSeeProgress={() => {}} /></MemoryRouter>)
    expect(html).toContain('Same as last time')
  })
})
