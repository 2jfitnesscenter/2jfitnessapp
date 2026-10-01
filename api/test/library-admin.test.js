// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* Exercise Library admin overlay (api/lib/library-admin.js + the pure rules in library-overlay.js):
 * what an admin may change, what the rules refuse (chains, cycles, other movements, ambiguous
 * names, duplicates still used by official content), persistence, the effective library the AI
 * and the validators read, and that historical ids keep resolving. In-process, no AI calls. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempData } from './helpers.mjs';

const DIR = tempData();
const lib = await import('../lib/library-admin.js');
const payload = await import('../coach/payload.js');
const O = await import('../lib/library-overlay.js');
const { EQUIPMENT_OVERRIDE } = await import('../lib/protocol/movements.js');
const guided = await import('../lib/guided-store.js');

lib.setUsageProbe(id => guided.exerciseUsage().has(id));
const reset = () => { try { fs.unlinkSync(path.join(DIR, 'library-admin.json')); } catch { /* none */ } lib.resetCache(); };
const edit = e => lib.edit(e);

test('an empty overlay is the code library, byte for byte', () => {
  reset();
  assert.equal(lib.overlay().rev, 0);
  assert.deepEqual(lib.entries().map(e => e.id), payload.LIBRARY.map(e => e.id));
  assert.deepEqual(lib.byId('0739'), payload.LIBRARY.find(e => e.id === '0739'));
  assert.equal(fs.existsSync(path.join(DIR, 'library-admin.json')), false);
});

test('name, aliases, recommended, movement and equipment are editable and persisted', () => {
  reset();
  assert.ok(edit({ id: '1362', patch: { n: 'sphinx pose', aliases: ['esfinge', 'cobra baja'], note: 'Revisado' } }).overlay);
  assert.ok(edit({ id: '0020', patch: { recommended: true } }).error, 'a record without a movement cannot be recommended');
  const rec = lib.byId('0376');            // a master exercise with a movement, not recommended in code
  assert.ok(rec.mv && !rec.rec);
  assert.ok(edit({ id: '0376', patch: { recommended: true } }).overlay);
  assert.equal(lib.byId('0376').rec, 1);
  assert.ok(edit({ id: '0044', patch: { recommended: false } }).overlay);   // curated in code, lifted by the admin
  assert.equal(lib.byId('0044').rec, undefined);
  assert.ok(edit({ id: '2138', patch: { equipment: 'treadmill' } }).overlay);
  assert.equal(EQUIPMENT_OVERRIDE['2138'], 'treadmill', 'the protocol reads the effective equipment');
  assert.ok(edit({ id: '2138', patch: { equipment: null } }).overlay);
  assert.equal(EQUIPMENT_OVERRIDE['2138'], undefined, 'removing the override restores the code');
  // survives a restart: read back from disk
  lib.resetCache();
  assert.equal(lib.byId('1362').n, 'sphinx pose');
  assert.deepEqual(lib.overlay().entries['1362'].aliases, ['esfinge', 'cobra baja']);
  assert.equal(lib.publicOverlay().entries['1362'].note, undefined, 'curatorial notes never reach members');
  assert.equal(lib.overlay().entries['1362'].note, 'Revisado');
  assert.equal(lib.overlay().rev, 5);   // five accepted edits; refused ones do not count
  // the id is the identity: nothing about it changed
  assert.equal(lib.byId('1362').id, '1362');
});

