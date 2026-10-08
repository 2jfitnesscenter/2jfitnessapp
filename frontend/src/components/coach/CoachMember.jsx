// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { t, getLang } from '../../lib/i18n.js'
import { fmtDate, fmtNum } from '../../lib/format.js'
import { mediaUrl } from '../../lib/media.js'
import { PAIN_ZONE } from '../../lib/checkin.js'
import { fetchMemberPlan } from '../../lib/trainer-api.js'
import { analyzeRoutineStructure, structuralFactsForAI } from '../../lib/routine-structure.js'
import { reviewReasons } from '../../lib/routine-review-text.js'
import * as cf from '../../lib/coach-followup.js'
import { RoutineCycles } from '../../views/AdminFollowUp.jsx'
import Icon from '../Icon.jsx'
import { Surface, Pill, ProgressBar, Sparkline, Skeleton } from '../v2.jsx'
import { Button, Avatar, TextArea, Row } from '../ui.jsx'
import './coach-followup.css'

/* The sheet of one member (staff). Order: summary · now · progress · adherence · review · 2J analysis · check-in · professional history · notes. Everything is read
   from GET /api/trainer/followup/member; the AI only rewrites what is already computed. Sections are collapsible so nothing is a wall of text. */
const lang = () => (getLang() === 'en' ? 'en' : 'es')       // the AI answers in Spanish or English; the interface is translated by the app

function Acc({ id, title, icon, hint, open, children, count }) {
  return <details className="cf-acc" open={open} id={id}>
    <summary><span className="ic"><Icon name={icon} /></span><span className="tt">{title}{count != null && <em>{count}</em>}</span>{hint && <span className="hint">{hint}</span>}<Icon name="chevronDown" className="chev" /></summary>
    <div className="cf-acc-body">{children}</div>
  </details>
}
const Chip = ({ children, tone }) => <span className={'cf-chip' + (tone ? ' ' + tone : '')}>{children}</span>

/* ------------------------------------------------------------------ summary */
function GoalSheet({ id, goal, onSaved, close }) {
  const toast = useUI(s => s.toast)
  const [primary, setPrimary] = useState(goal.source === 'staff' ? goal.key || '' : '')
  const [label, setLabel] = useState(goal.label || '')
  const [targetDate, setTargetDate] = useState(goal.targetDate || '')
  const [priority, setPriority] = useState(goal.priority || 'normal')
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const save = () => {
    setBusy(true)
    cf.saveGoal(id, { primary: primary || null, label: label.trim() || null, targetDate: targetDate || null, priority, comment }).then(() => { toast(t('Goal saved')); onSaved(); close() })
      .catch(e => toast(e.message)).finally(() => setBusy(false))
  }
  return <>
    <h3>{t('Goal and priority')}</h3>
    <div className="dim small" style={{ marginBottom: 8 }}>{goal.source === 'member' ? t('Now reading the goal the member chose. Setting one here is your own reading; the member’s stays untouched.') : t('Your own reading of this member’s goal. The member’s stays untouched.')}</div>
    <div className="cf-goals" role="group" aria-label={t('Goal')}>
      {cf.GOALS.map(([k, name]) => <button key={k} type="button" className={'chip' + (primary === k ? ' on' : '')} aria-pressed={primary === k} onClick={() => setPrimary(primary === k ? '' : k)}>{t(name)}</button>)}
    </div>
    <label className="cf-f"><span>{t('In your words (optional)')}</span><input className="input" maxLength={80} value={label} onChange={e => setLabel(e.target.value)} placeholder={t('e.g. Half marathon in March')} /></label>
    <label className="cf-f"><span>{t('Target date (optional)')}</span><input type="date" className="input" value={targetDate} onChange={e => setTargetDate(e.target.value)} /></label>
    <div className="cf-f"><span>{t('Goal priority')}</span><div className="cf-seg">{['normal', 'high'].map(p => <button key={p} type="button" className={priority === p ? 'on' : ''} aria-pressed={priority === p} onClick={() => setPriority(p)}>{t(p === 'high' ? 'High' : 'Normal')}</button>)}</div></div>
    <label className="cf-f"><span>{t('Why (kept in the history)')}</span><TextArea rows={2} maxLength={300} value={comment} onChange={e => setComment(e.target.value)} /></label>
    <Button variant="primary" style={{ width: '100%', marginTop: 12 }} disabled={busy} onClick={save}>{t('Save goal')}</Button>
  </>
}

