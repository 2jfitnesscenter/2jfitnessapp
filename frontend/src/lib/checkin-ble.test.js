import { beforeEach, describe, expect, it, vi } from 'vitest'
import { saveCheckin, skipCheckin, checkinOn, shouldAskCheckin, checkinAdvice, checkinFacts, sanitizeCheckin } from './checkin.js'
import { parseHeartRate, bleSupported, connectHeartRate, reconnectHeartRate, disconnectHeartRate, finishHeartRate, useHR } from './ble-hr.js'
import { EXIDX } from './exercises.js'

describe('check-in', () => {
  const S0 = over => ({ checkins: [], ...over })
  it('saves one entry per day (last wins), sanitized, and clears a same-day skip', () => {
    const s = S0({ checkinSkipped: '2026-09-24' })
    saveCheckin(s, { energy: 4, sleep: 2, fatigue: 5, pain: true, zones: ['shoulder', 'bogus'], note: '  hombro derecho  ' }, '2026-09-24', 1)
    saveCheckin(s, { energy: 3, sleep: 9, fatigue: 0, pain: false }, '2026-09-24', 2)
    expect(s.checkins).toEqual([{ d: '2026-09-24', t: 2, energy: 3, sleep: null, fatigue: null, pain: false }])
    expect(s.checkinSkipped).toBeUndefined()
    expect(sanitizeCheckin({ pain: true, zones: [] }).pain).toBe(false)          // "yes" with no zone is not saved as pain
    expect(sanitizeCheckin({ note: 'x'.repeat(300) }).note).toHaveLength(140)
  })
  it('asks per the setting, never for a past log, never twice a day or after a skip', () => {
    expect(shouldAskCheckin(S0(), {}, '2026-09-24')).toBe(true)                                       // default: now and then
    expect(shouldAskCheckin(S0({ checkinMode: 'off' }), {}, '2026-09-24')).toBe(false)
    expect(shouldAskCheckin(S0(), { past: true }, '2026-09-24')).toBe(false)
    const s = S0({ checkinMode: 'ask' }); saveCheckin(s, { energy: 3 }, '2026-09-24')
    expect(shouldAskCheckin(s, {}, '2026-09-24')).toBe(false)
    expect(shouldAskCheckin(s, {}, '2026-09-25')).toBe(true)
    const some = S0(); saveCheckin(some, { energy: 3 }, '2026-09-22')
    expect(shouldAskCheckin(some, {}, '2026-09-24')).toBe(false)                                     // 2 days ago
    expect(shouldAskCheckin(some, {}, '2026-09-25')).toBe(true)                                      // 3 days
    const sk = S0({ checkinMode: 'ask' }); skipCheckin(sk, '2026-09-24')
    expect(shouldAskCheckin(sk, {}, '2026-09-24')).toBe(false)
    expect(checkinOn(sk, '2026-09-24')).toBeNull()
  })
  it('advice only in words: tired day, and discomfort only on exercises that load that area', () => {
    const bench = EXIDX['0025'], squat = EXIDX['0043']
    const c = { fatigue: 5, sleep: 1, pain: true, zones: ['shoulder'] }
    expect(checkinAdvice(c, bench)).toMatchObject({ tired: true })
    const shoulderPress = EXIDX['1457']
    expect(checkinAdvice(c, shoulderPress).zones).toEqual(['shoulder'])
    expect(checkinAdvice({ fatigue: 2, sleep: 4, pain: true, zones: ['shoulder'] }, squat)).toBeNull()
    expect(checkinAdvice(null, bench)).toBeNull()
  })
  it('trainer facts are counts, never labels', () => {
    const s = S0()
    ;['2026-09-18', '2026-09-20', '2026-09-22', '2026-09-24'].forEach((d, i) => saveCheckin(s, { energy: 2, sleep: 2, fatigue: i ? 5 : 2, pain: true, zones: ['knee'] }, d))
    const f = checkinFacts(s, '2026-09-24')
    expect(f).toMatchObject({ count: 4, highFatigue: 3, repeatedPain: [{ zone: 'knee', n: 4 }] })
    expect(JSON.stringify(f)).not.toMatch(/injur|overtrain|risk/i)
  })
})

