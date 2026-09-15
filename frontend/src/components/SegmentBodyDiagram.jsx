import { t } from '../lib/i18n.js'
import { fmtNum, fmtDate } from '../lib/format.js'
import { lastMeasurement } from '../lib/measurements.js'
import { MUSCLES, INERT } from '../lib/muscles.js'
import { useBodyPaths } from './BodyMap.jsx'

// The 5 segmental readings called out on the same real body illustration the muscle
// picker/map uses (front view only — arms, legs and trunk are all visible from the front, no
// need for the back), instead of a hand-drawn placeholder figure. Every muscle renders at the
// same flat "untrained" shade: nothing here is a load/heatmap, just a body to hang 5 labels on.
//
// Callout coordinates are pinned to real landmarks read off the artwork itself (forearm, tibialis
// and chest/abs bounding boxes, via getBBox in a throwaway render) — not eyeballed — hand-tuned
// only for the trunk label, routed out to the right instead of straight down, which is the one
// direction that doesn't cross the legs starting to splay from the hip.
const ZONES = [
  { fatKey: 'segFatArmL', muscleKey: 'segMuscleArmL', dot: [170, 595], via: [60, 595], label: [15, 552], anchor: 'start' },
  { fatKey: 'segFatArmR', muscleKey: 'segMuscleArmR', dot: [560, 595], via: [670, 595], label: [712, 552], anchor: 'end' },
  { fatKey: 'segFatTrunk', muscleKey: 'segMuscleTrunk', dot: [364, 470], via: [600, 470], label: [712, 812], anchor: 'end' },
  { fatKey: 'segFatLegL', muscleKey: 'segMuscleLegL', dot: [278, 1090], via: [120, 1090], label: [15, 1082], anchor: 'start' },
  { fatKey: 'segFatLegR', muscleKey: 'segMuscleLegR', dot: [450, 1090], via: [608, 1090], label: [712, 1082], anchor: 'end' },
]

function Callout({ zone, S }) {
  const fat = lastMeasurement(S, zone.fatKey)
  const muscle = lastMeasurement(S, zone.muscleKey)
  const [dx, dy] = zone.dot
  const [vx, vy] = zone.via
  const [lx, ly] = zone.label
  return <g>
    <line x1={dx} y1={dy} x2={vx} y2={vy} className="sbd-lead" />
    <line x1={vx} y1={vy} x2={lx} y2={ly - 8} className="sbd-lead" />
    <circle cx={dx} cy={dy} r="7" className="sbd-dot" />
    <text x={lx} y={ly} textAnchor={zone.anchor} className="sbd-fat">
      {t('Fat')} {fat ? fmtNum(fat.v) + '%' : '—'}
    </text>
    <text x={lx} y={ly + 24} textAnchor={zone.anchor} className="sbd-muscle">
      {t('Muscle')} {muscle ? fmtNum(muscle.v) + ' kg' : '—'}
    </text>
  </g>
}

// `showGeneral` adds the two whole-body readings (Settings → the "composition" group's own
// bodyFat/muscleMass, already shown as their own rows on Measurements) above the figure — for
// Home, which has no such list nearby for them to sit next to; Measurements passes nothing here
// since its own composition list is right above this diagram already.
export default function SegmentBodyDiagram({ S, showGeneral = false, compact = false }) {
  const paths = useBodyPaths()
  const body = S.body === 'female' ? 'female' : 'male'
  const g = paths && (paths[body] || paths.male)
  const front = g && g.front
  const any = ZONES.some(z => lastMeasurement(S, z.fatKey) || lastMeasurement(S, z.muscleKey))
  const dates = ZONES.flatMap(z => [lastMeasurement(S, z.fatKey), lastMeasurement(S, z.muscleKey)])
    .filter(Boolean).map(x => x.d).sort()
  const latest = dates[dates.length - 1]
  const bodyFat = lastMeasurement(S, 'bodyFat')
  const muscleMass = lastMeasurement(S, 'muscleMass')
  return <div className="card sbd-card">
    {showGeneral && (bodyFat || muscleMass) && <div className="row" style={{ gap: 16, marginBottom: 10 }}>
      {bodyFat && <span className="sbd-general" style={{ color: 'var(--orange)' }}>{t('Body fat')} <b>{fmtNum(bodyFat.v)}%</b></span>}
      {muscleMass && <span className="sbd-general" style={{ color: 'var(--indigo)' }}>{t('Muscle mass')} <b>{fmtNum(muscleMass.v)} kg</b></span>}
    </div>}
    {front ? (
      <svg viewBox={front.vb} className={'sbd-svg' + (compact ? ' sbd-svg-compact' : '')} role="img" aria-label={t('Body composition by segment, shown on a body diagram')}>
        {INERT.map(slug => (front.p[slug] || []).map((d, i) => <path key={slug + i} className="bm-sil" d={d} />))}
        {MUSCLES.map(slug => (front.p[slug] || []).map((d, i) => <path key={slug + i} className="bm-m" d={d} />))}
        {ZONES.map((z, i) => <Callout key={i} zone={z} S={S} />)}
      </svg>
    ) : <div className={'sbd-ph' + (compact ? ' sbd-ph-compact' : '')} aria-hidden="true" />}
    {any
      ? <div className="dim small" style={{ textAlign: 'center', marginTop: 2 }}>{t('Latest reading: {0}', fmtDate(latest, true))}</div>
      : <div className="dim small" style={{ textAlign: 'center', marginTop: 2 }}>{t('Scan a report or log a value above to fill this in.')}</div>}
  </div>
}