function TeamSheet({ id, team, onSaved, close }) {
  const toast = useUI(s => s.toast)
  const [ids, setIds] = useState(team.assigned)
  const [busy, setBusy] = useState(false)
  const toggle = k => setIds(a => a.includes(k) ? a.filter(x => x !== k) : [...a, k])
  const save = () => { setBusy(true); cf.assignTrainers(id, ids).then(() => { toast(t('Access saved')); onSaved(); close() }).catch(e => toast(e.message)).finally(() => setBusy(false)) }
  return <>
    <h3>{t('Trainers with access')}</h3>
    <div className="dim small" style={{ marginBottom: 8 }}>{t('Administrators always have access. A trainer only sees the members assigned to them.')}</div>
    {team.options.length ? <div className="list">{team.options.map(o => <Row key={o.id} icon={ids.includes(o.id) ? 'checkCircle' : 'person'} iconTint={ids.includes(o.id) ? 'var(--acc)' : 'var(--grey)'} title={o.name} onClick={() => toggle(o.id)} />)}</div>
      : <div className="dim small">{t('There are no trainers yet. Grant the trainer role to someone first.')}</div>}
    <Button variant="primary" style={{ width: '100%', marginTop: 14 }} disabled={busy} onClick={save}>{t('Save access')}</Button>
  </>
}

function Summary({ d, id, nav, reload, admin }) {
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const { view, member, followUp } = d
  const lv = cf.LEVEL[view.level]
  const goal = view.goal
  const active = view.signals.filter(s => s.severity !== 'info').slice(0, 3)
  const run = (p, msg) => p.then(() => { if (msg) toast(msg); return reload() }).catch(e => toast(e.message))
  return <Surface className={'cf-sum ' + view.level} as="section" aria-label={t('Summary')}>
    <div className="cf-sum-top">
      <Avatar name={member.name} size={56} image={member.avatar ? mediaUrl(member.avatar) : null} />
      <div className="cf-who">
        <h2 className="capitalize">{member.name}</h2>
        <div className="small dim">{cf.goalName(goal) || t('No goal set')}{goal.targetDate && ' · ' + t('by {0}', fmtDate(goal.targetDate))}{goal.priority === 'high' && ' · ' + t('High priority')}</div>
      </div>
      <Pill className={'cf-lv ' + view.level}><i className="dot" aria-hidden="true" />{t(lv.word)}</Pill>
    </div>
    {active.length ? <ul className="cf-sigs">{active.map(s => <li key={s.id + (s.evidence?.zone || '')} className={s.severity}><b>{cf.signalText(s)}</b><small>{cf.actionText(s)}</small></li>)}</ul>
      : <p className="cf-why calm">{t('No signals to review right now.')}</p>}
    <div className="cf-acts wrap">
      <Button size="sm" variant="primary" icon="clipboard" onClick={() => nav('/trainer/' + id)}>{t('Open plan')}</Button>
      {d.ai.available && <Button size="sm" variant="tinted" icon="sparkles" onClick={() => nav('/trainer/' + id + '/ai')}>{t('Create proposal')}</Button>}
      {followUp ? <>
        <Button size="sm" variant="tinted" icon="target" onClick={() => openSheet(close => <GoalSheet id={id} goal={goal} onSaved={reload} close={close} />)}>{t('Edit goal')}</Button>
        <Button size="sm" variant="tinted" icon="flag" onClick={() => run(cf.setFlag(id, !followUp.flag), followUp.flag ? t('Mark cleared') : t('Marked for follow-up'))}>{t(followUp.flag ? 'Clear mark' : 'Mark for follow-up')}</Button>
      </> : <Button size="sm" variant="tinted" icon="plus" disabled={member.disabled} onClick={() => run(cf.startFollowUp(id), t('Follow-up started'))}>{t('Start follow-up')}</Button>}
    </div>
    {!followUp && <p className="small dim cf-hint">{t('Start the follow-up to keep a goal, notes and decisions for this member.')}</p>}
    {admin && d.trainers && <div className="cf-team small dim"><Icon name="users" /> {d.trainers.assigned.length ? t('Trainers: {0}', d.trainers.options.filter(o => d.trainers.assigned.includes(o.id)).map(o => o.name).join(', ')) : t('Only administrators have access.')}
      <button type="button" className="v3-link" onClick={() => openSheet(close => <TeamSheet id={id} team={d.trainers} onSaved={reload} close={close} />)}>{t('Manage')}</button></div>}
  </Surface>
}

