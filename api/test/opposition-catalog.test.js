import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { bootSocial } from './social-http.mjs';

/* Oposiciones profile catalogue over HTTP: who sees what, who can change what, hidden-by-default seed, official sources, versioning, privacy of the switch. */
const S = await bootSocial({ tag: 'opposition-catalog' });
test.after(() => S.stop());
const { call } = S;
const seedFile = fileURLToPath(new URL('../lib/opposition-official.json', import.meta.url));
const seedHash = () => crypto.createHash('sha256').update(fs.readFileSync(seedFile)).digest('hex');
const SEED_HASH = seedHash();
const seed = JSON.parse(fs.readFileSync(seedFile, 'utf8'));
const BODIES = ['policia-local', 'policia-nacional', 'guardia-civil', 'bomberos'];

const mini = (o = {}) => ({
  name: 'Bomberos · Diputación de prueba', body: 'bomberos', organism: 'Diputación de prueba',
  convocatoria: { title: 'Convocatoria de prueba', plazas: 10, year: 2026, reference: 'BOP de prueba' },
  source: { kind: 'official', organism: 'Diputación de prueba', document: 'Anexo de pruebas físicas', publication: 'BOP núm. 1, de 1 de enero de 2026', date: '2026-01-01', reference: 'BOP-1-2026' },
  validFrom: '2026-01-01', validUntil: null,
  scoring: { model: 'points', maxPoints: 10, minPoints: 5, referencePoints: 5, rule: { kind: 'all-min' } },
  categories: { bySex: false, ageBands: null },
  tests: [{ id: 'carrera-1000', name: 'Carrera 1.000 m', capacity: 'endurance', movement: 'run', kind: 'time', unit: 's', distanceM: 1000, description: 'Mil metros lisos.', marks: { '*': [{ p: 5, v: 270 }, { p: 10, v: 210 }] } }],
  notes: [], askBeforeStart: ['organism'], ...o,
});

test('the seed ships the four official profiles HIDDEN, each with an official source (organism, reference, date) and no blog or academy', async () => {
  assert.equal(seed.count, 4);
  assert.deepEqual(seed.profiles.map(p => p.body).sort(), [...BODIES].sort());
  for (const p of seed.profiles) {
    assert.equal(p.status, 'hidden', p.id); assert.equal(p.version, 1);
    assert.equal(p.source.kind, 'official'); assert.ok(p.source.organism && p.source.reference && /^\d{4}-\d{2}-\d{2}$/.test(p.source.date), p.id + ' source');
    assert.doesNotMatch(JSON.stringify(p.source), /redopositor|opositatest|academia|blog|foro|wikipedia/i);
    assert.match(p.source.reference + p.source.publication, /BOE|BOC|BOP/);
    assert.ok(p.tests.length >= 3 && p.notes.length >= 1);
  }
  assert.equal((await call('a', 'GET', '/api/opposition')).data.profiles.length, 0, 'members see nothing until an administrator publishes');
  assert.equal((await call('trainer-a', 'GET', '/api/opposition')).data.profiles.length, 0);
  const admin = await call('admin', 'GET', '/api/opposition');
  assert.equal(admin.data.profiles.length, 4); assert.equal(admin.data.canEdit, true);
  assert.equal((await call('a', 'GET', '/api/opposition/profile?slug=bomberos-cegc')).status, 404, 'a hidden profile is not served to a member');
  assert.equal((await fetch(S.base + '/api/opposition')).status, 401);
});

