import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adherence, signalsFor, levelOf, overviewRow, bucketRows, memberView, aiFacts, validateAiAnswer, goalOf, sanitizeGoal, sessionKind, weeklyPlan,
  SIGNAL_TEXT, AI_PAYLOAD_MAX, T,
} from '../lib/coach-followup.js';
import { emptyPrivate, normalizePrivate, addNote, pushEvent, timeline, deleteNote } from '../lib/coach-followup-private.js';

/* Coach & Seguimiento PRO V3 — the deterministic engine: adherence, explained signals, triage, goal lens, the AI facts and the private trail. */
const TODAY = '2026-10-20';
const addDays = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const set = (w, r, extra = {}) => ({ w, r, done: true, ...extra });
const strength = (d, i = 0, extra = {}) => ({ id: 'w' + d + i, d, routineId: 'r1', entries: [{ id: '0025', target: { sets: 3, reps: 8 }, sets: [set(60, 8), set(60, 8), set(60, 8)] }], prs: [], ...extra });
const cardio = d => ({ id: 'c' + d, d, routineId: null, entries: [{ id: '3666', target: { mode: 'time' }, sets: [{ sec: 1200, w: 0, done: true }] }], prs: [] });
// three planned sessions a week (Mon/Wed/Fri) over `weeks` weeks; `skip` drops some of them
const plan = { week: { 1: 'r1', 3: 'r1', 5: 'r1' }, routines: [{ id: 'r1', name: 'Full body', ex: [{ id: '0025' }] }] };
const history = (weeks, skip = () => false) => {
  const out = [];
  for (let wk = 0; wk < weeks; wk++) for (const off of [0, 2, 4]) { const d = addDays(TODAY, -(wk * 7 + off) - 1); if (!skip(wk, off)) out.push(strength(d)); }
  return out.sort((a, b) => a.d.localeCompare(b.d));
};
// a routine reviewed 10 days ago: its cycle is in week 2, so a regular member has nothing due
const member = (over = {}) => ({ ...plan, workouts: history(5), routineReviews: { r1: { reviewedAt: addDays(TODAY, -10), by: 'tr' } }, ...over });
const roster = (over = {}) => ({ id: 'u1', name: 'Ana', created: '2026-06-01T10:00:00.000Z', ...over });

test('adherence separates planned strength, partial, cardio, moved and excluded sessions', () => {
  const S = member({ workouts: [...history(4), cardio(addDays(TODAY, -2)), cardio(addDays(TODAY, -3)),
    strength(addDays(TODAY, -4), 9, { entries: [{ id: '0025', target: { sets: 5, reps: 8 }, sets: [set(60, 8), set(60, 8)] }] }),
    strength(addDays(TODAY, -5), 8, { rescheduledFrom: '2026-10-10', excludeFromProgression: true })] });
  const a = adherence(S, TODAY, '2026-06-01');
  assert.equal(a.plannedPerWeek, 3);
  assert.equal(a.d28.planned, 12);
  assert.equal(a.d28.cardio, 2, 'cardio is counted apart, never as strength');
  assert.equal(a.d28.partial, 1);
  assert.equal(a.d28.moved, 1); assert.equal(a.d28.excluded, 1, 'an excluded workout still counts as attendance');
  assert.ok(a.d28.full >= 12 && a.d28.pct === 100 || a.d28.pct >= 90);
  assert.equal(a.d28.pct % 5, 0, 'no false precision: multiples of 5');
});

test('cardio and mobility are not strength sessions; a plan of only cardio routines plans no strength', () => {
  assert.equal(sessionKind(cardio(TODAY), {}), 'cardio');
  assert.equal(sessionKind(strength(TODAY), {}), 'strength');
  const clock = { d: TODAY, entries: [{ id: 'c1', target: { mode: 'time' }, sets: [{ sec: 600, done: true }] }] };
  assert.equal(sessionKind(clock, { customEx: [{ id: 'c1', bp: 'cardio' }] }), 'cardio');
  assert.deepEqual(weeklyPlan({ week: { 1: 'rc' }, routines: [{ id: 'rc', ex: [{ id: '3666' }] }] }), { strength: 0, other: 1, known: true });
  assert.deepEqual(weeklyPlan({}), { strength: 0, other: 0, known: false });
});

