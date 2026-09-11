// Body measurements & composition — a generalised version of the bodyweight time series
// (S.bodyweight) that already existed: S.measurements[key] is the same {d, v, t} shape, just
// keyed by which measurement it is instead of there being exactly one. Two real workflows drive
// this: a member logging their own tape-measure numbers whenever, and a gym admin entering a
// full body assessment (bioimpedance scan + skinfold calipers) from one staff-run session — see
// sheets.jsx's measurementSheet and Admin.jsx's BioimpedanceSheet (which covers both the
// 'composition' and 'folds' groups, since they're typically taken in the same sitting).
export const GROUPS = ['body', 'composition', 'folds']

export const MEASUREMENTS = [
  // ---- circumference, cm — a member's own tape measure ----
  { key: 'neck', label: 'Neck', group: 'body', unit: 'cm', min: 20, max: 60, step: 0.5, dec: true },
  { key: 'shoulders', label: 'Shoulders', group: 'body', unit: 'cm', min: 70, max: 170, step: 0.5, dec: true },
  { key: 'chest', label: 'Chest', group: 'body', unit: 'cm', min: 60, max: 170, step: 0.5, dec: true },
  { key: 'bicepsL', label: 'Left biceps', group: 'body', unit: 'cm', min: 15, max: 60, step: 0.5, dec: true },
  { key: 'bicepsR', label: 'Right biceps', group: 'body', unit: 'cm', min: 15, max: 60, step: 0.5, dec: true },
  { key: 'forearmL', label: 'Left forearm', group: 'body', unit: 'cm', min: 15, max: 50, step: 0.5, dec: true },
  { key: 'forearmR', label: 'Right forearm', group: 'body', unit: 'cm', min: 15, max: 50, step: 0.5, dec: true },
  { key: 'waist', label: 'Waist', group: 'body', unit: 'cm', min: 40, max: 160, step: 0.5, dec: true },
  { key: 'hips', label: 'Hips', group: 'body', unit: 'cm', min: 50, max: 170, step: 0.5, dec: true },
  { key: 'thighL', label: 'Left thigh', group: 'body', unit: 'cm', min: 25, max: 100, step: 0.5, dec: true },
  { key: 'thighR', label: 'Right thigh', group: 'body', unit: 'cm', min: 25, max: 100, step: 0.5, dec: true },
  { key: 'calfL', label: 'Left calf', group: 'body', unit: 'cm', min: 15, max: 60, step: 0.5, dec: true },
  { key: 'calfR', label: 'Right calf', group: 'body', unit: 'cm', min: 15, max: 60, step: 0.5, dec: true },
  // ---- body composition — a bioimpedance scan (e.g. this gym's Tanita) ----
  { key: 'bodyFat', label: 'Body fat', group: 'composition', unit: '%', min: 2, max: 55, step: 0.1, dec: true },
  { key: 'muscleMass', label: 'Muscle mass', group: 'composition', unit: 'kg', min: 10, max: 70, step: 0.1, dec: true },
  { key: 'waterPct', label: 'Body water', group: 'composition', unit: '%', min: 25, max: 75, step: 0.1, dec: true },
  { key: 'visceralFat', label: 'Visceral fat', group: 'composition', unit: '', min: 1, max: 30, step: 1, dec: false },
  { key: 'boneMass', label: 'Bone mass', group: 'composition', unit: 'kg', min: 0.5, max: 6, step: 0.1, dec: true },
  // ---- skinfolds, mm — calipers (a staff assessment, taken alongside the bioimpedance scan) ----
  { key: 'skinTriceps', label: 'Triceps skinfold', group: 'folds', unit: 'mm', min: 2, max: 40, step: 0.5, dec: true },
  { key: 'skinSubscapular', label: 'Subscapular skinfold', group: 'folds', unit: 'mm', min: 2, max: 40, step: 0.5, dec: true },
  { key: 'skinSuprailiac', label: 'Suprailiac skinfold', group: 'folds', unit: 'mm', min: 2, max: 40, step: 0.5, dec: true },
  { key: 'skinAbdominal', label: 'Abdominal skinfold', group: 'folds', unit: 'mm', min: 2, max: 50, step: 0.5, dec: true }
]
export const MEASUREMENT = Object.fromEntries(MEASUREMENTS.map(m => [m.key, m]))

/** Most recent entry for one measurement, or null. */
export const lastMeasurement = (S, key) => {
  const list = S.measurements?.[key]
  return list && list.length ? list[list.length - 1] : null
}
