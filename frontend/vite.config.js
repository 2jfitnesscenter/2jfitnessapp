import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolveBase } from './vite.base.js'

const backend = process.env.API_TARGET || 'http://127.0.0.1:3000'
const media = process.env.MEDIA_TARGET || 'http://127.0.0.1:8888'

export default defineConfig({
  plugins: [react()],
  // Capacitor and the static GitHub Pages demo load from a file/subpath and need relative
  // assets. The hosted web app is rooted at /; an absolute base keeps reloads/deep links from
  // resolving assets relative to an incidental URL path.
  // VITE_BASE (e.g. /bunker/) is set only by the 2J Home hub build; see vite.base.js.
  base: resolveBase(process.env),
  server: {
    proxy: {
      '/api': { target: backend, changeOrigin: true },
      '/img': { target: media, changeOrigin: true },
      '/gif': { target: media, changeOrigin: true }
    }
  },
  build: { chunkSizeWarningLimit: 1500 }
})
