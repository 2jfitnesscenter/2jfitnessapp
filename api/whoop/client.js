/* The one Whoop API call this integration needs: the member's most recent recovery score.
 * Verified 2026-09-12 against Whoop's own docs (https://developer.whoop.com/api) — v1 is
 * retired, this is the current v2 shape: { records: [{ score_state, created_at,
 * score: { recovery_score, hrv_rmssd_milli, resting_heart_rate, ... } }], next_token }.
 */
const RECOVERY_URL = 'https://api.prod.whoop.com/developer/v2/recovery?limit=5';

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
