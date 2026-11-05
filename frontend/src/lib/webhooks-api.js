// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Member webhook endpoints (api/webhooks/routes.js). The signing secret comes back only from create and rotate.
import { api } from './api.js'

const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) })

export const listWebhooks = () => api('/api/webhooks')
export const createWebhook = ({ url, events }) => post('/api/webhooks', { url, events })
export const updateWebhook = (id, patch) => post('/api/webhooks/update', { id, ...patch })
export const rotateWebhook = id => post('/api/webhooks/rotate', { id })
export const deleteWebhook = id => post('/api/webhooks/delete', { id })
