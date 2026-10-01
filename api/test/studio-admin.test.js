// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* Entrena con 2J Admin over HTTP, on a real spawned server (same harness as guided.test.js):
 * who may change the official catalogue (admin only — a trainer assigns and uses, a member reads),
 * routines (draft → active → hidden, duplicate, reorder), programs (weeks, days, refs, publish),
 * collections (routines AND programs), the catalogue revision, and the library admin endpoints.
 * Seeds are read from the release and never rewritten. */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-'));
const SECRET = 'f'.repeat(64);
fs.writeFileSync(path.join(dir, 'secret'), SECRET, { mode: 0o600 });
fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({
  users: [{ id: 'm1', name: 'Member' }, { id: 't1', name: 'Trainer', trainer: true }, { id: 'ad', name: 'Admin', admin: true }],
  creds: [], subs: [], invites: [], recoveries: [],
}, null, 2));
const PORT = 34600, base = `http://localhost:${PORT}`;
const child = spawn(process.execPath, ['server.js'], { cwd: path.resolve('.'), env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, RP_ID: 'localhost', ORIGIN: base }, stdio: ['ignore', 'ignore', 'ignore'] });
for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* booting */ } await new Promise(r => setTimeout(r, 100)); }
const cookieFor = uid => { const p = `${uid}:${Date.now() + 86400000}:0`; return `gymsid=${p}.${crypto.createHmac('sha256', SECRET).update(p).digest('base64url')}`; };
async function req(method, p, uid, body) {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(uid ? { cookie: cookieFor(uid) } : {}) }, body: body && JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* none */ }
  return { status: r.status, body: j };
}
const seedText = fs.readFileSync(path.resolve('lib/guided-official.json'), 'utf8');
const progText = fs.readFileSync(path.resolve('lib/guided-programs-official.json'), 'utf8');
const SEED = JSON.parse(seedText);
const PROGRAMS = JSON.parse(progText);
test.after(() => { child.kill(); });

// A small, valid official routine: copy of an official one with new text, status chosen by the caller.
const seedRoutine = SEED.routines.find(r => r.id === 'r2j-strength-upper-b');
const routineOf = (over = {}) => ({ scope: 'official', name: 'Estudio · Upper test', description: 'Una rutina de prueba.', category: seedRoutine.category, goal: seedRoutine.goal,
  level: seedRoutine.level, focus: seedRoutine.focus, ex: seedRoutine.ex, blocks: seedRoutine.blocks, ...over });
const ids = list => list.map(x => x.id);
let draftId, rev0;

test('only admins write the official catalogue: members and trainers are refused on every write', async () => {
  const writes = [
    ['POST', '/api/guided/save', { routine: routineOf({ status: 'draft' }) }],
    ['POST', '/api/guided/status', { id: 'r2j-core-start', status: 'hidden' }],
    ['POST', '/api/guided/reorder', { kind: 'routines', ids: ['r2j-core-start'] }],
    ['POST', '/api/guided/program/save', { program: { name: 'x', description: 'y', weeks: [{ sessions: [{ day: 1, routineId: 'r2j-core-start' }] }] } }],
    ['POST', '/api/guided/program/duplicate', { id: PROGRAMS.programs[0].id }],
    ['POST', '/api/guided/program/delete', { id: 'g2jc-nope' }],
    ['POST', '/api/guided/collection', { collection: { name: 'x' } }],
    ['POST', '/api/guided/collection/delete', { id: 'c2jc-x' }],
    ['POST', '/api/guided/curate', { id: 'r2j-core-start', featured: 1 }],
    ['POST', '/api/guided/duplicate', { id: 'r2j-core-start', official: true }],
    ['POST', '/api/admin/library/save', { id: '0044', patch: { n: 'x' } }],
    ['GET', '/api/admin/library'],
  ];
  for (const [m, p, b] of writes) {
    assert.equal((await req(m, p, undefined, b)).status, 401, 'anonymous ' + p);
    assert.equal((await req(m, p, 'm1', b)).status, 403, 'member ' + p);
    // a trainer who is not an admin may use and assign, never change an official master
    const t = await req(m, p, 't1', b);
    assert.ok([403].includes(t.status) || (p === '/api/guided/save' && t.status === 403), `trainer ${p} → ${t.status}`);
  }
  assert.equal(fs.existsSync(path.join(dir, 'guided.json')), false, 'nothing was written');
  assert.equal(fs.existsSync(path.join(dir, 'library-admin.json')), false);
});

