import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useUI } from '../../store/useUI.js'
import { t } from '../../lib/i18n.js'
import { exCount, routineCount } from '../../lib/format.js'
import { glyphOf } from '../../lib/glyphs.js'
import { fetchMemberPlan, fetchTrainerMembers } from '../../lib/trainer-api.js'
import { mediaUrl } from '../../lib/media.js'
import { Button } from '../../components/ui.jsx'
import Icon from '../../components/Icon.jsx'

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

  const load = () => {
    fetchMemberPlan(memberId).then(setPlan).catch(e => toast(e.message))
    fetchTrainerMembers().then(list => setMember(list.find(m => m.id === memberId) || null)).catch(() => {})
  }
  useEffect(load, [memberId])

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

    <div className="row" style={{ gap: 8, marginBottom: 20 }}>
      <Button icon="plus" onClick={() => nav('/trainer/' + memberId + '/r/new')}>{t('New routine')}</Button>
      <Button icon="plus" variant="tinted" onClick={() => nav('/trainer/' + memberId + '/p/new')}>{t('New program')}</Button>
      <Button icon="sparkles" variant="tinted" onClick={() => nav('/trainer/' + memberId + '/ai')}>{t('Generate with AI')}</Button>
      <Button icon="scan" variant="tinted" onClick={() => nav('/trainer/' + memberId + '/scan')}>{t('Scan a routine')}</Button>
    </div>

    <h4 className="sec">{t('Programs')}</h4>
    {(plan.programs || []).length ? <div className="list" style={{ marginBottom: 22 }}>
      {plan.programs.map(p => <div key={p.id} className="item" onClick={() => nav('/trainer/' + memberId + '/p/' + p.id)}>
        {p.image ? <img src={mediaUrl(p.image)} alt="" style={{ width: 44, height: 44, borderRadius: 12, objectFit: 'cover', flex: 'none' }} />
          : <span className="lrow-i"><Icon name={glyphOf(p.emoji)} /></span>}
        <div className="grow"><div className="tt">{p.name}</div><div className="ss">{routineCount((p.routineIds || []).length)}</div></div>
        <Icon name="chevronRight" className="chev" />
      </div>)}
    </div> : <div className="dim small" style={{ margin: '4px 2px 22px' }}>{t('No programs yet.')}</div>}

    <h4 className="sec">{t('Routines')}</h4>
    {loose.length ? <div className="list">
      {loose.map(r => <div key={r.id} className="item" onClick={() => nav('/trainer/' + memberId + '/r/' + r.id)}>
        {r.image ? <img src={mediaUrl(r.image)} alt="" style={{ width: 44, height: 44, borderRadius: 12, objectFit: 'cover', flex: 'none' }} />
          : <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>}
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount((r.ex || []).length)}</div></div>
        <Icon name="chevronRight" className="chev" />
      </div>)}
    </div> : <div className="dim small" style={{ margin: '4px 2px' }}>{t('No loose routines.')}</div>}
  </div>
}
