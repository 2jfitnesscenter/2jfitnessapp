import { useEffect, useRef, useState } from 'react'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { EXDB, EXIDX, BODYPARTS, isCardio, allExercises, equipmentOf, isHidden, exOr } from './lib/exercises.js'
import { fmtDate, fmtNum, fmtVol, fmtDur, durPart, todayISO, uid, exCount, DAYN, MONTHS_LONG, ACCENTS, ageFrom } from './lib/format.js'
import { lastEntryFor, bestWeightFor, buildSets, effectiveRoutineId, activeWeek, workoutVolume, setsDone, setsDoneActive, lastBW, hasRecentWeighIn, supersetUnits, unitOf, setLabel, defaultConfig, cleanupSg, modeOf, effortOf } from './lib/history.js'
import { beep, vibrate } from './lib/sound.js'
import { t, instrFor, nameFor, getLang, INSTR_LANGS } from './lib/i18n.js'
import { nav } from './lib/nav.js'
import { starterRoutines, buildPlan, GOALS } from './lib/starter.js'
import Media, { Thumb } from './components/Media.jsx'
import BarbellPlates, { plateBreakdown } from './components/BarbellPlates.jsx'
import Stepper from './components/Stepper.jsx'
import Icon from './components/Icon.jsx'
import { Button, Slider, Switch, Segmented, SelectRow, TextArea, TextField, Avatar, Row, ChipSelect, Check } from './components/ui.jsx'
import { glyphOf, GLYPH_GROUPS, DEFAULT_GLYPH } from './lib/glyphs.js'
import BodyMap from './components/BodyMap.jsx'
import { loadOfWorkouts, MUSCLE_GROUPS, musclePhotoUrl, musclesOf } from './lib/muscles.js'
import { rankUpsFor, rankEmblemUrl } from './lib/rank.js'
import { parseImport, mergeImport } from './lib/import-csv.js'
import { parsePlan, mergePlan, printPlan } from './lib/plan-share.js'
import { estimate1RM, best1RM, is1RMRecord, REP_CAP, oneRMTests, bestTestedOneRM } from './lib/onerm.js'
import { nextPrescription, applyPrescription, policyFor, defaultIncrement, POLICIES_FOR, POLICY_NAME, POLICY_DESC } from './lib/progression.js'
import { MOBILE } from './lib/mobile.js'
import { MEASUREMENTS, MEASUREMENT, lastMeasurement } from './lib/measurements.js'
import { resizeImageFile, uploadImage, mediaUrl } from './lib/media.js'
import ScanUpload from './components/ScanUpload.jsx'
import { fetchFriendCode, resetFriendCode, sendFriendRequest } from './lib/friends-api.js'
import { startThread } from './lib/chat-api.js'
import { sendWorkoutToStrava } from './lib/strava-api.js'

const S = () => useStore.getState().S
const update = (...a) => useStore.getState().update(...a)
const ui = () => useUI.getState()
const toast = m => ui().toast(m)
const snd = () => S().sound

/* ============================ custom confirm dialog ============================ */
function ConfirmDialog({ title, message, confirmText, cancelText, danger, onConfirm, close }) {
  return <div style={{ textAlign: 'center', padding: '4px 0' }}>
    {title && <h3 style={{ marginBottom: 8 }}>{title}</h3>}
    <div className="muted" style={{ marginBottom: 18, lineHeight: 1.5 }}>{message}</div>
    <button className={'btn ' + (danger ? 'danger' : 'primary')} onClick={() => { close(); onConfirm && onConfirm() }}>{confirmText || t('Confirm')}</button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{cancelText || t('Cancel')}</Button>
  </div>
}
// Themed replacement for window.confirm — callback-based (no blocking).
export function confirmSheet(opts) {
  ui().openSheet(close => <ConfirmDialog {...opts} close={close} />, { kind: 'center' })
}

/* ============================ starter plan ============================ */
// A quick, non-AI alternative to the Coach intake: same Push/Pull/Legs exercise selection as
// starterRoutines(), but the rep range/set count (from goal) and which weekdays it lands on
// (from day count) come from what was actually asked for instead of one fixed 3-day default.
const GOAL_LABEL = { hypertrophy: 'Build muscle', toning: 'Tone up', fatloss: 'Lose fat', power: 'Power', plyometrics: 'Plyometrics', longevity: 'Health & longevity' }
// Common, evenly-spread weekday patterns per day count — simpler and less fiddly than asking
// someone to hand-pick exact weekdays for a plan they can already reschedule day by day later.
const DAY_SPREAD = { 2: [1, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 4, 5], 6: [1, 2, 3, 4, 5, 6] }

// Same options CoachIntake's own session-length step offers — a quick plan and an AI Coach plan
// should size a session the same way.
const SESSION_MIN = [30, 45, 60, 75, 90]

function StarterPlanIntake({ close }) {
  const [goal, setGoal] = useState('longevity')
  const [days, setDays] = useState(3)
  const [sessionMin, setSessionMin] = useState(60)
  const apply = () => {
    update(st => {
      const { routines, week } = buildPlan(goal, DAY_SPREAD[days], st.priorityMuscles, st.secondaryMuscles, sessionMin)
      st.routines.push(...routines)
      // The whole point of the quick generator is to set up the week for you — wrap the result
      // into a program (routines + their own schedule) and make it active, same as a hand-built
      // one. Non-destructive like before: this adds a new program each time rather than
      // replacing whatever's already there, and simply switches which one is active.
      st.programs = st.programs || []
      st.programs.push({
        id: uid(), name: t('Quick plan ({0})', t(GOAL_LABEL[goal])), emoji: 'sparkles',
        routineIds: routines.map(r => r.id), week
      })
      st.activeProgramId = st.programs[st.programs.length - 1].id
    })
    close()
    toast(t('Plan loaded — {0} days a week', days))
  }
  return <>
    <h3>{t('Set up your plan')}</h3>
    <div className="muted small" style={{ marginBottom: 10 }}>{t('What are you training for?')}</div>
    <div className="sect-b">
      {GOALS.map(g => <button key={g} className="lrow tap" onClick={() => setGoal(g)}>
        <span className="lrow-m"><span className="lrow-t">{t(GOAL_LABEL[g])}</span></span>
        {goal === g && <Icon name="check" className="lrow-k" />}
      </button>)}
    </div>
    <div className="muted small" style={{ margin: '14px 0 8px' }}>{t('How many days a week?')}</div>
    <Segmented options={[2, 3, 4, 5, 6].map(n => ({ value: n, label: String(n) }))} value={days} onChange={setDays} />
    <div className="muted small" style={{ margin: '14px 0 8px' }}>{t('How long is a session?')}</div>
    <Segmented options={SESSION_MIN.map(n => ({ value: n, label: n + ' ' + t('min') }))} value={sessionMin} onChange={setSessionMin} />
    <div style={{ height: 14 }} />
    <Button variant="primary" icon="sparkles" onClick={apply}>{t('Build my plan')}</Button>
  </>
}
export function loadStarterPlan() {
  ui().openSheet(close => <StarterPlanIntake close={close} />)
}

/* ============================ weight picker (shared: body weight + goal) ============================ */
// Fixed range, not a moving window — a window that resizes itself mid-drag (the previous
// attempt) makes the thumb's position unpredictable: every time it grows, everything already
// placed on it shifts toward one side. A static range never has that problem, at the cost of
// coarser precision per pixel — the +/- buttons cover exact values.
// The ceiling follows the profile's unit: 300 covers a body weight or a working weight in
// kg, but as pounds it cut off at 136 kg — below plenty of people's body weight, and well
// below an everyday squat.
const W_LO = 1
const wHi = unit => (unit === 'lb' ? 660 : 300)
function WeightInput({ value, setValue, unit }) {
  const W_HI = wHi(unit)
  const clamp = x => Math.max(W_LO, Math.min(W_HI, Math.round((x || 0) * 10) / 10))
  const sv = Math.max(W_LO, Math.min(W_HI, value))
  const onSlide = v => setValue(clamp(v))
  return <>
    <div className="bwstep">
      <button className="bw-pm" onClick={() => onSlide(value - 0.1)} aria-label={t('minus 0.1')}><Icon name="minus" /></button>
      <div className="bw-read">{fmtNum(value)}<span className="u"> {unit}</span></div>
      <button className="bw-pm" onClick={() => onSlide(value + 0.1)} aria-label={t('plus 0.1')}><Icon name="plus" /></button>
    </div>
    <div className="chips" style={{ justifyContent: 'center', margin: '8px 0' }}>
      <button className="chip" onClick={() => onSlide(value - 1)}>−1</button>
      <button className="chip" onClick={() => onSlide(value - 0.5)}>−0.5</button>
      <button className="chip" onClick={() => onSlide(value + 0.5)}>+0.5</button>
      <button className="chip" onClick={() => onSlide(value + 1)}>+1</button>
    </div>
    <Slider value={sv} min={W_LO} max={W_HI} step={0.5} onChange={onSlide} />
  </>
}

/* ============================ body weight ============================ */
function BwSheet({ required, onDone, close }) {
  const st = useStore(s => s.S)
  const unit = st.unit
  const bw = lastBW(st)
  const [v, setV] = useState(bw ? bw.w : 70)
  const save = () => {
    const n = Math.round((v || 0) * 10) / 10
    if (!n || n <= 0) { toast(t('Enter a valid weight')); return }
    update(s => {
      const iso = todayISO()
      const ex = s.bodyweight.find(b => b.d === iso)
      if (ex) { ex.w = n; ex.t = Date.now() } else s.bodyweight.push({ d: iso, w: n, t: Date.now() })
      s.bodyweight.sort((a, b) => (a.d < b.d ? -1 : 1))
    })
    close()
    if (onDone) onDone(n); else toast(t('Weight saved'))
  }
  const recent = [...st.bodyweight].reverse().slice(0, 3)
  const delEntry = d => update(s => { s.bodyweight = s.bodyweight.filter(b => b.d !== d) })
  return <>
    <h3>{required ? t('Quick check-in') : t('Log body weight')}</h3>
    <div className="muted small">{required ? t('Slide or tap to set your weight — tracked before every workout so your curve stays honest.') : t('Today') + ', ' + fmtDate(todayISO(), true)}</div>
    <WeightInput value={v} setValue={setV} unit={unit} />
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{required ? t('Save & start workout') : t('Save')}</Button>
    {required && <>
      <div style={{ height: 8 }} /><Button variant="ghost" className="dim" onClick={() => { close(); onDone && onDone(null) }}>{t('Start without weighing in')}</Button>
      <div style={{ height: 2 }} /><Button variant="ghost" className="dim" icon="reset" onClick={() => { close(); nav('/workout') }}>{t('Choose a different workout')}</Button>
    </>}
    {!required && recent.length > 0 && <>
      <h4 className="sec">{t('Recent weigh-ins')}</h4>
      <div className="list" style={{ gap: 0 }}>
        {recent.map(b => <div key={b.d} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
          <span className="small muted">{fmtDate(b.d, true)}</span>
          <span className="row" style={{ gap: 12 }}><b>{fmtNum(b.w)} {unit}</b>
            <button className="iconbtn" style={{ width: 32, height: 30, borderRadius: 8, fontSize: 15, color: 'var(--red)' }} onClick={() => delEntry(b.d)} aria-label={t('Delete')}><Icon name="trash" /></button></span>
        </div>)}
      </div>
    </>}
  </>
}
export function bwSheet(opts = {}) {
  const h = ui().openSheet(close => <BwSheet {...opts} close={close} />, { locked: !!opts.required })
  return h
}

