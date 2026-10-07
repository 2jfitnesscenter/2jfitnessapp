import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import GymProfile, { GymCompatibility } from '../components/GymProfile.jsx'
import { compatibleWithGym } from '../lib/gym-profiles.js'
import { useUI } from '../store/useUI.js'
import { exOr } from '../lib/exercises.js'
import { effectiveRoutine, workingSets, lastEntryFor, bestWeightFor, trackedWeightFor, buildSets, setsDoneActive, supersetUnits, unitOf, setLabel, modeOf, effortOf, feelFor, effortColor, EFFORT_COLOR_VAR, fmtSec } from '../lib/history.js'
import { supersetGroupInfo, supersetLabel } from '../lib/superset-colors.js'
import { fmtNum, fmtDate, todayISO, exCount, DAYN, ageFrom } from '../lib/format.js'
import { beep, vibrate } from '../lib/sound.js'
import { t, nameFor, instrFor } from '../lib/i18n.js'
import { api } from '../lib/api.js'
import Media from '../components/Media.jsx'
import ExerciseMeta from '../components/ExerciseMeta.jsx'
import WorkoutProgress from '../components/WorkoutProgress.jsx'
import NextUp from '../components/NextUp.jsx'
import { nextUnit } from '../lib/training-v3.js'
import { startFlow, expressSessionSheet, exercisePicker, alternativesSheet, exConfigSheet, exerciseDetailSheet, topWeightSheet, finishWorkout, workoutCompleteSheet, confirmSheet, setTypeSheet, platesSheet } from '../sheets.jsx'
import { handoffToBunker } from '../lib/bunker-api.js'
import Icon from '../components/Icon.jsx'
import { Button, Segmented } from '../components/ui.jsx'
import { openSetPad } from '../components/SetPad.jsx'
import { nextPrescription, applyPrescription, targetForPrescription } from '../lib/progression.js'
import { cardioWorkoutReference } from '../lib/cardio-tests.js'
import { glyphOf } from '../lib/glyphs.js'
import { zoneOfSet } from '../lib/training-zones.js'
import { isOverloadSet, isPotentialPR, recommendationFor, acceptRecommendation, keepPlan } from '../lib/overload.js'
import { FEELINGS, FEELING_LABEL, feedbackIndex, nextSetSuggestion, setFeeling, acceptSuggestion, keepPlannedLoad } from '../lib/set-feedback.js'
import { musclesOf, muscleOptsOf, MUSCLE_GROUPS } from '../lib/muscles.js'
import { weeklyGroupVolumeFinished, weeklyGroupVolumeActive, primaryGroupOf, landmarksFor } from '../lib/rp-volume.js'
import { workoutPrefs } from '../lib/workout-prefs.js'
import { fieldsFor, currentSetIdx, nextInUnit, platesApply, barFor } from '../lib/set-entry.js'
import { plateBreakdown, BARBELL_TYPES, DEFAULT_AVAILABLE_KG } from '../components/BarbellPlates.jsx'
import RpVolumeBar from '../components/RpVolumeBar.jsx'
import CheckInCard from '../components/CheckInCard.jsx'
import { checkinOn, checkinAdvice, shouldAskCheckin, PAIN_ZONE } from '../lib/checkin.js'
import { bleSupported, useHR, connectHeartRate, reconnectHeartRate, disconnectHeartRate } from '../lib/ble-hr.js'
import { maxHrFor, zoneCuts, bandFor } from '../lib/fitness.js'
import { guidedBlockFor } from '../lib/guided.js'
import GuidedRunner, { GuidedLaunch } from '../components/GuidedRunner.jsx'
import WorkoutCover from '../components/WorkoutCover.jsx'
import IntelligenceToday from '../components/IntelligenceToday.jsx'
import { uxOn } from '../lib/features.js'

// Today's check-in, next to the exercise it concerns — words only: nothing about the load, the
// exercise or the routine changes because of it (the member or trainer decides).
function CheckinNote({ S, ex }) {
  const advice = checkinAdvice(checkinOn(S), ex)
  if (!advice) return null
  return <>
    {advice.zones.length > 0 && <div className="progline warn ci-advice"><Icon name="info" />
      <span>{t('You said you have discomfort in: {0}. Review this exercise before continuing.', advice.zones.map(z => t(PAIN_ZONE[z].label).toLowerCase()).join(', '))}</span></div>}
    {advice.tired && <div className="progline warn ci-advice"><Icon name="info" />
      <span>{t('You said you are tired and slept little: today you could keep the load.')}</span></div>}
  </>
}

// Live heart rate from a Bluetooth sensor — offered only where the browser supports it (Chrome
// on Android/desktop), never on iPhone, and only after an explicit tap.
function HeartRateLive({ S, workoutId }) {
  const { status, bpm } = useHR()
  if (!bleSupported()) return null
  const ref = maxHrFor(S, ageFrom)
  const max = ref?.value
  const zone = bpm && max ? bandFor(bpm, zoneCuts(max)) + 1 : null
  if (status === 'live' && bpm) return <button className="hr-pill live" onClick={disconnectHeartRate} aria-label={t('Heart rate {0} bpm. Tap to disconnect the sensor.', bpm)}>
    <Icon name="heart" /><b>{bpm}</b> <span>{t('bpm')}</span>{zone && <em title={ref.kind === 'declared' ? t('Zone against the max HR you declared') : t('Zone against an estimated max HR (220 − age)')}>Z{zone}{ref.kind !== 'declared' && ' · ' + t('est.')}</em>}</button>
  if (status === 'lost') return <button className="hr-pill lost" onClick={reconnectHeartRate}><Icon name="heart" />{t('Sensor lost · Reconnect')}</button>
  if (status === 'connecting') return <span className="hr-pill"><Icon name="heart" />{t('Connecting…')}</span>
  return <button className="hr-pill" onClick={() => connectHeartRate(workoutId, ref)} title={t('Experimental · works on this device')}>
    <Icon name="heart" />{status === 'denied' ? t('Bluetooth not allowed') : t('HR sensor')}</button>
}