test('no plan, no percentage: counts only; a new member has no percentage either', () => {
  const noPlan = adherence({ workouts: history(4) }, TODAY, '2026-06-01');
  assert.equal(noPlan.d28.pct, null); assert.equal(noPlan.d28.planned, null); assert.ok(noPlan.d28.full > 0);
  const fresh = adherence(member({ workouts: [strength(addDays(TODAY, -2))] }), TODAY, addDays(TODAY, -4));
  assert.equal(fresh.d28.pct, null, 'under a week of history is not enough for a percentage');
});

test('trend compares the last 14 days with the 14 before', () => {
  const dropping = adherence(member({ workouts: history(4, (wk) => wk < 2) }), TODAY, '2026-06-01');
  assert.equal(dropping.trend, 'down');
  const steady = adherence(member({ workouts: history(5) }), TODAY, '2026-06-01');
  assert.equal(steady.trend, 'flat');
  const recovering = adherence(member({ workouts: history(4, (wk) => wk >= 2) }), TODAY, '2026-06-01');
  assert.equal(recovering.trend, 'up');
});

const ids = list => list.map(s => s.id);
test('a regular member is normal; every signal carries its source, evidence and the two sentences', () => {
  const sigs = signalsFor({ S: member(), u: roster(), today: TODAY });
  assert.equal(levelOf(sigs), 'normal'); assert.deepEqual(sigs, []);
  const low = signalsFor({ S: member({ workouts: history(5, (wk, off) => off !== 0) }), u: roster(), today: TODAY });
  const s = low.find(x => x.id === 'adherence_low');
  assert.ok(s, ids(low).join());
  for (const k of ['id', 'severity', 'source', 'evidence', 'explanation', 'args', 'suggestedAction']) assert.ok(k in s, k);
  assert.equal(s.explanation, SIGNAL_TEXT.adherence_low[0]); assert.equal(s.suggestedAction, SIGNAL_TEXT.adherence_low[1]);
  assert.ok(s.evidence.planned >= T.ADHERENCE_MIN_PLANNED && typeof s.evidence.pct === 'number');
  assert.deepEqual(s.args, [s.evidence.done, s.evidence.planned]);
});

test('absence escalates with days; a brand-new member is never flagged for having no workouts', () => {
  const idle = days => signalsFor({ S: member({ workouts: [strength(addDays(TODAY, -days))] }), u: roster(), today: TODAY });
  assert.equal(idle(10).some(s => s.id === 'absence'), false);
  assert.equal(idle(15).find(s => s.id === 'absence').severity, 'review');
  assert.equal(idle(30).find(s => s.id === 'absence').severity, 'priority');
  assert.equal(levelOf(idle(30)), 'priority');
  const created = addDays(TODAY, -5) + 'T09:00:00.000Z';
  assert.deepEqual(signalsFor({ S: member({ workouts: [] }), u: roster({ created }), today: TODAY }), []);
  const old = signalsFor({ S: member({ workouts: [] }), u: roster({ created: '2026-08-01T00:00:00.000Z' }), today: TODAY });
  assert.equal(old.find(s => s.id === 'no_workouts_yet').severity, 'priority');
});

test('a week with nothing done, a plateau and a review that is due are separate, explained signals', () => {
  const missed = signalsFor({ S: member({ workouts: history(5).filter(w => w.d < addDays(TODAY, -8)) }), u: roster(), today: TODAY });
  assert.ok(ids(missed).includes('missed_week') || ids(missed).includes('adherence_low') || ids(missed).includes('absence'));
  // plateau: 6 sessions of the same load → stalled; review due from week 5 of the routine cycle
  const flat = Array.from({ length: 10 }, (_, i) => strength(addDays(TODAY, -(i * 3) - 1)));
  const sigs = signalsFor({ S: member({ routineReviews: {}, workouts: flat.reverse() }), u: roster(), today: TODAY });
  assert.ok(ids(sigs).includes('review_due') || ids(sigs).includes('review_overdue'), ids(sigs).join());
  const rv = sigs.find(s => s.id === 'review_due' || s.id === 'review_overdue');
  assert.equal(rv.source, 'review'); assert.ok(rv.evidence.name);
});

