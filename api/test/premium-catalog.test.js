import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { bootSocial } from './social-http.mjs';

/* Premium catalogue over HTTP: who sees what, who can change what, the status semantics, versions, safe deletion and the global switch. */
const S = await bootSocial({ tag: 'premium-catalog' });
test.after(() => S.stop());
const { call } = S;
const seedFile = fileURLToPath(new URL('../lib/premium-official.json', import.meta.url));
const seedHash = () => crypto.createHash('sha256').update(fs.readFileSync(seedFile)).digest('hex');
const SEED_HASH = seedHash();

const mini = (o = {}) => ({
  name: 'My method', shortDescription: 'Short.', longDescription: 'Long description.', goalTags: ['hypertrophy'], level: 'beginner', daysPerWeek: 1,
  durationDescription: '1 week', methodType: 'full-body', sourceType: 'own', evidenceSummary: 'Own design; no direct evidence.', equipmentRequirements: ['dumbbells'],
  progressionModel: 'double-progression',
  programDefinition: { schema: 1, cycleWeeks: 1, weeks: [{ sessions: [{ key: 'day-a', title: 'Day A', blocks: [{ role: 'main', exercise: '0043', scheme: { sets: 3, repsMin: 8, repsMax: 12 } }] }] }] },
  ...o,
});
const list = async uid => (await call(uid, 'GET', '/api/premium')).data;
const ids = async uid => (await list(uid)).programs.map(p => p.id);

test('members see the 12 published official programs: summaries with setup data, no definition, no legal notes', async () => {
  const r = await call('a', 'GET', '/api/premium');
  assert.equal(r.status, 200);
  assert.equal(r.data.programs.length, 12); assert.equal(r.data.canEdit, false); assert.equal(r.data.canAuthor, false);
  const p = r.data.programs.find(x => x.slug === '531');
  assert.equal(p.programDefinition, undefined); assert.equal(p.legal, undefined);
  assert.deepEqual(p.setup.lifts.map(l => l.key), ['squat', 'bench', 'deadlift', 'press']); assert.equal(p.setup.cycleWeeks, 4); assert.equal(p.setup.sessionsPerCycle, 16);
  assert.ok(p.locales.es.howItWorks.length >= 3);
  assert.equal((await call('a', 'GET', '/api/premium')).data.programs.every(x => x.status === 'published'), true);
  assert.equal((await fetch(S.base + '/api/premium')).status, 401);
});

test('the full program (with its definition) is served to a member only while it is published', async () => {
  const r = await call('a', 'GET', '/api/premium/program?slug=531');
  assert.equal(r.status, 200); assert.equal(r.data.program.programDefinition.cycleWeeks, 4); assert.equal(r.data.program.legal, undefined);
  assert.equal((await call('a', 'GET', '/api/premium/program?id=nope')).status, 404);
  const admin = await call('admin', 'GET', '/api/premium/program?slug=531');
  assert.equal(admin.data.program.legal.status, 'review');
});

