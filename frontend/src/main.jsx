import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { MOBILE } from './lib/mobile.js'
import { nav } from './lib/nav.js'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode><App /></StrictMode>
)

// Not in the mobile build: the native shell already serves everything from disk.
if (!MOBILE && 'serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {})
  // A notification tap on an already-open tab can't navigate itself (focusing a client
  // doesn't change its route) — the SW posts the target hash back here instead.
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data?.type === 'nav' && e.data.url) nav(e.data.url.replace(/^\.?#?/, '') || '/')
  })
}
