import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ACCENTS } from './format.js'

// F9c · 2J Home changes the accent, theme and text size through api/platform-hub/settings.js. Those lists must stay exactly what Settings offers,
// so a value valid in one place is valid in the other (the server validates; this test catches drift).
const server = readFileSync(new URL('../../../api/platform-hub/settings.js', import.meta.url), 'utf8')
const list = name => [...server.match(new RegExp(name + String.raw` = Object\.freeze\(\[([^\]]*)\]`))[1].matchAll(/'([^']+)'|([\d.]+)/g)].map(m => m[1] ?? Number(m[2]))
const settings = readFileSync(new URL('../views/Settings.jsx', import.meta.url), 'utf8')

describe('platform hub settings mirror Settings', () => {
  it('accents are the palette', () => { expect(list('HUB_ACCENTS')).toEqual(Object.keys(ACCENTS)) })
  it('themes are the Theme options', () => {
    expect(list('HUB_APPEARANCES')).toEqual(['system', 'dark', 'light'])
    for (const v of ['system', 'dark', 'light']) expect(settings).toContain(`value: '${v}'`)
  })
  it('text sizes are the Text size steps', () => {
    expect(list('HUB_TEXT_SCALES')).toEqual([0.9, 1, 1.15, 1.3])
    for (const v of ['0.9', '1,', '1.15', '1.3']) expect(settings).toContain(`value: ${v}`)
  })
  it('Settings → Data is reachable as /settings#data', () => { expect(settings).toContain('id="data"') })
})
