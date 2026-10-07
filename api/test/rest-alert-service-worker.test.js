import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

function loadWorker() {
  const handlers = new Map(), shown = [], messages = [], cacheValues = new Map()
  const cache = {
    async match(key) { const value = cacheValues.get(String(key)); return value?.clone() },
    async put(key, value) { cacheValues.set(String(key), value.clone()) },
    async delete(key) { return cacheValues.delete(String(key)) },
    async keys() { return [...cacheValues.keys()].map(key => new Request(key)) },
  }
  const client = { postMessage: value => messages.push(value), focus: async () => {} }
  const self = {
    addEventListener: (type, handler) => handlers.set(type, handler),
    registration: { scope: 'https://app.2jfitnesscenter.com/', showNotification: async (title, options) => shown.push({ title, options }) },
    clients: { matchAll: async () => [client], openWindow: async url => url },
  }
  const source = fs.readFileSync(fileURLToPath(new URL('../../frontend/public/sw.js', import.meta.url)), 'utf8')
  vm.runInNewContext(source, {
    self, caches: { open: async () => cache, keys: async () => [] },
    location: { origin: 'https://app.2jfitnesscenter.com' }, URL, Request, Response,
  })
  return { handlers, shown, messages }
}

function pushEvent(handler, payload) {
  let task
  handler({ data: { json: () => payload }, waitUntil: promise => { task = promise } })
  return task
}

test('rest push uses fixed private-safe copy and suppresses duplicate alert ids', async () => {
  const worker = loadWorker(), handler = worker.handlers.get('push')
  const payload = { type: 'rest-alert', id: 'rest_alert_123456', url: '#/workout', exercise: 'private name', weight: 999 }
  await pushEvent(handler, payload)
  await pushEvent(handler, payload)
  assert.equal(worker.shown.length, 1)
  assert.equal(worker.shown[0].title, 'Descanso terminado')
  assert.equal(worker.shown[0].options.body, 'Siguiente serie')
  assert.equal(worker.shown[0].options.tag, '2j-rest-rest_alert_123456')
  assert.equal(worker.shown[0].options.renotify, false)
  assert.equal(JSON.stringify(worker.shown[0]).includes('private name'), false)
})

test('diagnostic test push uses the real rest-alert copy and generic social push remains compatible', async () => {
  const worker = loadWorker(), handler = worker.handlers.get('push')
  await pushEvent(handler, { type: 'rest-alert-test', id: 'rest_test_123456', title: 'untrusted', body: 'untrusted' })
  await pushEvent(handler, { title: 'Social', body: 'New message', tag: 'message' })
  assert.deepEqual(worker.shown.map(item => item.title), ['Descanso terminado', 'Social'])
  assert.equal(worker.shown[0].options.body, 'Siguiente serie')
  assert.equal(worker.shown[1].options.body, 'New message')
})

test('notification click focuses the app and routes to the workout hash', async () => {
  const worker = loadWorker()
  let task
  worker.handlers.get('notificationclick')({ notification: { data: { url: '#/workout' }, close() {} }, waitUntil: promise => { task = promise } })
  await task
  assert.equal(worker.messages.length, 1)
  assert.equal(worker.messages[0].type, 'nav')
  assert.equal(worker.messages[0].url, '#/workout')
})
