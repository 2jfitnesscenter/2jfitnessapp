import { describe, expect, it } from 'vitest'
import { EXDB, imgSrc, gifSrc } from './exercises.js'
import { EXERCISE_DATASET_MEDIA_ENABLED, STRETCH_ILLUSTRATIONS_ENABLED } from './exercise-media-policy.js'
import { STRETCHES } from './stretches.js'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')

describe('exercise media rights gate', () => {
  it('preserves exercise records but never emits unverified upstream image or GIF URLs', () => {
    expect(EXDB.length).toBeGreaterThan(0)
    expect(EXERCISE_DATASET_MEDIA_ENABLED).toBe(false)
    for (const ex of EXDB) {
      if (ex.img) expect(imgSrc(ex)).toBeNull()
      if (ex.gif) expect(gifSrc(ex)).toBeNull()
    }
  })

  it('keeps stretch IDs and illustration references while withholding those images', () => {
    expect(STRETCHES.length).toBeGreaterThan(0)
    expect(STRETCHES.every(x => x.id && x.img)).toBe(true)
    expect(STRETCH_ILLUSTRATIONS_ENABLED).toBe(false)
  })

  it('does not fetch/mount unverified dataset media and blocks direct public paths', () => {
    const compose = readFileSync(join(root, 'docker-compose.yml'), 'utf8')
    const nginx = readFileSync(join(root, 'web/nginx.conf'), 'utf8')
    expect(compose).not.toMatch(/git clone[^\n]*hasaneyldrm\/exercises-dataset/)
    expect(compose).not.toContain('./media/img:/usr/share/nginx/html/img')
    expect(nginx).toContain('location ^~ /img/ { return 404; }')
    expect(nginx).toContain('location ^~ /gif/ { return 404; }')
    expect(nginx).toContain('location ^~ /stretch/ { return 404; }')
  })
})
