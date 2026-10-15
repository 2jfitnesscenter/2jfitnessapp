import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EXDB, imgSrc, gifSrc } from './exercises.js'
import { STRETCHES } from './stretches.js'

vi.mock('../store/useStore.js', () => ({ useStore: selector => selector({ S: { gifSize: 'full' }, update: () => {} }) }))
import Media, { Thumb } from '../components/Media.jsx'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')

describe('exercise media availability', () => {
  it('restores image and GIF URLs for existing exercise records without changing ids', () => {
    expect(EXDB.length).toBeGreaterThan(0)
    expect(EXDB.every(ex => ex.id)).toBe(true)
    const withBoth = EXDB.find(ex => ex.img && ex.gif)
    expect(withBoth).toBeTruthy()
    expect(imgSrc(withBoth)).toBe(`img/${withBoth.img}`)
    expect(gifSrc(withBoth)).toBe(`gif/${withBoth.gif}`)
    expect(imgSrc({ id: 'custom' })).toBeNull()
    expect(gifSrc({ id: 'custom' })).toBeNull()
  })

  it('renders the animation and a usable fallback when media is absent', () => {
    const animated = EXDB.find(ex => ex.img && ex.gif)
    const html = renderToStaticMarkup(<Media ex={animated} />)
    expect(html).toContain(`src="gif/${animated.gif}"`)
    const missing = renderToStaticMarkup(<Media ex={{ id: 'custom', n: 'My exercise' }} />)
    expect(missing).toContain('exmedia-fallback')
    expect(missing).toContain('My exercise')
    expect(renderToStaticMarkup(<Thumb ex={{ id: 'custom' }} />)).toContain('thumb-x')
  })

  it('keeps historical static and animated URL paths and returns missing files as 404', () => {
    const compose = readFileSync(join(root, 'docker-compose.yml'), 'utf8')
    const nginx = readFileSync(join(root, 'web/nginx.conf'), 'utf8')
    expect(compose).toContain('https://github.com/hasaneyldrm/exercises-dataset')
    expect(compose).toContain('./media/img:/usr/share/nginx/html/img:ro')
    expect(compose).toContain('./media/gif:/usr/share/nginx/html/gif:ro')
    expect(compose).toContain('service_completed_successfully')
    for (const folder of ['img', 'gif', 'stretch']) {
      expect(nginx).toContain(`location ^~ /${folder}/ { try_files $uri =404; }`)
    }
    expect(nginx).not.toMatch(/location\s+\^~\s+\/(img|gif|stretch)\/\s*\{\s*return\s+404/)
  })

  it('serves the tracked stretch illustration referenced by the catalogue', () => {
    expect(STRETCHES.length).toBeGreaterThan(0)
    const stretchPath = join(root, 'frontend/public', STRETCHES[0].img.replace(/^\//, ''))
    expect(existsSync(stretchPath)).toBe(true)
  })

  it('retains the legal inventory and makes no ownership claim when display is enabled', () => {
    const inventory = readFileSync(join(root, 'docs/legal/exercise-media-inventory.csv'), 'utf8')
    const notices = readFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8')
    expect(inventory).toContain('UNKNOWN_OR_UNVERIFIED')
    expect(notices).toContain('By product-owner decision')
    expect(notices).toContain('does not establish a 2J licence or ownership')
  })
})
