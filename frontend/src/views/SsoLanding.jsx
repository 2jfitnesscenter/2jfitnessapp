// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// /sso — the page Platform sends the browser to after "Open Búnker". Renders before the app (and before its router, which
// uses the URL hash) so the one-time code in the fragment is consumed and cleared first. See lib/sso-landing.js.
import { useEffect, useState } from 'react'
import { t } from '../lib/i18n.js'
import { runSsoLanding } from '../lib/sso-landing.js'

const MESSAGES = {
  invalid: 'This sign-in link has expired or was already used. Open Búnker again from your 2J space.',
  blocked: 'Your Búnker access is not available right now. Talk to the centre if you think this is a mistake.',
  link: 'Your 2J account is not confirmed with this Búnker account yet. Sign in with your passkey and ask the centre to link them.',
  busy: 'Too many attempts. Wait a minute and try again.',
  disabled: 'Signing in with your 2J account is not available yet. Use your passkey.',
  unavailable: 'We could not open Búnker with your 2J account. Use your passkey instead.',
}

export default function SsoLanding() {
  const [state, setState] = useState({ phase: 'working', kind: null })
  useEffect(() => {
    let alive = true
    runSsoLanding({ location: window.location, history: window.history, fetchImpl: window.fetch.bind(window), go: path => window.location.replace(path) })
      .then(result => { if (alive && result && !result.ok) setState({ phase: 'failed', kind: result.kind }) })
    return () => { alive = false }
  }, [])
  if (state.phase === 'working') return <div className="narrow"><div className="card" role="status">{t('Opening Búnker with your 2J account…')}</div></div>
  return (
    <div className="narrow"><div className="card" role="alert">
      <h1>{t('Búnker')}</h1>
      <p>{t(MESSAGES[state.kind] || MESSAGES.unavailable)}</p>
      <a className="btn" href="/">{t('Sign in with passkey')}</a>
    </div></div>
  )
}
