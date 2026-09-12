// Talking to /api/friends/* (and the one account-identity route it needs, /api/me/username) —
// thin wrappers over api(), same shape as lib/social-api.js.
import { api } from './api.js'

export const fetchFriends = () => api('/api/friends')
export const fetchFriendCode = () => api('/api/friends/code').then(r => r.code)
export const resetFriendCode = () => api('/api/friends/code/reset', { method: 'POST', body: '{}' }).then(r => r.code)
export const lookupUsername = username => api('/api/friends/lookup', { method: 'POST', body: JSON.stringify({ username }) }).then(r => r.user)
export const sendFriendRequest = payload => api('/api/friends/request', { method: 'POST', body: JSON.stringify(payload) })
export const acceptFriendRequest = requestId => api('/api/friends/accept', { method: 'POST', body: JSON.stringify({ requestId }) })
export const declineFriendRequest = requestId => api('/api/friends/decline', { method: 'POST', body: JSON.stringify({ requestId }) })
export const cancelFriendRequest = requestId => api('/api/friends/cancel', { method: 'POST', body: JSON.stringify({ requestId }) })
export const removeFriend = friendId => api('/api/friends/remove', { method: 'POST', body: JSON.stringify({ friendId }) })

export const updateUsername = username => api('/api/me/username', { method: 'POST', body: JSON.stringify({ username }) }).then(r => r.username)