/* ------------------------------------------------------------------ now / progress / adherence */
function Now({ view }) {
  const a = view.adherence
  const fat = view.fatigue.level
  return <ul className="cf-list">
    <li><span>{t('Last session')}</span><b>{a.daysSince != null ? cf.agoText(a.daysSince) : t('No workouts yet')}</b></li>
    <li><span>{t('This week')}</span><b>{a.d7.planned != null ? t('{0} of {1} sessions', a.d7.full + a.d7.partial, a.d7.planned) : t('{0} sessions', a.d7.full + a.d7.partial)}</b></li>
    {view.review.next && <li><span>{t('Next review')}</span><b>{fmtDate(view.review.next)} · {cf.inText(view.review.reviewIn)}</b></li>}
    {view.goal.targetDate && <li><span>{t('Target date')}</span><b>{fmtDate(view.goal.targetDate)}</b></li>}
    {fat !== 'normal' && <li className="note"><span>{t('Effort')}</span><b>{t(fat === 'high' ? 'There are several fatigue signals; review recovery and load.' : 'Some signs of building fatigue.')}</b></li>}
  </ul>
}

function Progress({ view }) {
  const p = view.progress, a = view.adherence
  const bodyIsGoal = view.goal.lens === 'body'
  return <div className="cf-prog">
    <div className="cf-spark">
      <Sparkline points={a.weekly} width={220} height={44} label={t('Sessions per week, last 8 weeks')} />
      <small className="dim">{t('Sessions per week · last 8 weeks')}</small>
    </div>
    <div className="cf-chips">
      <Chip tone={p.prs28 > 0 ? 'good' : undefined}>{t(p.prs28 === 1 ? '{0} record in 28 days' : '{0} records in 28 days', p.prs28)}</Chip>
      <Chip>{t(cf.PROGRESSION_TEXT[p.progression.status])}</Chip>
      {p.plateau.clear && <Chip tone="warn">{t('Plateau signals to review')}</Chip>}
      {p.cardio28 > 0 && <Chip>{t(p.cardio28 === 1 ? '{0} cardio session' : '{0} cardio sessions', p.cardio28)}</Chip>}
    </div>
    {p.body && <div className="cf-ctx"><b>{t('Context')}</b> · {t('Body weight')}: {(p.body.delta > 0 ? '+' : p.body.delta < 0 ? '−' : '±') + fmtNum(Math.abs(p.body.delta))} kg {t('in {0} weeks', Math.max(1, Math.round(p.body.span / 7)))}
      <small className="dim"> — {t(bodyIsGoal ? 'Read against the goal; it is not a measure of performance.' : 'Shown as context only; it is not a measure of performance.')}</small></div>}
  </div>
}

function Adherence({ view }) {
  const a = view.adherence, d28 = a.d28, d7 = a.d7
  const trend = a.trend
  return <div className="cf-adh">
    <div className="cf-big"><b>{d28.pct != null ? d28.pct + '%' : '—'}</b><span>{d28.planned != null ? t('{0} of {1} planned sessions · 28 days', d28.full + d28.partial, d28.planned) : t('{0} sessions in 28 days · no weekly plan to compare', d28.full + d28.partial)}</span></div>
    {d28.pct != null && <ProgressBar value={d28.pct / 100} label={t('Adherence')} />}
    <ul className="cf-list">
      <li><span>{t('Last 7 days')}</span><b>{d7.planned != null ? t('{0} of {1}', d7.full + d7.partial, d7.planned) : d7.full + d7.partial}</b></li>
      <li><span>{t('Per week (last 2 weeks vs before)')}</span><b>{fmtNum(a.perWeek.last)} · {fmtNum(a.perWeek.before)}</b></li>
    </ul>
    <div className="cf-chips">
      {trend && <Chip tone={trend === 'up' ? 'good' : trend === 'down' ? 'warn' : undefined}>{t(cf.TREND_TEXT[trend])}</Chip>}
      {d28.partial > 0 && <Chip>{t('Partial: {0}', d28.partial)}</Chip>}
      {d28.cardio > 0 && <Chip>{t('Cardio, counted apart: {0}', d28.cardio)}</Chip>}
      {d28.moved > 0 && <Chip>{t('Moved: {0}', d28.moved)}</Chip>}
      {d28.excluded > 0 && <Chip>{t('Excluded from progression: {0}', d28.excluded)}</Chip>}
    </div>
    <p className="small dim">{t('Percentages are rounded to 5 and only shown with a weekly plan and at least a week of history.')}</p>
  </div>
}

