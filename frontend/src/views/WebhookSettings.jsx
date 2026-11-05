// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Settings → Webhooks: the member's own outbound notices. Shown from Settings only when the server reports webhooks enabled.
// The signing secret lives in this screen's memory alone: it is shown once after create or rotate and disappears on leaving.
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import { Button, Section } from '../components/ui.jsx'
import { t, dateLocale } from '../lib/i18n.js'
import { WEBHOOK_EVENT_KEYS, DEFAULT_WEBHOOK_EVENTS, validateWebhookUrl, WEBHOOK_URL_ERROR } from '../lib/webhooks.js'
import { listWebhooks, createWebhook, updateWebhook, rotateWebhook, deleteWebhook } from '../lib/webhooks-api.js'

const eventTitle = ev => (ev === 'workout.finished' ? t('Workout finished') : t('Weigh-in recorded'))
const eventHint = ev => (ev === 'workout.finished' ? t('When you finish a workout') : t('When you record a weigh-in'))
const deliveryText = d => {
  if (d.httpCode) return t('HTTP {0}', d.httpCode)
  if (d.status === 'timeout') return t('No response in time')
  if (d.status === 'network') return t('Connection failed')
  if (d.status === 'blocked') return t('Address not allowed')
  if (d.status === 'rate_limited') return t('Too many notices, not sent')
  if (d.status === 'ok') return t('Delivered')
  return t('Rejected by the server')
}
const when = iso => {
  const d = iso ? new Date(iso) : null
  return d && !Number.isNaN(+d) ? d.toLocaleString(dateLocale(), { dateStyle: 'medium', timeStyle: 'short' }) : null
}
// Keeps the server's Spanish message when it gave one; otherwise says what to check.
const failText = (err, fallback) => (err && err.data && err.data.error ? err.message : fallback)

/** The one-time secret. Nothing here is stored: it is gone when the screen unmounts or the member confirms they saved it. */
export function SecretOnce({ revealed, onDone }) {
  const ref = useRef(null)
  const [copy, setCopy] = useState('idle')
  const doCopy = async () => {
    try { await navigator.clipboard.writeText(revealed.secret); setCopy('done') }
    catch { setCopy('failed'); ref.current?.select() }
  }
  return <section className="card" aria-labelledby="wh-secret-title" style={{ display: 'grid', gap: 10, marginBottom: 16 }}>
    <h2 id="wh-secret-title" className="sect-t" style={{ margin: 0 }}>
      {revealed.kind === 'rotated' ? t('New secret for {0}', revealed.endpoint.host) : t('Secret for {0}', revealed.endpoint.host)}
    </h2>
    <p style={{ margin: 0 }}><strong>{t('Copy this secret now. It will not be shown again.')}</strong> {t('Store it on your server before you leave this screen. If you lose it, rotate the secret to get a new one.')}</p>
    <input ref={ref} className="input" readOnly value={revealed.secret} aria-label={t('Signing secret')}
      onFocus={e => e.target.select()} style={{ width: '100%', fontFamily: 'monospace' }} />
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <Button variant="primary" onClick={doCopy}>{copy === 'done' ? t('Copied') : t('Copy secret')}</Button>
      <Button variant="plain" onClick={onDone}>{t('I have saved it')}</Button>
    </div>
    {copy === 'failed' && <p role="status" className="muted small" style={{ margin: 0 }}>{t('Could not copy. Select the secret above and copy it by hand.')}</p>}
  </section>
}

