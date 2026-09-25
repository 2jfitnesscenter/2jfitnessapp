// Constructor V2 — one day as a canvas of blocks. The day is still a plain routine: a flat
// `ex` list (what Workout, Bunker, Sync and Progressive Overload read, unchanged) plus optional
// `blocks` labels; entries carry `blk` = the instance they belong to. Loose entries (old
// routines, or exercises added one by one) are simply the segments with no block.
import { useState } from 'react'
import { useUI } from '../../store/useUI.js'
import { t, nameFor } from '../../lib/i18n.js'
import { exOr, EXIDX } from '../../lib/exercises.js'
import { cleanupSg } from '../../lib/history.js'
import { uid } from '../../lib/format.js'
import { supersetGroupInfo, supersetLabel } from '../../lib/superset-colors.js'
import { segmentsOf, pruneBlocks, estimateSeconds, roundMinutes, classify, prescribe, restDemand, REST_DEFAULTS, GOAL_LABEL, LEVEL_LABEL, STYLE_LABEL, modeOfEntry, blockTitle } from '../../lib/protocol/index.js'
import { lookup } from '../../lib/blocks-api.js'
import { exercisePicker, exConfigSheet, exerciseNotesSheet } from '../../sheets.jsx'
import { Thumb } from '../Media.jsx'
import { Stepper } from '../ui.jsx'
import Icon from '../Icon.jsx'
import { TypeTag, Prescription, rpeOf, restLabel } from './parts.jsx'

const KEEP = ['blk', 'rpe', 'rest', 'role', 'note', 'why', 'sg']
const restOf = (e, goal) => e.rest ?? REST_DEFAULTS[restDemand(classify(e.id, lookup), goal, e.role)]
export const dayMinutes = (ex, goal) => roundMinutes(estimateSeconds(ex || [], e => restOf(e, goal)))

// ── pure day operations (exported for tests) ──────────────────────────────────────────────
export const withEx = (day, ex) => { cleanupSg(ex); const next = { ...day, ex }; next.blocks = pruneBlocks(next); return next }
export function moveEntry(day, from, to, blk) {
  const ex = day.ex.map(e => ({ ...e }))
  const [e] = ex.splice(from, 1)
  const at = to > from ? to - 1 : to
  if (blk) e.blk = blk; else delete e.blk
  ex.splice(Math.max(0, Math.min(ex.length, at)), 0, e)
  return withEx(day, ex)
}
export function moveSegment(day, segIdx, toSegIdx) {
  const segs = segmentsOf(day)
  if (toSegIdx < 0 || toSegIdx >= segs.length || toSegIdx === segIdx) return day
  const order = segs.map((_, i) => i)
  const [s] = order.splice(segIdx, 1)
  order.splice(toSegIdx, 0, s)
  return withEx(day, order.flatMap(i => segs[i].idx.map(k => ({ ...day.ex[k] }))))
}
export const removeSegment = (day, seg) => withEx(day, day.ex.filter((_, i) => !seg.idx.includes(i)).map(e => ({ ...e })))
export const ungroupSegment = (day, seg) => withEx(day, day.ex.map((e, i) => { const c = { ...e }; if (seg.idx.includes(i)) delete c.blk; return c }))
export function insertInstance(day, inst) {
  return withEx({ ...day, blocks: [...(day.blocks || []), inst.meta] }, [...day.ex.map(e => ({ ...e })), ...inst.ex])
}
export function toggleLink(day, i) {
  const ex = day.ex.map(e => ({ ...e }))
  const cur = ex[i], prev = ex[i - 1]
  if (!prev || (prev.blk || null) !== (cur.blk || null)) return day
  if (cur.sg && prev.sg && cur.sg === prev.sg) delete cur.sg
  else { const g = prev.sg || ('sg' + uid()); prev.sg = g; cur.sg = g }
  return withEx(day, ex)
}

