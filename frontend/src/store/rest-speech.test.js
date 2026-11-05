import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Sound and vibration are not under test here; stub them so the end-of-rest path runs headless.
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn() }))
vi.mock('../lib/rest-tones.js', () => ({ playRestTone: vi.fn() }))
// This suite runs in node: give the store module the few DOM hooks it touches at load time.
globalThis.window ??= { addEventListener() {}, removeEventListener() {} }
globalThis.document ??={ documentElement: { lang: 'es' }, addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' }

const { announceRestOver, speakRestOver } = await import('./useUI.js')
const { t } = await import('../lib/i18n.js')

const MESSAGE = t('Rest over — next set!')

describe('spoken cue at the end of a rest', () => {
  let speak, cancel, Utter, toast
  beforeEach(() => {
    speak = vi.fn(); cancel = vi.fn()
    Utter = class { constructor(text) { this.text = text; this.lang = '' } }
    window.speechSynthesis = { speak, cancel }
    window.SpeechSynthesisUtterance = Utter
    toast = vi.fn()
  })
  afterEach(() => {
    delete window.speechSynthesis
    delete window.SpeechSynthesisUtterance
  })

  it('reads the end-of-rest message aloud when the cue is on and the rest alert is on', () => {
    announceRestOver({ restAlert: true, sound: false, vibrate: false, speak: true }, toast)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(speak).toHaveBeenCalledTimes(1)
    expect(speak.mock.calls[0][0].text).toBe(MESSAGE)
    expect(toast).toHaveBeenCalledWith(MESSAGE)
  })

  it('stays silent by default (cue off), and the toast is unchanged', () => {
    announceRestOver({ restAlert: true, sound: false, vibrate: false, speak: false }, toast)
    expect(speak).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith(MESSAGE)
  })

  it('never speaks when the rest alert itself is off', () => {
    announceRestOver({ restAlert: false, sound: true, vibrate: true, speak: true }, toast)
    expect(speak).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
  })

  it('does nothing where speech is unavailable, and never throws', () => {
    delete window.speechSynthesis
    expect(speakRestOver('x')).toBe(false)
    window.speechSynthesis = { speak: () => { throw new Error('blocked') }, cancel: () => {} }
    expect(speakRestOver('x')).toBe(false)
    expect(() => announceRestOver({ restAlert: true, speak: true }, toast)).not.toThrow()
    expect(toast).toHaveBeenCalled()
  })
})
