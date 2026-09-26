// Talking to /api/trainer/* from the desktop trainer panel — thin wrappers over api(), same
// shape as lib/social-api.js. fetchTrainerMembers already lives in social-api.js (used by
// Social.jsx's "assign to a member" flow); import it from there instead of duplicating it.
import { api } from './api.js'
import { stateAction } from './state-action.js'

export { fetchTrainerMembers } from './social-api.js'
export const fetchMemberPlan = memberId => api('/api/trainer/member-plan?id=' + encodeURIComponent(memberId))
export const saveMemberRoutine = payload => savePlan('member-routine', payload)
export const saveMemberProgram = payload => savePlan('member-program', payload)
// V3 — traceability only: past versions of a trainer-assigned routine/program, newest first.
export const fetchRoutineVersions = (memberId, routineId) =>
  api('/api/trainer/routine-versions?memberId=' + encodeURIComponent(memberId) + '&routineId=' + encodeURIComponent(routineId))
export const fetchProgramVersions = (memberId, programId) =>
  api('/api/trainer/program-versions?memberId=' + encodeURIComponent(memberId) + '&programId=' + encodeURIComponent(programId))

async function savePlan(kind, payload) {
  return stateAction('/api/trainer/' + kind, payload, payload.sync)
}
