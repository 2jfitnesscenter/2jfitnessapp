// Talking to /api/trainer/* from the desktop trainer panel — thin wrappers over api(), same
// shape as lib/social-api.js. fetchTrainerMembers already lives in social-api.js (used by
// Social.jsx's "assign to a member" flow); import it from there instead of duplicating it.
import { api } from './api.js'

export { fetchTrainerMembers } from './social-api.js'
export const fetchMemberPlan = memberId => api('/api/trainer/member-plan?id=' + encodeURIComponent(memberId))
export const saveMemberRoutine = payload => api('/api/trainer/member-routine', { method: 'POST', body: JSON.stringify(payload) })
export const saveMemberProgram = payload => api('/api/trainer/member-program', { method: 'POST', body: JSON.stringify(payload) })
