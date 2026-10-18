#!/usr/bin/env node
// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* A local benchmark for the AI scans, to run by hand on YOUR machine against real (anonymised)
 * photos — never in CI, never on a server, never against other people's data.
 *
 *   node api/scripts/ai-scan-benchmark.mjs <folder> --yes [--runs 3] [--data <data-dir>]
 *
 * <folder> is yours and stays OUT of git (benchmarks/ is git-ignored). Name files
 * <kind>-<anything>.<jpg|png|webp|pdf> with kind = measurements | routine | machine:
 *
 *   benchmarks/ai-scans/measurements-01.jpg        a bioimpedance report
 *   benchmarks/ai-scans/routine-01.jpg             a photographed routine
 *   benchmarks/ai-scans/machine-01.jpg             a gym machine
 *
 * With nothing else, each photo is read once per run and the result is printed so you can judge it.
 * Add `<same-name>.expected.json` next to a photo (see docs/AI_RELIABILITY.md) and it also reports
 * how many runs matched exactly, the calls spent per request and the time.
 *
 * The Gemini key is NOT typed anywhere: it is reused from this machine's own data folder
 * (`aux-ai.json`, else the Coach set to Gemini in `coach.json`), decrypted with that folder's own
 * `secret`. Only copies of those files are used, inside a temp folder that is deleted at the end —
 * the real data folder is never written. GEMINI_API_KEY in the environment is the last resort.
 *
 * The photos are sent to Google Gemini (that is the point of the test), which is why `--yes` is
 * required. Nothing is stored: not the photo, not the answer. Output has no image bytes.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const dir = args.find((a, i) => !a.startsWith('--') && !['--runs', '--data'].includes(args[i - 1]));
const runs = Math.max(1, Number(opt('--runs')) || 1);
if (!dir || !args.includes('--yes')) {
  console.error('usage: node api/scripts/ai-scan-benchmark.mjs <folder> --yes [--runs 3] [--data <data-dir>]\n' +
    '  --yes confirms that these photos may be sent to Google Gemini for this test.');
  process.exit(2);
}
if (!fs.existsSync(dir)) { console.error(`folder not found: ${dir}\ncreate it (it is git-ignored) and put your photos in it: mkdir -p ${dir}`); process.exit(2); }

/* ---- find a local data folder that already holds a configured Gemini key ---- */
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const gitCommon = (() => { try { return path.resolve(repoRoot, execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: repoRoot, encoding: 'utf8' }).trim(), '..'); } catch { return null; } })();
const candidates = [opt('--data'), process.env.BENCH_DATA_DIR, path.join(repoRoot, 'data'), gitCommon && path.join(gitCommon, 'data')].filter(Boolean);
const source = candidates.find(d => fs.existsSync(path.join(d, 'secret')) && ['aux-ai.json', 'coach.json'].some(f => fs.existsSync(path.join(d, f))));

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-bench-'));
process.on('exit', () => { try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* temp only */ } });
process.env.DATA_DIR = work;
let keySource = null;
if (source) {
  fs.copyFileSync(path.join(source, 'secret'), path.join(work, 'secret'));
  for (const f of ['aux-ai.json', 'coach.json']) if (fs.existsSync(path.join(source, f))) fs.copyFileSync(path.join(source, f), path.join(work, f));
}
const auxAI = await import('../lib/aux-ai-config.js');
if (source && auxAI.isConnected()) keySource = 'aux-ai.json (' + source + ')';
if (!keySource && source) {
  const coach = await import('../coach/config.js');
  if (coach.load().provider === 'gemini' && coach.isConnected()) {
    const key = coach.jobEnv(work).GEMINI_API_KEY;
    if (key) { auxAI.setApiKey(key); keySource = 'the Gemini key of the Coach in coach.json (' + source + ')'; }
  }
}
if (!keySource && process.env.GEMINI_API_KEY) { auxAI.setApiKey(process.env.GEMINI_API_KEY); keySource = 'GEMINI_API_KEY from the environment'; }
if (!keySource) {
  console.error('No Gemini key found. Looked in: ' + (candidates.join(', ') || '(no data folder)') + '\n' +
    'Pass --data <the data folder of your local app>, or set GEMINI_API_KEY for this one command.');
  process.exit(2);
}
auxAI.save({ enabled: true, caps: { instanceDaily: 0 } });
console.log(`key: ${keySource}\nsamples: ${dir}  runs: ${runs}\n`);