test('ACL: only an administrator writes; members and trainers read the published profiles', async () => {
  for (const [path, body] of [['/api/opposition/save', { profile: mini() }], ['/api/opposition/status', { id: 'opp-bomberos-cegc', status: 'published' }], ['/api/opposition/delete', { id: 'x' }]]) {
    assert.equal((await call('a', 'POST', path, body)).status, 403, 'member ' + path);
    assert.equal((await call('trainer-a', 'POST', path, body)).status, 403, 'trainer ' + path);
  }
  assert.equal((await call('a', 'GET', '/api/opposition/history?id=opp-bomberos-cegc')).status, 403);
  assert.equal((await call('trainer-a', 'GET', '/api/opposition/history?id=opp-bomberos-cegc')).status, 403);
  assert.equal((await call('admin', 'POST', '/api/opposition/status', { id: 'opp-bomberos-cegc', status: 'published' })).status, 200);
  for (const uid of ['a', 'trainer-a']) {
    const l = (await call(uid, 'GET', '/api/opposition')).data;
    assert.deepEqual(l.profiles.map(p => p.slug), ['bomberos-cegc']); assert.equal(l.canEdit, false);
    assert.equal(l.profiles[0].usage, undefined, 'usage is for staff only');
    const full = (await call(uid, 'GET', '/api/opposition/profile?slug=bomberos-cegc')).data.profile;
    assert.equal(full.tests.length, 5); assert.equal(full.source.reference.startsWith('BOP Las Palmas'), true);
  }
  await call('admin', 'POST', '/api/opposition/status', { id: 'opp-bomberos-cegc', status: 'hidden' });
  assert.equal((await call('a', 'GET', '/api/opposition')).data.profiles.length, 0, 'hiding it again removes it from members');
});

test('an invalid profile is refused with the reasons; publishing needs an official source; a dry run validates without saving', async () => {
  const bad = await call('admin', 'POST', '/api/opposition/save', { profile: mini({ source: { kind: 'blog', organism: 'x', reference: '', date: 'ayer' } }) });
  assert.equal(bad.status, 400); assert.ok(bad.data.issues.includes('source'));
  const noMarks = await call('admin', 'POST', '/api/opposition/save', { profile: mini({ tests: [{ id: 'x1', name: 'X', capacity: 'endurance', movement: 'run', kind: 'time', unit: 's', marks: { '*': [{ p: 5, v: 200 }, { p: 6, v: 250 }] } }] }) });
  assert.equal(noMarks.status, 400); assert.ok(noMarks.data.issues.some(i => i.startsWith('test-scale-order')), 'a time scale must get faster as points rise');
  const dry = await call('admin', 'POST', '/api/opposition/save', { profile: mini(), dryRun: true });
  assert.equal(dry.status, 200); assert.equal(dry.data.dryRun, true);
  assert.equal((await call('admin', 'GET', '/api/opposition')).data.profiles.length, 4, 'nothing was saved by the dry run');
});

