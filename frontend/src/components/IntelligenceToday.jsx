// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { intelligenceRecommendations } from '../lib/intelligence.js'
import { t, nameFor } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import { useGuided } from '../lib/guided-api.js'
import { EXIDX } from '../lib/exercises.js'
import { api } from '../lib/api.js'
import { hasConsent } from '../lib/coach.js'
import { useStore } from '../store/useStore.js'
import { DEMO } from '../lib/demo.js'
import { uxOn, helpsOn } from '../lib/features.js'
import './intelligence-today.css'

const icon = { PROGRAM_NEXT_SESSION: 'calendar', NEXT_SESSION: 'calendar', PROGRESSION_READY: 'chartLine', EQUIPMENT_CONFLICT: 'dumbbell', PR_RECENT: 'sparkles', CONTENT_SUGGESTION: 'sparkles',
  RETURN_AFTER_GAP: 'heart', PLATEAU: 'chart', LOAD_TOO_HIGH: 'target', MISSED_SESSION: 'calendar', ADHERENCE_GOOD: 'checkCircle' }
const read = (key, fallback) => { try { return localStorage.getItem(key) || fallback } catch { return fallback } }
const readHidden = key => { try { const value = JSON.parse(read(key, '{}')); return value && typeof value === 'object' && !Array.isArray(value) ? value : {} } catch { return {} } }
const write = (key, value) => { try { localStorage.setItem(key, value) } catch { /* optional local preference */ } }
const EMPTY_ROUTINES = []
const exerciseName = r => nameFor(EXIDX[r.relatedExerciseId]) || t('Exercise')
function display(r, S) {
  const f = r.facts
  switch (r.type) {
    case 'PROGRAM_NEXT_SESSION': return { title: t('Continue your program'), summary: t(r.summary),
      reason: t('Session {0} of {1} is next. Continue when you can; you do not need to catch up.', f.completed + 1, f.total), action: t('View program') }
    case 'NEXT_SESSION': return { title: t('Your session today'), summary: t(r.summary),
      reason: t('This routine is scheduled in your existing plan for today. Start when ready; nothing changed automatically.'), action: t('Open my plan') }
    case 'PROGRESSION_READY': return { title: t('{0}: ready to progress', exerciseName(r)), summary: t('Consider {0} {1} next time', f.next, S.unit || 'kg'),
      reason: t('You reached {0} reps in two sessions at {1} {2} without high effort or negative feedback. This is a real equipment increment.', f.max, f.weight, S.unit || 'kg'), action: t('Review in workout') }
    case 'LOAD_TOO_HIGH': return { title: t('Review {0}', exerciseName(r)), summary: t('Consider holding or adjusting your target'),
      reason: t('Two recent sessions included failure or high effort below the rep range. Nothing was changed.'), action: t('View history') }
    case 'PLATEAU': return { title: t('Review {0}', exerciseName(r)), summary: t('Three similar sessions'),
      reason: t('Your best load and reps stayed the same across three sessions. This is a training pattern, not a diagnosis.'), action: t('View progress') }
    case 'EQUIPMENT_CONFLICT': return { title: t('Equipment differs from your plan'), summary: t('{0} may not fit this training place', exerciseName(r)),
      reason: t('Your training place lacks the required equipment category. Your routine was not changed; review existing alternatives.'), action: t('Review alternatives') }
    case 'RETURN_AFTER_GAP': return { title: t('Welcome back to training'), summary: t('Resume at your own pace'),
      reason: t('Your last logged workout was {0} days ago. Your program and loads remain unchanged.', f.days), action: t('View your plan') }
    case 'MISSED_SESSION': return { title: t('Continue when ready'), summary: t('Your next program session is waiting'),
      reason: t('Your last workout was {0} days ago. Continue with the next session; no double session is needed.', f.days), action: t('View program') }
    case 'PR_RECENT': return { title: t('A recent best in {0}', exerciseName(r)), summary: t('Build on your progress'),
      reason: t('Your estimated best improved against your previous record. A PR alone does not require more load.'), action: t('View progress') }
    case 'ADHERENCE_GOOD': return { title: t('Good program consistency'), summary: t('{0} sessions this week', f.thisWeek),
      reason: t('Your completed workouts count toward your active program. Continue with the next planned session.'), action: t('View program') }
    case 'CONTENT_SUGGESTION': return { title: t('An official 2J session for you'), summary: t(r.summary),
      reason: t('This existing 2J routine fits your declared goal or level, restrictions and available equipment. Your plan did not change.'), action: t('View routine') }
    default: return { title: t(r.title), summary: t(r.summary), reason: t(r.reason), action: t(r.action.label) }
  }
}
const sourceLabel = source => ({ 'training-history': t('Training history'), 'active-program': t('Active program'),
  'active-plan': t('Active plan'), 'gym-profile': t('Training place'), 'official-2j-content': t('Official 2J content') })[source] || t(source)
const confidenceLabel = confidence => ({ high: t('High'), medium: t('Medium'), low: t('Low') })[confidence] || confidence
const priorityLabel = priority => ({ high: t('High priority'), medium: t('Medium priority'), low: t('Optional') })[priority] || priority
export const canAskCoach = (S, coachEnabled) => !!coachEnabled && hasConsent(S) && !DEMO

// Suggestions are a feature: gone when the admin turns them off or the member chose not to receive them; the first-use
// intro also respects the member's visual-hints choice. Wrapper first so no hook is skipped.
export default function IntelligenceToday(props) {
  const S = useStore(s => s.S)
  useStore(s => s.features)
  if (!uxOn(S, 'suggestions')) return null
  return <IntelligenceTodayInner {...props} showIntro={!!props.showIntro && helpsOn(S)} />
}

