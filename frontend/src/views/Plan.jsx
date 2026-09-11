import { useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { DAYN, uid, exCount, routineCount } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { dayAssignSheet, loadStarterPlan, planToolsSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button, Segmented } from '../components/ui.jsx'
import { glyphOf, DEFAULT_GLYPH } from '../lib/glyphs.js'
import { coachAvailable } from '../lib/coach.js'
import { DEMO } from '../lib/demo.js'
import { MOBILE } from '../lib/mobile.js'
import Library from './Library.jsx'

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
    <Segmented options={[{ value: 'programs', label: t('Programs') }, { value: 'routines', label: t('Routines') }, { value: 'library', label: t('Exercises') }]} value={tab} onChange={setTab} />
    <div style={{ height: 14 }} />

    {tab === 'programs' ? <>
      <div className="row between" style={{ marginBottom: 10 }}>
        <h4 className="sec" style={{ margin: 0 }}>{t('Programs')}</h4>
        <Button size="sm" variant="tinted" icon="plus" onClick={addProgram}>{t('New')}</Button>
      </div>
      {(S.programs || []).length ? <div className="list">{S.programs.map(p => <div key={p.id} className="item" onClick={() => nav('/plan/p/' + p.id)}>
        <span className="lrow-i"><Icon name={glyphOf(p.emoji)} /></span>
        <div className="grow"><div className="tt">{p.name}</div><div className="ss">{routineCount((p.routineIds || []).length)}</div></div>
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
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
        <Icon name="chevronRight" className="chev" /></div>)}</div> : <>
        <div className="empty"><div className="ico"><Icon name="clipboard" /></div>{t('No routines yet.')}<br />{t('Create one or load the starter plan.')}</div>
        <Button icon="sparkles" onClick={loadStarterPlan}>{t('Load starter plan (Push / Pull / Legs)')}</Button>
      </>}
    </> : <Library />}

    <h4 className="sec" style={{ marginTop: 22 }}>{t('Week schedule')}</h4>
    <div className="list" style={{ display: 'flex', flexDirection: 'column' }}>
      {[1, 2, 3, 4, 5, 6, 0].map(d => {
        const r = S.routines.find(x => x.id === S.week[d])
        return <div key={d} className="item" onClick={() => dayAssignSheet(d)}>
          <div className="grow"><div className="tt">{t(DAYN[d])}</div></div>
          {r ? <span className="tag acc"><Icon name={glyphOf(r.emoji)} />{r.name}</span> : <span className="tag">{t('Rest')}</span>}
          <Icon name="chevronRight" className="chev" /></div>
      })}
    </div>
  </>
}
