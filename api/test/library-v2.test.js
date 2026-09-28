// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData } from './helpers.mjs';

/* Exercise Library V2 on the API side: the AI index carries compact canonical metadata, the
 * Coach is offered Recommended 2J first and never a deprecated duplicate, old plans that name a
 * deprecated id still validate, and the protocol copy knows canonical movements. */
import fs from 'node:fs';
import path from 'node:path';

const dataDir = tempData();
const payload = await import('../coach/payload.js');
const P = await import('../lib/protocol/index.js');
const store = await import('../lib/blocks-store.js');

test('the AI index keeps every id and adds movement, recommended and preferred', () => {
  const lib = payload.LIBRARY;
  assert.equal(lib.length, 1324);
  assert.equal(new Set(lib.map(e => e.id)).size, 1324);
  const rec = lib.filter(e => e.rec);
  assert.ok(rec.length > 150 && rec.length < 250);
  assert.ok(rec.every(e => e.mv));
  const dep = lib.filter(e => e.pref);
  assert.equal(dep.length, 14);
  assert.ok(dep.every(e => lib.find(x => x.id === e.pref && !x.pref)));
  assert.deepEqual(lib.find(e => e.id === '0739'), { id: '0739', n: 'sled 45° leg press', bp: 'upper legs', tg: 'glutes', eq: 'sled machine', mv: 'squat', rec: 1 });
});

test('the Coach gets Recommended 2J first and never a deprecated duplicate; old plans still validate', () => {
  const slice = payload.librarySlice({}, []);
  assert.ok(!slice.some(e => e.pref));
  const firstNonRec = slice.findIndex(e => !e.rec);
  assert.ok(firstNonRec > 150 && slice.slice(0, firstNonRec).every(e => e.rec));
  assert.ok(slice.slice(firstNonRec).every(e => !e.rec));
  // A plan written before the deprecation still resolves the old id (FR-16 validation).
  assert.equal(payload.libraryHas('1731'), true);
  const dumbbell = payload.librarySlice({}, ['dumbbell']);
  assert.ok(dumbbell.every(e => e.eq === 'dumbbell' || e.custom));
  assert.ok(!dumbbell.some(e => e.id === '1731'));
});

test('recommended > non-recommended within what the gym offers, even when its blacklist hides many recommended', () => {
  // The 75317b0 deploy probe assumed at least 150 recommended in the slice; a gym blacklist
  // (hidden-exercises.json) legitimately removes them. The policy is the ordering, not a floor.
  const hiddenFile = path.join(dataDir, 'hidden-exercises.json');
  const lib = payload.LIBRARY;
  const hide = lib.filter(e => e.rec).slice(0, 40).map(e => e.id).concat(lib.filter(e => !e.rec && !e.pref).slice(0, 5).map(e => e.id));
  fs.writeFileSync(hiddenFile, JSON.stringify(hide));
  try {
    const slice = payload.librarySlice({}, []);
    const hidden = new Set(hide);
    const expectedRec = lib.filter(e => e.rec && !e.pref && !hidden.has(e.id)).length;
    assert.equal(expectedRec, lib.filter(e => e.rec).length - 40);
    const recInSlice = slice.filter(e => e.rec).length;
    assert.equal(recInSlice, expectedRec, 'every visible recommended exercise is offered');
    assert.equal(slice.findIndex(e => !e.rec), recInSlice, 'all recommended come before any non-recommended');
    assert.ok(!slice.some(e => e.pref || hidden.has(e.id)), 'no deprecated, no hidden');
    assert.equal(slice.length, lib.filter(e => !e.pref && !hidden.has(e.id)).length, 'the rest of the catalogue follows');
    // Equipment-filtered slice keeps the same ordering inside the compatible set.
    const db = payload.librarySlice({}, ['dumbbell']);
    const dbRec = db.filter(e => e.rec).length;
    assert.ok(dbRec > 0 && db.findIndex(e => !e.rec) === dbRec);
    // Historical ids still resolve for validation, hidden or deprecated.
    assert.ok(hide.every(id => payload.libraryHas(id)) && payload.libraryHas('1731'));
  } finally { fs.rmSync(hiddenFile, { force: true }); }
});

test('the protocol copy knows canonical movements and flags high overlap as a note only', () => {
  assert.equal(P.movementOfPattern('bridge'), 'hip_thrust');
  assert.equal(P.equipmentIdOf({ id: '0577', eq: 'leverage machine' }), 'selectorized');
  const v = P.validateAgainst2JProtocol({ kind: 'routine', goal: 'hypertrophy', level: 'intermediate',
    entries: [{ id: '0289', sets: 3, mode: 'reps', reps: 10 }, { id: '0296', sets: 3, mode: 'reps', reps: 10 }] }, { lookup: store.lookup });
  assert.equal(v.result, 'PASS');
  assert.ok(v.issues.some(i => i.code === 'high_overlap' && i.severity === 'note'));
});
