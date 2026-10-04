// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Talking to /api/trainer/ai/* — same polling shape as lib/coach-api.js's useCoachStatus, but
// keyed per member: a trainer can have a draft in flight for one client while looking at
// another, so the poll is scoped to whichever memberId is on screen.
import { useEffect, useState, useCallback, useRef } from 'react'
import { api } from './api.js'

const POLL_MS = 3000

export const requestMemberPlan = (memberId, brief) =>
  api('/api/trainer/ai/generate', { method: 'POST', body: JSON.stringify({ memberId, brief }) })
export const discardMemberPlan = memberId =>
  api('/api/trainer/ai/discard', { method: 'POST', body: JSON.stringify({ memberId }) })

export function useTrainerAIStatus(memberId) {
  const [state, setState] = useState({ job: null, pending: null, errorClass: null, loading: true })
  const timer = useRef(null)
  const alive = useRef(false)

  const fetchStatus = useCallback(async () => {
    if (!memberId) return null
    try {
      const s = await api('/api/trainer/ai/status?memberId=' + encodeURIComponent(memberId))
      setState({ ...s, loading: false })
      return s
    } catch {
      setState(s => ({ ...s, loading: false }))
      return null
    }
  }, [memberId])

  // Polls while a job is queued/running. `refresh` (called right after "Generate") restarts the
  // loop: before, the loop had already stopped on the idle first read, so the screen stayed on
  // "Generating…" without ever asking again and the trainer retried into "busy".
  const tick = useCallback(async () => {
    clearTimeout(timer.current)
    const s = await fetchStatus()
    if (alive.current && s?.job) timer.current = setTimeout(tick, POLL_MS)
    return s
  }, [fetchStatus])

  useEffect(() => {
    if (!memberId) return undefined
    alive.current = true
    tick()
    return () => { alive.current = false; clearTimeout(timer.current) }
  }, [memberId, tick])

  return { ...state, refresh: tick }
}

export const TRAINER_AI_ERRORS = {
  off: 'The AI isn’t connected — ask an admin to set it up in the admin panel.',
  busy: 'A routine is already being generated for this member.',
  cap: 'Today’s AI generation limit has been reached.',
  nostate: 'This member hasn’t synced yet — there’s nothing to generate from.',
  consent: 'This member hasn’t agreed to AI features, so nothing is sent to the provider. Ask them to turn it on in their app, or build the routine by hand.',
  timeout: 'The AI took too long and gave up.',
  auth: 'The AI couldn’t sign in — check its setup in the admin panel.',
  missing: 'The AI runtime isn’t installed properly on this instance.',
  provider: 'The AI couldn’t run — check its setup in the admin panel.',
  unusable: 'The AI answered with something the app couldn’t use.',
  internal: 'Something went wrong on the server.'
}
