import { isDeepStrictEqual } from 'node:util';

// Content-level authorization for the member's synced state.
//
// Why this exists: the member state travels as ONE document through POST /api/sync (save / replace / reset) and the legacy PUT /api/data, so the
// same route writes free personal routines and workouts as well as subtrees that belong to paid features. A route name cannot tell them apart;
// the content can. This module compares what a client sends with what the server already holds and applies the capabilities of
// 2J-CAPABILITIES-V2 to the DIFFERENCE:
//
//   free (baseline)        personal routines/programs (create, edit, delete), workouts, preferences, measurements ... untouched
//   guidedTraining         programs marked `source: 'guided-v2'` (and activating one)
//   premiumPrograms        S.premium, S.opposition
//   aiCoach                S.coach (while consent is granted)
//
// Principles:
//  - It never deletes what the person already has. Content the member may no longer extend is kept exactly as the server has it (stale client
//    copies are reverted, not erased), so history and data survive any change of fee.
//  - Reducing is always allowed: withdrawing the Coach consent, clearing a commercial subtree, abandoning or deleting a program.
//  - Unauthorized additions/modifications are STRIPPED rather than rejected, so a client holding old paid-feature edits cannot jam its own
//    sync queue; the response says what was ignored.
//  - Personal operations are checked against personalRoutineCreation / personalRoutineManagement / workoutRecording and answered with `denied`.

const GUIDED_SOURCE = 'guided-v2';
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const idOf = item => (isObject(item) && typeof item.id === 'string' ? item.id : null);
const asList = value => (Array.isArray(value) ? value : []);
const byId = list => new Map(asList(list).map(item => [idOf(item), item]).filter(([id]) => id));
const isGuided = item => isObject(item) && item.source === GUIDED_SOURCE;

/** Subtrees owned by a paid capability. `reduces(incoming)` says when a change only withdraws data, which is always allowed. */
export const COMMERCIAL_SUBTREES = Object.freeze([
  { key: 'coach', capability: 'aiCoach', reduces: incoming => !(isObject(incoming) && isObject(incoming.consent) && incoming.consent.agreedAt) },
  { key: 'premium', capability: 'premiumPrograms', reduces: () => false },
  { key: 'opposition', capability: 'premiumPrograms', reduces: () => false },
]);

/**
 * @param current  the state the server holds (or null for a new profile)
 * @param incoming the state the client wants to store
 * @param caps     capability booleans from 2J-CAPABILITIES-V2 (or a degraded view)
 * @returns { state, stripped: string[], denied: {scope, capability}[] }  `state` is a new object; inputs are not mutated.
 */
export function applyStatePolicy({ current, incoming, caps }) {
  const before = isObject(current) ? current : {};
  const next = structuredClone(isObject(incoming) ? incoming : {});
  const stripped = new Set(), denied = [];
  const revertKey = (key, scope) => {
    if (before[key] === undefined) delete next[key]; else next[key] = structuredClone(before[key]);
    stripped.add(scope);
  };

  // 1. Commercial subtrees.
  for (const { key, capability, reduces } of COMMERCIAL_SUBTREES) {
    if (caps[capability] === true) continue;
    const proposed = next[key];
    if (proposed === undefined || proposed === null) continue;                    // clearing / not mentioning is always fine
    if (isDeepStrictEqual(proposed, before[key])) continue;                       // unchanged copy of what the server already has
    if (reduces(proposed)) continue;                                              // withdrawal (for example the Coach consent)
    revertKey(key, `state.${key}`);
  }

  // 2. Guided programs: no new guided program, no changed guided program, and no switch to one, without guidedTraining.
  if (caps.guidedTraining !== true) {
    const currentGuided = byId(asList(before.programs).filter(isGuided));
    const incomingGuidedIds = new Set(asList(next.programs).filter(isGuided).map(idOf));
    if (Array.isArray(next.programs)) {
      next.programs = next.programs.flatMap(program => {
        if (!isGuided(program)) return [program];
        const known = currentGuided.get(idOf(program));
        if (!known) { stripped.add('programs.guided.added'); return []; }
        if (!isDeepStrictEqual(program, known)) { stripped.add('programs.guided.changed'); return [structuredClone(known)]; }
        return [program];
      });
    }
    const guidedIds = new Set([...currentGuided.keys(), ...incomingGuidedIds]);
    if (next.activeProgramId !== before.activeProgramId && guidedIds.has(next.activeProgramId)) {
      next.activeProgramId = before.activeProgramId ?? null;
      stripped.add('programs.guided.activated');
    }
  }

  // 3. Personal content (free): what the capabilities of this person allow.
  const need = (capability, scope) => { if (caps[capability] !== true) denied.push({ scope, capability }); };
  const personal = list => asList(list).filter(item => !isGuided(item));
  for (const kind of ['routines', 'programs']) {
    const old = byId(personal(before[kind])), now = personal(next[kind]);
    let created = false, changed = false;
    for (const item of now) {
      const id = idOf(item);
      if (!id || !old.has(id)) created = true;
      else if (!isDeepStrictEqual(item, old.get(id))) changed = true;
    }
    if (created) need('personalRoutineCreation', `${kind}.created`);
    if (changed) need('personalRoutineManagement', `${kind}.changed`);
  }
  {
    const known = new Set(asList(before.workouts).map(idOf));
    if (asList(next.workouts).some(workout => !known.has(idOf(workout)))) need('workoutRecording', 'workouts.added');
  }
  return { state: next, stripped: [...stripped], denied };
}

/**
 * H15: the classification of EVERY top-level key of the member state. Only `paid` subtrees (and guided programs inside `programs`) are protected by
 * the capability contract; everything else is free personal content or system bookkeeping. A key that is not listed here fails
 * test/platform-state-policy.test.js (which scans the sources for `S.<key>`), so a new feature that stores commercial content cannot ship without
 * someone deciding which class it belongs to — and adding it to COMMERCIAL_SUBTREES when it is paid.
 */
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