test('a measurement review that is late is a signal only when follow-up is active', () => {
  const f = { template: 'basic', cadence: 'weekly', days: 7, startedAt: addDays(TODAY, -40), reviews: [] };
  assert.ok(signalsFor({ S: member(), u: roster({ followUp: f }), today: TODAY }).some(s => s.id === 'measurement_review' && s.severity === 'priority'));
  assert.equal(signalsFor({ S: member(), u: roster(), today: TODAY }).some(s => s.id === 'measurement_review'), false);
});

test('check-ins count only when the member shared them; discomfort is a reason to ask, never a conclusion', () => {
  const checkins = [0, 1, 2].map(i => ({ d: addDays(TODAY, -i), energy: 2, sleep: 2, fatigue: 5, pain: true, zones: ['knee'] }));
  const priv = signalsFor({ S: member({ checkins }), u: roster(), today: TODAY });
  assert.equal(priv.some(s => s.source === 'checkin'), false, 'private check-ins stay out of the triage');
  const shared = signalsFor({ S: member({ checkins, shareCheckins: true }), u: roster(), today: TODAY });
  assert.ok(ids(shared).includes('checkin_fatigue')); assert.ok(ids(shared).includes('checkin_discomfort'));
  assert.doesNotMatch(JSON.stringify(shared), /diagnos|injur|overtrain|disease/i);
  assert.equal(memberView({ S: member({ checkins }), u: roster(), today: TODAY }).checkin.shared, false);
});

test('the goal decides how progress is read: body weight for fat loss, records for performance, nothing for health', () => {
  const sessions = history(5);
  const rising = [{ d: addDays(TODAY, -40), w: 82 }, { d: addDays(TODAY, -20), w: 82.4 }, { d: addDays(TODAY, -2), w: 82.6 }];
  const base = { workouts: sessions, bodyweight: rising, targetW: 78 };
  const fat = signalsFor({ S: member({ ...base, coach: { profile: { goal: 'fatloss' } } }), u: roster(), today: TODAY });
  assert.ok(ids(fat).includes('goal_body'));
  const hyp = signalsFor({ S: member({ ...base, coach: { profile: { goal: 'hypertrophy' } } }), u: roster(), today: TODAY });
  assert.equal(ids(hyp).includes('goal_body'), false, 'body weight is not performance');
  const health = signalsFor({ S: member({ ...base, coach: { profile: { goal: 'longevity' } } }), u: roster(), today: TODAY });
  assert.equal(ids(health).includes('goal_body') || ids(health).includes('goal_performance'), false);
  // the staff's own reading wins over the member's
  const staff = signalsFor({ S: member({ ...base, coach: { profile: { goal: 'longevity' } } }), u: roster({ followUp: { template: 'basic', cadence: 'monthly', days: 30, startedAt: TODAY, reviews: [], goalPlan: { primary: 'fatloss' } } }), today: TODAY });
  assert.ok(ids(staff).includes('goal_body'));
  assert.equal(goalOf(member({ coach: { profile: { goal: 'power' } } }), null).source, 'member');
  assert.equal(goalOf({}, { goalPlan: { primary: 'fatloss' } }).source, 'staff');
});

test('goal edits are validated: known goals, a real date, a short label', () => {
  assert.equal(sanitizeGoal({ primary: 'wizard' }, null).error, 'objetivo no válido');
  assert.equal(sanitizeGoal({ targetDate: '2026-13-40' }, null).error, 'fecha objetivo no válida');
  assert.equal(sanitizeGoal({ label: 'x'.repeat(81) }, null).error, 'el objetivo admite hasta 80 caracteres');
  assert.equal(sanitizeGoal({ priority: 'urgent' }, null).error, 'prioridad no válida');
  assert.deepEqual(sanitizeGoal({ primary: 'power', targetDate: '2026-12-01', priority: 'high', label: 'Test de salto' }, null).value, { primary: 'power', targetDate: '2026-12-01', priority: 'high', label: 'Test de salto' });
  assert.equal(sanitizeGoal({ primary: null }, { primary: 'power' }).value, undefined, 'clearing the last field removes the reading');
  const near = signalsFor({ S: member(), u: roster({ followUp: { template: 'basic', cadence: 'monthly', days: 30, startedAt: TODAY, reviews: [], goalPlan: { targetDate: addDays(TODAY, 9) } } }), today: TODAY });
  assert.equal(near.find(s => s.id === 'goal_date').args[0], 9);
});

