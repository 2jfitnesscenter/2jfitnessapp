// Copyright (C) 2026 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t, nameFor } from '../lib/i18n.js'
import { fmtDate, fmtNum } from '../lib/format.js'
import { EXIDX } from '../lib/exercises.js'
import { personalRecords } from '../lib/mi2j.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'

// My records: per exercise, the heaviest set really lifted (weight × reps, the same rule the
// finish summary uses for a PR) and, apart and labelled as such, the best ESTIMATED 1RM. The
// "before" is the heaviest set that record replaced, so progress is shown honestly.
export default function Records() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const records = useMemo(() => personalRecords(S), [S.workouts])
  const unit = S.unit

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/mi2j')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1>{t('My records')}</h1></div>
    </div>
    {!records.length ? <div className="card m2-empty">
      <div className="m2-empty-ic"><Icon name="trophy" /></div>
      <div className="tt">{t('No records yet')}</div>
      <div className="muted small">{t('Your first record will appear once you complete your first sessions.')}</div>
      <Button variant="primary" icon="play" onClick={() => nav('/workout')}>{t('Start training')}</Button>
    </div> : <>
      <div className="muted small" style={{ margin: '-6px 0 12px' }}>{t('Record = the heaviest set you actually lifted. e1RM = an estimate of your one-rep max from a set, not a lift.')}</div>
      <div className="recs">
        {records.map(r => {
          const ex = EXIDX[r.id]
          return <button key={r.id} className="rec" onClick={() => nav('/stats?ex=' + r.id)}
            aria-label={(ex ? nameFor(ex) : r.id) + ': ' + fmtNum(r.best.w) + ' ' + unit + ' × ' + r.best.r}>
            <div className="rec-h">
              <span className="rec-n capitalize">{ex ? nameFor(ex) : r.id}</span>
              <Icon name="chevronRight" className="chev" />
            </div>
            <div className="rec-main">
              <span className="rec-k"><Icon name="trophy" />{t('Record')}</span>
              <span className="rec-v">{fmtNum(r.best.w)} <small>{unit}</small> × {r.best.r}</span>
              <span className="rec-d">{fmtDate(r.best.d)}</span>
            </div>
            {r.previous && <div className="rec-prev">{t('Before: {0}', fmtNum(r.previous.w) + ' ' + unit + ' × ' + r.previous.r)} <b>+{fmtNum(Math.round((r.best.w - r.previous.w) * 100) / 100)} {unit}</b></div>}
            {r.e1rm && <div className="rec-e1">
              <span className="rec-k est"><Icon name="chartLine" />e1RM</span>
              <span>{t('≈ {0} {1} estimated', fmtNum(r.e1rm.est), unit)}</span>
              <span className="dim">{t('from {0}', fmtNum(r.e1rm.w) + ' × ' + r.e1rm.r)}</span>
            </div>}
          </button>
        })}
      </div>
    </>}
    <div style={{ height: 20 }} />
  </div>
}
