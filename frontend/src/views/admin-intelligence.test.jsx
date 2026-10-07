import { expect, test, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AdminIntelligence } from './Admin.jsx'

vi.mock('../store/useStore.js', () => ({ useStore: () => ({}) }))

test('admin insight stays compact and labels automatic advice separately from trainer action', () => {
  // These sessions were recent when the test was introduced, but the insight intentionally
  // expires older evidence. Freeze the clock so the UI contract does not age out in real time.
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-28T12:00:00Z'))
  const detail = { user: { id: 'member' }, workouts: [
    { d: '2026-09-27', entries: [{ id: '0025', target: { targetRepsMin: 8, targetRepsMax: 10 }, sets: [{ w: 80, r: 5, feel: 'fail', rpe: 10, done: true }] }] },
    { d: '2026-09-21', entries: [{ id: '0025', target: { targetRepsMin: 8, targetRepsMax: 10 }, sets: [{ w: 80, r: 5, feel: 'fail', rpe: 10, done: true }] }] },
  ] }
  try {
    const html = renderToStaticMarkup(<AdminIntelligence detail={detail} />)
    expect(html).toContain('class="intelligence-today compact"')
    expect(html).toContain('class="intelligence-card"')
    expect(html).toMatch(/class="intelligence-type">[^<]+ · [^<]+<\/div>/)
    expect(html).toContain('class="intelligence-actions"')
    expect(html).toContain('class="btn primary"')
    expect(html).not.toMatch(/health|community|diagnosis/i)
  } finally {
    vi.useRealTimers()
  }
})
