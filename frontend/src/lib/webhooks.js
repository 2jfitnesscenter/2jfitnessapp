// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Webhook settings helpers: the event choices the owner approved, and the same address rules the server applies,
// so a mistake is explained before the request is sent. The server stays the authority (api/lib/webhook-security.js).
import { api } from './api.js'

export const WEBHOOK_EVENT_KEYS = Object.freeze(['workout.finished', 'weighin.recorded'])
export const DEFAULT_WEBHOOK_EVENTS = Object.freeze(['workout.finished'])

const LOCAL_NAMES = ['localhost', 'localdomain', 'local', 'internal']

/** Returns { ok: true, url } or { ok: false, error } where error is a stable code (see WEBHOOK_URL_ERROR). */
export function validateWebhookUrl(input) {
  const raw = String(input ?? '').trim()
  if (!raw) return { ok: false, error: 'empty' }
  let u
  try { u = new URL(raw) } catch { return { ok: false, error: 'invalid' } }
  if (u.protocol !== 'https:') return { ok: false, error: 'not_https' }
  if (u.username || u.password) return { ok: false, error: 'credentials' }
  if (u.port && u.port !== '443') return { ok: false, error: 'port' }
  const host = u.hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '')
  if (!host || host.length > 253) return { ok: false, error: 'host' }
  if (LOCAL_NAMES.includes(host) || LOCAL_NAMES.some(n => host.endsWith('.' + n))) return { ok: false, error: 'host' }
  return { ok: true, url: u.href }
}

/** Spanish message for each validation code (the caller passes it through t()). */
export const WEBHOOK_URL_ERROR = Object.freeze({
  empty: 'Escribe la dirección HTTPS que recibirá los avisos.',
  invalid: 'Esto no es una dirección web válida. Revisa que no tenga espacios ni caracteres extraños.',
  not_https: 'Usa una dirección segura que empiece por https.',
  credentials: 'Quita el usuario y la contraseña de la dirección.',
  port: 'Solo se admite el puerto HTTPS estándar (443). Quita el número de puerto.',
  host: 'Los nombres locales no pueden recibir avisos. Usa una dirección pública.',
})

/** Only the on/off answer matters to the settings entry: webhooks are shown only when the server reports them enabled. */
export async function webhooksEnabled() {
  try { await api('/api/webhooks'); return true } catch { return false }
}
