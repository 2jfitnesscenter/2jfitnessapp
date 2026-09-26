import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tempData, sampleState } from './helpers.mjs';

const DIR = tempData();
const cfg = await import('../coach/config.js');
const auth = await import('../coach/oauth.js');
const cadence = await import('../coach/cadence.js');

/* ---------------- configuration ---------------- */

test('an unconfigured instance offers nothing at all', () => {
  assert.equal(cfg.isEnabled(), false);
  assert.equal(cfg.isConnected(), false);
  assert.equal(cfg.publicConfig(), null, 'no coach key in /api/config ⇒ no Coach UI anywhere');
});

test('a provider that is enabled but not signed in is still not offered', () => {
  cfg.save({ enabled: true, provider: 'claude' });
  assert.equal(cfg.isEnabled(), true);
  assert.equal(cfg.isConnected(), false);
  assert.equal(cfg.publicConfig(), null, 'half-configured is off, not broken');
});

test('credentials survive a round-trip and are unreadable in the file', () => {
  cfg.save({ enabled: true, provider: 'claude', auth: { type: 'cli-token', data: cfg.encrypt({ token: 'cli-setup-secret' }) } });
  assert.equal(cfg.isConnected(), true);
  const onDisk = fs.readFileSync(`${DIR}/coach.json`, 'utf8');
  assert.ok(!onDisk.includes('cli-setup-secret'), 'the token is not sitting in the file in the clear');
  assert.equal(cfg.decrypt(cfg.load().auth.data).token, 'cli-setup-secret');
});

test('a credential encrypted under a different secret fails closed', () => {
  const blob = cfg.encrypt({ token: 'sk-ant-secret' });
  fs.writeFileSync(`${DIR}/secret`, 'b'.repeat(64));
  cfg.reset();
  assert.equal(cfg.decrypt(blob), null, 'restoring ./data without its secret does not leak the token');
  fs.writeFileSync(`${DIR}/secret`, 'a'.repeat(64));
  cfg.reset();
});

