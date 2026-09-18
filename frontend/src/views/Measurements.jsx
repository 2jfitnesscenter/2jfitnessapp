import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { fmtDate, fmtNum, ageFrom } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { measurementSheet, bioimpedanceScanSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { SelectRow, Button, Segmented } from '../components/ui.jsx'
import LineChart from '../components/LineChart.jsx'
import SegmentBodyDiagram from '../components/SegmentBodyDiagram.jsx'
import { MEASUREMENTS, lastMeasurement, bodyFatBand, visceralFatBand, altValueOf, bodyweightNear, UNIT_TOGGLE_METRIC } from '../lib/measurements.js'

// Each row is one time series (see lib/measurements.js) — tapping it opens the same generic
// log-a-value-and-see-recent-entries sheet bodyweight already used, just for that measurement.
// Body fat and visceral fat are the two values here with an established healthy range (body fat:
// Gallagher et al. 2000, by sex and age; visceral fat: Tanita's own 1-59 rating, the same for
// everyone), so their pills are colour-coded instead of the plain accent every other measurement
// gets — body fat falls back to the plain colour when sex/birth date aren't set.
function Row({ m, S }) {
  const last = lastMeasurement(S, m.key)
  const band = m.key === 'bodyFat' && last ? bodyFatBand(last.v, S.body, ageFrom(S.birthDate))
    : m.key === 'visceralFat' && last ? visceralFatBand(last.v)
    : null
  // Reflects the same %/kg toggle the entry form and the evolution chart use — this row is
  // read-only display, so it can freely follow S.measurementUnitMode even though tapping it
  // still opens the plain single-value sheet (always in the canonical unit; the toggle is
  // scoped to the bulk composition form and the chart, not every single-field editor too).
  const toggleBucket = UNIT_TOGGLE_METRIC[m.key]
  const showAlt = last && m.altUnit && toggleBucket && (S.measurementUnitMode || {})[toggleBucket] === 'alt'
  const shown = showAlt ? altValueOf(m, last.v, bodyweightNear(S, last.d)) : last?.v
  const shownUnit = showAlt && shown != null ? m.altUnit : m.unit
  return <div className="item" onClick={() => measurementSheet(m.key)}>
    <span className="lrow-i" style={{ '--tint': m.iconTint }}><Icon name={m.icon} /></span>
    <div className="grow"><div className="tt">{t(m.label)}</div>
      {last && <div className="ss">{fmtDate(last.d)}</div>}
    </div>
    {last ? <span className={'tag ' + (band || 'acc')}>{fmtNum(shown ?? last.v)} {shownUnit}</span> : <span className="tag">{t('Not logged')}</span>}
    <Icon name="chevronRight" className="chev" />
  </div>
}

// One chart, one picker — instead of a wall of ~20 tiny always-on graphs (one per measurement),
// which would be noise for most members who only track two or three of these. Whichever
// measurement is picked keeps its own unit and reuses the exact bodyweight chart component —
// unless it's one of the fat/muscle readings with a %/kg toggle (S.measurementUnitMode, the
// same one the "Scan a report" entry form uses), in which case the chart follows that same
// setting so a member never sees the entry form say "kg" and the chart say "%".
function EvolutionCard({ S, update }) {
  const withData = useMemo(() => MEASUREMENTS.filter(m => (S.measurements?.[m.key]?.length || 0) > 0), [S.measurements])
  const [key, setKey] = useState(() => withData[0]?.key || null)
  if (!withData.length) return null
  const m = MEASUREMENTS.find(x => x.key === key) || withData[0]
  const toggleBucket = UNIT_TOGGLE_METRIC[m.key]   // 'fat' | 'muscle' | undefined
  const mode = (S.measurementUnitMode || {})[toggleBucket] || 'canonical'
  const showAlt = !!(m.altUnit && toggleBucket && mode === 'alt')
  const list = S.measurements?.[m.key] || []
  const points = list.map(x => {
    const y = showAlt ? (altValueOf(m, x.v, bodyweightNear(S, x.d)) ?? x.v) : x.v
    return { t: x.t || new Date(x.d).getTime(), y, d: x.d }
  })
  const unit = showAlt ? m.altUnit : m.unit
  return <>
    <h4 className="sec">{t('Evolution')}</h4>
    <div className="card">
      <div className="sect-b" style={{ marginBottom: 10 }}>
        <SelectRow title={t('Measurement')} sheetTitle={t('Evolution')} value={m.key}
          options={withData.map(x => ({ value: x.key, label: t(x.label) }))}
          onChange={setKey} />
      </div>
      {toggleBucket && m.altUnit && (
        <div className="row between" style={{ marginBottom: 10 }}>
          <span className="dim small">{t('Unit')}</span>
          <Segmented className="seg-inline"
            options={m.unit === '%' ? [{ value: 'canonical', label: '%' }, { value: 'alt', label: 'kg' }] : [{ value: 'canonical', label: 'kg' }, { value: 'alt', label: '%' }]}
            value={mode} onChange={v => update(s => { s.measurementUnitMode = { ...(s.measurementUnitMode || {}), [toggleBucket]: v } })} />
        </div>
      )}
      <div className="chart"><LineChart points={points} h={150} unit={unit} /></div>
    </div>
  </>
}

// A link row to one of the two dedicated screens below, instead of another inline list — folds
// and tape measurements are staff/self logging that most members check rarely, so they no longer
// compete with body composition (the thing "Scan report" actually fills in) for space here.
function GroupLinkRow({ icon, iconTint, title, subtitle, to }) {
  const nav = useNavigate()
  return <div className="item" onClick={() => nav(to)}>
    <span className="lrow-i" style={{ '--tint': iconTint }}><Icon name={icon} /></span>
    <div className="grow"><div className="tt">{t(title)}</div>{subtitle && <div className="ss">{t(subtitle)}</div>}</div>
    <Icon name="chevronRight" className="chev" />
  </div>
}

export default function Measurements() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const composition = MEASUREMENTS.filter(m => m.group === 'composition')
  const segments = MEASUREMENTS.filter(m => m.group === 'segments')
  const needsProfile = lastMeasurement(S, 'bodyFat') && !bodyFatBand(lastMeasurement(S, 'bodyFat').v, S.body, ageFrom(S.birthDate))

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/profile')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1>{t('Measurements')}</h1><div className="sub">{t('Track your body over time')}</div></div>
    </div>

    <div className="row between" style={{ margin: '22px 0 8px' }}>
      <h4 className="sec" style={{ margin: 0 }}>{t('Body composition')}</h4>
      <Button size="sm" variant="tinted" icon="scan" onClick={bioimpedanceScanSheet}>{t('Scan report')}</Button>
    </div>
    <div className="dim small" style={{ margin: '0 2px 10px' }}>{t('From a bioimpedance scan — ask staff if this gym has one.')}</div>
    {needsProfile && <div className="dim small" style={{ margin: '0 2px 10px' }}>{t('Add your date of birth and sex in Settings to see whether your body fat is in a healthy range.')}</div>}
    <div className="list" style={{ marginBottom: 22 }}>{composition.map(m => <Row key={m.key} m={m} S={S} />)}</div>

    <h4 className="sec">{t('Body composition by segment')}</h4>
    <div className="dim small" style={{ margin: '0 2px 10px' }}>{t('From the same scan, broken down by arm, leg and trunk.')}</div>
    <div className="list" style={{ marginBottom: 14 }}>{segments.map(m => <Row key={m.key} m={m} S={S} />)}</div>
    <div style={{ marginBottom: 22 }}><SegmentBodyDiagram S={S} /></div>

    <div className="list" style={{ marginBottom: 22 }}>
      <GroupLinkRow icon="caliper" iconTint="var(--teal)" title="Skinfolds" subtitle="Caliper readings" to="/measurements/folds" />
      <GroupLinkRow icon="expand" iconTint="var(--mint)" title="Body measurements" subtitle="Your own tape measure" to="/measurements/body" />
    </div>

    <EvolutionCard S={S} update={update} />
    <div style={{ height: 20 }} />
  </div>
}

// Skinfolds and body measurements are structurally identical — a header, a back button and one
// list of Row for that group's keys — so both screens share this instead of two near-duplicates.
function MeasurementGroupScreen({ group, title, subtitle }) {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const list = MEASUREMENTS.filter(m => m.group === group)
  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/measurements')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}>
        <h1>{t(title)}</h1>
        {subtitle && <div className="sub">{t(subtitle)}</div>}
      </div>
    </div>
    <div className="list" style={{ marginTop: 10 }}>{list.map(m => <Row key={m.key} m={m} S={S} />)}</div>
  </div>
}
export function SkinfoldsScreen() {
  return <MeasurementGroupScreen group="folds" title="Skinfolds" subtitle="Caliper readings — ask staff if this gym takes these." />
}
export function BodyMeasurementsScreen() {
  return <MeasurementGroupScreen group="body" title="Body measurements" />
}