/* ---------- start chooser (no active workout) ---------- */
function StartChooser() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const todayR = effectiveRoutine(S, todayISO())
  const todayOvr = S.dayPlan[todayISO()] !== undefined
  const others = S.routines.filter(r => r !== todayR)
  return <div className="narrow">
    <div className="hdr"><div><h1>{t('Start workout')}</h1><div className="sub">{t(DAYN[new Date().getDay()])} — {todayR ? t('today is {0}', todayR.name) : t('rest day, but no one’s stopping you')}</div></div></div>
    {todayR && <div className="card" style={{ borderColor: 'var(--acc)' }}>
      <h2 className="accent">{t("Today's plan")}{todayOvr ? ' · ' + t('rescheduled') : ''}</h2>
      <div className="row between" style={{ marginBottom: 12 }}>
        <div><div className="big">{todayR.name}</div><div className="muted small">{exCount(todayR.ex.length)}</div></div>
        <span className="lrow-i" style={{ width: 38, height: 38, borderRadius: 9, fontSize: 22 }}><Icon name={glyphOf(todayR.emoji)} /></span>
      </div>
      <Button variant="primary" icon="play" onClick={() => startFlow(todayR.id)}>{t('Start {0}', todayR.name)}</Button>
      <div style={{ height: 8 }} />
      <Button variant="plain" icon="timer" onClick={() => expressSessionSheet(todayR.id)}>{t('Express · 15 / 25 / 40 min')}</Button>
    </div>}
    {others.length > 0 && <><h4 className="sec">{t('Other routines')}</h4>
      <div className="list">{others.map(r => <div key={r.id} className="item">
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <button className="grow" aria-label={t('Start {0}', r.name)} style={{ textAlign: 'left', border: 0, background: 'none', color: 'inherit', padding: 0 }} onClick={() => startFlow(r.id)}>
          <span className="tt">{r.name}</span><span className="ss">{exCount(r.ex.length)}</span></button>
        <button className="iconbtn" aria-label={t('Express · 15 / 25 / 40 min')} title={t('Express · 15 / 25 / 40 min')} onClick={() => expressSessionSheet(r.id)}><Icon name="timer" /></button>
      </div>)}</div></>}
    {!S.routines.length && <><div style={{ height: 14 }} /><Button variant="primary" onClick={() => nav('/plan')}>{t('Build a plan first')}</Button></>}
    {uxOn(S, 'train2j') && <><h4 className="sec">{t('Or a ready-made one')}</h4>
    <button className="card tappable t2-promo" onClick={() => nav('/train2j')}>
      <WorkoutCover r={{ id: 'start-promo', category: 'hiit' }} shape="square" />
      <span className="grow">
        <span className="t2-promo-k">{t('Train with 2J')}</span>
        <span className="t2-promo-t">{t('Official guided workouts, ready to start.')}</span>
      </span>
      <Icon name="chevronRight" className="chev" />
    </button></>}
  </div>
}

/* ---------- elapsed clock (isolated so the workout tree doesn't re-render every second) ---------- */
function Elapsed({ start }) {
  const [t, setT] = useState('0:00')
  useEffect(() => {
    const tick = () => { const s = Math.floor((Date.now() - start) / 1000); setT(Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')) }
    tick(); const iv = setInterval(tick, 1000); return () => clearInterval(iv)
  }, [start])
  return <span>{t}</span>
}

// A set's badge: its type letter if tagged, else the count of untyped sets up to and including
// it — so a warmup/failure/drop set never consumes a working-set number (matches how every
// reference strength app numbers a session: 1, W, F, D, 2, not 1, 2, 3, 4, 5).
const TYPE_LETTER = { warmup: 'W', failure: 'F', drop: 'D' }
const TYPE_COLOR = { warmup: 'var(--orange)', failure: 'var(--red)', drop: 'var(--blue)' }
const setBadge = (sets, i) => {
  if (TYPE_LETTER[sets[i].type]) return TYPE_LETTER[sets[i].type]
  let n = 0
  for (let j = 0; j <= i; j++) if (!TYPE_LETTER[sets[j].type]) n++
  return n
}
const workingCount = sets => sets.filter(s => !TYPE_LETTER[s.type]).length

// The set-number badge and its done-checkbox, fused into one control — a short tap toggles done;
// holding it past LONG_PRESS_MS opens the set-type sheet. Pointer events rather than onClick/a
// native long-press, so a long press never also fires a toggle when the finger lifts — `firedRef`
// suppresses that trailing pointerup once the timer has already acted. Typed sets
// (warmup/drop/failure) keep their letter after completion; a plain numbered set shows a check.
const LONG_PRESS_MS = 500
function SetNumBtn({ s, i, sets, achievement, onToggle, onSetType }) {
  const timer = useRef(null)
  const fired = useRef(false)
  const start = () => {
    fired.current = false
    timer.current = setTimeout(() => { fired.current = true; vibrate(15); onSetType(i) }, LONG_PRESS_MS)
  }
  const cancel = () => clearTimeout(timer.current)
  const release = () => { clearTimeout(timer.current); if (!fired.current) onToggle(i) }
  return (
    <button className={'n' + (s.done ? ' on' : '') + (achievement ? ' ' + achievement : '')}
      aria-label={t('Set {0} — tap to mark done, hold for set type', setBadge(sets, i))}
      aria-pressed={!!s.done}
      style={s.type ? { background: TYPE_COLOR[s.type], color: '#fff' } : undefined}
      onPointerDown={start} onPointerUp={release} onPointerLeave={cancel} onPointerCancel={cancel}
      onContextMenu={e => e.preventDefault()}>
      {s.done && !s.type ? <Icon name="check" /> : setBadge(sets, i)}
    </button>
  )
}

/* ---------- prescription cues: trainer note vs. library tips ----------
   Two different things, never merged: the NOTE is the trainer's instruction for THIS
   prescription (routine entry.note, copied into the session's target snapshot — "3 s down",
   "pause at the bottom"); the TIPS are the exercise library's generic how-to steps. The note is
   part of the prescription and always shows; tips follow the member's "Show tips" preference.
   Both start collapsed to a couple of lines so neither pushes the sets off screen. */
function Cue({ kind, icon, label, text, lines }) {
  const [open, setOpen] = useState(false)
  return <div className={'cue ' + kind + (open ? ' open' : '')} role="button" tabIndex={0} aria-expanded={open}
    onClick={() => setOpen(o => !o)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o) } }}>
    <div className="cue-l"><Icon name={icon} />{label}</div>
    {lines ? (open ? <ol className="cue-steps">{lines.map((s, i) => <li key={i}>{s}</li>)}</ol> : <div className="cue-t">{lines[0]}</div>)
      : <div className="cue-t">{text}</div>}
  </div>
}
function ExerciseCues({ entry, ex, prefs, only }) {
  const note = only === 'tips' ? null : entry.target?.note
  const tips = prefs.tips && only !== 'note' ? instrFor(ex) : []
  if (!note && !tips.length) return null
  return <div className="cues">
    {note && <Cue kind="note" icon="clipboard" label={t('Trainer’s note')} text={note} />}
    {tips.length > 0 && <Cue kind="tips" icon="lightbulb" label={t('Tips')} lines={tips} />}
  </div>
}

/* ---------- intelligent progression V1 (lib/overload.js) ---------- */
const CONF_LABEL = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' }
function RecommendationCard({ rec, unit, onAccept, onKeep }) {
  const head = rec.kind === 'up' ? t('Try {0} {1}', fmtNum(rec.w), unit)
    : rec.kind === 'down' ? t('Lower to {0} {1}', fmtNum(rec.w), unit)
      : rec.kind === 'reps' ? (rec.w > 0 ? t('{0} {1} × {2} reps', fmtNum(rec.w), unit, rec.r) : t('Go for {0} reps', rec.r))
        : t('Keep {0} {1}', fmtNum(rec.w), unit)
  return <div className={'reccard ' + rec.kind} role="region" aria-label={t('Progression recommendation')}>
    <div className="rec-top">
      <Icon name={rec.kind === 'up' ? 'arrowUp' : rec.kind === 'down' ? 'arrowDown' : 'target'} />
      <div className="rec-main">
        <div className="rec-h">{head}</div>
        <div className={'rec-conf ' + rec.confidence}>{t(CONF_LABEL[rec.confidence])}</div>
      </div>
    </div>
    <div className="rec-why">{t(...rec.why)}</div>
    <div className="rec-acts">
      <Button size="sm" variant="primary" onClick={onAccept}>{t('Use recommendation')}</Button>
      <Button size="sm" onClick={onKeep}>{t('Keep plan')}</Button>
    </div>
  </div>
}