function IntelligenceTodayInner({ S, user, max = 3, compact = false, types = null, showIntro = false }) {
  const nav = useNavigate()
  const uid = user?.id || 'local'
  const introKey = `intelligence2j:intro:v1:${uid}`
  const hideKey = `intelligence2j:hidden:v1:${uid}`
  const [intro, setIntro] = useState(() => showIntro && read(introKey, '') !== 'done')
  const [hidden, setHidden] = useState(() => readHidden(hideKey))
  const [open, setOpen] = useState(null)
  const [explanations, setExplanations] = useState({})
  const coachEnabled = useStore(s => !!s.config?.coach?.enabled)
  const officialRoutines = useGuided(s => s.uid === uid ? s.routines : EMPTY_ROUTINES)
  const loadGuided = useGuided(s => s.load)
  useEffect(() => { if (showIntro && user?.id) loadGuided(user.id) }, [showIntro, user?.id, loadGuided])
  const recommendations = useMemo(() => intelligenceRecommendations(S, { max: 6, officialRoutines }),
    [S.workouts, S.programs, S.activeProgramId, S.gymProfiles, S.routines, S.dayPlan,
      S.active?.routineId, S.unit, S.enableProgressiveOverloadCoach, officialRoutines])
  const cards = recommendations.filter(r => (!types || types.includes(r.type)) && (!hidden[r.id] || hidden[r.id] < Date.now())).slice(0, max)
  const closeIntro = () => { write(introKey, 'done'); setIntro(false) }
  const dismiss = (id, forever) => {
    const next = { ...hidden, [id]: forever ? Number.MAX_SAFE_INTEGER : Date.now() + 7 * 86400000 }
    setHidden(next); write(hideKey, JSON.stringify(next))
  }
  const askCoach = async r => {
    setExplanations(prev => ({ ...prev, [r.id]: { loading: true } }))
    try {
      const allowed = ['days', 'sessions', 'weight', 'next', 'min', 'max', 'completed', 'total', 'thisWeek']
      const facts = Object.fromEntries(allowed.filter(k => typeof r.facts?.[k] === 'number').map(k => [k, r.facts[k]]))
      const result = await api('/api/coach/intelligence/explain', { method: 'POST', body: JSON.stringify({ type: r.type, facts }) })
      setExplanations(prev => ({ ...prev, [r.id]: result.ok ? { text: result.explanation } : { failed: true } }))
    } catch { setExplanations(prev => ({ ...prev, [r.id]: { failed: true } })) }
  }
  if (!cards.length && !intro && !showIntro) return null
  return <section className={'intelligence-today' + (compact ? ' compact' : '')} aria-label={t('For you today')}>
    <header><div><span className="intelligence-eyebrow">2J FITNESS CENTER</span><h2>{t('For you today')}</h2></div>
      <button className="iconbtn" type="button" aria-label={t('How Intelligence 2J works')} onClick={() => setIntro(true)}><Icon name="info" /></button></header>
    {intro && <div className="intelligence-intro" role="region" aria-label={t('How Intelligence 2J works')}>
      <b>{t('Your training, with context')}</b>
      <div className="intelligence-steps"><span>1 · {t('Learns from your workouts')}</span><span>2 · {t('Explains every suggestion')}</span><span>3 · {t('You always decide')}</span></div>
      <p>{t('2J suggests actions from your training history and plan. Nothing changes until you choose it.')}</p>
      <button className="btn primary" type="button" onClick={closeIntro}>{t('Got it')}</button>
    </div>}
    {!cards.length && !intro && <p className="intelligence-empty">{t('No suggestion today. Keep training at your own pace.')}</p>}
    <div className="intelligence-list">{cards.map(r => { const copy = display(r, S); return <article className="intelligence-card" key={r.id}>
      <span className="intelligence-icon"><Icon name={icon[r.type] || 'sparkles'} /></span>
      <div className="intelligence-body"><div className="intelligence-type">{t('2J suggestion')} · {priorityLabel(r.priority)}</div>
        <h3>{copy.title}</h3><p>{copy.summary}</p>
        <button className="intelligence-reason-toggle" type="button" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>{t('Why this suggestion?')} <Icon name="chevronRight" /></button>
        {open === r.id && <div className="intelligence-reason"><b>{t('Based on your training')}</b><p>{copy.reason}</p><small>{t('Source')}: {sourceLabel(r.source)} · {t('Confidence')}: {confidenceLabel(r.confidence)}</small>
          {canAskCoach(S, coachEnabled) && <div className="intelligence-explain">
            <button type="button" disabled={explanations[r.id]?.loading} onClick={() => askCoach(r)}>{t('Ask Coach to explain')}</button>
            {explanations[r.id]?.text && <p><b>{t('Coach adds context')}</b> · {explanations[r.id].text}</p>}
            {explanations[r.id]?.failed && <p>{t('Coach is unavailable. The original suggestion still stands.')}</p>}
          </div>}
        </div>}
        <div className="intelligence-actions"><button className="btn primary" type="button" onClick={() => nav(r.action.route)}>{copy.action}</button>
          <button className="btn plain" type="button" onClick={() => dismiss(r.id, false)}>{t('Not now')}</button>
          <button className="intelligence-never" type="button" onClick={() => dismiss(r.id, true)}>{t('Don’t suggest this again')}</button></div>
      </div></article> })}</div>
  </section>
}
