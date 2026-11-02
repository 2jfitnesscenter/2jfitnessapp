// Build-time public base for the web bundle.
// Unset VITE_BASE keeps today's behaviour exactly: '/' for the hosted web app, './' for
// Capacitor (VITE_MOBILE) and the static demo (VITE_DEMO). The 2J Home hub build sets
// VITE_BASE=/bunker/ because its proxy serves Bunker under that prefix.
export function resolveBase(env = {}) {
  if (env.VITE_MOBILE || env.VITE_DEMO) return './'
  const trimmed = String(env.VITE_BASE || '').trim().replace(/^\/+|\/+$/g, '')
  return trimmed ? `/${trimmed}/` : '/'
}
