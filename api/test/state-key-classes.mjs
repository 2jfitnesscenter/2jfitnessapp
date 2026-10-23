// H15 registry of the top-level keys of the member state. It lives with the tests on purpose: the server must stay agnostic of member-side health goals (see health-goals-privacy.test.js),
// so production code does not enumerate them. platform-state-policy.test.js scans the sources for S.<key> and fails on a key that is not classified here.
export const STATE_KEY_CLASSES = Object.freeze({
  paid: ['coach', 'premium', 'opposition'],                                           // = COMMERCIAL_SUBTREES keys
  mixed: ['programs', 'activeProgramId', 'programVersions'],                          // personal programs are free; source:'guided-v2' ones need guidedTraining
  system: ['_sync', '_ts', 'active', 'exWeights', 'routineVersions', 'lang', 'unit', 'theme', 'accent', 'textScale', 'onboarded', 'ux', 'uxInviteDismissed', 'uxSetup'],
  personal: [
    'autoCompleteSets', 'autoreg', 'availablePlates', 'badgeFlags', 'badges', 'barByExercise', 'bioimpedanceReminderDays', 'birthDate', 'bodyweight', 'checkinMode',
    'checkinSkipped', 'checkins', 'compGoals', 'countSecondaryMuscles', 'customEx', 'customIncrements', 'dayPlan', 'defaultLibraryTab', 'deload', 'deloadDismissed',
    'effort', 'enableBioimpedanceReminder', 'enablePlateCalculator', 'enableProgressiveOverloadCoach', 'enableRpVolumeZones', 'enableTrainingZones', 'exGoals',
    'excludedEx', 'favEx', 'favRoutines', 'gifSize', 'gymProfiles', 'height', 'hrMax', 'keepAwake', 'measurementUnitMode', 'measurements', 'priorityMuscles',
    'programReviews', 'reminder', 'restAlert', 'restSec', 'restVibrate', 'restingHR', 'routineReviews', 'routines', 'rpVolumeOverrides', 'secondaryMuscleFactor',
    'secondaryMuscles', 'shareCheckins', 'showExerciseImages', 'showExerciseTips', 'showPreviousResults', 'showRir', 'sleep', 'sound', 'steps', 'targetW',
    'trainingLevel', 'use2JRoomEquipment', 'warmupEnabled', 'week', 'workoutGuidePending', 'workoutView', 'workouts',
  ],
  incidental: ['body', 'tests'],                                                      // property names that only look like state keys (other objects called S)
})
