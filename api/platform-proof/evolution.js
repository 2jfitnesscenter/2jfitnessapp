import crypto from 'node:crypto';
import { z } from 'zod';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ISO_UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const DAY = /^\d{4}-\d\d-\d\d$/;
const SAFE_ID = value => typeof value === 'string' && value.length > 0 && value.length <= 200 && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
const SAFE_EXERCISE_ID = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,120}$/.test(value);
const strictUtc = value => typeof value === 'string' && ISO_UTC.test(value) && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
const strictDay = value => typeof value === 'string' && DAY.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;

const consentSchema = z.object({
  purpose: z.literal('home_evolution'), status: z.literal('granted'), version: z.number().int().positive(), checkedAt: z.string().refine(strictUtc),
}).strict();
const authorizationSchema = z.object({
  permission: z.literal('training.read'), permissionGranted: z.literal(true),
  capability: z.literal('workoutHistory'), capabilityGranted: z.literal(true),
  accessState: z.literal('entitled'), checkedAt: z.string().refine(strictUtc), consent: consentSchema,
}).strict();
const cursorSchema = z.object({ snapshotId: z.string().regex(/^[a-f0-9]{64}$/), offset: z.number().int().min(0).max(10_000_000) }).strict();
export const trainingEvolutionRequestSchema = z.object({
  v: z.literal(1), personId: z.string().regex(UUID), trainingUserId: z.string().min(1).max(200).refine(SAFE_ID),
  authorization: authorizationSchema, cursor: cursorSchema.nullable(), limit: z.number().int().min(1).max(100),
}).strict();

function validNumber(value) { return typeof value === 'number' && Number.isFinite(value); }
function safeWorkoutSet(set, unit) {
  if (!set || typeof set !== 'object' || Array.isArray(set)) throw new Error('invalid_workout_set');
  const result = {};
  const fields = [['r', 'reps'], ['rpe', 'rpe'], ['min', 'minutes'], ['speed', 'speed'], ['resistance', 'resistance'], ['distance', 'distance'], ['incline', 'incline'], ['sec', 'seconds']];
  for (const [source, target] of fields) {
    if (set[source] === undefined || set[source] === null || set[source] === '') continue;
    if (!validNumber(set[source]) || set[source] < 0) throw new Error('invalid_workout_set');
    result[target] = set[source];
  }
  if (set.w !== undefined && set.w !== null && set.w !== '') {
    if (!validNumber(set.w) || set.w < 0) throw new Error('invalid_workout_set');
    result.weight = { value: set.w, unit };
  }
  if (set.done !== undefined) {
    if (typeof set.done !== 'boolean') throw new Error('invalid_workout_set');
    result.completed = set.done;
  }
  return result;
}

/** Project only finalized S.workouts into the canonical Home evolution workout allowlist. */
export function projectTrainingEvolution(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('invalid_training_state');
  if (!['kg', 'lb'].includes(state.unit)) throw new Error('invalid_training_unit');
  const source = state.workouts ?? [];
  if (!Array.isArray(source)) throw new Error('invalid_workouts');
  return source.map(workout => {
    if (!workout || !strictDay(workout.d) || !Array.isArray(workout.entries)) throw new Error('invalid_workouts');
    if (workout.entries.length > 300) throw new Error('invalid_workouts');
    const dto = { date: workout.d, exercises: workout.entries.map(entry => {
      if (!entry || !SAFE_EXERCISE_ID(entry.id) || !Array.isArray(entry.sets) || entry.sets.length > 100) throw new Error('invalid_workouts');
      return { exerciseId: entry.id, sets: entry.sets.map(set => safeWorkoutSet(set, state.unit)) };
    }) };
    if (workout.start !== undefined || workout.end !== undefined) {
      if (!validNumber(workout.start) || !validNumber(workout.end) || workout.end < workout.start || workout.end - workout.start > 24 * 60 * 60_000) throw new Error('invalid_workouts');
      dto.durationSeconds = Math.round((workout.end - workout.start) / 1000);
    }
    return dto;
  }).sort((a, b) => a.date.localeCompare(b.date));
}

function snapshotDigest(workouts, secret) {
  return crypto.createHmac('sha256', secret).update(JSON.stringify(workouts)).digest('hex');
}

export function readOnlyTrainingEvolution({ user, state, request, secret, now = Date.now }) {
  const workouts = projectTrainingEvolution(state);
  const snapshotId = snapshotDigest(workouts, secret);
  const cursor = request.cursor;
  if (cursor && cursor.snapshotId !== snapshotId) return { status: 'snapshot_changed' };
  const offset = cursor?.offset ?? 0;
  if (offset > workouts.length) return { status: 'invalid_cursor' };
  const page = workouts.slice(offset, offset + request.limit);
  const nextOffset = offset + page.length;
  const nextCursor = nextOffset < workouts.length ? { snapshotId, offset: nextOffset } : null;
  return {
    status: 'ok', body: {
      schema: '2j-home-evolution-export/v1', source: 'bunker', personId: user.personId,
      trainingUserId: user.id, exportedAt: new Date(now()).toISOString(), snapshotId, nextCursor,
      workouts: page,
    },
  };
}
