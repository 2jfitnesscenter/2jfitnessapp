// Test harness for trainer-ai-flow.test.js: loaded into the SERVER process (node --import) so the trainer AI jobs run the deterministic fixture provider instead of Claude.
// The fixture mode is read from DATA_DIR/fixture-mode.txt on every call and every call is counted in DATA_DIR/provider-calls.log. Never used in production.
import fs from 'node:fs';
import path from 'node:path';
import * as trainerAI from '../coach/trainer-ai.js';
import * as trainerJobs from '../coach/trainer-jobs.js';
import { adapterFor } from '../coach/adapters/index.js';

const dir = process.env.DATA_DIR;
const base = adapterFor('fixture');
trainerAI.save({ enabled: true });
trainerAI.setSetupToken('fake-token-for-tests');
trainerJobs.setAdapterForTests({
  ...base,
  async invoke(args) {
    fs.appendFileSync(path.join(dir, 'provider-calls.log'), 'call\n');
    let mode = '';
    try { mode = fs.readFileSync(path.join(dir, 'fixture-mode.txt'), 'utf8').trim(); } catch { /* default: a valid answer */ }
    process.env.FIXTURE_MODE = mode;
    return base.invoke(args);
  }
});