test('draft → active → hidden: members only ever see active routines; the admin sees them all with their status', async () => {
  rev0 = (await req('GET', '/api/guided', 'ad')).body.rev;
  const dry = await req('POST', '/api/guided/save', 'ad', { routine: routineOf({ status: 'draft' }), dryRun: true });
  assert.equal(dry.status, 200);
  assert.equal(dry.body.dryRun, true);
  assert.equal(fs.existsSync(path.join(dir, 'guided.json')), false, 'a dry run stores nothing');
  const c = await req('POST', '/api/guided/save', 'ad', { routine: routineOf({ status: 'draft', purpose: 'warmup', cover: 'mobility', notes: 'Pendiente de revisar' }) });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  draftId = c.body.routine.id;
  assert.equal(c.body.routine.status, 'draft');
  assert.equal(c.body.routine.purpose, 'warmup');
  assert.equal(c.body.routine.cover, 'mobility');
  assert.equal(c.body.routine.official, true);
  const admin = (await req('GET', '/api/guided', 'ad')).body;
  assert.equal(admin.routines.find(r => r.id === draftId).status, 'draft');
  assert.ok(admin.rev !== rev0, 'the catalogue revision moves on every change');
  assert.ok(!ids((await req('GET', '/api/guided', 'm1')).body.routines).includes(draftId), 'members never see a draft');
  assert.ok(!ids((await req('GET', '/api/guided', 't1')).body.routines).includes(draftId));
  const pub = await req('POST', '/api/guided/status', 'ad', { id: draftId, status: 'active' });
  assert.equal(pub.status, 200);
  assert.equal(pub.body.routine.status, 'active');
  assert.ok(ids((await req('GET', '/api/guided', 'm1')).body.routines).includes(draftId));
  const hide = await req('POST', '/api/guided/status', 'ad', { id: draftId, status: 'hidden' });
  assert.equal(hide.body.routine.status, 'hidden');
  assert.ok(!ids((await req('GET', '/api/guided', 'm1')).body.routines).includes(draftId));
  assert.ok(ids((await req('GET', '/api/guided', 'ad')).body.routines).includes(draftId));
  assert.equal((await req('POST', '/api/guided/status', 'ad', { id: draftId, status: 'nonsense' })).status, 400);
  assert.equal((await req('POST', '/api/guided/status', 'ad', { id: 'nope', status: 'active' })).status, 404);
});

test('invalid content is refused with a useful message: duplicates, unknown ids, wrong format, protocol FAIL', async () => {
  const dup = await req('POST', '/api/guided/save', 'ad', { routine: routineOf({ ex: [{ id: '0309', sets: 3, reps: 12, mode: 'reps', blk: 'x' }], blocks: [] }) });
  assert.equal(dup.status, 400);
  assert.match(dup.body.error, /duplicado/);
  const ghost = await req('POST', '/api/guided/save', 'ad', { routine: routineOf({ ex: [{ id: '9999', sets: 3, reps: 12, mode: 'reps' }], blocks: [] }) });
  assert.equal(ghost.status, 400);
  const empty = await req('POST', '/api/guided/save', 'ad', { routine: routineOf({ ex: [] }) });
  assert.equal(empty.status, 400);
  const noName = await req('POST', '/api/guided/save', 'ad', { routine: routineOf({ name: '  ' }) });
  assert.equal(noName.status, 400);
  // a "mobility" routine cannot be made of strength parts; a "tabata" one needs tabata parts
  const wrongFormat = await req('POST', '/api/guided/save', 'ad', { routine: routineOf({ category: 'mobility' }) });
  assert.equal(wrongFormat.status, 400);
  assert.match(wrongFormat.body.error, /Movilidad/);
  assert.equal((await req('POST', '/api/guided/save', 'ad', { routine: routineOf({ category: 'tabata' }) })).status, 400);
  // publishing a seed routine that is fine stays possible
  assert.equal((await req('POST', '/api/guided/status', 'ad', { id: 'r2j-core-start', status: 'active' })).status, 200);
});