/* ------------------------------------------------------------------ review */
function ReviewBrief({ d, plan, id, nav }) {
  const pending = (d.routineCycles || []).filter(c => !c.reviewed && ['due', 'overdue', 'early'].includes(c.status))
  if (!pending.length) return null
  const c = pending[0], view = d.view
  const program = c.kind === 'program' ? (plan?.programs || []).find(p => p.id === c.programId) : null
  const routines = program ? (c.routineIds || []).map(rid => (plan?.routines || []).find(r => r.id === rid)).filter(Boolean) : []
  const findings = routines.length ? analyzeRoutineStructure({ days: routines.map(r => ({ ...r, key: r.id })) }, { availableEquipment: plan?.gym?.availableEquipment }).findings.filter(f => f.severity !== 'info').slice(0, 2) : []
  const last = c.lastReviewAt
  const changed = (d.timeline || []).filter(e => e.kind === 'plan_changed' && (!last || e.d > last)).length
  const points = view.signals.filter(s => s.severity !== 'info').slice(0, 3)
  return <div className="cf-brief" aria-label={t('What to look at')}>
    <div className="v2-eyebrow"><Icon name="clipboard" /> {t('Review brief')} · {c.name}</div>
    <ul className="cf-list">
      <li><span>{t('Adherence')}</span><b>{view.adherence.d28.pct != null ? view.adherence.d28.pct + '%' : '—'}{c.adherence ? ' · ' + t('Program adherence') + ' ' + c.adherence.percent + '%' : ''}</b></li>
      <li><span>{t('Progression')}</span><b>{t(cf.PROGRESSION_TEXT[view.progress.progression.status])}</b></li>
      {c.plateau?.clear && <li><span>{t('Review signals')}</span><b>{reviewReasons(c, 2).join(' · ') || t('Plateau signals to review')}</b></li>}
      {view.checkin.shared && <li><span>{t('Check-ins')}</span><b>{view.checkin.count ? t('{0} in 14 days · {1} with high fatigue', view.checkin.count, view.checkin.highFatigue14) : t('None in 14 days')}</b></li>}
      <li><span>{last ? t('Since the last review ({0})', fmtDate(last)) : t('Since the start')}</span><b>{changed ? t(changed === 1 ? '{0} plan change' : '{0} plan changes', changed) : t('No plan changes')}</b></li>
    </ul>
    {findings.length > 0 && <ul className="v3-cy-findings">{findings.map(f => <li key={f.id}>{f.message}</li>)}</ul>}
    {points.length > 0 && <div className="cf-todo"><b>{t('What to look at')}</b><ul>{points.map(s => <li key={s.id + (s.evidence?.zone || '')}>{cf.actionText(s)}</li>)}</ul></div>}
    <Button size="sm" variant="tinted" icon="clipboard" onClick={() => nav(c.kind === 'program' ? `/trainer/${id}/p/${c.programId}` : `/trainer/${id}/r/${c.routineId}`)}>{t(c.kind === 'program' ? 'Open program' : 'Open routine')}</Button>
  </div>
}

/* ------------------------------------------------------------------ analysis (facts · inference · suggestion) */
function Decision({ id, text, onDone }) {
  const toast = useUI(s => s.toast)
  const [done, setDone] = useState(null)
  const go = kind => cf.logDecision(id, kind, text).then(() => { setDone(kind); onDone?.(); toast(t('Decision recorded')) }).catch(e => toast(e.message))
  if (done) return <span className="cf-done"><Icon name="check" /> {t(done === 'recommendation_accepted' ? 'Accepted' : 'Dismissed')}</span>
  return <span className="cf-dec"><button type="button" onClick={() => go('recommendation_accepted')} aria-label={t('Accept')}><Icon name="check" /></button><button type="button" onClick={() => go('recommendation_rejected')} aria-label={t('Dismiss')}><Icon name="xmark" /></button></span>
}