/* ============================ body measurements ============================ */
// One generic entry sheet for every type in lib/measurements.js — same upsert-by-date shape as
// bodyweight (BwSheet above), just parameterised by which measurement it is instead of there
// being only one. A gym admin entering a full bioimpedance scan uses BioimpedanceSheet in
// Admin.jsx instead — that one's several fields from a single Tanita reading, not one of these.
function MeasurementInput({ m, value, setValue }) {
  const clamp = x => Math.max(m.min, Math.min(m.max, m.dec ? Math.round((x || 0) * 10) / 10 : Math.round(x || 0)))
  const step = m.dec ? 0.5 : 1
  const onSlide = v => setValue(clamp(v))
  return <>
    <div className="bwstep">
      <button className="bw-pm" onClick={() => onSlide(value - step)} aria-label={t('Decrease')}><Icon name="minus" /></button>
      <div className="bw-read">{fmtNum(value)}{m.unit && <span className="u"> {m.unit}</span>}</div>
      <button className="bw-pm" onClick={() => onSlide(value + step)} aria-label={t('Increase')}><Icon name="plus" /></button>
    </div>
    <Slider value={clamp(value)} min={m.min} max={m.max} step={m.step} onChange={onSlide} />
  </>
}
function MeasurementSheet({ mkey, close }) {
  const st = useStore(s => s.S)
  const m = MEASUREMENT[mkey]
  const last = lastMeasurement(st, mkey)
  const [v, setV] = useState(last ? last.v : (m.min + m.max) / 2)
  const save = () => {
    update(s => {
      s.measurements = s.measurements || {}
      const list = s.measurements[mkey] = s.measurements[mkey] || []
      const iso = todayISO()
      const ex = list.find(x => x.d === iso)
      if (ex) { ex.v = v; ex.t = Date.now() } else list.push({ d: iso, v, t: Date.now() })
      list.sort((a, b) => (a.d < b.d ? -1 : 1))
    })
    close()
    toast(t('Saved'))
  }
  const recent = [...(st.measurements?.[mkey] || [])].reverse().slice(0, 5)
  const delEntry = d => update(s => { s.measurements[mkey] = (s.measurements[mkey] || []).filter(x => x.d !== d) })
  return <>
    <h3>{t(m.label)}</h3>
    <div className="muted small">{fmtDate(todayISO(), true)}</div>
    <MeasurementInput m={m} value={v} setValue={setV} />
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
    {recent.length > 0 && <>
      <h4 className="sec">{t('Recent entries')}</h4>
      <div className="list" style={{ gap: 0 }}>
        {recent.map(x => <div key={x.d} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
          <span className="small muted">{fmtDate(x.d, true)}</span>
          <span className="row" style={{ gap: 12 }}><b>{fmtNum(x.v)} {m.unit}</b>
            <button className="iconbtn" style={{ width: 32, height: 30, borderRadius: 8, fontSize: 15, color: 'var(--red)' }} onClick={() => delEntry(x.d)} aria-label={t('Delete')}><Icon name="trash" /></button></span>
        </div>)}
      </div>
    </>}
  </>
}
export const measurementSheet = mkey => ui().openSheet(close => <MeasurementSheet mkey={mkey} close={close} />)

