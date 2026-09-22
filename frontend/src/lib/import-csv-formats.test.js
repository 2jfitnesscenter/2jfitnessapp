// V1.3 — the three REAL exports this session was given, trimmed to what matters and stripped
// of anything personal, plus the one unnamed format (export983335809966994502.csv) whose app
// couldn't be identified with confidence from its columns alone — see import-csv.js's own
// header comment. Real headers, real enum spellings (NORMAL_SET vs normal vs Normal), on
// purpose: a typo in a fixture header is exactly the kind of thing that would silently pass a
// looser test and then fail on the real file.
import { describe, it, expect } from 'vitest'
import { parseWorkoutCSV, detectSource, parseCSV } from './import-csv.js'

const rows = (head, ...lines) => parseWorkoutCSV([head, ...lines].join('\n'), { unit: 'kg' })
const setsOf = p => p.workouts.flatMap(w => w.entries.flatMap(e => e.sets))
const header = csv => parseCSV(csv)[0]

// -------------------------------------------------------------- Hevy (workout_data.csv) ----
const HEVY = 'title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe'

describe('Hevy (workout_data.csv)', () => {
  it('is detected by its own column signature', () => {
    expect(detectSource(header(HEVY))).toBe('Hevy')
  })

  it('groups two different exercises sharing one superset_id into an adjacent 2J superset', () => {
    const p = rows(HEVY,
      'Leg-Shoulders,"28 may 2024, 11:24","28 may 2024, 12:11",,Leg Extension,0,,0,warmup,40,20,,0,',
      'Leg-Shoulders,"28 may 2024, 11:24","28 may 2024, 12:11",,Leg Extension,0,,1,normal,50,12,,0,',
      'Leg-Shoulders,"28 may 2024, 11:24","28 may 2024, 12:11",,Seated Shoulder Press,0,,0,warmup,5,20,,0,',
      'Leg-Shoulders,"28 may 2024, 11:24","28 may 2024, 12:11",,Seated Shoulder Press,0,,1,normal,15,12,,0,',
      // a different, unrelated exercise with NO superset_id — must stay solo
      'Leg-Shoulders,"28 may 2024, 11:24","28 may 2024, 12:11",,Standing Calf Raise,,,0,normal,20,10,,0,')
    const entries = p.workouts[0].entries
    expect(entries).toHaveLength(3)
    expect(entries[0].id).toBeTruthy()
    expect(entries[0].sg).toBeTruthy()
    expect(entries[1].sg).toBe(entries[0].sg)   // same group
    expect(entries[2].sg).toBeUndefined()        // the solo exercise never gets one
  })

  it('leaves every exercise solo when superset_id is blank throughout the workout', () => {
    const p = rows(HEVY,
      'Pull,"27 may 2024, 11:08","27 may 2024, 11:56",,Lat Pulldown (Cable),,,0,warmup,25,20,,0,',
      'Pull,"27 may 2024, 11:08","27 may 2024, 11:56",,Seated Row (Cable),,,0,normal,30,12,,0,')
    expect(p.workouts[0].entries.every(e => e.sg === undefined)).toBe(true)
  })

  it('keeps two sessions on the same day separate when their start times differ', () => {
    const p = rows(HEVY,
      'Morning,"28 may 2024, 08:00","28 may 2024, 08:45",,Bench Press,,,0,normal,60,8,,0,',
      'Morning,"28 may 2024, 08:00","28 may 2024, 08:45",,Bench Press,,,1,normal,60,8,,0,',
      'Evening,"28 may 2024, 19:30","28 may 2024, 20:00",,Squat,,,0,normal,100,5,,0,')
    expect(p.workouts).toHaveLength(2)
    expect(p.workouts.map(w => w.name)).toEqual(['Morning', 'Evening'])
    expect(p.workouts[0].start).not.toBe(p.workouts[1].start)
  })
})

// ------------------------------------------------------------------------------- Gravl -----
const GRAVL = 'Date,Start Date,Workout,Source,Workout Duration (min),Energy,Exercise,Superset,Set,Set Type,Reps,Weight (kg),Distance (km),Set Duration (sec),Incline,Steps,Effort,Workout Notes'

describe('Gravl (gravl-workouts-*.csv)', () => {
  it('is detected by its own column signature', () => {
    expect(detectSource(header(GRAVL))).toBe('Gravl')
  })

  it('reads its year-first, slash-separated date combined with the separate time-of-day column', () => {
    const p = rows(GRAVL,
      '2026/06/05,16:09,Viernes,,38,81,Extension de piernas,No,1,Normal,11,50,0,,,,Ideal,')
    expect(p.workouts).toHaveLength(1)
    expect(p.workouts[0].d).toBe('2026-06-05')
    // 16:09 on 2026-06-05 local, i.e. hour 16 minute 9 past that day's midnight
    const startOfDay = new Date('2026-06-05T00:00:00').getTime()
    expect(p.workouts[0].start - startOfDay).toBe(16 * 3600000 + 9 * 60000)
  })

  it('recognises "Calentamiento" as a warmup set, same as an English "warmup"', () => {
    const p = rows(GRAVL,
      '2026/06/05,16:09,Viernes,,38,81,Extension de piernas,No,1,Calentamiento,20,20,0,,,,Ideal,',
      '2026/06/05,16:09,Viernes,,38,81,Extension de piernas,No,2,Normal,11,50,0,,,,Ideal,')
    expect(p.warmups).toBe(1)
  })

  it('imports a Health-Connect-synced cardio row (duration only, no distance) as a cardio set', () => {
    const p = rows(GRAVL,
      '2026/06/27,13:12,Entrenamiento externo - 27/6/2026,Health Connect,12,10,Caminar,No,0,Normal,0,0,0,779,,,,')
    const s = setsOf(p)[0]
    expect(s.r).toBeUndefined()
    expect(s.min).toBeCloseTo(779 / 60, 1)
  })

  it('never mistakes the qualitative Effort column (Ideal/Difícil/Fácil) for a numeric RPE or RIR', () => {
    const p = rows(GRAVL,
      '2026/06/05,16:09,Viernes,,38,81,Extension de piernas,No,1,Normal,11,50,0,,,,Dificil,')
    const s = setsOf(p)[0]
    expect(s.rpe).toBeUndefined()
    expect(s.rir).toBeUndefined()
    expect(p.rpeSets).toBe(0)
    expect(p.rirSets).toBe(0)
  })

  it('does not invent a superset out of Gravl\'s own "No" sentinel', () => {
    const p = rows(GRAVL,
      '2026/06/05,16:09,Viernes,,38,81,Extension de piernas,No,1,Normal,11,50,0,,,,Ideal,',
      '2026/06/05,16:09,Viernes,,38,81,Prensa de piernas,No,1,Normal,12,100,0,,,,Ideal,')
    expect(p.workouts[0].entries.every(e => e.sg === undefined)).toBe(true)
  })
})

