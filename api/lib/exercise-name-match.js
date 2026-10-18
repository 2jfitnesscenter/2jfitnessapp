// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* A small, deterministic "is this a name from our exercise library?" check, used by the vision
 * scans to decide which rows deserve a second look. It is NOT the matcher the member sees — that
 * one (frontend/src/lib/routine-scan.js, machine-scan.js) is richer and also knows custom
 * exercises and aliases. This one only answers "does the scanned name look like something in the
 * real library at all?", so a misread row ("Pres de bnca") can be re-read before it reaches the
 * member, and a clean row never costs another call.
 */
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const LIBRARY = require_('../coach/library.json').exercises;

const STOP = new Set(['the', 'a', 'an', 'with', 'on', 'of', 'to', 'in', 'and', 'or', 'de', 'del', 'la', 'el', 'con', 'en', 'y', 'o', 'para']);
export const norm = text => String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const stem = w => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
export const tokens = text => [...new Set(norm(text).split(' ').filter(w => w && !STOP.has(w)).map(stem))];

const INDEX = LIBRARY.map(e => ({ id: e.id, name: e.n, set: new Set(tokens(e.n)) })).filter(e => e.set.size);

/** Sørensen–Dice over token sets, 0..1. */
function dice(a, bSet) {
  if (!a.length || !bSet.size) return 0;
  let shared = 0;
  for (const t of a) if (bSet.has(t)) shared++;
  return (2 * shared) / (a.length + bSet.size);
}

/** Best library entry for a free-text name (any language). */
export function bestLibraryMatch(...names) {
  let best = { id: null, name: null, score: 0 };
  for (const raw of names) {
    const q = tokens(raw);
    if (!q.length) continue;
    for (const e of INDEX) {
      const s = dice(q, e.set);
      if (s > best.score) best = { id: e.id, name: e.name, score: Math.round(s * 100) / 100 };
    }
  }
  return best;
}

/** At or above this a scanned name is "recognised"; below it, a second look may help. */
export const MATCH_OK = 0.5;
/** Below this a name looks nothing like the library. */
export const MATCH_WEAK = 0.34;
