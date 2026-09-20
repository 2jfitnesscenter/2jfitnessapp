import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { t, nameFor } from '../lib/i18n.js'
import { fmtNum, todayISO, uid } from '../lib/format.js'
import { workoutVolume, effectiveRoutine, modeOf, swapEntryExercise } from '../lib/history.js'
import { buildRoutineEntries } from '../lib/progression.js'
import { EXIDX } from '../lib/exercises.js'
import { ExerciseSearchList, BunkerToolsTrigger, BunkerToolsOverlay, DEFAULT_TIMER_STATE } from './BunkerTools.jsx'
import { musclesOf, MUSCLE_GROUPS } from '../lib/muscles.js'
import { landmarksFor, weeklyGroupVolume, primaryGroupOf } from '../lib/rp-volume.js'
import RpVolumeBar from '../components/RpVolumeBar.jsx'
import { beep, vibrate } from '../lib/sound.js'
import Icon from '../components/Icon.jsx'
import {
  fetchBunkerBoard, fetchBunkerSettings, bunkerCheckin, fetchBunkerSession,
  postBunkerActive, postBunkerRest, postBunkerFinish,
  bunkerAdminCheckin, fetchBunkerAdminSessions, closeBunkerSession, pauseBunkerSession, saveBunkerSettings,
} from '../lib/bunker-api.js'

const BOARD_POLL_MS = 4000
const REST_SEC = 90
const AFTER_SET_MINIMIZE_MS = 20000
const PAIR_KEY = 'gym_bunker_screen'

const elapsed = ms => { const m = Math.floor(ms / 60000); return (m >= 60 ? Math.floor(m / 60) + 'h ' : '') + (m % 60) + 'm' }
const MUSCLE_GROUP_NAME = Object.fromEntries(MUSCLE_GROUPS.map(g => [g.key, g.name]))

/* ============================ live countdown ring (dashboard card + panel header) ============================ */
// `onEnd` fires exactly once per countdown, the instant it reaches zero — the room dashboard's
// hook for the "rest just finished" beep + pulse (settings.enableRestEndBeep/highlightFinishedRest),
// since that moment only exists client-side (the server just hands out a target timestamp).
function RestRing({ endsAt, size = 44, paused, onEnd }) {
  const [left, setLeft] = useState(() => Math.max(0, Math.round((endsAt - Date.now()) / 1000)))
  const endedRef = useRef(false)
  useEffect(() => {
    endedRef.current = false
    setLeft(Math.max(0, Math.round((endsAt - Date.now()) / 1000)))
    const id = setInterval(() => {
      const l = Math.max(0, Math.round((endsAt - Date.now()) / 1000))
      setLeft(l)
      if (l <= 0 && !endedRef.current) { endedRef.current = true; onEnd && onEnd() }
    }, 1000)
    return () => clearInterval(id)
  }, [endsAt])
  if (paused) return <div className="bk-ring bk-ring-paused" style={{ width: size, height: size }}><Icon name="pause" /></div>
  if (!endsAt || left <= 0) return null
  const pct = Math.max(0, Math.min(1, left / REST_SEC))
  const color = pct > 0.5 ? '#10B981' : pct > 0.2 ? '#ffd60a' : '#ff453a'
  const r = size / 2 - 4
  const c = 2 * Math.PI * r
  return (
    <div className="bk-ring" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#2a2a2e" strokeWidth={4} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={4} fill="none"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)} strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dashoffset 1s linear' }} />
      </svg>
      <span className="bk-ring-n">{left}</span>
    </div>
  )
}

