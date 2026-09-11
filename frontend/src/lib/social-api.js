// Talking to the /api/social/* and /api/trainer/* endpoints — thin wrappers over api(), same
// shape as lib/coach-api.js. No polling here: Social is a browse-on-open list, not a live job.
import { api } from './api.js'

export const fetchSocialRoutines = () => api('/api/social/routines').then(r => r.routines)
export const publishSocialRoutine = post => api('/api/social/routines', { method: 'POST', body: JSON.stringify(post) })
export const rateSocialRoutine = (id, stars) => api('/api/social/routines/rate', { method: 'POST', body: JSON.stringify({ id, stars }) })
export const deleteSocialRoutine = id => api('/api/social/routines/delete', { method: 'POST', body: JSON.stringify({ id }) })

export const fetchSocialPrograms = () => api('/api/social/programs').then(r => r.programs)
export const publishSocialProgram = post => api('/api/social/programs', { method: 'POST', body: JSON.stringify(post) })
export const rateSocialProgram = (id, stars) => api('/api/social/programs/rate', { method: 'POST', body: JSON.stringify({ id, stars }) })
export const deleteSocialProgram = id => api('/api/social/programs/delete', { method: 'POST', body: JSON.stringify({ id }) })

// A routine's/program's cover photo — Social's own (post.image) or one set directly on it in
// Plan — is served through GET /api/social/media either way; see lib/media.js's mediaUrl.

export const fetchWall = () => api('/api/social/wall').then(r => r.wall)
export const publishWallPost = post => api('/api/social/wall', { method: 'POST', body: JSON.stringify(post) })
export const deleteWallPost = id => api('/api/social/wall/delete', { method: 'POST', body: JSON.stringify({ id }) })
export const postWallComment = (id, text) => api('/api/social/wall/comment', { method: 'POST', body: JSON.stringify({ id, text }) })
export const deleteWallComment = (postId, commentId) =>
  api('/api/social/wall/comment/delete', { method: 'POST', body: JSON.stringify({ postId, commentId }) })

export const fetchTrainerMembers = () => api('/api/trainer/members').then(r => r.members)
export const assignRoutineToMember = (routineId, memberId) =>
  api('/api/trainer/assign-routine', { method: 'POST', body: JSON.stringify({ routineId, memberId }) })
export const assignProgramToMember = (programId, memberId) =>
  api('/api/trainer/assign-program', { method: 'POST', body: JSON.stringify({ programId, memberId }) })