test('duplicate an official routine into an editable official DRAFT; the original and the seed file stay untouched', async () => {
  const d = await req('POST', '/api/guided/duplicate', 'ad', { id: 'r2j-core-start', official: true });
  assert.equal(d.status, 200);
  assert.equal(d.body.routine.status, 'draft');
  assert.equal(d.body.routine.official, true);
  assert.equal(d.body.routine.copiedFrom, 'r2j-core-start');
  assert.notEqual(d.body.routine.id, 'r2j-core-start');
  assert.match(d.body.routine.name, /copy/);
  const edit = await req('POST', '/api/guided/save', 'ad', { routine: { ...d.body.routine, name: 'Core · copia editada', status: 'draft' } });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  assert.equal(edit.body.routine.name, 'Core · copia editada');
  const orig = (await req('GET', '/api/guided', 'ad')).body.routines.find(r => r.id === 'r2j-core-start');
  assert.equal(orig.name, SEED.routines.find(r => r.id === 'r2j-core-start').name);
  assert.equal(fs.readFileSync(path.resolve('lib/guided-official.json'), 'utf8'), seedText, 'the seed is read from the release, never rewritten');
  // an admin can delete what the admin created, never a seed routine
  assert.equal((await req('POST', '/api/guided/delete', 'ad', { id: d.body.routine.id })).status, 200);
  assert.equal((await req('POST', '/api/guided/delete', 'ad', { id: 'r2j-core-start' })).status, 400);
});

test('reorder: the position in the list is the order; unknown ids are refused', async () => {
  const all = (await req('GET', '/api/guided', 'ad')).body.routines.map(r => r.id);
  const tail = all.slice(0, 5).reverse();
  const r = await req('POST', '/api/guided/reorder', 'ad', { kind: 'routines', ids: tail });
  assert.equal(r.status, 200);
  const after = (await req('GET', '/api/guided', 'ad')).body.routines;
  tail.forEach((id, i) => assert.equal(after.find(x => x.id === id).order, i));
  assert.equal((await req('POST', '/api/guided/reorder', 'ad', { kind: 'routines', ids: ['nope'] })).status, 404);
  assert.equal((await req('POST', '/api/guided/reorder', 'ad', { kind: 'nonsense', ids: ['a'] })).status, 400);
  assert.equal((await req('POST', '/api/guided/reorder', 'ad', { kind: 'routines', ids: [] })).status, 400);
});

const week = (...routineIds) => ({ sessions: routineIds.map((routineId, i) => ({ day: [1, 3, 5, 6][i], routineId })) });
const program = (over = {}) => ({ name: 'Estudio · Programa', description: 'Tres semanas de prueba.', goal: 'general', level: 'beginner', cover: 'mobility',
  weeks: [week('r2j-mobility-fullbody', 'r2j-core-start'), week('r2j-mobility-hips', 'r2j-core-start'), week('r2j-mobility-fullbody')], ...over });
let progId;

