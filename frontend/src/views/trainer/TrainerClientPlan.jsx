// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useUI } from '../../store/useUI.js'
import { t } from '../../lib/i18n.js'
import { glyphOf } from '../../lib/glyphs.js'
import { RoutineSummaryLine, ProgramSummaryLine } from '../../components/PlanSummaryLine.jsx'
import { fetchMemberPlan, fetchTrainerMembers, fetchRoutineCycles, deleteMemberRoutine, duplicateMemberRoutine } from '../../lib/trainer-api.js'
import { RoutineCycles } from '../AdminFollowUp.jsx'
import { mediaUrl } from '../../lib/media.js'
import { Button } from '../../components/ui.jsx'
import Icon from '../../components/Icon.jsx'
import { confirmSheet } from '../../sheets.jsx'

// One member's current plan, as the trainer sees it — read-only list here; building/editing a
// routine or program happens in TrainerRoutineBuilder/TrainerProgramBuilder. Deliberately only
// GET /api/trainer/member-plan (routines/programs) — never this member's workout history or
// body weight, same reduced scope the rest of the trainer role keeps to.
export default function TrainerClientPlan() {
  const nav = useNavigate()
  const { memberId } = useParams()
  const toast = useUI(s => s.toast)
  const [member, setMember] = useState(null)
  const [plan, setPlan] = useState(null)
  const [cy, setCy] = useState(null)   // the routine-review cycles (start / review date), editable by the trainer

  const loadCycles = () => fetchRoutineCycles(memberId).then(setCy).catch(() => setCy(null))
  const load = () => {
    fetchMemberPlan(memberId).then(setPlan).catch(e => toast(e.message))
    loadCycles()
    fetchTrainerMembers().then(list => setMember(list.find(m => m.id === memberId) || null)).catch(() => {})
  }
  useEffect(load, [memberId])

  const openSheet = useUI(s => s.openSheet)
  const open = r => nav('/trainer/' + memberId + '/build/r/' + r.id)
  const duplicate = r => duplicateMemberRoutine(memberId, r.id, plan.sync).then(() => { toast(t('Routine duplicated')); load() }).catch(e => toast(e.message))
  const remove = r => confirmSheet({
    title: t('Delete this routine?'),
    message: t('It leaves {0}’s plan. Their past workouts, marks, progression and stats are kept. If it was their active routine, they will have no active routine.', member?.name || t('Member')),
    confirmText: t('Delete routine'), danger: true,
    onConfirm: () => deleteMemberRoutine(memberId, r.id, plan.sync).then(() => { toast(t('Routine deleted')); load() }).catch(e => toast(e.message)) })
  const menu = r => openSheet(close => <div className="col" style={{ gap: 4, padding: 8 }}>
    <div className="tt" style={{ padding: '4px 12px' }}>{r.name}</div>
    <button className="btn plain" onClick={() => { close(); open(r) }}><Icon name="chevronRight" />{t('Open routine')}</button>
    <button className="btn plain" onClick={() => { close(); open(r) }}><Icon name="pencil" />{t('Edit')}</button>
    <button className="btn plain" onClick={() => { close(); duplicate(r) }}><Icon name="clipboard" />{t('Duplicate')}</button>
    <button className="btn plain danger" onClick={() => { close(); remove(r) }}><Icon name="trash" />{t('Delete routine')}</button>
  </div>)

  if (!plan) return <div id="trainer-app" />

  const grouped = new Set((plan.programs || []).flatMap(p => p.routineIds || []))
  const loose = (plan.routines || []).filter(r => !grouped.has(r.id))

  return <div id="trainer-app">
    <div className="trainer-topbar">
      <div style={{ flex: 1 }}>
        <h1 className="capitalize">{member?.name || t('Member')}</h1>
        <div className="sub">{t('Their current routines and programs.')}</div>
      </div>
      <a className="trainer-back" href="#/trainer"><Icon name="chevronLeft" />{t('All members')}</a>
    </div>

    {cy?.routineCycles?.length > 0 && <RoutineCycles id={memberId} cycles={cy.routineCycles} sync={cy.sync} setData={setCy} reload={loadCycles} plan={plan} />}

    <div className="row" style={{ gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
      <Button icon="plus" onClick={() => nav('/trainer/' + memberId + '/build/r/new')}>{t('New routine')}</Button>
      <Button icon="plus" variant="tinted" onClick={() => nav('/trainer/' + memberId + '/build/p/new')}>{t('New program')}</Button>
      <Button icon="sparkles" variant="tinted" onClick={() => nav('/trainer/' + memberId + '/ai')}>{t('Generate with AI')}</Button>
      <Button icon="scan" variant="tinted" onClick={() => nav('/trainer/' + memberId + '/scan')}>{t('Scan a routine')}</Button>
      <Button icon="list" variant="plain" onClick={() => nav('/trainer/blocks')}>{t('Block library')}</Button>
    </div>

    <h4 className="sec">{t('Programs')}</h4>
    {(plan.programs || []).length ? <div className="list" style={{ marginBottom: 22 }}>
      {plan.programs.map(p => <div key={p.id}><div className="item" onClick={() => nav('/trainer/' + memberId + '/build/p/' + p.id)}>
        {p.image ? <img src={mediaUrl(p.image)} alt="" style={{ width: 44, height: 44, borderRadius: 12, objectFit: 'cover', flex: 'none' }} />
          : <span className="lrow-i"><Icon name={glyphOf(p.emoji)} /></span>}
        <div className="grow"><div className="tt">{p.name}</div><div className="ss"><ProgramSummaryLine p={p} routines={plan.routines || []} /></div></div>
        <Icon name="chevronRight" className="chev" />
      </div>
      {(p.routineIds || []).map(rid => (plan.routines || []).find(r => r.id === rid)).filter(Boolean).map(r => <div key={r.id} className="item" style={{ paddingLeft: 28 }} onClick={() => open(r)}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss"><RoutineSummaryLine r={r} /></div></div>
        <button className="iconbtn" aria-label={t('Routine actions')} aria-haspopup="menu" onClick={e => { e.stopPropagation(); menu(r) }}><Icon name="moreH" /></button>
      </div>)}
      </div>)}
    </div> : <div className="dim small" style={{ margin: '4px 2px 22px' }}>{t('No programs yet.')}</div>}

    <h4 className="sec">{t('Routines')}</h4>
    {loose.length ? <div className="list">
      {loose.map(r => <div key={r.id} className="item" onClick={() => nav('/trainer/' + memberId + '/build/r/' + r.id)}>
        {r.image ? <img src={mediaUrl(r.image)} alt="" style={{ width: 44, height: 44, borderRadius: 12, objectFit: 'cover', flex: 'none' }} />
          : <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>}
        <div className="grow"><div className="tt">{r.name}</div><div className="ss"><RoutineSummaryLine r={r} /></div></div>
        <button className="iconbtn" aria-label={t('Routine actions')} aria-haspopup="menu" onClick={e => { e.stopPropagation(); menu(r) }}><Icon name="moreH" /></button>
      </div>)}
    </div> : <div className="dim small" style={{ margin: '4px 2px' }}>{t('No loose routines.')}</div>}
  </div>
}
