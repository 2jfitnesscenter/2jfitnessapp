// Base-aware URLs. The same bundle can be served at '/' (today) or under a prefix such as
// '/bunker/' (2J Home proxy strips the prefix before reaching the web container). Every path
// the browser requests must therefore carry the build base; Vite exposes it as BASE_URL.
const normalize = base => (typeof base === 'string' && base.startsWith('/') ? base.replace(/\/*$/, '/') : '/')

// base './' (Capacitor/demo) is not a path prefix: API calls stay on the absolute '/api'.
export const makeApiUrl = base => path => {
  const b = normalize(base)
  const p = String(path).replace(/^\/+/, '')
  return b + (p.startsWith('api/') || p === 'api' ? p : 'api/' + p)
}
export const makeAssetUrl = base => path => normalize(base) + String(path).replace(/^\/+/, '')

export const BASE = normalize(import.meta.env?.BASE_URL)
export const apiUrl = makeApiUrl(import.meta.env?.BASE_URL)
export const assetUrl = makeAssetUrl(import.meta.env?.BASE_URL)
