import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { sanitizeQuestionnaireTemplate, makeAssignment, submitAssignment, validateQuestionnaireAnswers, compareProgress, coachSafeIntake, consentedCoachIntake } from '../lib/followup-v2.js';
import { memberView, aiFacts } from '../lib/coach-followup.js';

const today = new Date().toISOString().slice(0, 10);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'followup-v2-'));
const photoDir = path.join(dir, 'followup-photos');
const SECRET = 'f'.repeat(64);
fs.writeFileSync(path.join(dir, 'secret'), SECRET, { mode: 0o600 });
fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ users: [
  { id: 'member-a', name: 'Member A' }, { id: 'member-b', name: 'Member B' },
  { id: 'trainer', name: 'Trainer', trainer: true }, { id: 'admin', name: 'Admin', admin: true },
], creds: [], subs: [], invites: [], recoveries: [] }));
fs.writeFileSync(path.join(dir, 'state-member-a.json'), JSON.stringify({ measurements: { waist: [{ d: '2026-09-01', v: 88 }, { d: today, v: 86 }] }, bodyweight: [{ d: '2026-09-01', w: 82 }, { d: today, w: 81 }], checkins: [{ d: today, energy: 4, sleep: 3, fatigue: 2 }], shareCheckins: false, coach: { profile: { goal: 'strength' } }, workouts: [] }));
fs.writeFileSync(path.join(dir, 'state-member-b.json'), JSON.stringify({ measurements: { waist: [{ d: today, v: 99 }] }, bodyweight: [], workouts: [], programReviews: { 'program-a': { lastReviewAt: '2026-10-02T12:00:00.000Z' } }, programs: [{ id: 'program-a', name: 'Fuerza base' }] }));
const PORT = 39000 + Math.floor(Math.random() * 10000), base = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, ['server.js'], { cwd: path.resolve('.'), env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, RP_ID: 'localhost', ORIGIN: base }, stdio: ['ignore', 'ignore', 'ignore'] });
for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
const cookieFor = uid => { const p = `${uid}:${Date.now() + 86400000}:0`; return `gymsid=${p}.${crypto.createHmac('sha256', SECRET).update(p).digest('base64url')}`; };
async function req(method, route, uid, body) {
  const r = await fetch(base + route, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(uid ? { cookie: cookieFor(uid) } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const type = r.headers.get('content-type') || ''; const data = type.includes('json') ? await r.json() : await r.arrayBuffer();
  return { status: r.status, headers: r.headers, data };
}
const get = (route, uid) => req('GET', route, uid);
const post = (route, uid, body) => req('POST', route, uid, body);

test('template CRUD is admin-only, versioned, validated and duplicate stays an unpublished copy', async () => {
  const initial = await get('/api/admin/followup/templates', 'admin');
  assert.equal(initial.status, 200); assert.deepEqual(initial.data.templates.map(x => x.name), ['Básico', 'Intermedio', 'Pro']);
  assert.equal((await get('/api/admin/followup/templates', 'trainer')).status, 403);
  const template = { id: 'custom-intake', name: 'Inicio', published: false, questions: [
    { id: 'goal', label: 'Objetivo', type: 'short_text', required: true, active: true },
    { id: 'days', label: 'Días', type: 'number', min: 1, max: 7, active: true },
  ] };
  const saved = await post('/api/admin/followup/templates/save', 'admin', { template });
  assert.equal(saved.status, 200); assert.equal(saved.data.template.version, 1);
  const duplicate = await post('/api/admin/followup/templates/duplicate', 'admin', { id: 'custom-intake' });
  assert.equal(duplicate.status, 200); assert.equal(duplicate.data.template.published, false); assert.notEqual(duplicate.data.template.id, template.id);
  assert.equal((await post('/api/admin/followup/templates/save', 'admin', { template: { ...template, questions: [{ id: 'x', label: '', type: 'scale' }] } })).status, 400);
  const pub = await post('/api/admin/followup/templates/publish', 'admin', { id: 'custom-intake', published: true });
  assert.equal(pub.status, 200); assert.equal(pub.data.template.published, true);
  const v2 = await post('/api/admin/followup/templates/save', 'admin', { template: { ...template, published: true, questions: [...template.questions, { id: 'new', label: 'Nuevo', type: 'yes_no', active: true }] } });
  assert.equal(v2.data.template.version, 2);
  const audit = await get('/api/admin/security-events?limit=500', 'admin');
  const templateEvent = audit.data.events.find(e => e.event === 'admin_action' && e.meta?.kind === 'followup_template_saved');
  assert.equal(templateEvent.meta.target, 'custom-intake'); assert.equal(templateEvent.meta.count, 3);
  assert.doesNotMatch(JSON.stringify(templateEvent), /Objetivo|Ganar fuerza|Nuevo/);
});

test('assignment snapshots are immutable, member can submit once, trainer reads all members without editing answers', async () => {
  const assigned = await post('/api/trainer/followup/questionnaire/assign', 'trainer', { memberId: 'member-b', templateId: 'custom-intake' });
  assert.equal(assigned.status, 200); assert.equal(assigned.data.assignment.templateVersion, 2);
  assert.equal((await get('/api/followup/questionnaires', 'member-a')).data.assignments.length, 0);
  const own = await get('/api/followup/questionnaires', 'member-b');
  assert.equal(own.status, 200); assert.equal(own.data.assignments.length, 1);
  const aid = assigned.data.assignment.id;
  assert.equal((await post('/api/followup/questionnaire/submit', 'member-b', { assignmentId: aid, answers: { goal: 'Ganar fuerza', days: 3 } })).status, 200);
  assert.equal((await post('/api/followup/questionnaire/submit', 'member-b', { assignmentId: aid, answers: { goal: 'sobrescribir' } })).status, 409);
  assert.equal((await post('/api/followup/questionnaire/submit', 'member-b', { assignmentId: aid, answers: { goal: 'Ganar fuerza', days: 99 } })).status, 409);
  assert.equal((await post('/api/trainer/followup/questionnaire/assign', 'member-a', { memberId: 'member-b', templateId: 'custom-intake' })).status, 403);
  const staff = await get('/api/trainer/followup/records?id=member-b', 'trainer');
  assert.equal(staff.status, 200); assert.equal(staff.data.responses[0].answers.goal, 'Ganar fuerza');
  assert.equal(staff.data.responses[0].snapshot.questions.length, 3);
  const timeline = staff.data.timeline;
  assert.ok(timeline.some(x => x.kind === 'questionnaire_completed'));
  assert.ok(timeline.some(x => x.kind === 'review_done' && x.ref?.name === 'Fuerza base'), `timeline reuses existing program review history: ${JSON.stringify(timeline)}`);
  assert.equal((await get('/api/trainer/followup/records?id=member-b', 'member-a')).status, 403);
});

test('follow-up photos are private authenticated files, validate actual image bytes and never use social media URLs', async t => {
  t.after(() => { child.kill(); fs.rmSync(dir, { recursive: true, force: true }); });
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=';
  assert.equal((await post('/api/followup/photo', null, { image: png })).status, 401);
  assert.equal((await post('/api/followup/photo', 'trainer', { image: png })).status, 403);
  assert.equal((await post('/api/followup/photo', 'member-a', { image: 'data:image/png;base64,AAAA' })).status, 400);
  assert.equal((await post('/api/followup/photo', 'member-a', { image: png, date: '2026-02-31' })).status, 400);
  const uploaded = await post('/api/followup/photo', 'member-a', { image: png, date: today, type: 'front', note: 'prueba privada' });
  assert.equal(uploaded.status, 201); assert.equal(uploaded.data.photos.length, 1); assert.equal(uploaded.data.photos[0].type, 'front'); assert.doesNotMatch(uploaded.data.photos[0].url, /social\/media/);
  const id = uploaded.data.photos[0].id;
  const grouped = await post('/api/followup/photo', 'member-a', { images: [png, png], date: today, type: 'side' });
  assert.equal(grouped.status, 201); assert.equal(grouped.data.photos.length, 2); assert.equal(new Set(grouped.data.photos.map(x => x.entryId)).size, 1);
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(photoDir, id)).mode & 0o777, 0o600);
  assert.equal((await get(`/api/followup/photo?id=${id}`, null)).status, 401);
  assert.equal((await get(`/api/followup/photo?id=${id}`, 'member-b')).status, 404);
  const trainerImage = await get(`/api/followup/photo?id=${id}`, 'trainer');
  assert.equal(trainerImage.status, 200); assert.equal(trainerImage.headers.get('cache-control'), 'private, no-store');
  assert.equal(trainerImage.headers.get('x-content-type-options'), 'nosniff'); assert.equal(trainerImage.data.byteLength, Buffer.from(png.split(',')[1], 'base64').length);
  const records = await get('/api/followup/records', 'member-a');
  assert.equal(records.status, 200); assert.equal(records.data.photos.length, 3); assert.equal(records.data.checkins, null, 'unshared check-ins stay private');
  assert.ok(records.data.timeline.some(x => x.kind === 'progress_photo' && x.ref?.count === 2), 'a photo album appears as one timeline event');
  assert.equal(records.data.measurements.waist.at(-1).value, 86); assert.equal(records.data.objective, 'strength');
  assert.ok(records.data.timeline.some(x => x.kind === 'progress_photo'));
  const comparison = await get(`/api/trainer/followup/records?id=member-a&from=2026-09-01&to=${today}`, 'trainer');
  assert.equal(comparison.status, 200); assert.equal(comparison.data.comparison.value.measurements.waist.delta, -2);
  assert.equal(comparison.data.comparison.value.weight.delta, -1);
  assert.equal((await get('/api/trainer/followup/member?id=member-a', 'trainer')).status, 200);
  assert.equal((await post('/api/trainer/followup/analyze', 'trainer', { id: 'member-a' })).status, 200);
  assert.doesNotMatch(JSON.stringify((await post('/api/trainer/followup/analyze', 'trainer', { id: 'member-a' })).data), new RegExp(id));
});

