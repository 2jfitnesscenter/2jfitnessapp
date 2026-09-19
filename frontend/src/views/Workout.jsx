import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { exOr } from '../lib/exercises.js'
import { effectiveRoutine, lastEntryFor, bestWeightFor, buildSets, setsDoneActive, supersetUnits, unitOf, setLabel, modeOf, EFFORT, effortOf, feelFor, effortColor, EFFORT_COLOR_VAR } from '../lib/history.js'
import { fmtNum, fmtDate, todayISO, exCount, DAYN } from '../lib/format.js'
import { beep, vibrate } from '../lib/sound.js'
import { t, nameFor } from '../lib/i18n.js'
import { api } from '../lib/api.js'
import Media from '../components/Media.jsx'
import { startFlow, exercisePicker, alternativesSheet, exConfigSheet, exerciseDetailSheet, topWeightSheet, finishWorkout, workoutCompleteSheet, confirmSheet, setTypeSheet, platesSheet, effortSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button, NumberField } from '../components/ui.jsx'
import { nextPrescription, applyPrescription } from '../lib/progression.js'
import { glyphOf } from '../lib/glyphs.js'
import { stepWeight, BARBELL_LIKE_EQ } from '../lib/equipment.js'
import { zoneOfSet } from '../lib/training-zones.js'
import { suggestOverload, isOverloadSet, isPotentialPR } from '../lib/overload.js'
import { musclesOf, muscleOptsOf, MUSCLE_GROUPS } from '../lib/muscles.js'
import { weeklyGroupVolumeFinished, weeklyGroupVolumeActive, primaryGroupOf, landmarksFor } from '../lib/rp-volume.js'
import RpVolumeBar from '../components/RpVolumeBar.jsx'

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
    </div>}
    {others.length > 0 && <><h4 className="sec">{t('Other routines')}</h4>
      <div className="list">{others.map(r => <div key={r.id} className="item" onClick={() => startFlow(r.id)}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
        <span className="tag acc">{t('Start')}</span></div>)}</div></>}
    {!S.routines.length && <><div style={{ height: 14 }} /><Button variant="primary" onClick={() => nav('/plan')}>{t('Build a plan first')}</Button></>}
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

// The set-number badge and its done-checkbox, fused into one control (they used to be two
// separate circles competing for the same cramped row) — a short tap toggles done, exactly
// like the checkbox it replaces; holding it past LONG_PRESS_MS opens the same set-type sheet
// the badge itself used to open on every tap. Pointer events rather than onClick/a native
// long-press, so a long press never also fires a toggle when the finger lifts — `firedRef`
// is what suppresses that trailing pointerup once the timer has already acted.
// Typed sets (warmup/drop/failure) keep their letter after completion, colour and all — the
// row's own dimmed opacity already reads as "done" for those, and swapping W/D/F for a bare
// check would throw away the one thing this control still says about the set. A plain
// numbered set switches to a check the moment it's done, matching Check before this fusion.
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
      style={s.type ? { background: TYPE_COLOR[s.type], color: '#fff' } : undefined}
      onPointerDown={start} onPointerUp={release} onPointerLeave={cancel} onPointerCancel={cancel}
      onContextMenu={e => e.preventDefault()}>
      {s.done && !s.type ? <Icon name="check" /> : setBadge(sets, i)}
    </button>
  )
}

