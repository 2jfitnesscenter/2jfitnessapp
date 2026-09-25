import { useEffect, useMemo, useState } from 'react'
import { latestAdvance, closestGoal } from '../lib/mi2j.js'
import { TIER_COLOR, rankLabel, rankEmblemUrl, RANK_GROUP_NAME } from '../lib/rank.js'
import { EventRow } from '../components/Mi2JEvents.jsx'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { effectiveRoutine, effectiveRoutineId, activeWeek, streakWeeks, setsDoneActive, setsDone } from '../lib/history.js'
import { fmtVol, todayISO, isoOf, weekKey, DAYS } from '../lib/format.js'
import { t, dateLocale } from '../lib/i18n.js'
import { dayOverrideSheet, calendarSheet, startFlow, loadStarterPlan, workoutDetailSheet, openEventDetail } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import BodyMap, { BodyMapLegend } from '../components/BodyMap.jsx'
import BodyWeightCard from '../components/BodyWeightCard.jsx'
import WorkoutCover from '../components/WorkoutCover.jsx'
import { glyphOf } from '../lib/glyphs.js'
import { coachAvailable, hasConsent } from '../lib/coach.js'
import { useCoachStatus } from '../lib/coach-api.js'
import { DEMO } from '../lib/demo.js'
import { MOBILE } from '../lib/mobile.js'
import { loadOfWorkouts, muscleOptsOf, MUSCLE_NAME } from '../lib/muscles.js'
import RecoveryCard from '../components/RecoveryCard.jsx'
import { daysSinceBioimpedance } from '../lib/measurements.js'
import { fetchWhoopRecovery, fetchWhoopSleep } from '../lib/whoop-api.js'
import { mergeSeries } from '../lib/import-csv.js'

// Full-screen expansion of the compact body map below — the same load, just big enough to
// tap a muscle and read its exact set count, the way Stats.jsx's own Muscle balance card
// already lets you do for a wider window. Opened as a 'full' sheet (Modals.jsx) since a
// pinch-to-read body map is exactly the kind of thing a bottom sheet's own max-height cuts off.
function WorkoutBodyMapModal({ w, S, close }) {
  const [sel, setSel] = useState(null)
  const load = loadOfWorkouts([w], null, muscleOptsOf(S))
  const sets = m => Math.round((load[m] || 0) * 10) / 10
  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={close} aria-label={t('Close')}><Icon name="xmark" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1>{w.name}</h1></div>
    </div>
    <div className="card">
      <BodyMap className="tappable" load={load} body={S.body} selected={sel}
        onMuscle={m => setSel(s => (s === m ? null : m))} />
      <BodyMapLegend />
      {sel && <div className="mrow" style={{ borderTop: 'var(--hair) solid var(--sep)', marginTop: 4, paddingTop: 10 }}>
        <span className="nm"><b>{t(MUSCLE_NAME[sel])}</b></span>
        <span className="v">{sets(sel) ? t('{0} sets', sets(sel)) : t('not trained')}</span>
      </div>}
    </div>
  </div>
}

