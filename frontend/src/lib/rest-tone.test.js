// End-of-rest tone choice. The default must be exactly the tone the app always played.
import { describe, it, expect } from 'vitest'
import { REST_TONES, REST_TONE_NAMES, DEFAULT_REST_TONE, restToneSequence } from './rest-tones.js'
import { workoutPrefs } from './workout-prefs.js'


describe('end-of-rest tone', () => {
  it('the classic tone is exactly the one this app has always played (880, 880, 1320 at the same timings)', () => {
    expect(REST_TONES.classic).toEqual([[880, 0.15, 0], [880, 0.15, 0.25], [1320, 0.4, 0.5]])
    expect(DEFAULT_REST_TONE).toBe('classic')
  })

  it('every tone is a non-empty sequence of audible notes', () => {
    for (const name of REST_TONE_NAMES) {
      const seq = restToneSequence(name)
      expect(seq.length, name).toBeGreaterThan(0)
      for (const [freq, dur, when] of seq) {
        expect(freq, name).toBeGreaterThan(0)
        expect(dur, name).toBeGreaterThan(0)
        expect(when, name).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('an unknown or missing name falls back to the classic tone, never to silence', () => {
    expect(restToneSequence('nope')).toBe(REST_TONES.classic)
    expect(restToneSequence(undefined)).toBe(REST_TONES.classic)
  })

  it('a profile that never chose a tone plays the classic one; a chosen one is kept; a bad value is ignored', () => {
    expect(workoutPrefs({}).restTone).toBe('classic')
    expect(workoutPrefs({ restTone: 'bell' }).restTone).toBe('bell')
    expect(workoutPrefs({ restTone: 'nope' }).restTone).toBe('classic')
  })
})