test('pure questionnaire helpers keep old snapshots and comparisons reject invalid date ranges', () => {
  const clean = sanitizeQuestionnaireTemplate({ id: 'x', name: 'X', questions: [{ id: 'q', label: 'Goal', type: 'short_text', required: true, active: true }] });
  const assignment = makeAssignment(clean.value, 'trainer', '2026-10-01T00:00:00.000Z');
  const done = submitAssignment({ assignments: [assignment], responses: [] }, assignment.id, { q: 'Strength' }, 'member');
  assert.equal(done.value.responses[0].snapshot.questions[0].label, 'Goal');
  const changed = sanitizeQuestionnaireTemplate({ id: 'x', name: 'X', questions: [{ id: 'q', label: 'Updated', type: 'short_text', active: true }] }, clean.value);
  assert.equal(changed.value.version, 2); assert.equal(done.value.responses[0].snapshot.questions[0].label, 'Goal');
  assert.ok(compareProgress({}, {}, '2026-10-03', '2026-10-03').error);
  const goals = [
    { d: '2026-01-01', kind: 'goal_changed', goal: { before: null, after: { primary: 'strength', label: 'Fuerza', priority: 'normal' } } },
    { d: '2026-09-15', kind: 'goal_changed', goal: { before: { primary: 'strength', label: 'Fuerza', priority: 'normal' }, after: { primary: 'health', label: 'Salud', priority: 'high' } } },
  ];
  const compare = compareProgress({}, {}, '2026-02-01', '2026-10-01', goals).value.goal;
  assert.equal(compare.from.label, 'Fuerza'); assert.equal(compare.to.label, 'Salud'); assert.equal(compare.changed, true);
});

