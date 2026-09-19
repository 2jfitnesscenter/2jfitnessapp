import { useEffect, useRef, useState } from 'react'
import { t, nameFor } from '../lib/i18n.js'
import { fmtNum, todayISO, uid } from '../lib/format.js'
import { workoutVolume } from '../lib/history.js'
import { EXIDX } from '../lib/exercises.js'
import { beep, vibrate } from '../lib/sound.js'
import Icon from '../components/Icon.jsx'
import {
  fetchBunkerBoard, fetchBunkerSettings, bunkerCheckin, fetchBunkerSession,
  postBunkerActive, postBunkerRest, postBunkerFinish,
  bunkerAdminCheckin, fetchBunkerAdminSessions, closeBunkerSession, saveBunkerSettings,
} from '../lib/bunker-api.js'

const BOARD_POLL_MS = 4000
const REST_SEC = 90
const AFTER_SET_MINIMIZE_MS = 20000
const IDLE_LOCK_MS = 60000

/* ============================ live countdown ring (dashboard card + panel header) ============================ */
function RestRing({ endsAt, size = 44 }) {
  const [left, setLeft] = useState(() => Math.max(0, Math.round((endsAt - Date.now()) / 1000)))
  useEffect(() => {
    setLeft(Math.max(0, Math.round((endsAt - Date.now()) / 1000)))
    const id = setInterval(() => setLeft(Math.max(0, Math.round((endsAt - Date.now()) / 1000))), 1000)
    return () => clearInterval(id)
  }, [endsAt])
  if (!endsAt || left <= 0) return null
  const pct = Math.max(0, Math.min(1, left / REST_SEC))
  const color = pct > 0.5 ? '#73b52e' : pct > 0.2 ? '#ffd60a' : '#ff453a'
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
function BunkerDashboard({ board, settings, onCheckin, onAdmin }) {
  return <div className="bk-dash">
    <div className="bk-hd">
      <div className="bk-hd-title">{settings.header || '2J Fitness Center'}</div>
      <button className="bk-admin-btn" aria-label={t('Room admin')} onClick={onAdmin}><Icon name="gear" /></button>
    </div>
    {board.length === 0 ? (
      <div className="bk-empty">{t('Nobody checked in yet — be the first.')}</div>
    ) : (
      <div className="bk-grid" style={{ '--cols': settings.columns || 4 }}>
        {board.map(s => (
          <div className="bk-card" key={s.uid}>
            <div className="bk-card-name">{s.name}</div>
            {s.exName ? <>
              <div className="bk-card-ex">{s.exName}</div>
              <div className="bk-card-set">{t('Set {0} of {1}', Math.min(s.setIdx + 1, s.setsTotal || 1), s.setsTotal || 1)}</div>
            </> : <div className="bk-card-ex dim">{t('Getting ready…')}</div>}
            {s.restEndsAt && <RestRing endsAt={s.restEndsAt} />}
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
function todaysRoutine(week, routines) {
  const wd = new Date().getDay()
  const rid = week?.[wd]
  return routines.find(r => r.id === rid) || null
}
function buildActive(routine, exWeights) {
  return {
    id: uid(), d: todayISO(), start: Date.now(), routineId: routine?.id || null,
    name: routine?.name || t('Freestyle'), bw: null, cur: 0,
    entries: (routine?.ex || []).map(cfg => ({
      id: cfg.id,
      target: { reps: cfg.reps, sec: cfg.sec, mode: cfg.mode || 'reps' },
      sets: Array.from({ length: cfg.sets || 3 }, () => ({
        w: cfg.weight || exWeights?.[cfg.id]?.w || 0,
        r: cfg.mode === 'time' ? (cfg.sec || 30) : (cfg.reps || 10),
        done: false,
      })),
    })),
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

function BunkerTrainingPanel({ token, name, onExit }) {
  const [plan, setPlan] = useState(null)
  const [active, setActive] = useState(null)
  const [exIdx, setExIdx] = useState(0)
  const [restEndsAt, setRestEndsAt] = useState(null)
  const idleRef = useRef(null)
  const minimizeRef = useRef(null)

  const armIdle = ms => { clearTimeout(idleRef.current); idleRef.current = setTimeout(onExit, ms) }
  const touch = () => armIdle(IDLE_LOCK_MS)

  useEffect(() => {
    fetchBunkerSession(token).then(p => {
      setPlan(p)
      const routine = todaysRoutine(p.week, p.routines)
      setActive(p.active || buildActive(routine, p.exWeights))
      armIdle(IDLE_LOCK_MS)
    }).catch(() => onExit())
    return () => { clearTimeout(idleRef.current); clearTimeout(minimizeRef.current) }
  }, [token])

  if (!plan || !active) return <div className="bk-panel"><div className="bk-loading">{t('Loading…')}</div></div>

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

  return <div className="bk-panel" onClick={touch}>
    <div className="bk-panel-hd">
      <button className="bk-minimize" onClick={onExit}><Icon name="chevronDown" /> {t('Minimize / resting')}</button>
      <div className="bk-panel-name">{name}</div>
      {restEndsAt && <RestRing endsAt={restEndsAt} size={52} />}
    </div>
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
      <div className="bk-exname">{exName(entry.id, plan.customEx)}</div>
      {last && <div className="bk-last">{t('Last time: {0} × {1}', fmtNum(last.w), last.r)}</div>}
      {entry.sets.map((s, si) => (
        <div key={si} className={'bk-setrow' + (s.done ? ' done' : '')}>
          <span className="bk-setn">{si + 1}</span>
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
          <button className={'bk-check' + (s.done ? ' on' : '')} onClick={() => toggleDone(exIdx, si)} aria-label={t('Done')}><Icon name="check" /></button>
        </div>
      ))}
    </div>}
    <button className="bk-finish" onClick={finish}>{t('Finish workout & exit')}</button>
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
  const [sessions, setSessions] = useState([])
  const [settings, setSettings] = useState(null)
  const load = () => {
    fetchBunkerAdminSessions(adminToken).then(setSessions).catch(() => {})
    fetchBunkerSettings().then(setSettings).catch(() => {})
  }
  useEffect(() => { load(); const id = setInterval(load, 5000); return () => clearInterval(id) }, [])
  const close = uid => closeBunkerSession(uid, adminToken).then(load)
  const setCols = n => saveBunkerSettings({ columns: n }, adminToken).then(setSettings)
  const setSound = v => saveBunkerSettings({ soundAlerts: v }, adminToken).then(setSettings)
  return <div className="bk-overlay">
    <div className="bk-pad bk-admin-pad">
      <button className="bk-close" onClick={onClose} aria-label={t('Close')}><Icon name="xmark" /></button>
      <div className="bk-pad-title">{t('Room admin')}</div>
      <div className="bk-admin-list">
        {sessions.length === 0 && <div className="dim small">{t('Nobody checked in yet — be the first.')}</div>}
        {sessions.map(s => (
          <div key={s.uid} className="bk-admin-row">
            <span>{s.name}</span>
            <button className="bk-admin-x" onClick={() => close(s.uid)} aria-label={t('Disconnect')}><Icon name="xmark" /></button>
          </div>
        ))}
      </div>
      {settings && <>
        <div className="bk-admin-setting">
          <span>{t('Grid columns')}</span>
          <div className="row" style={{ gap: 6 }}>
            {[2, 3, 4, 5, 6].map(n => <button key={n} className={'bk-key sm' + (settings.columns === n ? ' on' : '')} onClick={() => setCols(n)}>{n}</button>)}
          </div>
        </div>
        <div className="bk-admin-setting">
          <span>{t('Rest-over sound alert')}</span>
          <button className={'bk-key sm' + (settings.soundAlerts ? ' on' : '')} onClick={() => setSound(!settings.soundAlerts)}>
            {settings.soundAlerts ? t('On') : t('Off')}
          </button>
        </div>
      </>}
    </div>
  </div>
}

/* ============================ root ============================ */
export default function Bunker() {
  const [board, setBoard] = useState([])
  const [settings, setSettings] = useState({ columns: 4, soundAlerts: true, header: '2J Fitness Center' })
  const [session, setSession] = useState(null)
  const [showCheckin, setShowCheckin] = useState(false)
  const [showAdminLogin, setShowAdminLogin] = useState(false)
  const [adminToken, setAdminToken] = useState(null)

  useEffect(() => {
    let alive = true
    const poll = () => fetchBunkerBoard().then(s => alive && setBoard(s)).catch(() => {})
    poll()
    const id = setInterval(poll, BOARD_POLL_MS)
    return () => { alive = false; clearInterval(id) }
  }, [])
  useEffect(() => { fetchBunkerSettings().then(setSettings).catch(() => {}) }, [])

  if (adminToken) return <div className="bunker"><BunkerAdminOverlay adminToken={adminToken} onClose={() => setAdminToken(null)} /></div>
  if (session) return <div className="bunker"><BunkerTrainingPanel token={session.token} name={session.name} onExit={() => setSession(null)} /></div>

  return <div className="bunker">
    <BunkerDashboard board={board} settings={settings} onCheckin={() => setShowCheckin(true)} onAdmin={() => setShowAdminLogin(true)} />
    {showCheckin && <BunkerCheckinPad onClose={() => setShowCheckin(false)} onSuccess={s => { setSession(s); setShowCheckin(false) }} />}
    {showAdminLogin && <BunkerAdminLogin onClose={() => setShowAdminLogin(false)} onSuccess={tok => { setAdminToken(tok); setShowAdminLogin(false) }} />}
  </div>
}