test('a Claude Code setup token is encrypted and reaches only the Agent SDK environment', () => {
  cfg.save({ enabled: true, provider: 'claude', auth: null });
  auth.setSetupToken('cli-setup-tok');
  assert.equal(cfg.load().auth.type, 'cli-token');
  assert.equal(auth.authStatus().type, 'cli-token');
  process.env.RP_ID = 'gym.example.com';
  process.env.ADMIN_UIDS = 'someadmin';
  const env = cfg.jobEnv('/tmp/jobdir');
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, 'cli-setup-tok');
  assert.equal(env.HOME, '/tmp/jobdir', 'the Agent SDK writes any transient state into the job dir');
  assert.equal(env.CLAUDE_CONFIG_DIR, '/tmp/jobdir');
  assert.equal(env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, '1');
  assert.equal(env.RP_ID, undefined, 'nothing is inherited from this process');
  assert.equal(env.ADMIN_UIDS, undefined);
  assert.deepEqual(Object.keys(env).sort(), ['CLAUDE_CODE_DISABLE_AUTO_MEMORY', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CONFIG_DIR', 'HOME', 'PATH', 'TMPDIR']);
});

test('a retired Custom command configuration resets to unconfigured Claude', () => {
  cfg.save({
    enabled: true,
    provider: 'custom',   // never re-added after "Remove retired Coach providers" — still not in PROVIDERS
    customCommand: '/usr/local/bin/my-coach',
    auth: { type: 'apikey', data: cfg.encrypt({ token: 'some-key' }) }
  });
  cfg.reset();
  const current = cfg.load();
  assert.deepEqual(Object.keys(cfg.PROVIDERS).sort(), ['claude', 'codex', 'fixture', 'gemini', 'openai']);
  assert.equal(current.provider, 'claude');
  assert.equal(current.auth, null);
  assert.equal(Object.hasOwn(current, 'customCommand'), false);
  assert.equal(cfg.isConnected(), false);
});

// Gemini was removed in "Remove retired Coach providers" (a CLI-spawn adapter, same family as
// the also-removed Custom command) and later re-added as a plain HTTPS API adapter (gemini.js)
// with no local command-execution surface — a config saved against that provider must round-trip
// normally rather than being treated as a leftover from the retired one.
test('Gemini is a live provider, not a retired one — its config round-trips normally', () => {
  cfg.save({ enabled: true, provider: 'gemini', auth: { type: 'apikey', data: cfg.encrypt({ token: 'gemini-key' }) } });
  cfg.reset();
  const current = cfg.load();
  assert.equal(current.provider, 'gemini');
  assert.equal(cfg.isConnected(), true);
});

// V3: OpenAI direct REST — same family as Gemini above (plain HTTPS API adapter, generic
// apikey auth, no local command-execution surface), added specifically to replace the earlier
// Codex-CLI path for members who want ChatGPT, without needing container filesystem permissions.
test('OpenAI is a live provider using the generic apikey auth path, same as Gemini', () => {
  cfg.save({ enabled: true, provider: 'openai', auth: { type: 'apikey', data: cfg.encrypt({ token: 'openai-key' }) } });
  cfg.reset();
  const current = cfg.load();
  assert.equal(current.provider, 'openai');
  assert.equal(cfg.isConnected(), true);
  const env = cfg.jobEnv('/tmp/jobdir');
  assert.equal(env.OPENAI_API_KEY, 'openai-key');
  assert.equal(env.CODEX_HOME, undefined, 'never touches Codex\'s own credential cache');
});

test('Codex uses its own ChatGPT CLI cache and never receives an API key', () => {
  cfg.save({ enabled: true, provider: 'codex', auth: { type: 'apikey', data: cfg.encrypt({ token: 'legacy-openai-key' }) } });
  cfg.ensureCodexHome();
  const codexConfig = fs.readFileSync(`${cfg.codexHome()}/config.toml`, 'utf8');
  assert.match(codexConfig, /shell_tool = false/);
  assert.match(codexConfig, /":root" = "deny"/);
  fs.writeFileSync(cfg.codexAuthFile(), '{}', { mode: 0o600 });

  assert.equal(cfg.isConnected(), true);
  assert.equal(auth.authStatus().type, 'chatgpt-cli');
  assert.throws(() => auth.setApiKey('sk-not-used'), /ChatGPT/);

  const env = cfg.jobEnv('/tmp/jobdir');
  assert.equal(env.CODEX_HOME, cfg.codexHome());
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.CODEX_API_KEY, undefined);
  assert.equal(env.HOME, '/tmp/jobdir', 'the agent has no access to the persistent cache through HOME');
  fs.unlinkSync(cfg.codexAuthFile());
  assert.equal(cfg.isConnected(), false, 'a removed Codex cache fails closed');
});

test('legacy Claude credentials are disabled until replaced with a setup token', () => {
  cfg.save({ enabled: true, provider: 'claude', auth: { type: 'apikey', data: cfg.encrypt({ token: 'sk-ant-key' }) } });
  assert.equal(cfg.isConnected(), false);
  assert.equal(auth.authStatus().state, 'replace-required');
  const env = cfg.jobEnv('/tmp/jobdir');
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, undefined);
  assert.throws(() => auth.setApiKey('sk-ant-key'), /setup token/);
});

test('the instance job log records outcomes, never contents', () => {
  cfg.save({ log: [] });
  cfg.logJob({ at: new Date().toISOString(), uid: 'u1', kind: 'review', outcome: 'ready', ms: 1200 });
  cfg.logJob({ at: new Date().toISOString(), uid: 'u1', kind: 'review', outcome: 'failed', errorClass: 'auth', ms: 400 });
  const log = cfg.load().log;
  assert.equal(log.length, 2);
  assert.equal(cfg.lastError().errorClass, 'auth');
  assert.equal(cfg.lastSuccess().outcome, 'ready');
  assert.ok(!JSON.stringify(log).includes('changes'), 'no proposal content ever reaches the instance log');
});

/* ---------------- cadence ---------------- */

const coachWith = over => ({ consent: { agreedAt: '2026-01-01T00:00:00Z' }, ...over });