/* ---------- Series Feedback V1 (lib/set-feedback.js) ---------- */
// After a finished working set: "how did it feel?" and, when that calls for it, a suggested load
// for the NEXT set only. Optional and ignorable; nothing changes unless the member accepts.
function SetFeedback({ entryIdx }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const entry = S.active?.entries[entryIdx]
  if (!entry || S.active.past) return null
  const mode = modeOf({ ...(entry.target || {}), id: entry.id })
  const i = feedbackIndex(entry, mode)
  if (i < 0) return null
  const set = entry.sets[i]
  const sug = nextSetSuggestion(S, entry, i, exOr(entry.id).eq)
  const mut = fn => update(s => { fn(s.active.entries[entryIdx]) }, true)
  return <div className="setfb" role="group" aria-label={t('How did that set feel?')}>
    <div className="setfb-q">{t('How did set {0} feel?', setBadge(entry.sets, i))}</div>
    <div className="setfb-chips">
      {FEELINGS.map(f => <button key={f} className={'setfb-chip ' + f + (set.feel === f ? ' on' : '')} aria-pressed={set.feel === f}
        onClick={() => mut(e => setFeeling(e, i, f))}>{t(FEELING_LABEL[f])}</button>)}
    </div>
    {sug && <div className={'setfb-sug ' + (sug.to > sug.from ? 'up' : 'down')}>
      <div className="setfb-h"><Icon name={sug.to > sug.from ? 'arrowUp' : 'arrowDown'} />
        {t('Next set: {0} {2} → {1} {2} suggested', fmtNum(sug.from), fmtNum(sug.to), S.unit)}</div>
      <div className="setfb-why">{t(...sug.why)}</div>
      <div className="rec-acts">
        <Button size="sm" variant="primary" onClick={() => mut(e => acceptSuggestion(e, i, sug))}>{t('Accept')}</Button>
        <Button size="sm" onClick={() => mut(e => keepPlannedLoad(e, i))}>{t('Keep load {0} {1}', fmtNum(sug.from), S.unit)}</Button>
      </div>
    </div>}
  </div>
}

// Prescription summary: "3 × 8-12 · 80 kg · RIR 2" — what the routine asked for, never what
// the member typed.
function targetLine(entry, unit) {
  const tg = entry.target || {}
  const mode = modeOf({ ...tg, id: entry.id })
  const sets = workingCount(entry.sets) || tg.sets || 1
  if (mode === 'cardio') return `${sets} × ${tg.min || 20} min${tg.speed ? ` · ${fmtNum(tg.speed)} km/h` : ''}`
  if (mode === 'time') return `${sets} × ${fmtSec(tg.sec || 45)}` + plannedRpe(tg)
  const reps = tg.targetRepsMin != null && tg.targetRepsMax != null ? `${tg.targetRepsMin}-${tg.targetRepsMax}` : (tg.reps || '')
  return `${sets} × ${reps} ${t('reps')}` + (tg.targetRIR != null ? ' · RIR ' + fmtNum(tg.targetRIR) : plannedRpe(tg))
}
function CardioTestHint({ S, ex, entry }) {
  if (modeOf({ ...(entry.target || {}), id: entry.id }) !== 'cardio') return null
  const reference = cardioWorkoutReference(S.tests, ex, entry.target?.speed)
  if (!reference) return null
  return <div className="small dim" style={{ marginTop: 5 }}>
    <Icon name={reference.type === 'vam' ? 'figureRun' : 'bike'} style={{ fontSize: 13, marginRight: 5 }} />
    {reference.type === 'vam'
      ? <>{t('VAM guide')}: {t(({ easy: 'Easy', aerobic: 'Aerobic', steady: 'Steady', interval: 'Intervals' })[reference.zone.key])} · {fmtNum(reference.zone.slow)}–{fmtNum(reference.zone.fast)} km/h</>
      : <>{t('Test reference')}: {fmtNum(reference.latest.avgSpeed)} km/h · {t('Next test goal')} {fmtNum(reference.nextGoal)} km/h</>}
  </div>
}
// The previous session's first working set, as the member logged it ("80 kg × 8"); null without history.
const lastWorkingText = (id, last) => {
  const p = last ? workingSets(last.sets)[0] : null
  return p ? setLabel(id, { ...p, rpe: undefined, rir: undefined }, last.target) : null
}
// The trainer's planned effort on the 2J scale (4/6/8/10) — "RPE 8" when every set is the same,
// "RPE 8·8·10" when the last set is meant to go further. Never converted to RIR.
// Rest after a set: the trainer's prescribed rest for this exercise (Constructor V2 / 2J
// protocol) when there is one, otherwise the member's own setting — nothing else changes.
export const restSecondsFor = (entry, S) => entry?.target?.rest > 0 ? entry.target.rest : S.restSec
const plannedRpe = tg => {
  const r = Array.isArray(tg?.rpe) ? tg.rpe.filter(v => [4, 6, 8, 10].includes(v)) : []
  if (!r.length) return ''
  return ' · RPE ' + (r.every(v => v === r[0]) ? r[0] : r.join('·'))
}

const perSideLabel = (S, ex, w) => {
  if (S.unit === 'lb') return null
  const barW = BARBELL_TYPES.find(b => b.id === (barFor(S, ex) || 'olympic'))?.kg ?? 20
  const r = plateBreakdown(w, S.unit, barW, S.availablePlates || DEFAULT_AVAILABLE_KG)
  return r.perSide > 0 ? t('{0} {1} per side', fmtNum(r.perSide), S.unit) : t('Bar only')
}

