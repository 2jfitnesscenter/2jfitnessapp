// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* Deterministic checks on a scanned routine — no AI in here. The transcription comes back as
 * free-form JSON; this module makes it safe and says WHICH rows are doubtful, so only those rows
 * are ever read a second time (never the whole photo again for one fuzzy exercise).
 *
 * Doubtful means one of:
 *   name_missing     a row with numbers but no exercise name
 *   name_garbled     a name that is mostly not letters or is a couple of characters long
 *   numbers          a set/rep/weight figure outside any plausible range (it is dropped to null)
 *   no_library_match the name looks nothing like our exercise library (only worth a second look
 *                    when it is an isolated row — if most rows are unmatched the gym simply uses
 *                    other names, and re-reading would not change that)
 */
import { bestLibraryMatch, MATCH_WEAK } from './exercise-name-match.js';

const MAX_DAYS = 14, MAX_ROWS = 40;
const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const intIn = (v, lo, hi) => { const n = typeof v === 'string' ? Number(v) : v; return Number.isFinite(n) && Number.isInteger(Math.round(n)) && Math.round(n) >= lo && Math.round(n) <= hi ? Math.round(n) : null; };
const numIn = (v, lo, hi) => { const n = typeof v === 'string' ? Number(String(v).replace(',', '.')) : v; return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n * 10) / 10 : null; };
const present = v => v != null && v !== '';

export function looksGarbled(name) {
  const t = String(name || '').trim();
  if (t.length < 3) return true;
  const letters = (t.match(/\p{L}/gu) || []).length;
  return letters / t.length < 0.6 || /(.)\1{3,}/u.test(t);
}

/**
 * @returns {{ routine: { name: string|null, days: object[] }, doubtful: { d: number, e: number, reasons: string[] }[], rows: number }}
 */
export function sanitizeRoutine(raw) {
  const days = [];
  const doubtful = [];
  const srcDays = Array.isArray(raw?.days) ? raw.days.slice(0, MAX_DAYS) : [];
  srcDays.forEach(day => {
    const rows = [];
    const src = Array.isArray(day?.exercises) ? day.exercises.slice(0, MAX_ROWS) : [];
    src.forEach(ex => {
      if (!ex || typeof ex !== 'object') return;
      const unit = ex.unit === 'sec' ? 'sec' : 'reps';
      const reasons = [];
      const name = str(ex.name, 120), nameEn = str(ex.nameEn, 120);
      const sets = intIn(ex.sets, 1, 20), reps = unit === 'sec' ? intIn(ex.reps, 1, 3600) : intIn(ex.reps, 1, 300), weight = numIn(ex.weight, 0, 1000);
      if (present(ex.sets) && sets == null || present(ex.reps) && reps == null || present(ex.weight) && weight == null) reasons.push('numbers');
      const hasNumbers = sets != null || reps != null || weight != null;
      if (!name && !nameEn) { if (!hasNumbers && !reasons.length) return; reasons.push('name_missing'); }
      else if (looksGarbled(name || nameEn)) reasons.push('name_garbled');
      rows.push({ name, nameEn: nameEn || name, sets, reps, weight, unit, notes: str(ex.notes, 200) || null });
      if (reasons.length) doubtful.push({ d: days.length, e: rows.length - 1, reasons });
    });
    days.push({ label: str(day?.label, 60) || null, exercises: rows });
  });

  const total = days.reduce((n, d) => n + d.exercises.length, 0);
  // A name that resembles nothing in the library is only suspicious when it is the odd one out.
  const unmatched = [];
  days.forEach((d, di) => d.exercises.forEach((ex, ei) => {
    if (doubtful.some(x => x.d === di && x.e === ei)) return;
    if (bestLibraryMatch(ex.nameEn, ex.name).score < MATCH_WEAK) unmatched.push({ d: di, e: ei, reasons: ['no_library_match'] });
  }));
  if (unmatched.length && unmatched.length <= 3 && unmatched.length < total * 0.4) doubtful.push(...unmatched);

  return { routine: { name: str(raw?.name, 120) || null, days }, doubtful, rows: total };
}

/** Which of a row's fields a re-read may overwrite, given why it was doubtful. */
export function mergeReread(original, reread, reasons) {
  const out = { ...original };
  const orig = bestLibraryMatch(original.nameEn, original.name).score;
  const nameChanged = reread.name && !looksGarbled(reread.name);
  if (reasons.includes('name_missing') || reasons.includes('name_garbled')) {
    if (nameChanged) { out.name = reread.name; out.nameEn = reread.nameEn || reread.name; }
  } else if (reasons.includes('no_library_match') && nameChanged) {
    // take the new reading only if it is closer to our library than the first one was
    if (bestLibraryMatch(reread.nameEn, reread.name).score > orig) { out.name = reread.name; out.nameEn = reread.nameEn || reread.name; }
  }
  if (reasons.includes('numbers')) {
    for (const k of ['sets', 'reps', 'weight']) if (original[k] == null && reread[k] != null) out[k] = reread[k];
    if (reread.unit === 'sec' || reread.unit === 'reps') out.unit = reread.unit;
  }
  return out;
}
