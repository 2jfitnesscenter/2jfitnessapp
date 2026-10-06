import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { uxOn } from '../lib/features.js'
import { t, dateLocale } from '../lib/i18n.js'
import { fmtDate, fmtNum } from '../lib/format.js'
import { useFollowUp } from '../lib/followup-view.js'
import { followupDigest } from '../lib/followup-v3.js'
import { checkinOn } from '../lib/checkin.js'
import Icon from '../components/Icon.jsx'
import FollowUpCard from '../components/FollowUpCard.jsx'
import CheckInCard from '../components/CheckInCard.jsx'
import { Surface, Stat, EmptyState } from '../components/v2.jsx'
import { Button } from '../components/ui.jsx'
import RoutineReviewCard from '../components/RoutineReviewCard.jsx'

/* Seguimiento V3 — "how am I doing with my plan": goal, last weeks, next review, today's check-in, coach notes and plan changes. Reuses the gym's existing
   follow-up schedule (GET /api/followup) and the existing check-in; only blocks that have real content are drawn. */
export default function Seguimiento() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  useStore(s => s.features)
  const fu = useFollowUp()
  const [editing, setEditing] = useState(false)
  const d = followupDigest(S, fu)
  const checkinAllowed = uxOn(S, 'health')
  const today = checkinOn(S)
  const ev = d.evolution
  const diff = ev && ev.prevWorkouts != null ? ev.workouts - ev.prevWorkouts : null

  return <div className="narrow v3-fu">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav(-1)} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1>{t('My follow-up')}</h1></div>
    </div>

    {d.reviews.map(rv => <RoutineReviewCard key={rv.routineId} review={rv} onView={() => nav('/plan/r/' + rv.routineId)} />)}

    {(d.goal || ev) && <Surface raised className="v3-fu-hero">
      {d.goal && <div className="v3-fu-goal"><span className="v2-eyebrow">{t('Current goal')}</span><b>{t(d.goal)}</b></div>}
      {ev && <div className="v3-fu-stats">
        <Stat value={ev.workouts} label={t('workouts in 4 weeks')} />
        <Stat value={fmtNum(ev.perWeek)} label={t('per week')} />
        {ev.planned && <Stat value={t('{0} planned', ev.planned)} label={t('per week in your plan')} />}
        {diff != null && <Stat value={(diff > 0 ? '+' : diff < 0 ? '−' : '±') + Math.abs(diff)} label={t('vs the 4 weeks before')} />}
        {ev.weight && <Stat value={(ev.weight.delta > 0 ? '+' : ev.weight.delta < 0 ? '−' : '±') + fmtNum(Math.abs(ev.weight.delta)) + ' ' + S.unit} label={t('Weight since the last review')} />}
      </div>}
    </Surface>}

    {d.review && <FollowUpCard fu={fu} S={S} nav={nav} />}

    {checkinAllowed && (editing || !today
      ? <CheckInCard compact onDone={() => setEditing(false)} />
      : <Surface className="v3-fu-ci"><div className="row between" style={{ gap: 10 }}>
          <div><div className="tt">{t('Today’s check-in')}</div>
            <div className="small dim">{[today.energy && t('Energy {0}/5', today.energy), today.sleep && t('Sleep {0}/5', today.sleep), today.fatigue && t('Fatigue {0}/5', today.fatigue), today.pain && t('Discomfort noted')].filter(Boolean).join(' · ')}</div></div>
          <Button size="sm" variant="tinted" onClick={() => setEditing(true)}>{t('Edit')}</Button>
        </div></Surface>)}

    {d.checkin.week.length > 1 && <Surface className="v3-fu-week">
      <div className="v2-eyebrow">{t('Last 7 days')}</div>
      <div className="v3-fu-dots" role="list">{d.checkin.week.map(c => <div key={c.d} role="listitem" className="v3-fu-dot">
        <b className="num">{c.energy || '–'}</b><small>{new Date(c.d + 'T12:00:00').toLocaleDateString(dateLocale(), { weekday: 'narrow' })}</small></div>)}</div>
      <div className="small dim">{t('Energy per check-in')}</div>
    </Surface>}

    {d.coach && <Surface className="v3-fu-coach">
      <div className="row between"><div className="v2-eyebrow">{t('From your Coach')}</div>{d.coach.at && <small className="dim">{fmtDate(String(d.coach.at).slice(0, 10))}</small>}</div>
      {d.coach.summary && <p className="v3-fu-p">{d.coach.summary}</p>}
      {d.coach.notes.map((n, i) => <p key={i} className="v3-fu-p small">💬 {n}</p>)}
      {d.coach.applied > 0 && <div className="small dim">{t('{0} changes applied to your plan', d.coach.applied)}</div>}
      <Button size="sm" variant="plain" onClick={() => nav('/coach')}>{t('Open the Coach')}</Button>
    </Surface>}

    {d.changes.length > 0 && <Surface className="v3-fu-changes">
      <div className="v2-eyebrow">{t('Plan changes')}</div>
      {d.changes.map(c => <button key={c.kind + c.id} type="button" className="v3-fu-change" onClick={() => nav('/plan/' + (c.kind === 'routine' ? 'r/' : 'p/') + c.id)}>
        <span><b>{c.name}</b><small>{t('Updated {0}', fmtDate(new Date(c.at).toISOString().slice(0, 10)))}</small></span><Icon name="chevronRight" className="chev" /></button>)}
    </Surface>}

    {d.empty && !checkinAllowed && <EmptyState icon="chartLine" title={t('Nothing to follow yet')}>
      <div className="muted small">{t('Your goal, progress and reviews appear here as you train.')}</div></EmptyState>}
    {d.empty && checkinAllowed && <p className="muted small" style={{ textAlign: 'center' }}>{t('Your goal, progress and reviews appear here as you train.')}</p>}
    <div style={{ height: 24 }} />
  </div>
}
