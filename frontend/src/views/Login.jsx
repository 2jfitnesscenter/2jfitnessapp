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
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [code, setCode] = useState('')
  const [inviteOnly, setInviteOnly] = useState(false)
  const ref = useRef(null)
  useEffect(() => { setTimeout(() => ref.current?.focus(), 250) }, [])
  useEffect(() => { api('/api/config').then(c => setInviteOnly(!!c.invite_only)).catch(() => {}) }, [])
  const go = async () => {
    const fn = firstName.trim(), ln = lastName.trim()
    if (!fn || !ln) { useUI.getState().toast(t('Enter your first and last name')); return }
    if (inviteOnly && !code.trim()) { useUI.getState().toast(t('An invite code is required')); return }
    const n = fn + ' ' + ln
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
    {/* First + last name (not one free-text field) so staff can always tell members with the
        same first name apart in the admin roster — the two are joined with a space into the
        single `name` the rest of the app already works with (display, admin search, the
        recovery flow's name match), so nothing downstream needed to change. */}
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Pick a name, then confirm with {0}. The passkey is saved in your device — no password needed.', t(BIO))}</div>
    <div className="row" style={{ gap: 10 }}>
      <input ref={ref} className="input" style={{ flex: 1 }} placeholder={t('First name')} maxLength={28} value={firstName} onChange={e => setFirstName(e.target.value)} />
      <input className="input" style={{ flex: 1 }} placeholder={t('Last name')} maxLength={28} value={lastName} onChange={e => setLastName(e.target.value)} />
    </div>
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

// Self-service half of admin-assisted recovery (see api/server.js's POST /api/recover/request):
// someone locked out can't do anything on their own — only an admin can actually issue a
// recovery link — so this just raises a hand and lets staff take it from there, instead of the
// member having to track someone down in person or over chat first.
function LostPasskeySheet({ close }) {
  const [name, setName] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref = useRef(null)
  useEffect(() => { setTimeout(() => ref.current?.focus(), 250) }, [])
  const go = async () => {
    const n = name.trim()
    if (!n) { useUI.getState().toast(t('Enter a name')); return }
    setBusy(true)
    try { await api('/api/recover/request', { method: 'POST', body: JSON.stringify({ name: n }) }); setSent(true) }
    catch (e) { useUI.getState().toast(e.message || t('Could not send the request')) }
    setBusy(false)
  }
  if (sent) return <>
    <h3>{t('Request sent')}</h3>
    <div className="muted small" style={{ lineHeight: 1.5, marginBottom: 14 }}>
      {t('Staff have been notified — they’ll set you up with a new passkey on your existing profile next time you’re at the gym.')}
    </div>
    <Button variant="primary" onClick={close}>{t('Done')}</Button>
  </>
  return <>
    <h3>{t('I lost my passkey')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Type the name your profile is under — staff will get notified and set you up with a new passkey in person.')}</div>
    <input ref={ref} className="input" placeholder={t('Your name')} maxLength={60} value={name} onChange={e => setName(e.target.value)} />
    <div style={{ height: 12 }} />
    <Button variant="primary" icon="key" disabled={busy} onClick={go}>{t('Send request')}</Button>
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
        <button className="dim small" style={{ border: 'none', background: 'none', textDecoration: 'underline', cursor: 'pointer' }}
          onClick={() => useUI.getState().openSheet(close => <LostPasskeySheet close={close} />)}>{t('I lost my passkey')}</button>
      </> : <div className="card small muted" style={{ textAlign: 'left' }}>{t("This browser doesn't support passkeys — try a different browser to create a profile.")}</div>}
      <div className="dim small" style={{ marginTop: 26, lineHeight: 1.5 }}>{t('Passkeys use {0} — no passwords.', t(BIO))}<br />{t('Each profile keeps its own plan, workouts & body weight.')}</div>
    </div>
  )
}