/* ---------- one exercise block (reps: weight×reps · time: a held duration · cardio: duration+speed) ---------- */
function ExerciseBlock({ entryIdx, compact, rpFinished, onToggle, onField, onAddSet, onRemoveSet, onStartTimed, onSetType, onReplace }) {
  const S = useStore(s => s.S)
  const working = useUI(s => s.work)
  const entry = S.active.entries[entryIdx]
  const ex = exOr(entry.id)
  const mode = modeOf({ ...(entry.target || {}), id: entry.id })
  const cardio = mode === 'cardio'
  const timed = mode === 'time'
  // Settings → Training → "Show previous results" — off drops both the "Last time" line below
  // and the ghost placeholder in the weight/reps cells (cell()'s `ghost` columns), same switch
  // that already tells buildSets not to pre-fill a fresh set from history (lib/history.js).
  const showPrev = S.showPreviousResults !== false
  const last = showPrev ? lastEntryFor(S, entry.id) : null
  // The same number the "confirm your working weight" sheet calls your best, so the two
  // never disagree inside one session: heaviest logged set, or the working weight you kept.
  const best = cardio ? 0 : Math.max(bestWeightFor(S, entry.id), (S.exWeights[entry.id] || {}).w || 0)
  // What the progression policy decided for this session, and why (issue #17). Computed when
  // the session was built so the reason matches the numbers already in the rows.
  const plan = entry.plan
  // `ghost: true` marks the columns cell() below both steps via lib/equipment.js's stepWeight
  // (weight only) and may show a "last time" placeholder in (reps and weight) — never the
  // effort column, where an empty vs. a logged 0 (failure) are deliberately different things.
  const col1 = cardio ? { f: 'min', step: 1, dec: false, hd: t('Duration (min)') }
    : timed ? { f: 'sec', step: 5, dec: false, hd: t('Seconds') }
      : { f: 'w', step: 2.5, dec: true, hd: t('Weight ({0})', S.unit), ghost: true }
  // A configured rep range (RoutineEdit's exConfigSheet, "Range" mode) outranks the plain
  // last-time ghost as the reps placeholder — "8-12" is what the routine is actually asking
  // for right now, not just an echo of what happened before.
  const target = entry.target
  const repsRangeLabel = mode === 'reps' && target?.targetRepsMin != null && target?.targetRepsMax != null
    ? `${target.targetRepsMin}-${target.targetRepsMax}` : null
  const col2 = cardio ? { f: 'speed', step: 0.5, dec: true, hd: t('Speed (km/h)') }
    : timed ? { f: 'w', step: 2.5, dec: true, hd: t('Weight ({0})', S.unit), ghost: true }
      : { f: 'r', step: 1, dec: false, hd: t('Reps'), ghost: true, rangeLabel: repsRangeLabel }
  // Effort (RIR or RPE, whichever the profile logs) only makes sense for weighted rep sets,
  // not cardio/timed holds, and is opt-in since it adds a third stepper to every row. `opt`
  // because an unlogged effort is not the same as 0 — RIR 0 says the set went to failure.
  const kind = effortOf(S)
  const eff = EFFORT[kind]
  const col3 = mode === 'reps' && eff ? { ...eff, eff: kind, hd: t(eff.hd) } : null
  // A plate diagram only means anything with a real load — never on a warmup set (asked for by
  // name: only the effective sets get one) and never on a cardio hold. The calculator's own
  // bar-type picker (components/BarbellPlates.jsx) is what makes it meaningful for a Smith/EZ/
  // trap bar too now, not just a plain barbell. Settings → During a workout can turn the quick
  // -access icon off independently of the standalone tool (still reachable from Settings itself).
  const barbellEq = BARBELL_LIKE_EQ.includes(ex.eq)
  const showPlates = s => S.enablePlateCalculator !== false && !cardio && barbellEq && s.type !== 'warmup' && s.w > 0
  // The zone chip is the reactive half of Training Zones (lib/training-zones.js) — %1RM against
  // whatever this exercise's best known 1RM already is, or the set's own RIR/RPE when there's no
  // 1RM estimate yet. Same on/off switch as the plate calculator, its own row in Settings — and
  // off outright whenever Weekly Volume Zones is on, below: both are called "zones" but answer
  // different questions (this set's intensity vs. this week's accumulated volume), and showing
  // both at once tested as more confusing than either alone.
  const showZones = S.enableTrainingZones !== false && !cardio && mode === 'reps' && !S.enableRpVolumeZones
  const zoneOf = s => showZones ? zoneOfSet(S, entry.id, s) : null
  // Weekly Volume Zones (lib/rp-volume.js) — one bar per exercise, for whichever muscle group
  // the exercise trains hardest (its highest-weighted slug in musclesOf). `rpFinished` (this
  // week's already-finished workouts) comes from ActiveWorkout as a memoized prop; the
  // still-open session's own sets-so-far are cheap enough (bounded by this workout's own size)
  // to compute fresh right here rather than threading a second memo down for it.
  const showRpVolume = !!S.enableRpVolumeZones && !cardio && mode === 'reps'
  const rpOpts = muscleOptsOf(S)
  const rpGroup = showRpVolume ? primaryGroupOf(musclesOf(ex, rpOpts)) : null
  const rpLandmarks = rpGroup ? landmarksFor(S, rpGroup) : null
  const rpActiveVolume = showRpVolume ? weeklyGroupVolumeActive(S, rpOpts) : null
  const rpVolume = rpGroup ? (rpFinished?.[rpGroup] || 0) + (rpActiveVolume?.[rpGroup] || 0) : 0
  // The Progressive Overload Coach — lib/overload.js. Distinct from `plan` above: `plan` is
  // this SESSION's one-time prescription from the routine's own progression policy (or nothing,
  // for a freestyle exercise or a routine set to "off"); `suggestion` is always-on, purely
  // reactive to last time's numbers, and never writes anything back — tap the ghost values or
  // the +/- steppers to actually act on it, same as any other set.
  const showOverload = S.enableProgressiveOverloadCoach !== false && !cardio && mode === 'reps'
  const topReps = target?.targetRepsMax ?? target?.reps ?? null
  const suggestion = showOverload ? suggestOverload(S, ex.eq, last, topReps) : null
  // Warmup/working split, computed once up front (rather than inside the row-rendering IIFE
  // further down) so both the header's "best result so far" summary and each row's own
  // check-mark colour can share it without a second pass over entry.sets.
  const warmupIdx = []
  const workIdx = []
  entry.sets.forEach((s, i) => (s.type === 'warmup' ? warmupIdx : workIdx).push(i))
  const workPosOf = {}
  workIdx.forEach((idx, pos) => { workPosOf[idx] = pos })
  // 'pr' beats 'overload' beats nothing — a done working set's check lights up gold for an
  // all-time estimated-1RM PR, emerald for merely beating last time's equivalent set, and the
  // header line below the sets echoes whichever is best across the whole exercise so far.
  const achievementOf = (s, wp) => {
    if (!showOverload || !s.done || s.type === 'warmup') return null
    if (isPotentialPR(S, entry.id, s)) return 'pr'
    if (last && wp != null && isOverloadSet(last.sets[wp], s)) return 'overload'
    return null
  }
  const bestAchievement = showOverload
    ? workIdx.reduce((best, idx) => {
      const a = achievementOf(entry.sets[idx], workPosOf[idx])
      return a === 'pr' ? 'pr' : (a === 'overload' && best !== 'pr' ? 'overload' : best)
    }, null)
    : null
  // Collapsible per exercise, not global — reset whenever the visible exercise changes so a
  // hidden warmup block from the last one doesn't silently carry over to this one.
  const [hideWarmup, setHideWarmup] = useState(false)
  useEffect(() => { setHideWarmup(false) }, [entryIdx])
  // Reps step up from 0 with no ceiling, as they always did. Weight instead walks the gym's
  // real rack/pins/plates (or a member's own custom jump) via lib/equipment.js — see
  // Settings → Training. Effort isn't stepped here at all any more — see effortBadge below.
  const bump = (s, i, col, dir) => {
    if (col.f === 'w') return onField(i, col.f, stepWeight(S, ex.eq, s[col.f] || 0, dir))
    onField(i, col.f, Math.max(0, Math.round(((s[col.f] || 0) + dir * col.step) * 100) / 100))
  }
  // Uses the shared stepper markup so a set row picks up the same control styling as every
  // other +/- field in the app. `wp` (this row's position among WORKING sets only, warmups
  // excluded on both sides) is how a ghost column finds its own set in `last` — the two lists
  // don't line up by raw index once a warmup ramp is in front of the working sets.
  const cell = (s, i, col, cls, wp) => {
    const ghostVal = col.ghost && last && wp != null ? last.sets[wp]?.[col.f] : null
    const placeholder = col.rangeLabel || (ghostVal != null ? String(ghostVal) : undefined)
    // Tap the ghost text to fill the field with it — only when the field is actually still
    // showing the ghost (same falsy check the `value` prop below uses, so a field that LOOKS
    // empty is always tappable — a bare 0 renders as the placeholder too, not as "0") and
    // there's a plain number behind it, not a rep-range label with nothing concrete to fill in.
    const fillGhost = () => {
      if (showOverload && !col.rangeLabel && ghostVal != null && !s[col.f]) onField(i, col.f, ghostVal)
    }
    return (
      <div className={'stp ' + cls}>
        <button aria-label={t('Decrease')} onClick={() => bump(s, i, col, -1)}><Icon name="minus" /></button>
        {/* A ghost column reads an unset 0 as empty too, so its placeholder — a rep-range
            target if one's configured, else last time's number — actually has room to show. */}
        <span className="val" onClick={fillGhost}><NumberField decimal={col.dec} nullable={col.opt}
          value={col.ghost ? (s[col.f] || '') : (s[col.f] ?? '')}
          placeholder={placeholder}
          onChange={v => onField(i, col.f, v)} /></span>
        <button aria-label={t('Increase')} onClick={() => bump(s, i, col, 1)}><Icon name="plus" /></button>
      </div>
    )
  }
  // The effort column is a tap-to-open bottom sheet (sheets.jsx's effortSheet), not a stepper —
  // RPE/RIR is a judgment call read off a 9-point emoji scale, not a number worth nudging by
  // 0.5 with a tiny +/-. Still sits in a ".stp eff" wrapper so the eff3 column-width rules
  // (index.css) size it the same as when it was one.
  const effortBadge = (s, i) => {
    const value = s[col3.f]
    const feel = feelFor(col3.eff, value)
    const color = value == null ? null : effortColor(col3.eff === 'rpe' ? 10 - value : value)
    return (
      <div className="stp eff">
        <button className="effbadge" style={color ? { background: EFFORT_COLOR_VAR[color], color: '#fff' } : undefined}
          onClick={() => effortSheet(col3.eff, value, v => onField(i, col3.f, v))}>
          {feel ? <><span className="em">{feel.emoji}</span>{fmtNum(value)}</> : col3.hd}
        </button>
      </div>
    )
  }
  return <>
    <Media ex={ex} key={entry.id} compact={compact} minimizable />
    <div className="row between" style={{ marginBottom: 6 }}>
      <div style={{ fontSize: compact ? 17 : 20, fontWeight: 600, letterSpacing: '-.02em', textTransform: 'capitalize', lineHeight: 1.2 }}>{nameFor(ex)}</div>
      <div className="row" style={{ gap: 4, flex: 'none' }}>
        {/* Equipment taken, machine broken, whatever — swap it for today without leaving the
            session. Nothing about the routine changes here; only the finish-time prompt (see
            doFinishWorkout's swap-keep sheet) ever writes it back. */}
        <button className="iconbtn" aria-label={t('Replace exercise')} title={t('Replace exercise')} onClick={onReplace}><Icon name="shuffle" /></button>
        <button className="iconbtn" aria-label={t('Details')} onClick={() => exerciseDetailSheet(ex)}><Icon name="info" /></button>
      </div>
    </div>
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
      {cardio && <span className="tag acc"><Icon name="figureRun" />{t('Cardio')}</span>}
      {(ex.tg || ex.bp) && <span className="tag">{t(ex.tg || ex.bp)}</span>}
      {ex.eq && <span className="tag">{t(ex.eq)}</span>}
      {best > 0 && <span className="tag nocap">{t('Best:')} {fmtNum(best)} {S.unit}</span>}
    </div>
    {rpGroup && rpLandmarks && <RpVolumeBar
      groupName={t(MUSCLE_GROUPS.find(g => g.key === rpGroup)?.name || rpGroup)}
      sets={rpVolume} landmarks={rpLandmarks} />}
    {last && <div className="small dim" style={{ marginBottom: 4 }}>{t('Last time')} ({fmtDate(last.d)}): {last.sets.map(s => setLabel(entry.id, s, last.target)).join(', ')}</div>}
    {plan && plan.why && plan.kind !== 'off' && <div className={'progline' + (plan.kind === 'deload' ? ' warn' : '')}>
      <Icon name={plan.kind === 'up' ? 'arrowUp' : plan.kind === 'deload' ? 'arrowDown' : 'lightbulb'} />
      <span>{t(...plan.why)}</span>
    </div>}
    {/* The Coach's own suggestion sits below `plan` rather than replacing it — `plan` (when
        present) explains what THIS session's prescribed numbers already are and why; this is a
        standing "here's a sane next target" a member can act on with any exercise, prescribed
        or not. */}
    {suggestion && <div className="overload-chip">
      <Icon name="target" />
      <span>{t('Target: {0} {1} × {2}', fmtNum(suggestion.w), S.unit, suggestion.r)}</span>
    </div>}
    {bestAchievement && <div className={'progline' + (bestAchievement === 'pr' ? ' pr' : '')}>
      <Icon name={bestAchievement === 'pr' ? 'trophy' : 'arrowUp'} />
      <span>{bestAchievement === 'pr' ? t('New PR this session!') : t('Overload achieved')}</span>
    </div>}
    <div className="card" style={{ marginTop: 10, marginBottom: 0 }}>
      {/* the header carries the same eff3 sizing as the rows, or the labels drift off their columns */}
      {(() => {
        const sethead = <div className={'sethead' + (col3 ? ' eff3' : '')}><span className="n-sp" /><span className="w-sp">{col1.hd}</span><span className="r-sp">{col2.hd}</span>{col3 && <span className="eff-sp">{col3.hd}</span>}{timed && <span className="ck-sp" />}</div>
        const row = (s, i) => <div key={i} className={'setrow' + (s.done ? ' done' : '') + (col3 ? ' eff3' : '')}>
          <SetNumBtn s={s} i={i} sets={entry.sets} achievement={achievementOf(s, workPosOf[i])} onToggle={onToggle} onSetType={onSetType} />
          {cell(s, i, col1, 'w', workPosOf[i])}
          {cell(s, i, col2, 'r', workPosOf[i])}
          {col3 && effortBadge(s, i)}
          {(() => { const zone = zoneOf(s); return zone && <span className="zonechip" style={{ '--zc': zone.color }}
            title={zone.short + ' · ' + t(zone.label)} aria-label={zone.short + ' · ' + t(zone.label)}>{zone.short}</span> })()}
          {showPlates(s) && <button className="platesbtn" aria-label={t('Plate breakdown')}
            onClick={() => platesSheet(s.w, S.unit, v => onField(i, 'w', v))}><Icon name="barbell" /></button>}
          {/* A timed set is started, not typed: the timer counts the hold down and checks the
              set off itself. SetNumBtn's own tap-to-toggle still covers anyone who timed it on
              their own watch instead. */}
          {timed && <button className="setgo" aria-label={t('Start set')} disabled={s.done || !!working}
            onClick={() => onStartTimed(i)}><Icon name="play" /></button>}
        </div>
        // Only split into two labelled blocks when there's actually a warmup to separate out —
        // an exercise with none (warmups off, or no working weight to ramp up to yet) keeps the
        // single plain list it always had, so nothing changes for the common case.
        if (!warmupIdx.length) return <>{sethead}{entry.sets.map((s, i) => row(s, i))}</>
        return <>
          <div className="setgroup-hd">
            <span className="setgroup-title">{t('Warmup sets')}</span>
            <button className="setgroup-toggle" onClick={() => setHideWarmup(h => !h)}>
              {hideWarmup ? t('Show') : t('Hide')}<Icon name={hideWarmup ? 'chevronDown' : 'chevronUp'} />
            </button>
          </div>
          {!hideWarmup && <>{sethead}{warmupIdx.map(i => row(entry.sets[i], i))}</>}
          <div className="setgroup-hd" style={{ marginTop: 10 }}><span className="setgroup-title">{t('Working sets')}</span></div>
          {sethead}
          {workIdx.map(i => row(entry.sets[i], i))}
        </>
      })()}
      <div style={{ height: 8 }} />
      <div className="row">
        <Button size="sm" icon="minus" disabled={entry.sets.length <= 1} onClick={onRemoveSet}>{t('Remove set')}</Button>
        <Button size="sm" icon="plus" onClick={onAddSet}>{t('Add set')}</Button>
      </div>
    </div>
  </>
}