// ---------------------------------------------------- unnamed format (export…994502.csv) ---
// App not identified with confidence from the header alone (see import-csv.js) — imports
// through the same generic column matching everything else falls back to, with no forced
// brand name. NORMAL_SET/WARMUP_SET/DROP_SET is this format's own real enum spelling.
const UNNAMED = 'Title,Date,Duration,Exercise,"Superset id",Weight,Reps,Distance,Time,"Set Type"'

describe('unnamed format (export983335809966994502.csv)', () => {
  it('is not misidentified as Hevy or Gravl', () => {
    const src = detectSource(header(UNNAMED))
    expect(src).not.toBe('Hevy')
    expect(src).not.toBe('Gravl')
  })

  it('imports ordinary sets, recognising WARMUP_SET as a warmup', () => {
    const p = rows(UNNAMED,
      '"FRIDAY (CHEST)","2026-08-20 12:35:12",00:27:52,"Incline Bench Press",1,20.000,10,null,null,WARMUP_SET',
      '"FRIDAY (CHEST)","2026-08-20 12:35:12",00:27:52,"Incline Bench Press",1,22.500,8,null,null,NORMAL_SET')
    expect(p.error).toBeUndefined()
    expect(p.warmups).toBe(1)
    expect(setsOf(p).map(s => s.w)).toEqual([20, 22.5])
  })

  // The real file numbers EVERY exercise with its own "Superset id" (1,2,3,4…), never
  // repeating a number on a different exercise next to it — the opposite of Hevy's own
  // demonstrated convention (same id shared by 2+ exercises = grouped). Forcing a superset
  // reading onto that would be exactly the invented-format-semantics the brief warns against,
  // so this format's own distinct exercises stay solo.
  it('does not group different exercises that merely carry different, non-repeating Superset id numbers', () => {
    const p = rows(UNNAMED,
      '"FRIDAY (CHEST)","2026-08-20 12:35:12",00:27:52,"Incline Bench Press",1,20.000,10,null,null,NORMAL_SET',
      '"FRIDAY (CHEST)","2026-08-20 12:35:12",00:27:52,"Lever Chest Press",2,40.000,10,,,NORMAL_SET',
      '"FRIDAY (CHEST)","2026-08-20 12:35:12",00:27:52,"Lever Seated Fly",3,22.000,10,,,NORMAL_SET')
    expect(p.workouts[0].entries.every(e => e.sg === undefined)).toBe(true)
  })

  it('still groups two exercises that DO repeat the exact same Superset id value, adjacently', () => {
    const p = rows(UNNAMED,
      '"Day","2026-08-20 12:35:12",00:10:00,"Exercise A",7,20.000,10,,,NORMAL_SET',
      '"Day","2026-08-20 12:35:12",00:10:00,"Exercise B",7,20.000,10,,,NORMAL_SET')
    const entries = p.workouts[0].entries
    expect(entries[0].sg).toBeTruthy()
    expect(entries[1].sg).toBe(entries[0].sg)
  })
})

// --------------------------------------------------------------------- safety / robustness --
describe('CSV import safety', () => {
  it('keeps the historical one-workout-per-day fallback when the CSV has no time', () => {
    const p = rows('Date,Exercise,Weight,Reps',
      '2026-08-20,Bench Press,60,8',
      '2026-08-20,Squat,100,5')
    expect(p.workouts).toHaveLength(1)
    expect(p.workouts[0].entries).toHaveLength(2)
  })

  it('skips a malformed row instead of corrupting the import', () => {
    const p = rows(HEVY,
      'Push,"12 Jan 2026, 18:00","12 Jan 2026, 19:00",,Bench Press,,,,normal,60,10,,0,',
      // an unparseable date on an otherwise real-looking row — must be counted and
      // skipped, not thrown, and must not derail the rest of the import
      'Push,not-a-real-date,,,Squat,,,,normal,60,10,,0,')
    expect(p.error).toBeUndefined()
    expect(p.skipped).toBeGreaterThanOrEqual(1)
    expect(p.workouts).toHaveLength(1)
    expect(setsOf(p)).toHaveLength(1)   // only the good row made it through
  })

  it('never throws on a completely unrecognised header', () => {
    const p = parseWorkoutCSV('Foo,Bar,Baz\n1,2,3', { unit: 'kg' })
    expect(p.error).toBe('unrecognised')
  })

  it('reports the empty-file case distinctly from an unrecognised one', () => {
    expect(parseWorkoutCSV('', { unit: 'kg' }).error).toBe('empty')
  })
})