/* ---------- DETAILED view: one exercise block with every set visible ---------- */
function ExerciseBlock({ entryIdx, compact, rpFinished, ssLabel, prefs, onToggle, onPad, onPlates, onAddSet, onRemoveSet, onStartTimed, onSetType, onReplace, rec, onRec }) {
  const S = useStore(s => s.S)
  const working = useUI(s => s.work)
  const entry = S.active.entries[entryIdx]
  const ex = exOr(entry.id)
  const mode = modeOf({ ...(entry.target || {}), id: entry.id })
  const cardio = mode === 'cardio'
  const timed = mode === 'time'
  const showPrev = S.showPreviousResults !== false
  const last = showPrev ? lastEntryFor(S, entry.id) : null
  const best = cardio ? 0 : Math.max(bestWeightFor(S, entry.id), trackedWeightFor(S, entry.id)?.w || 0)
  const plan = entry.plan
  const fields = fieldsFor(entry, S)
  const effField = fields.find(f => f.effort)
  const target = entry.target
  const repsRangeLabel = mode === 'reps' && target?.targetRepsMin != null && target?.targetRepsMax != null
    ? `${target.targetRepsMin}-${target.targetRepsMax}` : null
  // Training zones: %1RM against the exercise's best known 1RM, or the set's own RIR/RPE —
  // off whenever Weekly Volume Zones is on (both answer different "zone" questions).
  const showZones = S.enableTrainingZones !== false && !cardio && mode === 'reps' && !S.enableRpVolumeZones
  const zoneOf = s => showZones ? zoneOfSet(S, entry.id, s) : null
  const showRpVolume = !!S.enableRpVolumeZones && !cardio && mode === 'reps'
  const rpOpts = muscleOptsOf(S)
  const rpGroup = showRpVolume ? primaryGroupOf(musclesOf(ex, rpOpts)) : null
  const rpLandmarks = rpGroup ? landmarksFor(S, rpGroup) : null
  const rpActiveVolume = showRpVolume ? weeklyGroupVolumeActive(S, rpOpts) : null
  const rpVolume = rpGroup ? (rpFinished?.[rpGroup] || 0) + (rpActiveVolume?.[rpGroup] || 0) : 0
  const showOverload = prefs.progression && !cardio && mode === 'reps'
  const warmupIdx = []
  const workIdx = []
  entry.sets.forEach((s, i) => (s.type === 'warmup' ? warmupIdx : workIdx).push(i))
  const workPosOf = {}
  workIdx.forEach((idx, pos) => { workPosOf[idx] = pos })
  // 'pr' beats 'overload' beats nothing — gold for an all-time e1RM PR, green for beating
  // last time's equivalent set.
  const achievementOf = (s, wp) => {
    if (!showOverload || !s.done || s.type === 'warmup') return null
    if (isPotentialPR(S, entry.id, s)) return 'pr'
    if (last && wp != null && isOverloadSet(last.sets[wp], s)) return 'overload'
    return null
  }
  const bestAchievement = showOverload
    ? workIdx.reduce((b, idx) => {
      const a = achievementOf(entry.sets[idx], workPosOf[idx])
      return a === 'pr' ? 'pr' : (a === 'overload' && b !== 'pr' ? 'overload' : b)
    }, null)
    : null
  const [hideWarmup, setHideWarmup] = useState(false)
  useEffect(() => { setHideWarmup(false) }, [entryIdx])
  const plateIdx = entry.sets.findIndex(s => !s.done && platesApply(S, ex.eq, entry, s) && s.w > 0)
  const plateAt = plateIdx >= 0 ? plateIdx : entry.sets.findIndex(s => platesApply(S, ex.eq, entry, s) && s.w > 0)

  // A tappable value cell — opens the set pad on that field. Shows last time's number (or the
  // prescribed rep range) greyed out while the set's own value is still empty.
  const cell = (s, i, field, wp) => {
    const v = s[field.f]
    const empty = v == null || (v === 0 && !field.weight)
    const ghost = field.f === 'r' && repsRangeLabel ? repsRangeLabel
      : (last && wp != null && !field.effort && last.sets[wp]?.[field.f] != null ? fmtNum(last.sets[wp][field.f]) : null)
    if (field.effort) {
      const feel = feelFor(field.effort, v)
      const color = v == null ? null : effortColor(field.effort === 'rpe' ? 10 - v : v)
      return <button key={field.f} className="dcell eff" style={color ? { background: EFFORT_COLOR_VAR[color], color: '#fff' } : undefined}
        aria-label={field.label + ': ' + (v == null ? t('empty') : fmtNum(v))} onClick={() => onPad(i, field.f)}>
        {feel ? <><span className="em" aria-hidden="true">{feel.emoji}</span>{fmtNum(v)}</> : <span className="ph">{field.label}</span>}
      </button>
    }
    return <button key={field.f} className={'dcell' + (field.weight ? ' w' : '')} aria-label={field.label + ': ' + (empty ? t('empty') : fmtNum(v))}
      onClick={() => onPad(i, field.f)}>
      {empty ? <span className="ph">{ghost || '—'}</span> : fmtNum(v)}
    </button>
  }
  const valueFields = fields.filter(f => !f.effort)
  const prevOf = (s, wp) => {
    const p = last && wp != null ? last.sets[wp] : null
    return p ? setLabel(entry.id, { ...p, rpe: undefined, rir: undefined }, last.target) : '—'
  }
  const sethead = <div className={'sethead d' + (effField ? ' eff3' : '')}>
    <span className="n-sp" />
    {showPrev && <span className="p-sp">{t('Previous')}</span>}
    {valueFields.map(f => <span key={f.f} className="v-sp">{f.weight ? S.unit : f.short}</span>)}
    {(effField || showZones) && <span className="setmeta-head">{effField?.label}</span>}
    {timed && <span className="ck-sp" />}
  </div>
  const row = (s, i) => {
    const zone = zoneOf(s)
    const wp = workPosOf[i]
    return <div key={i} className={'setrow d' + (s.done ? ' done' : '') + (effField ? ' eff3' : '') + (s.type === 'warmup' ? ' warm' : '')}>
      <SetNumBtn s={s} i={i} sets={entry.sets} achievement={achievementOf(s, wp)} onToggle={onToggle} onSetType={onSetType} />
      {showPrev && <span className="prevcol">{s.type === 'warmup' ? '' : prevOf(s, wp)}</span>}
      {valueFields.map(f => cell(s, i, f, wp))}
      {(effField || showZones) && <div className="setmeta">
        {effField && cell(s, i, effField, wp)}
        {zone && <span className="zonechip" style={{ '--zc': zone.color }}
          title={zone.short + ' · ' + t(zone.label)} aria-label={zone.short + ' · ' + t(zone.label)}>{zone.short}</span>}
      </div>}
      {timed && <button className="setgo" aria-label={t('Start set')} disabled={s.done || !!working}
        onClick={() => onStartTimed(i)}><Icon name="play" /></button>}
    </div>
  }
  return <>
    {prefs.images && <Media ex={ex} key={entry.id} compact={compact} minimizable />}
    <div className="row between" style={{ marginBottom: 6, gap: 8 }}>
      <div className="exname" style={{ fontSize: compact ? 17 : 20 }}>{ssLabel && <span className="ss-badge">{ssLabel}</span>}{nameFor(ex)}</div>
      <div className="row" style={{ gap: 4, flex: 'none' }}>
        <button className="iconbtn" aria-label={t('Replace exercise')} title={t('Replace exercise')} onClick={onReplace}><Icon name="shuffle" /></button>
        <button className="iconbtn" aria-label={t('Details')} onClick={() => exerciseDetailSheet(ex)}><Icon name="info" /></button>
      </div>
    </div>
    {!S.active?.past && !compatibleWithGym(S, ex) && <button className="chip" onClick={onReplace}><GymCompatibility ex={ex} /> · {t('Change exercise')}</button>}
    <ExerciseMeta ex={ex} cardio={cardio} target={targetLine(entry, S.unit)} rest={restSecondsFor(entry, S)} best={best} unit={S.unit}
      lastText={lastWorkingText(entry.id, last)} />
    <CardioTestHint S={S} ex={ex} entry={entry} />
    {rpGroup && rpLandmarks && <RpVolumeBar
      groupName={t(MUSCLE_GROUPS.find(g => g.key === rpGroup)?.name || rpGroup)}
      sets={rpVolume} landmarks={rpLandmarks} />}
    <ExerciseCues entry={entry} ex={ex} prefs={prefs} />
    {plan && plan.why && plan.kind !== 'off' && <div className={'progline' + (plan.kind === 'deload' ? ' warn' : '')}>
      <Icon name={plan.kind === 'up' ? 'arrowUp' : plan.kind === 'deload' ? 'arrowDown' : 'lightbulb'} />
      <span>{t(...plan.why)}</span>
    </div>}
    <CheckinNote S={S} ex={ex} />
    {rec && <RecommendationCard rec={rec} unit={S.unit} onAccept={() => onRec(true)} onKeep={() => onRec(false)} />}
    {plateAt >= 0 && <div className="exercise-target-row">
      <button className="exercise-plates-btn" aria-label={t('Plate breakdown')} onClick={() => onPlates(plateAt)}>
        <Icon name="barbell" />{t('Plates')}<span>{setBadge(entry.sets, plateAt)}</span>
        <em>{perSideLabel(S, ex, entry.sets[plateAt].w)}</em>
      </button>
    </div>}
    {bestAchievement && <div className={'progline' + (bestAchievement === 'pr' ? ' pr' : '')}>
      <Icon name={bestAchievement === 'pr' ? 'trophy' : 'arrowUp'} />
      <span>{bestAchievement === 'pr' ? t('New PR this session!') : t('Overload achieved')}</span>
    </div>}
    <div className="card workout-sets-card" style={{ marginTop: 10, marginBottom: 0 }}>
      {!warmupIdx.length ? <>{sethead}{entry.sets.map((s, i) => row(s, i))}</> : <>
        <div className="setgroup-hd">
          <span className="setgroup-title warm">{t('Warmup sets')}</span>
          <button className="setgroup-toggle" onClick={() => setHideWarmup(h => !h)}>
            {hideWarmup ? t('Show') : t('Hide')}<Icon name={hideWarmup ? 'chevronDown' : 'chevronUp'} />
          </button>
        </div>
        {!hideWarmup && <>{sethead}{warmupIdx.map(i => row(entry.sets[i], i))}</>}
        <div className="setgroup-hd" style={{ marginTop: 10 }}><span className="setgroup-title">{t('Working sets')}</span></div>
        {sethead}
        {workIdx.map(i => row(entry.sets[i], i))}
      </>}
      <SetFeedback entryIdx={entryIdx} />
      <div style={{ height: 8 }} />
      <div className="row">
        <Button size="sm" icon="minus" disabled={entry.sets.length <= 1} onClick={onRemoveSet}>{t('Remove set')}</Button>
        <Button size="sm" icon="plus" onClick={onAddSet}>{t('Add set')}</Button>
      </div>
    </div>
  </>
}

