import { describe, it, expect } from 'vitest'
import { buildWorkoutFit, fitCrc16, fitFileName, workingStrengthSets, FIT_NO_SETS_CODE } from './fit-export.js'
import { EXDB } from './exercises.js'

const LIFT = EXDB.find(e => e.bp !== 'cardio').id
const CARDIO = EXDB.find(e => e.bp === 'cardio').id
const START = Date.UTC(2026, 10, 4, 10, 0, 0)
const END = START + 45 * 60 * 1000
const FIT_EPOCH_S = 631065600

const workout = (entries, extra = {}) => ({ id: 'w1', d: '2026-11-04', start: START, end: END, entries, ...extra })
const lift = (sets, extra = {}) => ({ id: LIFT, sets, ...extra })

// Independent reader for the FIT layout, written from the protocol description (not from the encoder).
function parseFit(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const headerSize = bytes[0]
  const dataSize = dv.getUint32(4, true)
  const signature = String.fromCharCode(...bytes.slice(8, 12))
  const end = headerSize + dataSize
  const defs = {}
  const msgs = []
  let p = headerSize
  while (p < end) {
    const rh = bytes[p++]
    const local = rh & 0x0f
    if (rh & 0x40) {
      const bigEndian = bytes[p + 1] === 1
      const gmn = bigEndian ? dv.getUint16(p + 2, false) : dv.getUint16(p + 2, true)
      const n = bytes[p + 4]
      p += 5
      const fields = []
      for (let i = 0; i < n; i++) { fields.push({ num: bytes[p], size: bytes[p + 1], base: bytes[p + 2] }); p += 3 }
      defs[local] = { gmn, fields }
    } else {
      const d = defs[local]
      const values = {}
      for (const f of d.fields) {
        values[f.num] = f.size === 1 ? bytes[p] : f.size === 2 ? dv.getUint16(p, true) : dv.getUint32(p, true)
        p += f.size
      }
      msgs.push({ gmn: d.gmn, values })
    }
  }
  return { headerSize, dataSize, signature, end, msgs, dv, bytes }
}

const setsOf = fit => fit.msgs.filter(m => m.gmn === 225)

describe('fitCrc16', () => {
  it('matches the CRC-16/ARC check value for "123456789"', () => {
    expect(fitCrc16([...'123456789'].map(c => c.charCodeAt(0)))).toBe(0xbb3d)
  })

  it('is zero over a buffer that already ends with its own CRC (little-endian)', () => {
    const data = [1, 2, 3, 250, 17]
    const crc = fitCrc16(data)
    expect(fitCrc16([...data, crc & 0xff, crc >> 8])).toBe(0)
  })
})

describe('buildWorkoutFit — container', () => {
  const bytes = buildWorkoutFit(workout([lift([{ w: 80, r: 5, done: true }])]))

  it('returns a Uint8Array with a 14-byte header and the .FIT signature', () => {
    expect(bytes).toBeInstanceOf(Uint8Array)
    const fit = parseFit(bytes)
    expect(fit.headerSize).toBe(14)
    expect(bytes[1]).toBe(0x20)
    expect(fit.signature).toBe('.FIT')
  })

  it('has a valid header CRC over the first 12 bytes', () => {
    const stored = bytes[12] | (bytes[13] << 8)
    expect(fitCrc16(bytes.slice(0, 12))).toBe(stored)
  })

  it('declares the data size and has a valid whole-file CRC', () => {
    const fit = parseFit(bytes)
    expect(fit.dataSize).toBe(bytes.length - 14 - 2)
    const stored = bytes[bytes.length - 2] | (bytes[bytes.length - 1] << 8)
    expect(fitCrc16(bytes.slice(0, -2))).toBe(stored)
  })

  it('starts with a file_id of type activity', () => {
    const fit = parseFit(bytes)
    expect(fit.msgs[0].gmn).toBe(0)
    expect(fit.msgs[0].values[0]).toBe(4)
  })

  it('writes the session start time as FIT seconds and ends with an activity message', () => {
    const fit = parseFit(bytes)
    const session = fit.msgs.find(m => m.gmn === 18)
    expect(session.values[2]).toBe(Math.floor(START / 1000) - FIT_EPOCH_S)
    expect(session.values[7]).toBe(END - START) // elapsed, scale 1000 ms
    expect(fit.msgs.at(-1).gmn).toBe(34)
  })
})

