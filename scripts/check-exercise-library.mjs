#!/usr/bin/env node
// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* Exercise Library V2 — integrity check (CI / deploy). Read-only.
 *
 *   node scripts/check-exercise-library.mjs
 *
 * Fails (exit 1) on: duplicate id, invalid canonical movement or equipment, a preferred id that
 * does not exist, a deprecation chain or cycle, a deprecated id used by an official block or
 * guided routine, an ambiguous alias (two ids, or another exercise's name), two live exercises
 * sharing a name (English or Spanish), or a Recommended 2J exercise without movement, equipment,
 * image or Spanish name. The rules live in frontend/src/lib/library/core.js (checkLibrary), the
 * same function the tests call.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const imp = p => import(pathToFileURL(join(root, p)).href);
const { checkLibrary, RECOMMENDED, facetsOf } = await imp('frontend/src/lib/library/core.js');
const { EXDB } = await imp('frontend/src/lib/exercises-data.js');
const { DEPRECATED } = await imp('frontend/src/lib/library/overrides.js');
const es = (await imp('frontend/src/names/es.js')).default;
const json = p => JSON.parse(readFileSync(join(root, p), 'utf8'));
const officialIds = new Set([
  ...json('api/lib/blocks-official.json').blocks.flatMap(b => b.ex.map(e => e.id)),
  ...json('api/lib/guided-official.json').routines.flatMap(r => r.ex.map(e => e.id)),
]);

const { errors, warnings } = checkLibrary({ es, officialIds });
const withMove = EXDB.filter(e => facetsOf(e).movement).length;
for (const w of warnings) console.log('warning:', w);
if (errors.length) {
  for (const e of errors) console.error('ERROR:', e);
  console.error(`Exercise library check FAILED: ${errors.length} error(s).`);
  process.exit(1);
}
console.log(`Exercise library OK: ${EXDB.length} exercises, ${RECOMMENDED.size} recommended, ${Object.keys(DEPRECATED).length} deprecated, ${withMove} with a canonical movement.`);
