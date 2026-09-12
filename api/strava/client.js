/* The one Strava API call this integration needs: log a finished workout as a manual activity.
 * No GPS/streams — this is a strength-training app, not a route tracker. See
 * https://developers.strava.com/docs/reference/#api-Activities-createActivity. */
const ACTIVITIES_URL = 'https://www.strava.com/api/v3/activities';

export async function createActivity(accessToken, w) {
  const elapsed = Math.max(1, Math.round(((w.end || Date.now()) - (w.start || Date.now())) / 1000));
  const body = new URLSearchParams({
    name: w.name || 'Entrenamiento de fuerza',
    type: 'WeightTraining',
    start_date_local: new Date(w.start || Date.now()).toISOString(),
    elapsed_time: String(elapsed),
    description: w.vol ? `Volumen: ${Math.round(w.vol)}` : ''
  });
  const r = await fetch(ACTIVITIES_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d.message || 'no se pudo crear la actividad en Strava');
  }
  return r.json();
}