function Analysis({ d, plan, id, nav, notesRef, setDraft, reload }) {
  const toast = useUI(s => s.toast)
  const [state, setState] = useState('idle')          // idle | running | done | failed
  const [ai, setAi] = useState(null)
  const base = d.view.analysis
  const poll = async () => {
    for (let i = 0; i < 70; i++) {
      await new Promise(r => setTimeout(r, 1500))
      const s = await cf.fetchAnalysis(id)
      if (!s.job) { if (s.result) { setAi(s.result); setState('done') } else setState('failed'); return }
    }
    setState('failed')
  }
  const run = async () => {
    setState('running'); setAi(null)
    try {
      let structure
      const pc = (d.routineCycles || []).find(c => c.kind === 'program')       // the active program, as the review cycle already resolves it
      const program = pc && plan ? (plan.programs || []).find(p => p.id === pc.programId) : null
      const rs = program ? (pc.routineIds || []).map(rid => (plan.routines || []).find(r => r.id === rid) || program.routineSnapshots?.[rid]).filter(Boolean) : []
      if (rs.length) structure = structuralFactsForAI(analyzeRoutineStructure({ days: rs.map(r => ({ ...r, key: r.id })) }, { availableEquipment: plan?.gym?.availableEquipment })).findings
      const r = await cf.analyze(id, structure, lang())
      if (r.source === 'ai') await poll()
      else { setState('failed'); if (r.ai?.error) toast(t(r.ai.error === 'cap' ? 'The daily AI limit has been reached.' : 'The analysis is busy; try again in a moment.')) }
    } catch (e) { toast(e.message); setState('failed') }
  }
  const act = a => a.action === 'open_program' ? nav('/trainer/' + id) : a.action === 'create_proposal' ? nav('/trainer/' + id + '/ai')
    : a.action === 'add_note' ? (setDraft(a.text), notesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })) : (() => { const el = document.getElementById('cf-review'); if (el) { el.open = true; el.scrollIntoView({ behavior: 'smooth' }) } })()
  const ACT_LABEL = { open_program: 'Open program', create_proposal: 'Create proposal', add_note: 'Add note', review_date: 'Review date' }
  const kinds = [['fact', base.facts], ['inference', base.inference], ['suggestion', base.suggestion]]
  return <div className="cf-an">
    <div className="cf-3">
      {kinds.map(([k, list]) => list.length > 0 && <div key={k} className={'cf-col ' + k}><h4>{t(cf.TAG[k])}</h4>
        <ul>{list.map(x => <li key={x.id}>{t(x.text, ...cf.analysisArgs(x))}{k === 'suggestion' && <Decision id={id} text={t(x.text)} />}</li>)}</ul></div>)}
    </div>
    <div className="cf-ai">
      {d.ai.available ? <Button size="sm" variant="tinted" icon="sparkles" disabled={state === 'running'} onClick={run}>{t(state === 'done' ? 'Analyze again' : 'Analyze follow-up')}</Button>
        : <span className="small dim"><Icon name="info" /> {t('The professional AI is not connected. The analysis above is calculated from the data.')}</span>}
      {state === 'running' && <div className="cf-wait" role="status"><Skeleton width="70%" /><Skeleton width="90%" height={11} /><Skeleton width="60%" height={11} /></div>}
      {state === 'failed' && <p className="small dim" role="status">{t('The AI analysis is not available right now. The calculated analysis above still applies.')}</p>}
      {ai && <div className="cf-air">
        <div className="v2-eyebrow"><Icon name="sparkles" /> {t('Summary')}</div>
        <ul className="cf-sum3">{ai.summary.map((l, i) => <li key={i}>{l}</li>)}</ul>
        <div className="v2-eyebrow">{t('Key data')}</div>
        <ul className="cf-tagged">{ai.keyData.map((x, i) => <li key={i}><em className={x.tag}>{t(cf.TAG[x.tag])}</em>{x.text}</li>)}</ul>
        {ai.review.length > 0 && <><div className="v2-eyebrow">{t('What to look at')}</div><ul className="cf-tagged">{ai.review.map((x, i) => <li key={i}><em className={x.tag}>{t(cf.TAG[x.tag])}</em>{x.text}</li>)}</ul></>}
        {ai.proposal.length > 0 && <><div className="v2-eyebrow">{t('Proposal')}</div><ul className="cf-prop">{ai.proposal.map((x, i) => <li key={i}><span>{x.text}</span>
          <span className="cf-prop-acts"><Button size="sm" variant="tinted" onClick={() => act(x)}>{t(ACT_LABEL[x.action])}</Button><Decision id={id} text={x.text} onDone={reload} /></span></li>)}</ul></>}
        <p className="small dim">{t('Written by AI from calculated data. Nothing is applied: you decide.')}</p>
      </div>}
    </div>
  </div>
}