describe('buildWorkoutFit — sets', () => {
  it('writes one set message per working set', () => {
    const bytes = buildWorkoutFit(workout([
      lift([{ w: 60, r: 10, done: true }, { w: 60, r: 8, done: true }, { w: 60, r: 6, done: true }]),
      { id: LIFT, sets: [{ w: 90, r: 3, done: true }] },
    ]))
    expect(setsOf(parseFit(bytes))).toHaveLength(4)
  })

  it('skips warm-up, drop and not-done sets', () => {
    const sets = workingStrengthSets(workout([lift([
      { w: 20, r: 10, done: true, type: 'warmup' },
      { w: 60, r: 8, done: true },
      { w: 40, r: 8, done: true, type: 'drop' },
      { w: 60, r: 8, done: false },
    ])]))
    expect(sets).toHaveLength(1)
  })

  it('encodes weight in kg with scale 16 and reps as a plain count', () => {
    const fit = parseFit(buildWorkoutFit(workout([lift([{ w: 80, r: 5, done: true }])])))
    const [s] = setsOf(fit)
    expect(s.values[2]).toBe(80 * 16)
    expect(s.values[1]).toBe(5)
  })

  it('converts pounds to kilograms when the profile unit is lb', () => {
    const fit = parseFit(buildWorkoutFit(workout([lift([{ w: 100, r: 5, done: true }])]), { unit: 'lb' }))
    expect(setsOf(fit)[0].values[2]).toBe(Math.round(100 * 0.45359237 * 16))
  })

  it('leaves the weight invalid for bodyweight sets instead of writing 0 kg', () => {
    const fit = parseFit(buildWorkoutFit(workout([lift([
      { w: 0, r: 12, done: true },
      { w: 80, r: 5, done: true },
    ])])))
    const [bw, loaded] = setsOf(fit)
    expect(bw.values[2]).toBe(0xffff)
    expect(bw.values[1]).toBe(12)
    expect(loaded.values[2]).toBe(1280)
  })

  it('numbers set messages by message_index from zero', () => {
    const fit = parseFit(buildWorkoutFit(workout([lift([{ w: 50, r: 5, done: true }, { w: 50, r: 5, done: true }])])))
    expect(setsOf(fit).map(s => s.values[254])).toEqual([0, 1])
  })
})

describe('buildWorkoutFit — scope and errors', () => {
  it('leaves cardio and timed exercises out of the strength file', () => {
    const sets = workingStrengthSets(workout([
      { id: CARDIO, sets: [{ min: 20, speed: 9, done: true }] },
      { id: LIFT, target: { id: LIFT, mode: 'time' }, sets: [{ sec: 40, done: true }] },
    ]))
    expect(sets).toHaveLength(0)
  })

  it('throws a clear error with a code for an empty workout instead of a corrupt file', () => {
    expect(() => buildWorkoutFit(workout([]))).toThrow(/no strength sets/)
    try { buildWorkoutFit(workout([])) } catch (e) { expect(e.code).toBe(FIT_NO_SETS_CODE) }
  })

  it('throws for a workout with only cardio or only warm-up sets', () => {
    expect(() => buildWorkoutFit(workout([{ id: CARDIO, sets: [{ min: 10, done: true }] }]))).toThrow()
    expect(() => buildWorkoutFit(workout([lift([{ w: 20, r: 10, done: true, type: 'warmup' }])]))).toThrow()
  })
})

describe('fitFileName', () => {
  it('names the file after the workout day', () => {
    expect(fitFileName(workout([]))).toBe('2jfitness-entreno-2026-11-04.fit')
  })
})
