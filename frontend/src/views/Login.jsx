import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { webauthnOK, passkeyLogin, passkeyRegister, passkeyRecover, api, BIO } from '../lib/api.js'
import { hasData } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { DEMO } from '../lib/demo.js'
import { useState, useRef, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'

/* An admin-issued recovery link (?token=...) lands here instead of the normal sign-in/register
   choice — a member who lost their only device gets one screen with one job: register a new
   passkey onto their existing account. See api/server.js's /api/recover/* for the full picture. */
function RecoverCard({ token }) {
  const { setUser, pullState } = useStore()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const go = async () => {
    setBusy(true)
    try {
      const u = await passkeyRecover(token)
      setUser(u)
      await pullState()
      useUI.getState().toast(t('Welcome back, {0}', u.name))
    } catch (e) {
      if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') { setFailed(true); useUI.getState().toast(e.message || t('Could not recover this account')) }
      setBusy(false)
    }
  }
  return <>
    <div className="muted" style={{ marginBottom: 10 }}>{t('Recover your account')}</div>
    <div className="card small muted" style={{ textAlign: 'left', marginBottom: 20, lineHeight: 1.5 }}>
      {t('Staff gave you this link because your old device is gone. Confirming below adds a brand-new passkey to your existing profile — your plan, history and body weight all stay exactly as they were.')}
    </div>
    <Button variant="primary" icon="sparkles" disabled={busy} onClick={go}>{t('Create new passkey')}</Button>
    {failed && <div className="dim small" style={{ marginTop: 16 }}>{t('This link may have expired — ask staff to generate a new one.')}</div>}
  </>
}

function RegisterSheet({ close }) {
  const { setUser, pushState, pullState } = useStore()
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [inviteOnly, setInviteOnly] = useState(false)
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
      close()
      // Basic profile (sex/age/height/starting weight/priorities) is asked right after this, in
      // App.jsx's Shell — the "Physical Profile" wizard — rather than crammed into this same
      // sheet before the passkey even exists.
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
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={go}>{t('Create passkey')}</Button>
  </>
}

export default function Login() {
  const { setUser, pullState, setGuest } = useStore()
  const [params] = useSearchParams()
  const recoveryToken = params.get('token')
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
    </div>
  )

  if (recoveryToken) return (
    <div className="narrow" style={wrap}>
      {head}
      <RecoverCard token={recoveryToken} />
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
