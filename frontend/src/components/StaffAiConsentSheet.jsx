// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The member's own, separate consent for the AI tools that gym staff use with their data. Not the
// Coach consent: the Coach is the member using AI for themselves; this lets staff do it. The server
// checks it (api/lib/staff-ai-consent.js) before anything is built or sent to an AI provider.
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { Button } from './ui.jsx'

export const STAFF_AI_CONSENT_VERSION = 1
export const hasStaffAiConsent = S => !!S?.staffAi?.consent?.agreedAt && S.staffAi.consent.version === STAFF_AI_CONSENT_VERSION

export default function StaffAiConsentSheet({ close }) {
  const update = useStore(s => s.update)
  const on = useStore(s => hasStaffAiConsent(s))
  const toast = useUI(s => s.toast)
  const set = allow => {
    update(s => { s.staffAi = allow ? { consent: { agreedAt: new Date().toISOString(), version: STAFF_AI_CONSENT_VERSION } } : { consent: null } })
    toast(allow ? t('Staff AI tools are allowed') : t('Staff AI tools are off'))
    close()
  }
  return <>
    <h3>{t('Staff AI tools')}</h3>
    <div className="muted small" style={{ lineHeight: 1.5, display: 'grid', gap: 8 }}>
      <div>{t('Trainers can use an AI assistant (Anthropic Claude) to draft a routine for you or to analyse your follow-up. It only happens if you allow it here.')}</div>
      <div>{t('For a routine draft it receives your current routines and programs and the trainer’s brief. For a follow-up analysis it receives compact calculated facts about your follow-up. It never receives your name, identifiers, private notes or photos.')}</div>
      <div>{t('While this is off, nothing about you is sent. What the AI returns is only a proposal that the trainer reviews. You can withdraw your consent at any time; what was already sent cannot be taken back from the provider.')}</div>
      <div>{t('This is separate from the Coach, which you use for yourself and which has its own consent.')}</div>
    </div>
    <div style={{ height: 14 }} />
    {on
      ? <Button variant="danger" onClick={() => set(false)}>{t('Withdraw my consent')}</Button>
      : <Button variant="primary" onClick={() => set(true)}>{t('Allow staff AI tools')}</Button>}
    <div style={{ height: 8 }} />
    <Button onClick={close}>{on ? t('Close') : t('Not now')}</Button>
  </>
}
