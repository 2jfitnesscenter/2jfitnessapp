// A plate-loading breakdown for a straight barbell: given a set's total weight, works out what
// actually goes on each side. Shown only on tap (Workout.jsx's plate button, and Settings' own
// standalone entry, both open sheets.jsx's platesSheet with this at `size="lg"`) rather than as
// an inline row icon — at row size the drawing read as noise more than information. Hand-drawn
// SVG, same convention as RecoveryRing/LineChart — no charting library.
const BAR_WEIGHT = { kg: 20, lb: 45 }
// Every bar type the calculator's picker offers (platesSheet) — `kg` is what actually feeds
// plateBreakdown; a lb profile just keeps the single BAR_WEIGHT.lb default below, since none of
// these has an established pound-plate convention worth inventing. Two of these (smith and
// shortOlympic) land on the same 15kg — kept as separate entries because a lifter picks by what
// the bar in front of them is *called*, not by its number.
export const BARBELL_TYPES = [
  { id: 'olympic', label: 'Olympic bar (20kg)', kg: 20 },
  { id: 'technique', label: 'Technique bar (10kg)', kg: 10 },
  { id: 'smith', label: 'Smith / multipower (15kg)', kg: 15 },
  { id: 'shortOlympic', label: 'Short olympic bar (15kg)', kg: 15 },
  { id: 'zBar', label: 'Z-bar (8kg)', kg: 8 },
  { id: 'roman', label: 'Roman bar (10kg)', kg: 10 },
  { id: 'swiss', label: 'Swiss bar (10kg)', kg: 10 },
  { id: 'safety', label: 'Safety bar (32kg)', kg: 32 },
  { id: 'none', label: 'No bar / machine (0kg)', kg: 0 },
]
// Official IWF competition plate colours — 25 red / 20 blue / 15 yellow / 10 green / 5 white /
// 2.5 chrome — so a lifter recognises a plate by colour, not just size. 2.5kg is a metallic
// silver rather than black: on a real rack the small plates are chrome, not painted.
const KG_PLATES = [
  { w: 25, color: '#e5484d' }, { w: 20, color: '#3b82f6' }, { w: 15, color: '#eab308' },
  { w: 10, color: '#22c55e' }, { w: 5, color: '#f4f4f5' }, { w: 2.5, color: '#c7c7cc' },
]
const LB_PLATES = [
  { w: 45, color: '#3b82f6' }, { w: 35, color: '#eab308' }, { w: 25, color: '#22c55e' },
  { w: 10, color: '#f4f4f5' }, { w: 5, color: '#18181b' }, { w: 2.5, color: '#c7c7cc' },
]

// Greedy breakdown of one side's load — biggest plate first, same order they actually go on
// (heaviest against the collar, lightest on the outside). `left` (what's still owed once no
// available plate fits) comes back too, rather than being silently dropped — a target that isn't
// exactly reachable with this plate set should say so, not just quietly round down.
function plateStack(perSide, unit) {
  const plates = unit === 'lb' ? LB_PLATES : KG_PLATES
  const stack = []
  let left = perSide
  const eps = 0.01
  for (const p of plates) {
    while (left >= p.w - eps) { stack.push(p); left -= p.w }
  }
  return { stack, left: Math.max(0, left) }
}

/**
 * The pure calculation, shared by the drawing and the plain-text summary next to it.
 * `barW` overrides the unit's default bar weight (platesSheet's bar-type picker) — omit it to
 * get the plain 20kg/45lb default. `leftover` is the difference between what was asked for and
 * what's actually achievable with this plate set (0 when exact); `achieved` is that real total.
 */
export function plateBreakdown(weight, unit, barW) {
  const bar = barW != null ? barW : BAR_WEIGHT[unit === 'lb' ? 'lb' : 'kg']
  const rawPerSide = (weight - bar) / 2
  if (rawPerSide <= 0) return { barW: bar, perSide: 0, plates: [], leftover: 0, achieved: bar }
  const { stack, left } = plateStack(rawPerSide, unit)
  const perSide = rawPerSide - left
  const achieved = Math.round((bar + 2 * perSide) * 100) / 100
  return { barW: bar, perSide, plates: stack, leftover: Math.round((weight - achieved) * 100) / 100, achieved }
}

export default function BarbellPlates({ weight, unit, barW, size = 'sm' }) {
  const { plates } = plateBreakdown(weight, unit, barW)
  if (!plates.length) return null

  // A very heavy load would otherwise blow out the drawing's width — clip it rather than
  // squeeze it unreadable; the per-side text next to it is still the source of truth.
  const shown = plates.slice(0, 5)
  const biggest = unit === 'lb' ? 45 : 25
  const cx = 48, barY = 16, plateW = 4, gap = 1.5

  const side = dir => shown.map((p, i) => {
    const h = 10 + 12 * (p.w / biggest)
    const x = cx + dir * (7 + i * (plateW + gap)) - plateW / 2
    return <rect key={i} x={x} y={barY - h / 2} width={plateW} height={h} rx={1}
      fill={p.color} stroke="var(--sep)" strokeWidth="0.5" />
  })

  const big = size === 'lg'
  return (
    <svg viewBox="0 0 96 32" width={big ? 220 : 44} height={big ? 73 : 15} aria-hidden="true" style={{ flex: 'none' }}>
      <line x1="4" y1={barY} x2="92" y2={barY} stroke="var(--label-3)" strokeWidth="2" />
      {side(-1)}
      {side(1)}
    </svg>
  )
}
