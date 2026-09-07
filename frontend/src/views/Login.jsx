import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { webauthnOK, passkeyLogin, passkeyRegister, api, BIO } from '../lib/api.js'
import { hasData } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { DEMO, REPO } from '../lib/demo.js'
import { todayISO } from '../lib/format.js'
import { useState, useRef, useEffect } from 'react'
import Icon from '../components/Icon.jsx'
import { Button, Segmented } from '../components/ui.jsx'

function RegisterSheet({ close }) {
  const { setUser, pushState, pullState, update } = useStore()
  const S = useStore(s => s.S)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [inviteOnly, setInviteOnly] = useState(false)
  // Basic profile — all optional, none of this can block account creation. Feeds the AI Coach
  // (age/sex/height) and, for weight, becomes the first entry of the existing weigh-in history
  // rather than a separate field (see go() below).
  const [birthDate, setBirthDate] = useState('')
  const [sex, setSex] = useState(S.body === 'female' ? 'female' : 'male')
  const [height, setHeight] = useState('')
  const [weight, setWeight] = useState('')
  const ref = useRef(null)
  useEffect(() => { setTimeout(() => ref.current?.focus(), 250) }, [])
  useEffect(() => { api('/api/config').then(c => setInviteOnly(!!c.invite_only)).catch(() => {}) }, [])
  const go = async () => {
    const n = name.trim()
    if (!n) { useUI.getState().toast(t('Enter a name')); return }
    if (inviteOnly && !code.trim()) { useUI.getState().toast(t('An invite code is required')); return }
    try {
      const u = await passkeyRegister(n, code.trim())
      setUser(u)
      const h = Math.round(Number(height))
      const w = Math.round((Number(weight) || 0) * 10) / 10
      if (birthDate || sex !== S.body || h > 0 || w > 0) {
        update(s => {
          s.body = sex
          if (birthDate) s.birthDate = birthDate
          if (h > 0) s.height = h
          if (w > 0) {
            const iso = todayISO()
            const ex = s.bodyweight.find(b => b.d === iso)
            if (ex) { ex.w = w; ex.t = Date.now() } else s.bodyweight.push({ d: iso, w, t: Date.now() })
            s.bodyweight.sort((a, b) => (a.d < b.d ? -1 : 1))
          }
        })
      }
      close()
      if (hasData(useStore.getState().S)) { await pushState(); useUI.getState().toast(t('Profile created — data from this device moved into it')) }
      else { await pullState(); useUI.getState().toast(t('Welcome, {0}', u.name)) }
    } catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') useUI.getState().toast(e.message || t('Registration failed')) }
  }
  return <>
    <h3>{t('Create your profile')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Pick a name, then confirm with {0}. The passkey is saved in your device — no password needed.', t(BIO))}</div>
    <input ref={ref} className="input" placeholder={t('Your name')} maxLength={40} value={name} onChange={e => setName(e.target.value)} />
    {inviteOnly && <>
      <div style={{ height: 10 }} />
      <input className="input" placeholder={t('Invite code')} maxLength={40} value={code}
        onChange={e => setCode(e.target.value.toUpperCase())} style={{ letterSpacing: '.14em', fontWeight: 600, textAlign: 'center' }} />
      <div className="dim small" style={{ marginTop: 6 }}>{t('This app is invite-only — enter the code you were given.')}</div>
    </>}

    <div className="divider" />
    <div className="dim small" style={{ marginBottom: 10 }}>{t('Optional, and you can change it later in Settings — helps the AI Coach tailor your plan.')}</div>
    <div className="dim small" style={{ marginBottom: 4 }}>{t('Date of birth')}</div>
    <input type="date" className="input" value={birthDate} max={todayISO()} onChange={e => setBirthDate(e.target.value)} />
    <div style={{ height: 10 }} />
    <div className="dim small" style={{ marginBottom: 4 }}>{t('Sex')}</div>
    <Segmented options={[{ value: 'male', label: t('Male') }, { value: 'female', label: t('Female') }]} value={sex} onChange={setSex} />
    <div style={{ height: 10 }} />
    <div className="grid2">
      <div>
        <div className="dim small" style={{ marginBottom: 4 }}>{t('Height (cm)')}</div>
        <input type="number" inputMode="decimal" className="input" placeholder="175" min="0" max="250" value={height} onChange={e => setHeight(e.target.value)} />
      </div>
      <div>
        <div className="dim small" style={{ marginBottom: 4 }}>{t('Starting weight ({0})', S.unit)}</div>
        <input type="number" inputMode="decimal" className="input" placeholder="78" min="0" max="400" step="0.1" value={weight} onChange={e => setWeight(e.target.value)} />
      </div>
    </div>

    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={go}>{t('Create passkey')}</Button>
  </>
}

export default function Login() {
  const { setUser, pullState, setGuest } = useStore()
  const signIn = async () => {
    try { const u = await passkeyLogin(); setUser(u); await pullState(); useUI.getState().toast(t('Welcome back, {0}', u.name)) }
    catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') useUI.getState().toast(e.message || t('Sign-in failed')) }
  }
  const head = <>
    <div style={{ display: 'flex', justifyContent: 'center', margin: '10px 0 4px' }}>
      <img src="/brand/logo-full.png" alt="2J Fitness Center" style={{ width: '100%', maxWidth: 280, height: 'auto' }} />
    </div>
  </>
  const wrap = { display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '78vh', textAlign: 'center' }

  // Demo build: no backend to sign in against — the only way in is the local guest profile.
  if (DEMO) return (
    <div className="narrow" style={wrap}>
      {head}
      <div className="muted" style={{ marginBottom: 30 }}>{t('Live demo — everything stays in this browser.')}</div>
      <Button variant="primary" icon="sparkles" onClick={() => setGuest(true)}>{t('Start the demo')}</Button>
      <div className="card small muted" style={{ textAlign: 'left', marginTop: 16 }}>
        {t('This demo runs entirely in your browser on example data — nothing is sent anywhere. Passkey sign-in and sync across your devices come with the 2J Fitness Center server, which you get by self-hosting it.')}
      </div>
      <div className="dim small" style={{ marginTop: 22, lineHeight: 1.6 }}>
        <a href={REPO} target="_blank" rel="noopener">{t('Self-host it in a minute →')}</a>
      </div>
    </div>
  )

  return (
    <div className="narrow" style={wrap}>
      {head}
      <div className="muted" style={{ marginBottom: 34 }}>{t('Your workouts. Your weights. Your profile.')}</div>
      {webauthnOK() ? <>
        <Button variant="primary" icon="person" onClick={signIn}>{t('Sign in with passkey')}</Button>
        <div style={{ height: 10 }} />
        <Button icon="sparkles" onClick={() => useUI.getState().openSheet(close => <RegisterSheet close={close} />)}>{t('Create new profile')}</Button>
        <div style={{ height: 10 }} />
      </> : <div className="card small muted" style={{ textAlign: 'left' }}>{t("This browser doesn't support passkeys — you can still use 2J Fitness Center locally on this device.")}</div>}
      <Button variant="ghost" className="dim" onClick={() => setGuest(true)}>{t('Continue without account')}</Button>
      <div className="dim small" style={{ marginTop: 26, lineHeight: 1.5 }}>{t('Passkeys use {0} — no passwords.', t(BIO))}<br />{t('Each profile keeps its own plan, workouts & body weight.')}</div>
    </div>
  )
}