test('cadence off never fires', () => {
  assert.equal(cadence.isDue(coachWith({ cadence: 'off' }), sampleState(), null), false);
  assert.equal(cadence.isDue(coachWith({}), sampleState(), null), false);
});

test('no new training since the last review means nothing to review', () => {
  const S = sampleState();
  const coach = coachWith({ cadence: { everyWorkouts: 1 }, lastReview: { at: Date.now() } });
  assert.equal(cadence.isDue(coach, S, null), false);
});

test('every-N-workouts fires once every routine in the plan has that many', () => {
  // sampleState()'s plan has a single routine, r1.
  const S = sampleState();
  S.workouts = [1, 2, 3].map(i => ({ id: 'w' + i, d: '2026-07-2' + i, end: Date.now(), routineId: 'r1', entries: [] }));
  assert.equal(cadence.isDue(coachWith({ cadence: { everyWorkouts: 4 } }), S, null), false);
  assert.equal(cadence.isDue(coachWith({ cadence: { everyWorkouts: 3 } }), S, null), true);
});

test('every-N-workouts does not fire on a flat total — every routine needs its own N', () => {
  const S = sampleState({ routines: [{ id: 'r1', name: 'Push', ex: [] }, { id: 'r2', name: 'Legs', ex: [] }] });
  // 5 Push sessions, zero Legs — a real total of 5 is not "enough training to review" when a
  // third of the split has gone completely untouched.
  S.workouts = [1, 2, 3, 4, 5].map(i => ({ id: 'w' + i, d: '2026-07-0' + i, end: Date.now(), routineId: 'r1', entries: [] }));
  assert.equal(cadence.isDue(coachWith({ cadence: { everyWorkouts: 3 } }), S, null), false);
  S.workouts.push({ id: 'w6', d: '2026-07-10', end: Date.now(), routineId: 'r2', entries: [] });
  S.workouts.push({ id: 'w7', d: '2026-07-11', end: Date.now(), routineId: 'r2', entries: [] });
  assert.equal(cadence.isDue(coachWith({ cadence: { everyWorkouts: 3 } }), S, null), false, 'r2 still only has 2');
  S.workouts.push({ id: 'w8', d: '2026-07-12', end: Date.now(), routineId: 'r2', entries: [] });
  assert.equal(cadence.isDue(coachWith({ cadence: { everyWorkouts: 3 } }), S, null), true, 'both routines now have 3');
});

test('every-N-workouts never fires with no plan, and freestyle sessions do not count toward any routine', () => {
  const S = sampleState({ routines: [] });
  S.workouts = [1, 2, 3].map(i => ({ id: 'w' + i, d: '2026-07-2' + i, end: Date.now(), entries: [] })); // no routineId
  assert.equal(cadence.isDue(coachWith({ cadence: { everyWorkouts: 1 } }), S, null), false, 'nothing in the plan to review against');
});

test('monthly fires on the chosen day-of-month and minute, in the user\'s own timezone', () => {
  const S = sampleState();
  S.workouts = [{ id: 'w1', d: '2026-07-05', end: Date.now(), entries: [] }];
  const coach = coachWith({ cadence: { monthly: { day: 15, time: '18:00' } } });
  assert.equal(cadence.isDue(coach, S, { date: '2026-07-15', hhmm: '18:00', weekday: 3 }), true);
  assert.equal(cadence.isDue(coach, S, { date: '2026-07-15', hhmm: '17:59', weekday: 3 }), false);
  assert.equal(cadence.isDue(coach, S, { date: '2026-07-16', hhmm: '18:00', weekday: 4 }), false);
});

test('monthly does not fire twice in the same calendar month', () => {
  const S = sampleState();
  S.workouts = [{ id: 'w1', d: '2026-07-05', end: Date.now(), entries: [] }];
  const coach = coachWith({
    cadence: { monthly: { day: 15, time: '18:00' } },
    lastReview: { at: new Date('2026-07-15T18:00:00Z').getTime() }
  });
  assert.equal(cadence.isDue(coach, S, { date: '2026-07-15', hhmm: '18:00', weekday: 3 }), false);
});
