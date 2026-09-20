// One color per superset GROUP, assigned deterministically by the order groups first appear
// when a routine's (or a live session's) own exercises are read top to bottom — never by the
// group's own `sg` value, which is an opaque uid() the routine/progression engine mints, not a
// stable letter or index. Reading by first-appearance order is what makes the same group keep
// the same color across a re-render or a reorder that doesn't change which units exist, and
// it's why routine A's own "group A" and routine B's own "group A" both read as the same color
// — the whole point of labeling by position rather than by id.
//
// The palette draws only from index.css's existing named tokens (already themed for light and
// dark) and deliberately skips every color already reserved for something else in this app:
// green is the single accent (--acc) and would make a superset look like "the current
// selection"; orange is unavailable/warning (see e.g. "No disponible ahora mismo"); red is
// error/danger; yellow is PR/record. Reusing any of those for a superset group would make that
// group's color lie about what it means.
import { supersetUnits } from './history.js'

export const SUPERSET_COLOR_TOKENS = ['purple', 'teal', 'pink', 'indigo', 'mint', 'blue', 'brown']
export const SUPERSET_GROUP_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

// The same seven hues as literal sRGB, for the print/PDF path (plan-share.js's own fixed,
// always-light palette — print never reads the app's live theme tokens, see that file's own
// doc comment on why) — picked dark/saturated enough to read on the print sheet's cream/white
// background, not just the token's on-screen value.
export const SUPERSET_PRINT_COLORS = {
  purple: '#8944ab', teal: '#1f7a8a', pink: '#c23464', indigo: '#4341b0',
  mint: '#0d8a72', blue: '#0060df', brown: '#8a6d4a',
}

/**
 * One entry per item in `ex` (a routine's own `ex`, or a live session's `entries` — anything
 * supersetUnits() already accepts), aligned 1:1 by index:
 *   - `null` for an item that isn't part of a superset (a lone exercise)
 *   - `{ letter, pos, size, token }` for one that is: `letter` is the group's own A/B/C…,
 *     `pos` is this item's 1-based position inside the group (so "A1"/"A2" is
 *     `letter + pos`), `size` is the group's total exercise count, and `token` indexes into
 *     SUPERSET_COLOR_TOKENS/SUPERSET_PRINT_COLORS — wrapping back to the palette's start if a
 *     routine somehow has more groups than colors, deterministically (never at random).
 */
export function supersetGroupInfo(ex) {
  const units = supersetUnits(ex || [])
  const out = new Array((ex || []).length).fill(null)
  let groupIdx = 0
  units.forEach(u => {
    if (u.length < 2) return
    const letter = SUPERSET_GROUP_LETTERS[groupIdx % SUPERSET_GROUP_LETTERS.length]
    const token = SUPERSET_COLOR_TOKENS[groupIdx % SUPERSET_COLOR_TOKENS.length]
    u.forEach((idx, i) => { out[idx] = { letter, pos: i + 1, size: u.length, token } })
    groupIdx++
  })
  return out
}

// "A1", "B2"… — the plain-text identifier next to a superset exercise's name.
export const supersetLabel = info => (info ? `${info.letter}${info.pos}` : '')
