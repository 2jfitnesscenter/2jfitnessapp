import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useUI } from '../../store/useUI.js'
import { t } from '../../lib/i18n.js'
import { DAYN } from '../../lib/format.js'
import { EXDB } from '../../lib/exercises.js'
import { exLine } from '../../lib/history.js'
import { exName } from '../../lib/coach.js'
import { requestMemberPlan, discardMemberPlan, useTrainerAIStatus, TRAINER_AI_ERRORS } from '../../lib/trainer-ai-api.js'
import { saveMemberRoutine, saveMemberProgram } from '../../lib/trainer-api.js'
import Icon from '../../components/Icon.jsx'
import { Button, TextArea, Segmented, Check, Switch } from '../../components/ui.jsx'

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

  if (pending) return <ReviewDraft memberId={memberId} pending={pending} onDiscard={discard} onBack={back} />

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

function ReviewDraft({ memberId, pending, onDiscard, onBack }) {
  const toast = useUI(s => s.toast)
  const b = pending.bundle
  const [included, setIncluded] = useState(() => new Set(b.routines.map(r => r.id)))
  const [schedule, setSchedule] = useState(Object.keys(b.week || {}).length > 0)
  const [saving, setSaving] = useState(false)
  const toggle = id => setIncluded(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const save = async () => {
    const picked = b.routines.filter(r => included.has(r.id))
    if (!picked.length) { toast(t('Pick at least one routine')); return }
    setSaving(true)
    try {
      const idMap = {}
      for (const r of picked) {
        const customExDefs = (b.customEx || []).filter(c => r.ex.some(e => e.id === c.id))
        const res = await saveMemberRoutine({ memberId, name: r.name, emoji: r.emoji, ex: r.ex, customExDefs, prog: r.prog })
        idMap[r.id] = res.routineId
      }
      if (schedule && picked.length > 1) {
        const week = {}
        Object.entries(b.week || {}).forEach(([d, rid]) => { if (idMap[rid]) week[d] = idMap[rid] })
        if (Object.keys(week).length) {
          await saveMemberProgram({ memberId, name: b.name, emoji: 'sparkles', routineIds: Object.values(idMap), week })
        }
      }
      await onDiscard()
      toast(t('Saved'))
      window.location.hash = '#/trainer/' + memberId
    } catch (e) { toast(e.message || t('Could not save')) }
    setSaving(false)
  }

  return <div id="trainer-app">
    <Topbar title={t('Review the draft')} onBack={onBack} />

    {!!b.summary && <div className="card"><div className="muted small" style={{ lineHeight: 1.55 }}>{b.summary}</div>
      {!!b.basedOn && <div className="dim small" style={{ marginTop: 8 }}>{b.basedOn}</div>}</div>}

    {b.routines.map(r => <div key={r.id} className="card" style={!included.has(r.id) ? { opacity: .5 } : undefined}>
      <div className="row between" style={{ marginBottom: 4 }}>
        <div className="row" style={{ gap: 10 }}>
          <Check checked={included.has(r.id)} onChange={() => toggle(r.id)} />
          <h2 style={{ margin: 0 }}>{r.emoji} {r.name}</h2>
        </div>
        <span className="dim small">{t('{0} exercises', r.ex.length)}</span>
      </div>
      {!!r.why && <div className="dim small" style={{ marginBottom: 10, lineHeight: 1.5 }}>{r.why}</div>}
      {r.ex.map((e, i) => <div key={i} style={{ padding: '8px 0', borderTop: i ? '1px solid var(--sep)' : 'none' }}>
        <div className="row between">
          <span className="small capitalize" style={{ fontWeight: 500 }}>{exName(e.id)}</span>
          <span className="small muted" style={{ whiteSpace: 'nowrap' }}>{exLine(e, 'kg')}</span>
        </div>
        {!!e.why && <div className="dim" style={{ fontSize: '.72rem', marginTop: 3, lineHeight: 1.4 }}>{e.why}</div>}
      </div>)}
    </div>)}

    {Object.keys(b.week || {}).length > 0 && <div className="card">
      <div className="row between">
        <div style={{ minWidth: 0 }}>
          <div className="lrow-t">{t('Group into a scheduled program')}</div>
          <div className="lrow-s">{t('Groups the included routines into a new program with the AI’s suggested weekly schedule.')}</div>
        </div>
        <Switch checked={schedule} onChange={setSchedule} />
      </div>
    </div>}

    <div className="row" style={{ gap: 10 }}>
      <Button variant="primary" icon="check" disabled={saving} onClick={save} style={{ flex: 1 }}>{t('Save selected')}</Button>
      <Button danger disabled={saving} onClick={onDiscard}>{t('Discard')}</Button>
    </div>
  </div>
}

function Topbar({ title, onBack }) {
  return <div className="trainer-topbar">
    <div style={{ flex: 1 }}><h1>{title}</h1></div>
    <a className="trainer-back" href="#" onClick={e => { e.preventDefault(); onBack() }}><Icon name="chevronLeft" />{t('Back')}</a>
  </div>
}
