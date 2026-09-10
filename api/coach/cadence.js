/* Scheduled reviews (Epic E).
 *
 * A separate tick from the workout reminder's, because the two want different things: the
 * reminder has to land on the minute someone chose, this only has to happen on the right
 * evening. Sixty seconds is plenty, and it keeps a loop that reads every user's state file
 * off the ten-second path.
 *
 * Skips are silent and logged, never pushed (FR-36/E4). Somebody whose provider is down, or
 * who trained nothing this week, should hear nothing at all — a notification that exists to
 * report the absence of news is how people turn notifications off.
 */
import * as jobs from './jobs.js';
import * as cfgStore from './config.js';

const TICK_MS = 60000;

/** Monthly cadence fires within the minute; everyWorkouts fires as soon as the count is met. */
export function isDue(coach, S, now) {
  const cadence = coach.cadence;
  if (!cadence || cadence === 'off') return false;
  const lastAt = coach.lastReview?.at || 0;

  // Nothing new to read is the most common reason not to run, and it applies to both modes.
  const workouts = S.workouts || [];
  const since = workouts.filter(w => !lastAt || (w.end || 0) > lastAt || w.d > new Date(lastAt).toISOString().slice(0, 10));
  if (!since.length) return false;

  if (cadence.everyWorkouts) {
    return since.length >= Math.max(1, Math.min(20, cadence.everyWorkouts));
  }
  if (cadence.monthly) {
    if (!now) return false;
    // Capped at 28 in the UI (every month has that day), so there is no "day does not exist
    // this month" case to special-case here.
    const wantDay = cadence.monthly.day ?? 1;
    const wantTime = cadence.monthly.time || '18:00';
    if (Number(now.date.slice(8, 10)) !== wantDay || now.hhmm !== wantTime) return false;
    // One per calendar month, even if the tick sees the same minute twice.
    return new Date(lastAt).toISOString().slice(0, 7) !== now.date.slice(0, 7);
  }
  return false;
}

/**
 * @param {object} deps  { users(): [{id}], userNow(tz): {date,hhmm,weekday} }
 */
export function startCadence(deps) {
  const timer = setInterval(() => {
    if (!cfgStore.isEnabled() || !cfgStore.isConnected()) return;
    for (const user of deps.users()) {
      try {
        const S = jobs.readState(user.id);
        const coach = S?.coach;
        if (!coach?.consent?.agreedAt) continue;         // consent revoked ⇒ cadence stops
        const tz = coach.cadence?.monthly ? (S.reminder?.tz || 'UTC') : null;
        const now = tz ? deps.userNow(tz) : null;
        if (!isDue(coach, S, now)) continue;
        jobs.enqueue(user.id, { kind: 'review', trigger: 'scheduled' });
        console.log('coach: scheduled review queued for', user.id);
      } catch (e) {
        // Caps, an in-flight job, a provider that just went down: all ordinary, all silent.
        if (!(e instanceof jobs.CoachError)) console.error('coach cadence', user.id, e);
      }
    }
  }, TICK_MS);
  timer.unref();
  return timer;
}