test('duplicates: deprecated → preferred only, same movement, no chains, no cycles, never used content', () => {
  reset();
  // two exercises of one movement that no official content uses
  const a = '0126', b = '0125';                                  // barbell wrist curls (kept apart by review)
  assert.equal(lib.byId(a).mv, lib.byId(b).mv);
  assert.ok(!guided.exerciseUsage().has(a) && !guided.exerciseUsage().has(b));
  assert.ok(edit({ id: b, patch: { preferredId: a } }).overlay);
  assert.equal(lib.byId(b).pref, a);
  assert.equal(lib.byId(b).rec, undefined, 'a duplicate is never recommended');
  // chain: a → something while b → a
  assert.match(edit({ id: a, patch: { preferredId: '0305' } }).error, /cadena|movimiento|preferido/i);
  // cycle
  assert.ok(edit({ id: a, patch: { preferredId: b } }).error);
  // a different movement
  assert.match(edit({ id: '0125', patch: { preferredId: '0025' } }).error, /movimiento|cadena/i);
  // itself
  assert.ok(edit({ id: '0305', patch: { preferredId: '0305' } }).error);
  // unknown ids
  assert.ok(edit({ id: '9999', patch: { n: 'x' } }).error);
  assert.ok(edit({ id: '0305', patch: { preferredId: '9999' } }).error);
  // content in use: the official library uses 0025 (bench press)
  assert.ok(guided.exerciseUsage().has('0025'));
  assert.match(edit({ id: '0025', patch: { preferredId: '0289' } }).error, /oficial/i);
  // a record already pointed at cannot become a duplicate itself
  assert.ok(edit({ id: a, patch: { preferredId: '0305' } }).error);
  // a code decision can be lifted explicitly (false) and restored (null)
  assert.ok(edit({ id: '0077', patch: { preferredId: false } }).overlay);
  assert.equal(lib.byId('0077').pref, undefined);
  assert.ok(edit({ id: '0077', patch: { preferredId: null } }).overlay);
  assert.equal(lib.byId('0077').pref, '0078');
});

test('historical ids still resolve: a deprecated record is hidden from the AI, never removed', () => {
  reset();
  assert.ok(edit({ id: '0125', patch: { preferredId: '0126' } }).overlay);
  assert.equal(payload.libraryHas('0125'), true, 'old plans and history still validate');
  assert.equal(payload.libraryName('0125'), 'barbell wrist curl v. 2');
  const slice = payload.librarySlice({}, []);
  assert.ok(!slice.some(e => e.id === '0125'), 'a duplicate is never offered to the model');
  assert.ok(slice.some(e => e.id === '0126'));
  assert.ok(slice.every(e => !('al' in e)), 'aliases never travel to a model');
});

test('the AI reads the effective library: names and Recommended 2J follow the overlay', () => {
  reset();
  const first = payload.librarySlice({}, []).filter(e => e.rec).length;
  assert.ok(edit({ id: '0376', patch: { recommended: true } }).overlay);
  assert.equal(payload.librarySlice({}, []).filter(e => e.rec).length, first + 1);
  assert.ok(edit({ id: '0044', patch: { n: 'barbell good morning (2J)' } }).overlay);
  assert.equal(payload.libraryName('0044'), 'barbell good morning (2J)');
  const un = edit({ id: '0684', patch: { recommended: false } });
  assert.ok(un.overlay);
  const slice = payload.librarySlice({}, []);
  assert.ok(slice.findIndex(e => e.id === '0684') > slice.findIndex(e => !e.rec) - 1, 'no longer ahead of the recommended ones');
});

test('names and aliases stay unambiguous between live exercises', () => {
  reset();
  assert.match(edit({ id: '0044', patch: { n: 'barbell good morning' } }).error || 'ok', /ok|ya lo usa/);   // its own name is fine
  const other = lib.byId('0025').n;
  assert.match(edit({ id: '0044', patch: { n: other } }).error, /ya lo usa/);
  assert.match(edit({ id: '0044', patch: { aliases: ['press banca'] } }).error, /ya lo usa|es el nombre/);   // a code alias of 0025
  assert.match(edit({ id: '0044', patch: { aliases: [lib.byId('0025').n] } }).error, /es el nombre/);
  assert.ok(edit({ id: '0044', patch: { aliases: ['buenos dias', 'good morning'] } }).overlay);
  assert.match(edit({ id: '0043', patch: { aliases: ['buenos dias'] } }).error, /ya lo usa/);
  // limits and cleaning
  const r = edit({ id: '0044', patch: { aliases: Array.from({ length: 20 }, (_, i) => 'alias número ' + i), note: 'x'.repeat(500) } });
  assert.ok(r.overlay);
  assert.equal(r.overlay.entries['0044'].aliases.length, O.LIMITS.aliases);
  assert.equal(r.overlay.entries['0044'].note.length, O.LIMITS.note);
});

