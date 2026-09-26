import { supersetUnits } from './history.js'

export function nextAfterBunkerSet(entries, entryIndex, setIndex) {
  const unit = supersetUnits(entries).find(u => u.includes(entryIndex)) || [entryIndex]
  if (unit.length === 1) return { rest: true, nextEntry: null }
  const nextEntry = unit.find(idx => idx !== entryIndex && entries[idx].sets[setIndex] && !entries[idx].sets[setIndex].done)
  return nextEntry === undefined ? { rest: true, nextEntry: null } : { rest: false, nextEntry }
}