test('programs: a draft is built from active routines, validated, then published; weeks and days are the admin’s', async () => {
  const dry = await req('POST', '/api/guided/program/save', 'ad', { program: program({ status: 'draft' }), dryRun: true });
  assert.equal(dry.status, 200, JSON.stringify(dry.body));
  assert.equal(dry.body.program.weeksCount, 3);
  assert.equal(dry.body.program.sessionsPerWeek, 2);
  assert.equal(dry.body.program.durationLabel, '3 weeks');
  const saved = await req('POST', '/api/guided/program/save', 'ad', { program: program({ status: 'draft', featured: true }) });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  progId = saved.body.program.id;
  assert.match(progId, /^g2jc-[a-f0-9]{12}$/);
  assert.equal(saved.body.program.status, 'draft');
  assert.equal(saved.body.program.custom, true);
  assert.equal(saved.body.program.lowImpact, false, 'computed from its routines: the core session is not curated low impact');
  const gentle = await req('POST', '/api/guided/program/save', 'ad', { program: program({ weeks: [week('r2j-mobility-fullbody', 'r2j-mobility-hips')], status: 'draft' }), dryRun: true });
  assert.equal(gentle.body.program.lowImpact, true, 'all-mobility programs are low impact');
  assert.ok(saved.body.program.equipment.length);
  assert.ok(!ids((await req('GET', '/api/guided', 'm1')).body.programs).includes(progId), 'members never see a draft program');
  assert.ok(ids((await req('GET', '/api/guided', 'ad')).body.programs).includes(progId));
  // edit weeks and days
  const edited = await req('POST', '/api/guided/program/save', 'ad', { program: { ...saved.body.program, status: 'draft', weeks: [week('r2j-mobility-fullbody', 'r2j-mobility-hips', 'r2j-core-start', 'r2j-mobility-upper-back'), week('r2j-core-start')] } });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(edited.body.program.weeksCount, 2);
  assert.equal(edited.body.program.sessionsPerWeek, 4);
  assert.equal(edited.body.program.id, progId, 'same program, same id');
  const pub = await req('POST', '/api/guided/program/save', 'ad', { program: { ...edited.body.program, status: 'active' } });
  assert.equal(pub.status, 200, JSON.stringify(pub.body));
  assert.equal(pub.body.program.status, 'active');
  const member = (await req('GET', '/api/guided', 'm1')).body.programs.find(p => p.id === progId);
  assert.ok(member && member.weeks.length === 2 && member.routineIds.length === 4);
  // the trainer assigns an active program like any other (snapshot, existing endpoint)
  assert.equal((await req('POST', '/api/guided/program/curate', 'ad', { id: progId, active: false })).body.program.status, 'hidden');
  assert.ok(!ids((await req('GET', '/api/guided', 'm1')).body.programs).includes(progId));
});

test('programs: broken references, empty weeks, impossible days and unpublished routines are refused with a reason', async () => {
  const unknown = await req('POST', '/api/guided/program/save', 'ad', { program: program({ weeks: [week('r2j-mobility-fullbody', 'no-such-routine')] }) });
  assert.equal(unknown.status, 400);
  assert.match(unknown.body.error, /no existe/);
  assert.equal((await req('POST', '/api/guided/program/save', 'ad', { program: program({ weeks: [] }) })).status, 400);
  assert.equal((await req('POST', '/api/guided/program/save', 'ad', { program: program({ weeks: [{ sessions: [] }] }) })).status, 400);
  assert.equal((await req('POST', '/api/guided/program/save', 'ad', { program: program({ name: '' }) })).status, 400);
  assert.equal((await req('POST', '/api/guided/program/save', 'ad', { program: program({ description: '' }) })).status, 400);
  // two sessions on one day collapse to one (a day holds a single session)
  const sameDay = await req('POST', '/api/guided/program/save', 'ad', { program: program({ weeks: [{ sessions: [{ day: 2, routineId: 'r2j-mobility-fullbody' }, { day: 2, routineId: 'r2j-core-start' }] }], status: 'draft' }), dryRun: true });
  assert.equal(sameDay.body.program.weeks[0].sessions.length, 1);
  // a draft or hidden routine cannot back a PUBLISHED program, but can back a draft one
  const draftRoutine = await req('POST', '/api/guided/save', 'ad', { routine: routineOf({ name: 'Borrador para programa', status: 'draft' }) });
  const withDraft = program({ weeks: [week('r2j-mobility-fullbody', draftRoutine.body.routine.id)] });
  assert.equal((await req('POST', '/api/guided/program/save', 'ad', { program: { ...withDraft, status: 'draft' } })).status, 200);
  const blocked = await req('POST', '/api/guided/program/save', 'ad', { program: { ...withDraft, status: 'active' } });
  assert.equal(blocked.status, 400);
  assert.match(blocked.body.error, /borrador/);
  // a routine a program uses cannot be deleted from under it
  assert.equal((await req('POST', '/api/guided/delete', 'ad', { id: draftRoutine.body.routine.id })).status, 400);
  // limits
  const tooLong = await req('POST', '/api/guided/program/save', 'ad', { program: program({ weeks: Array.from({ length: 13 }, () => week('r2j-mobility-fullbody')) }), dryRun: true });
  assert.equal(tooLong.body.program.weeksCount, 12, 'weeks are capped, never silently more');
});

