// Generic Bunker toolbar (V3.2) — Biblioteca / Discos / RM / Temporizador / Calentamiento.
//
// Deliberately stateless about WHO is using it: no useStore, no athlete/session data, no
// per-user preferences. Every tool here reads only its own manual inputs plus the real,
// gym-wide exercise catalog and the same pure calculators the rest of the app already uses
// (BarbellPlates.jsx's plateBreakdown, lib/onerm.js's estimate1RM, lib/history.js's
// warmupSets) — never a specific member's routines, weights or history. The one thing in this
// whole file that touches a session is `ExerciseSearchList` being reused by Bunker.jsx's own
// "Change exercise" action, which is a session-specific feature living in Bunker.jsx itself,
// not here.
import { useEffect, useState } from 'react'
import { t, nameFor, instrFor } from '../lib/i18n.js'
import { allExercises, imgSrc, gifSrc } from '../lib/exercises.js'
import { fmtNum } from '../lib/format.js'
import { MUSCLE_GROUPS, isInMuscleGroup } from '../lib/muscles.js'
import { estimate1RM } from '../lib/onerm.js'
import { warmupSets } from '../lib/history.js'
import BarbellPlates, { plateBreakdown, groupPlates } from '../components/BarbellPlates.jsx'
import { Thumb } from '../components/Media.jsx'
import { beep } from '../lib/sound.js'
import Icon from '../components/Icon.jsx'

const round1 = v => Math.round(v * 10) / 10
// No athlete's own custom exercises here on purpose — this browses the real shared 2J catalog,
// never anyone's personal additions (see the module's own doc comment on why).
const CATALOG_S = { customEx: [], excludedEx: [] }

/* ============================ shared exercise search ============================ */
// Exported so Bunker.jsx's own "Change exercise" (a session-specific action, not a generic
// tool) can reuse the exact same real-catalog search instead of a second picker.
export function ExerciseSearchList({ onPick, excludeId }) {
  const [q, setQ] = useState('')
  const [group, setGroup] = useState(null)
  const all = allExercises(CATALOG_S)
  const ql = q.trim().toLowerCase()
  const filtered = all.filter(ex => {
    if (excludeId && ex.id === excludeId) return false
    if (group && !isInMuscleGroup(ex, group)) return false
    if (!ql) return true
    return nameFor(ex).toLowerCase().includes(ql) || String(ex.eq || '').toLowerCase().includes(ql) || String(ex.tg || '').toLowerCase().includes(ql)
  }).slice(0, 60)
  return <>
    <input className="bk-tool-search" placeholder={t('Search exercises…')} value={q} onChange={e => setQ(e.target.value)} />
    <div className="bk-tool-chips bk-tool-chips-scroll">
      <button className={'bk-tool-chip' + (!group ? ' on' : '')} onClick={() => setGroup(null)}>{t('All')}</button>
      {MUSCLE_GROUPS.map(g => <button key={g.key} className={'bk-tool-chip' + (group === g.key ? ' on' : '')} onClick={() => setGroup(g.key)}>{t(g.name)}</button>)}
    </div>
    <div className="bk-tool-list">
      {filtered.map(ex => (
        <button key={ex.id} className="bk-tool-exrow" onClick={() => onPick(ex)}>
          <Thumb ex={ex} />
          <span className="bk-tool-exname capitalize">{nameFor(ex)}</span>
          <span className="bk-tool-exmeta capitalize">{t(ex.tg || ex.bp)}</span>
        </button>
      ))}
      {!filtered.length && <div className="bk-tool-empty">{t('No exercises found.')}</div>}
    </div>
  </>
}

