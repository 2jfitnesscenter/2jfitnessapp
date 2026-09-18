import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useUI } from '../../store/useUI.js'
import { t } from '../../lib/i18n.js'
import { DAYN } from '../../lib/format.js'
import { EXDB } from '../../lib/exercises.js'
import { requestMemberPlan, discardMemberPlan, useTrainerAIStatus, TRAINER_AI_ERRORS } from '../../lib/trainer-ai-api.js'
import { Button, TextArea, Segmented } from '../../components/ui.jsx'
import PlanReviewCard from './PlanReviewCard.jsx'
import Topbar from './Topbar.jsx'

// Same 6 goals as CoachIntake.jsx / api/coach/prompts/create.md's goal table — kept in sync by
// hand since the two runtimes share no build step (same trade-off payload.js documents for its
// own duplicated helpers).
const GOALS = [
  ['hypertrophy', 'Build muscle'], ['toning', 'Tone up'], ['fatloss', 'Lose fat'],
  ['power', 'Power'], ['plyometrics', 'Plyometrics'], ['longevity', 'Health & longevity'],
  ['padel', 'Padel performance'], ['basketball', 'Basketball performance'], ['examfitness', 'Physical exam prep']
]
const EXPERIENCE = [['new', 'New to lifting'], ['returning', 'Coming back after a break'], ['regular', 'Training regularly']]
const SESSION_MIN = [30, 45, 60, 75, 90]
const EQUIPMENT = (() => {
  const count = {}
  EXDB.forEach(e => { if (e.eq) count[e.eq] = (count[e.eq] || 0) + 1 })
  return Object.keys(count).sort((a, b) => count[b] - count[a]).slice(0, 14)
})()

const emptyBrief = () => ({
  goal: null, experience: null, daysPerWeek: 3, preferredDays: [1, 3, 5],
  sessionMin: 45, equipment: [], limitations: '', likes: '', dislikes: '', notes: ''
})

export default function TrainerAIGenerate() {
  const nav = useNavigate()
  const { memberId } = useParams()
  const toast = useUI(s => s.toast)
  const { job, pending, errorClass, refresh } = useTrainerAIStatus(memberId)
  const [brief, setBrief] = useState(emptyBrief)
  const [busy, setBusy] = useState(false)
  const set = patch => setBrief(v => ({ ...v, ...patch }))

  const generate = async () => {
    setBusy(true)
    try {
      await requestMemberPlan(memberId, brief)
      toast(t('Generating…'))
      await refresh()
    } catch (e) { toast(e.message || t('Could not start')) }
    setBusy(false)
  }
  const discard = async () => {
    try { await discardMemberPlan(memberId) } catch { /* stale draft — fine to drop client-side */ }
    await refresh()
  }

  const back = () => nav('/trainer/' + memberId)

  if (job) return <div id="trainer-app">
    <Topbar title={t('Generating…')} onBack={back} />
    <div className="card" style={{ textAlign: 'center', padding: '40px 20px' }}>
      <div className="muted small">{t('The AI is drafting routines for this member — this can take a minute or two.')}</div>
    </div>
  </div>

  if (pending) return <PlanReviewCard memberId={memberId} bundle={pending.bundle} onBack={back} onDiscard={discard} onSaved={discard} />

  return <div id="trainer-app">
    <Topbar title={t('Generate with AI')} onBack={back} />
    {errorClass && <div className="card" style={{ borderColor: 'var(--red)', marginBottom: 14 }}>
      <div className="small" style={{ color: 'var(--red)' }}>{t(TRAINER_AI_ERRORS[errorClass] || 'Something went wrong.')}</div>
    </div>}

    <div className="card">
      <h4 className="sec" style={{ marginTop: 0 }}>{t('Goal')}</h4>
      <div className="row" style={{ flexWrap: 'wrap', gap: 7, marginBottom: 14 }}>
        {GOALS.map(([v, label]) => <button key={v} className={'chip' + (brief.goal === v ? ' on' : '')} onClick={() => set({ goal: v })}>{t(label)}</button>)}
      </div>

      <h4 className="sec">{t('Experience')}</h4>
      <div className="row" style={{ flexWrap: 'wrap', gap: 7, marginBottom: 14 }}>
        {EXPERIENCE.map(([v, label]) => <button key={v} className={'chip' + (brief.experience === v ? ' on' : '')} onClick={() => set({ experience: v })}>{t(label)}</button>)}
      </div>

      <div className="row" style={{ gap: 20, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <h4 className="sec">{t('Days per week')}</h4>
          <Segmented options={[2, 3, 4, 5, 6].map(n => ({ value: n, label: String(n) }))} value={brief.daysPerWeek} onChange={v => set({ daysPerWeek: v })} />
        </div>
        <div>
          <h4 className="sec">{t('Session length')}</h4>
          <Segmented options={SESSION_MIN.map(n => ({ value: n, label: n + ' ' + t('min') }))} value={brief.sessionMin} onChange={v => set({ sessionMin: v })} />
        </div>
      </div>

      <h4 className="sec">{t('Which days? (optional)')}</h4>
      <div className="row" style={{ flexWrap: 'wrap', gap: 7, marginBottom: 14 }}>
        {[1, 2, 3, 4, 5, 6, 0].map(d => <button key={d} className={'chip' + (brief.preferredDays.includes(d) ? ' on' : '')}
          onClick={() => set({ preferredDays: brief.preferredDays.includes(d) ? brief.preferredDays.filter(x => x !== d) : [...brief.preferredDays, d].sort() })}>
          {t(DAYN[d])}
        </button>)}
      </div>

      <h4 className="sec">{t('Equipment (optional — leave empty for the whole library)')}</h4>
      <div className="row" style={{ flexWrap: 'wrap', gap: 7, marginBottom: 14 }}>
        {EQUIPMENT.map(e => <button key={e} className={'chip' + (brief.equipment.includes(e) ? ' on' : '')} style={{ textTransform: 'capitalize' }}
          onClick={() => set({ equipment: brief.equipment.includes(e) ? brief.equipment.filter(x => x !== e) : [...brief.equipment, e] })}>{t(e)}</button>)}
      </div>

      <h4 className="sec">{t('Anything to work around?')}</h4>
      <TextArea rows={2} maxLength={600} value={brief.limitations} onChange={e => set({ limitations: e.target.value })}
        placeholder={t('e.g. “dodgy left shoulder — no barbell overhead press”')} />

      <h4 className="sec">{t('Notes for the AI')}</h4>
      <TextArea rows={3} maxLength={600} value={brief.notes} onChange={e => set({ notes: e.target.value })}
        placeholder={t('Anything else the AI should know about this member')} />
    </div>

    <Button variant="primary" icon="sparkles" disabled={busy || !brief.goal || !brief.experience} onClick={generate}>
      {t('Generate routines')}
    </Button>
  </div>
}