describe('Bluetooth heart rate (standard HR service)', () => {
  const view = bytes => new DataView(new Uint8Array(bytes).buffer)
  it('parses uint8 and uint16 heart-rate measurements', () => {
    expect(parseHeartRate(view([0x00, 146]))).toBe(146)
    expect(parseHeartRate(view([0x01, 0x2c, 0x01]))).toBeNull()                  // 300 bpm: not a plausible reading
    expect(parseHeartRate(view([0x01, 0x92, 0x00]))).toBe(146)
    expect(parseHeartRate(view([0x00]))).toBeNull()
  })
  it('feature detection: unsupported browsers (iPhone) get nothing to press', () => {
    vi.stubGlobal('navigator', {})
    expect(bleSupported()).toBe(false)
    vi.stubGlobal('navigator', { bluetooth: { requestDevice: () => {} } })
    expect(bleSupported()).toBe(true)
    vi.unstubAllGlobals()
  })

  let device, characteristic, listeners
  const fakeBt = (fail = null) => ({
    requestDevice: vi.fn(async () => { if (fail) throw Object.assign(new Error(fail), { name: fail }); return device }),
  })
  beforeEach(() => {
    listeners = {}
    characteristic = {
      addEventListener: (ev, fn) => { listeners[ev] = fn }, removeEventListener: vi.fn(), startNotifications: vi.fn(async () => {}),
    }
    device = {
      name: 'Strap', gatt: { connected: true, connect: vi.fn(async () => ({ getPrimaryService: async () => ({ getCharacteristic: async () => characteristic }) })), disconnect: vi.fn() },
      addEventListener: (ev, fn) => { listeners['dev:' + ev] = fn }, removeEventListener: vi.fn(),
    }
    disconnectHeartRate()
  })
  const beat = bpm => listeners.characteristicvaluechanged({ target: { value: view([0x00, bpm]) } })

  it('connect → live readings → summary at finish (avg/max/zones), then released', async () => {
    expect(await connectHeartRate('w1', 190, fakeBt())).toBe(true)
    expect(useHR.getState()).toMatchObject({ status: 'live', name: 'Strap' })
    beat(120); beat(160)
    expect(useHR.getState().bpm).toBe(160)
    const r = finishHeartRate('w1')
    expect(r).toMatchObject({ avgHr: 140, maxHr: 160, samples: 2, zones: { derived: true } })
    expect(useHR.getState().status).toBe('idle')
    expect(device.gatt.disconnect).toHaveBeenCalled()
    expect(finishHeartRate('w1')).toBeNull()
  })
  it('permission denied, chooser closed, unsupported', async () => {
    expect(await connectHeartRate('w1', 190, fakeBt('NotAllowedError'))).toBe(false)
    expect(useHR.getState().status).toBe('denied')
    expect(await connectHeartRate('w1', 190, fakeBt('NotFoundError'))).toBe(false)
    expect(useHR.getState().status).toBe('idle')
    expect(await connectHeartRate('w1', 190, null)).toBe(false)
    expect(useHR.getState()).toMatchObject({ status: 'error', error: 'unsupported' })
  })
  it('a dropped sensor is "lost" and reconnects without losing the session summary', async () => {
    await connectHeartRate('w2', 190, fakeBt())
    beat(130)
    listeners['dev:gattserverdisconnected']()
    expect(useHR.getState()).toMatchObject({ status: 'lost', bpm: null })
    expect(await reconnectHeartRate()).toBe(true)
    beat(150)
    expect(finishHeartRate('w2')).toMatchObject({ avgHr: 140, maxHr: 150, samples: 2 })
  })
})
