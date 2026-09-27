import { api } from './api.js'

export const fetchNotifications = () => api('/api/notifications')
export const markNotificationRead = id => api('/api/notifications/read', { method: 'POST', body: JSON.stringify({ id }) })
export const markAllNotificationsRead = () => api('/api/notifications/read-all', { method: 'POST', body: '{}' })
export const fetchSocialPreferences = () => api('/api/social/preferences')
export const saveSocialPreferences = value => api('/api/social/preferences', { method: 'POST', body: JSON.stringify(value) })