/** One endpoint: host only, state, events, last delivery code and time. Never a body, never the secret. */
export function EndpointCard({ ep, last, busy, pending, h }) {
  const state = ep.enabled ? t('Active')
    : ep.disabledReason === 'failures' ? t('Turned off after repeated failures') : t('Turned off')
  const lastText = last
    ? t('Last delivery: {0} at {1}', deliveryText(last), when(last.at) || '—')
    : t('No deliveries yet.')
  return <div className="card" data-webhook={ep.id} style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
    <div>
      <strong style={{ wordBreak: 'break-all' }}>{ep.host}</strong>{' '}
      <span className="set-pill">{state}</span>
    </div>
    <div className="muted small">{ep.events.map(eventTitle).join(' · ')}</div>
    <div className="muted small">{lastText}</div>
    {pending ? <div role="group" aria-label={t('Confirm')} style={{ display: 'grid', gap: 8 }}>
      <p style={{ margin: 0 }}>{pending === 'rotate'
        ? t('Rotate the secret? The current secret stops working right away. Update your server with the new one.')
        : t('Delete this webhook? It stops sending notices right away. This cannot be undone.')}</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Button variant={pending === 'rotate' ? 'primary' : 'danger'} disabled={busy}
          onClick={() => (pending === 'rotate' ? h.rotate(ep.id) : h.remove(ep.id))}>
          {pending === 'rotate' ? t('Rotate secret') : t('Delete')}
        </Button>
        <Button variant="plain" autoFocus onClick={() => h.ask(null, null)}>{t('Cancel')}</Button>
      </div>
    </div> : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <Button variant="plain" disabled={busy} onClick={() => h.toggle(ep)}>{ep.enabled ? t('Turn off') : t('Turn on')}</Button>
      <Button variant="plain" disabled={busy} onClick={() => h.ask(ep.id, 'rotate')}>{t('Rotate secret')}</Button>
      <Button variant="plain" disabled={busy} onClick={() => h.ask(ep.id, 'delete')}>{t('Delete')}</Button>
    </div>}
  </div>
}

/** Everything below the page header. Pure: the state and handlers come in as props. */
export function WebhookPanel({ phase, data, form, revealed, pending, busyId, notice, h }) {
  if (phase === 'loading') return <div className="card muted small">{t('Loading…')}</div>
  if (phase === 'disabled') return <Section footer={t('Nothing is sent while webhooks are off on this server.')}>
    <div className="card">{t('Webhooks are not active on this server.')}</div>
  </Section>
  if (phase === 'signed-out') return <div className="card">{t('Sign in to manage your webhooks.')}</div>
  if (phase === 'error') return <div className="card" style={{ display: 'grid', gap: 8 }}>
    <span>{t('Could not load your webhooks. Check your connection and try again.')}</span>
    <div><Button variant="plain" onClick={h.reload}>{t('Try again')}</Button></div>
  </div>

  return <>
    {notice && <p role="alert" className="card" style={{ margin: '0 0 12px' }}>{notice}</p>}
    {revealed && <SecretOnce revealed={revealed} onDone={h.dismissSecret} />}

    <Section title={t('Your webhooks')} footer={t('Only the server name is shown, so you can recognise it. Each notice is signed with the secret.')}>
      {data.endpoints.length === 0 && <div className="card muted small">{t('You have no webhooks yet.')}</div>}
      {data.endpoints.map(ep => <EndpointCard key={ep.id} ep={ep} busy={busyId === ep.id}
        last={data.deliveries.find(d => d.webhookId === ep.id)}
        pending={pending && pending.id === ep.id ? pending.kind : null} h={h} />)}
    </Section>

    <Section title={t('Add a webhook')} footer={t('You receive only the type of notice, an id, the time and the day. Never weights, exercise or routine names, notes or health data.')}>
      <form onSubmit={h.add} noValidate style={{ padding: '10px 14px', display: 'grid', gap: 10 }}>
        <label htmlFor="wh-url" className="muted small">{t('HTTPS address')}</label>
        <input id="wh-url" className="input" type="url" inputMode="url" autoComplete="off" autoCapitalize="none" spellCheck={false}
          placeholder="https://" value={form.url} onChange={e => h.setField({ url: e.target.value, error: null })}
          aria-invalid={form.error ? 'true' : undefined} aria-describedby={form.error ? 'wh-url-err wh-url-help' : 'wh-url-help'}
          style={{ width: '100%' }} />
        <span id="wh-url-help" className="muted small">{t('The server must accept HTTPS on port 443.')}</span>
        {form.error && <span id="wh-url-err" role="alert" style={{ color: 'var(--red)', fontSize: 14 }}>{form.error}</span>}

        <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          <legend className="muted small" style={{ marginBottom: 4 }}>{t('Notices to send')}</legend>
          {WEBHOOK_EVENT_KEYS.map(ev => <label key={ev} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <input type="checkbox" checked={form.events.includes(ev)} onChange={() => h.toggleEvent(ev)} style={{ marginTop: 3 }} />
            <span>{eventTitle(ev)}<span className="muted small" style={{ display: 'block' }}>{eventHint(ev)}</span></span>
          </label>)}
        </fieldset>

        <div><Button variant="primary" type="submit" disabled={form.busy}>{form.busy ? t('Creating…') : t('Create webhook')}</Button></div>
      </form>
    </Section>
  </>
}

