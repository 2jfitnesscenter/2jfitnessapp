import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { fmtNum } from '../lib/format.js'
import { Segmented } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import MetricHeatmap from '../components/MetricHeatmap.jsx'
import LineChart from '../components/LineChart.jsx'

// One point per ISO week (Monday), averaging that week's nightly minutes into hours — the
// "Weekly" view, next to Daily's own per-night calendar grid. Sleep is the only one of the
// three metrics this screen offers a weekly rollup for: steps and resting HR read fine as a
// straight calendar (a "busy" or "quiet" day is meaningful on its own), but a single night's
// sleep is noisy night to night, and the week is the unit people actually think in for it.
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

// Everything an Apple Health import can bring in (see lib/import-csv.js's parseAppleHealth),
// shown as a calendar-style summary rather than a trend line — this only ever fills in from an
// occasional import rather than continuous logging, so "which days had data, and roughly how
// much" reads better at a glance than a line chart with long flat gaps between imports.
export default function Health() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const [sleepMode, setSleepMode] = useState('day')
  const hasAny = S.steps.length > 0 || S.sleep.length > 0 || S.restingHR.length > 0

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/profile')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1>{t('Health')}</h1><div className="sub">{t('Imported from Apple Health.')}</div></div>
    </div>

    {!hasAny ? <div className="muted small">{t('Nothing imported yet — see Settings to bring in data from Apple Health.')}</div> : <>
      {S.steps.length > 0 && <div className="card">
        <h2>{t('Steps')}</h2>
        <MetricHeatmap series={S.steps} tooltip={(d, v) => `${d} · ${fmtNum(v)} ${t('steps')}`} />
      </div>}

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

      {S.restingHR.length > 0 && <div className="card">
        <h2>{t('Resting HR')}</h2>
        <MetricHeatmap series={S.restingHR} tooltip={(d, v) => `${d} · ${v} bpm`} />
      </div>}
    </>}
    <div style={{ height: 20 }} />
  </div>
}
