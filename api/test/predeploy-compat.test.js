// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* Release safety for Sprint 4.5 over production 78b22bb: the data files a running server already has
 * (guided.json in its previous shape, no library-admin.json at all) must load as they are, with no
 * migration step, and the new stores must never write until an admin edits something. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempData } from './helpers.mjs';

const DIR = tempData();
// guided.json exactly as the previous release wrote it: v1, no `rev`, no `programsCustom`.
const legacy = {
  v: 1,
  overrides: { 'r2j-tabata-start': { active: false, featured: 2, by: 'admin1', at: '2026-09-01T10:00:00.000Z' } },
  officialCustom: [],
  personal: [{ id: 'r2jp-legacy1', name: 'Mi rutina guiada', createdBy: 't1', category: 'circuit', goal: 'general', level: 'beginner', focus: 'fullbody', ex: [], blocks: [] }],
  collections: { overrides: { 'c2j-hiit': { active: false } }, custom: [{ id: 'cx-legacy', name: 'Legacy', style: 'start', order: 3, active: true, routineIds: ['r2j-mobility-fullbody'] }] },
  programOverrides: { 'g2j-core-3w': { active: false } },
};
fs.writeFileSync(path.join(DIR, 'guided.json'), JSON.stringify(legacy));
const before = fs.readFileSync(path.join(DIR, 'guided.json'), 'utf8');

const guided = await import('../lib/guided-store.js');
const lib = await import('../lib/library-admin.js');

test('a guided.json written by the previous release loads without migration and keeps every decision', () => {
  guided.resetCache();
  const admin = guided.listFor({ id: 'admin1' }, { admin: true, trainer: true });
  const member = guided.listFor({ id: 'm1' }, {});
  const t1 = guided.listFor({ id: 't1' }, { trainer: true });
  assert.equal(admin.routines.find(r => r.id === 'r2j-tabata-start').status, 'hidden', 'the admin deactivation survives');
  assert.ok(!member.routines.some(r => r.id === 'r2j-tabata-start'), 'members never see it');
  assert.equal(admin.routines.find(r => r.id === 'r2j-tabata-start').featured, 2);
  assert.ok(!member.collections.some(c => c.id === 'c2j-hiit'), 'a deactivated release collection stays deactivated');
  assert.ok(member.collections.some(c => c.id === 'cx-legacy'), 'custom collections survive');
  assert.ok(!member.programs.some(p => p.id === 'g2j-core-3w'), 'a hidden program stays hidden');
  assert.deepEqual(t1.mine.map(r => r.id), ['r2jp-legacy1'], 'a trainer keeps their own routine');
  assert.ok(member.programs.some(p => p.id === 'g2j-flexibility-4w') && member.programs.some(p => p.id === 'g2j-beginner-4w' || p.id === 'g2j-mobility-21d'), 'the new programs appear next to the old ones');
  assert.match(guided.contentRev(), /^\d+\.\d+\.0$/, 'revision starts at 0 for a file without one');
});

test('reading never writes: the legacy file is byte-identical after every read path', () => {
  guided.resetCache();
  guided.listFor({ id: 'admin1' }, { admin: true });
  guided.compatibleRoutines({ goal: 'general', level: 'beginner' });
  guided.compatiblePrograms({ goal: 'general', level: 'beginner' });
  guided.contentRev();
  assert.equal(fs.readFileSync(path.join(DIR, 'guided.json'), 'utf8'), before);
});

test('the first admin write upgrades the file in place and keeps the legacy sections', () => {
  guided.resetCache();
  const r = guided.curate({ id: 'admin1' }, 'r2j-tabata-fullbody', { featured: 1 });
  assert.ok(!r.error, r.error);
  const after = JSON.parse(fs.readFileSync(path.join(DIR, 'guided.json'), 'utf8'));
  assert.equal(after.rev, 1);
  assert.deepEqual(after.personal, legacy.personal);
  assert.deepEqual(after.collections.custom, legacy.collections.custom);
  assert.equal(after.overrides['r2j-tabata-start'].active, false);
  assert.ok(Array.isArray(after.programsCustom));
});

test('without library-admin.json the overlay is empty, initialises in memory and creates nothing on read', () => {
  const f = path.join(DIR, 'library-admin.json');
  assert.equal(fs.existsSync(f), false);
  lib.resetCache();
  assert.equal(lib.overlay().rev, 0);
  assert.deepEqual(lib.publicOverlay(), { v: 1, rev: 0, entries: {}, variants: [] });
  assert.equal(fs.existsSync(f), false, 'reads do not create the file');
  assert.ok(lib.edit({ id: '1362', patch: { aliases: ['esfinge'] } }).overlay);
  assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).rev, 1, 'the first admin edit creates it');
  // a corrupt file never breaks the server: it is read as empty
  fs.writeFileSync(f, '{broken');
  lib.resetCache();
  assert.equal(lib.overlay().rev, 0);
  assert.deepEqual(lib.entries().map(e => e.id).length > 1000, true);
});
