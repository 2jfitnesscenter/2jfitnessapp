import { expect, test, vi } from 'vitest'

// Regression: Workout.jsx passes a 5th argument (onBarChange) so the bar picked in the plate
// calculator is remembered per exercise (S.barByExercise). platesSheet used to take only four
// arguments and dropped it, so the choice vanished as soon as the sheet closed and the next
// session fell back to the Olympic bar.
const opened = vi.hoisted(() => ({ render: null }))
vi.mock('./store/useStore.js', () => ({ useStore: Object.assign(() => null, { getState: () => ({}) }) }))
vi.mock('./store/useUI.js', () => ({
  useUI: { getState: () => ({ openSheet: render => { opened.render = render } }) },
}))

import { platesSheet } from './sheets.jsx'

test('platesSheet forwards onBarChange to the sheet so the picked bar can be remembered', () => {
  const onBarChange = vi.fn()
  platesSheet(60, 'kg', () => {}, 'technique', onBarChange)
  const element = opened.render(() => {})
  expect(element.props.barId).toBe('technique')
  expect(element.props.onBarChange).toBe(onBarChange)
})
