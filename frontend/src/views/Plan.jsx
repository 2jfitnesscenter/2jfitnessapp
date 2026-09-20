import { useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { uid } from '../lib/format.js'
import { RoutineSummaryLine, ProgramSummaryLine } from '../components/PlanSummaryLine.jsx'
import { t } from '../lib/i18n.js'
import { loadStarterPlan, planToolsSheet, scanRoutineSheet, celebrateBadges } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { glyphOf, DEFAULT_GLYPH } from '../lib/glyphs.js'
import { coachAvailable } from '../lib/coach.js'
import { DEMO } from '../lib/demo.js'
import { MOBILE } from '../lib/mobile.js'
import Library from './Library.jsx'
import { mediaUrl } from '../lib/media.js'
import { printRoutines } from '../lib/plan-share.js'
import { evaluateBadgesIn } from '../lib/badges.js'

export default function Plan() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const config = useStore(s => s.config)
  const update = useStore(s => s.update)
  const coachOn = coachAvailable(config, user, { demo: DEMO, mobile: MOBILE })
  // Routines already inside a program are shown there, not loose here too — same routine,
  // one place, never two lists claiming it at once.
  // Settings → General → "Default tab" (S.defaultLibraryTab) only sets where this lands on
  // mount — read once into useState, same as any other "initial value from a setting" — so
  // switching tabs by hand afterward is never fought or reset back.
  const [tab, setTab] = useState(S.defaultLibraryTab || 'programs')
  const grouped = new Set((S.programs || []).flatMap(p => p.routineIds || []))
  const loose = S.routines.filter(r => !grouped.has(r.id))

  // Printing a hand-picked few routines instead of the whole loose list — see the "Select"
  // toggle in the Routines tab below.
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState(() => new Set())
  const exitSelect = () => { setSelectMode(false); setSelected(new Set()) }
  const toggleSelected = id => setSelected(s => {
    const next = new Set(s)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const printSelected = () => {
    const picked = loose.filter(r => selected.has(r.id))
    printRoutines(picked, user?.name || '', S.unit)
    celebrateBadges(evaluateBadgesIn(update, s => { s.badgeFlags = { ...(s.badgeFlags || {}), sharedRoutine: true } }))
  }
  // Retroactive-friendly (see lib/badges.js's first_favorite) — the flag lives on the routine
  // itself, not a one-way S.badgeFlags entry, so un-favouriting and re-favouriting later never
  // re-triggers the celebration (evaluateBadges only ever unlocks a badge once, never re-locks).
  const toggleFav = (ev, id) => {
    ev.stopPropagation()
    celebrateBadges(evaluateBadgesIn(update, s => {
      const r = s.routines.find(x => x.id === id)
      r.fav = !r.fav
    }))
  }

  const addRoutine = () => {
    const r = { id: uid(), name: t('New routine'), emoji: DEFAULT_GLYPH, ex: [] }
    update(s => { s.routines.push(r) })
    nav('/plan/r/' + r.id)
  }
  const addProgram = () => {
    const p = { id: uid(), name: t('New program'), emoji: 'folder', routineIds: [] }
    update(s => { s.programs = s.programs || []; s.programs.push(p) })
    nav('/plan/p/' + p.id)
  }

  return <>
    <div className="hdr">
      <div><h1>{t('Library')}</h1><div className="sub">{t('Your weekly routine')}</div></div>
      {selectMode
        ? <button className="iconbtn" onClick={printSelected} disabled={!selected.size} aria-label={t('Print selected ({0})', selected.size)} title={t('Print selected ({0})', selected.size)}><Icon name="download" /></button>
        : <>
          {coachOn && <button className="iconbtn" onClick={() => nav('/coach')} aria-label={t('Coach')} title={t('Coach')}><Icon name="sparkles" /></button>}
          <button className="iconbtn" onClick={planToolsSheet} aria-label={t('Share your plan')} title={t('Share your plan')}><Icon name="upload" /></button>
        </>}
    </div>
    <div className="ptabs">
      {[{ value: 'programs', icon: 'calendar', label: t('Programs') },
        { value: 'routines', icon: 'clipboard', label: t('Routines') },
        { value: 'library', icon: 'exercises', label: t('Exercises') }].map(o => (
        <button key={o.value} className={'ptab' + (tab === o.value ? ' on' : '')} onClick={() => setTab(o.value)}>
          <span className="ptab-i"><Icon name={o.icon} /></span>{o.label}
        </button>
      ))}
    </div>
    <div style={{ height: 14 }} />

    {tab === 'programs' ? <>
      <div className="row between" style={{ marginBottom: 10 }}>
        <h4 className="sec" style={{ margin: 0 }}>{t('Programs')}</h4>
        <Button size="sm" variant="tinted" icon="plus" onClick={addProgram}>{t('New')}</Button>
      </div>
      {(S.programs || []).length ? <div className="list">{S.programs.map(p => <div key={p.id} className="item" onClick={() => nav('/plan/p/' + p.id)}>
        {p.image
          ? <img src={mediaUrl(p.image)} alt="" style={{ width: 44, height: 44, borderRadius: 12, objectFit: 'cover', flex: 'none' }} />
          : <span className="lrow-i"><Icon name={glyphOf(p.emoji)} /></span>}
        <div className="grow"><div className="tt">{p.name}</div><div className="ss"><ProgramSummaryLine p={p} routines={S.routines} /></div></div>
        {S.activeProgramId === p.id && <span className="tag acc">{t('Active')}</span>}
        <Icon name="chevronRight" className="chev" /></div>)}</div> : <>
        <div className="empty"><div className="ico"><Icon name="folder" /></div>{t('No programs yet.')}<br />{t('Group a few routines together — a whole split, a block, a phase.')}</div>
        <Button icon="plus" onClick={addProgram}>{t('New program')}</Button>
      </>}
    </> : tab === 'routines' ? <>
      <div className="row between" style={{ marginBottom: 10 }}>
        <h4 className="sec" style={{ margin: 0 }}>{t('Routines')}</h4>
        <div className="row" style={{ gap: 8 }}>
          {loose.length > 0 && (selectMode
            ? <Button size="sm" onClick={exitSelect}>{t('Cancel')}</Button>
            : <Button size="sm" icon="checkCircle" onClick={() => setSelectMode(true)}>{t('Select to print')}</Button>)}
          {!selectMode && <Button size="sm" variant="tinted" icon="scan" onClick={scanRoutineSheet}>{t('Scan')}</Button>}
          <Button size="sm" variant="tinted" icon="plus" onClick={addRoutine}>{t('New')}</Button>
        </div>
      </div>
      {loose.length ? <div className="list">{loose.map(r => <div key={r.id} className="item"
        onClick={() => selectMode ? toggleSelected(r.id) : nav('/plan/r/' + r.id)}>
        {selectMode
          ? <span className="lrow-i" style={{ color: selected.has(r.id) ? 'var(--acc)' : 'var(--label-3)' }}>
              {selected.has(r.id) ? <Icon name="checkCircle" /> : <span style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid currentColor', display: 'block' }} />}
            </span>
          : r.image
            ? <img src={mediaUrl(r.image)} alt="" style={{ width: 44, height: 44, borderRadius: 12, objectFit: 'cover', flex: 'none' }} />
            : <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>}
        <div className="grow"><div className="tt">{r.name}</div><div className="ss"><RoutineSummaryLine r={r} /></div></div>
        {!selectMode && <button className="iconbtn" style={{ color: r.fav ? 'var(--yellow)' : 'var(--label-3)' }}
          aria-label={r.fav ? t('Unfavorite') : t('Favorite')} title={r.fav ? t('Unfavorite') : t('Favorite')}
          onClick={ev => toggleFav(ev, r.id)}><Icon name={r.fav ? 'starFill' : 'star'} /></button>}
        {!selectMode && <Icon name="chevronRight" className="chev" />}</div>)}</div> : <>
        <div className="empty"><div className="ico"><Icon name="clipboard" /></div>{t('No routines yet.')}<br />{t('Create one or load the starter plan.')}</div>
        <Button icon="sparkles" onClick={loadStarterPlan}>{t('Load starter plan (Push / Pull / Legs)')}</Button>
      </>}
    </> : <Library />}
  </>
}
