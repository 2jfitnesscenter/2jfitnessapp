// Copyright (C) 2026 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { fmtNum, fmtDate, fmtDur } from '../lib/format.js'
import { Segmented, Button, SelectRow } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import MetricHeatmap from '../components/MetricHeatmap.jsx'
import LineChart from '../components/LineChart.jsx'
import SegmentExplorer from '../components/SegmentExplorer.jsx'
import CheckInCard from '../components/CheckInCard.jsx'
import { RANGES, availableMetrics, metricSummary, compareMeasurements, scanDates, hasSegments, bmiOf, weekActivity, SOURCE_LABEL } from '../lib/health.js'
import { PAIN_ZONE, checkinOn } from '../lib/checkin.js'
import { api } from '../lib/api.js'

// Health V2 — "your physical evolution". Everything here is derived from what the profile
// already holds (lib/health.js): measured body readings with their source when known, the
// imported Apple Health series, workouts and their recorded cardio data, and declared check-ins.
// It shows numbers and changes, never a medical reading of them, and nothing that isn't there.

const RANGE_LABEL = { '1m': '1M', '3m': '3M', '6m': '6M', '1y': '1Y', all: 'All' }
const HEADLINE = ['weight', 'bodyFat', 'muscleMass', 'visceralFat']
const signed = (v, unit) => (v > 0 ? '+' : v < 0 ? '−' : '±') + fmtNum(Math.abs(v)) + (unit ? ' ' + unit : '')
const unitOf = (def, S) => def.key === 'weight' ? S.unit : def.unit

// Weekly sleep (hours): one point per ISO week, averaging nightly minutes.
function weeklySleep(series) {
  const byWeek = new Map()
  series.forEach(p => {
    const day = new Date(p.d + 'T00:00:00')
    const monday = new Date(day); monday.setDate(day.getDate() - ((day.getDay() + 6) % 7))
    const key = monday.toISOString().slice(0, 10)
    const cur = byWeek.get(key) || { sum: 0, n: 0 }
    cur.sum += p.v; cur.n++
    byWeek.set(key, cur)
  })
  return [...byWeek.entries()].sort().map(([d, { sum, n }]) => ({ d, y: Math.round(sum / n / 6) / 10, t: new Date(d).getTime() }))
}

function MetricCard({ sum, S }) {
  const { def, current, start, end, delta, pct, points } = sum
  const unit = unitOf(def, S)
  return <div className="card hv-metric">
    <div className="hv-mh">
      <span className="hv-mt">{t(def.label)}</span>
      {current.src && <span className="hv-src">{t(SOURCE_LABEL[current.src] || current.src)}</span>}
    </div>
    <div className="hv-mrow">
      <div><div className="hv-k">{t('Now')}</div><div className="hv-v">{fmtNum(current.v)} <small>{unit}</small></div><div className="hv-d">{fmtDate(current.d)}</div></div>
      {start && <div><div className="hv-k">{t('Start of period')}</div><div className="hv-v2">{fmtNum(start.v)} <small>{unit}</small></div><div className="hv-d">{fmtDate(start.d)}</div></div>}
      {delta != null && <div className="hv-delta"><div className="hv-k">{t('Difference')}</div><b>{signed(delta, def.unit === '%' ? t('pts') : unit)}</b>{pct != null && <span>{signed(pct, '%')}</span>}</div>}
    </div>
    {points.length > 1
      ? <div className="chart"><LineChart points={points.map(p => ({ t: new Date(p.d + 'T12:00:00').getTime(), y: p.v, d: p.d }))} h={120} unit={unit} /></div>
      : <div className="dim small">{points.length ? t('One reading in this period — the chart needs two.') : t('No readings in this period.')}</div>}
    {end && start && def.group === 'composition' && def.key !== 'weight' && <div className="dim small hv-note">{t('Body-composition changes between scans are estimates of the device, not exact measurements.')}</div>}
  </div>
}

