import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { fmtDur, fmtNum } from '../lib/format.js'
import { fitnessOf, fitnessSources, detachFitness, SOURCE_NAME } from '../lib/fitness.js'
import { confirmSheet } from '../sheets.jsx'

// The CARDIOVASCULAR half of a workout, kept apart from its strength log: duration, calories,
// average/max heart rate and time per zone — each only if a real source provided it — and
// exactly where it came from. Zones say whether the source gave them (WHOOP's own 0-5) or 2J
// derived them from heart-rate samples against your max HR (Z1-Z5).
const ZONE_COLOR = ['var(--grey)', 'var(--blue)', 'var(--teal)', 'var(--green)', 'var(--orange)', 'var(--red)']

export function sourceLine(rec) {
  const name = t(SOURCE_NAME[rec.source] || rec.source)
  return rec.origin ? `${name} · ${rec.origin}` : name
}

export default function FitnessSummary({ w, editable = true }) {
  const update = useStore(s => s.update)
  const rec = fitnessOf(w)
  if (!rec) return null
  const others = fitnessSources(w).slice(1)
  const dur = rec.end > rec.start ? rec.end - rec.start : null
  const z = rec.zones?.mins
  const total = z ? z.reduce((a, b) => a + b, 0) : 0
  const offset = rec.zones?.scheme === 'source' ? 0 : 1          // WHOOP counts from zone 0
  const colors = rec.zones?.scheme === 'source' ? ZONE_COLOR : ZONE_COLOR.slice(1)
  const unlink = r => confirmSheet({
    title: t('Unlink this data?'), message: t('The activity stays in {0}; only its link to this workout is removed.', t(SOURCE_NAME[r.source] || r.source)),
    confirmText: t('Unlink'), onConfirm: () => update(s => { const x = s.workouts.find(y => y.id === w.id); if (x) detachFitness(x, r.source, r.externalId || null) }),
  })
  return <div className="fitsum" aria-label={t('Cardiovascular')}>
    <div className="fitsum-h">{t('Cardiovascular')}</div>
    <div className="fitsum-grid">
      {dur && <div><span>{t('Duration')}</span><b>{fmtDur(dur)}</b></div>}
      {rec.calories > 0 && <div><span>{t('Calories')}</span><b>{fmtNum(rec.calories)} kcal</b></div>}
      {rec.avgHr > 0 && <div><span>{t('Avg HR')}</span><b>{rec.avgHr} {t('bpm')}</b></div>}
      {rec.maxHr > 0 && <div><span>{t('Max HR')}</span><b>{rec.maxHr} {t('bpm')}</b></div>}
    </div>
    {z && total > 0 && <>
      <div className="fitsum-bar" role="img" aria-label={z.map((m, i) => `Z${i + offset} ${m} min`).join(', ')}>
        {z.map((m, i) => m > 0 && <i key={i} style={{ width: (m / total * 100) + '%', background: colors[i] }} />)}
      </div>
      <div className="fitsum-zones">{z.map((m, i) => m > 0 && <span key={i}><i style={{ background: colors[i] }} />Z{i + offset} {t('{0} min', m)}</span>)}</div>
      <div className="dim small">{rec.zones.derived ? t('Zones calculated by 2J from heart-rate samples and your max HR.') : t('Zones as provided by the source.')}</div>
    </>}
    <div className="fitsum-src">
      <span>{t('Source')}: <b>{sourceLine(rec)}</b>{rec.kind === 'measured' ? ' · ' + t('measured live') : ' · ' + t('imported')}</span>
      {editable && w.fitness && <button onClick={() => unlink(rec)}>{t('Unlink')}</button>}
    </div>
    {others.length > 0 && <div className="dim small">{t('Also seen by: {0} (not added up)', others.map(sourceLine).join(', '))}</div>}
  </div>
}