/* ============================ Biblioteca ============================ */
function LibraryDetail({ ex, onBack }) {
  const steps = instrFor(ex)
  return <>
    <button className="bk-tool-back" onClick={onBack}><Icon name="chevronLeft" />{t('Back to search')}</button>
    <h3 className="bk-tool-exdetail-title capitalize">{nameFor(ex)}</h3>
    {ex.gif && <img className="bk-tool-media" src={gifSrc(ex)} alt={nameFor(ex)} loading="lazy" />}
    {!ex.gif && ex.img && <img className="bk-tool-media" src={imgSrc(ex)} alt={nameFor(ex)} loading="lazy" />}
    <div className="bk-tool-chips">
      {ex.tg && <span className="bk-tool-tag capitalize">{t(ex.tg)}</span>}
      {ex.bp && ex.bp !== ex.tg && <span className="bk-tool-tag capitalize">{t(ex.bp)}</span>}
      {ex.eq && <span className="bk-tool-tag capitalize">{t(ex.eq)}</span>}
    </div>
    <h4 className="bk-tool-subhead">{t('Technique')}</h4>
    {steps.length ? <ol className="bk-tool-steps">{steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
      : <div className="bk-tool-empty">{t('No technique notes for this exercise.')}</div>}
  </>
}
function LibraryTool() {
  const [picked, setPicked] = useState(null)
  return picked ? <LibraryDetail ex={picked} onBack={() => setPicked(null)} /> : <ExerciseSearchList onPick={setPicked} />
}

/* ============================ Discos ============================ */
const BAR_OPTIONS = [{ label: '20 kg', kg: 20 }, { label: '15 kg', kg: 15 }]
function NumField({ label, value, onChange, step = 1, min = 0 }) {
  return <div className="bk-tool-field">
    {label && <div className="bk-tool-label">{label}</div>}
    <div className="bk-bigstp">
      <button onClick={() => onChange(Math.max(min, round1(value - step)))}>−</button>
      <span className="bk-bigstp-v">{fmtNum(value)}</span>
      <button onClick={() => onChange(round1(value + step))}>+</button>
    </div>
  </div>
}
function PlatesTool() {
  const [weight, setWeight] = useState(60)
  const [barKg, setBarKg] = useState(20)
  const { plates, leftover, achieved } = plateBreakdown(weight, 'kg', barKg)
  const grouped = groupPlates(plates)
  return <>
    <div className="bk-tool-row2">
      <NumField label={t('Target weight (kg)')} value={weight} onChange={setWeight} step={2.5} />
      <div className="bk-tool-field">
        <div className="bk-tool-label">{t('Bar weight')}</div>
        <div className="bk-tool-chips">
          {BAR_OPTIONS.map(b => <button key={b.kg} className={'bk-tool-chip' + (barKg === b.kg ? ' on' : '')} onClick={() => setBarKg(b.kg)}>{b.label}</button>)}
        </div>
      </div>
    </div>
    <BarbellPlates weight={weight} unit="kg" barW={barKg} height={110} />
    {weight <= barKg
      ? <div className="bk-tool-empty">{weight < barKg ? t('Target is lighter than the bar itself.') : t('Bar only — no plates needed.')}</div>
      : <>
        <div className="bk-tool-persidelabel">{t('PER SIDE')}</div>
        <div className="bk-tool-discs">
          {grouped.map((p, i) => <div key={i} className="bk-tool-disc" style={{ '--dc': p.color }}>
            <span className="bk-tool-disc-dot" style={p.outline ? { background: p.color, boxShadow: 'inset 0 0 0 1px #666' } : { background: p.color }} />
            {fmtNum(p.w)} kg × {p.count}
          </div>)}
        </div>
      </>}
    {leftover > 0.01 && <div className="bk-tool-warn">{t('Closest achievable with these plates: {0} kg (off by {1} kg).', fmtNum(achieved), fmtNum(leftover))}</div>}
  </>
}

/* ============================ RM ============================ */
const RM_PCTS = [50, 60, 70, 75, 80, 85, 90, 95, 100]
function RMTool() {
  const [weight, setWeight] = useState(60)
  const [reps, setReps] = useState(5)
  const est = estimate1RM(weight, reps)
  return <>
    <div className="bk-tool-row2">
      <NumField label={t('Weight (kg)')} value={weight} onChange={setWeight} step={2.5} />
      <NumField label={t('Reps')} value={reps} onChange={v => setReps(Math.max(1, Math.round(v)))} step={1} min={1} />
    </div>
    {est ? <>
      <div className="bk-tool-rmresult">{fmtNum(est)}<i>kg</i></div>
      <div className="bk-tool-caption">{t('Estimated 1RM from this one set — not a substitute for a real tested max.')}</div>
      <div className="bk-tool-pcttable">
        {RM_PCTS.map(p => <div key={p} className="bk-tool-pctrow">
          <span>{p}%</span><span>{fmtNum(round1(Math.round(est * p / 100 / 2.5) * 2.5))} kg</span>
        </div>)}
      </div>
    </> : <div className="bk-tool-empty">{t('Enter a real weight and 12 reps or fewer — past that, an estimate is a guess, not a number.')}</div>}
  </>
}

/* ============================ Temporizador ============================ */
// Lifted to Bunker.jsx's own root state (passed in as props) so it keeps running — same
// endsAt-as-absolute-timestamp trick the room dashboard's own RestRing already uses — whether
// this panel is mounted or the member switched to another tool and back. Entirely local to this
// kiosk screen: never touches /api/bunker/rest, which is the per-athlete room-dashboard timer.
const PRESETS = [30, 60, 90, 120, 180]
function TimerTool({ timer, setTimer }) {
  const [, tick] = useState(0)
  useEffect(() => { const id = setInterval(() => tick(x => x + 1), 250); return () => clearInterval(id) }, [])
  const left = timer.paused ? timer.pausedLeftSec : (timer.endsAt ? Math.max(0, Math.round((timer.endsAt - Date.now()) / 1000)) : timer.durationSec)
  const running = !!timer.endsAt && !timer.paused
  useEffect(() => {
    if (running && left <= 0) { beep(true, 880, 0.25); setTimer(x => ({ ...x, endsAt: null })) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left, running])
  const start = () => setTimer(x => ({ ...x, endsAt: Date.now() + x.durationSec * 1000, paused: false, pausedLeftSec: null }))
  const pause = () => setTimer(x => x.endsAt ? { ...x, paused: true, pausedLeftSec: Math.max(0, Math.round((x.endsAt - Date.now()) / 1000)), endsAt: null } : x)
  const resume = () => setTimer(x => x.paused ? { ...x, paused: false, endsAt: Date.now() + (x.pausedLeftSec || 0) * 1000, pausedLeftSec: null } : x)
  const reset = () => setTimer(x => ({ ...x, endsAt: null, paused: false, pausedLeftSec: null }))
  const mm = String(Math.floor(left / 60)).padStart(2, '0'), ss = String(left % 60).padStart(2, '0')
  return <>
    <div className="bk-tool-timerdisplay">{mm}:{ss}</div>
    <div className="bk-tool-chips">
      {PRESETS.map(s => <button key={s} className={'bk-tool-chip' + (timer.durationSec === s ? ' on' : '')} onClick={() => setTimer(x => ({ ...x, durationSec: s }))}>{s}s</button>)}
    </div>
    <NumField label={t('Custom duration (s)')} value={timer.durationSec} onChange={v => setTimer(x => ({ ...x, durationSec: Math.max(5, Math.round(v)) }))} step={5} min={5} />
    <div className="bk-tool-timerbtns">
      {!timer.endsAt && !timer.paused && <button className="bk-join" onClick={start}>{t('Start')}</button>}
      {running && <button className="bk-join" onClick={pause}>{t('Pause')}</button>}
      {timer.paused && <button className="bk-join" onClick={resume}>{t('Resume')}</button>}
      <button className="bk-key sm" onClick={reset}>{t('Reset')}</button>
    </div>
  </>
}

/* ============================ Calentamiento ============================ */
// Reuses lib/history.js's own warmupSets 1:1 (50%×8, 75%×5 — the exact ramp buildSets() already
// generates for a live session) rather than inventing a second warm-up methodology, combined
// with the same plate calculator above for each step's own per-side breakdown.
function WarmupTool() {
  const [weight, setWeight] = useState(60)
  const ramp = warmupSets(weight, 'kg')
  const steps = [...ramp.map((s, i) => ({ label: i === 0 ? '50%' : '75%', w: s.w, r: s.r })), { label: t('Working set'), w: weight, r: null }]
  return <>
    <NumField label={t('Working weight (kg)')} value={weight} onChange={setWeight} step={2.5} />
    <div className="bk-tool-warmlist">
      {steps.map((s, i) => {
        const { plates } = plateBreakdown(s.w, 'kg', 20)
        const per = groupPlates(plates).map(p => `${fmtNum(p.w)}×${p.count}`).join(' + ')
        return <div key={i} className={'bk-tool-warmrow' + (i === steps.length - 1 ? ' bk-tool-warmwork' : '')}>
          <span className="bk-tool-warmpct">{s.label}</span>
          <span className="bk-tool-warmw">{fmtNum(s.w)} kg{s.r ? ` × ${s.r}` : ''}</span>
          <span className="bk-tool-warmplates">{per || t('bar only')}</span>
        </div>
      })}
    </div>
  </>
}

/* ============================ bar + overlay ============================ */
const TOOLS = [
  { key: 'library', label: 'Library', icon: 'magnifier' },
  { key: 'plates', label: 'Plates', icon: 'plate' },
  { key: 'rm', label: '1RM', icon: 'chartLine' },
  { key: 'timer', label: 'Timer', icon: 'timer' },
  { key: 'warmup', label: 'Warm-up', icon: 'flame' },
]
const TOOL_TITLE = { library: 'Exercise library', plates: 'Plate calculator', rm: '1RM calculator', timer: 'Timer', warmup: 'Warm-up' }

// The header trigger — a single icon, on purpose (the brief's own "avoid cluttering the
// header"). Opens the hub below rather than jumping straight into a tool.
export function BunkerToolsTrigger({ onClick }) {
  return <button className="bk-admin-btn" aria-label={t('Tools')} onClick={onClick}><Icon name="wrench" /></button>
}

function ToolsHub({ onPick }) {
  return <div className="bk-tools-hub">
    {TOOLS.map(tl => <button key={tl.key} className="bk-tools-hub-btn" onClick={() => onPick(tl.key)}>
      <Icon name={tl.icon} /><span>{t(tl.label)}</span>
    </button>)}
  </div>
}

// `tool` is one of: null (closed), 'hub' (the 5-icon menu), or one of TOOLS' own keys.
export function BunkerToolsOverlay({ tool, onSelect, onClose, timer, setTimer }) {
  if (!tool) return null
  return <div className="bk-overlay">
    <div className="bk-pad bk-tools-pad">
      <button className="bk-close" onClick={onClose} aria-label={t('Close')}><Icon name="xmark" /></button>
      {tool !== 'hub' && <button className="bk-tool-back bk-tool-back-hub" onClick={() => onSelect('hub')}><Icon name="chevronLeft" />{t('Tools')}</button>}
      <div className="bk-pad-title">{tool === 'hub' ? t('Tools') : t(TOOL_TITLE[tool])}</div>
      {tool === 'hub' && <ToolsHub onPick={onSelect} />}
      {tool === 'library' && <LibraryTool />}
      {tool === 'plates' && <PlatesTool />}
      {tool === 'rm' && <RMTool />}
      {tool === 'timer' && <TimerTool timer={timer} setTimer={setTimer} />}
      {tool === 'warmup' && <WarmupTool />}
    </div>
  </div>
}

export const DEFAULT_TIMER_STATE = { durationSec: 90, endsAt: null, paused: false, pausedLeftSec: null }