test('questionnaire dates reject impossible calendar days', () => {
  const snapshot = { questions: [{ id: 'date', label: 'Fecha', type: 'date', active: true, required: true }] };
  assert.deepEqual(validateQuestionnaireAnswers(snapshot, { date: '2026-02-28' }), { value: { date: '2026-02-28' } });
  assert.match(validateQuestionnaireAnswers(snapshot, { date: '2026-02-31' }).error, /respuesta no válida/);
});

test('photo comparison selects the closest album on or before each comparison date', () => {
  const records = { photos: [
    { id: 'start-a', entryId: 'album-start', date: '2026-02-27', type: 'front' },
    { id: 'start-b', entryId: 'album-start', date: '2026-02-27', type: 'side' },
    { id: 'middle', entryId: 'album-middle', date: '2026-03-03', type: 'front' },
    { id: 'end-a', entryId: 'album-end', date: '2026-03-08', type: 'front' },
    { id: 'end-b', entryId: 'album-end', date: '2026-03-08', type: 'side' },
    { id: 'future', entryId: 'album-future', date: '2026-03-12', type: 'front' },
  ] };
  const result = compareProgress({}, records, '2026-03-01', '2026-03-10').value.photos;
  assert.equal(result.before.date, '2026-02-27');
  assert.deepEqual(result.before.photos.map(x => x.id), ['start-a', 'start-b']);
  assert.equal(result.after.date, '2026-03-08');
  assert.deepEqual(result.after.photos.map(x => x.id), ['end-a', 'end-b']);
  const empty = compareProgress({}, {}, '2026-03-01', '2026-03-10').value.photos;
  assert.deepEqual(empty, { before: { date: null, photos: [] }, after: { date: null, photos: [] } });
});

