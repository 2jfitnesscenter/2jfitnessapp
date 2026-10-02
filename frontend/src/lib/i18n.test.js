import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getLang, loadStartupLanguage, setLang, t } from './i18n.js'

describe('startup locale', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      values: new Map(),
      getItem(key) { return this.values.get(key) ?? null },
      setItem(key, value) { this.values.set(key, String(value)) },
    })
  })

  it('loads the saved Spanish pack before the app mounts', async () => {
    localStorage.setItem('gym_state_v1', JSON.stringify({ lang: 'es' }))
    const savedState = JSON.parse(localStorage.getItem('gym_state_v1'))

    await loadStartupLanguage(savedState)

    expect(getLang()).toBe('es')
    expect(t('Settings')).toBe('Ajustes')
  })

  it('keeps first and final render in Spanish after refresh while an older English load finishes late', async () => {
    localStorage.setItem('gym_state_v1', JSON.stringify({ lang: 'es' }))
    const savedState = JSON.parse(localStorage.getItem('gym_state_v1'))
    let finishOldEnglish
    const oldEnglishLoad = setLang('en', () => new Promise(resolve => { finishOldEnglish = resolve }))

    await loadStartupLanguage(savedState)
    const firstRender = t('Settings')
    finishOldEnglish({ dict: {}, instr: null, names: null })
    await oldEnglishLoad
    const finalRender = t('Settings')

    expect([firstRender, finalRender]).toEqual(['Ajustes', 'Ajustes'])
    expect(getLang()).toBe('es')
  })
})