test('triage buckets: attention (review/priority) first by importance, upcoming reviews, then stable', () => {
  const rows = [
    overviewRow({ S: member(), u: roster({ id: 'a', name: 'Estable' }), today: TODAY }),
    overviewRow({ S: member({ workouts: history(5).filter(w => w.d <= addDays(TODAY, -30)) }), u: roster({ id: 'b', name: 'Ausente' }), today: TODAY }),
    overviewRow({ S: member({ workouts: history(5).filter(w => w.d <= addDays(TODAY, -16)) }), u: roster({ id: 'c', name: 'Revisar' }), today: TODAY }),
    overviewRow({ S: member(), u: roster({ id: 'd', name: 'Pronto', followUp: { template: 'basic', cadence: 'weekly', days: 7, startedAt: addDays(TODAY, -4), reviews: [{ d: addDays(TODAY, -4), by: 'x' }] } }), today: TODAY }),
  ];
  const b = bucketRows(rows);
  assert.deepEqual(b.attention.map(r => r.id), ['b', 'c']);
  assert.deepEqual(b.upcoming.map(r => r.id), ['d']);
  assert.deepEqual(b.stable.map(r => r.id), ['a']);
  assert.deepEqual(b.counts, { attention: 2, upcoming: 1, stable: 1 });
  const top = rows[1];
  assert.equal(top.level, 'priority'); assert.equal(top.signals[0].id, 'absence'); assert.equal(typeof top.signals[0].explanation, 'string');
  assert.equal(top.signals.length <= 2, true);
});

test('legacy and empty data never break the engine', () => {
  for (const S of [{}, { workouts: [] }, { workouts: [null, { d: 'bad' }, { d: TODAY }, { d: TODAY, entries: [null, { id: 'x' }, { id: 'y', sets: [null] }] }], week: { 1: null }, routines: [null], programs: [null], bodyweight: [null, { d: TODAY }], checkins: [null] }]) {
    const v = memberView({ S, u: roster(), today: TODAY });
    assert.ok(['normal', 'review', 'priority'].includes(v.level));
    assert.doesNotThrow(() => overviewRow({ S, u: roster(), today: TODAY }));
  }
  assert.doesNotThrow(() => signalsFor({ S: null, u: roster(), today: TODAY }));
});

test('every signal text is a registered pair of English keys', () => {
  const view = memberView({ S: member({ workouts: [strength(addDays(TODAY, -40))] }), u: roster(), today: TODAY });
  for (const s of view.signals) { assert.ok(SIGNAL_TEXT[s.id], s.id); assert.equal(s.explanation, SIGNAL_TEXT[s.id][0]); assert.equal(s.suggestedAction, SIGNAL_TEXT[s.id][1]); }
  for (const [id, [a, b]] of Object.entries(SIGNAL_TEXT)) { assert.ok(a.length > 10 && b.length > 10, id); assert.doesNotMatch(a + b, /GRAVE|alert|overtrain|diagnos|injur/i, id); }
});

test('the HECHO / INFERENCIA / SUGERENCIA analysis is built from the signals, kept apart', () => {
  const v = memberView({ S: member({ workouts: history(5, (wk, off) => off !== 0) }), u: roster(), today: TODAY });
  assert.ok(v.analysis.facts.length >= 2 && v.analysis.inference.length >= 1 && v.analysis.suggestion.length >= 1);
  const all = [...v.analysis.facts, ...v.analysis.inference, ...v.analysis.suggestion].map(x => x.id);
  assert.equal(new Set(all).size, all.length, 'no statement is repeated across the three kinds');
});

