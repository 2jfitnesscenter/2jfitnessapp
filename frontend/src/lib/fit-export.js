// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Garmin FIT export for one finished strength workout. Pure: a workout in, a Uint8Array out, no
// DOM and no network. The encoder is written here from the public FIT protocol description
// (file header, definition/data records, CRC-16); no third-party FIT library is used.
//
// File layout: file_id, one `set` message per working set (reps + weight), a `session` and an
// `activity`. A bodyweight set leaves the weight at the FIT "invalid" value instead of 0 kg.
import { modeOf, workingSets } from './history.js'

export const FIT_NO_SETS_CODE = 'FIT_NO_SETS'

const FIT_EPOCH_OFFSET_S = 631065600 // seconds from 1970-01-01 to FIT's 1989-12-31 epoch
const PROTOCOL_VERSION = 0x20        // FIT 2.0
const PROFILE_VERSION = 2100         // 21.00
const LB_TO_KG = 0.45359237

// Base types (FIT Protocol: base type table) with their invalid ("no value") sentinels.
const BT = {
  enum: { code: 0x00, size: 1, invalid: 0xff },
  uint16: { code: 0x84, size: 2, invalid: 0xffff },
  uint32: { code: 0x86, size: 4, invalid: 0xffffffff },
}

const MESG = { file_id: 0, session: 18, activity: 34, set: 225 }

// name -> [fieldNum, baseType]
const F = {
  file_id: { type: [0, BT.enum], manufacturer: [1, BT.uint16], product: [2, BT.uint16], time_created: [4, BT.uint32] },
  session: {
    event: [0, BT.enum], event_type: [1, BT.enum], start_time: [2, BT.uint32], sport: [5, BT.enum],
    sub_sport: [6, BT.enum], total_elapsed_time: [7, BT.uint32], total_timer_time: [8, BT.uint32],
  },
  activity: {
    total_timer_time: [0, BT.uint32], num_sessions: [1, BT.uint16], type: [2, BT.enum], event: [3, BT.enum],
    event_type: [4, BT.enum], local_timestamp: [5, BT.uint32],
  },
  set: {
    repetitions: [1, BT.uint16], weight: [2, BT.uint16], set_type: [3, BT.enum], message_index: [254, BT.uint16],
  },
}
const TIMESTAMP = [253, BT.uint32]

// Enum values used below.
const FILE_TYPE_ACTIVITY = 4
const MANUFACTURER_DEVELOPMENT = 255
const EVENT_SESSION = 8
const EVENT_ACTIVITY = 26
const EVENT_TYPE_STOP = 1
const SPORT_TRAINING = 10
const SUB_SPORT_STRENGTH = 20
const ACTIVITY_TYPE_MANUAL = 0
const SET_TYPE_ACTIVE = 1

// FIT CRC-16: the FIT SDK's table and nibble-wise update.
const CRC_TABLE = [
  0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401,
  0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400,
]

/** Updates a running FIT CRC-16 with the given bytes. Start from 0. */
export function fitCrc16(bytes, crc = 0) {
  let c = crc & 0xffff
  for (const b of bytes) {
    let tmp = CRC_TABLE[c & 0xf]
    c = (c >> 4) & 0x0fff
    c = c ^ tmp ^ CRC_TABLE[b & 0xf]
    tmp = CRC_TABLE[c & 0xf]
    c = (c >> 4) & 0x0fff
    c = c ^ tmp ^ CRC_TABLE[(b >> 4) & 0xf]
  }
  return c
}

// Little-endian value bytes; null/undefined/NaN become the base type's invalid value.
function valueBytes(value, bt) {
  const n = Number(value)
  const v = value == null || !Number.isFinite(n) ? bt.invalid : Math.max(0, Math.min(bt.invalid - 1, Math.round(n)))
  const out = []
  for (let i = 0; i < bt.size; i++) out.push(Math.floor(v / 2 ** (8 * i)) & 0xff)
  return out
}

// Field list [name, fieldNum, baseType] in the order the fields are written.
function fieldsOf(spec, names) {
  return names.map(name => [name, ...spec[name]])
}

// Definition record: the fixed layout every following data record of this local type uses.
function definition(local, globalNum, fields) {
  const out = [0x40 | local, 0, 0, globalNum & 0xff, (globalNum >> 8) & 0xff, fields.length]
  for (const [, num, bt] of fields) out.push(num, bt.size, bt.code)
  return out
}

// Data record: local type header, then each field's value in definition order.
function dataRecord(local, fields, values) {
  const out = [local]
  for (const [name, , bt] of fields) out.push(...valueBytes(values[name], bt))
  return out
}

/**
 * Working strength sets of a workout: exercises logged as reps (not cardio, not timed), only
 * completed sets, warm-ups and drop sets excluded (same rules the app uses for volume).
 */
