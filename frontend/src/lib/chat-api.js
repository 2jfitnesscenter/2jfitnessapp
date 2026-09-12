// Talking to /api/chat/* — thin wrappers over api(), same shape as lib/social-api.js. Polling,
// not sockets: views/ChatThread.jsx re-fetches on an interval while a thread is open.
import { api } from './api.js'

export const fetchThreads = () => api('/api/chat/threads').then(r => r.threads)
export const startThread = text => api('/api/chat/threads', { method: 'POST', body: JSON.stringify({ text }) }).then(r => r.thread)
export const fetchMessages = threadId => api('/api/chat/messages?threadId=' + encodeURIComponent(threadId))
export const sendMessage = (threadId, text) => api('/api/chat/messages', { method: 'POST', body: JSON.stringify({ threadId, text }) })
export const setThreadStatus = (threadId, status) => api('/api/chat/threads/status', { method: 'POST', body: JSON.stringify({ threadId, status }) })
