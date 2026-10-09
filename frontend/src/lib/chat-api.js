// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Talking to /api/chat/* — thin wrappers over api(), same shape as lib/social-api.js. Polling,
// not sockets: views/ChatThread.jsx re-fetches on an interval while a thread is open.
import { api } from './api.js'

export const fetchThreads = () => api('/api/chat/threads').then(r => r.threads)
export const startThread = text => api('/api/chat/threads', { method: 'POST', body: JSON.stringify({ text }) }).then(r => r.thread)
export const startDirectThread = userId => api('/api/chat/direct', { method: 'POST', body: JSON.stringify({ userId }) }).then(r => r.thread)
// `after` is the last message the screen already holds: polling then returns only what is new (and the whole thread once if something old changed).
export const fetchMessages = (threadId, { after = '', rev = 0 } = {}) =>
  api('/api/chat/messages?threadId=' + encodeURIComponent(threadId) + (after ? '&after=' + encodeURIComponent(after) + '&rev=' + encodeURIComponent(rev) : ''))
export const sendMessage = (threadId, text) => api('/api/chat/messages', { method: 'POST', body: JSON.stringify({ threadId, text }) })
export const sendShare = payload => api('/api/social/shares', { method: 'POST', body: JSON.stringify({ ...payload, audience: 'chat' }) })
export const setThreadStatus = (threadId, status) => api('/api/chat/threads/status', { method: 'POST', body: JSON.stringify({ threadId, status }) })