/* ---------- SIMPLE view: one exercise, one set, big targets ---------- */
function SimpleExercise({ entryIdx, unitEntries, ssInfo, prefs, onToggle, onPad, onPlates, onAddSet, onSetType, onStartTimed, onReplace, onFocus, onNextUnit, isLastUnit, rec, onRec }) {
  const S = useStore(s => s.S)
  const working = useUI(s => s.work)
  const entry = S.active.entries[entryIdx]
  const ex = exOr(entry.id)
  const mode = modeOf({ ...(entry.target || {}), id: entry.id })
  const fields = fieldsFor(entry, S)
  const [picked, setPicked] = useState(null)
  useEffect(() => { setPicked(null) }, [entryIdx])
  const autoIdx = currentSetIdx(entry)
  const setIdx = picked != null && entry.sets[picked] ? picked : autoIdx
  const set = entry.sets[setIdx]
  const allDone = entry.sets.every(s => s.done)
  const unitDone = unitEntries.every(i => S.active.entries[i].sets.every(s => s.done))
  const last = S.showPreviousResults !== false ? lastEntryFor(S, entry.id) : null
  const warm = set.type === 'warmup'
  const workPos = entry.sets.slice(0, setIdx).filter(s => !TYPE_LETTER[s.type]).length
  const prev = last && !warm ? last.sets[workPos] : null
  const total = workingCount(entry.sets)
  const doneWork = entry.sets.filter(s => s.done && !TYPE_LETTER[s.type]).length
  const setTitle = warm ? t('Warmup set') : set.type === 'drop' ? t('Drop set') : t('Set {0} of {1}', workPos + 1, total)
  const tile = f => {
    const v = set[f.f]
    const empty = v == null || (v === 0 && !f.weight)
    const feel = f.effort && v != null ? feelFor(f.effort, v) : null
    return <button key={f.f} className={'stile' + (f.effort ? ' eff' : '') + (empty ? ' empty' : '')} onClick={() => onPad(setIdx, f.f)}
      aria-label={f.label + ': ' + (empty ? t('empty') : fmtNum(v))}>
      <span className="stile-l">{f.weight ? S.unit : f.label}</span>
      <span className="stile-v">{feel && <span className="em" aria-hidden="true">{feel.emoji}</span>}{empty ? (f.opt ? '—' : '0') : fmtNum(v)}</span>
      {f.effort && <span className="stile-s">{empty ? t('optional') : ''}</span>}
    </button>
  }
  const showPlates = platesApply(S, ex.eq, entry, set) && set.w > 0

  return <div className="simple">
    {unitEntries.length > 1 && <div className="ss-tabs" role="tablist" aria-label={t('Superset')}>
      {unitEntries.map(i => {
        const e = S.active.entries[i]
        return <button key={i} role="tab" aria-selected={i === entryIdx} className={'ss-tab' + (i === entryIdx ? ' on' : '')}
          style={{ '--ss-color': `var(--${ssInfo[i].token})` }} onClick={() => onFocus(i)}>
          <span className="ss-badge">{supersetLabel(ssInfo[i])}</span><span className="ss-tn">{nameFor(exOr(e.id))}</span>
          <span className="ss-tc">{e.sets.filter(s => s.done).length}/{e.sets.length}</span>
        </button>
      })}
    </div>}
    <div className="shero" key={entryIdx}>
      {prefs.images && <Media ex={ex} key={entry.id} compact minimizable />}
      <div className="shero-name">
        <h2 className="exname">{nameFor(ex)}</h2>
        <button className="iconbtn" aria-label={t('Details')} onClick={() => exerciseDetailSheet(ex)}><Icon name="info" /></button>
      </div>
      {!S.active?.past && !compatibleWithGym(S, ex) && <button className="chip" onClick={onReplace}><GymCompatibility ex={ex} /> · {t('Change exercise')}</button>}
      <div className="shero-meta">
        <ExerciseMeta ex={ex} cardio={mode === 'cardio'} target={targetLine(entry, S.unit)} rest={restSecondsFor(entry, S)} unit={S.unit}
          lastText={lastWorkingText(entry.id, last)} />
        <CardioTestHint S={S} ex={ex} entry={entry} />
        <button className="tag swap nocap" onClick={onReplace}><Icon name="shuffle" />{t('Change exercise')}</button>
      </div>
      {/* the trainer's note sits above the set — it is part of what to do right now */}
      <ExerciseCues entry={entry} ex={ex} prefs={prefs} only="note" />
    </div>
    <CheckinNote S={S} ex={ex} />
    {rec && <RecommendationCard rec={rec} unit={S.unit} onAccept={() => onRec(true)} onKeep={() => onRec(false)} />}

    <div className={'sset' + (warm ? ' warm' : '') + (set.done ? ' done' : '')}>
      <div className="sset-hd">
        <span className="sset-t">{setTitle}{set.done && <Icon name="checkCircle" />}</span>
        <span className="sset-c">{t('{0} of {1} done', doneWork, total)}</span>
      </div>
      <div className="sdots" role="tablist" aria-label={t('Sets')}>
        {entry.sets.map((s, i) => <button key={i} role="tab" aria-selected={i === setIdx}
          className={'sdot' + (s.done ? ' on' : '') + (i === setIdx ? ' cur' : '') + (s.type ? ' ' + s.type : '')}
          aria-label={(s.type === 'warmup' ? t('Warmup set') : t('Set {0}', setBadge(entry.sets, i))) + (s.done ? ' · ' + t('done') : '')}
          onClick={() => setPicked(i)}>{s.done && !s.type ? <Icon name="check" /> : setBadge(entry.sets, i)}</button>)}
        <button className="sdot add" aria-label={t('Add set')} onClick={onAddSet}><Icon name="plus" /></button>
      </div>
      <SetFeedback entryIdx={entryIdx} />
      {prev && <div className="sprev"><Icon name="history" />{t('Last time')}: {setLabel(entry.id, prev, last.target)}</div>}
      <div className={'stiles n' + fields.length}>{fields.map(tile)}</div>
      {showPlates && <button className="splates" onClick={() => onPlates(setIdx)}>
        <Icon name="barbell" /><span className="splates-l">{t('Plates')}</span><span className="splates-v">{perSideLabel(S, ex, set.w)}</span><Icon name="chevronRight" />
      </button>}
      {mode === 'time' && !set.done && <Button icon="play" disabled={!!working} onClick={() => onStartTimed(setIdx)} style={{ marginBottom: 8 }}>{t('Start set')}</Button>}
      {unitDone && allDone
        ? (isLastUnit
          ? <><Button variant="primary" icon="flag" onClick={finishWorkout}>{t('Finish workout')}</Button><Button variant="ghost" onClick={() => finishWorkout({ excludeFromProgression: true })}>{t('Finish without progression')}</Button></>
          : <Button variant="primary" trailingIcon="chevronRight" onClick={onNextUnit}>{t('Next exercise')}</Button>)
        : <Button variant={set.done ? 'plain' : 'primary'} icon={set.done ? 'reset' : 'check'} className="scomplete" onClick={() => onToggle(setIdx)}>
          {set.done ? t('Mark as not done') : t('Complete set')}
        </Button>}
      <button className="stype" onClick={() => onSetType(setIdx)}>{t('Set type')}: {t(set.type === 'warmup' ? 'Warmup' : set.type === 'drop' ? 'Drop set' : set.type === 'failure' ? 'Failure set' : 'Normal set')}</button>
    </div>
    <ExerciseCues entry={entry} ex={ex} prefs={prefs} only="tips" />
    {entry.plan && entry.plan.why && entry.plan.kind !== 'off' && <div className={'progline' + (entry.plan.kind === 'deload' ? ' warn' : '')}>
      <Icon name={entry.plan.kind === 'up' ? 'arrowUp' : entry.plan.kind === 'deload' ? 'arrowDown' : 'lightbulb'} />
      <span>{t(...entry.plan.why)}</span>
    </div>}
  </div>
}