export function workingStrengthSets(workout) {
  const out = []
  for (const entry of workout?.entries || []) {
    if (modeOf(entry.target || { id: entry.id }) !== 'reps') continue
    out.push(...workingSets((entry.sets || []).filter(s => s && s.done)))
  }
  return out
}

/**
 * Builds a FIT activity file for one finished workout.
 * @param {object} workout  stored workout: { d, start, end, entries: [{ id, target?, sets: [{ w, r, done }] }] }
 * @param {object} [opts]
 * @param {'kg'|'lb'} [opts.unit='kg']  unit the stored weights are in (the profile unit)
 * @param {number} [opts.tzOffsetMinutes=0]  local offset from UTC, for the activity's local_timestamp
 * @returns {Uint8Array}
 * @throws {Error} with code FIT_NO_SETS_CODE when there is no working strength set to export
 */
export function buildWorkoutFit(workout, { unit = 'kg', tzOffsetMinutes = 0 } = {}) {
  const sets = workingStrengthSets(workout)
  if (!sets.length) {
    const err = new Error('This workout has no strength sets to export')
    err.code = FIT_NO_SETS_CODE
    throw err
  }

  // Stored start is epoch milliseconds; fall back to noon of the workout's day for old records.
  const startMs = Number.isFinite(workout.start) && workout.start > 0 ? workout.start : (Date.parse(`${workout.d}T12:00:00`) || Date.now())
  const endMs = Number(workout.end) > startMs ? Number(workout.end) : startMs
  const startS = Math.floor(startMs / 1000) - FIT_EPOCH_OFFSET_S
  const elapsedMs = endMs - startMs
  const endS = startS + Math.round(elapsedMs / 1000)
  const localS = startS + Math.round(tzOffsetMinutes * 60)

  const body = []

  const fileId = fieldsOf(F.file_id, ['type', 'manufacturer', 'product', 'time_created'])
  body.push(...definition(0, MESG.file_id, fileId))
  body.push(...dataRecord(0, fileId, {
    type: FILE_TYPE_ACTIVITY, manufacturer: MANUFACTURER_DEVELOPMENT, product: 0, time_created: startS,
  }))

  // One set message per working set. Bodyweight sets (no positive weight) leave weight invalid.
  const setFields = [...fieldsOf(F.set, ['repetitions', 'weight', 'set_type', 'message_index']), ['timestamp', ...TIMESTAMP]]
  body.push(...definition(1, MESG.set, setFields))
  sets.forEach((s, i) => {
    const w = Number(s.w)
    const kg = unit === 'lb' ? w * LB_TO_KG : w
    body.push(...dataRecord(1, setFields, {
      repetitions: Number(s.r) > 0 ? Math.round(Number(s.r)) : null,
      weight: w > 0 ? Math.round(kg * 16) : null, // FIT weight: kg, scale 16
      set_type: SET_TYPE_ACTIVE,
      message_index: i,
      timestamp: startS,
    }))
  })

  const sessFields = [...fieldsOf(F.session, ['event', 'event_type', 'start_time', 'sport', 'sub_sport', 'total_elapsed_time', 'total_timer_time']), ['timestamp', ...TIMESTAMP]]
  body.push(...definition(2, MESG.session, sessFields))
  body.push(...dataRecord(2, sessFields, {
    event: EVENT_SESSION, event_type: EVENT_TYPE_STOP, start_time: startS, sport: SPORT_TRAINING,
    sub_sport: SUB_SPORT_STRENGTH, total_elapsed_time: elapsedMs, total_timer_time: elapsedMs, timestamp: endS,
  }))

  const actFields = [...fieldsOf(F.activity, ['total_timer_time', 'num_sessions', 'type', 'event', 'event_type', 'local_timestamp']), ['timestamp', ...TIMESTAMP]]
  body.push(...definition(3, MESG.activity, actFields))
  body.push(...dataRecord(3, actFields, {
    total_timer_time: elapsedMs, num_sessions: 1, type: ACTIVITY_TYPE_MANUAL, event: EVENT_ACTIVITY,
    event_type: EVENT_TYPE_STOP, local_timestamp: localS, timestamp: endS,
  }))

  // 14-byte file header (with its own CRC), the records, then the CRC over everything before it.
  const header = [
    14, PROTOCOL_VERSION, PROFILE_VERSION & 0xff, (PROFILE_VERSION >> 8) & 0xff,
    ...valueBytes(body.length, BT.uint32), 0x2e, 0x46, 0x49, 0x54, // ".FIT"
  ]
  const headerCrc = fitCrc16(header)
  header.push(headerCrc & 0xff, (headerCrc >> 8) & 0xff)
  const file = [...header, ...body]
  const crc = fitCrc16(file)
  file.push(crc & 0xff, (crc >> 8) & 0xff)
  return Uint8Array.from(file)
}

/** Download file name for one workout, e.g. 2jfitness-entreno-2026-11-04.fit */
export function fitFileName(workout) {
  return `2jfitness-entreno-${workout?.d || 'sin-fecha'}.fit`
}