function CompareCard({ S }) {
  const dates = scanDates(S)
  const [a, setA] = useState(dates[0])
  const [b, setB] = useState(dates[dates.length - 1])
  if (dates.length < 2) return null
  const rows = compareMeasurements(S, a, b)
  const opts = dates.map(d => ({ value: d, label: fmtDate(d, true) }))
  return <>
    <h4 className="sec">{t('Compare two measurements')}</h4>
    <div className="card">
      <div className="sect-b" style={{ marginBottom: 10 }}>
        <SelectRow title={t('Measurement A')} value={a} options={opts} onChange={setA} />
        <SelectRow title={t('Measurement B')} value={b} options={opts} onChange={setB} />
      </div>
      {a === b ? <div className="dim small">{t('Choose two different days.')}</div> : !rows.length ? <div className="dim small">{t('These two days have no reading in common.')}</div> :
        <div className="hv-cmp" role="table" aria-label={t('Compare two measurements')}>
          <div className="hv-cmp-r hv-cmp-h" role="row"><span role="columnheader" /><span role="columnheader">{fmtDate(a <= b ? a : b)}</span><span role="columnheader">{fmtDate(a <= b ? b : a)}</span><span role="columnheader">{t('Difference')}</span></div>
          {rows.map(r => {
            const unit = unitOf(r.def, S)
            return <div key={r.key} className="hv-cmp-r" role="row">
              <span role="cell">{t(r.def.label)}</span><span role="cell">{fmtNum(r.a)} {unit}</span><span role="cell">{fmtNum(r.b)} {unit}</span>
              <span role="cell"><b>{signed(r.delta, r.def.unit === '%' ? t('pts') : unit)}</b>{r.pct != null && <em> {signed(r.pct, '%')}</em>}</span>
            </div>
          })}
        </div>}
    </div>
  </>
}