test('create → draft; publish; edit with changed marks = NEW VERSION (old one kept); a rename is not a new version; the old version stays retrievable', async () => {
  const created = await call('admin', 'POST', '/api/opposition/save', { profile: mini() });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const id = created.data.profile.id;
  assert.deepEqual([created.data.profile.status, created.data.profile.version, created.data.profile.scope], ['draft', 1, 'custom']);
  assert.equal((await call('a', 'GET', '/api/opposition/profile?id=' + id)).status, 404, 'a draft is private');
  assert.equal((await call('admin', 'POST', '/api/opposition/status', { id, status: 'published' })).status, 200);
  assert.equal((await call('a', 'GET', '/api/opposition/profile?id=' + id)).status, 200);

  const v1 = (await call('admin', 'GET', '/api/opposition/profile?id=' + id)).data.profile;
  const renamed = await call('admin', 'POST', '/api/opposition/save', { profile: { ...v1, name: 'Bomberos · Diputación de prueba (renombrado)' } });
  assert.equal(renamed.data.newVersion, false); assert.equal(renamed.data.profile.version, 1);

  const changed = JSON.parse(JSON.stringify(v1)); changed.tests[0].marks['*'] = [{ p: 5, v: 255 }, { p: 10, v: 205 }]; changed.source.date = '2026-06-01'; changed.source.reference = 'BOP-77-2026';
  const dry = await call('admin', 'POST', '/api/opposition/save', { profile: changed, dryRun: true });
  assert.equal(dry.data.newVersion, true); assert.ok(dry.data.changes.some(c => c.kind === 'marks') && dry.data.changes.some(c => c.kind === 'source'));
  const saved = await call('admin', 'POST', '/api/opposition/save', { profile: changed });
  assert.equal(saved.data.newVersion, true); assert.equal(saved.data.profile.version, 2);
  const hist = (await call('admin', 'GET', '/api/opposition/history?id=' + id)).data.versions;
  assert.deepEqual(hist.map(h => h.version), [1]); assert.equal(hist[0].sourceDate, '2026-01-01');
  // the member's plan pins version 1: the old version is retrievable by the administrator; a member only reads the live one
  assert.equal((await call('admin', 'GET', `/api/opposition/version?id=${id}&version=1`)).data.profile.tests[0].marks['*'][0].v, 270);
  assert.equal((await call('a', 'GET', `/api/opposition/version?id=${id}&version=1`)).status, 404);
  assert.equal((await call('a', 'GET', `/api/opposition/version?id=${id}&version=2`)).data.profile.tests[0].marks['*'][0].v, 255);
  // an official profile can be edited too (an overlay), the seed file never changes
  const off = (await call('admin', 'GET', '/api/opposition/profile?id=opp-guardia-civil')).data.profile;
  const edited = JSON.parse(JSON.stringify(off)); edited.tests[0].marks['m:u35'][0].v = 560;
  const e = await call('admin', 'POST', '/api/opposition/save', { profile: edited });
  assert.equal(e.data.newVersion, true); assert.equal(e.data.profile.version, 2); assert.equal(e.data.profile.scope, 'official');
  assert.equal(seedHash(), SEED_HASH, 'the seed file never changes at runtime');
});

test('safe deletion: a published or used profile is archived, never deleted; only an unused draft can be deleted; official ones are never deleted', async () => {
  const draft = (await call('admin', 'POST', '/api/opposition/save', { profile: mini({ name: 'Borrador efímero' }) })).data.profile;
  assert.equal((await call('admin', 'POST', '/api/opposition/delete', { id: draft.id })).status, 200);
  const pub = (await call('admin', 'POST', '/api/opposition/save', { profile: mini({ name: 'Publicado y usado' }) })).data.profile;
  await call('admin', 'POST', '/api/opposition/status', { id: pub.id, status: 'published' });
  const r = await call('admin', 'POST', '/api/opposition/delete', { id: pub.id });
  assert.equal(r.status, 409); assert.equal(r.data.code, 'in_use');
  assert.equal((await call('admin', 'POST', '/api/opposition/status', { id: pub.id, status: 'archived' })).status, 200);
  assert.equal((await call('a', 'GET', '/api/opposition/profile?id=' + pub.id)).status, 404, 'archived is not served');
  assert.equal((await call('admin', 'POST', '/api/opposition/delete', { id: 'opp-policia-nacional' })).status, 409);
});

test('the global switch follows Premium: OFF → members 403 feature_off, staff keep working; ON restores it', async () => {
  await call('admin', 'POST', '/api/opposition/status', { id: 'opp-policia-nacional', status: 'published' });
  assert.equal((await call('admin', 'POST', '/api/admin/features', { features: { premium: false } })).status, 200);
  const m = await call('a', 'GET', '/api/opposition'); assert.equal(m.status, 403); assert.equal(m.data.code, 'feature_off');
  assert.equal((await call('trainer-a', 'GET', '/api/opposition')).status, 200);
  assert.equal((await call('a', 'POST', '/api/opposition/started', { profileId: 'opp-policia-nacional' })).status, 200, 'reporting never fails for a member');
  await call('admin', 'POST', '/api/admin/features', { features: { premium: true } });
  assert.equal((await call('a', 'GET', '/api/opposition')).status, 200);
});