test('a seed program is edited as an overlay (the release file is untouched); copies are drafts; only custom ones are deleted', async () => {
  const seed = PROGRAMS.programs[0];
  const view = (await req('GET', '/api/guided', 'ad')).body.programs.find(p => p.id === seed.id);
  const e = await req('POST', '/api/guided/program/save', 'ad', { program: { ...view, name: 'Primeros pasos · edición', status: 'active', weeks: view.weeks.slice(0, 3) } });
  assert.equal(e.status, 200, JSON.stringify(e.body));
  assert.equal(e.body.program.name, 'Primeros pasos · edición');
  assert.equal(e.body.program.weeksCount, 3);
  assert.equal(e.body.program.custom, false);
  assert.equal(fs.readFileSync(path.resolve('lib/guided-programs-official.json'), 'utf8'), progText, 'the seed program file is never rewritten');
  const cp = await req('POST', '/api/guided/program/duplicate', 'ad', { id: seed.id });
  assert.equal(cp.status, 200);
  assert.equal(cp.body.program.status, 'draft');
  assert.equal(cp.body.program.custom, true);
  assert.equal(cp.body.program.featured, false);
  assert.equal((await req('POST', '/api/guided/program/delete', 'ad', { id: seed.id })).status, 400, 'a release program is hidden, not deleted');
  assert.equal((await req('POST', '/api/guided/program/delete', 'ad', { id: cp.body.program.id })).status, 200);
  assert.equal((await req('POST', '/api/guided/program/delete', 'ad', { id: cp.body.program.id })).status, 404);
  const order = (await req('GET', '/api/guided', 'ad')).body.programs.map(p => p.id).reverse();
  assert.equal((await req('POST', '/api/guided/reorder', 'ad', { kind: 'programs', ids: order })).status, 200);
  assert.equal((await req('GET', '/api/guided', 'ad')).body.programs[0].id, order[0]);
});

test('collections hold routines AND programs; custom ones are deleted, release ones deactivated; unknown refs are dropped', async () => {
  const c = await req('POST', '/api/guided/collection', 'ad', { collection: { name: 'Estudio · Colección', description: 'Mezcla', style: 'mobility', active: true, featured: true,
    routineIds: ['r2j-mobility-hips', 'nope', 'r2j-core-start'], programIds: [progId, 'nope'] } });
  assert.equal(c.status, 200);
  const made = c.body.collections.find(x => x.name === 'Estudio · Colección');
  assert.deepEqual(made.routineIds, ['r2j-mobility-hips', 'r2j-core-start']);
  assert.deepEqual(made.programIds, [progId]);
  assert.equal(made.featured, true);
  // members see only what is active inside it (the program is hidden now)
  const m = (await req('GET', '/api/guided', 'm1')).body.collections.find(x => x.id === made.id);
  assert.deepEqual(m.programIds, []);
  assert.deepEqual(m.routineIds, ['r2j-mobility-hips', 'r2j-core-start']);
  const upd = await req('POST', '/api/guided/collection', 'ad', { collection: { ...made, name: 'Estudio · Colección 2', routineIds: ['r2j-core-start'], programIds: [] } });
  assert.equal(upd.body.collections.find(x => x.id === made.id).name, 'Estudio · Colección 2');
  assert.equal((await req('POST', '/api/guided/collection', 'ad', { collection: { id: 'c2jc-nope', name: 'x' } })).status, 404);
  assert.equal((await req('POST', '/api/guided/collection', 'ad', { collection: { name: ' ' } })).status, 400);
  const all = (await req('GET', '/api/guided', 'ad')).body.collections.map(x => x.id).reverse();
  assert.equal((await req('POST', '/api/guided/reorder', 'ad', { kind: 'collections', ids: all })).status, 200);
  assert.equal((await req('POST', '/api/guided/collection/delete', 'ad', { id: SEED.collections[0].id })).status, 400);
  assert.equal((await req('POST', '/api/guided/collection/delete', 'ad', { id: made.id })).status, 200);
  assert.equal((await req('POST', '/api/guided/collection/delete', 'ad', { id: made.id })).status, 404);
});