/* ============================ community dashboard ============================ */
// One card's own rest-end reaction — a beep + a few seconds of pulsing highlight, each gated
// by its own room setting (a gym that finds the beep annoying can keep the visual pulse alone,
// or neither). Split out from the card markup below only because it owns this bit of timing
// state (the pulse has to turn itself back off) that the card otherwise has no reason to hold.
function CardRest({ s, settings }) {
  const [pulsing, setPulsing] = useState(false)
  const onRestEnd = () => {
    if (settings.enableRestEndBeep) beep(true, 740, 0.2)
    if (settings.highlightFinishedRest) { setPulsing(true); setTimeout(() => setPulsing(false), 6000) }
  }
  return <>
    {s.restEndsAt && <RestRing endsAt={s.restEndsAt} paused={s.paused} onEnd={onRestEnd} />}
    {pulsing && <i className="bk-card-pulse" />}
  </>
}
function BunkerDashboard({ board, settings, paired, onCheckin, onAdmin, onExitTap, onOpenTools }) {
  const gridStyle = settings.columns === 'auto'
    ? { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16, flex: 1, alignContent: 'start' }
    : { '--cols': settings.columns || 4 }
  return <div className="bk-dash">
    <div className="bk-hd">
      <div className="bk-hd-title" onClick={onExitTap}>{settings.header || '2J Fitness Center'}</div>
      {paired && <span className="bk-paired-badge">{paired.label}</span>}
      <BunkerToolsTrigger onClick={onOpenTools} />
      <button className="bk-admin-btn" aria-label={t('Room admin')} onClick={onAdmin}><Icon name="gear" /></button>
    </div>
    {board.length === 0 ? (
      <div className="bk-empty">{t('Nobody checked in yet — be the first.')}</div>
    ) : (
      <div className={settings.columns === 'auto' ? undefined : 'bk-grid'} style={gridStyle}>
        {board.map(s => (
          <div className={'bk-card' + (s.paused ? ' paused' : '')} key={s.uid}>
            <div className="bk-card-top">
              <div className="bk-card-name">{s.name}</div>
              <span className="bk-card-elapsed">{elapsed(Date.now() - s.checkinAt)}</span>
            </div>
            {s.exName ? <>
              <div className="bk-card-ex">{s.exName}</div>
              <div className="bk-card-set">
                {s.paused ? t('Paused') : t('Set {0} of {1}', Math.min(s.setIdx + 1, s.setsTotal || 1), s.setsTotal || 1)}
              </div>
            </> : <div className="bk-card-ex dim">{t('Getting ready…')}</div>}
            <CardRest s={s} settings={settings} />
          </div>
        ))}
      </div>
    )}
    <button className="bk-join" onClick={onCheckin}><Icon name="plus" /> {t('Join the Bunker')}</button>
  </div>
}

/* ============================ PIN check-in pad ============================ */
function BunkerCheckinPad({ onClose, onSuccess }) {
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const press = d => { if (pin.length < 4 && !busy) setPin(p => p + d) }
  const back = () => setPin(p => p.slice(0, -1))
  useEffect(() => {
    if (pin.length !== 4) return
    setBusy(true); setErr('')
    bunkerCheckin(pin).then(onSuccess).catch(e => { setErr(e.message); setPin(''); setBusy(false) })
  }, [pin])
  return <div className="bk-overlay">
    <div className="bk-pad">
      <button className="bk-close" onClick={onClose} aria-label={t('Close')}><Icon name="xmark" /></button>
      <div className="bk-pad-title">{t('Enter your PIN')}</div>
      <div className="bk-pad-dots">{[0, 1, 2, 3].map(i => <span key={i} className={'bk-dot' + (i < pin.length ? ' on' : '')} />)}</div>
      {err && <div className="bk-pad-err">{err}</div>}
      <div className="bk-keys">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k, i) => (
          <button key={i} disabled={!k || busy} className={'bk-key' + (!k ? ' ghost' : '')}
            onClick={() => k === '⌫' ? back() : k && press(k)}>{k}</button>
        ))}
      </div>
    </div>
  </div>
}

