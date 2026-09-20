/* PR detection for POST /api/bunker/finish, ported 1:1 from the phone app's own
   doFinishWorkout() (frontend/src/sheets.jsx) and the two functions it calls
   (frontend/src/lib/history.js's bestWeightFor, frontend/src/lib/onerm.js's is1RMRecord and its
   own dependency chain) — not reinterpreted, not "close enough". Ported rather than imported
   for two independent reasons: history.js pulls in format.js -> i18n.js, which calls
   import.meta.glob (a Vite-only construct that throws under plain Node); and even onerm.js
   itself, which has zero imports and would resolve fine at the language level, lives under
   frontend/, which api/Dockerfile never COPYs into the api image — an import reaching there
   would work in a local checkout and fail the moment this ships in the built container.

   server.js already has its own bestWeightForServer (for comparing a published Social goal
   against what someone has actually lifted) — deliberately NOT reused here: it excludes warmup
   sets and ignores topW, which is the right call for a goal but a different rule from what
   "was this a PR" has always meant in doFinishWorkout. Reusing it here would silently change
   which sessions count as a record.

   The five functions below are a straight port — same conditions, same order, same rounding —
   so `is1RMRecord`'s result matches the phone's byte for byte given the same history. */

// Above this many reps an estimate says more about work capacity than about maximal strength,
// and the formulas disagree by double digits. Refusing to guess beats printing a fantasy.
const REP_CAP = 12;
const FORMULAS = {
  epley: (w, r) => w * (1 + r / 30),
  brzycki: (w, r) => w * 36 / (37 - r),
  lombardi: (w, r) => w * Math.pow(r, 0.1),
};
const DEFAULT_FORMULA = 'epley';

function estimate1RM(w, r, formula = DEFAULT_FORMULA) {
  const weight = Number(w);
  const reps = Number(r);
  if (!isFinite(weight) || !isFinite(reps)) return null;
  if (weight <= 0 || reps < 1) return null;
  if (reps > REP_CAP) return null;
  const fn = FORMULAS[formula] || FORMULAS[DEFAULT_FORMULA];
  const est = reps === 1 ? weight : fn(weight, Math.round(reps));
  if (!isFinite(est) || est <= 0) return null;
  return Math.round(est * 10) / 10;
}

function bestSetOf(entry, formula = DEFAULT_FORMULA) {
  let best = null;
  (entry?.sets || []).forEach(s => {
    if (!s.done) return;
    const est = estimate1RM(s.w, s.r, formula);
    if (est !== null && (!best || est > best.est)) best = { est, w: Number(s.w), r: Math.round(Number(s.r)) };
  });
  return best;
}

function e1rmSeries(S, exId, formula = DEFAULT_FORMULA) {
  const pts = [];
  (S.workouts || []).forEach(w => {
    const entry = (w.entries || []).find(e => e.id === exId);
    if (!entry) return;
    const best = bestSetOf(entry, formula);
    if (best) pts.push({ t: w.start, d: w.d, y: best.est, w: best.w, r: best.r });
  });
  return pts;
}

function best1RM(S, exId, formula = DEFAULT_FORMULA) {
  let best = null;
  e1rmSeries(S, exId, formula).forEach(p => { if (!best || p.y > best.est) best = { est: p.y, w: p.w, r: p.r, d: p.d, t: p.t }; });
  return best;
}

// Did this workout beat every estimate that came before it? Compares against history that does
// not yet contain `entry`'s own workout, same as the phone calls it (before pushing `w`).
function is1RMRecord(S, exId, entry, formula = DEFAULT_FORMULA) {
  const now = bestSetOf(entry, formula);
  if (!now) return null;
  const prev = best1RM(S, exId, formula);
  return !prev || now.est > prev.est ? { ...now, prev: prev ? prev.est : 0 } : null;
}

// The phone's own bestWeightFor (frontend/src/lib/history.js:173) never excludes warmup sets —
// ported exactly as-is, including that topW (a confirmed working weight with no rep count)
// counts too.
function bestWeightFor(S, exId) {
  let best = 0;
  (S.workouts || []).forEach(w => (w.entries || []).forEach(e => {
    if (e.id !== exId) return;
    (e.sets || []).forEach(s => { if (s.done && s.w > best) best = s.w; });
    if (e.topW && e.topW > best) best = e.topW;
  }));
  return best;
}

export { bestWeightFor, is1RMRecord };
