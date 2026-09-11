import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { fmtDate, fmtNum, ageFrom } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { measurementSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { SelectRow } from '../components/ui.jsx'
import LineChart from '../components/LineChart.jsx'
import { MEASUREMENTS, lastMeasurement, bodyFatBand } from '../lib/measurements.js'

// Each row is one time series (see lib/measurements.js) — tapping it opens the same generic
// log-a-value-and-see-recent-entries sheet bodyweight already used, just for that measurement.
// Body fat is the one value here with an established healthy range (Gallagher et al. 2000,
// by sex and age — see bodyFatBand), so its pill is colour-coded instead of the plain accent
// every other measurement gets; it falls back to the plain colour when sex/birth date aren't set.
function Row({ m, S }) {
  const last = lastMeasurement(S, m.key)
  const band = m.key === 'bodyFat' && last ? bodyFatBand(last.v, S.body, ageFrom(S.birthDate)) : null
  return <div className="item" onClick={() => measurementSheet(m.key)}>
    <div className="grow"><div className="tt">{t(m.label)}</div>
      {last && <div className="ss">{fmtDate(last.d)}</div>}
    </div>
    {last ? <span className={'tag ' + (band || 'acc')}>{fmtNum(last.v)} {m.unit}</span> : <span className="tag">{t('Not logged')}</span>}
    <Icon name="chevronRight" className="chev" />
  </div>
}

// One chart, one picker — instead of a wall of ~20 tiny always-on graphs (one per measurement),
// which would be noise for most members who only track two or three of these. Whichever
// measurement is picked keeps its own unit and reuses the exact bodyweight chart component.
function EvolutionCard({ S }) {
  const withData = useMemo(() => MEASUREMENTS.filter(m => (S.measurements?.[m.key]?.length || 0) > 0), [S.measurements])
  const [key, setKey] = useState(() => withData[0]?.key || null)
  if (!withData.length) return null
  const m = MEASUREMENTS.find(x => x.key === key) || withData[0]
  const list = S.measurements?.[m.key] || []
  const points = list.map(x => ({ t: x.t || new Date(x.d).getTime(), y: x.v, d: x.d }))
  return <>
    <h4 className="sec">{t('Evolution')}</h4>
    <div className="card">
      <div className="sect-b" style={{ marginBottom: 10 }}>
        <SelectRow title={t('Measurement')} sheetTitle={t('Evolution')} value={m.key}
          options={withData.map(x => ({ value: x.key, label: t(x.label) }))}
          onChange={setKey} />
      </div>
      <div className="chart"><LineChart points={points} h={150} unit={m.unit} /></div>
    </div>
  </>
}

export default function Measurements() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const body = MEASUREMENTS.filter(m => m.group === 'body')
  const composition = MEASUREMENTS.filter(m => m.group === 'composition')
  const folds = MEASUREMENTS.filter(m => m.group === 'folds')
  const needsProfile = lastMeasurement(S, 'bodyFat') && !bodyFatBand(lastMeasurement(S, 'bodyFat').v, S.body, ageFrom(S.birthDate))

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1>{t('Measurements')}</h1><div className="sub">{t('Track your body over time')}</div></div>
    </div>

    <h4 className="sec">{t('Body composition')}</h4>
    <div className="dim small" style={{ margin: '0 2px 10px' }}>{t('From a bioimpedance scan — ask staff if this gym has one.')}</div>
    {needsProfile && <div className="dim small" style={{ margin: '0 2px 10px' }}>{t('Add your date of birth and sex in Settings to see whether your body fat is in a healthy range.')}</div>}
    <div className="list" style={{ marginBottom: 22 }}>{composition.map(m => <Row key={m.key} m={m} S={S} />)}</div>

    <h4 className="sec">{t('Skinfolds')}</h4>
    <div className="dim small" style={{ margin: '0 2px 10px' }}>{t('Caliper readings — ask staff if this gym takes these.')}</div>
    <div className="list" style={{ marginBottom: 22 }}>{folds.map(m => <Row key={m.key} m={m} S={S} />)}</div>

    <h4 className="sec">{t('Body measurements')}</h4>
    <div className="list">{body.map(m => <Row key={m.key} m={m} S={S} />)}</div>

    <div style={{ height: 4 }} />
    <EvolutionCard S={S} />
    <div style={{ height: 20 }} />
  </div>
}