test('ACL: a member changes nothing; a trainer only ever works on their own personal programs and cannot publish, feature, order or promote', async () => {
  for (const [path, body] of [['/api/premium/save', { program: mini() }], ['/api/premium/status', { id: 'premium-531', status: 'hidden' }], ['/api/premium/duplicate', { id: 'premium-531' }], ['/api/premium/delete', { id: 'x' }]]) {
    assert.equal((await call('a', 'POST', path, body)).status, 403, 'member ' + path);
  }
  const created = await call('trainer-a', 'POST', '/api/premium/save', { program: mini({ status: 'published', featured: true, version: 99, createdBy: 'admin', scope: 'catalog' }) });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const mine = created.data.program;
  assert.deepEqual([mine.status, mine.scope, mine.featured, mine.version, mine.createdBy], ['draft', 'personal', false, 1, 'trainer-a'], 'system fields are never read from the input');
  assert.equal((await call('trainer-a', 'POST', '/api/premium/status', { id: mine.id, status: 'published' })).status, 403);
  assert.equal((await call('trainer-a', 'POST', '/api/premium/status', { id: mine.id, status: 'hidden' })).status, 200);
  for (const [path, body] of [['/api/premium/feature', { id: mine.id, featured: true }], ['/api/premium/reorder', { ids: [mine.id] }], ['/api/premium/promote', { id: mine.id }], ['/api/premium/restore', { id: mine.id, at: 'x' }]]) {
    assert.equal((await call('trainer-a', 'POST', path, body)).status, 403, 'trainer ' + path);
  }
  assert.equal((await call('trainer-a', 'GET', '/api/premium/history?id=' + mine.id)).status, 403);
  // an official program or somebody else's is out of reach
  assert.equal((await call('trainer-a', 'POST', '/api/premium/save', { program: { ...mini(), id: 'premium-531' } })).status, 403);
  assert.equal((await call('trainer-x', 'POST', '/api/premium/save', { program: { ...mini(), id: mine.id } })).status, 404, 'invisible to another trainer');
  assert.equal((await call('trainer-x', 'POST', '/api/premium/status', { id: mine.id, status: 'archived' })).status, 404);
  assert.equal((await call('trainer-x', 'GET', '/api/premium/program?id=' + mine.id)).status, 404);
  assert.equal((await ids('trainer-x')).includes(mine.id), false); assert.equal((await ids('trainer-a')).includes(mine.id), true); assert.equal((await ids('a')).includes(mine.id), false);
  assert.equal((await ids('admin')).includes(mine.id), true, 'the admin can see it, to promote it');
  const del = await call('trainer-a', 'POST', '/api/premium/delete', { id: mine.id });
  assert.equal(del.status, 200, 'a personal, never-published, unused program can be deleted by its author');
});

test('status semantics: draft is private, published is listed, hidden and archived are not, and the admin sees all', async () => {
  const c = (await call('admin', 'POST', '/api/premium/save', { program: mini({ name: 'Catalogue method' }) })).data.program;
  assert.deepEqual([c.scope, c.status], ['catalog', 'draft']);
  assert.equal((await ids('a')).includes(c.id), false);
  assert.equal((await call('admin', 'POST', '/api/premium/status', { id: c.id, status: 'published' })).status, 200);
  assert.equal((await ids('a')).includes(c.id), true);
  assert.equal((await call('a', 'GET', '/api/premium/program?id=' + c.id)).status, 200);
  await call('admin', 'POST', '/api/premium/status', { id: c.id, status: 'hidden' });
  assert.equal((await ids('a')).includes(c.id), false, 'hidden: not offered to new members');
  assert.equal((await call('a', 'GET', '/api/premium/program?id=' + c.id)).status, 404);
  assert.equal((await ids('admin')).includes(c.id), true);
  await call('admin', 'POST', '/api/premium/status', { id: c.id, status: 'archived' });
  assert.equal((await ids('a')).includes(c.id), false); assert.equal((await list('admin')).programs.find(p => p.id === c.id).status, 'archived');
  assert.equal((await call('admin', 'POST', '/api/premium/status', { id: c.id, status: 'bogus' })).status, 400);
  // official programs can be hidden and featured too, without touching the seed
  await call('admin', 'POST', '/api/premium/status', { id: 'premium-phat', status: 'hidden' });
  assert.equal((await ids('a')).includes('premium-phat'), false); assert.equal((await ids('a')).length, 11);
  await call('admin', 'POST', '/api/premium/status', { id: 'premium-phat', status: 'published' });
  assert.equal((await ids('a')).length, 12);
});

test('featured, badge and order are merchandising: they change the list but never the content or the version', async () => {
  const before = (await list('admin')).programs.find(p => p.id === 'premium-dup');
  const r = await call('admin', 'POST', '/api/premium/feature', { id: 'premium-dup', featured: true, badge: 'recommended' });
  assert.deepEqual([r.data.program.featured, r.data.program.badge, r.data.program.version], [true, 'recommended', before.version]);
  await call('admin', 'POST', '/api/premium/reorder', { ids: ['premium-dup', 'premium-531'] });
  const order = (await ids('a')).slice(0, 2); assert.deepEqual(order, ['premium-dup', 'premium-531']);
  assert.equal((await call('admin', 'POST', '/api/premium/feature', { id: 'premium-dup', featured: false, badge: 'nonsense' })).data.program.badge, null);
  assert.equal((await call('admin', 'GET', '/api/premium/history?id=premium-dup')).data.versions.length, 0, 'merchandising leaves no version');
});

