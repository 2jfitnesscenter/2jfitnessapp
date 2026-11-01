#!/usr/bin/env node
// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* A small, local benchmark for the AI scans, to run by hand against REAL (anonymised) photos —
 * never in CI and never against production data.
 *
 *   GEMINI_API_KEY=... node api/scripts/ai-scan-benchmark.mjs <folder> [--runs 3]
 *
 * <folder> is yours and stays OUT of git (benchmarks/ is git-ignored): put pairs there
 *
 *   inbody-01.jpg            the photo / PDF  (named <kind>-<anything>.<jpg|png|pdf>,
 *   inbody-01.expected.json   kind = measurements | routine | machine; see docs/AI_RELIABILITY.md)
 *
 * It runs every sample `--runs` times through the SAME code paths the app uses (retry, second
 * read, consensus), compares against the expected file and prints, per sample: pass rate, number
 * of provider calls, time. Nothing is saved: the key lives only in this process's temp data dir,
 * the images are read, sent and forgotten, and no output contains image bytes or full answers.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const dir = args.find(a => !a.startsWith('--'));
const runs = Math.max(1, Number(args[args.indexOf('--runs') + 1]) || 3);
if (!dir || !process.env.GEMINI_API_KEY) {
  console.error('usage: GEMINI_API_KEY=... node api/scripts/ai-scan-benchmark.mjs <folder> [--runs 3]');
  process.exit(2);
}

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-bench-'));
fs.writeFileSync(path.join(process.env.DATA_DIR, 'secret'), 'b'.repeat(64), { mode: 0o600 });
const auxAI = await import('../lib/aux-ai-config.js');
auxAI.save({ enabled: true, caps: { instanceDaily: 0 } });
auxAI.setApiKey(process.env.GEMINI_API_KEY);
const metrics = await import('../lib/ai-metrics.js');
const { scanBioimpedanceImage } = await import('../lib/measurements-scan.js');
const { scanRoutineDocument } = await import('../lib/routine-scan.js');
const { scanMachineImage } = await import('../lib/machine-scan.js');

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.pdf': 'application/pdf', '.webp': 'image/webp' };
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** expected → actual comparators; return the list of mismatching field names (empty = pass). */
const COMPARE = {
  measurements: (exp, got) => Object.keys(exp).filter(k => !(typeof exp[k] === 'number' ? Math.abs((got.values[k] ?? Infinity) - exp[k]) <= 0.15 : got.values[k] == null)),
  machine: (exp, got) => (norm(got.value.nameEn) === norm(exp.nameEn) ? [] : ['nameEn']),
  routine: (exp, got) => {
    const want = (exp.days || []).flatMap(d => d.exercises || []), have = (got.value.days || []).flatMap(d => d.exercises || []);
    const bad = [];
    if (want.length !== have.length) bad.push(`exercise count ${have.length}/${want.length}`);
    want.forEach((w, i) => {
      const h = have[i]; if (!h) return;
      if (w.sets != null && w.sets !== h.sets) bad.push(`#${i + 1}.sets`);
      if (w.reps != null && w.reps !== h.reps) bad.push(`#${i + 1}.reps`);
      if (w.nameEn && norm(w.nameEn) !== norm(h.nameEn)) bad.push(`#${i + 1}.name`);
    });
    return bad;
  }
};
const RUN = { measurements: scanBioimpedanceImage, routine: scanRoutineDocument, machine: scanMachineImage };

const files = fs.readdirSync(dir).filter(f => MIME[path.extname(f).toLowerCase()]).sort();
if (!files.length) { console.error('no samples found'); process.exit(2); }
console.log(`samples=${files.length} runs=${runs}\n`);
let allPass = 0, allRuns = 0;
for (const file of files) {
  const kind = file.split('-')[0];
  const expectedFile = path.join(dir, file.replace(/\.[^.]+$/, '.expected.json'));
  if (!RUN[kind] || !fs.existsSync(expectedFile)) { console.log(`skip ${file} (needs <kind>- prefix and a .expected.json)`); continue; }
  const expected = JSON.parse(fs.readFileSync(expectedFile, 'utf8'));
  const data = fs.readFileSync(path.join(dir, file)).toString('base64');
  const mimeType = MIME[path.extname(file).toLowerCase()];
  let pass = 0, ms = 0; const misses = new Set(), codes = new Set();
  for (let i = 0; i < runs; i++) {
    const t0 = Date.now();
    const r = await RUN[kind]({ data, mimeType, uid: 'bench' + i });
    ms += Date.now() - t0; allRuns++;
    if (!r.ok) { codes.add(r.code); continue; }
    const bad = COMPARE[kind](expected, r);
    if (!bad.length) { pass++; allPass++; } else bad.forEach(b => misses.add(b));
  }
  console.log(`${file}: ${pass}/${runs} exact · avg ${Math.round(ms / runs)} ms${misses.size ? ' · wrong: ' + [...misses].join(', ') : ''}${codes.size ? ' · failed: ' + [...codes].join(', ') : ''}`);
}
console.log('\nper flow (calls / requests, outcomes):');
for (const [flow, r] of Object.entries(metrics.snapshot())) {
  console.log(`  ${flow}: requests=${r.requests} avg_calls=${r.avgAttempts} first_try=${r.first_try_success} retry=${r.retry_success} final_failure=${r.final_failure} second_read=${r.second_read} third_read=${r.third_read}`);
}
console.log(`\nexact: ${allPass}/${allRuns}`);
fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
