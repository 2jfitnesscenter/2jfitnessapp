/* The one Whoop API call this integration needs: the member's most recent recovery score.
 *
 * NOTE: endpoint path and response field names are per Whoop's documentation at the time this
 * was written (https://developer.whoop.com/docs) — verify before relying on this, third-party
 * API surfaces move.
 */
const RECOVERY_URL = 'https://api.prod.whoop.com/developer/v1/recovery?limit=1';

export async function fetchLatestRecovery(accessToken) {
  const r = await fetch(RECOVERY_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) throw new Error('la solicitud a Whoop falló');
  const data = await r.json();
  const rec = (data.records || [])[0];
  if (!rec || rec.score_state !== 'SCORED') return null;
  return {
    score: rec.score?.recovery_score ?? null,
    hrv: rec.score?.hrv_rmssd_milli ?? null,
    restingHr: rec.score?.resting_heart_rate ?? null,
    createdAt: rec.created_at || null
  };
}