/* ============================ individual training panel ============================ */
// A brand-new session for `routine`, built with the exact same shared helper the phone app's
// beginWorkout()/beginPastWorkout() use (lib/progression.js's buildRoutineEntries) — hidden
// exercises, supersets, progression and buildSets() all behave identically here, because it is
// the same function, not a second guess at what it does.
function buildBunkerActive(S, routine) {
  return {
    id: uid(), d: todayISO(), start: Date.now(), routineId: routine.id,
    name: routine.name, bw: null, cur: 0,
    entries: buildRoutineEntries(S, routine),
  }
}
function lastResultFor(recentWorkouts, exId) {
  for (let i = recentWorkouts.length - 1; i >= 0; i--) {
    const e = recentWorkouts[i].entries.find(x => x.id === exId)
    if (e) { const best = e.sets.filter(s => s.done).sort((a, b) => b.w - a.w)[0]; if (best) return best }
  }
  return null
}
function exName(exId, customEx) {
  // The kiosk isn't "logged in" as this member in the normal sense (see the module's own
  // security-boundary comment), so useStore's usual registerCustom() never merges their
  // custom exercises into the shared EXIDX — check the session's own customEx list first,
  // same as EXIDX itself is just the real library plus whichever account is signed in.
  const c = (customEx || []).find(x => x.id === exId)
  if (c) return c.n
  const ex = EXIDX[exId]
  return ex ? nameFor(ex) : exId
}