const EMPTY_DATA = { endpoints: [], deliveries: [], events: [...WEBHOOK_EVENT_KEYS], defaultEvents: [...DEFAULT_WEBHOOK_EVENTS] }

export default function WebhookSettings() {
  const nav = useNavigate()
  const [phase, setPhase] = useState('loading')
  const [data, setData] = useState(EMPTY_DATA)
  const [form, setForm] = useState({ url: '', events: [...DEFAULT_WEBHOOK_EVENTS], error: null, busy: false })
  const [revealed, setRevealed] = useState(null)   // { kind, endpoint, secret } — memory only
  const [pending, setPending] = useState(null)     // { id, kind: 'rotate' | 'delete' }
  const [busyId, setBusyId] = useState(null)
  const [notice, setNotice] = useState(null)

  const load = async () => {
    setPhase('loading')
    try {
      const r = await listWebhooks()
      setData({ ...EMPTY_DATA, ...r, endpoints: r.endpoints || [], deliveries: r.deliveries || [] })
      setPhase('ready')
    } catch (e) {
      if (e.data && e.data.code === 'webhooks_disabled') setPhase('disabled')
      else if (e.status === 401) setPhase('signed-out')
      else setPhase('error')
    }
  }
  useEffect(() => { load() }, [])

  const setField = patch => setForm(f => ({ ...f, ...patch }))
  const replaceEndpoint = ep => setData(d => ({ ...d, endpoints: d.endpoints.map(x => (x.id === ep.id ? ep : x)) }))

  const h = {
    reload: load,
    setField,
    toggleEvent: ev => setForm(f => ({ ...f, error: null, events: f.events.includes(ev) ? f.events.filter(x => x !== ev) : [...f.events, ev] })),
    add: async e => {
      e.preventDefault()
      const v = validateWebhookUrl(form.url)
      if (!v.ok) { setField({ error: t(WEBHOOK_URL_ERROR[v.error]) }); return }
      if (!form.events.length) { setField({ error: t('Choose at least one notice.') }); return }
      setField({ busy: true, error: null })
      try {
        const r = await createWebhook({ url: v.url, events: form.events })
        setRevealed({ kind: 'created', endpoint: r.endpoint, secret: r.secret })
        setData(d => ({ ...d, endpoints: [...d.endpoints, r.endpoint] }))
        setForm(f => ({ ...f, url: '', busy: false, error: null }))
      } catch (err) {
        setForm(f => ({ ...f, busy: false, error: failText(err, t('Could not create the webhook. Check your connection and try again.')) }))
      }
    },
    toggle: async ep => {
      setBusyId(ep.id); setNotice(null)
      try { const r = await updateWebhook(ep.id, { enabled: !ep.enabled }); replaceEndpoint(r.endpoint) }
      catch (err) { setNotice(failText(err, t('Could not change this webhook. Try again.'))) }
      finally { setBusyId(null) }
    },
    ask: (id, kind) => setPending(id ? { id, kind } : null),
    rotate: async id => {
      setBusyId(id); setPending(null); setNotice(null)
      try { const r = await rotateWebhook(id); setRevealed({ kind: 'rotated', endpoint: r.endpoint, secret: r.secret }); replaceEndpoint(r.endpoint) }
      catch (err) { setNotice(failText(err, t('Could not rotate the secret. Try again.'))) }
      finally { setBusyId(null) }
    },
    remove: async id => {
      setBusyId(id); setPending(null); setNotice(null)
      try {
        await deleteWebhook(id)
        setData(d => ({ ...d, endpoints: d.endpoints.filter(x => x.id !== id) }))
        setRevealed(r => (r && r.endpoint.id === id ? null : r))
      } catch (err) { setNotice(failText(err, t('Could not delete this webhook. Try again.'))) }
      finally { setBusyId(null) }
    },
    dismissSecret: () => setRevealed(null),
  }

  return <div className="narrow">
    <div className="hdr">
      <button className="back" onClick={() => nav('/settings')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <h1>{t('Webhooks')}</h1>
    </div>
    {phase === 'ready' && <p className="muted small" style={{ margin: '0 0 12px' }}>
      {t('Your server receives a short signed notice when you finish a workout or record a weigh-in. It contains no weights, names or notes.')}
    </p>}
    <WebhookPanel phase={phase} data={data} form={form} revealed={revealed} pending={pending} busyId={busyId} notice={notice} h={h} />
  </div>
}