test('a trainer’s personal program is promoted by an admin, then published to members', async () => {
  const mine = (await call('trainer-a', 'POST', '/api/premium/save', { program: mini({ name: 'Trainer idea' }) })).data.program;
  assert.equal((await call('trainer-a', 'POST', '/api/premium/status', { id: mine.id, status: 'published' })).status, 403);
  assert.equal((await call('admin', 'POST', '/api/premium/status', { id: mine.id, status: 'published' })).status, 409, 'personal cannot be published');
  const promoted = await call('admin', 'POST', '/api/premium/promote', { id: mine.id });
  assert.deepEqual([promoted.data.program.scope, promoted.data.program.status, promoted.data.program.createdBy], ['catalog', 'draft', 'trainer-a']);
  assert.equal((await call('admin', 'POST', '/api/premium/status', { id: mine.id, status: 'published' })).status, 200);
  assert.equal((await ids('a')).includes(mine.id), true);
  assert.equal((await call('trainer-a', 'POST', '/api/premium/save', { program: { ...mini(), id: mine.id, name: 'Sneaky edit' } })).status, 403, 'once in the catalogue the author no longer edits it');
});

test('editing bumps the version and keeps the old one; restoring goes through the same validation; the seed file never changes', async () => {
  const before = (await call('admin', 'GET', '/api/premium/program?id=premium-full-body-conditioning')).data.program;
  const edit = { ...before, name: 'Full Body Conditioning (edited)' };
  const r = await call('admin', 'POST', '/api/premium/save', { program: edit });
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.program.version, before.version + 1); assert.equal(r.data.program.name, 'Full Body Conditioning (edited)');
  assert.ok(r.data.program.locales.es.howItWorks, 'the Spanish text survives an edit');
  const again = await call('admin', 'POST', '/api/premium/save', { program: { ...edit } });
  assert.equal(again.status, 200, JSON.stringify(again.data));
  assert.equal(again.data.program.version, before.version + 1, 'saving the same content again is not a new version');
  const versions = (await call('admin', 'GET', '/api/premium/history?id=premium-full-body-conditioning')).data.versions;
  assert.equal(versions.length, 1); assert.equal(versions[0].name, before.name);
  const back = await call('admin', 'POST', '/api/premium/restore', { id: 'premium-full-body-conditioning', at: versions[0].at });
  assert.equal(back.status, 200); assert.equal(back.data.program.name, before.name); assert.equal(back.data.program.version, before.version + 2);
  assert.equal(seedHash(), SEED_HASH, 'the shipped seed is read-only');
});

test('an invalid program is refused with the reasons; a dry run validates without saving', async () => {
  const bad = mini(); bad.programDefinition.weeks[0].sessions[0].blocks[0].exercise = '9999';
  const r = await call('trainer-a', 'POST', '/api/premium/save', { program: bad });
  assert.equal(r.status, 400); assert.ok(r.data.issues.some(i => i.startsWith('definition.block-exercise')));
  const pct = mini({ programDefinition: { schema: 1, cycleWeeks: 1, lifts: [{ key: 'squat', exercise: '0043', group: 'lower' }], weeks: [{ sessions: [{ key: 'a', title: 'A', blocks: [{ role: 'main', lift: 'squat', sets: [{ pct: 5, reps: 5 }] }] }] }] } });
  assert.ok((await call('trainer-a', 'POST', '/api/premium/save', { program: pct })).data.issues.some(i => i.startsWith('definition.set-spec')));
  const count = (await list('trainer-a')).programs.length;
  const dry = await call('trainer-a', 'POST', '/api/premium/save', { program: mini({ name: 'Dry' }), dryRun: true });
  assert.equal(dry.status, 200); assert.equal(dry.data.dryRun, true); assert.equal((await list('trainer-a')).programs.length, count);
  const extra = mini(); extra.programDefinition.weeks[0].sessions[0].blocks[0].evil = '<script>'; extra.programDefinition.hack = 1;
  const ok = await call('trainer-a', 'POST', '/api/premium/save', { program: extra });
  const stored = (await call('trainer-a', 'GET', '/api/premium/program?id=' + ok.data.program.id)).data.program;
  assert.equal(JSON.stringify(stored.programDefinition).includes('evil'), false); assert.equal(stored.programDefinition.hack, undefined);
});