function BunkerTrainingPanel({ token, name, settings, onExit, onOpenTools }) {
  const [plan, setPlan] = useState(null)
  const [active, setActive] = useState(null)
  const [exIdx, setExIdx] = useState(0)
  const [restEndsAt, setRestEndsAt] = useState(null)
  const [showSwap, setShowSwap] = useState(false)
  const idleRef = useRef(null)
  const minimizeRef = useRef(null)
  const idleMs = (settings?.autoLockSec || 60) * 1000

  const armIdle = ms => { clearTimeout(idleRef.current); idleRef.current = setTimeout(onExit, ms) }
  const touch = () => armIdle(idleMs)

  useEffect(() => {
    fetchBunkerSession(token).then(p => {
      setPlan(p)
      // Same resolver the rest of the app uses for "today's routine" (Home, Stats, the phone
      // logger) — dayPlan's own override first, then an active program's own week, then the
      // flat S.week — never a second, poorer guess that only ever checked the flat week.
      const miniS = {
        week: p.week, dayPlan: p.dayPlan, programs: p.programs, activeProgramId: p.activeProgramId,
        routines: p.routines,
      }
      const routine = effectiveRoutine(miniS, todayISO())
      // A session already in progress (started here or on the member's own phone) is resumed
      // exactly as-is — never rebuilt, never reset. Only a routine with no open session yet
      // gets a fresh one built from today's plan.
      setActive(p.active || (routine ? buildBunkerActive({ ...miniS, unit: p.unit, workouts: p.recentWorkouts, exWeights: p.exWeights, tests: p.tests, showPreviousResults: p.showPreviousResults, warmupEnabled: p.warmupEnabled }, routine) : null))
      armIdle(idleMs)
    }).catch(() => onExit())
    return () => { clearTimeout(idleRef.current); clearTimeout(minimizeRef.current) }
  }, [token])

  if (!plan) return <div className="bk-panel"><div className="bk-loading">{t('Loading…')}</div></div>
  if (!active) return <div className="bk-panel">
    <div className="bk-panel-hd">
      <button className="bk-minimize" onClick={onExit}><Icon name="chevronDown" /> {t('Minimize / resting')}</button>
      <div className="bk-panel-name">{name}</div>
    </div>
    <div className="bk-empty">{t('No routine assigned for this session.')}</div>
  </div>

  const sync = next => {
    setActive(next)
    const entry = next.entries[exIdx]
    const doneN = entry ? entry.sets.filter(s => s.done).length : 0
    postBunkerActive(token, { active: next, exId: entry?.id || null, exName: entry ? exName(entry.id, plan.customEx) : null, setIdx: doneN, setsTotal: entry?.sets.length || 0 }).catch(() => {})
  }
  const setField = (ei, si, field, delta) => {
    touch()
    const next = { ...active, entries: active.entries.map((e, i) => i !== ei ? e : {
      ...e, sets: e.sets.map((s, j) => j !== si ? s : { ...s, [field]: Math.max(0, Math.round((s[field] + delta) * 10) / 10) }),
    }) }
    sync(next)
  }
  const toggleDone = (ei, si) => {
    touch()
    const willBeDone = !active.entries[ei].sets[si].done
    const next = { ...active, entries: active.entries.map((e, i) => i !== ei ? e : {
      ...e, sets: e.sets.map((s, j) => j !== si ? s : { ...s, done: willBeDone }),
    }) }
    sync(next)
    if (willBeDone) {
      beep(true, 880, 0.15); vibrate(40)
      const endsAt = Date.now() + REST_SEC * 1000
      setRestEndsAt(endsAt)
      postBunkerRest(token, REST_SEC).catch(() => {})
      clearTimeout(minimizeRef.current)
      minimizeRef.current = setTimeout(onExit, AFTER_SET_MINIMIZE_MS)
    }
  }
  // Same semantics as Workout.jsx's own replaceExercise (issue tracked in lib/history.js's
  // swapEntryExercise doc comment): only the id changes. Whatever was already there for this
  // slot — target, plan, sets, including any already marked done — carries over untouched, so a
  // set logged before the swap stays exactly as logged, now just attributed to the new exercise.
  // Bunker has no routine to offer "keep this swap?" against (there's nothing to write it back
  // into — S.routines/dayPlan are never touched), so unlike the phone this never prompts.
  const doSwap = newEx => {
    touch()
    sync({ ...active, entries: swapEntryExercise(active.entries, exIdx, newEx.id) })
    setShowSwap(false)
  }

  const finish = () => {
    const w = {
      id: active.id, d: active.d, start: active.start, end: Date.now(), routineId: active.routineId, name: active.name, bw: active.bw,
      entries: active.entries.map(e => ({ id: e.id, sets: e.sets, target: e.target })).filter(e => e.sets.some(s => s.done)),
      prs: [],
    }
    w.vol = workoutVolume(w)
    postBunkerFinish(token, w).then(onExit).catch(() => onExit())
  }

  const entry = active.entries[exIdx]
  const last = entry ? lastResultFor(plan.recentWorkouts, entry.id) : null

  // Per-athlete RP Volume Zones (Fase V2 §2's "hidratación estricta de preferencias
  // individuales") — only ever read from THIS athlete's own session payload, which the server
  // already scoped to their account (see api/bunker/routes.js's sessionPayload); nothing here
  // is global room state, so it can never leak into whoever checks in next. A minimal
  // S-shaped object is enough for weeklyGroupVolume/landmarksFor to work unmodified — they only
  // ever read S.workouts/S.active/S.trainingLevel/S.rpVolumeOverrides.
  let rpBar = null
  if (plan.enableRpVolumeZones && entry) {
    const miniS = {
      workouts: plan.recentWorkouts, active, enableRpVolumeZones: true,
      trainingLevel: plan.trainingLevel, rpVolumeOverrides: plan.rpVolumeOverrides,
      countSecondaryMuscles: plan.countSecondaryMuscles, secondaryMuscleFactor: plan.secondaryMuscleFactor,
    }
    const opts = { countSecondary: plan.countSecondaryMuscles, secondaryFactor: plan.secondaryMuscleFactor }
    const groupKey = primaryGroupOf(musclesOf(EXIDX[entry.id], opts))
    if (groupKey) {
      const landmarks = landmarksFor(miniS, groupKey)
      const volume = weeklyGroupVolume(miniS, opts)
      rpBar = <RpVolumeBar groupName={t(MUSCLE_GROUP_NAME[groupKey] || groupKey)} sets={volume[groupKey] || 0} landmarks={landmarks} />
    }
  }

  return <div className="bk-panel" onClick={touch}>
    <div className="bk-panel-hd">
      <button className="bk-minimize" onClick={onExit}><Icon name="chevronDown" /> {t('Minimize / resting')}</button>
      <div className="bk-panel-name">{name}</div>
      {restEndsAt && <RestRing endsAt={restEndsAt} size={52} />}
      <BunkerToolsTrigger onClick={onOpenTools} />
    </div>
    <div className="bk-routine-name">{active.name}</div>
    <div className="bk-exlist">
      {active.entries.map((e, i) => {
        const doneN = e.sets.filter(s => s.done).length
        return <button key={i} className={'bk-extab' + (i === exIdx ? ' on' : '') + (doneN === e.sets.length ? ' done' : '')}
          onClick={() => { touch(); setExIdx(i) }}>
          {exName(e.id, plan.customEx)}<span className="bk-extab-n">{doneN}/{e.sets.length}</span>
        </button>
      })}
    </div>
    {entry && <div className="bk-sets">
      <div className="bk-exname-row">
        <div className="bk-exname">{exName(entry.id, plan.customEx)}</div>
        <button className="bk-exchange-btn" onClick={() => { touch(); setShowSwap(true) }}>
          <Icon name="shuffle" />{t('Change exercise')}
        </button>
      </div>
      {/* Same plan.why the phone logger's own .progline shows (lib/progression.js's
          nextPrescription) — what the routine planned for this exercise and why, kept visibly
          separate from the editable set rows below (what is actually being done). */}
      {entry.plan?.why && entry.plan.kind !== 'off' && <div className="bk-last">{t('Planned: {0}', t(...entry.plan.why))}</div>}
      {last && <div className="bk-last">{t('Last time: {0} × {1}', fmtNum(last.w), last.r)}</div>}
      {rpBar && <div className="bk-rpbar">{rpBar}</div>}
      {entry.sets.map((s, si) => {
        // Cardio sets (lib/history.js's buildSets) carry {min, speed}, never {w, r} — the two
        // big steppers below switch what they edit by mode, same distinction Workout.jsx's own
        // ExerciseBlock makes, instead of assuming every set is a weight×reps one.
        const cardio = modeOf(entry.target || {}) === 'cardio'
        return <div key={si} className={'bk-setrow' + (s.done ? ' done' : '')}>
          <span className="bk-setn">{si + 1}</span>
          {cardio ? <>
            <div className="bk-bigstp">
              <button onClick={() => setField(exIdx, si, 'min', -1)}>−</button>
              <span className="bk-bigstp-v">{fmtNum(s.min)}<i>{t('min')}</i></span>
              <button onClick={() => setField(exIdx, si, 'min', 1)}>+</button>
            </div>
            <div className="bk-bigstp">
              <button onClick={() => setField(exIdx, si, 'speed', -0.5)}>−</button>
              <span className="bk-bigstp-v">{fmtNum(s.speed)}<i>{t('km/h')}</i></span>
              <button onClick={() => setField(exIdx, si, 'speed', 0.5)}>+</button>
            </div>
          </> : <>
            <div className="bk-bigstp">
              <button onClick={() => setField(exIdx, si, 'w', -2.5)}>−</button>
              <span className="bk-bigstp-v">{fmtNum(s.w)}<i>{plan.unit}</i></span>
              <button onClick={() => setField(exIdx, si, 'w', 2.5)}>+</button>
            </div>
            <div className="bk-bigstp">
              <button onClick={() => setField(exIdx, si, 'r', -1)}>−</button>
              <span className="bk-bigstp-v">{fmtNum(s.r)}<i>{entry.target?.mode === 'time' ? 's' : t('reps')}</i></span>
              <button onClick={() => setField(exIdx, si, 'r', 1)}>+</button>
            </div>
          </>}
          <button className={'bk-check' + (s.done ? ' on' : '')} onClick={() => toggleDone(exIdx, si)} aria-label={t('Done')}><Icon name="check" /></button>
        </div>
      })}
    </div>}
    <button className="bk-finish" onClick={finish}>{t('Finish workout & exit')}</button>
    {showSwap && <div className="bk-overlay">
      <div className="bk-pad bk-tools-pad">
        <button className="bk-close" onClick={() => setShowSwap(false)} aria-label={t('Close')}><Icon name="xmark" /></button>
        <div className="bk-pad-title">{t('Change exercise')}</div>
        <ExerciseSearchList excludeId={entry?.id} onPick={doSwap} />
      </div>
    </div>}
  </div>
}

