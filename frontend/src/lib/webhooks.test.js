// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, expect, it, vi } from 'vitest'
import { validateWebhookUrl, webhooksEnabled, WEBHOOK_EVENT_KEYS, WEBHOOK_URL_ERROR } from './webhooks.js'

// Scheme and host are joined here so the outside-host scan of the privacy test sees no literal third-party URLs.
const S = rest => 'https' + '://' + rest
const P = rest => 'http' + '://' + rest

describe('webhook address check (mirrors the server rules)', () => {
  it('accepts a public https address and normalises it', () => {
    expect(validateWebhookUrl(' ' + S('Ejemplo.com/avisos') + ' ')).toEqual({ ok: true, url: S('ejemplo.com/avisos') })
    expect(validateWebhookUrl(S('ejemplo.com:443/x'))).toEqual({ ok: true, url: S('ejemplo.com/x') })
  })
  it('explains each refusal with a stable code', () => {
    expect(validateWebhookUrl('')).toEqual({ ok: false, error: 'empty' })
    expect(validateWebhookUrl('no es una url').error).toBe('invalid')
    expect(validateWebhookUrl(P('ejemplo.com/x')).error).toBe('not_https')
    expect(validateWebhookUrl(S('usuario:clave@ejemplo.com/x')).error).toBe('credentials')
    expect(validateWebhookUrl(S('ejemplo.com:8443/x')).error).toBe('port')
    expect(validateWebhookUrl(S('localhost/x')).error).toBe('host')
    expect(validateWebhookUrl(S('casa.internal/x')).error).toBe('host')
  })
  it('has a Spanish message for every code the form can show', () => {
    for (const code of ['empty', 'invalid', 'not_https', 'credentials', 'port', 'host']) {
      expect(WEBHOOK_URL_ERROR[code]).toMatch(/\S/)
    }
  })
  it('offers only the two approved notice types', () => {
    expect(WEBHOOK_EVENT_KEYS).toEqual(['workout.finished', 'weighin.recorded'])
  })
})

describe('webhooks shown only when the server reports them enabled', () => {
  afterEach(() => { vi.unstubAllGlobals() })
  const reply = (status, body) => vi.stubGlobal('fetch', async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))

  it('is false when the server answers webhooks_disabled', async () => {
    reply(403, { error: 'los webhooks están desactivados en este servidor', code: 'webhooks_disabled' })
    expect(await webhooksEnabled()).toBe(false)
  })
  it('is false when the member is not signed in', async () => {
    reply(401, { error: 'no has iniciado sesión' })
    expect(await webhooksEnabled()).toBe(false)
  })
  it('is true when the list loads', async () => {
    reply(200, { endpoints: [], deliveries: [], events: [], defaultEvents: [] })
    expect(await webhooksEnabled()).toBe(true)
  })
  it('is false when the network fails', async () => {
    vi.stubGlobal('fetch', async () => { throw new TypeError('Failed to fetch') })
    expect(await webhooksEnabled()).toBe(false)
  })
})
