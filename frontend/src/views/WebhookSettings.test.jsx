// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { WebhookPanel, EndpointCard } from './WebhookSettings.jsx'

/* Presentational checks only (the repo has no DOM test environment). The screen's behaviour is in its
 * handlers: the form and the delete/rotate flows only change state through the h.* functions below. */
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ')
const noop = () => {}
const h = { reload: noop, setField: noop, toggleEvent: noop, add: noop, toggle: noop, ask: noop, rotate: noop, remove: noop, dismissSecret: noop }
const endpoint = (over = {}) => ({ id: 'w1', host: 'hooks.ejemplo.com', events: ['workout.finished'], enabled: true, createdAt: 1, failures: 0, lastStatus: null, lastAt: null, disabledReason: null, ...over })
const form = (over = {}) => ({ url: '', events: ['workout.finished'], error: null, busy: false, ...over })
const data = (over = {}) => ({ endpoints: [], deliveries: [], events: ['workout.finished', 'weighin.recorded'], defaultEvents: ['workout.finished'], ...over })
const panel = (over = {}) => renderToStaticMarkup(<WebhookPanel phase="ready" data={data()} form={form()} revealed={null} pending={null} busyId={null} notice={null} h={h} {...over} />)

describe('hidden when disabled', () => {
  it('shows only the note that webhooks are not active, with no form and no list', () => {
    const html = panel({ phase: 'disabled' })
    expect(text(html)).toContain('Webhooks are not active on this server.')
    expect(html).not.toContain('wh-url')
    expect(text(html)).not.toContain('Create webhook')
    expect(text(html)).not.toContain('Your webhooks')
  })
})

describe('adding an endpoint', () => {
  it('offers the two approved notice types, with the workout one checked by default', () => {
    const html = panel()
    expect(text(html)).toContain('Workout finished')
    expect(text(html)).toContain('Weigh-in recorded')
    expect(html).toMatch(/type="checkbox"[^>]*checked=""/)
  })
  it('shows a URL error next to the field and marks it invalid', () => {
    const html = panel({ form: form({ url: 'http:' + '//ejemplo.com', error: 'Use a secure address that starts with https.' }) })
    expect(html).toContain('aria-invalid="true"')
    expect(html).toContain('id="wh-url-err"')
    expect(text(html)).toContain('Use a secure address that starts with https.')
  })
})

describe('secret shown once', () => {
  const revealed = { kind: 'created', endpoint: endpoint(), secret: 'whsec_TEST_ONLY_value' }
  it('shows the secret with the copy button and the will-not-be-shown-again warning', () => {
    const html = panel({ revealed })
    expect(html).toContain('whsec_TEST_ONLY_value')
    expect(text(html)).toContain('Copy this secret now. It will not be shown again.')
    expect(text(html)).toContain('Copy secret')
  })
  it('is absent once the screen no longer holds it', () => {
    const html = panel({ revealed: null })
    expect(html).not.toContain('whsec_TEST_ONLY_value')
    expect(text(html)).not.toContain('Copia este secreto ahora')
  })
  it('never appears in the list of endpoints', () => {
    const html = panel({ data: data({ endpoints: [endpoint()] }) })
    expect(html).not.toContain('whsec_')
    expect(text(html)).toContain('hooks.ejemplo.com')
  })
  it('is not persisted by the screen (no browser storage, no shared store)', () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'WebhookSettings.jsx'), 'utf8')
    expect(src).not.toMatch(/localStorage|sessionStorage|indexedDB|useStore|useUI/)
  })
})

describe('delete and rotate need confirmation', () => {
  it('without a pending action, the list offers the actions but not the confirmation', () => {
    const html = panel({ data: data({ endpoints: [endpoint()] }) })
    expect(text(html)).toContain('Rotate secret')
    expect(text(html)).not.toContain('No se puede deshacer')
  })
  it('a pending delete asks first and says it cannot be undone', () => {
    const html = panel({ data: data({ endpoints: [endpoint()] }), pending: { id: 'w1', kind: 'delete' } })
    expect(text(html)).toContain('Delete this webhook? It stops sending notices right away. This cannot be undone.')
    expect(text(html)).toContain('Cancel')
  })
  it('a pending rotate warns that the current secret stops working', () => {
    const html = panel({ data: data({ endpoints: [endpoint()] }), pending: { id: 'w1', kind: 'rotate' } })
    expect(text(html)).toContain('The current secret stops working right away')
  })
})

describe('endpoint line', () => {
  it('shows the last delivery code and never a body', () => {
    const html = renderToStaticMarkup(<EndpointCard ep={endpoint({ enabled: false, disabledReason: 'failures' })}
      last={{ webhookId: 'w1', status: 'http', httpCode: 503, at: '2026-11-05T12:00:00.000Z' }} busy={false} pending={null} h={h} />)
    expect(text(html)).toContain('HTTP 503')
    expect(text(html)).toContain('Turned off after repeated failures')
    expect(html).not.toMatch(/body|payload/i)
  })
})
