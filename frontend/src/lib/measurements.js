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

// Healthy body-fat-% bands by sex and age — Gallagher et al. 2000 (Am J Clin Nutr 72:694-701),
// the age/sex-adjusted "healthy range" most fitness and clinical tools use instead of one flat
// cutoff for everybody. `obese` is that study's high-risk threshold; anything below the healthy
// band ("underfat") gets the same caution colour as anything above it but under `obese` — neither
// is the danger zone the way crossing `obese` is.
const BODY_FAT_BANDS = {
  male: [
    { maxAge: 39, lo: 8, hi: 19, obese: 25 },
    { maxAge: 59, lo: 11, hi: 21, obese: 28 },
    { maxAge: Infinity, lo: 13, hi: 24, obese: 30 }
  ],
  female: [
    { maxAge: 39, lo: 21, hi: 32, obese: 39 },
    { maxAge: 59, lo: 23, hi: 33, obese: 40 },
    { maxAge: Infinity, lo: 24, hi: 35, obese: 42 }
  ]
}

/** 'good' | 'warn' | 'bad', or null when sex/age aren't known well enough to classify. */
export function bodyFatBand(pct, sex, age) {
  if (!Number.isFinite(pct) || !Number.isFinite(age)) return null
  const table = BODY_FAT_BANDS[sex === 'female' ? 'female' : 'male']
  const band = table.find(b => age <= b.maxAge)
  if (pct >= band.obese) return 'bad'
  if (pct < band.lo || pct > band.hi) return 'warn'
  return 'good'
}