/* ============================ admin overlay (kiosk-code or trainer-cookie) ============================ */
function BunkerAdminLogin({ onClose, onSuccess }) {
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = () => {
    setBusy(true); setErr('')
    bunkerAdminCheckin(code).then(r => onSuccess(r.token)).catch(e => { setErr(e.message); setBusy(false) })
  }
  return <div className="bk-overlay">
    <div className="bk-pad">
      <button className="bk-close" onClick={onClose} aria-label={t('Close')}><Icon name="xmark" /></button>
      <div className="bk-pad-title">{t('Trainer/admin code')}</div>
      <input className="bk-code-input" inputMode="numeric" maxLength={6} value={code}
        onChange={e => setCode(e.target.value.replace(/\D/g, ''))} autoFocus />
      {err && <div className="bk-pad-err">{err}</div>}
      <button className="bk-join" disabled={busy || code.length < 6} onClick={submit}>{t('Unlock')}</button>
    </div>
  </div>
}
function BunkerAdminOverlay({ adminToken, onClose }) {
  const nav = useNavigate()
  const [sessions, setSessions] = useState([])
  const [settings, setSettings] = useState(null)
  const load = () => {
    fetchBunkerAdminSessions(adminToken).then(setSessions).catch(() => {})
    fetchBunkerSettings().then(setSettings).catch(() => {})
  }
  useEffect(() => { load(); const id = setInterval(load, 5000); return () => clearInterval(id) }, [])
  const close = uid => closeBunkerSession(uid, adminToken).then(load)
  const togglePause = (uid, paused) => pauseBunkerSession(uid, paused, adminToken).then(load)
  const setCols = n => saveBunkerSettings({ columns: n }, adminToken).then(setSettings)
  const setBeep = v => saveBunkerSettings({ enableRestEndBeep: v }, adminToken).then(setSettings)
  return <div className="bk-overlay">
    <div className="bk-pad bk-admin-pad">
      <button className="bk-close" onClick={onClose} aria-label={t('Close')}><Icon name="xmark" /></button>
      <div className="bk-pad-title">{t('Room admin')}</div>
      <div className="bk-admin-list">
        {sessions.length === 0 && <div className="dim small">{t('Nobody checked in yet — be the first.')}</div>}
        {sessions.map(s => (
          <div key={s.uid} className="bk-admin-row">
            <span>{s.name}{s.paused ? ' · ' + t('Paused') : ''}</span>
            <div className="row" style={{ gap: 6 }}>
              <button className="bk-admin-x" onClick={() => togglePause(s.uid, !s.paused)} aria-label={s.paused ? t('Resume') : t('Pause')}>
                <Icon name={s.paused ? 'play' : 'pause'} />
              </button>
              <button className="bk-admin-x" onClick={() => close(s.uid)} aria-label={t('Force close session')}><Icon name="xmark" /></button>
            </div>
          </div>
        ))}
      </div>
      {settings && <>
        <div className="bk-admin-setting">
          <span>{t('Grid columns')}</span>
          <div className="row" style={{ gap: 6 }}>
            {['auto', 2, 3, 4, 6].map(n => <button key={n} className={'bk-key sm' + (settings.columns === n ? ' on' : '')} onClick={() => setCols(n)}>{n === 'auto' ? t('Auto') : n}</button>)}
          </div>
        </div>
        <div className="bk-admin-setting">
          <span>{t('Rest-over sound alert')}</span>
          <button className={'bk-key sm' + (settings.enableRestEndBeep ? ' on' : '')} onClick={() => setBeep(!settings.enableRestEndBeep)}>
            {settings.enableRestEndBeep ? t('On') : t('Off')}
          </button>
        </div>
      </>}
      <button className="bk-join" style={{ marginTop: 16, width: '100%' }} onClick={() => nav('/admin/bunker')}>
        <Icon name="dumbbell" /> {t('Open the full admin panel')}
      </button>
    </div>
  </div>
}

