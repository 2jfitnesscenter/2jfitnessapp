// Runs api/test/capabilities-corpus.mjs against a 2J-CAPABILITIES-V2 consumer through a thin adapter that normalizes each answer
// to the corpus vocabulary: allow | baseline | suspended | revoked | not_linked | rejected | unavailable.
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scenarios, sequences, NOW, PERSON, USER } from './capabilities-corpus.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SECRET_BYTES = crypto.randomBytes(32);              // test-only signing secret generated per run
const ORIGIN = 'https://platform.example';
export const CODEX_COMMIT = '9377e517';

const byReason = { ADMIN_SUSPENDED: 'suspended', TRAINING_LINK_REVOKED: 'revoked', TRAINING_LINK_MISSING: 'not_linked' };

/** Claude's consumer (platform-sso/capabilities.js, the one Búnker ships). */
export async function claudeAdapter() {
  const { createCapabilitiesService } = await import('../platform-sso/capabilities.js');
  return {
    name: 'claude',
    make({ now, fetchImpl, timeoutMs = 3000 }) {
      const service = createCapabilitiesService({ config: { baseUrl: ORIGIN, keyId: 'bunker-1', secret: SECRET_BYTES.toString('base64url') }, now, fetchImpl, timeoutMs, breakerBaseMs: 1 });
      return async () => {
        const out = await service.evaluate({ personId: PERSON, id: USER }, { mode: 'enforced' });
        if (!out) return 'unavailable';
        if (out.source === 'rejected') return 'rejected';
        if (out.source === 'degraded') return 'unavailable';
        if (byReason[out.reasonCode]) return byReason[out.reasonCode];
        return out.level === 'baseline' ? 'baseline' : 'allow';
      };
    },
  };
}

/** Codex's consumer, extracted read-only from its commit next to the Búnker modules it imports, then removed. */
export async function codexAdapter() {
  const source = execFileSync('git', ['show', `${CODEX_COMMIT}:api/platform-capabilities/consumer.js`], { cwd: path.join(HERE, '..'), encoding: 'utf8' });
  const file = path.join(HERE, '..', 'platform-sso', `.codex-consumer-${process.pid}.tmp.mjs`);
  fs.writeFileSync(file, source);
  let mod;
  try { mod = await import(pathToFileURL(file).href); } finally { fs.rmSync(file, { force: true }); }
  return {
    name: 'codex',
    make({ now, fetchImpl, timeoutMs = 3000 }) {
      const consumer = mod.createCapabilitiesV2Consumer({ enabled: true, platformOrigin: ORIGIN, keyId: 'bunker-1', secret: SECRET_BYTES, fetchImpl, now, timeoutMs });
      return async () => {
        const out = await consumer.resolve({ personId: PERSON, trainingUserId: USER });
        if (out.status === 'invalid') return 'rejected';
        if (out.status === 'unavailable') return 'unavailable';
        if (out.status === 'available') return 'allow';
        if (['baseline', 'suspended', 'revoked', 'not_linked'].includes(out.status)) return out.status;
        return `other:${out.status}`;
      };
    },
  };
}

function clock(start = NOW) { let t = start; return { now: () => t, advance: ms => { t += ms; } }; }

export async function runScenario(adapter, scenario) {
  const clk = clock();
  const fetchImpl = async (_url, init) => scenario.respond(init);
  const evaluate = adapter.make({ now: clk.now, fetchImpl, timeoutMs: scenario.timeoutMs ?? 3000 });
  try { return await evaluate(); } catch (error) { return `threw:${error.message}`; }
}

export async function runSequence(adapter, sequence) {
  const clk = clock();
  let index = 0, fetches = 0;
  const fetchImpl = async () => { fetches += 1; return sequence.steps[Math.min(index, sequence.steps.length - 1)].answer(); };
  const evaluate = adapter.make({ now: clk.now, fetchImpl });
  const verdicts = [];
  for (index = 0; index < sequence.steps.length; index += 1) {
    const step = sequence.steps[index];
    if (step.advance) clk.advance(step.advance);
    try {
      if (sequence.concurrent) verdicts.push(...(await Promise.all(Array.from({ length: sequence.concurrent }, () => evaluate()))));
      else verdicts.push(await evaluate());
    } catch (error) { verdicts.push(`threw:${error.message}`); }
  }
  return { verdicts, fetches };
}

/** Whole corpus -> rows { id, group, expected, actual, ok, why } for one adapter. */
export async function runCorpus(adapter) {
  const rows = [];
  for (const scenario of scenarios) {
    const actual = await runScenario(adapter, scenario);
    const expected = scenario.expect[adapter.name];
    rows.push({ id: scenario.id, group: scenario.group, expected, actual, ok: actual === expected, why: scenario.expect.why });
  }
  for (const sequence of sequences) {
    const { verdicts, fetches } = await runSequence(adapter, sequence);
    const expected = sequence.steps.flatMap(step => Array(sequence.concurrent ?? 1).fill(step.expect));
    const ok = JSON.stringify(verdicts) === JSON.stringify(expected) && fetches === sequence.fetches;
    rows.push({ id: sequence.id, group: 'sequence', expected: `${expected.join(',')} / ${sequence.fetches} fetch(es)`, actual: `${verdicts.join(',')} / ${fetches} fetch(es)`, ok });
  }
  return rows;
}