/* ---------- active workout ---------- */
function ActiveWorkout() {
  useStore(s => s.gymProfileRevision)
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const update = useStore(s => s.update)
  const { startRest, stopRest, toast } = useUI()
  const prefs = workoutPrefs(S)
  // Weekly Volume Zones' history half, memoized against S.workouts so typing into a set doesn't
  // re-scan the week's finished workouts on every keystroke.
  const rpFinished = useMemo(
    () => S.enableRpVolumeZones ? weeklyGroupVolumeFinished(S, muscleOptsOf(S)) : null,
    [S.enableRpVolumeZones, S.workouts, S.countSecondaryMuscles, S.secondaryMuscleFactor]
  )
  const A = S.active
  const units = supersetUnits(A.entries)
  const cur = Math.min(A.cur, Math.max(0, A.entries.length - 1))
  const unit = A.entries.length ? unitOf(units, cur) : []
  const unitIdx = units.findIndex(u => u === unit)
  const isSuperset = unit.length > 1
  const ssInfo = supersetGroupInfo(A.entries)
  // Which exercise of a superset the simple view shows: the member's own pick, else the one
  // due next (A1, A2, A1, A2 …). Presentation only — never stored in the session.
  const [focus, setFocus] = useState(null)
  useEffect(() => { setFocus(null) }, [unitIdx])
  const simpleIdx = unit.includes(focus) ? focus : (unit.length ? nextInUnit(A.entries, unit) : cur)

  const total = A.entries.reduce((n, e) => n + e.sets.length, 0)
  const done = setsDoneActive(A)
  // Guided blocks (Constructor V2.1): the run in progress takes the screen; otherwise the block
  // the member is on offers to run paced, above the normal set logging (which keeps working).
  const guidedRun = A.guided ? (A.guidedBlocks || []).find(b => b.iid === A.guided.iid) || null : null
  const guidedHere = A.entries.length ? guidedBlockFor(A, cur) : null

  const mutEntry = (idx, fn) => update(s => { fn(s.active.entries[idx]) }, true)
  // Clearing an optional field drops the key rather than storing null, so a set only carries
  // what was actually logged — in the session, in history and in a backup.
  const effKind = effortOf(S)
  // A warmup/drop set's weight (or effort) is deliberately different from the straight sets
  // around it, so it neither hands its own value forward nor accepts one carried into it.
  const carriable = s => s.type !== 'warmup' && s.type !== 'drop'
  const setField = (idx, i, field, v) => mutEntry(idx, e => {
    if (v == null) delete e.sets[i][field]; else e.sets[i][field] = v
    // Entering a weight (or an RIR/RPE) before checking a set off carries it forward to the later
    // sets of the same exercise that aren't done yet — straight sets usually share it.
    if ((field === 'w' || (effKind !== 'none' && field === effKind)) && v != null && !e.sets[i].done && carriable(e.sets[i])) {
      for (let j = i + 1; j < e.sets.length; j++) { if (!e.sets[j].done && carriable(e.sets[j])) e.sets[j][field] = v }
    }
  })
  const modeAt = idx => modeOf({ ...(A.entries[idx].target || {}), id: A.entries[idx].id })
  const addSet = idx => mutEntry(idx, e => {
    const l = e.sets[e.sets.length - 1]
    const m = modeOf({ ...(e.target || {}), id: e.id })
    if (m === 'cardio') e.sets.push({ min: l ? l.min : (e.target.min || 20), speed: l ? l.speed : (e.target.speed || 8), done: false })
    else if (m === 'time') e.sets.push({ sec: l ? l.sec : (e.target.sec || 45), w: l ? (l.w || 0) : (e.target.weight || 0), done: false })
    else e.sets.push({ w: l ? l.w : 0, r: l ? l.r : e.target.reps, done: false })
  })
  const removeSet = idx => mutEntry(idx, e => { if (e.sets.length > 1) e.sets.pop() })
  const removeSetAt = (idx, i) => mutEntry(idx, e => { if (e.sets.length > 1) e.sets.splice(i, 1) })
  // Failure means "taken to failure": fill in RIR 0 / RPE 10 if the set hasn't been rated yet.
  const setType = (idx, i, type) => mutEntry(idx, e => {
    if (type) e.sets[i].type = type; else delete e.sets[i].type
    if (type === 'failure' && effKind !== 'none' && e.sets[i][effKind] == null) {
      e.sets[i][effKind] = effKind === 'rpe' ? 10 : 0
    }
  })
  const openSetType = (idx, i) => setTypeSheet(A.entries[idx].sets[i].type, type => setType(idx, i, type), () => removeSetAt(idx, i))

  // Swap one exercise for another mid-session without touching the routine — target, plan and
  // sets carry over; `active.swaps` remembers the ORIGINAL id per slot so finishWorkout can offer
  // to make the change stick in the routine.
  const replaceExercise = idx => {
    const current = exOr(A.entries[idx].id)
    alternativesSheet(current, newEx => {
      if (newEx.id === current.id) return
      update(s => {
        const e = s.active.entries[idx]
        const swaps = (s.active.swaps ||= {})
        if (!(idx in swaps)) swaps[idx] = e.id
        else if (swaps[idx] === newEx.id) delete swaps[idx]
        e.id = newEx.id
      })
      useUI.getState().toast(t('Replaced with {0}', nameFor(newEx)))
    })
  }

  // A timed set is held, not typed: the work timer records what was actually held, then checks
  // the set off through the normal path.
  const startTimed = (idx, i) => {
    const e = A.entries[idx]
    useUI.getState().startWork(e.sets[i].sec || 45, nameFor(exOr(e.id)), elapsed => {
      mutEntry(idx, en => { en.sets[i].sec = elapsed })
      if (!useStore.getState().S.active.entries[idx].sets[i].done) actions.current.toggle(idx, i)
    })
  }

  const toggle = (idx, i) => {
    const m = modeAt(idx)
    const cardioEntry = m === 'cardio'
    const isLastUnit = unitIdx >= units.length - 1
    let askTop = false, exJustDone = false, workoutDone = false
    mutEntry(idx, e => {
      e.sets[i].done = !e.sets[i].done
      if (e.sets[i].done) {
        // A past log is filled in after the fact — no rest timer, sound or weight prompt.
        if (!A.past) { beep(S.sound, 1040, 0.12); if (prefs.vibrate) vibrate(30) }
        const isLastExInUnit = idx === unit[unit.length - 1]
        const unitDone = unit.every(ui => (ui === idx ? e : A.entries[ui]).sets.every(x => x.done))
        if (!A.past) {
          // The trainer's prescribed rest for this exercise (Constructor V2 / 2J protocol) wins
          // over the member's general setting; without one, nothing changes.
          if (isLastExInUnit && !unitDone) startRest(restSecondsFor(e, S), nameFor(exOr(e.id)))
          else if (unitDone) stopRest()
        }
        if (unitDone && isLastUnit) workoutDone = true
        if (e.sets.every(x => x.done)) { exJustDone = true; if (m === 'reps' && !e.asked && !A.past) { e.asked = true; askTop = true } }
      }
    })
    setFocus(null)
    if (askTop) topWeightSheet(idx)
    else if (workoutDone) workoutCompleteSheet()
    else if (exJustDone && cardioEntry) useUI.getState().toast(t('Cardio logged'))
    else if (exJustDone && m === 'time') useUI.getState().toast(t('Hold logged'))
  }

  // Contextual plate calculator: opens on the set's weight with this exercise's bar; "Apply"
  // writes through the same setField path, and a bar picked here is remembered per exercise
  // (a preference, not part of the session).
  const openPlates = (idx, i) => {
    const e = A.entries[idx]
    const ex = exOr(e.id)
    platesSheet(e.sets[i].w || 0, S.unit, v => setField(idx, i, 'w', v), barFor(S, ex),
      barId => update(s => { s.barByExercise = { ...(s.barByExercise || {}), [ex.id]: barId } }))
  }

  // The set pad reads the session fresh from the store and calls back through this ref, so the
  // completion path it uses is always this render's (current unit, current rest settings).
  const actions = useRef(null)
  actions.current = { toggle, setField, openPlates }
  const padActions = useMemo(() => ({
    onField: (idx, i, f, v) => actions.current.setField(idx, i, f, v),
    onToggle: (idx, i) => actions.current.toggle(idx, i),
    onPlates: (idx, i) => actions.current.openPlates(idx, i),
  }), [])
  const openPad = (idx, i, field) => openSetPad({ entryIdx: idx, setIdx: i, field, actions: padActions })

  // Intelligent progression V1 — offered before an exercise's first working set; accepting
  // changes only this session's unfinished sets, never the routine.
  const recOf = idx => recommendationFor(S, A.entries[idx], exOr(A.entries[idx].id).eq, { past: A.past })
  const decideRec = (idx, accept) => {
    const rec = recOf(idx)
    if (!rec) return
    update(s => {
      const e = s.active.entries[idx]
      if (accept) acceptRecommendation(e, rec, s.unit)
      else keepPlan(e, rec)
    })
  }

  // Live-presence heartbeat so the admin dashboard can show who's training now.
  useEffect(() => {
    if (A.past) return
    if (!useStore.getState().user) return
    let stopped = false
    const ping = active => {
      const A2 = useStore.getState().S.active
      if (!A2) return
      const u = supersetUnits(A2.entries)
      const c = Math.min(A2.cur, Math.max(0, A2.entries.length - 1))
      const ui = u.findIndex(x => x.includes(c))
      const tot = A2.entries.reduce((n, e) => n + e.sets.length, 0)
      api('/api/activity', { method: 'POST', body: JSON.stringify({
        active, name: A2.name, exIdx: ui + 1, exTotal: u.length,
        setsDone: setsDoneActive(A2), setsTotal: tot, startedAt: A2.start
      }) }).catch(() => {})
    }
    ping(true)
    const iv = setInterval(() => { if (!stopped) ping(true) }, 20000)
    return () => {
      stopped = true; clearInterval(iv)
      try { navigator.sendBeacon?.('/api/activity', new Blob([JSON.stringify({ active: false })], { type: 'application/json' })) } catch { /* */ }
      api('/api/activity', { method: 'POST', body: JSON.stringify({ active: false }) }).catch(() => {})
    }
  }, [])

  // One-shot, explicit handoff to the Bunker kiosk. push:false is load-bearing: the server
  // already has the real S.active; this device has nothing left to tell it.
  const handoffBunker = force => {
    handoffToBunker(A, force).then(() => {
      update(s => { s.active = null }, false)
      stopRest()
      toast(t('Transferred — enter your PIN at the Bunker to continue there'))
      nav('/home')
    }).catch(e => {
      if (e.status === 409 && e.data?.code !== 'WORKOUT_COMPLETED') {
        confirmSheet({
          title: t('A different session is already at the Bunker'),
          message: t('"{0}" is already in progress there. Replace it with this one?', e.data?.existing?.name || t('Workout')),
          confirmText: t('Replace'), danger: true,
          onConfirm: () => handoffBunker(true)
        })
      } else toast(e.message)
    })
  }

  const goUnit = d => update(s => { s.active.cur = units[unitIdx + d][0] })
  const blockProps = idx => ({
    prefs, onToggle: i => toggle(idx, i), onPad: (i, f) => openPad(idx, i, f), onPlates: i => openPlates(idx, i),
    onAddSet: () => addSet(idx), onRemoveSet: () => removeSet(idx), onStartTimed: i => startTimed(idx, i),
    onSetType: i => openSetType(idx, i), onReplace: () => replaceExercise(idx),
    rec: recOf(idx), onRec: accept => decideRec(idx, accept),
  })

  return <div className="narrow workout">
    <div className="hdr v3-hdr">
      <button className="iconbtn" aria-label={t('Discard')} onClick={() => confirmSheet({ title: t(A.past ? 'Discard this log?' : 'Discard workout?'), message: t(A.past ? 'What you’ve entered for this day will be lost.' : 'The sets you logged in this session will be lost.'), confirmText: t('Discard'), danger: true, onConfirm: () => {
        const id = A.id
        update(s => { s.active = null })
        stopRest(); disconnectHeartRate(); nav('/home')
        // The local mutation above only clears this device's view; the server keeps S.active for
        // the Bunker until this explicit clear (see useStore.js's clearActiveOnServer).
        useStore.getState().clearActiveOnServer(id)
      } })}><Icon name="xmark" /></button>
      <div style={{ textAlign: 'center', minWidth: 0 }}><div className="wtitle">{A.name}</div><div className="sub">{A.past ? fmtDate(A.d, true) : <Elapsed start={A.start} />} · {t('{0} sets', done + '/' + total)}</div></div>
      <button className="iconbtn" style={{ color: 'var(--acc)' }} aria-label={t(A.past ? 'Save' : 'Finish')} onClick={finishWorkout}><Icon name="check" /></button>
    </div>
    {A.entries.length > 0 && <WorkoutProgress entries={A.entries} units={units} unitIdx={Math.max(0, unitIdx)} done={done} total={total} superset={isSuperset}
      onGo={i => update(s => { s.active.cur = units[i][0] })} />}
    {!A.past && <GymProfile />}
    {!A.past && <IntelligenceToday S={S} user={user} max={1} compact types={['EQUIPMENT_CONFLICT', 'PROGRESSION_READY', 'LOAD_TOO_HIGH']} />}
    {/* Entrena con 2J: the routine's own artwork carries into the session it started. */}
    {A.src2j && <div className="t2-inwork"><WorkoutCover r={{ id: A.src2j.id, category: A.src2j.category }} shape="square" />
      <span><span className="t2-promo-k">{t('Train with 2J')}</span><b>{A.name}</b></span></div>}

    {/* Pre-workout check-in (Health V2): offered before the first set only, per the member's
        setting, skippable in one tap — the session works the same either way. */}
    {!A.past && done === 0 && shouldAskCheckin(S, { past: A.past }) && <CheckInCard compact />}

    {guidedRun ? <GuidedRunner key={guidedRun.iid} block={guidedRun} /> : A.entries.length ? <>
      {guidedHere && !A.past && <GuidedLaunch key={guidedHere.iid} block={guidedHere} />}
      <div className="wbar">
        {!A.past ? <HeartRateLive S={S} workoutId={A.id} /> : <span />}
        {/* Two presentations of the same session — switching never touches S.active. */}
        <Segmented className="seg-inline wview" value={prefs.view}
          options={[{ value: 'simple', label: t('Simple') }, { value: 'detailed', label: t('Detailed') }]}
          onChange={v => update(s => { s.workoutView = v })} />
      </div>
      {prefs.view === 'simple'
        ? <SimpleExercise key={simpleIdx} entryIdx={simpleIdx} unitEntries={unit} ssInfo={ssInfo} {...blockProps(simpleIdx)}
          onFocus={setFocus} isLastUnit={unitIdx >= units.length - 1} onNextUnit={() => goUnit(1)} />
        : isSuperset ? (
          <div className="ss-card" style={{ '--ss-color': `var(--${ssInfo[unit[0]].token})` }}>
            <div className="ss-hd"><Icon name="link" />{t('Superset · do these back-to-back, rest after both')}</div>
            {unit.map((idx, k) => <div key={idx} className="ss-ex">
              {k > 0 && <div className="ss-amp">+</div>}
              <ExerciseBlock entryIdx={idx} compact rpFinished={rpFinished} ssLabel={supersetLabel(ssInfo[idx])} {...blockProps(idx)} />
            </div>)}
          </div>
        ) : <ExerciseBlock entryIdx={cur} rpFinished={rpFinished} {...blockProps(cur)} />}
    </> : <div className="empty"><div className="ico"><Icon name="shuffle" /></div>{t('Freestyle workout — add your first exercise.')}</div>}

    {!guidedRun && A.entries.length > 0 && <NextUp next={nextUnit(A.entries, units, unitIdx)} images={prefs.images} onGo={() => goUnit(1)} />}
    <div style={{ height: 12 }} />
    {!guidedRun && <>
    <div className="row">
      <Button icon="chevronLeft" disabled={unitIdx <= 0} onClick={() => goUnit(-1)}>{t('Prev')}</Button>
      <Button trailingIcon="chevronRight" disabled={unitIdx < 0 || unitIdx >= units.length - 1} onClick={() => goUnit(1)}>{t('Next')}</Button>
    </div>
    <div style={{ height: 10 }} />
    <Button onClick={() => exercisePicker(ex => exConfigSheet(ex, null, cfg => update(s => {
      const full = { ...cfg, id: ex.id }
      const plan = nextPrescription(s, full, s.routines.find(r => r.id === s.active.routineId))
      s.active.entries.push({ id: ex.id, target: targetForPrescription(cfg, plan), plan, sets: applyPrescription(buildSets(s, full), plan) })
      s.active.cur = s.active.entries.length - 1
    }), null, S.routines.find(r => r.id === A.routineId)))} icon="plus">{t('Add exercise')}</Button>
    <div style={{ height: 10 }} />
    {!A.past && <>
      <Button variant="tinted" icon="dumbbell" onClick={() => handoffBunker(false)}>{t('Transfer to the Bunker')}</Button>
      <div style={{ height: 10 }} />
    </>}
    </>}
    {(() => {
      const exDone = A.entries.filter(e => e.sets.length && e.sets.every(s => s.done)).length
      const allDone = A.entries.length > 0 && exDone === A.entries.length
      return <><button className={allDone || A.past ? 'btn primary' : 'btn ghost dim'} onClick={finishWorkout}>
        {A.past ? t('Save workout') : allDone ? t('Finish workout') : t('Finish workout early · {0} exercises', exDone + '/' + A.entries.length)}
      </button>{!A.past && <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => finishWorkout({ excludeFromProgression: true })}>{t('Finish without progression')}</button>}</>
    })()}
    <div style={{ height: 40 }} />
  </div>
}

export default function Workout() {
  const active = useStore(s => s.S.active)
  return active ? <ActiveWorkout /> : <StartChooser />
}
