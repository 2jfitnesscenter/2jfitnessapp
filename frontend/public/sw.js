/* 2J Fitness Center service worker. Private/API data is never cached. */
const VERSION = 'v2'
const SHELL = `2jfitness-shell-${VERSION}`
const ASSETS = `2jfitness-assets-${VERSION}`
const MEDIA = `2jfitness-media-${VERSION}`
const REST_ALERTS = '2jfitness-rest-alert-dedupe-v1'

// Do not skipWaiting: a downloaded update activates after existing tabs release the previous
// worker, so a live workout never swaps code halfway through the session.
self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(cache => cache.addAll(['./', './index.html'])))
})
self.addEventListener('activate', event => {
  const current = new Set([SHELL, ASSETS, MEDIA, REST_ALERTS])
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => !current.has(key)).map(key => caches.delete(key))))
    .then(() => self.clients.claim()))
})
const restAlertInFlight = new Map()
async function claimRestAlert(id) {
  if (restAlertInFlight.has(id)) { await restAlertInFlight.get(id); return false }
  const work = (async () => {
    const cache = await caches.open(REST_ALERTS)
    const key = new URL(`__2j_rest_alert/${encodeURIComponent(id)}`, self.registration.scope).href
    const existing = await cache.match(key)
    if (existing && Date.now() - Number(await existing.text()) < 7 * 86400000) return false
    if (existing) await cache.delete(key)
    await cache.put(key, new Response(String(Date.now()), { headers: { 'Content-Type': 'text/plain' } }))
    const keys = await cache.keys()
    for (const old of keys.slice(0, Math.max(0, keys.length - 256))) await cache.delete(old)
    return true
  })().finally(() => restAlertInFlight.delete(id))
  restAlertInFlight.set(id, work)
  return work
}
self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let data = {}
    try { data = event.data ? event.data.json() : {} } catch { return }
    if (data.type === 'rest-alert' || data.type === 'rest-alert-test') {
      const id = typeof data.id === 'string' && /^[A-Za-z0-9_-]{12,80}$/.test(data.id) ? data.id : ''
      if (!id || !await claimRestAlert(id)) return
      try {
        await self.registration.showNotification('Descanso terminado', {
          body: 'Siguiente serie',
          icon: 'icon-512.png', badge: 'icon-180.png',
          tag: `2j-rest-${id}`, renotify: false, data: { url: data.url || '#/workout', alertId: id },
        })
      } catch (error) {
        const cache = await caches.open(REST_ALERTS)
        await cache.delete(new URL(`__2j_rest_alert/${encodeURIComponent(id)}`, self.registration.scope).href)
        throw error
      }
      return
    }
    await self.registration.showNotification(data.title || '2J Fitness Center', {
      body: data.body || '', icon: 'icon-512.png', badge: 'icon-180.png',
      tag: data.tag || '2jfitness', renotify: true, data: { url: data.url || './' }
    })
  })())
})
self.addEventListener('notificationclick', event => {
  event.notification.close()
  const target = new URL(event.notification.data?.url || './', self.registration.scope).href
  event.waitUntil(self.clients.matchAll({ type: 'window' }).then(clients => {
    const client = clients.find(item => 'focus' in item)
    if (client) { client.postMessage({ type: 'nav', url: event.notification.data?.url || './' }); return client.focus() }
    return self.clients.openWindow(target)
  }))
})

// Cache Storage is bounded: a hashed bundle per release and ~1,300 exercise images/GIFs would otherwise only ever grow.
// The oldest entries (insertion order) go first, and only after a new one is stored, so the working set always survives.
const LIMITS = { [ASSETS]: 160, [MEDIA]: 400 }
const trim = async (cache, cacheName) => {
  const max = LIMITS[cacheName]; if (!max) return
  const keys = await cache.keys()
  for (const key of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(key)
}
const cacheFirst = (request, cacheName) => caches.open(cacheName).then(async cache => {
  const hit = await cache.match(request)
  if (hit) return hit
  const response = await fetch(request)
  if (response.ok) { await cache.put(request, response.clone()); trim(cache, cacheName).catch(() => {}) }
  return response
})
const navigation = request => fetch(request).then(async response => {
  if (response.ok) await (await caches.open(SHELL)).put('./index.html', response.clone())
  return response
}).catch(async () => (await caches.open(SHELL)).match('./index.html'))

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== location.origin) return
  if (url.pathname.startsWith('/api/')) return
  if (event.request.mode === 'navigate') { event.respondWith(navigation(event.request)); return }
  if (url.pathname.startsWith('/assets/')) { event.respondWith(cacheFirst(event.request, ASSETS)); return }
  if (url.pathname.startsWith('/img/') || url.pathname.startsWith('/gif/')) {
    event.respondWith(cacheFirst(event.request, MEDIA)); return
  }
  // Mutable icons, manifest and other public files revalidate normally; no private state is
  // ever written to Cache Storage.
})