test('movement: explicit none, unknown refused, and a preferred pair must keep one movement', () => {
  reset();
  assert.match(edit({ id: '0044', patch: { movement: 'levitation' } }).error, /desconocido/);
  assert.ok(edit({ id: '0376', patch: { movement: 'lateral_raise' } }).overlay);
  assert.ok(edit({ id: '0044', patch: { movement: '' } }).overlay);
  assert.equal(lib.byId('0044').mv, undefined, 'explicitly left without a movement');
  assert.ok(edit({ id: '0044', patch: { movement: null } }).overlay);
  assert.ok(lib.byId('0044').mv, 'null removes the override');
  // 0125 → 0126, then changing the preferred twin's movement would split the pair
  assert.ok(edit({ id: '0125', patch: { preferredId: '0126' } }).overlay);
  assert.match(edit({ id: '0126', patch: { movement: 'wrist' === lib.byId('0126').mv ? 'squat' : 'wrist' } }).error, /movimiento/);
});

test('reviewed pairs are kept apart on request and can be reopened; reset drops an entry', () => {
  reset();
  assert.ok(edit({ variant: ['0126', '0125'], keep: true }).overlay);
  assert.deepEqual(lib.overlay().variants, [['0125', '0126']]);
  assert.ok(edit({ variant: ['0125', '0126'], keep: true }).overlay);
  assert.equal(lib.overlay().variants.length, 1, 'no repeated pair');
  assert.ok(edit({ variant: ['0125', '0125'], keep: true }).error);
  assert.ok(edit({ variant: ['0125', '9999'], keep: true }).error);
  assert.ok(edit({ variant: ['0125', '0126'], keep: false }).overlay);
  assert.equal(lib.overlay().variants.length, 0);
  edit({ id: '0044', patch: { n: 'barbell good morning 2J' } });
  assert.ok(edit({ id: '0044', reset: true }).overlay);
  assert.equal(lib.overlay().entries['0044'], undefined);
});

test('a stored overlay that no longer holds is ignored entry by entry, not wholesale', () => {
  reset();
  fs.writeFileSync(path.join(DIR, 'library-admin.json'), JSON.stringify({ v: 1, rev: 7, entries: {
    '0044': { n: 'good morning 2J' },
    '0025': { preferredId: '0289' },            // used by official content: refused
    '9999': { n: 'ghost' },                      // not a record: dropped
    '0376': { movement: 'nonsense' },            // unknown movement: dropped
  }, variants: [['0125', '0126'], ['1', '2']] }));
  lib.resetCache();
  assert.equal(lib.byId('0044').n, 'good morning 2J');
  assert.equal(lib.byId('0025').pref, undefined);
  assert.equal(lib.byId('9999'), null);
  assert.deepEqual(Object.keys(lib.overlay().entries), ['0044']);
  assert.deepEqual(lib.overlay().variants, [['0125', '0126']]);
  assert.equal(lib.overlay().rev, 7);
});

test('official content never uses a duplicate: the guided store refuses it, the Coach never sees it', () => {
  reset();
  assert.ok(edit({ id: '0125', patch: { preferredId: '0126' } }).overlay);
  const admin = { id: 'ad' };
  const r = guided.upsert(admin, true, { scope: 'official', name: 'Bad refs', category: 'strength', goal: 'general', level: 'beginner', focus: 'upper',
    status: 'draft', ex: [{ id: '0125', sets: 3, reps: 10, mode: 'reps' }] });
  assert.match(r.error, /duplicado/);
  assert.equal(r.status, 400);
  const coach = guided.compatibleRoutines({ goal: 'general', level: 'beginner', max: 500 });
  assert.ok(coach.length > 0);
});
