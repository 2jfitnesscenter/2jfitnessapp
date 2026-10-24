import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { claudeAdapter, codexAdapter, runCorpus, CODEX_COMMIT } from './capabilities-conformance-runner.mjs';
import { scenarios } from './capabilities-corpus.mjs';

const failures = rows => rows.filter(row => !row.ok).map(row => `${row.id}: expected ${row.expected}, got ${row.actual}`);

test('the consumer Búnker ships (platform-sso/capabilities.js) gives the expected verdict for every scenario of the shared 2J-CAPABILITIES-V2 corpus', async () => {
  const rows = await runCorpus(await claudeAdapter());
  assert.ok(rows.length >= 80, `corpus looks truncated (${rows.length})`);
  assert.deepEqual(failures(rows), []);
});

test('a contradictory answer never widens access: suspended or baseline claims with open flags are refused, not believed', async () => {
  const rows = await runCorpus(await claudeAdapter());
  const consistency = rows.filter(row => row.group === 'consistency');
  assert.ok(consistency.length >= 10);
  for (const row of consistency) assert.equal(row.actual, 'rejected', row.id);
});

test('outages degrade, rejections and contradictions fail closed (decision H6), and a skewed clock is an outage (decision H4)', async () => {
  const byId = Object.fromEntries((await runCorpus(await claudeAdapter())).map(row => [row.id, row.actual]));
  for (const id of ['network-error', 'timeout', 'http-500', 'http-503', 'http-429', 'http-408', 'already-expired', 'issued-10-minutes-in-the-future']) assert.equal(byId[id], 'unavailable', id);
  for (const id of ['http-401', 'http-403', 'http-404', 'invalid-json', 'oversized-body-of-a-valid-answer', 'answer-says-it-was-redirected', 'answer-from-another-url']) assert.equal(byId[id], 'rejected', id);
});

test('the other candidate (Codex, platform-capabilities @ 9377e517) behaves as the corpus records, so the documented differences are the only ones', async t => {
  try { execFileSync('git', ['cat-file', '-e', `${CODEX_COMMIT}^{commit}`], { stdio: 'ignore' }); } catch { return t.skip(`commit ${CODEX_COMMIT} is not in this clone`); }
  const claude = await runCorpus(await claudeAdapter());
  const codex = await runCorpus(await codexAdapter());
  assert.deepEqual(failures(codex), []);
  const codexById = new Map(codex.map(row => [row.id, row]));
  const differing = claude.filter(row => codexById.has(row.id) && row.actual !== codexById.get(row.id).actual).map(row => row.id).sort();
  const documented = scenarios.filter(scenario => scenario.expect.claude !== scenario.expect.codex).map(scenario => scenario.id).sort();
  assert.deepEqual(differing, documented, 'every difference between the two consumers is intended and explained in the corpus');
  for (const scenario of scenarios) if (scenario.expect.claude !== scenario.expect.codex) assert.ok(scenario.expect.why, `${scenario.id} needs a stated reason`);
});
