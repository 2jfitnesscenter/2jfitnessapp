// The end-of-rest tone the member chooses (Settings → Rest). Each entry is a sequence of [frequency Hz, duration s, start s].
// 'classic' is exactly the tone this app has always played, so a profile that never chose one hears no change.
// Kept apart from sound.js (which only makes the beeps) so the names can be read without touching audio.
import { beep } from './sound.js'

export const REST_TONES = {
  classic: [[880, 0.15, 0], [880, 0.15, 0.25], [1320, 0.4, 0.5]],
  chime: [[1046, 0.3, 0], [1318, 0.3, 0.25], [1568, 0.6, 0.5]],
  bell: [[1568, 0.9, 0]],
  beepbeep: [[1000, 0.12, 0], [1000, 0.12, 0.2]],
  whistle: [[2000, 0.35, 0], [2400, 0.35, 0.4]],
  soft: [[660, 0.25, 0], [660, 0.25, 0.35]],
}
export const DEFAULT_REST_TONE = 'classic'
export const REST_TONE_NAMES = Object.keys(REST_TONES)
// Unknown or missing names fall back to the classic tone, never to silence.
export const restToneSequence = name => REST_TONES[name] || REST_TONES[DEFAULT_REST_TONE]
export function playRestTone(enabled, name) {
  for (const [freq, dur, when] of restToneSequence(name)) beep(enabled, freq, dur, when)
}
