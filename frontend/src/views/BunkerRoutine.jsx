// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState } from 'react'
import { t } from '../lib/i18n.js'
import { todayISO, uid, exCount } from '../lib/format.js'
import { buildRoutineEntries } from '../lib/progression.js'
import { imgSrc, gifSrc } from '../lib/exercises.js'
import { supersetLabel } from '../lib/superset-colors.js'
import { glyphOf } from '../lib/glyphs.js'
import { guidedBlocksOf } from '../lib/guided.js'
import { bunkerOutline, bunkerUnit, stepTargets, upNext } from '../lib/bunker-nav.js'
import Icon from '../components/Icon.jsx'

/* The pieces of ONE Bunker training panel that show and move through the routine. They are presentational: everything comes in as props
 * from that panel's own session, so several panels side by side (different members) can never read or change each other's state. */

// A brand-new session for `routine`, built with the exact same shared helper the phone app's beginWorkout() uses
// (lib/progression.js's buildRoutineEntries) — hidden exercises, supersets, progression and buildSets() behave identically here.
export function buildBunkerActive(S, routine) {
  return {
    id: uid(), d: todayISO(), start: Date.now(), routineId: routine.id,
    name: routine.name, bw: null, cur: 0,
    entries: buildRoutineEntries(S, routine),
    ...(guidedBlocksOf(routine).length ? { guidedBlocks: guidedBlocksOf(routine) } : {}),
  }
}

/** "What do you want to train today?" — only when nothing is scheduled or running. Picking writes S.active and nothing else. */
export function BunkerTodayPicker({ routines, sessionS, onPickRoutine, onFreeTraining }) {
  const usable = (routines || []).filter(r => buildRoutineEntries(sessionS(), r).length > 0)
  return <div className="bk-picker">
    <div className="bk-picker-title">{t('What do you want to train today?')}</div>
    <div className="bk-picker-list">
      {usable.map(r => (
        <button key={r.id} className="bk-tool-exrow" onClick={() => onPickRoutine(r)}>
          <span className="bk-picker-routine-icon"><Icon name={glyphOf(r.emoji)} /></span>
          <span className="bk-tool-exname">{r.name}</span>
          <span className="bk-tool-exmeta">{exCount(r.ex.length)}</span>
        </button>
      ))}
      {!usable.length && <div className="bk-tool-empty">{t('No saved routines yet.')}</div>}
    </div>
    <button className="bk-join" onClick={onFreeTraining}><Icon name="shuffle" />{t('Freestyle workout (pick as you go)')}</button>
  </div>
}

/** The whole session as a strip: every exercise, where it stands (done / current / next), its superset letter and its set count. */
export function BunkerOutline({ entries, cur, ssInfo = [], nameOf, onGo, children }) {
  if (!entries?.length) return null
  const rows = bunkerOutline(entries, cur)
  return <div className="bk-exlist" role="list" aria-label={t('Exercises')}>
    {rows.map(r => <button key={r.index} role="listitem" data-state={r.state} aria-current={r.state === 'current' ? 'step' : undefined}
      className={'bk-extab' + (r.state === 'current' ? ' on' : '') + (r.done === r.total && r.total > 0 ? ' done' : '') + (r.state === 'next' ? ' next' : '')}
      onClick={() => onGo(r.index)}>
      <span className="bk-extab-title">
        <b className="bk-extab-code">{ssInfo[r.index] ? supersetLabel(ssInfo[r.index]) : r.index + 1}</b>
        <span className="bk-extab-name">{nameOf(entries[r.index].id)}</span>
      </span>
      <span className="bk-extab-n">{r.state === 'next' && <i className="bk-extab-tag">{t('Next')}</i>}{r.done}/{r.total}</span>
    </button>)}
    {children}
  </div>
}

/** Previous / next buttons (always available, they only move the cursor) and a plain "up next" line. */
export function BunkerStepper({ entries, cur, nameOf, onGo, disabled = false }) {
  if (!entries?.length) return null
  const { prev, next } = stepTargets(entries, cur)
  const nxt = upNext(entries, cur)
  return <div className="bk-stepper">
    <button className="bk-step" disabled={disabled || prev === null} onClick={() => onGo(prev)} aria-label={t('Previous exercise')}><Icon name="chevronLeft" /></button>
    <div className="bk-step-mid" aria-live="polite">
      <span className="bk-step-pos">{t('Exercise {0} of {1}', cur + 1, entries.length)}</span>
      <span className="bk-step-next">{nxt === null ? t('All exercises done') : t('Up next: {0}', nameOf(entries[nxt].id))}</span>
    </div>
    <button className="bk-step" disabled={disabled || next === null} onClick={() => onGo(next)} aria-label={t('Next exercise')}><Icon name="chevronRight" /></button>
  </div>
}

/** A / B (/ C) chips for a superset: switches which partner is on screen. Nothing is written; each partner keeps its own sets. */
export function BunkerSupersetSwitch({ entries, cur, ssInfo = [], nameOf, onGo }) {
  const unit = bunkerUnit(entries, cur)
  if (unit.length < 2) return null
  return <div className="bk-ab" role="group" aria-label={t('Superset')}>
    <Icon name="link" />
    {unit.map(i => {
      const done = entries[i].sets.filter(s => s.done).length
      return <button key={i} className={'bk-ab-chip' + (i === cur ? ' on' : '')} aria-pressed={i === cur} onClick={() => onGo(i)}>
        <b>{supersetLabel(ssInfo[i])}</b><span>{nameOf(entries[i].id)}</span><i>{done}/{entries[i].sets.length}</i>
      </button>
    })}
  </div>
}

/** The exercise image from the current library (gif first, else still). A clean placeholder when there is none or it fails to load. */
export function BunkerExerciseMedia({ ex, name }) {
  const [broken, setBroken] = useState(false)
  const src = ex?.gif ? gifSrc(ex) : ex?.img ? imgSrc(ex) : null
  if (!src || broken) return <div className="bk-exmedia bk-exmedia-fallback" role="img" aria-label={t('No image available')}>
    <Icon name="dumbbell" /><span>{name}</span>
  </div>
  return <img className="bk-exmedia" src={src} alt={name} loading="lazy" decoding="async" onError={() => setBroken(true)} />
}

/** The open panels, side by side. One panel per member credential, keyed by uid: nothing is shared between them. Hidden ones stay mounted. */
export function BunkerPanelGrid({ credentials, activeUids, renderPanel }) {
  const open = activeUids.filter(uid => credentials[uid])
  return <div className={`bk-multi-grid users-${Math.min(open.length, 3)}${open.length > 3 ? ' overflow-panels' : ''}`}>
    {Object.entries(credentials).map(([uid, c]) => renderPanel(uid, c, !activeUids.includes(uid)))}
  </div>
}
