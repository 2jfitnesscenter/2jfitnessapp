import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8')

function createWorker(visibilityState) {
  const listeners = {}
  const stored = new Map()
  const showNotification = vi.fn(async () => {})
  const cache = {
    match: async key => stored.has(key) ? new Response(stored.get(key)) : undefined,
    put: async (key, response) => stored.set(key, await response.text()),
    keys: async () => [...stored.keys()],
    delete: async key => stored.delete(key),
  }
  const self = {
    addEventListener: (name, listener) => { listeners[name] = listener },
    registration: { scope: 'https://app.example.test/', showNotification },
    clients: { matchAll: async () => visibilityState ? [{ visibilityState }] : [] },
  }
  vm.runInNewContext(source, { self, caches: { open: async () => cache }, URL, Response })
  return { listeners, showNotification }
}

async function dispatchRestPush(worker, id) {
  let pending
  worker.listeners.push({
    data: { json: () => ({ type: 'rest-alert', id, url: '#/workout' }) },
    waitUntil: promise => { pending = promise },
  })
  await pending
}

describe('rest alert service worker delivery', () => {
  afterEach(() => vi.restoreAllMocks())

  it('keeps the current visible-app UX and displays one OS notification in background', async () => {
    const visible = createWorker('visible')
    await dispatchRestPush(visible, 'rest_alert_visible_1')
    expect(visible.showNotification).not.toHaveBeenCalled()

    const background = createWorker('hidden')
    await dispatchRestPush(background, 'rest_alert_hidden_1')
    await dispatchRestPush(background, 'rest_alert_hidden_1')
    expect(background.showNotification).toHaveBeenCalledTimes(1)
    expect(background.showNotification).toHaveBeenCalledWith('Descanso terminado', expect.objectContaining({ body: 'Siguiente serie' }))
  })
})