const DEFAULT_SETTINGS = { columns: 4, header: '2J Fitness Center', enableRestEndBeep: true, highlightFinishedRest: true, hideWeightsInPublicView: false, autoLockSec: 60 }

/* ============================ root ============================ */
export default function Bunker() {
  const nav = useNavigate()
  const [board, setBoard] = useState([])
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [session, setSession] = useState(null)
  const [showCheckin, setShowCheckin] = useState(false)
  const [showAdminLogin, setShowAdminLogin] = useState(false)
  const [showExitLock, setShowExitLock] = useState(false)
  const [adminToken, setAdminToken] = useState(null)
  // Generic tools (V3.2) — 'hub' | 'library' | 'plates' | 'rm' | 'timer' | 'warmup' | null.
  // Root-level on purpose: neither this nor the timer's own running state should reset just
  // because the dashboard/training-panel branch underneath re-renders or the member switches
  // which tool they're looking at.
  const [tool, setTool] = useState(null)
  const [timer, setTimer] = useState(DEFAULT_TIMER_STATE)
  const tapsRef = useRef([])
  const paired = (() => { try { return JSON.parse(localStorage.getItem(PAIR_KEY) || 'null') } catch { return null } })()

  useEffect(() => {
    let alive = true
    const poll = () => fetchBunkerBoard().then(s => alive && setBoard(s)).catch(() => {})
    poll()
    const id = setInterval(poll, BOARD_POLL_MS)
    return () => { alive = false; clearInterval(id) }
  }, [])
  useEffect(() => { fetchBunkerSettings().then(setSettings).catch(() => {}) }, [])

  // A discreet way off a public kiosk — three quick taps on the room header, then the same
  // admin code the room-admin overlay already asks for, rather than a visible "exit" button
  // anyone walking past could tap by accident.
  const onExitTap = () => {
    const now = Date.now()
    tapsRef.current = [...tapsRef.current.filter(t => now - t < 1200), now]
    if (tapsRef.current.length >= 3) { tapsRef.current = []; setShowExitLock(true) }
  }

  const toolsOverlay = <BunkerToolsOverlay tool={tool} onSelect={setTool} onClose={() => setTool(null)} timer={timer} setTimer={setTimer} />

  if (adminToken) return <div className="bunker"><BunkerAdminOverlay adminToken={adminToken} onClose={() => setAdminToken(null)} />{toolsOverlay}</div>
  if (session) return <div className="bunker">
    <BunkerTrainingPanel token={session.token} name={session.name} settings={settings} onExit={() => setSession(null)} onOpenTools={() => setTool('hub')} />
    {toolsOverlay}
  </div>

  return <div className="bunker">
    <BunkerDashboard board={board} settings={settings} paired={paired}
      onCheckin={() => setShowCheckin(true)} onAdmin={() => setShowAdminLogin(true)} onExitTap={onExitTap} onOpenTools={() => setTool('hub')} />
    {showCheckin && <BunkerCheckinPad onClose={() => setShowCheckin(false)} onSuccess={s => { setSession(s); setShowCheckin(false) }} />}
    {showAdminLogin && <BunkerAdminLogin onClose={() => setShowAdminLogin(false)} onSuccess={tok => { setAdminToken(tok); setShowAdminLogin(false) }} />}
    {showExitLock && <BunkerAdminLogin onClose={() => setShowExitLock(false)} onSuccess={() => nav('/home')} />}
    {toolsOverlay}
  </div>
}
