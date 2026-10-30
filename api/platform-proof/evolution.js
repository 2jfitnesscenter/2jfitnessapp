import crypto from 'node:crypto';
import { z } from 'zod';
import { EVOLUTION_MEASUREMENT_UNITS } from './measurement-catalog.js';

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
  accessState: z.enum(['baseline', 'entitled']), checkedAt: z.string().refine(strictUtc),
  consent: consentSchema,
}).strict();
const cursorSchema = z.object({ snapshotId: z.string().regex(/^[a-f0-9]{64}$/), offset: z.number().int().min(0).max(10_000_000) }).strict();
export const trainingEvolutionRequestSchema = z.object({
  v: z.literal(1), personId: z.string().regex(UUID), trainingUserId: z.string().min(1).max(200).refine(SAFE_ID),
  authorization: authorizationSchema, cursor: cursorSchema.nullable().optional(), limit: z.number().int().min(1).max(100).default(100),
}).strict();

const catalog = new Map(Object.entries(EVOLUTION_MEASUREMENT_UNITS).map(([key, unit]) => [key, { key, unit }]));

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

/** Strict allowlisted projection: no names, notes, PII, program metadata, photo refs or source objects. */
export function projectTrainingEvolution(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('invalid_training_state');
  if (!['kg', 'lb'].includes(state.unit)) throw new Error('invalid_training_unit');
  const records = [];
  const bodyweight = state.bodyweight ?? [];
  if (!Array.isArray(bodyweight)) throw new Error('invalid_bodyweight');
  bodyweight.forEach((item, index) => {
    if (!item || !strictDay(item.d) || !validNumber(item.w) || item.w <= 0) throw new Error('invalid_bodyweight');
    records.push({ kind: 'bodyweight', date: item.d, value: item.w, unit: state.unit, _index: index });
  });

  const measurements = state.measurements ?? {};
  if (!measurements || typeof measurements !== 'object' || Array.isArray(measurements)) throw new Error('invalid_measurements');
  for (const [key, entries] of Object.entries(measurements)) {
    const definition = catalog.get(key);
    if (!definition || !Array.isArray(entries)) throw new Error('invalid_measurements');
    entries.forEach((item, index) => {
      if (!item || !strictDay(item.d) || !validNumber(item.v)) throw new Error('invalid_measurements');
      records.push({ kind: 'measurement', key, date: item.d, value: item.v, unit: definition.unit, _index: index });
    });
  }

  const workouts = state.workouts ?? [];
  if (!Array.isArray(workouts)) throw new Error('invalid_workouts');
  workouts.forEach((workout, index) => {
    if (!workout || !strictDay(workout.d) || !Array.isArray(workout.entries)) throw new Error('invalid_workouts');
    const dto = { date: workout.d, exercises: workout.entries.map(entry => {
      if (!entry || !SAFE_EXERCISE_ID(entry.id) || !Array.isArray(entry.sets)) throw new Error('invalid_workouts');
      return { exerciseId: entry.id, sets: entry.sets.map(set => safeWorkoutSet(set, state.unit === 'lb' ? 'lb' : 'kg')) };
    }) };
    const start = workout.start, end = workout.end;
    if (start !== undefined || end !== undefined) {
      if (!validNumber(start) || !validNumber(end) || end < start || end - start > 24 * 60 * 60_000) throw new Error('invalid_workouts');
      dto.durationSeconds = Math.round((end - start) / 1000);
    }
    records.push({ kind: 'workout', date: workout.d, value: dto, _index: index });
  });

  const kindOrder = { bodyweight: 0, measurement: 1, workout: 2 };
  records.sort((a, b) => a.date.localeCompare(b.date) || kindOrder[a.kind] - kindOrder[b.kind] || String(a.key || '').localeCompare(String(b.key || '')) || a._index - b._index);
  return records.map(({ _index, ...record }) => record);
}

function snapshotDigest(records, secret) {
  return crypto.createHmac('sha256', secret).update(JSON.stringify(records)).digest('hex');
}

function groupPage(records) {
  const measurements = { bodyweight: [], series: {} }, workouts = [];
  for (const record of records) {
    if (record.kind === 'bodyweight') measurements.bodyweight.push({ date: record.date, value: record.value, unit: record.unit });
    else if (record.kind === 'measurement') (measurements.series[record.key] ||= []).push({ date: record.date, value: record.value, unit: record.unit });
    else workouts.push(record.value);
  }
  return { measurements, workouts };
}

export function readOnlyTrainingEvolution({ user, state, request, secret, now = Date.now }) {
  const records = projectTrainingEvolution(state);
  const snapshotId = snapshotDigest(records, secret);
  const cursor = request.cursor;
  if (cursor && cursor.snapshotId !== snapshotId) return { status: 'snapshot_changed' };
  const offset = cursor?.offset ?? 0;
  if (offset > records.length) return { status: 'invalid_cursor' };
  const page = records.slice(offset, offset + request.limit);
  const nextOffset = offset + page.length;
  const nextCursor = nextOffset < records.length ? { snapshotId, offset: nextOffset } : null;
  return {
    status: 'ok', body: {
      schema: '2j-home-evolution-export/v1', source: 'bunker', personId: user.personId,
      trainingUserId: user.id, exportedAt: new Date(now()).toISOString(), snapshotId, nextCursor,
      ...groupPage(page),
    },
  };
}