test('cache: /api/guided and /api/config carry the same catalogue revision, and it moves with every accepted edit', async () => {
  const a = (await req('GET', '/api/guided', 'ad')).body.rev;
  assert.equal((await req('GET', '/api/config')).body.guidedRev, a);
  assert.equal((await req('POST', '/api/guided/curate', 'ad', { id: 'r2j-core-start', badge: 'new' })).status, 200);
  const b = (await req('GET', '/api/guided', 'ad')).body.rev;
  assert.notEqual(a, b);
  assert.equal((await req('GET', '/api/config')).body.guidedRev, b);
  // a refused edit does not move it
  assert.equal((await req('POST', '/api/guided/reorder', 'ad', { kind: 'routines', ids: ['nope'] })).status, 404);
  assert.equal((await req('GET', '/api/guided', 'ad')).body.rev, b);
  // members get the same revision, so a stale device copy is recognisable
  assert.equal((await req('GET', '/api/guided', 'm1')).body.rev, b);
});

test('library admin over HTTP: save, public overlay in /api/config without notes, refusals, reset', async () => {
  assert.deepEqual((await req('GET', '/api/config')).body.libraryOverlay.entries, {});
  const s = await req('POST', '/api/admin/library/save', 'ad', { id: '1362', patch: { n: 'sphinx pose', aliases: ['esfinge baja'], note: 'Revisado por admin' } });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const pub = (await req('GET', '/api/config')).body.libraryOverlay;
  assert.equal(pub.entries['1362'].n, 'sphinx pose');
  assert.equal(pub.entries['1362'].note, undefined, 'notes are admin-only');
  assert.equal(pub.rev, 1);
  assert.equal((await req('GET', '/api/admin/library', 'ad')).body.overlay.entries['1362'].note, 'Revisado por admin');
  assert.equal((await req('POST', '/api/admin/library/save', 'ad', { id: '0025', patch: { preferredId: '0289' } })).status, 400, 'used by official content');
  assert.equal((await req('POST', '/api/admin/library/save', 'ad', { id: '0125', patch: { preferredId: '0126' } })).status, 200);
  assert.equal((await req('POST', '/api/admin/library/save', 'ad', { id: '0126', patch: { preferredId: '0125' } })).status, 400, 'no cycles');
  assert.equal((await req('POST', '/api/admin/library/save', 'ad', { id: '1362', reset: true })).status, 200);
  assert.equal((await req('GET', '/api/config')).body.libraryOverlay.entries['1362'], undefined);
  assert.equal((await req('POST', '/api/admin/library/save', 'ad', { variant: ['0305', '0304'], keep: true })).status, 200);
  assert.equal((await req('GET', '/api/config')).body.libraryOverlay.variants.length, 1);
  // the stored file is tiny and holds only what changed
  const stored = JSON.parse(fs.readFileSync(path.join(dir, 'library-admin.json'), 'utf8'));
  assert.deepEqual(Object.keys(stored.entries), ['0125']);
});

test('the AI never offers a duplicate or hidden routine: Coach candidates follow status and the effective library', async () => {
  const guided = await import('../lib/guided-store.js');
  const before = guided.compatibleRoutines({ goal: 'general', level: 'beginner', max: 500 }).map(r => r.id);
  assert.ok(!before.includes(draftId), 'a hidden routine is not a candidate');
  assert.ok(before.length > 0);
});
