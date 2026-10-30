// The API image is built from api/ and must not import frontend files at runtime.
// Keep this export projection catalog aligned with the UI catalog via the API test.
export const EVOLUTION_MEASUREMENT_UNITS = Object.freeze({
  neck: 'cm', shoulders: 'cm', chest: 'cm', bicepsL: 'cm', bicepsR: 'cm',
  forearmL: 'cm', forearmR: 'cm', waist: 'cm', hips: 'cm', thighL: 'cm',
  thighR: 'cm', calfL: 'cm', calfR: 'cm', bodyFat: '%', muscleMass: 'kg',
  waterPct: '%', visceralFat: '', boneMass: 'kg', segFatArmL: '%', segFatArmR: '%',
  segFatLegL: '%', segFatLegR: '%', segFatTrunk: '%', segMuscleArmL: 'kg',
  segMuscleArmR: 'kg', segMuscleLegL: 'kg', segMuscleLegR: 'kg', segMuscleTrunk: 'kg',
  skinTriceps: 'mm', skinSubscapular: 'mm', skinSuprailiac: 'mm', skinAbdominal: 'mm',
});