test('Coach intake requires existing consent and only sends curated non-sensitive structured answers', () => {
  const records = { photos: [{ id: 'PHOTO-PRIVATE' }], responses: [{ snapshot: { questions: [
    { id: 'days', label: 'Días disponibles', type: 'number', shareWithCoach: true, active: true },
    { id: 'limits', label: 'Lesiones o molestias', type: 'short_text', shareWithCoach: true, active: true },
    { id: 'notes', label: 'Preferencias', type: 'long_text', shareWithCoach: true, active: true },
    { id: 'sport', label: 'Actividad adicional', type: 'short_text', shareWithCoach: true, active: true },
    { id: 'level', label: 'Nivel', type: 'single', options: ['Inicial', 'Avanzado'], shareWithCoach: true, active: true },
    { id: 'name', label: 'Nombre completo', type: 'single', options: ['Privado'], shareWithCoach: true, active: true },
    { id: 'goal', label: 'Objetivo', type: 'short_text', shareWithCoach: false, active: true },
  ] }, answers: { days: 3, limits: 'CANARY-SENSITIVE', notes: 'CANARY-FREETEXT', sport: 'CANARY-FREETEXT-SHORT', level: 'Inicial', name: 'Privado', goal: 'CANARY-NOT-CONSENTED' } }] };
  const intake = coachSafeIntake(records);
  assert.deepEqual(intake, [{ question: 'Días disponibles', answer: 3 }, { question: 'Nivel', answer: 'Inicial' }]);
  assert.deepEqual(consentedCoachIntake({ coach: {} }, records), [], 'no questionnaire data reaches Coach without the existing consent');
  assert.deepEqual(consentedCoachIntake({ coach: { consent: { agreedAt: '2026-01-01', version: 1 } } }, records), intake);
  const S = { workouts: [], week: {}, coach: { profile: { goal: 'strength' } } };
  const view = memberView({ S, u: { id: 'member', name: 'PRIVATE-NAME' }, today });
  const payload = JSON.stringify(aiFacts(view, { intake }));
  assert.match(payload, /Días disponibles/); assert.match(payload, /Inicial/); assert.doesNotMatch(payload, /CANARY-SENSITIVE|CANARY-FREETEXT|CANARY-NOT-CONSENTED|PHOTO-PRIVATE|PRIVATE-NAME/);
});
