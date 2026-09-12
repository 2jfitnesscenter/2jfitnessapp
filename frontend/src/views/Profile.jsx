import { useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore, hasData } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { streakWeeks } from '../lib/history.js'
import { fmtDate, todayISO } from '../lib/format.js'
import { webauthnOK, passkeyLogin, passkeyRegister } from '../lib/api.js'
import { DEMO } from '../lib/demo.js'
import { MOBILE } from '../lib/mobile.js'
import { MUSCLES, MUSCLE_LABEL } from '../lib/muscle-priority.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { Section, Row, Button, TextField } from '../components/ui.jsx'

function initials(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase()
}

export default function Profile() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const { update, setUser, pullState, pushState } = useStore()
  const toast = useUI(s => s.toast)

  const signInHere = async () => {
    try { const u = await passkeyLogin(); setUser(u); await pullState(); toast(t('Welcome back, {0}', u.name)) }
    catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast(e.message || t('Sign-in failed')) }
  }
  const registerHere = () => useUI.getState().openSheet(close => <RegisterInline close={close} setUser={setUser} pushState={pushState} pullState={pullState} toast={toast} />)

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

    {/* ---------- create/sign in — nothing to show once there's an account, or on the
         demo/mobile builds, which don't have passkey accounts at all ---------- */}
    {!MOBILE && !DEMO && !user && (
      <Section title={t('Account')}>
        {webauthnOK() ? <>
          <Row icon="sparkles" iconTint="var(--acc)" title={t('Create passkey profile')} subtitle={t('Keeps your data safe and separate per person.')} accessory="chevron" onClick={registerHere} />
          <Row icon="person" iconTint="var(--blue)" title={t('Sign in with passkey')} accessory="chevron" onClick={signInHere} />
        </> : (
          <Row icon="lock" iconTint="var(--grey)" title={t('Passkeys not supported in this browser.')} />
        )}
      </Section>
    )}
    {!user && !DEMO && !MOBILE && <p className="sect-f" style={{ marginTop: -18, marginBottom: 22 }}>{t('Guest mode — data lives only in this browser.')}</p>}

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

function RegisterInline({ close, setUser, pushState, pullState, toast }) {
  const nameRef = useRef(null)
  const go = async () => {
    const n = (nameRef.current.value || '').trim()
    if (!n) { toast(t('Enter a name')); return }
    try {
      const u = await passkeyRegister(n); setUser(u); close()
      if (hasData(useStore.getState().S)) { await pushState(); toast(t('Profile created — data moved into it')) }
      else { await pullState(); toast(t('Welcome, {0}', u.name)) }
    } catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast(e.message || t('Registration failed')) }
  }
  return <>
    <h3>{t('Create your profile')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Pick a name, then confirm with your device.')}</div>
    <TextField ref={nameRef} placeholder={t('Your name')} maxLength={40} />
    <div style={{ height: 12 }} /><Button variant="primary" onClick={go}>{t('Create passkey')}</Button>
  </>
}