// ── prescription editor ───────────────────────────────────────────────────────────────────
const RESTS = [45, 60, 75, 90, 120, 150, 180, 240]
function PrescriptionSheet({ e, ctx, onSave, onMore, close }) {
  const [c, setC] = useState(() => ({ ...e }))
  const mode = modeOfEntry(c)
  const sets = Math.max(1, Number(c.sets) || 1)
  const rpe = Array.from({ length: sets }, (_, i) => rpeOf(c)[i] ?? null)
  const setRpe = (i, v) => setC(x => { const r = Array.from({ length: sets }, (_, k) => rpeOf(x)[k] ?? rpe[k] ?? 8); r[i] = v; return { ...x, rpe: r } })
  const setSets = n => setC(x => { const k = Math.max(1, Math.min(10, Math.round(n) || 1)); const r = rpeOf(x); return { ...x, sets: k, ...(r.length ? { rpe: Array.from({ length: k }, (_, i) => r[i] ?? r[r.length - 1]) } : {}) } })
  const lo = c.targetRepsMin ?? c.repsMin ?? c.reps ?? 10, hi = c.targetRepsMax ?? c.reps ?? 10
  const setRange = (a, b) => setC(x => ({ ...x, targetRepsMin: Math.max(1, a), targetRepsMax: Math.max(a, b), reps: Math.max(a, b), ...(x.prog === 'double' ? { repsMin: Math.max(1, a) } : {}) }))
  const auto = () => setC(x => ({ ...x, ...prescribe(classify(x.id, lookup), { goal: ctx.goal, level: ctx.level, role: x.role || null }) }))
  const ex = exOr(e.id)
  return <div className="cx-rxsheet">
    <h3 className="capitalize">{nameFor(ex)}</h3>
    <div className="cx-rxsheet-grid">
      <Stepper label={t('Sets')} value={sets} step={1} decimal={false} onChange={setSets} />
      {mode === 'reps' && <>
        <Stepper label={t('Reps min')} value={lo} step={1} decimal={false} onChange={v => setRange(v, Math.max(v, hi))} />
        <Stepper label={t('Reps max')} value={hi} step={1} decimal={false} onChange={v => setRange(Math.min(lo, v), v)} />
      </>}
      {mode === 'time' && <Stepper label={t('Seconds')} value={c.sec || 45} step={5} decimal={false} onChange={v => setC(x => ({ ...x, sec: v }))} />}
      {mode === 'cardio' && <Stepper label={t('Minutes')} value={c.min || 20} step={1} decimal={false} onChange={v => setC(x => ({ ...x, min: v }))} />}
    </div>
    {mode !== 'cardio' && <>
      <div className="cx-rxsheet-l">{t('Effort per set')} <span className="dim">{t('2J scale: 4 comfortable · 6 a bit hard · 8 hard · 10 maximum')}</span></div>
      <div className="cx-rpe-row">{rpe.map((v, i) => <div key={i} className="cx-rpe-set">
        <span className="num">{i + 1}</span>
        {[4, 6, 8, 10].map(n => <button key={n} className={'cx-rpe-b r' + n + (v === n ? ' on' : '')} aria-pressed={v === n} aria-label={t('Set {0}: RPE {1}', i + 1, n)} onClick={() => setRpe(i, n)}>{n}</button>)}
      </div>)}</div>
      <div className="cx-rxsheet-l">{t('Rest after the set')}</div>
      <div className="cx-chips">
        {RESTS.map(s => <button key={s} className={'chip' + (c.rest === s ? ' on' : '')} aria-pressed={c.rest === s} onClick={() => setC(x => ({ ...x, rest: s }))}>{restLabel(s)}</button>)}
        <button className={'chip' + (c.rest == null ? ' on' : '')} onClick={() => setC(x => { const y = { ...x }; delete y.rest; return y })}>{t('Member setting')}</button>
      </div>
    </>}
    <div className="cx-rxsheet-acts">
      <button className="btn plain" onClick={auto}><Icon name="sparkles" />{t('Prescribe with the 2J protocol')}</button>
      <button className="btn plain" onClick={() => { close(); onMore() }}><Icon name="gear" />{t('More settings')}</button>
      <button className="btn primary" onClick={() => { close(); onSave(c) }}><Icon name="check" />{t('Save')}</button>
    </div>
  </div>
}

