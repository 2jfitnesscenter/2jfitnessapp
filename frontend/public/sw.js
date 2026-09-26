/* 2J Fitness Center service worker. Private/API data is never cached. */
const VERSION = 'v2'
const SHELL = `2jfitness-shell-${VERSION}`
const ASSETS = `2jfitness-assets-${VERSION}`
const MEDIA = `2jfitness-media-${VERSION}`

// Do not skipWaiting: a downloaded update activates after existing tabs release the previous
// worker, so a live workout never swaps code halfway through the session.
self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(cache => cache.addAll(['./', './index.html'])))
})
self.addEventListener('activate', event => {
  const current = new Set([SHELL, ASSETS, MEDIA])
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => !current.has(key)).map(key => caches.delete(key))))
    .then(() => self.clients.claim()))
})
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {}
  event.waitUntil(self.registration.showNotification(data.title || '2J Fitness Center', {
    body: data.body || '', icon: 'icon-512.png', badge: 'icon-180.png',
    tag: data.tag || '2jfitness', renotify: true, data: { url: data.url || './' }
  }))
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

const cacheFirst = (request, cacheName) => caches.open(cacheName).then(async cache => {
  const hit = await cache.match(request)
  if (hit) return hit
  const response = await fetch(request)
  if (response.ok) await cache.put(request, response.clone())
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
