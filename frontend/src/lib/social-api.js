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
export const setWallVisibility = (id, isPublic) =>
  api('/api/social/wall/visibility', { method: 'POST', body: JSON.stringify({ id, public: isPublic }) })

// Muro: temas (topics) + comentarios planos, mismo patrón que el Muro/Wall de arriba.
export const fetchTopics = () => api('/api/social/topics').then(r => r.topics)
export const publishTopic = topic => api('/api/social/topics', { method: 'POST', body: JSON.stringify(topic) })
export const deleteTopic = id => api('/api/social/topics/delete', { method: 'POST', body: JSON.stringify({ id }) })
export const postTopicComment = (id, text) => api('/api/social/topics/comment', { method: 'POST', body: JSON.stringify({ id, text }) })
export const deleteTopicComment = (topicId, commentId) =>
  api('/api/social/topics/comment/delete', { method: 'POST', body: JSON.stringify({ topicId, commentId }) })

// Tablón de Entrenadores: solo lectura salvo que el propio autor active comentarios.
export const fetchBoard = () => api('/api/social/board').then(r => r.board)
export const publishBoardPost = post => api('/api/social/board', { method: 'POST', body: JSON.stringify(post) })
export const deleteBoardPost = id => api('/api/social/board/delete', { method: 'POST', body: JSON.stringify({ id }) })
export const toggleBoardComments = (id, commentsEnabled) =>
  api('/api/social/board/toggle-comments', { method: 'POST', body: JSON.stringify({ id, commentsEnabled }) })
export const postBoardComment = (id, text) => api('/api/social/board/comment', { method: 'POST', body: JSON.stringify({ id, text }) })
export const deleteBoardComment = (postId, commentId) =>
  api('/api/social/board/comment/delete', { method: 'POST', body: JSON.stringify({ postId, commentId }) })

export const fetchChallenges = () => api('/api/social/challenges').then(r => r.challenges)
export const fetchChallengeDetail = id => api('/api/social/challenges/detail?id=' + encodeURIComponent(id))
export const createChallenge = ch => api('/api/social/challenges/new', { method: 'POST', body: JSON.stringify(ch) })
export const joinChallenge = id => api('/api/social/challenges/join', { method: 'POST', body: JSON.stringify({ id }) })
export const leaveChallenge = id => api('/api/social/challenges/leave', { method: 'POST', body: JSON.stringify({ id }) })
export const deleteChallenge = id => api('/api/social/challenges/delete', { method: 'POST', body: JSON.stringify({ id }) })

export const fetchGoals = () => api('/api/social/goals').then(r => r.goals)
export const publishGoal = goal => api('/api/social/goals/publish', { method: 'POST', body: JSON.stringify(goal) })
export const unpublishGoal = id => api('/api/social/goals/unpublish', { method: 'POST', body: JSON.stringify({ id }) })

export const fetchTrainerMembers = () => api('/api/trainer/members').then(r => r.members)
export const assignRoutineToMember = (routineId, memberId) =>
  api('/api/trainer/assign-routine', { method: 'POST', body: JSON.stringify({ routineId, memberId }) })
export const assignProgramToMember = (programId, memberId) =>
  api('/api/trainer/assign-program', { method: 'POST', body: JSON.stringify({ programId, memberId }) })