// The left half of Home's own 2-column glance row (.home-grid2) — a condensed tap-through to
// the most recently finished workout: short header, one line of key metrics ("16 series ·
// 5.653 kg"), and a shrunk body map (index.css's .home-bodymap-sm) that opens its own
// full-screen detail on tap — stopping the event so that tap doesn't also fire the card's own
// onClick (which opens the workout detail sheet instead). Same card either half of the grid
// row got in the previous, full-width layout, just laid out for half the space.
function LastWorkoutCard({ S }) {
  const w = S.workouts.length ? S.workouts[S.workouts.length - 1] : null
  if (!w) return null
  const openMap = e => { e.stopPropagation(); useUI.getState().openSheet(close => <WorkoutBodyMapModal w={w} S={S} close={close} />, { kind: 'full' }) }
  return <div className="card home-half tappable" style={{ cursor: 'pointer' }} onClick={() => workoutDetailSheet(w)}>
    <div className="row between" style={{ marginBottom: 6 }}>
      <div className="home-half-ttl">{t('Last workout')}</div>
      <Icon name="chevronRight" className="chev" style={{ fontSize: 15 }} />
    </div>
    <div className="home-half-sub">{t('{0} sets · {1}', setsDone(w), fmtVol(w.vol, S.unit))}</div>
    <div className="home-bodymap-sm tappable" style={{ cursor: 'pointer' }} onClick={openMap}>
      <BodyMap load={loadOfWorkouts([w], null, muscleOptsOf(S))} body={S.body} />
    </div>
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

// Nudges toward a fresh body-composition scan once the member's own chosen cadence (15/30
// days, Settings → General → Bioimpedance reminder) has passed since the last one. Renders
// nothing when there's nothing to say — same rule CoachCard follows above — so a brand-new
// profile with no scan on file yet (daysSinceBioimpedance returns null: nothing is "overdue"
// when nothing has ever been logged) never sees this ahead of its first one.
function BioimpedanceReminderCard({ S, nav }) {
  if (S.enableBioimpedanceReminder === false) return null
  const days = daysSinceBioimpedance(S)
  const cadence = S.bioimpedanceReminderDays || 15
  if (days === null || days < cadence) return null
  return <div className="card tappable" style={{ cursor: 'pointer' }} onClick={() => nav('/measurements')}>
    <div className="row" style={{ gap: 10 }}>
      <span className="lrow-i" style={{ background: 'var(--orange)' }}><Icon name="calendar" /></span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="ttl">{t('Time for a new scan')}</div>
        <div className="muted small" style={{ marginTop: 2 }}>
          {t('It’s been {0} days since your last body-composition measurement — tap to log a new one.', days)}
        </div>
      </div>
      <Icon name="chevronRight" className="chev" />
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
  // Whoop also tracks sleep, same as recovery — merged straight into S.sleep so it lands in the
  // same calendar an Apple Health import fills in (Profile → Health), and persists like anything
  // else the app tracks, not just a number shown while this card happens to be on screen. Runs
  // whenever Home mounts with Whoop connected; each night is de-duped by date the same way a
  // re-imported export.xml is, so this never double-counts a night already merged in.
  useEffect(() => {
    if (!connected) return
    fetchWhoopSleep().then(res => {
      if (!res.connected || !res.sleep?.length) return
      let added = 0
      useStore.getState().update(s => {
        const merged = mergeSeries(s.sleep, res.sleep)
        s.sleep = merged.list
        added = merged.added
      })
      if (added > 0) useUI.getState().toast(t('{0} nights of sleep synced from Whoop', added))
    }).catch(() => {})
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
  const streak = streakWeeks(S)
  // Mi 2J highlights, derived once per history change (lib/mi2j.js) — Home shows one recent
  // step forward and one goal that is genuinely close; the full detail lives in Mi 2J.
  const advance = useMemo(() => latestAdvance(S), [S.workouts, S.bodyweight, S.badges])
  const goal = useMemo(() => S.workouts.length ? closestGoal(S) : null, [S.workouts, S.bodyweight, S.badges, S.tests, S.body])

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

    {/* Entrena con 2J: one discreet way into the official guided routines (no extra tab). */}
    <button className="card tappable t2-promo" onClick={() => nav('/train2j')}>
      <WorkoutCover r={{ id: 'home-promo', category: 'tabata' }} shape="square" />
      <span className="grow">
        <span className="t2-promo-k">{t('Train with 2J')}</span>
        <span className="t2-promo-t">{t('Ready-to-start workouts: Tabata, HIIT, circuits, cardio and mobility.')}</span>
      </span>
      <Icon name="chevronRight" className="chev" />
    </button>

    {/* Your week + constancy. Never a scolding: a streak that ended simply starts again. */}
    {S.workouts.length > 0 && <button className="card tappable home-week" onClick={() => calendarSheet()} aria-label={t('Your week')}>
      <div className="row between" style={{ alignItems: 'baseline' }}>
        <span className="home-week-k">{t('Your week')}</span>
        <span className="home-week-streak"><Icon name="flame" />{streak >= 1 ? t(streak === 1 ? '{0} week in a row' : '{0} weeks in a row', streak) : t('A new streak starts with your next workout')}</span>
      </div>
      <div className="home-week-v">{plannedPerWeek ? t('{0} of {1} workouts', wThisWeek, plannedPerWeek) : t(wThisWeek === 1 ? '{0} workout' : '{0} workouts', wThisWeek)}</div>
      {plannedPerWeek > 0 && <div className="rk-bar" role="progressbar" aria-valuemin={0} aria-valuemax={plannedPerWeek} aria-valuenow={Math.min(wThisWeek, plannedPerWeek)}>
        <i style={{ width: Math.min(100, Math.round(wThisWeek / plannedPerWeek * 100)) + '%', background: 'var(--acc)' }} />
      </div>}
      <div className="muted small" style={{ marginTop: 6 }}>{t(S.workouts.length === 1 ? '{0} workout total' : '{0} workouts total', S.workouts.length)}</div>
    </button>}

    {advance && <div className="card home-adv">
      <div className="home-sec-k">{t('Latest step forward')}</div>
      <EventRow ev={advance} unit={S.unit} onOpen={() => openEventDetail(advance, advance.d)} />
    </div>}

    {goal && <button className="card home-goal" onClick={() => nav(goal.type === 'rank' ? '/rank' : '/badges')}>
      <div className="home-sec-k">{t('Close to')}</div>
      {goal.type === 'rank' ? <div className="home-goal-r">
        <img src={rankEmblemUrl(goal.group.next.tier, goal.group.next.division)} alt="" />
        <div className="grow">
          <div className="tt">{t(RANK_GROUP_NAME[goal.group.key])}</div>
          <div className="small">{rankLabel(goal.group.rank)} → <b style={{ color: TIER_COLOR[goal.group.next.tier] }}>{rankLabel(goal.group.next)}</b></div>
          <div className="rk-bar" style={{ marginTop: 6 }}><i style={{ width: Math.round(goal.group.progress * 100) + '%', background: TIER_COLOR[goal.group.rank.tier] }} /></div>
        </div>
      </div> : <div className="home-goal-r">
        {goal.badge.image ? <img src={goal.badge.image} alt="" /> : <Icon name={goal.badge.icon} />}
        <div className="grow">
          <div className="tt">{t(goal.badge.title)}</div>
          <div className="small muted">{t(goal.badge.description)}</div>
          <div className="rk-bar" style={{ marginTop: 6 }}><i style={{ width: Math.round(goal.progress * 100) + '%', background: 'var(--acc)' }} /></div>
        </div>
      </div>}
    </button>}

    {coachOn && <CoachCard nav={nav} />}

    <BioimpedanceReminderCard S={S} nav={nav} />

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

    <div className="home-grid2">
      <LastWorkoutCard S={S} />
      <RecoveryCard nav={nav} S={S} compact />
    </div>

    <WhoopCard nav={nav} connected={!!user?.whoop} />

    {/* Body composition lives in Profile → Health / Measurements only (Constructor V2.1): Home
        used to show the same segment diagram a second time. */}
    <BodyWeightCard S={S} showChart={false} />
  </div>
}
