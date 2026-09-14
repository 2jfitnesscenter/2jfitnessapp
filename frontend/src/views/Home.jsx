import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { effectiveRoutine, effectiveRoutineId, activeWeek, streakWeeks, setsDoneActive, setsDone } from '../lib/history.js'
import { fmtDate, fmtDur, fmtVol, todayISO, isoOf, weekKey, DAYS } from '../lib/format.js'
import { t, dateLocale } from '../lib/i18n.js'
import { dayOverrideSheet, calendarSheet, startFlow, loadStarterPlan, workoutDetailSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import BodyMap from '../components/BodyMap.jsx'
import BodyWeightCard from '../components/BodyWeightCard.jsx'
import { glyphOf } from '../lib/glyphs.js'
import { coachAvailable, hasConsent } from '../lib/coach.js'
import { useCoachStatus } from '../lib/coach-api.js'
import { DEMO } from '../lib/demo.js'
import { MOBILE } from '../lib/mobile.js'
import { recoveryOf, overallRecovery } from '../lib/recovery.js'
import { loadOfWorkouts } from '../lib/muscles.js'
import RecoveryRing from '../components/RecoveryRing.jsx'
import { fetchWhoopRecovery } from '../lib/whoop-api.js'

// A tap-through summary of the most recently finished workout — duration, sets, volume, and
// which muscles it hit (the same body map FinishSummary shows right after finishing one).
function LastWorkoutCard({ S }) {
  const w = S.workouts.length ? S.workouts[S.workouts.length - 1] : null
  if (!w) return null
  const glyph = glyphOf((S.routines.find(r => r.id === w.routineId) || {}).emoji)
  return <div className="card tappable" style={{ cursor: 'pointer' }} onClick={() => workoutDetailSheet(w)}>
    <div className="row" style={{ gap: 9, marginBottom: 10 }}>
      <span className="lrow-i" style={{ width: 34, height: 34, borderRadius: 8, fontSize: 19 }}><Icon name={glyph} /></span>
      <div style={{ minWidth: 0 }}>
        <div className="lbl2">{t('Last workout')}</div>
        <div className="ttl">{w.name}</div>
      </div>
      <span className="dim small" style={{ marginLeft: 'auto' }}>{fmtDate(w.d, true)}</span>
    </div>
    <div className="tiles">
      <div className="tile"><div className="l">{t('Duration')}</div><div className="v">{fmtDur(w.end - w.start)}</div></div>
      <div className="tile"><div className="l">{t('Sets')}</div><div className="v">{setsDone(w)}</div></div>
      <div className="tile"><div className="l">{t('Volume')}</div><div className="v">{fmtVol(w.vol, S.unit)}</div></div>
    </div>
    <BodyMap load={loadOfWorkouts([w])} body={S.body} />
  </div>
}

// Muscle recovery — an estimate of how ready each muscle group is, from the last 7 days of
// logged sets (see lib/recovery.js). The ring gives the one number that matters at a glance;
// the coloured manikin is the same red/orange/green map /recovery itself uses, just without
// its legend or the per-muscle % list — tapping through is the only way to get those, on
// purpose, so the card stays a glance rather than a second copy of the detail screen.
function RecoveryCard({ nav, S }) {
  const recovery = recoveryOf(S)
  const overall = overallRecovery(recovery)
  const pillColor = v => v >= 70 ? 'var(--green)' : v >= 40 ? 'var(--orange)' : 'var(--red)'
  const colorOf = slug => pillColor(recovery[slug] ?? 100)
  return <div className="card tappable" style={{ cursor: 'pointer' }} onClick={() => nav('/recovery')}>
    <div className="row between">
      <div style={{ minWidth: 0 }}>
        <h2 style={{ margin: '0 0 2px' }}>{t('Muscle recovery')}</h2>
        <div className="muted small">{t('See which muscles are ready to train')}</div>
      </div>
      <RecoveryRing value={overall} size={58} stroke={6} />
    </div>
    <BodyMap colorOf={colorOf} body={S.body} />
  </div>
}

// A job in flight or a proposal waiting is the only reason the Coach interrupts Home. When it
// has nothing to say it renders nothing at all — and it only polls while Home is on screen.
function CoachCard({ nav }) {
  const S = useStore(s => s.S)
  const { job, pending } = useCoachStatus(hasConsent(S))
  if (!hasConsent(S) || (!job && !pending)) return null
  const ready = !!pending
  return <div className="card" style={ready ? { borderColor: 'var(--acc)' } : null}>
    <div className="today-row" onClick={() => nav(ready ? '/coach/proposal' : '/coach')}>
      <div className="row" style={{ gap: 9, minWidth: 0 }}>
        <span className="lrow-i" style={{ background: ready ? 'var(--acc)' : 'var(--orange)' }}><Icon name="sparkles" /></span>
        <div style={{ minWidth: 0 }}>
          <div className="lbl2">{t('Coach')}</div>
          <div className="ttl">{ready
            ? (pending.kind === 'create'
              ? t('Your plan is ready')
              : t(pending.changes?.length === 1 ? '{0} suggestion for you' : '{0} suggestions for you', pending.changes?.length || 0))
            : t('Reading your training…')}</div>
        </div>
      </div>
      {ready ? <span className="tag acc">{t('Review')}</span> : <Icon name="chevronRight" className="chev" />}
    </div>
  </div>
}

// A separate signal from `RecoveryCard` above — that one is a training-load estimate derived
// purely from logged sets (see lib/recovery.js); this is Whoop's own biometric recovery score
// (HRV/resting-HR based), pulled live once Whoop is connected (Settings → Connected apps). The
// two numbers can legitimately disagree, so they stay two clearly-labeled cards, never merged.
function WhoopCard({ nav, connected }) {
  const [data, setData] = useState(null)
  useEffect(() => {
    if (!connected) return
    fetchWhoopRecovery().then(setData).catch(() => {})
  }, [connected])
  if (!connected || !data?.connected || !data.recovery) return null
  const { score } = data.recovery
  return <div className="card">
    <div className="row between">
      <div style={{ minWidth: 0 }}>
        <h2 style={{ margin: '0 0 2px' }}>{t('Whoop recovery')}</h2>
        <div className="muted small">{t('From your connected Whoop account')}</div>
      </div>
      {score != null && <div className="big" style={{ fontSize: 28 }}>{score}%</div>}
    </div>
  </div>
}

// Home = what to do now + a quick glance. Deep charts & history live in Stats.
export default function Home() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const config = useStore(s => s.config)
  const [weekOffset, setWeekOffset] = useState(0)
  const coachOn = coachAvailable(config, user, { demo: DEMO, mobile: MOBILE })

  const today = new Date()
  const routine = effectiveRoutine(S, todayISO())
  const todayOvr = S.dayPlan[todayISO()] !== undefined

  const monday = new Date(today); monday.setDate(today.getDate() - ((today.getDay() + 6) % 7) + weekOffset * 7)
  const doneDays = new Set(S.workouts.map(w => w.d))
  const strip = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday); d.setDate(monday.getDate() + i)
    const iso = isoOf(d)
    const eff = effectiveRoutineId(S, iso), ovr = S.dayPlan[iso] !== undefined, done = doneDays.has(iso)
    const dot = done ? ' done' : ovr && eff ? ' ovr' : eff ? ' plan' : ''
    strip.push(<div key={i} className={'wday' + (iso === todayISO() ? ' today' : '')} onClick={() => dayOverrideSheet(iso)}>
      <div className="lbl">{t(DAYS[d.getDay()])}</div><div className="num">{d.getDate()}</div><div className={'dot' + dot} /></div>)
  }
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6)
  const wkLabel = weekOffset === 0 ? t('This week') : `${monday.getDate()} ${monday.toLocaleDateString(dateLocale(), { month: 'short' })} – ${sunday.getDate()} ${sunday.toLocaleDateString(dateLocale(), { month: 'short' })}`

  const wThisWeek = S.workouts.filter(w => weekKey(w.d) === weekKey(todayISO())).length
  const plannedPerWeek = Object.values(activeWeek(S)).filter(Boolean).length

  // today's session shown right under the week strip
  const todaysWorkouts = S.workouts.filter(w => w.d === todayISO())
  const doneToday = todaysWorkouts.length > 0
  const onToday = () => {
    if (S.active) nav('/workout')
    else if (doneToday) (todaysWorkouts.length === 1 ? workoutDetailSheet(todaysWorkouts[0]) : calendarSheet(todayISO()))
    else if (routine) startFlow(routine.id)
    else dayOverrideSheet(todayISO())
  }

  return <div className="narrow">
    <div className="home-hero">
      <div className="home-hero-bg" />
      <h1>{user ? t('Hi {0}', user.name) : '2J Fitness'}</h1>
      <div className="sub">{today.toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}</div>
    </div>

    <div className="card">
      <div className="row between" style={{ marginBottom: 8 }}>
        <button className="iconbtn" style={{ width: 30, height: 30, fontSize: 15 }} onClick={() => setWeekOffset(w => w - 1)} aria-label={t('Previous week')}><Icon name="chevronLeft" /></button>
        <div className="small muted" style={{ fontWeight: 500 }}>{wkLabel}</div>
        <button className="iconbtn" style={{ width: 30, height: 30, fontSize: 15 }} onClick={() => setWeekOffset(w => w + 1)} aria-label={t('Next week')}><Icon name="chevronRight" /></button>
      </div>
      <div className="week">{strip}</div>
      <div className="today-row" onClick={onToday}>
        <div className="row" style={{ gap: 9, minWidth: 0 }}>
          <span className="lrow-i" style={{ background: S.active ? 'var(--orange)' : doneToday ? 'var(--green)' : routine ? 'var(--acc)' : 'var(--surface-3)' }}>
            <Icon name={S.active ? 'timer' : doneToday ? 'check' : routine ? glyphOf(routine.emoji) : 'moon'} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="lbl2">{t('Today')}</div>
            <div className="ttl">{S.active ? t('{0} — in progress', S.active.name) : doneToday ? (routine ? routine.name : todaysWorkouts[0].name) : routine ? routine.name : t('Rest day')}{todayOvr && routine ? ' · ' + t('rescheduled') : ''}</div>
          </div>
        </div>
        {S.active ? <span className="tag" style={{ color: 'var(--orange)', background: 'color-mix(in srgb,var(--orange) 16%,transparent)' }}>{t('Resume')}</span>
          : doneToday ? <span className="tag" style={{ color: 'var(--green)', background: 'color-mix(in srgb,var(--green) 16%,transparent)' }}>{t('Done')}</span>
          : routine ? <span className="tag acc">{t('Start')}</span>
          : <Icon name="plus" className="chev" />}
      </div>
    </div>

    <div className="card tappable" style={{ cursor: 'pointer' }} onClick={() => calendarSheet()}>
      <div className="row between">
        <div>
          <div className="row" style={{ gap: 7, fontSize: 22, fontWeight: 600, letterSpacing: '-.021em' }}>
            <Icon name="flame" style={{ color: 'var(--orange)' }} />
            {t('{0} week streak', streakWeeks(S))}
          </div>
          <div className="muted small" style={{ marginTop: 2 }}>{wThisWeek}{plannedPerWeek ? ' / ' + plannedPerWeek : ''} {t('this week')} · {t(S.workouts.length === 1 ? '{0} workout total' : '{0} workouts total', S.workouts.length)}</div>
        </div>
        <Icon name="calendar" className="chev" style={{ fontSize: 20 }} />
      </div>
    </div>

    {coachOn && <CoachCard nav={nav} />}

    {!S.routines.length && !S.active && (
      <div className="card">
        <div className="row" style={{ gap: 10, marginBottom: 6 }}>
          <span className="lrow-i"><Icon name="sparkles" /></span>
          <div className="big" style={{ fontSize: 22 }}>{t('Welcome!')}</div>
        </div>
        <div className="muted small" style={{ marginBottom: 12 }}>{t('Set up your weekly routine to get going — or load a ready-made Push / Pull / Legs plan.')}</div>
        {coachOn && <>
          <Button variant="primary" icon="sparkles" onClick={() => nav(hasConsent(S) ? '/coach/intake' : '/coach')}>{t('Let the Coach build it')}</Button>
          <div style={{ height: 8 }} />
        </>}
        <Button variant={coachOn ? 'plain' : 'primary'} icon="sparkles" onClick={loadStarterPlan}>{t('Load starter plan (PPL)')}</Button>
        <div style={{ height: 8 }} /><Button onClick={() => nav('/plan')}>{t('Build my own plan')}</Button>
      </div>
    )}

    <LastWorkoutCard S={S} />

    <RecoveryCard nav={nav} S={S} />

    <WhoopCard nav={nav} connected={!!user?.whoop} />

    <BodyWeightCard S={S} showChart={false} />
  </div>
}