/* ------------------------------------------------------------------ check-in / history / notes */
function Checkin({ view }) {
  const c = view.checkin
  if (!c.shared) return <p className="small dim"><Icon name="lock" /> {t('The member does not share check-ins. They are private unless they turn it on in their settings.')}</p>
  return c.count ? <>
    <ul className="cf-list">
      <li><span>{t('Energy')}</span><b>{fmtNum(c.avg.energy ?? 0)}/5</b></li><li><span>{t('Sleep')}</span><b>{fmtNum(c.avg.sleep ?? 0)}/5</b></li><li><span>{t('Fatigue')}</span><b>{fmtNum(c.avg.fatigue ?? 0)}/5</b></li>
      <li><span>{t('High fatigue in 14 days')}</span><b>{c.highFatigue14}</b></li>
    </ul>
    {c.pain14.length > 0 && <div className="cf-chips">{c.pain14.map(p => <Chip key={p.zone}>{t(PAIN_ZONE[p.zone]?.label || p.zone)} · {p.n}</Chip>)}</div>}
  </> : <p className="small dim">{t('No check-ins in the last 14 days.')}</p>
}

function Timeline({ items }) {
  if (!items.length) return <p className="small dim">{t('Decisions and reviews will appear here.')}</p>
  return <ol className="cf-tl">{items.map((e, i) => <li key={i}>
    <span className="d">{fmtDate(e.d)}</span>
    <span className="b"><b>{cf.eventLabel(e.kind)}</b>{e.ref?.name && <small> · {e.ref.name}</small>}{e.by && <small className="dim"> · {e.by}</small>}{e.text && <span className="x">{e.text}</span>}</span>
  </li>)}</ol>
}

function Notes({ d, id, draft, setDraft, notesRef, reload, admin }) {
  const toast = useUI(s => s.toast)
  const [busy, setBusy] = useState(false)
  const [ref, setRef] = useState('')
  const pending = (d.routineCycles || []).filter(c => !c.reviewed)
  const add = () => {
    if (busy || !draft.trim()) return
    setBusy(true)
    const r = ref ? { kind: ref.split(':')[0], id: ref.split(':')[1] } : null
    cf.saveNote(id, draft, r).then(() => { setDraft(''); toast(t('Note saved')); return reload() }).catch(e => toast(e.message)).finally(() => setBusy(false))
  }
  const del = n => cf.removeNote(id, n.id).then(() => { toast(t('Note deleted')); return reload() }).catch(e => toast(e.message))
  if (!d.followUp) return <p className="small dim">{t('Start the follow-up to keep notes.')}</p>
  if (!d.privateAvailable) return <p className="small dim">{t('Saved notes could not be read; they were kept unchanged.')}</p>
  return <div ref={notesRef}>
    <p className="small dim cf-priv"><Icon name="lock" /> {t('Only staff with access see these notes. They are never shared with the member, the AI, Community or exports.')}</p>
    <TextArea aria-label={t('New note')} rows={3} maxLength={1000} value={draft} onChange={e => setDraft(e.target.value)} placeholder={t('What happened, what was agreed…')} />
    <div className="cf-note-bar">
      {pending.length > 0 && <select className="input" aria-label={t('Link to a review')} value={ref} onChange={e => setRef(e.target.value)}>
        <option value="">{t('Not linked to a review')}</option>{pending.map(c => <option key={c.kind + (c.programId || c.routineId)} value={(c.kind === 'program' ? 'program:' + c.programId : 'routine:' + c.routineId)}>{c.name}</option>)}</select>}
      <span className="dim small">{draft.length}/1000</span>
      <Button size="sm" variant="tinted" icon="plus" disabled={busy || !draft.trim()} onClick={add}>{t('Add note')}</Button>
    </div>
    {d.legacyNote && <div className="cf-note legacy"><div className="meta">{t('General note')}</div><p>{d.legacyNote}</p></div>}
    {d.notes.map(n => <div key={n.id} className="cf-note"><div className="meta">{fmtDate(n.at.slice(0, 10))}{n.by && ' · ' + n.by}{n.ref && ' · ' + t(n.ref.kind === 'program' ? 'Program review' : 'Routine review')}
      {(n.mine || admin) && <button type="button" className="v3-link" onClick={() => del(n)}>{t('Delete')}</button>}</div><p>{n.text}</p></div>)}
  </div>
}