test('safe deletion: official programs, published ones and programs somebody started are archived, never deleted', async () => {
  assert.equal((await call('admin', 'POST', '/api/premium/delete', { id: 'premium-531' })).status, 409);
  const c = (await call('admin', 'POST', '/api/premium/save', { program: mini({ name: 'To publish' }) })).data.program;
  await call('admin', 'POST', '/api/premium/status', { id: c.id, status: 'published' });
  const pub = await call('admin', 'POST', '/api/premium/delete', { id: c.id });
  assert.equal(pub.status, 409); assert.equal(pub.data.code, 'in_use');
  const t = (await call('trainer-a', 'POST', '/api/premium/save', { program: mini({ name: 'Used draft' }) })).data.program;
  assert.equal((await call('a', 'POST', '/api/premium/started', { programId: t.id })).status, 200);
  const used = await call('trainer-a', 'POST', '/api/premium/delete', { id: t.id });
  assert.equal(used.status, 409, 'it was started: archive it');
  assert.equal((await call('trainer-a', 'POST', '/api/premium/status', { id: t.id, status: 'archived' })).status, 200);
  assert.equal((await call('admin', 'GET', '/api/premium')).data.programs.find(p => p.id === t.id).usage.started, 1);
  assert.equal((await call('a', 'GET', '/api/premium')).data.programs.some(p => p.usage), false, 'usage is staff-only');
  assert.equal((await call('trainer-x', 'POST', '/api/premium/delete', { id: t.id })).status, 404);
});

test('duplicate: a trainer keeps a personal copy of any program they can see; an admin can copy into a catalogue draft', async () => {
  const d = await call('trainer-a', 'POST', '/api/premium/duplicate', { id: 'premium-phul' });
  assert.equal(d.status, 200, JSON.stringify(d.data));
  assert.deepEqual([d.data.program.scope, d.data.program.status, d.data.program.name, d.data.program.createdBy], ['personal', 'draft', 'PHUL (copy)', 'trainer-a']);
  assert.equal((await call('trainer-a', 'POST', '/api/premium/duplicate', { id: 'premium-phul' })).data.program.slug, 'phul-copy-2');
  const a = await call('admin', 'POST', '/api/premium/duplicate', { id: 'premium-phul', catalog: true });
  assert.deepEqual([a.data.program.scope, a.data.program.status], ['catalog', 'draft']);
  assert.equal((await call('trainer-x', 'POST', '/api/premium/duplicate', { id: d.data.program.id })).status, 404, 'cannot copy another trainer’s private program');
});

test('the global switch: OFF hides the catalogue from members (403 feature_off) but not from staff, ON restores it', async () => {
  assert.equal((await call('admin', 'POST', '/api/admin/features', { features: { premium: false } })).status, 200);
  const m = await call('a', 'GET', '/api/premium'); assert.equal(m.status, 403); assert.equal(m.data.code, 'feature_off');
  assert.equal((await call('a', 'GET', '/api/premium/program?slug=531')).status, 403);
  assert.equal((await call('trainer-a', 'GET', '/api/premium')).status, 200); assert.equal((await call('admin', 'GET', '/api/premium')).data.enabled, false);
  assert.equal((await call('a', 'POST', '/api/premium/started', { programId: 'premium-531' })).status, 200, 'reporting never fails for a member');
  assert.equal((await call('admin', 'GET', '/api/features')).data.features.premium, false);
  await call('admin', 'POST', '/api/admin/features', { features: { premium: true } });
  assert.equal((await call('a', 'GET', '/api/premium')).status, 200);
});
