// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// F9o · Opens «Confirmar con tu passkey de 2J Hub» when `api()` reports a staff step-up offer (passkey_required + staffStepUp).
import { useEffect } from 'react'
import { useUI } from '../store/useUI.js'
import { STAFF_STEPUP_EVENT } from '../lib/staff-stepup.js'
import { StaffStepUpSheet } from './StaffStepUpSheet.jsx'

export default function StaffStepUpHost() {
  useEffect(() => {
    const open = e => useUI.getState().openSheet(c => <StaffStepUpSheet action={e.detail.action} body={e.detail.body} close={c} />)
    window.addEventListener(STAFF_STEPUP_EVENT, open)
    return () => window.removeEventListener(STAFF_STEPUP_EVENT, open)
  }, [])
  return null
}
