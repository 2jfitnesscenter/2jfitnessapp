// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* Whoop API calls this integration needs: the member's most recent recovery score, and their
 * recent nights of sleep. Verified 2026-09-12 against Whoop's own docs
 * (https://developer.whoop.com/api) — v1 is retired, this is the current v2 shape.
 */
const RECOVERY_URL = 'https://api.prod.whoop.com/developer/v2/recovery?limit=5';
const SLEEP_URL = 'https://api.prod.whoop.com/developer/v2/activity/sleep?limit=14';

// Workouts in a window (GET /v2/activity/workout, paginated by next_token, 25 per page). Only
// the fields 2J uses are passed on — no profile data, nothing else about the member. A 401/403
// means the token lacks read:workout (an older connection): reported, not thrown.
const WORKOUT_URL = 'https://api.prod.whoop.com/developer/v2/activity/workout';
export async function fetchWorkouts(accessToken, { start, end, maxPages = 4, fetchImpl = fetch } = {}) {
  const out = []
  let next = null
  for (let page = 0; page < maxPages; page++) {
    const q = new URLSearchParams({ limit: '25', start, ...(end ? { end } : {}), ...(next ? { nextToken: next } : {}) })
    const r = await fetchImpl(`${WORKOUT_URL}?${q}`, { headers: { Authorization: `Bearer ${accessToken}` } })
    if (r.status === 401 || r.status === 403) return { scopeMissing: true, workouts: [] }
    if (!r.ok) throw new Error('la solicitud a Whoop falló')
    const data = await r.json()
    for (const w of (data.records || [])) {
      out.push({
        id: w.id, start: w.start, end: w.end, sport_name: w.sport_name ?? null, score_state: w.score_state,
        score: w.score ? {
          strain: w.score.strain ?? null, kilojoule: w.score.kilojoule ?? null,
          average_heart_rate: w.score.average_heart_rate ?? null, max_heart_rate: w.score.max_heart_rate ?? null,
          zone_durations: w.score.zone_durations || null,
        } : null,
      })
    }
    next = data.next_token || null
    if (!next) break
  }
  return { scopeMissing: false, workouts: out }
}

export async function fetchLatestRecovery(accessToken) {
  const r = await fetch(RECOVERY_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) throw new Error('la solicitud a Whoop falló');
  const data = await r.json();
  // Sort defensively rather than trust API ordering — takes the most recently created scored cycle.
  const scored = (data.records || []).filter(x => x.score_state === 'SCORED');
  const rec = scored.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
  if (!rec) return null;
  return {
    score: rec.score?.recovery_score ?? null,
    hrv: rec.score?.hrv_rmssd_milli ?? null,
    restingHr: rec.score?.resting_heart_rate ?? null,
    createdAt: rec.created_at || null
  };
}

// { records: [{ id, start, end, nap, score_state, score: { stage_summary: {
//   total_light_sleep_time_milli, total_slow_wave_sleep_time_milli, total_rem_sleep_time_milli,
//   total_awake_time_milli, total_in_bed_time_milli, ... } } }], next_token }.
// One record per sleep (main sleep or a nap) — naps are dropped and only SCORED records read,
// same "actually asleep, not just in bed" rule the Apple Health import applies to its own
// InBed/Awake segments, so a night's total means the same thing regardless of source. Attributed
// to the date the member woke up (the record's own `end`), matching that same import's
// wake-date convention, since both can end up in the same S.sleep series.
export async function fetchRecentSleep(accessToken) {
  const r = await fetch(SLEEP_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) throw new Error('la solicitud a Whoop falló');
  const data = await r.json();
  const byDay = new Map(); // wake date -> total asleep minutes (a day with two scored records, rare, sums both)
  for (const rec of (data.records || [])) {
    if (rec.nap || rec.score_state !== 'SCORED' || !rec.end) continue
    const stages = rec.score?.stage_summary
    if (!stages) continue
    const asleepMs = (stages.total_light_sleep_time_milli || 0) + (stages.total_slow_wave_sleep_time_milli || 0) + (stages.total_rem_sleep_time_milli || 0)
    if (asleepMs <= 0) continue
    const d = rec.end.slice(0, 10)
    byDay.set(d, (byDay.get(d) || 0) + Math.round(asleepMs / 60000))
  }
  return [...byDay.entries()].sort().map(([d, v]) => ({ d, v, t: new Date(d + 'T12:00:00').getTime() }))
}
