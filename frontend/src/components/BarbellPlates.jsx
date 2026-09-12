// A compact plate-loading diagram for a straight barbell: given a set's total weight, works out
// what actually goes on each side of a standard 20kg/45lb bar and draws it. Hand-drawn SVG, same
// convention as RecoveryRing/LineChart — no charting library. Only meaningful for a real barbell
// (see Workout.jsx's BARBELL_EQ) — an EZ bar, Smith machine or trap bar all load plates too, but
// none of them has an unambiguous standard bar weight, so this stays out of scope for those.
const BAR_WEIGHT = { kg: 20, lb: 45 }
// Colours follow the common competition plate code (25 red / 20 blue / 15 yellow / 10 green /
// 5 white / 2.5 black / 1.25 chrome) so a lifter recognises a plate by colour, not just size.
const KG_PLATES = [
  { w: 25, color: '#e5484d' }, { w: 20, color: '#3b82f6' }, { w: 15, color: '#eab308' },
  { w: 10, color: '#22c55e' }, { w: 5, color: '#f4f4f5' }, { w: 2.5, color: '#18181b' },
  { w: 1.25, color: '#a1a1aa' },
]
const LB_PLATES = [
  { w: 45, color: '#3b82f6' }, { w: 35, color: '#eab308' }, { w: 25, color: '#22c55e' },
  { w: 10, color: '#f4f4f5' }, { w: 5, color: '#18181b' }, { w: 2.5, color: '#a1a1aa' },
]

// Greedy breakdown of one side's load — biggest plate first, same order they actually go on
// (heaviest against the collar, lightest on the outside).
function plateStack(perSide, unit) {
  const plates = unit === 'lb' ? LB_PLATES : KG_PLATES
  const stack = []
  let left = perSide
  const eps = 0.01
  for (const p of plates) {
    while (left >= p.w - eps) { stack.push(p); left -= p.w }
  }
  return stack
}

export default function BarbellPlates({ weight, unit }) {
  const barW = BAR_WEIGHT[unit === 'lb' ? 'lb' : 'kg']
  const perSide = (weight - barW) / 2
  if (!(perSide > 0)) return null
  const stack = plateStack(perSide, unit)
  if (!stack.length) return null

  // A very heavy load would otherwise blow out the row's width — clip the drawing rather than
  // squeeze it unreadable; the number in the stepper next to it is still the source of truth.
  const shown = stack.slice(0, 5)
  const biggest = unit === 'lb' ? 45 : 25
  const cx = 48, barY = 16, plateW = 4, gap = 1.5

  const side = dir => shown.map((p, i) => {
    const h = 10 + 12 * (p.w / biggest)
    const x = cx + dir * (7 + i * (plateW + gap)) - plateW / 2
    return <rect key={i} x={x} y={barY - h / 2} width={plateW} height={h} rx={1}
      fill={p.color} stroke="var(--sep)" strokeWidth="0.5" />
  })

  return (
    <svg viewBox="0 0 96 32" width="44" height="15" aria-hidden="true">
      <line x1="4" y1={barY} x2="92" y2={barY} stroke="var(--label-3)" strokeWidth="2" />
      {side(-1)}
      {side(1)}
    </svg>
  )
}