// The member-facing counterpart to Admin's BioimpedanceSheet — same 5 composition fields (the
// skinfolds stay admin-only, they're a staff-caliper reading) plus weight, filled in one go
// either by hand or by scanning a report, saved as one update() instead of one measurementSheet
// per field.
function BioimpedanceScanSheet({ close }) {
  const st = useStore(s => s.S)
  const composition = MEASUREMENTS.filter(m => m.group === 'composition')
  const segments = MEASUREMENTS.filter(m => m.group === 'segments')
  const all = [...composition, ...segments]
  const [vals, setVals] = useState(() => Object.fromEntries(all.map(m => [m.key, lastMeasurement(st, m.key)?.v ?? ''])))
  const [weight, setWeight] = useState(() => lastBW(st)?.w ?? '')
  const [scanned, setScanned] = useState(false)
  const set = (k, v) => setVals(s => ({ ...s, [k]: v }))
  const applyScan = values => {
    setVals(s => ({ ...s, ...Object.fromEntries(all.filter(m => values[m.key] != null).map(m => [m.key, values[m.key]])) }))
    if (values.weight != null) setWeight(values.weight)
    setScanned(true)
    toast(t('Report read — check the values below'))
  }
  const save = () => {
    const iso = todayISO()
    let n = 0
    update(s => {
      s.measurements = s.measurements || {}
      for (const m of all) {
        if (vals[m.key] === '' || vals[m.key] == null) continue
        const v = Number(vals[m.key])
        const list = s.measurements[m.key] = s.measurements[m.key] || []
        const ex = list.find(x => x.d === iso)
        if (ex) { ex.v = v; ex.t = Date.now() } else list.push({ d: iso, v, t: Date.now() })
        list.sort((a, b) => (a.d < b.d ? -1 : 1))
        n++
      }
      if (weight !== '' && weight != null) {
        const w = Number(weight)
        const ex = s.bodyweight.find(x => x.d === iso)
        if (ex) { ex.w = w; ex.t = Date.now() } else s.bodyweight.push({ d: iso, w, t: Date.now() })
        s.bodyweight.sort((a, b) => (a.d < b.d ? -1 : 1))
        n++
      }
    })
    if (!n) { toast(t('Enter at least one value')); return }
    close()
    toast(t('Saved'))
  }
  return <>
    <h3>{t('Scan a report')}</h3>
    <div className="row between" style={{ marginBottom: 12 }}>
      <div className="muted small" style={{ lineHeight: 1.5, flex: 1 }}>{t('Leave a field blank to leave that reading as it was.')}</div>
      <ScanUpload onResult={applyScan} />
    </div>
    {scanned && <div className="small" style={{ color: 'var(--acc)', marginBottom: 10 }}>{t('Estimated by AI — review before saving.')}</div>}
    <div style={{ marginBottom: 10 }}>
      <div className="dim small" style={{ marginBottom: 4 }}>{t('Weight')}</div>
      <input type="number" inputMode="decimal" className="input" step={0.1} min={20} max={400}
        placeholder="— kg" value={weight} onChange={e => setWeight(e.target.value)} />
    </div>
    {composition.map(m => <div key={m.key} style={{ marginBottom: 10 }}>
      <div className="dim small" style={{ marginBottom: 4 }}>{t(m.label)}</div>
      <input type="number" inputMode="decimal" className="input" step={m.step} min={m.min} max={m.max}
        placeholder={m.unit ? `— ${m.unit}` : '—'} value={vals[m.key]} onChange={e => set(m.key, e.target.value)} />
    </div>)}
    <div className="sec" style={{ margin: '14px 0 8px' }}>{t('By segment')}</div>
    {segments.map(m => <div key={m.key} style={{ marginBottom: 10 }}>
      <div className="dim small" style={{ marginBottom: 4 }}>{t(m.label)}</div>
      <input type="number" inputMode="decimal" className="input" step={m.step} min={m.min} max={m.max}
        placeholder={m.unit ? `— ${m.unit}` : '—'} value={vals[m.key]} onChange={e => set(m.key, e.target.value)} />
    </div>)}
    <div style={{ height: 6 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
  </>
}
export const bioimpedanceScanSheet = () => ui().openSheet(close => <BioimpedanceScanSheet close={close} />)

/* ============================ import from another app ============================ */
// Shows what a parsed export would actually do before anything is written. An import is
// the one action where "just try it" is expensive — it's someone's entire training
// history — so the numbers, the unit conversion and the exercises we couldn't recognise
// are all on screen before the confirm button.
const overlapCount = (list, existing) => list.filter(x => (existing || []).some(y => y.d === x.d)).length

function ImportSummary({ parsed, close }) {
  const st = useStore(s => s.S)
  const isBW = parsed.kind === 'bodyweight'
  const isHealth = parsed.kind === 'health'

  let have, fresh, healthCounts
  if (isHealth) {
    healthCounts = {
      bodyweight: parsed.bodyweight.length, bodyFat: parsed.measurements.bodyFat.length,
      muscleMass: parsed.measurements.muscleMass.length, steps: parsed.steps.length,
      sleep: parsed.sleep.length, restingHR: parsed.restingHR.length, hr: parsed.hrZonesByWorkout.size,
    }
    const haveHR = [...parsed.hrZonesByWorkout.keys()].filter(id => st.workouts.some(w => w.id === id && w.hrZones)).length
    have = overlapCount(parsed.bodyweight, st.bodyweight)
      + overlapCount(parsed.measurements.bodyFat, st.measurements.bodyFat)
      + overlapCount(parsed.measurements.muscleMass, st.measurements.muscleMass)
      + overlapCount(parsed.steps, st.steps) + overlapCount(parsed.sleep, st.sleep)
      + overlapCount(parsed.restingHR, st.restingHR) + haveHR
    fresh = Object.values(healthCounts).reduce((a, b) => a + b, 0) - have
  } else if (isBW) {
    have = parsed.bodyweight.filter(b => st.bodyweight.some(x => x.d === b.d)).length
    fresh = parsed.bodyweight.length - have
  } else {
    have = parsed.workouts.filter(w => st.workouts.some(x => x.d === w.d)).length
    fresh = parsed.workouts.length - have
  }

  const doImport = () => {
    let res
    update(s => { res = mergeImport(s, parsed) })
    close()
    toast(isHealth
      ? t('{0} health records imported', res.bodyweight + res.bodyFat + res.muscleMass + res.steps + res.sleep + res.restingHR + res.hrMatched)
      : isBW ? t('{0} weigh-ins imported', res.added) : t('{0} workouts imported', res.added))
  }

  return <>
    <h3>{parsed.source ? t('Import from {0}', parsed.source) : t('Import history')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>
      {parsed.from === parsed.to ? fmtDate(parsed.from, true) : fmtDate(parsed.from, true) + ' – ' + fmtDate(parsed.to, true)}
    </div>

    <div className="tiles" style={{ textAlign: 'left' }}>
      {isHealth ? <>
        {healthCounts.bodyweight > 0 && <div className="tile"><div className="l">{t('Weigh-ins')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{healthCounts.bodyweight}</div></div>}
        {healthCounts.bodyFat > 0 && <div className="tile"><div className="l">{t('Body fat readings')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{healthCounts.bodyFat}</div></div>}
        {healthCounts.muscleMass > 0 && <div className="tile"><div className="l">{t('Muscle mass readings')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{healthCounts.muscleMass}</div></div>}
        {healthCounts.steps > 0 && <div className="tile"><div className="l">{t('Days with steps')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{healthCounts.steps}</div></div>}
        {healthCounts.sleep > 0 && <div className="tile"><div className="l">{t('Nights of sleep')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{healthCounts.sleep}</div></div>}
        {healthCounts.restingHR > 0 && <div className="tile"><div className="l">{t('Resting heart rate readings')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{healthCounts.restingHR}</div></div>}
        {healthCounts.hr > 0 && <div className="tile"><div className="l">{t('Workouts with heart rate')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{healthCounts.hr}</div></div>}
      </> : isBW ? <>
        <div className="tile"><div className="l">{t('Weigh-ins')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{parsed.bodyweight.length}</div></div>
        <div className="tile"><div className="l">{t('New')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{fresh}</div></div>
      </> : <>
        <div className="tile"><div className="l">{t('Workouts')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{parsed.workouts.length}</div></div>
        <div className="tile"><div className="l">{t('Sets')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{parsed.sets}</div></div>
        <div className="tile"><div className="l">{t('Exercises matched')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{parsed.matched}</div></div>
        <div className="tile"><div className="l">{t('Added as your own')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{parsed.created}</div></div>
      </>}
    </div>

    {parsed.mixedUnits ? <div className="small" style={{ color: 'var(--yellow)', marginBottom: 10 }}>
      {t('The file mixes kg and lb — each set is converted to {0}.', st.unit)}
    </div> : parsed.converted ? <div className="small" style={{ color: 'var(--yellow)', marginBottom: 10 }}>
      {t('The file is in {0} and your profile is in {1} — weights will be converted.', parsed.fileUnit, st.unit)}
    </div> : null}
    {!isBW && !isHealth && !parsed.fileUnit && !parsed.mixedUnits && <div className="small dim" style={{ marginBottom: 10 }}>
      {t('The file does not say which unit it uses — numbers are imported as they are.')}
    </div>}
    {isHealth && healthCounts.hr > 0 && !st.birthDate && <div className="small dim" style={{ marginBottom: 10 }}>
      {t('Add your birth date in Settings to also split these into heart-rate zones.')}
    </div>}
    {isHealth && healthCounts.muscleMass > 0 && <div className="small dim" style={{ marginBottom: 10 }}>
      {t('Health has no dedicated muscle-mass reading — this uses its closest one, lean body mass, which also includes bone and water.')}
    </div>}
    {have > 0 && <div className="small dim" style={{ marginBottom: 10 }}>
      {t('{0} days already have data here and will be left alone.', have)}
    </div>}
    {/* The file rated its sets. Say so: the column is off by default, so the ratings would
        otherwise arrive invisibly and look like they had been dropped. */}
    {!isBW && !isHealth && (parsed.rirSets + parsed.rpeSets) > 0 && <div className="small dim" style={{ marginBottom: 10 }}>
      {t(effortOf(st) === 'none'
        ? '{0} sets bring an {1} with them — switch on Effort per set in Settings to see it.'
        : '{0} sets bring an {1} with them.',
      parsed.rirSets || parsed.rpeSets, parsed.rirSets ? 'RIR' : 'RPE')}
    </div>}
    {!isBW && !isHealth && parsed.unmatchedNames.length > 0 && <>
      <h4 className="sec">{t('Not in the library — added as your own exercises')}</h4>
      <div className="mchips" style={{ marginBottom: 12 }}>
        {parsed.unmatchedNames.slice(0, 12).map(n => <span key={n} className="mchip capitalize">{n}</span>)}
        {parsed.unmatchedNames.length > 12 && <span className="mchip">+{parsed.unmatchedNames.length - 12}</span>}
      </div>
    </>}

    <Button variant="primary" onClick={doImport} disabled={!fresh}>
      {fresh ? t('Import') : t('Nothing new to import')}
    </Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

/** Read a CSV/XML export, then show what it would do. */
export function importFromApp(file, onDone) {
  const rd = new FileReader()
  rd.onload = () => {
    let parsed
    // maxHR (220 - age) drives the heart-rate-zone split for any workout a Health export's
    // continuous HR data overlaps — left null (zones simply not computed) if birthDate is unset.
    const age = ageFrom(S().birthDate)
    try { parsed = parseImport(String(rd.result), { unit: S().unit, workouts: S().workouts, maxHR: age ? 220 - age : null }) }
    catch (e) { toast(t('Could not read that file')); return }
    if (parsed.error === 'empty') { toast(t('That file is empty')); return }
    if (parsed.error) { toast(t("That file's columns aren't recognised — see the docs for supported apps.")); return }
    const empty = parsed.kind === 'health'
      ? !parsed.bodyweight.length && !parsed.measurements.bodyFat.length && !parsed.measurements.muscleMass.length
        && !parsed.steps.length && !parsed.sleep.length && !parsed.restingHR.length && !parsed.hrZonesByWorkout.size
      : parsed.kind === 'bodyweight' ? !parsed.bodyweight.length : !parsed.workouts.length
    if (empty) { toast(t('Nothing to import from that file')); return }
    ui().openSheet(close => <ImportSummary parsed={parsed} close={close} />)
    onDone && onDone()
  }
  rd.onerror = () => toast(t('Could not read that file'))
  rd.readAsText(file)
}

/* ============================ target weight ============================ */
export function bwDeltaColor(delta, currentW) {
  if (!delta) return 'var(--label-2)'
  if (!S().targetW) return 'var(--label)'
  const up = S().targetW > currentW
  return (delta > 0) === up ? 'var(--acc)' : 'var(--red)'
}
function GoalSheet({ close }) {
  const st = S()
  const bw = lastBW(st)
  const [v, setV] = useState(st.targetW || (bw ? bw.w : 70))
  return <>
    <h3>{t('Target weight')}</h3>
    <div className="muted small">{t('Your goal is drawn as a line through the weight charts, and gains/losses are colored by whether they move toward it.')}</div>
    <WeightInput value={v} setValue={setV} unit={st.unit} />
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={() => {
      const n = Math.round((v || 0) * 10) / 10
      if (!n || n <= 0) { toast(t('Enter a valid weight')); return }
      update(s => { s.targetW = n }); close()
      const b = lastBW(S()); toast(t('Goal set: {0}', fmtNum(n) + ' ' + st.unit) + (b ? ' (' + t('{0} to go', fmtNum(Math.abs(n - b.w))) + ')' : ''))
    }}>{t('Save goal')}</Button>
    {st.targetW && <><div style={{ height: 8 }} /><Button variant="danger" onClick={() => { update(s => { s.targetW = null }); close(); toast(t('Goal removed')) }}>{t('Remove goal')}</Button></>}
  </>
}
export const goalSheet = () => ui().openSheet(close => <GoalSheet close={close} />)

/* ============================ exercise detail ============================ */
// Estimated 1RM for one exercise (issue #18): what the log already implies, plus a calculator
// for a set you have not done — so the number is reachable before there is any history.
// The 1RM from a deliberate test (Actions → "Start a test session"), not an estimate off
// whatever happened to come up in a logged set — see lib/onerm.js's oneRMTests/bestTestedOneRM,
// and lib/progression.js's 'pct1rm' policy, which reads this same number to prescribe weight.
function TestedOneRM({ ex }) {
  const st = useStore(s => s.S)
  const tests = oneRMTests(st, ex.id)
  if (!tests.length) return null
  const best = bestTestedOneRM(st, ex.id)
  return <>
    <h4 className="sec">{t('Your tested 1RM')}</h4>
    <div className="small" style={{ marginBottom: 8 }}>
      <b className="accent">{fmtNum(best.est1RM)} {st.unit}</b>
      <span className="dim"> · {t('{0} × {1} on {2}', fmtNum(best.w) + ' ' + st.unit, best.r, fmtDate(best.d, true))}</span>
    </div>
    {tests.length > 1 && <div className="small dim" style={{ marginBottom: 10 }}>
      {tests.slice(0, 5).map(x => `${fmtNum(x.est1RM)} ${st.unit} (${fmtDate(x.d, true)})`).join(' · ')}
    </div>}
  </>
}

function OneRM({ ex }) {
  const st = useStore(s => s.S)
  const best = best1RM(st, ex.id)
  const [w, setW] = useState(best ? best.w : (st.exWeights[ex.id] || {}).w || 20)
  const [r, setR] = useState(best ? best.r : 5)
  const est = estimate1RM(w, r)
  return <>
    <h4 className="sec">{t('Estimated 1RM')}</h4>
    {best && <div className="small" style={{ marginBottom: 8 }}>
      {t('From your log:')} <b className="accent">{fmtNum(best.est)} {st.unit}</b>
      <span className="dim"> · {t('{0} × {1} on {2}', fmtNum(best.w) + ' ' + st.unit, best.r, fmtDate(best.d, true))}</span>
    </div>}
    <div className="row cfgrow" style={{ marginBottom: 10 }}>
      <Stepper label={t('Weight ({0})', st.unit)} value={w} step={2.5} onChange={setW} />
      <Stepper label={t('Reps')} value={r} step={1} decimal={false} onChange={setR} />
    </div>
    <div className="row between" style={{ marginBottom: 4 }}>
      <span className="muted small">{t('Estimate')}</span>
      <b className="accent" style={{ fontSize: 20 }}>{est === null ? '—' : fmtNum(est) + ' ' + st.unit}</b>
    </div>
    <div className="small dim">{est === null
      ? t('Enter a weight and 1–{0} reps — beyond that an estimate is guesswork.', REP_CAP)
      : t('Epley formula — a calculation from one set, not a tested max.')}</div>
  </>
}

function ExerciseDetail({ ex, close }) {
  const st = useStore(s => s.S)
  const last = lastEntryFor(st, ex.id)
  const best = bestWeightFor(st, ex.id)
  return <>
    <h3 className="capitalize">{nameFor(ex)}</h3>
    <Media ex={ex} />
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '10px 0' }}>
      <span className="tag acc">{t(ex.bp)}</span>
      {ex.tg && <span className="tag"><Icon name="target" />{t(ex.tg)}</span>}
      <span className="tag"><Icon name="dumbbell" />{t(ex.eq)}</span>
      {(ex.sm || []).slice(0, 3).map((s, i) => <span key={i} className="tag">{t(s)}</span>)}
    </div>
    {ex.desc && <div className="exnote">{ex.desc}</div>}
    <div className="card" style={{ margin: '10px 0' }}>
      <div className="row" style={{ gap: 6, marginBottom: last ? 4 : 0 }}>
        <Icon name="sparkles" className="accent" style={{ fontSize: 15 }} />
        <b className="small">{t('Last session')}</b>
      </div>
      {last
        ? <div className="small">{last.sets.map(s => setLabel(ex.id, s, last.target)).join(', ')} <span className="dim">· {fmtDate(last.d)}</span></div>
        : <div className="muted small">{t('No sessions logged yet.')}</div>}
    </div>
    {best > 0 && <div className="small row" style={{ marginBottom: 6, gap: 5 }}><Icon name="trophy" style={{ fontSize: 14, color: 'var(--yellow)' }} />{t('Best:')} <b className="accent">{fmtNum(best)} {st.unit}</b></div>}
    <Button icon="history" style={{ marginBottom: 4 }} trailingIcon="chevronRight" onClick={() => { close(); nav('/stats?ex=' + ex.id) }}>{t('See full history')}</Button>
    <Button variant="primary" icon="plus" style={{ margin: '10px 0 4px' }} onClick={() => addToRoutineSheet(ex)}>{t('Add to my plan')}</Button>
    {ex.custom && <div className="row" style={{ gap: 8, marginTop: 8 }}>
      <Button icon="pencil" style={{ flex: 1 }} onClick={() => { close(); customExSheet(ex) }}>{t('Edit')}</Button>
      <Button variant="danger" icon="trash" style={{ flex: 1 }} onClick={() => deleteCustomEx(ex, close)}>{t('Delete')}</Button>
    </div>}
    {!isCardio(ex) && <TestedOneRM ex={ex} />}
    {!isCardio(ex) && <OneRM ex={ex} />}
    {instrFor(ex).length > 0 &&<><h4 className="sec">{t('How to')}{!INSTR_LANGS.includes(getLang()) && <span className="dim" style={{ textTransform: 'none', letterSpacing: 0 }}> · {t('instructions in English')}</span>}</h4><ol className="steps-list">{instrFor(ex).map((s, i) => <li key={i}>{s}</li>)}</ol></>}
  </>
}
export const exerciseDetailSheet = ex => ui().openSheet(close => <ExerciseDetail ex={ex} close={close} />)

/* ============================ add to routine ============================ */
function AddToRoutine({ ex, close }) {
  const st = useStore(s => s.S)
  const pick = rid => {
    close()
    const isNew = rid === '_new'
    exConfigSheet(ex, null, cfg => {
      update(s => {
        let r = isNew ? { id: uid(), name: t('New routine'), emoji: DEFAULT_GLYPH, ex: [] } : s.routines.find(x => x.id === rid)
        if (isNew) s.routines.push(r)
        if (r) r.ex.push({ id: ex.id, ...cfg })
      })
      const r = isNew ? S().routines[S().routines.length - 1] : st.routines.find(x => x.id === rid)
      toast(t('“{0}” added to {1}', nameFor(ex), r ? r.name : t('routine')))
      if (isNew && r) nav('/plan/r/' + r.id)
    }, null, isNew ? null : st.routines.find(x => x.id === rid))
  }
  return <>
    <h3 className="capitalize">{t('Add “{0}”', nameFor(ex))}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Pick a routine — sets, reps & weight come next.')}</div>
    <div className="list">
      {st.routines.map(r => <div key={r.id} className="item" onClick={() => pick(r.id)}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
        {r.ex.some(e => e.id === ex.id) && <span className="tag">{t('already in')}</span>}<Icon name="plus" className="chev" />
      </div>)}
      <div className="item" onClick={() => pick('_new')}><span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="sparkles" /></span>
        <div className="grow"><div className="tt">{t('New routine')}</div><div className="ss">{t('Create one and start with this exercise')}</div></div><Icon name="plus" className="chev" /></div>
    </div>
  </>
}
export const addToRoutineSheet = ex => ui().openSheet(close => <AddToRoutine ex={ex} close={close} />)

/* ============================ custom exercises (issue #11) ============================ */
// Name + body part is all it takes — the exercise then behaves like any built-in one
// (planning, logging, PRs, stats), just without an animation.
function CustomExForm({ existing, prefill, onDone, close }) {
  const [n, setN] = useState(existing ? existing.n : (prefill || ''))
  const [bp, setBp] = useState(existing ? existing.bp : '')
  const [desc, setDesc] = useState(existing ? (existing.desc || '') : '')
  const save = () => {
    const name = n.trim()
    if (!name) { toast(t('Give it a name')); return }
    if (!bp) { toast(t('Pick a body part')); return }
    const dup = allExercises(S()).find(e => e.n.toLowerCase() === name.toLowerCase() && e.id !== (existing || {}).id)
    if (dup) { toast(t('“{0}” already exists', dup.n)); return }
    const d = desc.trim().slice(0, 1000)
    let id = existing && existing.id
    if (existing) update(s => { const c = (s.customEx || []).find(x => x.id === id); if (c) { c.n = name; c.bp = bp; c.desc = d } })
    else {
      id = 'c' + uid()
      update(s => { (s.customEx = s.customEx || []).push({ id, n: name, bp, desc: d, tg: '', eq: 'custom', custom: true }) })
    }
    close()
    toast(existing ? t('Saved') : t('“{0}” created', name))
    onDone && onDone(EXIDX[id])
  }
  return <>
    <h3>{existing ? t('Edit custom exercise') : t('Create your own exercise')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Name it and pick a body part — it behaves like any other exercise, just without an animation.')}</div>
    <input className="input" placeholder={t('Exercise name')} value={n} onChange={e => setN(e.target.value)} />
    <div className="chips" style={{ margin: '12px 0' }}>
      {BODYPARTS.map(b => <button key={b} className={'chip' + (bp === b ? ' on' : '')} onClick={() => setBp(b)}>{t(b)}</button>)}
    </div>
    {bp === 'cardio' && <div className="small dim row" style={{ marginBottom: 10, gap: 5 }}><Icon name="figureRun" style={{ fontSize: 13 }} />{t('Cardio exercises log time + speed instead of weight × reps.')}</div>}
    <textarea className="input" rows={4} maxLength={1000} placeholder={t('Description (optional) — setup, cues, anything you want to remember')}
      value={desc} onChange={e => setDesc(e.target.value)} />
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{existing ? t('Save') : t('Create exercise')}</Button>
    {existing && <><div style={{ height: 8 }} /><Button variant="danger" icon="trash" onClick={() => { close(); deleteCustomEx(existing) }}>{t('Delete exercise')}</Button></>}
  </>
}
export const customExSheet = (existing, onDone, prefill) => ui().openSheet(close => <CustomExForm existing={existing} prefill={prefill} onDone={onDone} close={close} />)

export function deleteCustomEx(ex, afterDelete) {
  if (S().active?.entries.some(e => e.id === ex.id)) { toast(t('Finish your current workout first')); return }
  confirmSheet({
    title: t('Delete “{0}”?', ex.n),
    message: t('It will be removed from your routines. Already-logged workouts keep their sets.'),
    confirmText: t('Delete'), danger: true,
    onConfirm: () => {
      update(s => {
        s.customEx = (s.customEx || []).filter(x => x.id !== ex.id)
        s.routines.forEach(r => { r.ex = r.ex.filter(e => e.id !== ex.id); cleanupSg(r.ex) })
        // stamp the name into history entries so past workouts stay readable
        s.workouts.forEach(w => w.entries.forEach(e => { if (e.id === ex.id) e.n = ex.n }))
        delete s.exWeights[ex.id]
      })
      toast(t('Exercise deleted'))
      afterDelete && afterDelete()
    }
  })
}

/* ============================ exercise picker ============================ */
// Exercises already used in your routines or past workouts (for the "Chosen" filter + a marker).
function usageMap(st) {
  const u = {}
  st.routines.forEach(r => r.ex.forEach(e => { u[e.id] = (u[e.id] || 0) + 1 }))
  st.workouts.forEach(w => w.entries.forEach(e => { u[e.id] = (u[e.id] || 0) + 1 }))
  return u
}
// Exported (not just the sheet-opener below) so the desktop trainer panel can render it inline
// as a persistent side panel instead of a modal sheet — same search/filter logic either way.
export function ExercisePicker({ onPick, close }) {
  const st = useStore(s => s.S)
  const usage = usageMap(st)
  const [q, setQ] = useState('')
  const [bp, setBp] = useState('')          // '' = all, '★' = chosen, else a body part
  const [eq, setEq] = useState('')          // '' = any equipment
  const [shown, setShown] = useState(50)
  const ql = q.toLowerCase().trim()
  const all = allExercises(st)
  let base = all.filter(e =>
    (bp === '★' ? usage[e.id] : (!bp || e.bp === bp)) &&
    (!ql || e.n.toLowerCase().includes(ql) || nameFor(e).toLowerCase().includes(ql) || e.tg.includes(ql) || e.eq.includes(ql) || (e.desc || '').toLowerCase().includes(ql)))
  if (bp === '★') base = [...base].sort((a, b) => (usage[b.id] - usage[a.id]) || (nameFor(a) < nameFor(b) ? -1 : 1))
  const eqOpts = equipmentOf(base)
  // Drop the equipment filter if the search narrowed it away, so you never hit a dead end.
  const eqOn = eqOpts.includes(eq) ? eq : ''
  const f = eqOn ? base.filter(e => e.eq === eqOn) : base
  const chosenCount = Object.keys(usage).length
  return <>
    <h3>{t('Add exercise')}</h3>
    <div className="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <input className="input" placeholder={t('Search {0} exercises…', all.length)} value={q} onChange={e => { setQ(e.target.value); setShown(50) }} /></div>
    <div className="chips" style={{ margin: eqOpts.length > 1 ? '10px 0 6px' : '10px 0' }}>
      {chosenCount > 0 && <button className={'chip' + (bp === '★' ? ' on' : '')} onClick={() => { setBp('★'); setEq(''); setShown(50) }}><Icon name="starFill" style={{ fontSize: 12, display: 'inline-block', marginRight: 4, verticalAlign: '-1px' }} />{t('Chosen')} ({chosenCount})</button>}
      <button className={'chip nocap' + (!bp ? ' on' : '')} onClick={() => { setBp(''); setEq(''); setShown(50) }}>{t('All')}</button>
      <ChipSelect value={bp} onChange={b => { setBp(b); setEq(''); setShown(50) }} sheetTitle={t('Body part')} placeholder={t('Body part')}
        options={BODYPARTS.map(b => ({ value: b, label: t(b) }))} />
    </div>
    {eqOpts.length > 1 && <div className="chips" style={{ marginBottom: 10 }}>
      <ChipSelect value={eqOn} onChange={v => { setEq(v); setShown(50) }} sheetTitle={t('Equipment')} placeholder={t('Any equipment')}
        options={[{ value: '', label: t('Any equipment') }, ...eqOpts.map(x => ({ value: x, label: t(x) }))]} />
    </div>}
    <div className="list">
      {bp !== '★' && <div className="item" onClick={() => { close(); customExSheet(null, ex => onPick(ex), q.trim()) }}>
        <div className="thumb thumb-x"><Icon name="sparkles" /></div>
        <div className="grow"><div className="tt">{t('Create your own exercise')}</div><div className="ss">{t('name + body part, no animation')}</div></div><Icon name="plus" className="chev" />
      </div>}
      {f.slice(0, shown).map(e => <div key={e.id} className="item" onClick={() => { close(); onPick(e) }}>
        <Thumb ex={e} /><div className="grow"><div className="tt capitalize">{nameFor(e)}</div><div className="ss capitalize">{t(e.tg || e.bp)} · {t(e.eq)}</div></div>
        {usage[e.id] && <span className="tag acc"><Icon name="starFill" /></span>}<Icon name="plus" className="chev" />
      </div>)}
      {f.length === 0 && bp === '★' && <div className="empty">{t('Nothing chosen yet — add exercises and they’ll show up here.')}</div>}
    </div>
    {f.length > shown && <><div style={{ height: 8 }} /><Button onClick={() => setShown(s => s + 50)}>{t('Show more')}</Button></>}
  </>
}
export const exercisePicker = onPick => ui().openSheet(close => <ExercisePicker onPick={onPick} close={close} />)

/* ============================ exercise browser (by muscle, photo grid) ============================ */
// Plan > Exercises opens this as its own sheet per muscle (or unfiltered) instead of filtering
// a list in place — closer to a real "different window" you can dismiss, and it puts the same
// photo strip at the top so switching muscle mid-browse never means going back first.
const CARDIO = 'cardio'
const GROUP_BY_KEY = Object.fromEntries(MUSCLE_GROUPS.map(g => [g.key, g]))
function MuscleStrip({ value, onChange, body }) {
  return <div className="mstrip">
    <button className={'mstrip-i' + (value === null ? ' on' : '')} onClick={() => onChange(null)}>
      <span className="mstrip-photo mstrip-photo-plain"><Icon name="exercises" /></span>
      <span className="mstrip-name">{t('All')}</span>
    </button>
    {MUSCLE_GROUPS.map(g => <button key={g.key} className={'mstrip-i' + (value === g.key ? ' on' : '')} onClick={() => onChange(g.key)}>
      <span className="mstrip-photo" style={{ backgroundImage: `url(${musclePhotoUrl(g.photo, body)})` }} />
      <span className="mstrip-name">{t(g.name)}</span>
    </button>)}
    <button className={'mstrip-i' + (value === CARDIO ? ' on' : '')} onClick={() => onChange(CARDIO)}>
      <span className="mstrip-photo" style={{ backgroundImage: `url(${musclePhotoUrl(CARDIO, body)})` }} />
      <span className="mstrip-name">{t('Cardio')}</span>
    </button>
  </div>
}
function ExerciseBrowser({ initial }) {
  const st = useStore(s => s.S)
  const [muscle, setMuscle] = useState(initial)
  const [q, setQ] = useState('')
  const [eq, setEq] = useState('')
  const [shown, setShown] = useState(40)
  const ql = q.toLowerCase().trim()
  // Primary target only (weight 1), not "any secondary mention" (weight .4) — a basic
  // crunch lists hip flexors and lower back as stabilizers, which would otherwise put it
  // under both Glutes and Back. BodyMap wants that nuance (it shades by how hard a
  // muscle worked); browsing by muscle wants "is this actually a glute exercise".
  const byMuscle = e => {
    if (!muscle) return true
    if (muscle === CARDIO) return e.bp === CARDIO
    const m = musclesOf(e)
    return GROUP_BY_KEY[muscle].slugs.some(s => (m[s] || 0) >= 1)
  }
  const base = allExercises(st).filter(e => byMuscle(e) && (!ql || e.n.toLowerCase().includes(ql) || nameFor(e).toLowerCase().includes(ql) || e.tg.includes(ql) || e.eq.includes(ql) || (e.desc || '').toLowerCase().includes(ql)))
  const eqOpts = equipmentOf(base)
  // Drop the equipment filter if switching muscle (or searching) narrowed it away.
  const eqOn = eqOpts.includes(eq) ? eq : ''
  const f = eqOn ? base.filter(e => e.eq === eqOn) : base
  const title = muscle === null ? t('All exercises') : muscle === CARDIO ? t('Cardio') : t(GROUP_BY_KEY[muscle].name)

  return <>
    <h3>{title}</h3>
    <MuscleStrip value={muscle} body={st.body} onChange={m => { setMuscle(m); setEq(''); setShown(40) }} />
    <div className="search" style={{ margin: '2px 0 10px' }}><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <input className="input" placeholder={t('Search {0} exercises…', allExercises(st).length)} value={q} onChange={e => { setQ(e.target.value); setShown(40) }} /></div>
    {eqOpts.length > 1 && <div className="chips" style={{ marginBottom: 12 }}>
      <ChipSelect value={eqOn} onChange={v => { setEq(v); setShown(40) }} sheetTitle={t('Equipment')} placeholder={t('Any equipment')}
        options={[{ value: '', label: t('Any equipment') }, ...eqOpts.map(x => ({ value: x, label: t(x) }))]} />
    </div>}
    <div className="exgrid">
      <div className="excard" onClick={() => customExSheet(null, ex => exerciseDetailSheet(ex), q.trim())}>
        <div className="excard-media excard-media-x"><Icon name="sparkles" /></div>
        <div className="excard-b"><div className="excard-t">{t('Create your own exercise')}</div></div>
      </div>
      {f.slice(0, shown).map(e => {
        const best = bestWeightFor(st, e.id)
        return <div key={e.id} className="excard" onClick={() => exerciseDetailSheet(e)}>
          <div className="excard-media">
            <Thumb ex={e} />
            <button className="excard-plan" aria-label={t('Plan')} onClick={ev => { ev.stopPropagation(); addToRoutineSheet(e) }}><Icon name="plus" /></button>
            {best > 0 && <span className="excard-best">{fmtNum(best)}</span>}
          </div>
          <div className="excard-b"><div className="excard-t capitalize">{nameFor(e)}</div><div className="excard-s capitalize">{t(e.tg || e.bp)}</div></div>
        </div>
      })}
    </div>
    {f.length === 0 && <div className="empty"><div className="ico"><Icon name="magnifier" /></div>{t('No match')}</div>}
    {f.length > shown && <><div style={{ height: 10 }} /><Button onClick={() => setShown(s => s + 40)}>{t('Show more')}</Button></>}
  </>
}
export const exerciseBrowserSheet = muscle => ui().openSheet(close => <ExerciseBrowser initial={muscle} />)

/* ============================ exercise config ============================ */
// Progression settings for one exercise (issue #17). Shown inside the config sheet because
// "how does this lift go up" belongs next to sets and reps, not in a separate screen. Left
// on "follow the routine" it inherits, so most people never touch it.
function ProgressionFields({ ex, mode, c, setC, routine, unit }) {
  const options = POLICIES_FOR[mode] || ['off']
  if (options.length < 2) return null
  const inherited = policyFor({ id: ex.id }, routine, mode)
  const active = policyFor({ ...c, id: ex.id }, routine, mode)
  const inc = c.inc > 0 ? c.inc : (mode === 'time' ? 5 : defaultIncrement(ex.id, unit))
  return <>
    <h4 className="sec">{t('Progression')}</h4>
    <div className="sect-b" style={{ marginBottom: 8 }}>
      <SelectRow title={t('Rule')} sheetTitle={t('Progression')} value={c.prog || ''} onChange={v => setC(x => ({ ...x, prog: v || undefined }))}
        options={[{ value: '', label: t('Follow the routine ({0})', t(POLICY_NAME[inherited])) },
          ...options.map(p => ({ value: p, label: t(POLICY_NAME[p]) }))]} />
    </div>
    <div className="small dim" style={{ marginBottom: active === 'off' ? 18 : 10 }}>{t(POLICY_DESC[active])}</div>
    {active !== 'off' && <div className="row cfgrow" style={{ marginBottom: 18 }}>
      <Stepper label={mode === 'time' ? t('Step (seconds)') : t('Step ({0})', unit)} value={inc}
        step={mode === 'time' ? 5 : 1.25} decimal={mode !== 'time'} onChange={v => setC(x => ({ ...x, inc: v }))} />
      {active === 'double' && <Stepper label={t('Reps from')} value={c.repsMin || Math.max(1, (c.reps || 10) - 2)}
        step={1} decimal={false} onChange={v => setC(x => ({ ...x, repsMin: v }))} />}
      {active === 'pct1rm' && <Stepper label={t('Target RIR')} value={c.targetRIR != null ? c.targetRIR : 2}
        step={0.5} onChange={v => setC(x => ({ ...x, targetRIR: v }))} />}
    </div>}
  </>
}

function ExConfig({ ex, existing, onSave, onDelete, close, routine }) {
  const st = useStore(s => s.S)
  const cardio = isCardio(ex.id)
  const [c, setC] = useState(existing || defaultConfig(ex.id))
  // Cardio keeps its own duration+speed form; the reps/time choice (issue #16) is offered for
  // everything else, which is where the gap was — planks, hangs, wall sits, loaded carries.
  const mode = cardio ? 'cardio' : modeOf({ ...c, id: ex.id })
  // Keep whatever the other mode already had (sets, weight) and fill only what is missing.
  const setMode = m => setC(x => ({ ...defaultConfig(ex.id, m), ...x, mode: m }))
  const save = () => {
    close()
    const sets = Math.max(1, Math.round(c.sets) || (cardio ? 1 : 3))
    // Only carry progression settings that differ from the inherited default, so a plan file
    // stays readable and "follow the routine" keeps meaning exactly that.
    const prog = {}
    if (c.prog) prog.prog = c.prog
    if (c.inc > 0) prog.inc = c.inc
    if (cardio) onSave({ sets, min: Math.max(1, Math.round(c.min) || 20), speed: Math.max(0, c.speed || 8) })
    else if (mode === 'time') onSave({ sets, mode: 'time', sec: Math.max(1, Math.round(c.sec) || 45), weight: Math.max(0, c.weight || 0), ...prog })
    else {
      const reps = Math.max(1, Math.round(c.reps) || 10)
      const out = { sets, mode: 'reps', reps, weight: Math.max(0, c.weight || 0), ...prog }
      if (policyFor({ ...c, id: ex.id }, routine, 'reps') === 'double') out.repsMin = Math.min(reps, Math.max(1, Math.round(c.repsMin) || Math.max(1, reps - 2)))
      onSave(out)
    }
  }
  return <>
    <h3 className="capitalize">{nameFor(ex)}</h3>
    <Media ex={ex} />
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '10px 0 14px' }}>
      {cardio && <span className="tag acc"><Icon name="figureRun" />{t('Cardio')}</span>}
      <span className="tag">{t(ex.tg || ex.bp)}</span><span className="tag">{t(ex.eq)}</span>
    </div>
    {ex.desc && <div className="exnote">{ex.desc}</div>}
    {!cardio && <div style={{ marginBottom: 14 }}>
      <Segmented className="seg-range" value={mode} onChange={setMode}
        options={[{ value: 'reps', label: t('Reps') }, { value: 'time', label: t('Time') }]} />
    </div>}
    <div className="row cfgrow" style={{ marginBottom: mode === 'time' ? 8 : 18 }}>
      {cardio ? <>
        <Stepper label={t('Intervals')} value={c.sets} step={1} decimal={false} onChange={v => setC(x => ({ ...x, sets: v }))} />
        <Stepper label={t('Minutes')} value={c.min} step={1} decimal={false} onChange={v => setC(x => ({ ...x, min: v }))} />
        <Stepper label={t('Speed (km/h)')} value={c.speed} step={0.5} onChange={v => setC(x => ({ ...x, speed: v }))} />
      </> : mode === 'time' ? <>
        <Stepper label={t('Sets')} value={c.sets} step={1} decimal={false} onChange={v => setC(x => ({ ...x, sets: v }))} />
        <Stepper label={t('Seconds')} value={c.sec} step={5} decimal={false} onChange={v => setC(x => ({ ...x, sec: v }))} />
        <Stepper label={t('Weight ({0})', st.unit)} value={c.weight} step={2.5} onChange={v => setC(x => ({ ...x, weight: v }))} />
      </> : <>
        <Stepper label={t('Sets')} value={c.sets} step={1} decimal={false} onChange={v => setC(x => ({ ...x, sets: v }))} />
        <Stepper label={t('Reps')} value={c.reps} step={1} decimal={false} onChange={v => setC(x => ({ ...x, reps: v }))} />
        <Stepper label={t('Weight ({0})', st.unit)} value={c.weight} step={2.5} onChange={v => setC(x => ({ ...x, weight: v }))} />
      </>}
    </div>
    {mode === 'time' && <div className="small dim" style={{ marginBottom: 18 }}>
      {t('A timer runs while you hold the set. Leave the weight at 0 for bodyweight holds.')}
    </div>}
    <ProgressionFields ex={ex} mode={mode} c={c} setC={setC} routine={routine} unit={st.unit} />
    <Button variant="primary" onClick={save}>{existing ? t('Save') : t('Add to routine')}</Button>
    {ex.custom && <><div style={{ height: 8 }} /><Button icon="pencil" onClick={() => { close(); customExSheet(ex) }}>{t('Edit or delete this exercise')}</Button></>}
    {onDelete && <><div style={{ height: 8 }} /><Button variant="danger" onClick={() => { close(); onDelete() }}>{t('Remove from routine')}</Button></>}
  </>
}
export const exConfigSheet = (ex, existing, onSave, onDelete, routine) => ui().openSheet(close => <ExConfig ex={ex} existing={existing} onSave={onSave} onDelete={onDelete} routine={routine} close={close} />)

/* ============================ glyph picker ============================ */
// Grouped by what the glyph means for a training day, so picking one is a scan
// of four short rows rather than a hunt through twenty loose icons.
// A routine/program can carry a real cover photo instead of a glyph (opts: { image, onImage } —
// current stored filename or null, and a callback for a new filename or null on removal). Only
// offered when the caller passes onImage — this sheet is reused elsewhere for glyph-only picks.
function GlyphPickerSheet({ cur, onPick, image, onImage }) {
  const toast = useUI(s => s.toast)
  const inputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const onFile = e => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    resizeImageFile(file).then(uploadImage).then(id => { setBusy(false); onImage(id) })
      .catch(err => { setBusy(false); toast(err.message) })
  }
  return <>
    <h3>{t('Pick an icon')}</h3>
    {onImage && <>
      <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onFile} />
      {image && <img src={mediaUrl(image)} alt="" style={{ width: '100%', height: 130, objectFit: 'cover', borderRadius: 12, marginBottom: 10 }} />}
      <div className="row" style={{ gap: 8, marginBottom: 16 }}>
        <Button icon="upload" disabled={busy} onClick={() => inputRef.current?.click()} style={{ flex: 1 }}>
          {image ? t('Change photo') : t('Use a photo instead')}</Button>
        {image && <Button variant="danger" disabled={busy} onClick={() => onImage(null)}>{t('Remove')}</Button>}
      </div>
    </>}
    {GLYPH_GROUPS.map(g => (
      <div key={g.key} style={{ marginBottom: 14 }}>
        <div className="sect-t" style={{ padding: '0 2px 7px' }}>{t(g.key)}</div>
        <div className="glyph-grid">
          {g.items.map(n => (
            <button key={n} className={'glyph-cell' + (n === cur ? ' on' : '')}
              onClick={() => onPick(n)} aria-label={n}>
              <Icon name={n} />
            </button>
          ))}
        </div>
      </div>
    ))}
    <div style={{ height: 4 }} />
  </>
}
export const glyphPicker = (current, onPick, opts = {}) => {
  const cur = glyphOf(current)
  const { image, onImage } = opts
  return ui().openSheet(close => <GlyphPickerSheet cur={cur} onPick={g => { close(); onPick(g) }}
    image={image} onImage={onImage ? (id => { close(); onImage(id) }) : null} />)
}

/* ============================ routine picker (for a program) ============================ */
// A short list, not a search — this only ever offers routines not already in some program, so
// it's picking a specific existing thing, not browsing.
export const routinePickerSheet = (routines, onPick) => ui().openSheet(close => <>
  <h3>{t('Add a routine')}</h3>
  <div className="list">
    {routines.map(r => <div key={r.id} className="item" onClick={() => { close(); onPick(r.id) }}>
      <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
      <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
    </div>)}
  </div>
</>)

/* ============================ share / print / import a plan ============================ */

export const planToolsSheet = () => ui().openSheet(close => <PlanTools close={close} />)

function PlanTools({ close }) {
  const st = useStore(s => s.S)
  const user = useStore(s => s.user)
  const fileRef = useRef(null)
  const hasRoutines = (st.routines || []).some(r => r.ex && r.ex.length)

  const pickFile = ev => {
    const f = ev.target.files[0]; ev.target.value = ''; if (!f) return
    const rd = new FileReader()
    rd.onload = () => {
      try { const bundle = parsePlan(rd.result); close(); planImportSheet(bundle) }
      catch (e) { toast(t('Import failed: {0}', e.message)) }
    }
    rd.readAsText(f)
  }

  return <>
    <h3>{t('Share your plan')}</h3>
    <div className="muted small" style={{ marginBottom: 16 }}>{t('Put your week on paper, or bring in a plan from a friend.')}</div>
    {/* Printing a single routine/program lives on the item itself now (its own "Imprimir"
        button) — with dozens of routines, one "export everything" button here wasn't useful. */}
    {!MOBILE && <>
      <Button variant="primary" icon="download" onClick={() => { close(); printPlan(st, user?.name || '') }} disabled={!hasRoutines}>{t('Print / Save as PDF')}</Button>
      <div className="dim small" style={{ margin: '7px 2px 0', lineHeight: 1.4 }}>{t('A clean one-page-per-plan printout — no exercise ever splits across a page.')}</div>
      {!hasRoutines && <div className="dim small" style={{ margin: '12px 2px 0' }}>{t('Add an exercise to a routine first — an empty plan has nothing to print.')}</div>}
      <div style={{ height: 12 }} />
    </>}
    <h4 className="sec">{t('Got a plan from a friend?')}</h4>
    <Button variant="ghost" icon="folder" onClick={() => fileRef.current?.click()}>{t('Import a plan file')}</Button>
    <input ref={fileRef} type="file" accept="application/json,.json" onChange={pickFile} hidden />
  </>
}

export const planImportSheet = bundle => ui().openSheet(close => <PlanImport bundle={bundle} close={close} />)

function PlanImport({ bundle, close }) {
  const [schedule, setSchedule] = useState(false)
  const apply = () => {
    update(s => mergePlan(s, bundle, { schedule }))
    close()
    toast(t('Added {0} routines to your plan', bundle.routineCount))
    nav('/plan')
  }
  return <>
    <h3>{bundle.name ? t('Import “{0}”', bundle.name) : t('Import this plan')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>
      {t(bundle.routineCount === 1 ? '{0} routine' : '{0} routines', bundle.routineCount)}
      {' · ' + exCount(bundle.exerciseCount)}
      {bundle.scheduledDays > 0
        ? ' · ' + t(bundle.scheduledDays === 1 ? 'scheduled on {0} day' : 'scheduled on {0} days', bundle.scheduledDays)
        : ''}
    </div>
    <div className="dim small" style={{ marginBottom: 14, lineHeight: 1.4 }}>{t('These are added as new routines — nothing you already have is changed.')}</div>
    {bundle.dropped > 0 && <div className="small" style={{ color: 'var(--yellow)', marginBottom: 14, lineHeight: 1.4 }}>
      {t(bundle.dropped === 1
        ? '{0} exercise in the file isn’t in your library and was left out.'
        : '{0} exercises in the file aren’t in your library and were left out.', bundle.dropped)}
    </div>}
    {bundle.scheduledDays > 0 && <div className="row between" style={{ padding: '10px 2px', borderTop: '1px solid var(--sep)', borderBottom: '1px solid var(--sep)', marginBottom: 16, gap: 12 }}>
      <div><div className="tt" style={{ fontSize: 15 }}>{t('Use this weekly schedule')}</div><div className="small dim">{t('Replaces your current Mon–Sun assignments.')}</div></div>
      <Switch checked={schedule} onChange={setSchedule} />
    </div>}
    <Button variant="primary" onClick={apply}>{t('Add to my plan')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

/* ============================ day override / assign ============================ */
function DayOverride({ iso, close }) {
  const st = useStore(s => s.S)
  const wd = new Date(iso + 'T12:00:00').getDay()
  const weeklyR = st.routines.find(r => r.id === activeWeek(st)[wd])
  const hasOvr = st.dayPlan[iso] !== undefined
  const effId = effectiveRoutineId(st, iso)
  const set = v => {
    update(s => { if (!v) delete s.dayPlan[iso]; else s.dayPlan[iso] = v })
    close()
    toast(v === '' ? t('Back to weekly plan') : v === 'rest' ? t('{0} set to rest', fmtDate(iso)) : t('{0} planned for {1}', (st.routines.find(r => r.id === v) || {}).name, fmtDate(iso)))
  }
  return <>
    <h3>{fmtDate(iso, true)}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Weekly plan:')} {weeklyR ? weeklyR.name : t('Rest')}{hasOvr && <span style={{ color: 'var(--orange)' }}> · {t('changed for this day')}</span>}<br />{t('Sick, missed a day or want a different session? Pick what to train instead.')}</div>
    <div className="list">
      {st.routines.map(r => <div key={r.id} className="item" onClick={() => set(r.id)}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
        {effId === r.id && <Icon name="check" className="accent" />}</div>)}
      <div className="item" onClick={() => set('rest')}><span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="moon" /></span><div className="grow"><div className="tt">{t('Rest / skip this day')}</div></div>{effId === null && <Icon name="check" className="accent" />}</div>
      {hasOvr && <div className="item" onClick={() => set('')}><span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="reset" /></span><div className="grow"><div className="tt">{t('Back to weekly plan')}</div></div></div>}
    </div>
  </>
}
export const dayOverrideSheet = iso => ui().openSheet(close => <DayOverride iso={iso} close={close} />)

// Assigns one weekday within one program's own schedule (program.week) — the only routines
// offered are that program's own, since this is building that program's split, not the flat
// week (see lib/history.js's activeWeek for how a program's week ends up driving Home).
function DayAssign({ day, programId, close }) {
  const st = useStore(s => s.S)
  const program = (st.programs || []).find(p => p.id === programId)
  const routines = (program?.routineIds || []).map(rid => st.routines.find(r => r.id === rid)).filter(Boolean)
  const current = (program?.week || {})[day]
  const set = v => {
    update(s => {
      const p = (s.programs || []).find(x => x.id === programId)
      if (!p) return
      p.week = p.week || {}
      if (v) p.week[day] = v; else delete p.week[day]
    })
    close()
  }
  return <>
    <h3>{t(DAYN[day])}</h3>
    <div className="list">
      <div className="item" onClick={() => set('')}><span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="moon" /></span><div className="grow"><div className="tt">{t('Rest day')}</div></div>{!current && <Icon name="check" className="accent" />}</div>
      {routines.map(r => <div key={r.id} className="item" onClick={() => set(r.id)}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
        {current === r.id && <Icon name="check" className="accent" />}</div>)}
    </div>
  </>
}
export const dayAssignSheet = (day, programId) => ui().openSheet(close => <DayAssign day={day} programId={programId} close={close} />)

/* ============================ workout detail ============================ */
// Zone 1 (easiest) through zone 5 (hardest) — same blue-through-red ramp used for effort
// elsewhere in the app, just five stops instead of three.
const HR_ZONE_COLOR = ['var(--blue)', 'var(--teal)', 'var(--green)', 'var(--orange)', 'var(--red)']

// Only rendered when an Apple Health import actually matched this session's start/end window
// against continuous heart-rate samples — see lib/import-csv.js's parseAppleHealth. Wrist HR
// during a lift is noisier than during steady cardio (motion artifacts), so this reads as a
// reasonable estimate of where the effort went, not a lab measurement.
function HRZoneBar({ hrZones }) {
  const { z, avg, max } = hrZones
  const total = z ? z.reduce((a, b) => a + b, 0) : 0
  return <div style={{ marginBottom: 14 }}>
    <div className="row between" style={{ marginBottom: 6 }}>
      <span className="dim small">{t('Heart rate')}</span>
      <span className="dim small">{t('avg')} {avg} · {t('max')} {max} bpm</span>
    </div>
    {z && total > 0 ? <>
      <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: 'var(--surface-2)' }}>
        {z.map((min, i) => min > 0 && <div key={i} style={{ width: (min / total * 100) + '%', background: HR_ZONE_COLOR[i] }} />)}
      </div>
      <div className="row" style={{ gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
        {z.map((min, i) => min > 0 && <span key={i} className="dim small">
          <i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: HR_ZONE_COLOR[i], marginRight: 4 }} />
          {t('Z{0}', i + 1)} {t('{0} min', min)}
        </span>)}
      </div>
    </> : <div className="dim small">{t('Add your birth date in Settings to split this into heart-rate zones.')}</div>}
  </div>
}

function WorkoutDetail({ w, close }) {
  const st = useStore(s => s.S)
  return <>
    <h3>{w.name}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{[fmtDate(w.d, true), ...durPart(w.end - w.start), fmtVol(w.vol, st.unit), ...(w.bw ? [fmtNum(w.bw) + ' ' + st.unit] : [])].join(' · ')}</div>
    {w.hrZones && <HRZoneBar hrZones={w.hrZones} />}
    {w.entries.map((e, i) => {
      const ex = EXIDX[e.id]
      return <div key={i} className="row" style={{ marginBottom: 12, alignItems: 'flex-start' }}>
        {ex && <Thumb ex={ex} />}
        <div className="grow"><div className="tt capitalize" style={{ fontWeight: 600 }}>{ex ? nameFor(ex) : (e.n || e.id)} {w.prs && w.prs.includes(e.id) && <span className="pr"><Icon name="trophy" />PR</span>}</div>
          <div className="ss">{e.sets.filter(s => s.done).map(s => setLabel(e.id, s, e.target)).join('  ·  ') || t('no sets')}</div></div>
      </div>
    })}
    <Button variant="danger" onClick={() => confirmSheet({ title: t('Delete workout?'), message: t('This removes it from your history for good.'), confirmText: t('Delete'), danger: true, onConfirm: () => { update(s => { s.workouts = s.workouts.filter(x => x.id !== w.id) }); close(); toast(t('Workout deleted')) } })}>{t('Delete workout')}</Button>
  </>
}
export const workoutDetailSheet = w => ui().openSheet(close => <WorkoutDetail w={w} close={close} />)

/* ============================ calendar ============================ */
function Calendar({ start, close }) {
  const st = useStore(s => s.S)
  const [cur, setCur] = useState(() => { const d = start ? new Date(start) : new Date(); d.setDate(1); return d })
  const y = cur.getFullYear(), mo = cur.getMonth()
  const byDay = {}
  st.workouts.forEach(w => (byDay[w.d] = byDay[w.d] || []).push(w))
  const startOffset = (new Date(y, mo, 1).getDay() + 6) % 7
  const daysIn = new Date(y, mo + 1, 0).getDate()
  const monthWs = st.workouts.filter(w => w.d.startsWith(y + '-' + String(mo + 1).padStart(2, '0')))
  const monthVol = monthWs.reduce((a, w) => a + (w.vol || 0), 0)
  const monthMs = monthWs.reduce((a, w) => a + Math.max(0, (w.end || w.start) - w.start), 0)
  const cells = []
  for (let i = 0; i < startOffset; i++) cells.push(<div key={'e' + i} />)
  for (let d = 1; d <= daysIn; d++) {
    const iso = y + '-' + String(mo + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0')
    const ws = byDay[iso], effId = effectiveRoutineId(st, iso), ovr = st.dayPlan[iso] !== undefined
    const dotCls = ws ? 'done' : ovr && effId ? 'ovr' : effId ? 'plan' : ''
    cells.push(<button key={d} className={'cal-d' + (ws ? ' has' : '') + (iso === todayISO() ? ' today' : '')} onClick={() => {
      if (!ws) { close(); dayOverrideSheet(iso); return }
      if (ws.length === 1) { close(); workoutDetailSheet(ws[0]); return }
      close(); ui().openSheet(c2 => <><h3>{fmtDate(iso, true)}</h3><div className="list">{ws.map(w => <WorkoutRow key={w.id} w={w} onClick={() => { c2(); workoutDetailSheet(w) }} />)}</div></>)
    }}><span>{d}</span><i className={dotCls} /></button>)
  }
  return <>
    <div className="row between" style={{ marginBottom: 2 }}>
      <button className="iconbtn" onClick={() => setCur(new Date(y, mo - 1, 1))} aria-label={t('Previous month')}><Icon name="chevronLeft" /></button>
      <h3 style={{ margin: 0 }}>{t(MONTHS_LONG[mo])} {y}</h3>
      <button className="iconbtn" onClick={() => setCur(new Date(y, mo + 1, 1))} aria-label={t('Next month')}><Icon name="chevronRight" /></button>
    </div>
    <div className="small muted" style={{ textAlign: 'center' }}>{monthWs.length ? `${t(monthWs.length === 1 ? '{0} workout' : '{0} workouts', monthWs.length)} · ${fmtDur(monthMs)} · ${fmtVol(monthVol, st.unit)}` : t('No workouts this month')}</div>
    <div className="cal-grid">{['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(l => <div key={l} className="cal-h">{t(l)}</div>)}{cells}</div>
    <div className="cal-legend">
      <span><i style={{ background: 'var(--acc)' }} />{t('Trained')}</span>
      <span><i style={{ background: 'var(--label-3)' }} />{t('Planned')}</span>
      <span><i style={{ background: 'var(--orange)' }} />{t('Rescheduled')}</span>
    </div>
    <div className="small dim" style={{ textAlign: 'center', marginTop: 10 }}>{t('Tap a trained day for details · tap any other day to plan a session')}</div>
  </>
}
export const calendarSheet = start => ui().openSheet(close => <Calendar start={start} close={close} />)

/* shared small workout row (used in lists) */
export function WorkoutRow({ w, onClick }) {
  const st = useStore(s => s.S)
  const glyph = glyphOf((st.routines.find(r => r.id === w.routineId) || {}).emoji)
  return <div className="item" onClick={onClick}>
    <span className="lrow-i" style={{ width: 34, height: 34, borderRadius: 8, fontSize: 19 }}><Icon name={glyph} /></span>
    <div className="grow"><div className="tt">{w.name}</div>
      <div className="ss">{[fmtDate(w.d, true), ...durPart(w.end - w.start), t('{0} sets', setsDone(w)), fmtVol(w.vol, st.unit)].join(' · ')}</div></div>
    {w.prs && w.prs.length > 0 && <span className="pr"><Icon name="trophy" />{w.prs.length} PR</span>}
    <Icon name="chevronRight" className="chev" />
  </div>
}

/* ============================ actions sheet (Train tab entry point) ============================ */
// What tapping "Train" opens when nothing is already in progress — a resume in progress skips
// this entirely (TabBar.jsx goes straight to /workout instead). Each destination handles its own
// flow from here (the scheduled-workout chooser, freestyle straight in, or a dedicated screen).
function ActionsSheet({ close }) {
  const act = fn => () => { close(); fn() }
  return <>
    <h3>{t('Actions')}</h3>
    <div className="muted small" style={{ marginBottom: 10 }}>{t('Choose an action')}</div>
    <div className="sect-b">
      <Row icon="play" iconTint="var(--acc)" title={t('Start scheduled workout')} onClick={act(() => nav('/workout'))} />
      <Row icon="shuffle" iconTint="var(--indigo)" title={t('Start a freestyle workout')} onClick={act(() => startFlow(null))} />
      <Row icon="clipboard" iconTint="var(--teal)" title={t('Start a test session')} onClick={act(() => nav('/tests'))} />
      <Row icon="timer" iconTint="var(--orange)" title={t('Clock')} onClick={act(() => nav('/clock'))} />
      <Row icon="figureRun" iconTint="var(--mint)" title="Estiramiento" onClick={act(() => nav('/stretch'))} />
    </div>
  </>
}
export const actionsSheet = () => ui().openSheet(close => <ActionsSheet close={close} />)

/* ============================ workout lifecycle ============================ */
export function startFlow(routineId) {
  // The check-in is worth interrupting for when the weight curve is going stale, not every
  // single time — once there's a weigh-in within the last 15 days, walk straight into the
  // workout with whatever weight is already on file.
  if (hasRecentWeighIn(S())) { beginWorkout(routineId, null); return }
  bwSheet({ required: true, onDone: bw => beginWorkout(routineId, bw) })
}
export function beginWorkout(routineId, bw) {
  const st = S()
  const r = routineId ? st.routines.find(x => x.id === routineId) : null
  // Exercises the gym has since hidden (out of equipment, retired from the floor) are left
  // out of the session entirely — this is what makes "hide" actually mean "not available",
  // not just "not offered for new picks". Cloned before cleanupSg (which mutates in place)
  // so dropping an orphaned superset pairing here never touches the routine's own saved ex[].
  const usable = (r ? r.ex : []).filter(cfg => !isHidden(cfg.id)).map(cfg => ({ ...cfg }))
  cleanupSg(usable)
  const skipped = (r ? r.ex.length : 0) - usable.length
  // The prescription is applied as the session is built, so you walk up to the bar with the
  // right weight already on the screen instead of being told about it afterwards. `plan` is
  // kept on the entry purely so the workout can explain the number it chose.
  const entries = usable.map(cfg => {
    const plan = nextPrescription(st, cfg, r)
    return { id: cfg.id, sg: cfg.sg, target: { ...cfg }, plan, sets: applyPrescription(buildSets(st, cfg), plan) }
  })
  update(s => {
    s.active = { id: uid(), d: todayISO(), start: Date.now(), routineId, name: r ? r.name : t('Freestyle'), bw: bw || null, cur: 0, entries }
  })
  useUI.getState().stopRest()
  nav('/workout')
  if (skipped) toast(t('{0} exercise(s) skipped — not currently available', skipped))
}
// A set's type — see history.js's `workingSets` for what each one actually changes about how
// the set counts (progression, volume, recovery, carry-forward). 'normal' is stored as no
// `type` at all, matching every optional set field's "absent = default" convention.
export const SET_TYPES = ['normal', 'warmup', 'failure', 'drop']
export const SET_TYPE_LABEL = { normal: 'Normal set', warmup: 'Warmup set', failure: 'Failure set', drop: 'Drop set' }
export const SET_TYPE_DESC = {
  normal: 'A straight working set — counts everywhere.',
  warmup: 'Doesn’t count toward volume, recovery or your next prescription.',
  failure: 'A working set taken to failure — fills in RIR 0 / RPE 10 if you haven’t rated it yet.',
  drop: 'A continuation at a lower weight, right after the set before it — doesn’t carry weight forward either way.'
}
function SetTypeSheet({ current, close, onPick, onDelete }) {
  const cur = current || 'normal'
  return <>
    <h3>{t('Set type')}</h3>
    <div className="sect-b">
      {SET_TYPES.map(k => <button key={k} className="lrow tap" onClick={() => { onPick(k === 'normal' ? null : k); close() }}>
        <span className="lrow-m"><span className="lrow-t">{t(SET_TYPE_LABEL[k])}</span><span className="lrow-s">{t(SET_TYPE_DESC[k])}</span></span>
        {cur === k && <Icon name="check" className="lrow-k" />}
      </button>)}
    </div>
    <div style={{ height: 10 }} />
    <Button variant="danger" icon="trash" onClick={() => { onDelete(); close() }}>{t('Delete this set')}</Button>
  </>
}
export const setTypeSheet = (current, onPick, onDelete) => ui().openSheet(close => <SetTypeSheet current={current} onPick={onPick} onDelete={onDelete} close={close} />)

// What to actually load on the bar for one working set — shown on tap rather than as a row icon
// (see BarbellPlates.jsx), so the drawing gets room to be legible instead of squeezed into a
// stepper row.
function PlatesSheet({ weight, unit }) {
  const { barW, plates } = plateBreakdown(weight, unit)
  return <>
    <h3>{t('Plate breakdown')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>
      {t('A {0} {1} bar plus plates on each side, for {2} {1} total.', fmtNum(barW), unit, fmtNum(weight))}
    </div>
    <div className="row" style={{ justifyContent: 'center', margin: '4px 0 18px' }}>
      <BarbellPlates weight={weight} unit={unit} size="lg" />
    </div>
    {plates.length
      ? <div className="big" style={{ textAlign: 'center' }}>{t('Each side: {0} {1}', plates.map(p => fmtNum(p.w)).join(' + '), unit)}</div>
      : <div className="dim small" style={{ textAlign: 'center' }}>{t('Bar only — no plates needed.')}</div>}
  </>
}
export const platesSheet = (weight, unit) => ui().openSheet(() => <PlatesSheet weight={weight} unit={unit} />)

/* ============================ per-exercise "…" menu (routine editor) ============================ */
// Every action beyond what tapping the row itself already does (open exConfigSheet for
// sets/reps/weight/progression). Video/history need nothing but `ex`, so they're handled right
// here; everything that actually mutates the routine (`replace`, `superset`, `dropset`, `notes`,
// `remove`, the two "and don't recommend" variants) is a plain callback RoutineEdit.jsx injects —
// same shape as exConfigSheet's onSave/onDelete — so this sheet carries no routine-editing logic
// of its own, only the menu chrome.
function ExerciseMenu({ ex, entry, close, actions }) {
  const act = fn => () => { close(); fn() }
  return <>
    <h3 className="capitalize">{nameFor(ex)}</h3>
    <div className="sect-b" style={{ marginTop: 10 }}>
      <Row icon="shuffle" iconTint="var(--indigo)" title={t('Replace')} onClick={act(actions.onReplace)} />
      <Row icon="chartLine" iconTint="var(--purple)" title={t('Change rep progression')} onClick={act(actions.onProgression)} />
      <Row icon="link" iconTint="var(--teal)" title={entry.sg ? t('Leave superset') : t('Add to superset')} onClick={act(actions.onSuperset)} />
      <Row icon="arrowDown" iconTint="var(--blue)" title={entry.dropset ? t('Remove dropset') : t('Add dropset')} onClick={act(actions.onDropsetToggle)} />
      <Row icon="play" iconTint="var(--pink)" title={t('Video and instructions')} onClick={act(() => exerciseDetailSheet(ex))} />
      <Row icon="history" iconTint="var(--green)" title={t('Exercise history')} onClick={act(() => nav('/stats?ex=' + ex.id))} />
      <Row icon="clipboard" iconTint="var(--yellow)" title={t('Notes')} onClick={act(actions.onNotes)} />
    </div>
    <div className="sect-b" style={{ marginTop: 14 }}>
      <Row icon="shuffle" iconTint="var(--red)" title={t('Replace and don’t recommend')} danger onClick={act(actions.onReplaceExclude)} />
      <Row icon="trash" iconTint="var(--red)" title={t('Remove from workout')} danger onClick={act(actions.onRemove)} />
      <Row icon="ban" iconTint="var(--red)" title={t('Remove and don’t recommend')} danger onClick={act(actions.onRemoveExclude)} />
    </div>
  </>
}
export const exerciseMenuSheet = (ex, entry, actions) => ui().openSheet(close => <ExerciseMenu ex={ex} entry={entry} actions={actions} close={close} />)

// Free-text note on one routine entry — "setup, cues, anything you want to remember" for THIS
// slot in THIS routine, same idea as a custom exercise's own description but per placement
// rather than per exercise, since the same exercise can want a different reminder in different
// routines (e.g. "go lighter, this is the fatigue day" vs "this is the PR attempt day").
function ExerciseNotes({ ex, entry, close, onSave }) {
  const [note, setNote] = useState(entry.note || '')
  return <>
    <h3 className="capitalize">{t('Notes')} — {nameFor(ex)}</h3>
    <TextArea rows={4} maxLength={500} placeholder={t('Setup, cues, anything you want to remember for this exercise')}
      value={note} onChange={e => setNote(e.target.value)} />
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={() => { close(); onSave(note.trim()) }}>{t('Save')}</Button>
  </>
}
export const exerciseNotesSheet = (ex, entry, onSave) => ui().openSheet(close => <ExerciseNotes ex={ex} entry={entry} onSave={onSave} close={close} />)

// Pick any OTHER exercise already in this routine to superset with — the quick link-icon on
// each row only pairs with the one directly above; this is the flexible version reached from
// the "…" menu. Picking one hands its index back; RoutineEdit.jsx does the actual reordering.
function SupersetPicker({ routine, excludeIndex, close, onPick }) {
  const others = routine.ex.map((e, i) => ({ e, i })).filter(x => x.i !== excludeIndex)
  return <>
    <h3>{t('Add to superset')}</h3>
    <div className="muted small" style={{ marginBottom: 10 }}>{t('Pick the exercise to do it back-to-back with.')}</div>
    <div className="sect-b">
      {others.map(({ e, i }) => {
        const ex2 = exOr(e.id)
        return <button key={i} className="lrow tap" onClick={() => { close(); onPick(i) }}>
          <span className="lrow-m"><span className="lrow-t capitalize">{nameFor(ex2)}</span></span>
        </button>
      })}
    </div>
  </>
}
export const supersetPickerSheet = (routine, excludeIndex, onPick) => ui().openSheet(close => <SupersetPicker routine={routine} excludeIndex={excludeIndex} onPick={onPick} close={close} />)

function TopWeight({ entryIdx, close }) {
  const st = useStore(s => s.S)
  const A = st.active
  // The workout can end underneath this sheet: finishing from the last exercise clears
  // `active`, and this re-renders before the sheet is torn down. Everything below is
  // read defensively and the sheet dismisses itself — reading A.entries straight took
  // the whole app down with it. Hooks still run unconditionally, so the bail-out has
  // to sit after every one of them.
  const entry = A ? A.entries[entryIdx] : null
  const ex = entry && EXIDX[entry.id]
  const maxSet = entry ? Math.max(0, ...entry.sets.filter(s => s.done).map(s => s.w || 0)) : 0
  const prevBest = entry ? Math.max((st.exWeights[entry.id] || {}).w || 0, bestWeightFor(st, entry.id)) : 0
  const [v, setV] = useState(entry ? (Math.max(maxSet, prevBest) || entry.target.weight || 0) : 0)
  useEffect(() => { if (!entry) close() }, [!entry])

  const units = supersetUnits(A ? A.entries : [])
  const unit = entry ? unitOf(units, entryIdx) : []
  const unitDone = !!entry && unit.every(i => A.entries[i].sets.every(s => s.done))
  const unitIdx = units.findIndex(u => u === unit)
  const isLastUnit = unitIdx === units.length - 1
  if (!entry || !ex) return null

  const commit = advance => {
    const n = Math.round((v || 0) * 10) / 10
    if (!isFinite(n) || n < 0) { toast(t('Enter a valid weight')); return }
    update(s => {
      s.active.entries[entryIdx].topW = n
      const cur = s.exWeights[entry.id]
      s.exWeights[entry.id] = { w: Math.max(n, cur ? cur.w : 0), d: todayISO() }
    })
    close()
    if (advance && unitDone) {
      if (isLastUnit) workoutCompleteSheet()               // whole workout done → finish/continue prompt
      else update(s => { s.active.cur = units[unitIdx + 1][0] })
    } else toast(t('Tracked — next time starts at {0}', fmtNum(S().exWeights[entry.id].w) + ' ' + st.unit))
  }
  return <>
    <h3 className="capitalize row" style={{ gap: 8 }}><Icon name="checkCircle" style={{ color: 'var(--acc)' }} />{t('{0} done', nameFor(ex))}</h3>
    <div className="muted small">{t('Confirm the weight you worked with — your highest becomes the default next time.')}{!unitDone && unit.length > 1 ? ' ' + t('Then finish the superset partner.') : ''}</div>
    <WeightInput value={v} setValue={setV} unit={st.unit} />
    <div style={{ height: 10 }} />
    {prevBest > 0 ? <div className="small dim" style={{ textAlign: 'center', marginBottom: 12 }}>{t('Previous best:')} {fmtNum(prevBest)} {st.unit}{maxSet > prevBest && <span style={{ color: 'var(--yellow)' }}> — {t('new record!')}</span>}</div> : <div style={{ height: 4 }} />}
    {unitDone ? <>
      <Button variant="primary" trailingIcon={isLastUnit ? null : 'chevronRight'} onClick={() => commit(true)}>{isLastUnit ? t('Save') : t('Save & next exercise')}</Button>
      <div style={{ height: 8 }} /><Button variant="ghost" className="dim" onClick={() => commit(false)}>{t('Just close')}</Button>
    </> : <Button variant="primary" onClick={() => commit(false)}>{t('Save weight')}</Button>}
  </>
}
export const topWeightSheet = entryIdx => ui().openSheet(close => <TopWeight entryIdx={entryIdx} close={close} />)

// Shown when the last exercise's last set is checked — finish, or keep going.
function WorkoutComplete({ close }) {
  return <div style={{ textAlign: 'center', padding: '8px 0' }}>
    <div style={{ fontSize: 44, display: 'flex', justifyContent: 'center', color: 'var(--acc)' }}><Icon name="checkCircle" /></div>
    <h3 style={{ margin: '8px 0' }}>{t("That's the whole workout!")}</h3>
    <div className="muted small" style={{ marginBottom: 16 }}>{t('Every exercise done — great work. Finish up, or keep going and add another exercise.')}</div>
    <Button variant="primary" icon="flag" onClick={() => { close(); finishWorkout() }}>{t('Finish workout')}</Button>
    <div style={{ height: 8 }} />
    <Button onClick={() => { close(); useUI.getState().toast(t('Keep going — tap “+ Add exercise” below')) }}>{t('Continue workout')}</Button>
  </div>
}
export const workoutCompleteSheet = () => ui().openSheet(close => <WorkoutComplete close={close} />, { kind: 'center' })

// How the session felt, in one tap (F9). Optional forever — the Coach reads it when it is
// there and never asks twice. Stored on the finished workout itself, so a rating stays tied
// to the session it describes rather than living in a log nothing else can see.
function SessionRating({ w }) {
  const update = useStore(s => s.update)
  const [rating, setRating] = useState(w.rating || null)
  const [note, setNote] = useState('')
  const onWorkout = (s, fn) => { const rec = (s.workouts || []).find(x => x.id === w.id); if (rec) fn(rec) }
  const pick = v => {
    const next = v === rating ? null : v
    setRating(next)
    update(s => onWorkout(s, rec => { if (next) rec.rating = next; else delete rec.rating }))
  }
  const saveNote = () => update(s => onWorkout(s, rec => {
    const v = note.trim()
    if (v) rec.note = v.slice(0, 300); else delete rec.note
  }))
  return <div style={{ textAlign: 'left', marginTop: 16 }}>
    <h4 className="sec">{t('How did that feel?')}</h4>
    <Segmented
      options={[{ value: 'easy', label: t('Too easy') }, { value: 'right', label: t('About right') }, { value: 'hard', label: t('Brutal') }]}
      value={rating} onChange={pick} />
    {!!rating && <>
      <div style={{ height: 8 }} />
      <TextArea rows={2} maxLength={300} value={note} onChange={e => setNote(e.target.value)} onBlur={saveNote}
        placeholder={t('Anything worth remembering? (optional)')} />
    </>}
  </div>
}

function FinishSummary({ w, prs, e1prs = [], rankUps = [], close }) {
  const st = useStore(s => s.S)
  const coachOn = !!useStore(s => s.config)?.coach?.enabled && !!st.coach?.consent?.agreedAt
  return <div style={{ textAlign: 'center', padding: '8px 0' }}>
    <div style={{ fontSize: 44, display: 'flex', justifyContent: 'center', color: 'var(--acc)' }}><Icon name="trophy" /></div>
    <h3 style={{ margin: '8px 0' }}>{t('Workout complete!')}</h3>
    <div className="tiles" style={{ textAlign: 'left' }}>
      <div className="tile"><div className="l">{t('Duration')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{fmtDur(w.end - w.start)}</div></div>
      <div className="tile"><div className="l">{t('Volume')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{fmtVol(w.vol, st.unit)}</div></div>
      <div className="tile"><div className="l">{t('Sets')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{setsDone(w)}</div></div>
      <div className="tile"><div className="l">{t('PRs')}</div><div className="v" style={{ fontSize: 20 }}>{prs.length || '—'}</div></div>
    </div>
    {(prs.length > 0 || e1prs.length > 0 || rankUps.length > 0) && <div style={{ textAlign: 'left', marginBottom: 12 }}>
      {prs.map(id => <div key={id} className="small accent capitalize row" style={{ gap: 5 }}><Icon name="trophy" style={{ fontSize: 13 }} />{t('New PR:')} {EXIDX[id] ? nameFor(EXIDX[id]) : id}</div>)}
      {e1prs.map(p => <div key={p.id} className="small accent capitalize row" style={{ gap: 5 }}><Icon name="chartLine" style={{ fontSize: 13 }} />{t('Best estimated 1RM:')} {EXIDX[p.id] ? nameFor(EXIDX[p.id]) : p.id} · {fmtNum(p.est)} {st.unit}</div>)}
      {rankUps.map(u => <div key={u.id} className="small accent capitalize row" style={{ gap: 5 }}><img src={rankEmblemUrl(u.newRank.tier, u.newRank.division)} alt="" style={{ width: 15, height: 15, objectFit: 'contain', flex: 'none' }} />{t('New rank:')} {EXIDX[u.id] ? nameFor(EXIDX[u.id]) : u.id} · {t(u.newRank.tier)}{u.newRank.division ? ' ' + u.newRank.division : ''}</div>)}
    </div>}
    <h4 className="sec" style={{ textAlign: 'left' }}>{t('What you just trained')}</h4>
    <BodyMap load={loadOfWorkouts([w])} body={st.body} />
    {coachOn && <SessionRating w={w} />}
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={() => { close(); nav('/home') }}>{t('Nice!')}</Button>
  </div>
}
// Shown once, right after finishing a session that had at least one mid-workout exercise swap
// (Workout.jsx's `replaceExercise`) — a choice per swap between "just applied to today" (the
// routine keeps its original exercise, nothing further happens) and "make it stick" (patches
// the routine so every future session starts with the substitute instead).
function SwapKeepSheet({ swaps, routineId, onDone }) {
  const [keep, setKeep] = useState(() => new Set())
  const toggle = i => setKeep(s => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n })
  const save = () => {
    if (keep.size) update(s => {
      const r = s.routines.find(x => x.id === routineId)
      if (!r) return
      swaps.forEach((sw, i) => {
        if (!keep.has(i)) return
        const exIdx = r.ex.findIndex(e => e.id === sw.oldId)
        if (exIdx >= 0) r.ex[exIdx] = { ...r.ex[exIdx], id: sw.newId }
      })
    })
    onDone()
  }
  return <>
    <h3>{t('Keep these swaps?')}</h3>
    <div className="muted small" style={{ marginBottom: 14, lineHeight: 1.5 }}>
      {t('You swapped an exercise during this session. Check any that should replace it in the routine from now on — leave one unchecked and today was a one-off.')}
    </div>
    <div className="list" style={{ marginBottom: 14 }}>
      {swaps.map((sw, i) => <div key={i} className="item" onClick={() => toggle(i)}>
        <div className="grow">
          <div className="tt capitalize">{nameFor(exOr(sw.newId))}</div>
          <div className="ss capitalize">{t('replaces {0}', nameFor(exOr(sw.oldId)))}</div>
        </div>
        <Check checked={keep.has(i)} onChange={() => toggle(i)} />
      </div>)}
    </div>
    <Button variant="primary" onClick={save}>{t('Continue')}</Button>
  </>
}

export function finishWorkout() {
  const A = S().active
  if (!A) return
  const done = setsDoneActive(A)
  const total = A.entries.reduce((n, e) => n + e.sets.length, 0)
  if (!done) { confirmSheet({ title: t('Nothing logged yet'), message: t('You haven’t checked off any sets. Finish the workout anyway?'), confirmText: t('Finish anyway'), onConfirm: doFinishWorkout }); return }
  if (done < total) { confirmSheet({ title: t('Finish early?'), message: t(total - done === 1 ? '{0} set still unchecked. Finish the workout now?' : '{0} sets still unchecked. Finish the workout now?', total - done), confirmText: t('Finish workout'), onConfirm: doFinishWorkout }); return }
  doFinishWorkout()
}
function doFinishWorkout() {
  const st = S()
  const A = st.active
  if (!A) return
  const prs = []
  const e1prs = []
  A.entries.forEach(e => {
    const mx = Math.max(0, ...e.sets.filter(s => s.done).map(s => s.w))
    if (mx > 0 && mx > bestWeightFor(st, e.id)) prs.push(e.id)
    // A heavier estimate without a heavier top set is its own kind of progress —
    // same weight for more reps. Reported separately so it can't be read as a load PR.
    const rec = is1RMRecord(st, e.id, e)
    if (rec && !prs.includes(e.id)) e1prs.push({ id: e.id, ...rec })
  })
  const w = {
    id: A.id, d: A.d, start: A.start, end: Date.now(), routineId: A.routineId, name: A.name, bw: A.bw,
    // `target` (what the session prescribed) is kept alongside the sets: without it a
    // finished workout cannot say whether it hit its reps, and a timed session reads back
    // as "0 reps". It is what the progression engine works from.
    entries: A.entries.map(e => ({ id: e.id, sets: e.sets, topW: e.topW || null, target: e.target || null })).filter(e => e.sets.some(s => s.done)),
    prs
  }
  w.vol = workoutVolume(w)
  const rankUps = rankUpsFor(st, w)
  // Resolve mid-session swaps (Workout.jsx's `replaceExercise`) against the CURRENT entry ids —
  // A.swaps holds each slot's original id, keyed by position; if that slot still differs from
  // its original, it's a real swap worth asking about below.
  const swaps = A.swaps
    ? Object.entries(A.swaps).map(([idx, oldId]) => ({ oldId, newId: A.entries[+idx]?.id })).filter(sw => sw.newId && sw.newId !== sw.oldId)
    : []
  update(s => {
    w.entries.forEach(e => {
      const mx = Math.max(0, ...e.sets.filter(x => x.done).map(x => x.w || 0), e.topW || 0)
      if (mx > 0) { const cur = s.exWeights[e.id]; if (!cur || mx > cur.w) s.exWeights[e.id] = { w: mx, d: w.d } }
    })
    s.workouts.push(w)
    s.active = null
  })
  // No-ops server-side if Strava isn't connected — never surface a failure into this flow.
  sendWorkoutToStrava(w).catch(() => {})
  useUI.getState().stopRest()
  beep(snd(), 880, 0.15); beep(snd(), 1100, 0.15, 0.18); beep(snd(), 1320, 0.3, 0.36)
  const openSummary = () => ui().openSheet(close => <FinishSummary w={w} prs={prs} e1prs={e1prs} rankUps={rankUps} close={close} />, { kind: 'center', locked: true })
  if (swaps.length && A.routineId) {
    ui().openSheet(close => <SwapKeepSheet swaps={swaps} routineId={A.routineId} onDone={() => { close(); openSummary() }} />, { kind: 'center', locked: true })
  } else {
    openSummary()
  }
}

/* ============================ add a friend ============================ */
// Two ways in, one destination: whichever tab someone uses, the result is the same pending
// friend request the other side has to accept — see api/friends/routes.js's POST /request.
function AddFriend({ close, onDone }) {
  const user = useStore(s => s.user)
  const [tab, setTab] = useState('qr')
  const [code, setCode] = useState(null)
  const [qr, setQr] = useState(null)
  const [username, setUsername] = useState('')
  const [busy, setBusy] = useState(false)

  const drawQr = async c => {
    setQr(null)
    const url = `${location.origin}/#/friends?code=${c}`
    // Loaded on demand, same as Admin.jsx's recovery-link QR — not worth adding to everyone's
    // initial download for a code most people will never regenerate.
    try { const { default: QRCode } = await import('qrcode'); setQr(await QRCode.toDataURL(url, { margin: 1, width: 220 })) } catch { /* link still works without it */ }
  }
  useEffect(() => { fetchFriendCode().then(c => { setCode(c); drawQr(c) }).catch(e => toast(e.message)) }, [])

  const regenerate = () => confirmSheet({
    title: t('Reset your code?'),
    message: t('Anyone with the old QR or link will no longer be able to add you with it.'),
    confirmText: t('Reset'),
    onConfirm: () => resetFriendCode().then(c => { setCode(c); drawQr(c) }).catch(e => toast(e.message))
  })
  const share = async () => {
    const url = `${location.origin}/#/friends?code=${code}`
    if (navigator.share) { try { await navigator.share({ url }) } catch { /* share sheet dismissed */ } }
    else { navigator.clipboard?.writeText(url).catch(() => {}); toast(t('Link copied')) }
  }
  const addByUsername = () => {
    const u = username.trim().toLowerCase()
    if (!u) return
    setBusy(true)
    sendFriendRequest({ username: u }).then(() => { toast(t('Friend request sent')); close(); onDone && onDone() })
      .catch(e => toast(e.message)).finally(() => setBusy(false))
  }

  return <>
    <h3>{t('Add a friend')}</h3>
    <div style={{ marginBottom: 16 }}>
      <Segmented value={tab} onChange={setTab} options={[{ value: 'qr', label: 'QR' }, { value: 'username', label: t('Username') }]} />
    </div>
    {tab === 'qr' ? <div style={{ textAlign: 'center' }}>
      <div className="row" style={{ justifyContent: 'center', gap: 10, marginBottom: 14 }}>
        <Avatar name={user?.name} size={40} image={user?.avatar ? mediaUrl(user.avatar) : null} />
        <div style={{ textAlign: 'left' }}>
          <div className="capitalize" style={{ fontWeight: 600 }}>{user?.name}</div>
          {user?.username && <div className="dim small">@{user.username}</div>}
        </div>
      </div>
      {qr ? <img src={qr} alt={t('Your QR code')} width={220} height={220} style={{ borderRadius: 12, background: '#fff', padding: 10 }} />
        : <div style={{ height: 240 }} />}
      <div className="row" style={{ justifyContent: 'center', gap: 10, marginTop: 16 }}>
        <button className="iconbtn" aria-label={t('Reset code')} onClick={regenerate}><Icon name="gear" /></button>
        <Button variant="primary" icon="send" onClick={share}>{t('Share your link')}</Button>
      </div>
    </div> : <>
      <TextField placeholder={t('Username')} value={username} autoCapitalize="none" autoCorrect="off"
        onChange={e => setUsername(e.target.value)} />
      <div style={{ height: 12 }} />
      <Button variant="primary" disabled={busy || !username.trim()} onClick={addByUsername}>{t('Add')}</Button>
    </>}
  </>
}
export const addFriendSheet = onDone => ui().openSheet(close => <AddFriend close={close} onDone={onDone} />)

/* ============================ new conversation ============================ */
function NewConversation({ close, onDone }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const send = () => {
    const msg = text.trim()
    if (!msg) return
    setBusy(true)
    startThread(msg).then(thread => { close(); onDone && onDone(thread) })
      .catch(e => { toast(e.message); setBusy(false) })
  }
  return <>
    <h3>{t('New conversation')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Write your message — a trainer will get back to you here.')}</div>
    <TextArea rows={4} placeholder={t('Type your message…')} value={text} onChange={e => setText(e.target.value)} />
    <div style={{ height: 12 }} />
    <Button variant="primary" icon="send" disabled={busy || !text.trim()} onClick={send}>{t('Send')}</Button>
  </>
}
export const newConversationSheet = onDone => ui().openSheet(close => <NewConversation close={close} onDone={onDone} />)
