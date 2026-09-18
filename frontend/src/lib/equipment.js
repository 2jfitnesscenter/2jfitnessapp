// What's actually on the floor at 2J Fitness Center, used to make the weight +/- stepper in a
// workout jump to a number you can really load, instead of a generic step that lands on 57.5 kg
// on a rack that only has dumbbells in 2.5 kg jumps. See Settings → Training for the toggle.

// The dumbbell rack, in order — every value a member can actually pick up. Not evenly spaced
// (1-6 kg by 1, 6-15 kg mixing 2/2.5 kg, 15-40 kg by 2.5) because that is how a real rack is
// filled: finer jumps at the light end, where a 2.5 kg jump is proportionally huge.
export const DUMBBELL_WEIGHTS_2J = [1, 2, 3, 4, 5, 6, 8, 10, 12.5, 15, 17.5, 20, 22.5, 25, 27.5, 30, 32.5, 35, 37.5, 40]
// Selectorised/leverage machines: a flat 5 kg pin step, 5-100 kg — nobody's stack goes lower or
// higher than that at this gym.
export const MACHINE_WEIGHTS_CONFIG = { min: 5, max: 100, step: 5 }
// The plates 2J actually racks, for the informational summary in Settings — the stepper itself
// doesn't walk this list (a barbell jump is a flat 5 kg, 2.5 kg a side, the standard smallest
// pair), it's just what those 5 kg are physically made of.
export const BARBELL_PLATES_2J = [2.5, 5, 10, 15, 20, 25]

// A bar loaded with plates on each side — same total-weight math regardless of which kind of
// bar it is. Kept separate from BARBELL_EQ in views/Workout.jsx, which is only about whether a
// plate-breakdown diagram makes sense (a Smith machine's counterweighted bar doesn't get one;
// it still steps like a barbell here).
const BARBELL_LIKE_EQ = ['barbell', 'olympic barbell', 'ez barbell', 'trap bar', 'smith machine']

// Which of the three stepping rules an exercise's equipment falls under. Everything that isn't
// a dumbbell or a bar is treated as "machine" — cable stacks, leverage machines, kettlebells,
// sleds — the flat 5 kg pin-step is the reasonable default for all of them.
export function equipmentClassOf(eq) {
  if (eq === 'dumbbell') return 'dumbbell'
  if (BARBELL_LIKE_EQ.includes(eq)) return 'barbell'
  return 'machine'
}

// Walks up/down the real dumbbell rack from wherever the current weight happens to be — an
// off-grid value (typed by hand, or carried over from a different exercise) just finds its
// nearest neighbour in the pressed direction, which is also exactly "round to nearest, then
// advance" for a value already on the grid. Sits at the top/bottom of the rack rather than
// wrapping or going negative.
export function stepDumbbell2J(current, dir) {
  const cur = current || 0
  if (dir > 0) {
    const next = DUMBBELL_WEIGHTS_2J.find(w => w > cur + 1e-9)
    return next !== undefined ? next : cur
  }
  for (let i = DUMBBELL_WEIGHTS_2J.length - 1; i >= 0; i--) {
    if (DUMBBELL_WEIGHTS_2J[i] < cur - 1e-9) return DUMBBELL_WEIGHTS_2J[i]
  }
  return cur
}

// A machine's pin only lives inside its stack — below the 5 kg floor there is nothing lighter
// to select, and stepping up from empty (0, an unset set) lands on the floor rather than
// skipping straight to 10.
export function stepMachine2J(current, dir) {
  const { min, max, step } = MACHINE_WEIGHTS_CONFIG
  const cur = current || 0
  if (dir > 0) return cur < min ? min : Math.min(max, cur + step)
  return cur <= min ? cur : Math.max(min, cur - step)
}

// A flat step, floored at 0 — same shape as the app's other steppers (Workout.jsx's own
// generic `bump`), used for barbell (always, per the gym's plate math) and for every equipment
// class once 2J Room Equipment mode is off and a member's own custom increment applies instead.
export function stepFlat(current, dir, step) {
  return Math.max(0, Math.round(((current || 0) + dir * step) * 100) / 100)
}

// The one function Workout.jsx's weight stepper actually calls — dispatches to the right rule
// for this exercise's equipment, reading the two settings from Settings → Training
// (use2JRoomEquipment, customIncrements) off the profile passed in.
export function stepWeight(S, eq, current, dir) {
  const cls = equipmentClassOf(eq)
  if (S.use2JRoomEquipment !== false) {
    if (cls === 'dumbbell') return stepDumbbell2J(current, dir)
    if (cls === 'machine') return stepMachine2J(current, dir)
    return stepFlat(current, dir, 5)   // barbell: 5 kg a jump, 2.5 kg a side, regardless of mode
  }
  const inc = S.customIncrements || { barbell: 5, dumbbell: 2, machineOther: 5 }
  const step = cls === 'dumbbell' ? inc.dumbbell : cls === 'barbell' ? inc.barbell : inc.machineOther
  return stepFlat(current, dir, step)
}
