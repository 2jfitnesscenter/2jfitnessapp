// Runs the shared 2J-CAPABILITIES-V2 corpus against both candidate consumers and prints where they agree and differ.
//   node scripts/compare-capabilities-consumers.mjs [--json]
// Read-only: the Codex consumer is read from its commit (git show) and never added to this branch.
import { claudeAdapter, codexAdapter, runCorpus, CODEX_COMMIT } from '../test/capabilities-conformance-runner.mjs';

const claude = await runCorpus(await claudeAdapter());
const codex = await runCorpus(await codexAdapter());
const rows = claude.map((row, i) => ({ id: row.id, group: row.group, claude: row.actual, codex: codex[i].actual, claudeAsExpected: row.ok, codexAsExpected: codex[i].ok }));

if (process.argv.includes('--json')) { console.log(JSON.stringify({ codexCommit: CODEX_COMMIT, rows }, null, 2)); process.exit(0); }

const pad = (s, n) => String(s).padEnd(n);
console.log(`2J-CAPABILITIES-V2 consumers: claude (platform-sso/capabilities.js) vs codex (platform-capabilities/consumer.js @ ${CODEX_COMMIT})`);
console.log(`${pad('scenario', 46)}${pad('claude', 14)}${pad('codex', 14)}note`);
for (const row of rows) {
  const note = [!row.claudeAsExpected && 'CLAUDE UNEXPECTED', !row.codexAsExpected && 'CODEX UNEXPECTED', row.claude !== row.codex && 'differ'].filter(Boolean).join(', ');
  console.log(`${pad(row.id, 46)}${pad(row.claude, 14)}${pad(row.codex, 14)}${note}`);
}
const count = (list, pick) => list.filter(pick).length;
console.log(`\nclaude as expected: ${count(rows, r => r.claudeAsExpected)}/${rows.length}   codex as expected: ${count(rows, r => r.codexAsExpected)}/${rows.length}   differ: ${count(rows, r => r.claude !== r.codex)}`);
