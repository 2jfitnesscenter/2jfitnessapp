// The openGym import must only ADD. These tests fail if anything we already had changes, if an imported
// exercise is incomplete or clashes with another name, or if a held exercise slips in. The import itself:
// scripts/import-upstream-catalogue.mjs (openGym 8fb98b16, AGPL-3.0).
import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { EXDB } from './exercises-data.js'
import { EXDB_UPSTREAM } from './exercises-upstream.js'
import ES from '../names/es.js'
import { equipmentIdOf } from './protocol/movements.js'
import { checkLibrary, RECOMMENDED } from './library/core.js'

// The text of the two dataset files, measured on disk (not the objects in memory: the library layer reads and corrects
// names at runtime, which main does too). sha256 of the 1,324-exercise literal and of the Spanish names literal, as in main.
const EXDB_TEXT_SHA256 = 'f502c0ba34535a55011c9f71353d66414e673431ec940f368564a530b400771b'
const ES_TEXT_SHA256 = 'daf55432658ead9848164004b575827fe4707bd1cbf8fabff19f2123a6523576'
const BASE_COUNT = 1324
const sha = s => createHash('sha256').update(s).digest('hex')
const base = EXDB.filter(e => !e.ext)
const lineOf = (file, prefix) => readFileSync(new URL(file, import.meta.url), 'utf8').split('\n').find(l => l.startsWith(prefix))

describe('openGym catalogue import: nothing we had changes', () => {
  it('the 1,324 existing exercise records are byte-for-byte the ones in main', () => {
    const json = lineOf('./exercises-data.js', 'const EXDB_BASE=').slice('const EXDB_BASE='.length)
    expect(sha(json)).toBe(EXDB_TEXT_SHA256)
    expect(base).toHaveLength(BASE_COUNT)
  })

  it('the Spanish names of the existing exercises are byte-for-byte the ones in main', () => {
    const json = lineOf('../names/es.js', 'const ES_BASE = ').slice('const ES_BASE = '.length)
    expect(sha(json)).toBe(ES_TEXT_SHA256)
  })

  it('the existing exercises keep their order and their position in the dataset', () => {
    expect(EXDB.slice(0, BASE_COUNT).map(e => e.id)).toEqual(base.map(e => e.id))
    expect(base).toHaveLength(BASE_COUNT)
  })

  it('the Recommended 2J set is still the one from main (210 exercises)', () => {
    expect(RECOMMENDED.size).toBe(210)
    expect([...RECOMMENDED].every(id => base.some(e => e.id === id))).toBe(true)
  })

  it('the dataset is exactly the existing exercises plus the imported ones', () => {
    expect(EXDB).toHaveLength(BASE_COUNT + EXDB_UPSTREAM.length)
    expect(EXDB.filter(e => e.ext)).toHaveLength(EXDB_UPSTREAM.length)
  })
})

describe('imported exercises', () => {
  it('there are 4,214 of them (the 4,308 new ones minus the 94 whose name repeats one we have, see the held list), and every id appears once', () => {
    expect(EXDB_UPSTREAM).toHaveLength(4214)
    expect(new Set(EXDB.map(e => e.id)).size).toBe(EXDB.length)
  })

  it('each one is complete: id, names, body part, equipment, target, muscles and steps', () => {
    for (const e of EXDB_UPSTREAM) {
      expect(e.id, e.id).toMatch(/^\d+$/)
      expect(e.n, e.id).toBeTruthy()
      expect(e.bp, e.id).toBeTruthy()
      expect(e.eq, e.id).toBeTruthy()
      expect(e.tg, e.id).toBeTruthy()
      expect(Array.isArray(e.sm), e.id).toBe(true)
      expect(Array.isArray(e.st) && e.st.length > 0, e.id).toBe(true)
    }
  })

  it('each one points at its still picture on our server; none has an animation yet', () => {
    expect(EXDB_UPSTREAM.every(e => e.img === `opengym/${e.id}.webp`)).toBe(true)
    expect(EXDB_UPSTREAM.every(e => e.gif === null)).toBe(true)
  })

  it('each one has a Spanish name', () => {
    expect(EXDB_UPSTREAM.filter(e => !ES[e.id])).toEqual([])
  })

  it('each equipment string maps to a canonical equipment id (no gym profile is invented)', () => {
    expect(EXDB_UPSTREAM.filter(e => !equipmentIdOf({ id: e.id, eq: e.eq }))).toEqual([])
  })

  it('the library integrity rules hold over the whole dataset (names, aliases, equipment)', () => {
    const { errors } = checkLibrary({ es: ES })
    expect(errors).toEqual([])
  })

  it('nothing held back is in the dataset (see docs/OPENGYM_CATALOGUE_HELD.json)', () => {
    const held = JSON.parse(readFileSync(new URL('../../../docs/OPENGYM_CATALOGUE_HELD.json', import.meta.url), 'utf8')).held
    const ids = new Set(EXDB.map(e => e.id))
    expect(held.length).toBeGreaterThan(0)
    expect(held.filter(h => ids.has(h.id))).toEqual([])
  })
})
