import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { MOBILE } from './lib/mobile.js'
import { nav } from './lib/nav.js'
import { loadStartupLanguage } from './lib/i18n.js'
import { useStore } from './store/useStore.js'
import './index.css'
import './v2.css'
import './v2-screens.css'
import './v2-social.css'
import './v3-training.css'
import './v3-progress.css'

// The store synchronously restores gym_state_v1 from localStorage. Load its locale pack
// before React's first render so users never see the English source strings flash on boot.
async function startApp() {
  await loadStartupLanguage(useStore.getState().S)
  createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>)
}
startApp()

// Not in the mobile build: the native shell already serves everything from disk.
if (!MOBILE && 'serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {})
  // A notification tap on an already-open tab can't navigate itself (focusing a client
  // doesn't change its route) — the SW posts the target hash back here instead.
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data?.type === 'nav' && e.data.url) nav(e.data.url.replace(/^\.?#?/, '') || '/')
  })
}