const metrics = await import('../lib/ai-metrics.js');
const { scanBioimpedanceImage } = await import('../lib/measurements-scan.js');
const { scanRoutineDocument } = await import('../lib/routine-scan.js');
const { scanMachineImage } = await import('../lib/machine-scan.js');

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.pdf': 'application/pdf', '.webp': 'image/webp' };
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** expected → actual comparators; return the list of mismatching fields (empty = exact). */
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

/** A short human-readable view of one result, so a photo can be judged without an expected file. */
function summary(kind, r) {
  if (kind === 'measurements') {
    const v = Object.entries(r.values).filter(([, x]) => x != null).map(([k, x]) => `${k}=${x}`).join(' ');
    return `${v || '(nothing read)'}${r.review?.length ? '  ⚠ to review: ' + r.review.join(', ') : ''}`;
  }
  if (kind === 'machine') return `${r.value.name} → ${r.value.nameEn}`;
  return (r.value.days || []).map((d, i) => `day ${i + 1}${d.label ? ' (' + d.label + ')' : ''}: ` + (d.exercises || []).map(e => `${e.nameEn || e.name} ${e.sets ?? '?'}x${e.reps ?? '?'}${e.unit === 'sec' ? 's' : ''}`).join(', ')).join('\n    ');
}

const files = fs.readdirSync(dir).filter(f => MIME[path.extname(f).toLowerCase()]).sort();
if (!files.length) { console.error('no photos found (jpg, png, webp or pdf)'); process.exit(2); }
let exactAll = 0, scoredAll = 0;
for (const file of files) {
  const kind = file.split('-')[0];
  if (!RUN[kind]) { console.log(`skip ${file}: name it measurements-…, routine-… or machine-…`); continue; }
  const expectedFile = path.join(dir, file.replace(/\.[^.]+$/, '.expected.json'));
  const expected = fs.existsSync(expectedFile) ? JSON.parse(fs.readFileSync(expectedFile, 'utf8')) : null;
  const data = fs.readFileSync(path.join(dir, file)).toString('base64');
  const mimeType = MIME[path.extname(file).toLowerCase()];
  console.log(`● ${file}`);
  let exact = 0, ms = 0; const misses = new Set(), codes = new Set(); let shown = false;
  for (let i = 0; i < runs; i++) {
    const t0 = Date.now();
    const r = await RUN[kind]({ data, mimeType, uid: 'bench' + i });
    ms += Date.now() - t0;
    if (!r.ok) { codes.add(r.code); console.log(`    run ${i + 1}: FAILED (${r.code})`); continue; }
    if (!shown || !expected) { console.log(`    ${summary(kind, r)}`); shown = true; }
    if (expected) { scoredAll++; const bad = COMPARE[kind](expected, r); if (!bad.length) { exact++; exactAll++; } else bad.forEach(b => misses.add(b)); }
  }
  console.log(`    ${expected ? `${exact}/${runs} exact · ` : ''}avg ${Math.round(ms / runs)} ms${misses.size ? ' · wrong: ' + [...misses].join(', ') : ''}${codes.size ? ' · failures: ' + [...codes].join(', ') : ''}\n`);
}
console.log('provider calls per request (the cost of reliability):');
for (const [flow, r] of Object.entries(metrics.snapshot())) {
  console.log(`  ${flow}: requests=${r.requests} avg_calls=${r.avgAttempts} first_try=${r.first_try_success} retry=${r.retry_success} failed=${r.final_failure} second_read=${r.second_read} third_read=${r.third_read}`);
}
if (scoredAll) console.log(`\nexact: ${exactAll}/${scoredAll}`);