function RowMenu({ e, close, onReplace, onNotes, onMore, onRemove, onVideo }) {
  const act = fn => () => { close(); fn() }
  return <div className="cx-menu">
    <h3 className="capitalize">{nameFor(exOr(e.id))}</h3>
    <button onClick={act(onReplace)}><Icon name="shuffle" />{t('Replace exercise')}</button>
    <button onClick={act(onNotes)}><Icon name="clipboard" />{e.note ? t('Edit note') : t('Add a note')}</button>
    <button onClick={act(onMore)}><Icon name="gear" />{t('Mode, weight and progression')}</button>
    {onVideo && <button onClick={act(onVideo)}><Icon name="play" />{t('Video and instructions')}</button>}
    <button className="danger" onClick={act(onRemove)}><Icon name="trash" />{t('Remove from the day')}</button>
  </div>
}

/**
 * @param day       { name, ex, blocks }
 * @param ctx       { goal, level }
 * @param onChange  (nextDay) => void
 * @param onAddBlock, onAddExercise   open the library / the exercise picker
 * @param onSaveAsBlock (entries, meta) => void
 */
export default function DayCanvas({ day, ctx, unit, onChange, onAddBlock, onAddExercise, onSaveAsBlock, flash, issuesAt = {} }) {
  const openSheet = useUI(s => s.openSheet)
  const [drag, setDrag] = useState(null)        // { kind:'ex', i } | { kind:'seg', s }
  const [over, setOver] = useState(null)        // drop target key
  const segs = segmentsOf(day)
  const ss = supersetGroupInfo(day.ex)
  const set = next => onChange(next)

  const editRx = i => {
    const e = day.ex[i]
    const more = () => exConfigSheet(exOr(e.id), e, cfg => set(withEx(day, day.ex.map((x, k) => k !== i ? { ...x } : { ...Object.fromEntries(KEEP.filter(f => x[f] != null).map(f => [f, x[f]])), id: x.id, ...cfg }))), () => set(withEx(day, day.ex.filter((_, k) => k !== i).map(x => ({ ...x })))), day)
    openSheet(close => <PrescriptionSheet e={e} ctx={ctx} close={close} onMore={more}
      onSave={c => set(withEx(day, day.ex.map((x, k) => k !== i ? { ...x } : c)))} />)
  }
  const rowMenu = i => {
    const e = day.ex[i]
    openSheet(close => <RowMenu e={e} close={close}
      onReplace={() => exercisePicker(n => set(withEx(day, day.ex.map((x, k) => k !== i ? { ...x } : { ...x, id: n.id }))))}
      onNotes={() => exerciseNotesSheet(exOr(e.id), e, note => set(withEx(day, day.ex.map((x, k) => { if (k !== i) return { ...x }; const y = { ...x }; if (note) y.note = note; else delete y.note; return y }))))}
      onMore={() => exConfigSheet(exOr(e.id), e, cfg => set(withEx(day, day.ex.map((x, k) => k !== i ? { ...x } : { ...Object.fromEntries(KEEP.filter(f => x[f] != null).map(f => [f, x[f]])), id: x.id, ...cfg }))), null, day)}
      onRemove={() => set(withEx(day, day.ex.filter((_, k) => k !== i).map(x => ({ ...x }))))} />)
  }
  const segMenu = (seg, si) => openSheet(close => <div className="cx-menu">
    <h3>{seg.meta?.name || t('Exercises')}</h3>
    {onSaveAsBlock && <button onClick={() => { close(); onSaveAsBlock(seg.idx.map(k => day.ex[k]), seg.meta) }}><Icon name="download" />{t('Save as block')}</button>}
    <button disabled={si === 0} onClick={() => { close(); set(moveSegment(day, si, si - 1)) }}><Icon name="arrowUp" />{t('Move block up')}</button>
    <button disabled={si === segs.length - 1} onClick={() => { close(); set(moveSegment(day, si, si + 1)) }}><Icon name="arrowDown" />{t('Move block down')}</button>
    {seg.blk && <button onClick={() => { close(); set(ungroupSegment(day, seg)) }}><Icon name="list" />{t('Keep exercises, drop the block label')}</button>}
    <button className="danger" onClick={() => { close(); set(removeSegment(day, seg)) }}><Icon name="trash" />{t('Remove these exercises')}</button>
  </div>)

  // native drag & drop — no dependency; buttons remain the accessible path
  const onDrop = (kind, target) => ev => {
    ev.preventDefault(); setOver(null)
    if (!drag) return
    if (drag.kind === 'ex' && kind === 'ex') set(moveEntry(day, drag.i, target.i, target.blk))
    else if (drag.kind === 'ex' && kind === 'seg-end') set(moveEntry(day, drag.i, target.end, target.blk))
    else if (drag.kind === 'seg' && (kind === 'seg' || kind === 'seg-end')) set(moveSegment(day, drag.s, target.s))
    setDrag(null)
  }
  const dragOver = key => ev => { ev.preventDefault(); if (over !== key) setOver(key) }

  if (!day.ex.length) return <div className="cx-empty">
    <div className="cx-empty-ico"><Icon name="plus" /></div>
    <h3>{t('Start this day')}</h3>
    <p>{t('Add a 2J block to have a full prescription in one tap, or build it exercise by exercise.')}</p>
    <div className="cx-empty-acts">
      {onAddBlock && <button className="btn primary" onClick={onAddBlock}><Icon name="list" />{t('Add block')}</button>}
      <button className="btn plain" onClick={onAddExercise}><Icon name="dumbbell" />{t('Add exercise')}</button>
    </div>
  </div>

  return <div className="cx-canvas" onDragEnd={() => { setDrag(null); setOver(null) }}>
    {segs.map((seg, si) => {
      const entries = seg.idx.map(k => day.ex[k])
      const meta = seg.meta
      const mins = dayMinutes(entries, ctx.goal)
      const key = 'seg' + si
      return <section key={(seg.blk || 'loose') + si}
        className={'cx-block' + (seg.blk ? '' : ' loose') + (flash && seg.blk === flash ? ' cx-flash' : '') + (over === key ? ' drop' : '') + (drag?.kind === 'seg' && drag.s === si ? ' dragging' : '')}
        onDragOver={drag?.kind === 'seg' ? dragOver(key) : undefined} onDrop={drag?.kind === 'seg' ? onDrop('seg', { s: si }) : undefined}>
        <header className="cx-block-h">
          <span className="cx-grip" draggable onDragStart={ev => { ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', 'seg'); setDrag({ kind: 'seg', s: si }) }} title={t('Drag to reorder')} aria-hidden="true" />
          <TypeTag type={meta?.type || (entries.some(e => e.sg) ? 'superset' : 'strength')} compact />
          <div className="cx-block-t">
            <div className="cx-block-name">{meta?.name || (seg.blk ? t('Block') : t('Exercises'))}</div>
            {meta && <div className="cx-block-sub">
              {[meta.goal && t(GOAL_LABEL[meta.goal]), meta.level && t(LEVEL_LABEL[meta.level]), meta.style && t(STYLE_LABEL[meta.style] || meta.style)].filter(Boolean).join(' · ')}
              {meta.src && <span className="cx-from">{meta.src.startsWith('off-') ? t('from the 2J library') : t('from your blocks')}</span>}
            </div>}
          </div>
          <span className="cx-block-min num">~{mins} min</span>
          <button className="cx-icon" aria-label={t('Block options')} onClick={() => segMenu(seg, si)}><Icon name="moreH" /></button>
        </header>
        <ol className="cx-rows">
          {seg.idx.map((i, pos) => {
            const e = day.ex[i], ex = EXIDX[e.id] || exOr(e.id), info = ss[i]
            const canLink = pos > 0
            const linked = canLink && e.sg && day.ex[i - 1].sg === e.sg
            const rk = 'ex' + i
            const bad = issuesAt[i]
            return <li key={i} className={'cx-row' + (info ? ' ss' : '') + (info && info.pos === 1 ? ' ss-first' : '') + (info && info.pos === info.size ? ' ss-last' : '') + (over === rk ? ' drop' : '') + (drag?.kind === 'ex' && drag.i === i ? ' dragging' : '') + (bad ? ' ' + bad : '')}
              style={info ? { '--ss': `var(--${info.token})` } : undefined}
              draggable onDragStart={ev => { ev.stopPropagation(); ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', 'ex'); setDrag({ kind: 'ex', i }) }}
              onDragOver={drag?.kind === 'ex' ? dragOver(rk) : undefined} onDrop={drag?.kind === 'ex' ? onDrop('ex', { i, blk: e.blk }) : undefined}>
              {canLink && <button className={'cx-link' + (linked ? ' on' : '')} aria-pressed={!!linked} title={linked ? t('Unlink superset') : t('Superset with the exercise above')} onClick={() => set(toggleLink(day, i))}><Icon name="link" /></button>}
              <span className="cx-grip sm" aria-hidden="true" />
              <span className="cx-n num">{info ? <b className="cx-ss">{supersetLabel(info)}</b> : pos + 1}</span>
              <Thumb ex={ex} />
              <div className="cx-row-main">
                <div className="cx-ex-name capitalize">{nameFor(ex)}</div>
                {e.note && <div className="cx-row-note">{e.note}</div>}
              </div>
              <Prescription e={e} onClick={() => editRx(i)} />
              <div className="cx-row-acts">
                <button className="cx-icon sm" aria-label={t('Move up')} disabled={i === 0} onClick={() => set(moveEntry(day, i, i - 1, day.ex[i - 1]?.blk))}><Icon name="chevronUp" /></button>
                <button className="cx-icon sm" aria-label={t('Move down')} disabled={i === day.ex.length - 1} onClick={() => set(moveEntry(day, i, i + 2, day.ex[i + 1]?.blk))}><Icon name="chevronDown" /></button>
                <button className="cx-icon sm" aria-label={t('More options')} onClick={() => rowMenu(i)}><Icon name="moreH" /></button>
              </div>
            </li>
          })}
          {drag?.kind === 'ex' && <li className={'cx-dropend' + (over === 'end' + si ? ' drop' : '')} onDragOver={dragOver('end' + si)} onDrop={onDrop('seg-end', { end: seg.idx[seg.idx.length - 1] + 1, blk: seg.blk, s: si })}>{t('Drop here')}</li>}
        </ol>
      </section>
    })}
    <div className={'cx-canvas-add' + (onAddBlock ? '' : ' one')}>
      {onAddBlock && <button className="cx-addbig" onClick={onAddBlock}><Icon name="list" /><span><b>{t('Add block')}</b><small>{t('Official 2J or your own')}</small></span></button>}
      <button className="cx-addbig" onClick={onAddExercise}><Icon name="dumbbell" /><span><b>{t('Add exercise')}</b><small>{t('Prescribed by the 2J protocol')}</small></span></button>
    </div>
  </div>
}

/** A default, protocol-prescribed entry for one exercise picked from the library. */
export function prescribedEntry(ex, ctx, position = 0) {
  const c = classify(ex.id, lookup)
  if (c.cardio) return { id: ex.id, sets: 1, min: 20, speed: 8 }
  return { id: ex.id, ...prescribe(c, { goal: ctx.goal, level: ctx.level, position }) }
}
export { blockTitle }
