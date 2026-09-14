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

  const refresh = useCallback(async () => {
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

  useEffect(() => {
    if (!memberId) return undefined
    let stopped = false
    const tick = async () => {
      const s = await refresh()
      if (stopped) return
      if (s?.job) timer.current = setTimeout(tick, POLL_MS)
    }
    tick()
    return () => { stopped = true; clearTimeout(timer.current) }
  }, [memberId, refresh])

  return { ...state, refresh }
}

export const TRAINER_AI_ERRORS = {
  off: 'The AI isn’t connected — ask an admin to set it up in the admin panel.',
  busy: 'A routine is already being generated for this member.',
  cap: 'Today’s AI generation limit has been reached.',
  nostate: 'This member hasn’t synced yet — there’s nothing to generate from.',
  timeout: 'The AI took too long and gave up.',
  auth: 'The AI couldn’t sign in — check its setup in the admin panel.',
  missing: 'The AI runtime isn’t installed properly on this instance.',
  provider: 'The AI couldn’t run — check its setup in the admin panel.',
  unusable: 'The AI answered with something the app couldn’t use.',
  internal: 'Something went wrong on the server.'
}
