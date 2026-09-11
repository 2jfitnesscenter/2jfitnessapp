import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { fmtDate, fmtNum } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { measurementSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { MEASUREMENTS, lastMeasurement } from '../lib/measurements.js'

// Each row is one time series (see lib/measurements.js) — tapping it opens the same generic
// log-a-value-and-see-recent-entries sheet bodyweight already used, just for that measurement.
function Row({ m, S }) {
  const last = lastMeasurement(S, m.key)
  return <div className="item" onClick={() => measurementSheet(m.key)}>
    <div className="grow"><div className="tt">{t(m.label)}</div>
      {last && <div className="ss">{fmtDate(last.d)}</div>}
    </div>
    {last ? <span className="tag acc">{fmtNum(last.v)} {m.unit}</span> : <span className="tag">{t('Not logged')}</span>}
    <Icon name="chevronRight" className="chev" />
  </div>
}

export default function Measurements() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const body = MEASUREMENTS.filter(m => m.group === 'body')
  const composition = MEASUREMENTS.filter(m => m.group === 'composition')

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1>{t('Measurements')}</h1><div className="sub">{t('Track your body over time')}</div></div>
    </div>

    <h4 className="sec">{t('Body composition')}</h4>
    <div className="dim small" style={{ margin: '0 2px 10px' }}>{t('From a bioimpedance scan — ask staff if this gym has one.')}</div>
    <div className="list" style={{ marginBottom: 22 }}>{composition.map(m => <Row key={m.key} m={m} S={S} />)}</div>

    <h4 className="sec">{t('Body measurements')}</h4>
    <div className="list">{body.map(m => <Row key={m.key} m={m} S={S} />)}</div>
    <div style={{ height: 20 }} />
  </div>
}