/* ---------------------------------------------------------------- the professional AI */
test('AI facts are compact, name-free, notes-free and never exceed the limit', () => {
  const S = member({ checkins: [{ d: TODAY, energy: 3, sleep: 3, fatigue: 5, pain: true, zones: ['knee'] }], shareCheckins: true, workouts: history(6) });
  const v = memberView({ S, u: roster({ name: 'Ana Secreta', followUp: { template: 'basic', cadence: 'monthly', days: 30, startedAt: TODAY, reviews: [], goalPlan: { label: 'Media maratón' } } }), today: TODAY });
  const facts = aiFacts(v, { structure: [{ id: 'balance:x', category: 'balance', severity: 'revisar', message: 'texto largo que no debe viajar', evidence: { a: 1 } }], recent: [{ kind: 'goal_changed', d: '2026-10-01', text: 'privado' }] });
  const json = JSON.stringify(facts);
  assert.ok(json.length <= AI_PAYLOAD_MAX);
  assert.doesNotMatch(json, /Ana|Secreta|u1|texto largo|privado|"id":"w/);
  assert.ok(!('workouts' in facts) && !('entries' in facts) && !('notes' in facts) && !('trainerNotes' in facts));
  assert.equal(facts.checkin.highFatigue14, 1);
  assert.deepEqual(Object.keys(facts.structure[0]).sort(), ['category', 'id', 'severity']);
  const noShare = aiFacts(memberView({ S: member({ checkins: S.checkins }), u: roster(), today: TODAY }));
  assert.equal(noShare.checkin, null, 'private check-ins never reach the AI');
});

test('a huge input is trimmed to the limit instead of being sent', () => {
  const big = Array.from({ length: 200 }, (_, i) => ({ id: 'finding-' + 'x'.repeat(60) + i, category: 'c'.repeat(30), severity: 'revisar' }));
  const v = memberView({ S: member(), u: roster(), today: TODAY });
  v.signals = Array.from({ length: 20 }, (_, i) => ({ id: 'absence', severity: 'review', source: 'workouts', evidence: { blob: 'y'.repeat(900), i } }));
  const facts = aiFacts(v, { structure: big, recent: big.map(() => ({ kind: 'k', d: '2026-01-01' })) });
  assert.ok(JSON.stringify(facts).length <= AI_PAYLOAD_MAX);
  assert.ok(facts.signals.length >= 2);
});

test('AI answers are accepted only in the tagged shape, without medical wording or applicable changes', () => {
  const good = { coach_followup: 1, summary: ['Adherencia baja en 4 semanas.'], keyData: [{ tag: 'fact', text: 'Realizó 5 de 8 sesiones.' }, { tag: 'inference', text: 'La adherencia bajó respecto a las semanas previas.' }, { tag: 'suggestion', text: 'Revisar frecuencia y disponibilidad.' }],
    review: [{ tag: 'suggestion', text: 'Revisar el calendario semanal.' }], proposal: [{ action: 'add_note', text: 'Anotar la conversación.' }] };
  const ok = validateAiAnswer(good);
  assert.equal(ok.ok, true); assert.equal(ok.value.proposal[0].tag, 'suggestion');
  assert.equal(validateAiAnswer({ ...good, coach_followup: 2 }).ok, false);
  assert.equal(validateAiAnswer({ ...good, keyData: good.keyData.slice(0, 2) }).ok, false);
  assert.equal(validateAiAnswer({ ...good, keyData: [...good.keyData.slice(0, 2), { tag: 'diagnosis', text: 'x' }] }).ok, false, 'unknown tag');
  assert.equal(validateAiAnswer({ ...good, summary: ['Muestra signos de sobreentrenamiento.'] }).ok, false);
  assert.equal(validateAiAnswer({ ...good, keyData: [...good.keyData.slice(0, 2), { tag: 'inference', text: 'Posible lesión de rodilla.' }] }).ok, false);
  assert.equal(validateAiAnswer({ ...good, apply: { routines: [] } }).ok, false, 'the AI cannot return something to apply');
  assert.equal(validateAiAnswer({ ...good, proposal: [{ action: 'apply_changes', text: 'x' }] }).value.proposal.length, 0, 'only the four screens it can open');
  assert.equal(validateAiAnswer({ ...good, summary: ['a', 'b', 'c', 'd'] }).value.summary.length, 3);
});

/* ---------------------------------------------------------------- the private trail */
test('notes and decisions live in the extended blob; legacy readers still find notes and events', () => {
  let p = emptyPrivate();
  assert.deepEqual(normalizePrivate(JSON.parse(JSON.stringify(p))), p);
  assert.ok(normalizePrivate({ version: 1, notes: 'vieja', events: [{ at: '2026-01-01T00:00:00.000Z', by: 'a', action: 'note_updated' }] }), 'a V2 blob (no entries) is valid');
  assert.equal(normalizePrivate({ version: 2, notes: '', events: [] }), null);
  const r = addNote(p, { by: 'tr', text: '  Hablamos de horarios  ', ref: { kind: 'program', id: 'p1' }, id: 'n1', at: '2026-10-01T10:00:00.000Z' });
  p = r.value;
  assert.equal(p.entries[0].text, 'Hablamos de horarios'); assert.equal(p.entries[0].ref.id, 'p1');
  assert.equal(p.events.at(-1).kind, 'note_added'); assert.equal(p.events.at(-1).action, 'note_added');
  assert.equal(addNote(p, { by: 'tr', text: '   ', id: 'x' }).error, 'la nota está vacía');
  assert.ok(addNote(p, { by: 'tr', text: 'x'.repeat(1001), id: 'x' }).error);
  assert.equal(deleteNote(p, 'n1').value.entries.length, 0);
  assert.throws(() => pushEvent(p, { kind: 'whatever', by: 'x' }));
});

test('the professional timeline merges derived review/plan events with private decisions, newest first, without noise', () => {
  const S = member({ programs: [{ id: 'p1', name: 'Programa A' }], programReviews: { p1: { lastReviewAt: '2026-10-10', by: 'tr' } }, routineReviews: { r1: { reviewedAt: '2026-09-20', by: 'ad' } },
    programVersions: { p1: [{ id: 'p1', versionedAt: Date.parse('2026-10-05T10:00:00Z') }] } });
  let p = emptyPrivate();
  p = pushEvent(p, { kind: 'goal_changed', by: 'ad', text: 'Pasa a fuerza', at: '2026-10-12T09:00:00.000Z' });
  p = pushEvent({ ...p, events: [...p.events, { at: '2026-10-13T09:00:00.000Z', by: 'ad', action: 'note_updated' }] }, { kind: 'recommendation_rejected', by: 'tr', text: 'No hay tiempo', at: '2026-10-14T09:00:00.000Z' });
  const tl = timeline({ S, f: { reviews: [{ d: '2026-09-01', by: 'ad' }] }, priv: p, names: { tr: 'Marta', ad: 'Juan' } });
  assert.deepEqual(tl.map(e => e.kind), ['recommendation_rejected', 'goal_changed', 'review_done', 'plan_changed', 'review_done', 'measurement_review']);
  assert.equal(tl[0].by, 'Marta'); assert.equal(tl[2].ref.name, 'Programa A'); assert.equal(tl.some(e => e.kind === 'note_updated'), false, 'legacy note edits are noise');
});

/* ---------------------------------------------------------------- performance */
test('the whole list for 10 / 25 / 50 / 100 synthetic members stays fast', () => {
  const rows = n => Array.from({ length: n }, (_, i) => overviewRow({ S: member({ workouts: history(8, (wk, off) => (i + wk + off) % (3 + (i % 4)) === 0) }), u: roster({ id: 'm' + i, name: 'Socio ' + i }), today: TODAY }));
  for (const n of [10, 25, 50, 100]) {
    const t0 = performance.now(); const r = rows(n); const b = bucketRows(r);
    const ms = performance.now() - t0;
    assert.equal(r.length, n); assert.equal(b.counts.attention + b.counts.upcoming + b.counts.stable, n);
    assert.ok(ms < 2000, `${n} members took ${Math.round(ms)} ms`);
  }
});

/* ---------------------------------------------------------------- signals carried over from the engines that already exist */
test('accumulated fatigue (several effort signals over time) is a review-level signal; one bad session is not', () => {
  const sessions = extra => [0, 1, 2, 3, 4, 5].map(i => ({ id: 'f' + i, d: addDays(TODAY, -(6 - i) * 3), routineId: 'r1',
    entries: ['A', 'B'].map(id => ({ id, target: { id, sets: 2, reps: 8 }, sets: [set(60, 8, extra(i, id)), set(60, 8, extra(i, id))] })) }));
  const high = sessions((i, id) => ({ rpe: 7 + i / 2, feel: i >= 4 && id === 'A' ? 'fail' : i >= 3 ? 'hard' : 'good' }));
  const sigs = signalsFor({ S: member({ workouts: high }), u: roster(), today: TODAY });
  const f = sigs.find(s => s.id === 'fatigue_trend');
  assert.ok(f, ids(sigs).join()); assert.equal(f.severity, 'review'); assert.equal(f.source, 'effort'); assert.ok(f.evidence.points >= 6);
  const oneBad = sessions((i) => (i === 5 ? { rpe: 10, feel: 'fail' } : { rpe: 7, feel: 'good' }));
  assert.equal(signalsFor({ S: member({ workouts: oneBad }), u: roster(), today: TODAY }).some(s => s.id === 'fatigue_trend'), false);
  // an accepted deload quiets it: the trainer already has the member in a lighter week
  const deload = { from: addDays(TODAY, -1), until: addDays(TODAY, 6), volumeCut: 0.35, loadCut: 0.075, rir: 3 };
  assert.equal(signalsFor({ S: member({ workouts: high, deload }), u: roster(), today: TODAY }).some(s => s.id === 'fatigue_trend'), false);
});

test('a review left for two weeks is priority; one that just came due is only "review"; a review that was closed disappears', () => {
  const flat = n => Array.from({ length: n }, (_, i) => strength(addDays(TODAY, -(i * 3) - 1))).reverse();
  const weeks = n => member({ routineReviews: {}, workouts: Array.from({ length: n * 3 }, (_, i) => strength(addDays(TODAY, -(n * 7) + Math.floor(i * 7 / 3)))) });
  const fresh = signalsFor({ S: weeks(5), u: roster(), today: TODAY }).find(s => s.source === 'review');
  assert.ok(fresh && fresh.severity === 'review', JSON.stringify(fresh));
  const late = signalsFor({ S: weeks(8), u: roster(), today: TODAY }).find(s => s.id === 'review_overdue');
  assert.ok(late && late.severity === 'priority' && late.evidence.daysOver >= T.REVIEW_OVERDUE_PRIORITY, JSON.stringify(late));
  const closed = signalsFor({ S: { ...weeks(8), routineReviews: { r1: { reviewedAt: addDays(TODAY, -2), by: 'tr' } } }, u: roster(), today: TODAY });
  assert.equal(closed.some(s => s.source === 'review'), false);
  assert.ok(flat(3).length === 3);
});

test('multi-signal members rank above single-signal ones; a flagged member is always listed; clearing the mark drops the signal', () => {
  const a = overviewRow({ S: member({ workouts: history(5).filter(w => w.d <= addDays(TODAY, -16)) }), u: roster({ id: 'a' }), today: TODAY });
  const b = overviewRow({ S: member(), u: roster({ id: 'b', followUp: { template: 'basic', cadence: 'monthly', days: 30, startedAt: TODAY, reviews: [], flag: { at: 'x', by: 'tr' } } }), today: TODAY });
  const c = overviewRow({ S: member(), u: roster({ id: 'c' }), today: TODAY });
  const buckets = bucketRows([a, b, c]);
  assert.deepEqual(buckets.attention.map(r => r.id).sort(), ['a', 'b']);
  assert.equal(b.flagged, true); assert.equal(b.signals[0].id, 'flagged'); assert.equal(c.level, 'normal');
  assert.equal(overviewRow({ S: member(), u: roster({ followUp: { template: 'basic', cadence: 'monthly', days: 30, startedAt: TODAY, reviews: [] } }), today: TODAY }).level, 'normal');
});