/* ------------------------------------------------------------------ page */
/** The whole sheet from already-loaded data (pure of fetching, so it renders the same in tests). */
export function MemberView({ d, plan = null, id, back, reload = () => {}, setData = () => {} }) {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const [draft, setDraft] = useState('')
  const notesRef = useRef(null)
  const view = d.view, a = view.adherence, p = view.progress
  const pendingReview = (d.routineCycles || []).some(c => !c.reviewed && ['due', 'overdue', 'early'].includes(c.status))
  return <div className="cf-wrap cf-member">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav(back)} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1>{t('Follow-up')}</h1><div className="sub">{d.member.disabled ? t('Account disabled') : t('Summary, progress and decisions')}</div></div>
    </div>
    <Summary d={d} id={id} nav={nav} reload={reload} admin={!!user?.admin} />
    <Acc title={t('Now')} icon="bolt" open><Now view={view} /></Acc>
    <Acc title={t('Progress')} icon="chartLine" hint={t(cf.PROGRESSION_TEXT[p.progression.status])}><Progress view={view} /></Acc>
    <Acc title={t('Adherence')} icon="calendar" hint={a.d28.pct != null ? a.d28.pct + '%' : a.d28.full + a.d28.partial ? t('{0} sessions', a.d28.full + a.d28.partial) : null}><Adherence view={view} /></Acc>
    <Acc id="cf-review" title={t('Review cycle')} icon="clipboard" open={pendingReview} hint={view.review.next ? fmtDate(view.review.next) : null}>
      <ReviewBrief d={d} plan={plan} id={id} nav={nav} />
      {(d.routineCycles || []).length > 0 ? <RoutineCycles id={id} cycles={d.routineCycles} sync={d.sync} setData={setData} reload={reload} plan={plan} /> : <p className="small dim">{t('No routine or program cycle to review yet.')}</p>}
      {(d.routineCycles || []).some(c => c.reviewed) && <ul className="cf-list">{d.routineCycles.filter(c => c.reviewed).map(c => <li key={(c.programId || c.routineId) + 'q'}><span>{c.name} · {t('Reviewed')}</span><b>{t('Next review')}: {fmtDate(c.nextReviewAt || c.dueDate)}</b></li>)}</ul>}
      {view.review.measurement?.next && <p className="small dim">{t('Next measurement review')}: {fmtDate(view.review.measurement.next)}</p>}
    </Acc>
    <Acc title={t('2J analysis')} icon="sparkles" open><Analysis d={d} plan={plan} id={id} nav={nav} notesRef={notesRef} setDraft={setDraft} reload={reload} /></Acc>
    <Acc title={t('Check-in')} icon="heart"><Checkin view={view} /></Acc>
    <Acc title={t('Professional history')} icon="history" count={d.timeline.length || null}><Timeline items={d.timeline} /></Acc>
    <Acc title={t('Notes')} icon="pencil" count={d.notes.length || null}><Notes d={d} id={id} draft={draft} setDraft={setDraft} notesRef={notesRef} reload={reload} admin={!!user?.admin} /></Acc>
  </div>
}

function Shell({ back, children }) {
  const nav = useNavigate()
  return <div className="cf-wrap"><div className="hdr"><button className="iconbtn" onClick={() => nav(back)} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
    <div style={{ flex: 1, marginLeft: 8 }}><h1>{t('Follow-up')}</h1></div></div>{children}</div>
}

export default function CoachMember({ back }) {
  const { id } = useParams()
  const toast = useUI(s => s.toast)
  const [d, setD] = useState(null)
  const [plan, setPlan] = useState(null)
  const [failed, setFailed] = useState(false)
  const load = () => cf.fetchMember(id).catch(e => { setFailed(true); toast(e.message || t('Failed to load')); throw e })
  const reload = () => load().then(setD)
  useEffect(() => { setD(null); setFailed(false); load().then(setD).catch(() => {}); fetchMemberPlan(id).then(setPlan).catch(() => setPlan(null)) }, [id])
  if (failed) return <Shell back={back}><p className="small dim">{t('This member is not available to you.')}</p></Shell>
  if (!d) return <Shell back={back}><Skeleton height={160} /></Shell>
  return <MemberView d={d} plan={plan} id={id} back={back} reload={reload} setData={setD} />
}