/* ---------- active workout ---------- */
function ActiveWorkout() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const { startRest, stopRest } = useUI()
  // Weekly Volume Zones' history half (lib/rp-volume.js) — memoized against S.workouts, not the
  // whole store, so typing into a set doesn't re-scan the week's finished workouts on every
  // keystroke. The still-open session's own contribution is cheap enough to compute fresh in
  // ExerciseBlock itself (see rpFinished's own doc comment there for why the split).
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

  const total = A.entries.reduce((n, e) => n + e.sets.length, 0)
  const done = setsDoneActive(A)

  const mutEntry = (idx, fn) => update(s => { fn(s.active.entries[idx]) }, true)
  // Clearing an optional field drops the key rather than storing null, so a set only carries
  // what was actually logged — in the session, in history and in a backup.
  const effKind = effortOf(S)
  // A warmup/drop set's weight (or effort) is deliberately different from the straight sets
  // around it, so it neither hands its own value forward nor accepts one carried into it.
  const carriable = s => s.type !== 'warmup' && s.type !== 'drop'
  const setField = (idx, i, field, v) => mutEntry(idx, e => {
    if (v == null) delete e.sets[i][field]; else e.sets[i][field] = v
    // Typing a weight (or an RIR/RPE) before checking a set off carries it forward to the later
    // sets of the same exercise that also aren't done yet — straight sets are usually all the
    // same weight/effort, so this saves re-typing it two or three more times. A set already
    // ticked off, one whose value was typed in afterwards, or a warmup/drop on either end is
    // left exactly as it was.
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
  // Failure is the one type with a real side effect: it means "taken to failure", so if the
  // profile rates effort and this set hasn't been rated yet, fill in the failure-equivalent
  // value — RIR 0 or RPE 10 — without touching a value already typed. Goes through mutEntry
  // directly (not setField) so it can never itself carry forward onto later sets.
  const setType = (idx, i, type) => mutEntry(idx, e => {
    if (type) e.sets[i].type = type; else delete e.sets[i].type
    if (type === 'failure' && effKind !== 'none' && e.sets[i][effKind] == null) {
      e.sets[i][effKind] = effKind === 'rpe' ? 10 : 0
    }
  })
  const openSetType = (idx, i) => setTypeSheet(A.entries[idx].sets[i].type, type => setType(idx, i, type), () => removeSetAt(idx, i))

  // Swap one exercise for another mid-session (equipment taken, machine broken) without touching
  // the routine — same sets/reps/weight target carries over, only the id changes, same as
  // RoutineEdit's own "Replace" (sheets.jsx). `active.swaps` remembers the ORIGINAL id per slot
  // (first swap only — swapping back to it clears the entry) so finishWorkout can offer to make
  // the change stick in the routine; leaving it alone means it only ever applied to today.
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

  // A timed set is held, not typed. The work timer records what was actually held — an early
  // finish logs 0:38 of a 0:45 target rather than crediting the full prescription — and then
  // checks the set off through the normal path, so rest, supersets and the finish prompt all
  // behave exactly as they do for a reps set.
  const startTimed = (idx, i) => {
    const e = A.entries[idx]
    useUI.getState().startWork(e.sets[i].sec || 45, nameFor(exOr(e.id)), elapsed => {
      mutEntry(idx, en => { en.sets[i].sec = elapsed })
      if (!useStore.getState().S.active.entries[idx].sets[i].done) toggle(idx, i)
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
        // A past log is filled in after the fact — no rest timer, no live sound/vibration,
        // and no "confirm your working weight" interruption. Just check things off.
        if (!A.past) { beep(S.sound, 1040, 0.12); vibrate(30) }
        const isLastExInUnit = idx === unit[unit.length - 1]
        const unitDone = unit.every(ui => (ui === idx ? e : A.entries[ui]).sets.every(x => x.done))
        if (!A.past) {
          if (isLastExInUnit && !unitDone) startRest(S.restSec, nameFor(exOr(e.id)))
          else if (unitDone) stopRest()
        }
        if (unitDone && isLastUnit) workoutDone = true      // last exercise's last set → done
        // Only reps training has a "working weight" worth confirming — a bodyweight plank
        // has nothing to put in that slider.
        if (e.sets.every(x => x.done)) { exJustDone = true; if (m === 'reps' && !e.asked && !A.past) { e.asked = true; askTop = true } }
      }
    })
    // reps: topWeight first (it chains into the finish/continue prompt on the last unit).
    // cardio/timed or already-confirmed: go straight to the prompt.
    if (askTop) topWeightSheet(idx)
    else if (workoutDone) workoutCompleteSheet()
    else if (exJustDone && cardioEntry) useUI.getState().toast(t('Cardio logged'))
    else if (exJustDone && m === 'time') useUI.getState().toast(t('Hold logged'))
  }

  // Live-presence heartbeat so the admin dashboard can show who's training now. Signed-in only —
  // guests have no server session. Reads fresh state each tick so progress stays current.
  useEffect(() => {
    // A backdated log isn't a live session — nothing to tell the admin dashboard's "training
    // now" view about.
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
      // best-effort "left" signal: sendBeacon survives a tab close, fetch covers in-app nav
      try { navigator.sendBeacon?.('/api/activity', new Blob([JSON.stringify({ active: false })], { type: 'application/json' })) } catch { /* */ }
      api('/api/activity', { method: 'POST', body: JSON.stringify({ active: false }) }).catch(() => {})
    }
  }, [])

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" aria-label={t('Discard')} onClick={() => confirmSheet({ title: t(A.past ? 'Discard this log?' : 'Discard workout?'), message: t(A.past ? 'What you’ve entered for this day will be lost.' : 'The sets you logged in this session will be lost.'), confirmText: t('Discard'), danger: true, onConfirm: () => { update(s => { s.active = null }); stopRest(); nav('/home') } })}><Icon name="xmark" /></button>
      <div style={{ textAlign: 'center' }}><div style={{ fontWeight: 600 }}>{A.name}</div><div className="sub">{A.past ? fmtDate(A.d, true) : <Elapsed start={A.start} />} · {t('{0} sets', done + '/' + total)}</div></div>
      <button className="iconbtn" style={{ color: 'var(--acc)' }} aria-label={t(A.past ? 'Save' : 'Finish')} onClick={finishWorkout}><Icon name="check" /></button>
    </div>
    <div className="wprog"><i style={{ width: (total ? done / total * 100 : 0) + '%' }} /></div>

    {A.entries.length ? <>
      <div className="muted small" style={{ marginBottom: 6 }}>{isSuperset ? t('Superset {0} / {1}', unitIdx + 1, units.length) : t('Exercise {0} / {1}', unitIdx + 1, units.length)}</div>
      {isSuperset ? (
        <div className="ss-card">
          <div className="ss-hd"><Icon name="link" />{t('Superset · do these back-to-back, rest after both')}</div>
          {unit.map((idx, k) => <div key={idx} className="ss-ex">
            {k > 0 && <div className="ss-amp">+</div>}
            <ExerciseBlock entryIdx={idx} compact rpFinished={rpFinished}
              onToggle={i => toggle(idx, i)} onField={(i, f, v) => setField(idx, i, f, v)} onAddSet={() => addSet(idx)} onRemoveSet={() => removeSet(idx)} onStartTimed={i => startTimed(idx, i)} onSetType={i => openSetType(idx, i)} onReplace={() => replaceExercise(idx)} />
          </div>)}
        </div>
      ) : (
        <ExerciseBlock entryIdx={cur} rpFinished={rpFinished} onToggle={i => toggle(cur, i)} onField={(i, f, v) => setField(cur, i, f, v)} onAddSet={() => addSet(cur)} onRemoveSet={() => removeSet(cur)} onStartTimed={i => startTimed(cur, i)} onSetType={i => openSetType(cur, i)} onReplace={() => replaceExercise(cur)} />
      )}
    </> : <div className="empty"><div className="ico"><Icon name="shuffle" /></div>{t('Freestyle workout — add your first exercise.')}</div>}

    <div style={{ height: 12 }} />
    <div className="row">
      <Button icon="chevronLeft" disabled={unitIdx <= 0} onClick={() => update(s => { s.active.cur = units[unitIdx - 1][0] })}>{t('Prev')}</Button>
      <Button trailingIcon="chevronRight" disabled={unitIdx < 0 || unitIdx >= units.length - 1} onClick={() => update(s => { s.active.cur = units[unitIdx + 1][0] })}>{t('Next')}</Button>
    </div>
    <div style={{ height: 10 }} />
    <Button onClick={() => exercisePicker(ex => exConfigSheet(ex, null, cfg => update(s => {
      const full = { ...cfg, id: ex.id }
      const plan = nextPrescription(s, full, s.routines.find(r => r.id === s.active.routineId))
      s.active.entries.push({ id: ex.id, target: { ...cfg }, plan, sets: applyPrescription(buildSets(s, full), plan) })
      s.active.cur = s.active.entries.length - 1
    }), null, S.routines.find(r => r.id === A.routineId)))} icon="plus">{t('Add exercise')}</Button>
    <div style={{ height: 10 }} />
    {(() => {
      const exDone = A.entries.filter(e => e.sets.length && e.sets.every(s => s.done)).length
      const allDone = A.entries.length > 0 && exDone === A.entries.length
      return <button className={allDone || A.past ? 'btn primary' : 'btn ghost dim'} onClick={finishWorkout}>
        {A.past ? t('Save workout') : allDone ? t('Finish workout') : t('Finish workout early · {0} exercises', exDone + '/' + A.entries.length)}
      </button>
    })()}
    <div style={{ height: 40 }} />
  </div>
}

export default function Workout() {
  const active = useStore(s => s.S.active)
  return active ? <ActiveWorkout /> : <StartChooser />
}
