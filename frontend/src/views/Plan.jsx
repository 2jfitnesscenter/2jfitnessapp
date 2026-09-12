import { useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { uid, exCount, routineCount } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { loadStarterPlan, planToolsSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { glyphOf, DEFAULT_GLYPH } from '../lib/glyphs.js'
import { coachAvailable } from '../lib/coach.js'
import { DEMO } from '../lib/demo.js'
import { MOBILE } from '../lib/mobile.js'
import Library from './Library.jsx'
import { mediaUrl } from '../lib/media.js'

export default function Plan() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const config = useStore(s => s.config)
  const update = useStore(s => s.update)
  const coachOn = coachAvailable(config, user, { demo: DEMO, mobile: MOBILE })
  // Routines already inside a program are shown there, not loose here too — same routine,
  // one place, never two lists claiming it at once.
  const [tab, setTab] = useState('routines')
  const grouped = new Set((S.programs || []).flatMap(p => p.routineIds || []))
  const loose = S.routines.filter(r => !grouped.has(r.id))

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
      <div><h1>{t('Plan')}</h1><div className="sub">{t('Your weekly routine')}</div></div>
      {coachOn && <button className="iconbtn" onClick={() => nav('/coach')} aria-label={t('Coach')} title={t('Coach')}><Icon name="sparkles" /></button>}
      <button className="iconbtn" onClick={planToolsSheet} aria-label={t('Share your plan')} title={t('Share your plan')}><Icon name="upload" /></button>
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
        <div className="grow"><div className="tt">{p.name}</div><div className="ss">{routineCount((p.routineIds || []).length)}</div></div>
        {S.activeProgramId === p.id && <span className="tag acc">{t('Active')}</span>}
        <Icon name="chevronRight" className="chev" /></div>)}</div> : <>
        <div className="empty"><div className="ico"><Icon name="folder" /></div>{t('No programs yet.')}<br />{t('Group a few routines together — a whole split, a block, a phase.')}</div>
        <Button icon="plus" onClick={addProgram}>{t('New program')}</Button>
      </>}
    </> : tab === 'routines' ? <>
      <div className="row between" style={{ marginBottom: 10 }}>
        <h4 className="sec" style={{ margin: 0 }}>{t('Routines')}</h4>
        <Button size="sm" variant="tinted" icon="plus" onClick={addRoutine}>{t('New')}</Button>
      </div>
      {loose.length ? <div className="list">{loose.map(r => <div key={r.id} className="item" onClick={() => nav('/plan/r/' + r.id)}>
        {r.image
          ? <img src={mediaUrl(r.image)} alt="" style={{ width: 44, height: 44, borderRadius: 12, objectFit: 'cover', flex: 'none' }} />
          : <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>}
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
        <Icon name="chevronRight" className="chev" /></div>)}</div> : <>
        <div className="empty"><div className="ico"><Icon name="clipboard" /></div>{t('No routines yet.')}<br />{t('Create one or load the starter plan.')}</div>
        <Button icon="sparkles" onClick={loadStarterPlan}>{t('Load starter plan (Push / Pull / Legs)')}</Button>
      </>}
    </> : <Library />}
  </>
}
