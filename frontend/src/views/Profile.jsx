import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { streakWeeks } from '../lib/history.js'
import { fmtDate, todayISO } from '../lib/format.js'
import { MUSCLES, MUSCLE_LABEL } from '../lib/muscle-priority.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { Section, Row } from '../components/ui.jsx'

function initials(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase()
}

export default function Profile() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const { update } = useStore()

  return <div className="narrow">
    <div className="hdr"><div><h1>{t('Profile')}</h1></div></div>

    <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <div style={{
        width: 56, height: 56, borderRadius: '50%', flex: 'none',
        background: 'var(--acc)', color: 'var(--on-acc)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 22, fontWeight: 600,
      }}>{initials(user?.name)}</div>
      <div style={{ minWidth: 0 }}>
        <div className="capitalize" style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-.012em' }}>{user?.name || t('Guest')}</div>
        {user?.created && <div className="dim small">{t('joined {0}', fmtDate(user.created.slice(0, 10)))}</div>}
      </div>
    </div>

    <div className="tiles">
      <div className="tile"><div className="l"><Icon name="dumbbell" />{t('Workouts')}</div><div className="v">{S.workouts.length}</div></div>
      <div className="tile"><div className="l"><Icon name="flame" />{t('Week streak')}</div><div className="v">{streakWeeks(S)}</div></div>
    </div>

    {/* ---------- basic info — asked at registration, editable here, read by the AI Coach ---------- */}
    <Section title={t('Basic info')} footer={t('Sex uses the Body diagram choice in Settings. Starting weight is your first body-weight log — add or edit it from Home.')}>
      <Row icon="calendar" iconTint="var(--pink)" title={t('Date of birth')}>
        <input type="date" className="timef" value={S.birthDate || ''} max={todayISO()}
          onChange={e => update(s => { s.birthDate = e.target.value || null })} />
      </Row>
      <Row icon="expand" iconTint="var(--mint)" title={t('Height')}>
        <input type="number" inputMode="decimal" className="timef" style={{ width: 56, textAlign: 'right' }} min="0" max="250"
          value={S.height ?? ''} onChange={e => update(s => { const n = Math.round(Number(e.target.value)); s.height = n > 0 ? n : null })} />
        <span className="muted small" style={{ marginLeft: 6 }}>cm</span>
      </Row>
      <Row icon="figureStrength" iconTint="var(--acc)" title={t('Measurements')} subtitle={t('Body composition & tape measurements over time')} accessory="chevron" onClick={() => nav('/measurements')} />
    </Section>

    {/* ---------- muscle priorities — asked at registration, editable here, read by the quick
         PPL plan and the AI Coach ---------- */}
    <Section title={t('Training priorities')} footer={t('Optional. The quick plan and the AI Coach give these a little more work than the rest.')}>
      <div style={{ padding: '2px 16px 4px' }}>
        <div className="dim small" style={{ marginBottom: 6 }}>{t('What do you want to prioritize? (up to 2)')}</div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 7 }}>
          {MUSCLES.map(m => <button key={m} className={'chip' + ((S.priorityMuscles || []).includes(m) ? ' on' : '')}
            onClick={() => update(s => {
              const v = s.priorityMuscles || []
              s.priorityMuscles = v.includes(m) ? v.filter(x => x !== m) : v.length < 2 ? [...v, m] : v
              s.secondaryMuscles = (s.secondaryMuscles || []).filter(x => x !== m)
            })}>{t(MUSCLE_LABEL[m])}</button>)}
        </div>
        <div className="dim small" style={{ margin: '12px 0 6px' }}>{t('Anything else? (up to 3)')}</div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 7 }}>
          {MUSCLES.map(m => {
            const isPrimary = (S.priorityMuscles || []).includes(m)
            return <button key={m} className={'chip' + ((S.secondaryMuscles || []).includes(m) ? ' on' : '')}
              disabled={isPrimary} style={isPrimary ? { opacity: .35 } : undefined}
              onClick={() => update(s => {
                const v = s.secondaryMuscles || []
                s.secondaryMuscles = v.includes(m) ? v.filter(x => x !== m) : v.length < 3 ? [...v, m] : v
                s.priorityMuscles = (s.priorityMuscles || []).filter(x => x !== m)
              })}>{t(MUSCLE_LABEL[m])}</button>
          })}
        </div>
      </div>
    </Section>

    <div style={{ height: 20 }} />
  </div>
}