export default function Health() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const [range, setRange] = useState('6m')
  const [sleepMode, setSleepMode] = useState('day')
  const [editCheckin, setEditCheckin] = useState(false)
  const metrics = useMemo(() => availableMetrics(S), [S.bodyweight, S.measurements])
  const sums = useMemo(() => metrics.map(k => metricSummary(S, k, range)).filter(Boolean), [metrics, range, S.bodyweight, S.measurements])
  const headline = sums.filter(s => HEADLINE.includes(s.key))
  const others = sums.filter(s => !HEADLINE.includes(s.key))
  const bmi = bmiOf(S)
  const week = weekActivity(S)
  const today = checkinOn(S)
  // The gym's follow-up schedule (Seguimiento V2) — only dates; offline simply shows nothing.
  const [followUp, setFollowUp] = useState(null)
  useEffect(() => { let on = true; api('/api/followup').then(r => on && setFollowUp(r)).catch(() => {}); return () => { on = false } }, [])
  const recent = (S.checkins || []).slice(-5).reverse()
  const imported = S.steps.length > 0 || S.sleep.length > 0 || S.restingHR.length > 0
  const nothing = !metrics.length && !S.workouts.length && !imported && !(S.checkins || []).length

  return <div className="narrow health">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/profile')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1>{t('Health')}</h1><div className="sub">{t('Your physical evolution')}</div></div>
    </div>

    {nothing && <div className="card m2-empty">
      <div className="m2-empty-ic"><Icon name="heart" /></div>
      <div className="tt">{t('Your evolution will appear here')}</div>
      <div className="muted small">{t('Log your weight, scan a bioimpedance report or bring in Apple Health data to start.')}</div>
      <Button variant="primary" icon="scale" onClick={() => nav('/measurements')}>{t('Add a measurement')}</Button>
    </div>}

    {headline.length > 0 && <div className="hv-now">
      {headline.map(s => <div key={s.key} className="hv-tile">
        <span className="hv-k">{t(s.def.label)}</span>
        <b>{fmtNum(s.current.v)} <small>{unitOf(s.def, S)}</small></b>
        <span className="hv-d">{fmtDate(s.current.d)}{s.current.src ? ' · ' + t(SOURCE_LABEL[s.current.src] || s.current.src) : ''}</span>
      </div>)}
    </div>}
    {followUp?.active && <div className="hv-fu"><Icon name="calendar" />{followUp.nextReview < new Date().toISOString().slice(0, 10)
      ? t('Your follow-up review with the gym is due')
      : t('Next follow-up review with the gym: {0}', fmtDate(followUp.nextReview))}</div>}
    {bmi != null && <div className="dim small hv-bmi">{t('BMI {0} · calculated from your weight and height', fmtNum(bmi))}</div>}

    {metrics.length > 0 && <>
      <div className="row between hv-rangebar">
        <h4 className="sec" style={{ margin: 0 }}>{t('Evolution')}</h4>
        <Segmented className="seg-inline hv-range" value={range} onChange={setRange} options={RANGES.map(r => ({ value: r.key, label: t(RANGE_LABEL[r.key]) }))} />
      </div>
      {headline.map(s => <MetricCard key={s.key} sum={s} S={S} />)}
      {others.length > 0 && <details className="hv-more">
        <summary>{t('More measurements ({0})', others.length)}</summary>
        {others.map(s => <MetricCard key={s.key} sum={s} S={S} />)}
      </details>}
    </>}

    {hasSegments(S) && <>
      <h4 className="sec">{t('By segment')}</h4>
      <SegmentExplorer S={S} range={range} />
    </>}

    <CompareCard S={S} />

    <h4 className="sec">{t('How you feel')}</h4>
    {editCheckin || !today ? <CheckInCard compact onDone={() => setEditCheckin(false)} /> : <div className="card hv-ci">
      <div className="row between"><b>{t('Today')}</b><button className="segx-back" onClick={() => setEditCheckin(true)}>{t('Edit')}</button></div>
      <CheckinLine c={today} />
    </div>}
    {recent.filter(c => c !== today).length > 0 && <div className="list" style={{ marginTop: 8 }}>
      {recent.filter(c => c !== today).map(c => <div key={c.d} className="item"><div className="grow"><div className="ss">{fmtDate(c.d, true)}</div><CheckinLine c={c} /></div></div>)}
    </div>}

    {(week.workouts > 0) && <>
      <h4 className="sec">{t('This week')}</h4>
      <div className="card hv-week">
        <div><b>{week.workouts}</b><span>{t(week.workouts === 1 ? 'workout' : 'workouts')}</span></div>
        <div><b>{fmtDur(week.durationMs)}</b><span>{t('training')}</span></div>
        {week.kcal != null && <div><b>{fmtNum(week.kcal)} kcal</b><span>{t(week.kcalSessions === 1 ? 'recorded in 1 session' : 'recorded in {0} sessions', week.kcalSessions)}</span></div>}
      </div>
    </>}

    {imported && <>
      <h4 className="sec">{t('Imported activity')}</h4>
      {S.steps.length > 0 && <div className="card"><h2>{t('Steps')} <span className="hv-src">Apple Health</span></h2>
        <MetricHeatmap series={S.steps} tooltip={(d, v) => `${d} · ${fmtNum(v)} ${t('steps')}`} /></div>}
      {S.sleep.length > 0 && <div className="card">
        <div className="row between" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>{t('Sleep')}</h2>
          <Segmented className="seg-range" value={sleepMode} onChange={setSleepMode}
            options={[{ value: 'day', label: t('Daily') }, { value: 'week', label: t('Weekly') }]} />
        </div>
        {sleepMode === 'day'
          ? <MetricHeatmap series={S.sleep} tooltip={(d, v) => `${d} · ${Math.round(v / 6) / 10} ${t('h')}`} />
          : <div className="chart"><LineChart points={weeklySleep(S.sleep)} h={150} unit={t('h')} color="var(--indigo)" /></div>}
      </div>}
      {S.restingHR.length > 0 && <div className="card"><h2>{t('Resting HR')}</h2>
        <MetricHeatmap series={S.restingHR} tooltip={(d, v) => `${d} · ${v} bpm`} /></div>}
    </>}

    <h4 className="sec">{t('Connections')}</h4>
    <div className="list">
      <div className="item" onClick={() => nav('/health/integrations')}>
        <span className="lrow-i" style={{ '--tint': 'var(--red)' }}><Icon name="heart" /></span>
        <div className="grow"><div className="tt">{t('Fitness integrations')}</div><div className="ss">{t('Watch, heart-rate sensor, WHOOP, Apple Health')}</div></div>
        <Icon name="chevronRight" className="chev" />
      </div>
      <div className="item" onClick={() => nav('/measurements')}>
        <span className="lrow-i" style={{ '--tint': 'var(--teal)' }}><Icon name="scale" /></span>
        <div className="grow"><div className="tt">{t('Measurements')}</div><div className="ss">{t('Log weight, scan a report, tape and skinfolds')}</div></div>
        <Icon name="chevronRight" className="chev" />
      </div>
    </div>
    <div className="dim small" style={{ margin: '14px 2px 0' }}>{t('2J shows your data; it does not diagnose anything. For health questions, talk to a professional.')}</div>
    <div style={{ height: 20 }} />
  </div>
}

function CheckinLine({ c }) {
  return <div className="ci-line">
    {c.energy && <span>{t('Energy')} <b>{c.energy}/5</b></span>}
    {c.sleep && <span>{t('Rest')} <b>{c.sleep}/5</b></span>}
    {c.fatigue && <span>{t('Fatigue')} <b>{c.fatigue}/5</b></span>}
    {c.pain ? <span>{t('Discomfort')}: <b>{(c.zones || []).map(z => t(PAIN_ZONE[z]?.label || z)).join(', ')}</b></span> : c.pain === false ? <span>{t('No discomfort')}</span> : null}
    {c.note && <span className="dim">“{c.note}”</span>}
  </div>
}
