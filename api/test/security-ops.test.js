import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { opsStatus, createErrorRing, BACKUP_STALE_HOURS, REHEARSAL_DUE_DAYS } from '../lib/ops-status.js';
import { bootSocial } from './social-http.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const posix = p => p.split(path.sep).join('/');
const hasBash = spawnSync('bash', ['-c', 'command -v openssl tar gzip sha256sum >/dev/null']).status === 0;
const opts = { skip: hasBash ? false : 'bash/openssl not available' };
const rm = d => fs.rmSync(d, { recursive: true, force: true });

/* ---------- a throw-away "server": a repo copy of the ops scripts, a data/ folder that looks like production's ---------- */
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '2j-ops-'));
  fs.mkdirSync(path.join(root, 'scripts')); fs.mkdirSync(path.join(root, 'data'));
  for (const f of ['backup-data.sh', 'backup-offsite.sh', 'restore-backup.sh', 'mark-deploy.sh', 'ops-check.sh']) fs.copyFileSync(path.join(repo, 'scripts', f), path.join(root, 'scripts', f));
  fs.writeFileSync(path.join(root, 'data', 'secret'), 's'.repeat(64));
  fs.writeFileSync(path.join(root, 'data', 'db.json'), JSON.stringify({ users: [{ id: 'u1', name: 'Ana' }, { id: 'u2', name: 'Beto' }], creds: [], subs: [], invites: [], recoveries: [] }));
  fs.writeFileSync(path.join(root, 'data', 'state-u1.json'), JSON.stringify({ unit: 'kg', workouts: [{ id: 'w1', d: '2026-10-01' }] }));
  fs.writeFileSync(path.join(root, 'data', 'state-u2.json'), JSON.stringify({ unit: 'kg', workouts: [] }));
  const pass = path.join(root, 'pass.txt'); fs.writeFileSync(pass, 'correct horse battery staple\n', { mode: 0o600 });
  const remote = path.join(root, 'remote'), ops = path.join(root, 'data', 'ops');
  const env = { ...process.env, BACKUP_PASSPHRASE_FILE: posix(pass), BACKUP_REMOTE: posix(remote), BACKUP_DIR: 'out', BACKUP_MIN_FREE_MB: '1', BACKUP_SKIP_MODE_CHECK: '1' };
  const run = (script, args = [], extra = {}) => spawnSync('bash', [posix(path.join(root, 'scripts', script)), ...args], { cwd: root, env: { ...env, ...extra }, encoding: 'utf8' });
  const status = f => JSON.parse(fs.readFileSync(path.join(ops, f), 'utf8'));
  const rehearse = (enc, args = [], extra = {}) => spawnSync('bash', [posix(path.join(repo, 'scripts', 'restore-rehearsal.sh')), ...args, posix(enc)], { cwd: root, env: { ...env, OPS_DIR: posix(ops), DATA_DIR: undefined, ...extra }, encoding: 'utf8' });
  const enc = () => path.join(remote, fs.readdirSync(remote).find(x => x.endsWith('.tar.gz.enc')));
  return { root, pass, remote, ops, run, status, rehearse, enc };
}

test('backup: a successful run leaves status ok, a log line and an encrypted copy', opts, () => {
  const f = fixture();
  const r = f.run('backup-offsite.sh');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /^\d{4}-\d\d-\d\dT[\d:]+Z backup-offsite: OK: 2jfitness-/m, 'timestamped log');
  const s = f.status('backup-status.json');
  assert.equal(s.ok, true); assert.equal(s.secretInArchive, 'yes'); assert.match(s.sha256, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(s).includes('correct horse'), false, 'no secret in the status');
  rm(f.root);
});

test('backup: missing offsite configuration fails clearly (exit 2), writes a failed status and uploads nothing', opts, () => {
  const f = fixture();
  const noRemote = f.run('backup-offsite.sh', [], { BACKUP_REMOTE: '' });
  assert.equal(noRemote.status, 2); assert.match(noRemote.stderr, /BACKUP_REMOTE is not set/);
  assert.deepEqual([f.status('backup-status.json').ok, f.status('backup-status.json').reason], [false, 'remote_not_configured']);
  const noPass = f.run('backup-offsite.sh', [], { BACKUP_PASSPHRASE_FILE: '' });
  assert.equal(noPass.status, 2); assert.match(noPass.stderr, /BACKUP_PASSPHRASE_FILE is not set/);
  assert.equal(f.status('backup-status.json').reason, 'passphrase_not_configured');
  assert.equal(f.run('backup-offsite.sh', [], { BACKUP_REMOTE_KEEP: '0' }).status, 2);
  assert.equal(f.run('backup-offsite.sh', [], { BACKUP_REMOTE: 'rclone:nowhere:x', PATH: '/nonexistent-bin:/usr/bin:/bin' }).status === 0, false);
  assert.equal(fs.existsSync(f.remote), false);
  rm(f.root);
});

test('backup: an upload that arrives damaged is an integrity failure, not a success', opts, () => {
  const f = fixture();
  // an exported bash function named cp (found before any PATH lookup) that corrupts the encrypted file it delivers: a flaky mount / truncated transfer
  const r = f.run('backup-offsite.sh', [], { 'BASH_FUNC_cp%%': '() { command cp "$@"; local d; for d; do :; done; for x in "$d"*.enc; do [ -f "$x" ] && printf X >> "$x"; done; return 0; }' });
  assert.notEqual(r.status, 0, r.stdout);
  const s = f.status('backup-status.json');
  assert.deepEqual([s.ok, s.reason, s.stage], [false, 'remote_integrity_failed', 'upload']);
  rm(f.root);
});

test('backup: remote retention keeps only the newest N encrypted files', opts, () => {
  const f = fixture();
  fs.mkdirSync(f.remote);
  [1, 2, 3].forEach(i => {
    const n = path.join(f.remote, `2jfitness-2020-01-0${i}_000000.tar.gz.enc`);
    fs.writeFileSync(n, 'old' + i); fs.writeFileSync(n + '.sha256', 'x');
    const t = new Date(Date.UTC(2020, 0, i)); fs.utimesSync(n, t, t);
  });
  assert.equal(f.run('backup-offsite.sh', [], { BACKUP_REMOTE_KEEP: '2' }).status, 0);
  const left = fs.readdirSync(f.remote).filter(x => x.endsWith('.tar.gz.enc'));
  assert.equal(left.length, 2, left.join(','));
  assert.ok(!left.includes('2jfitness-2020-01-01_000000.tar.gz.enc') && !left.includes('2jfitness-2020-01-02_000000.tar.gz.enc'));
  assert.ok(fs.existsSync(path.join(f.remote, '2jfitness-2020-01-03_000000.tar.gz.enc.sha256')) && !fs.existsSync(path.join(f.remote, '2jfitness-2020-01-01_000000.tar.gz.enc.sha256')));
  rm(f.root);
});

test('backup: warns (and says so in the status) when the secret is not inside ./data', opts, () => {
  const f = fixture();
  fs.rmSync(path.join(f.root, 'data', 'secret'));
  const r = f.run('backup-offsite.sh');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /WARNING: data\/secret is not in \.\/data/);
  assert.equal(f.status('backup-status.json').secretInArchive, 'no');
  rm(f.root);
});

/* ---------- restore rehearsal ---------- */
test('rehearsal: restores into a throw-away dir, validates db + secret + every state, boots an isolated API, leaves production untouched', opts, () => {
  const f = fixture();
  assert.equal(f.run('backup-offsite.sh').status, 0);
  const before = fs.readFileSync(path.join(f.root, 'data', 'db.json'), 'utf8');
  const r = f.rehearse(f.enc(), ['--boot']);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /restore-rehearsal: OK: restorable \(production untouched\)/);
  const s = f.status('restore-status.json');
  assert.deepEqual([s.ok, s.users, s.states, s.boot], [true, 2, 2, true]);
  for (const k of ['verifySeconds', 'restoreSeconds', 'validateSeconds']) assert.equal(typeof s[k], 'number');
  assert.equal(fs.readFileSync(path.join(f.root, 'data', 'db.json'), 'utf8'), before, 'live data untouched');
  rm(f.root);
});

test('rehearsal: a corrupt archive, a wrong passphrase and a missing passphrase all fail and say so in the status', opts, () => {
  const f = fixture();
  assert.equal(f.run('backup-offsite.sh').status, 0);
  const enc = f.enc();
  const other = path.join(f.root, 'other.txt'); fs.writeFileSync(other, 'nope\n');
  assert.equal(f.rehearse(enc, [], { BACKUP_PASSPHRASE_FILE: posix(other) }).status, 5);
  assert.deepEqual([f.status('restore-status.json').ok, f.status('restore-status.json').stage], [false, 'verify']);
  assert.equal(f.rehearse(enc, [], { BACKUP_PASSPHRASE_FILE: '' }).status, 2);
  const bytes = fs.readFileSync(enc); bytes[bytes.length - 7] ^= 0xff; fs.writeFileSync(enc, bytes);
  assert.equal(f.rehearse(enc).status, 4, 'integrity (checksum) failure');
  rm(f.root);
});

test('rehearsal: an archive whose member state cannot be read is NOT restorable (validation, not just "it untars")', opts, () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.root, 'data', 'state-u2.json'), 'this-is-not-json-nor-ciphertext');
  assert.equal(f.run('backup-offsite.sh').status, 0);
  const r = f.rehearse(f.enc());
  assert.equal(r.status, 8, r.stdout + r.stderr);
  assert.match(r.stderr, /state_unreadable/);
  assert.deepEqual([f.status('restore-status.json').ok, f.status('restore-status.json').stage], [false, 'validate']);
  rm(f.root);
});

test('rehearsal: refuses production-like work dirs and non-empty ones', opts, () => {
  const f = fixture();
  assert.equal(f.run('backup-offsite.sh').status, 0);
  const full = path.join(f.root, 'full'); fs.mkdirSync(full); fs.writeFileSync(path.join(full, 'x'), '1');
  assert.equal(f.rehearse(f.enc(), [], { }).status, 0);
  const r = spawnSync('bash', [posix(path.join(repo, 'scripts', 'restore-rehearsal.sh')), posix(f.enc()), posix(full)], { cwd: f.root, env: { ...process.env, BACKUP_PASSPHRASE_FILE: posix(f.pass), OPS_DIR: posix(f.ops) }, encoding: 'utf8' });
  assert.equal(r.status, 7);
  assert.equal(fs.readFileSync(path.join(full, 'x'), 'utf8'), '1', 'a non-empty dir is left alone');
  rm(f.root);
});

/* ---------- ops-status (pure) ---------- */
const NOW = Date.parse('2026-10-10T12:00:00Z');
const hoursAgo = h => new Date(NOW - h * 3600000).toISOString();
function dataWith(files) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), '2j-opsdata-')); fs.mkdirSync(path.join(d, 'ops'));
  for (const [k, v] of Object.entries(files)) fs.writeFileSync(path.join(d, 'ops', k), typeof v === 'string' ? v : JSON.stringify(v));
  return d;
}
const disk = { blocks: 1000, bsize: 1048576, bavail: 500 };

test('ops-status: nothing recorded yet is reported as never, with alerts', () => {
  const d = dataWith({});
  const s = opsStatus({ dataDir: d, now: NOW, disk });
  assert.deepEqual([s.backup.state, s.restore.state, s.deploy], ['never', 'never', null]);
  assert.deepEqual(s.alerts, ['backup_never', 'restore_never']); assert.equal(s.ok, false);
  rm(d);
});

test('ops-status: fresh backup + recent rehearsal + deploy marker = ok; stale / failed / due raise the right alarm', () => {
  const good = { 'backup-status.json': { ok: true, at: hoursAgo(5), file: 'a.enc', bytes: 10, secretInArchive: 'yes' }, 'restore-status.json': { ok: true, at: hoursAgo(24 * 3), users: 5, states: 5 }, 'deploy-marker.json': { sha: 'dd7897a', at: hoursAgo(48) } };
  let d = dataWith(good);
  let s = opsStatus({ dataDir: d, now: NOW, disk, users: 5 });
  assert.deepEqual([s.backup.state, s.restore.state, s.deploy.sha, s.deploy.ageDays, s.ok, s.alerts], ['ok', 'ok', 'dd7897a', 2, true, []]);
  rm(d);
  d = dataWith({ ...good, 'backup-status.json': { ok: true, at: hoursAgo(BACKUP_STALE_HOURS + 1) }, 'restore-status.json': { ok: true, at: hoursAgo(24 * (REHEARSAL_DUE_DAYS + 1)) } });
  s = opsStatus({ dataDir: d, now: NOW, disk }); assert.deepEqual(s.alerts, ['backup_stale', 'restore_due']); rm(d);
  d = dataWith({ ...good, 'backup-status.json': { ok: false, at: hoursAgo(1), reason: 'upload_failed', stage: 'upload' }, 'restore-status.json': { ok: false, at: hoursAgo(1), stage: 'verify' } });
  s = opsStatus({ dataDir: d, now: NOW, disk }); assert.deepEqual(s.alerts, ['backup_failed', 'restore_failed']); assert.equal(s.backup.reason, 'upload_failed'); rm(d);
  d = dataWith({ ...good, 'backup-status.json': { ok: true, at: hoursAgo(1), secretInArchive: 'no' } });
  s = opsStatus({ dataDir: d, now: NOW, disk }); assert.deepEqual(s.alerts, ['secret_not_in_archive']); rm(d);
});

test('ops-status: low disk alarms; garbage status files are ignored, long strings are clipped, no unknown field leaks', () => {
  const d = dataWith({ 'backup-status.json': 'not json', 'restore-status.json': { ok: true, at: hoursAgo(1), note: 'x'.repeat(500), password: 'leak', file: 'y'.repeat(500) } });
  const s = opsStatus({ dataDir: d, now: NOW, disk: { blocks: 1000, bsize: 1048576, bavail: 100 } });
  assert.equal(s.backup.state, 'never'); assert.ok(s.alerts.includes('disk_low')); assert.equal(s.disk.freePercent, 10);
  assert.equal(JSON.stringify(s).includes('leak'), false); assert.equal(s.restore.file.length, 120);
  rm(d);
});

test('error ring keeps the last N failures (route, status, time) and a total, newest first', () => {
  const ring = createErrorRing(3);
  for (let i = 1; i <= 5; i++) ring.record('GET /api/x' + i, 500 + i, NOW + i);
  const snap = ring.snapshot();
  assert.equal(snap.total, 5); assert.deepEqual(snap.last.map(e => e.route), ['GET /api/x5', 'GET /api/x4', 'GET /api/x3']);
  assert.deepEqual(Object.keys(snap.last[0]).sort(), ['at', 'route', 'status']);
});

/* ---------- deploy marker + cron check ---------- */
test('mark-deploy writes the marker the ops view reads and refuses anything that is not a git sha', opts, () => {
  const f = fixture();
  assert.equal(f.run('mark-deploy.sh', ['dd7897a294095a2f615cff24cfa2720bfd65d6e1', 'center "console" $(x)']).status, 0);
  const m = f.status('deploy-marker.json');
  assert.equal(m.sha, 'dd7897a294095a2f615cff24cfa2720bfd65d6e1'); assert.equal(m.note, 'center console x');
  assert.equal(f.run('mark-deploy.sh', ['not-a-sha']).status, 2); assert.equal(f.run('mark-deploy.sh', ['abc']).status, 2);
  assert.equal(opsStatus({ dataDir: path.join(f.root, 'data'), disk }).deploy.sha, m.sha);
  rm(f.root);
});

test('ops-check: alarms on a missing/failed/stale backup and a failed rehearsal, ok when healthy', opts, () => {
  const f = fixture();
  const check = () => f.run('ops-check.sh', ['0']);
  let r = check(); assert.equal(r.status, 1); assert.match(r.stdout, /ALARM: backup: never ran/);
  fs.mkdirSync(f.ops, { recursive: true });
  fs.writeFileSync(path.join(f.ops, 'backup-status.json'), JSON.stringify({ ok: true, at: new Date().toISOString() }));
  r = check(); assert.equal(r.status, 0, r.stdout); assert.match(r.stdout, /note: restore rehearsal: never done/); assert.match(r.stdout, /ops-check: ok/);
  fs.writeFileSync(path.join(f.ops, 'backup-status.json'), JSON.stringify({ ok: true, at: new Date(Date.now() - 40 * 3600000).toISOString() }));
  r = check(); assert.equal(r.status, 1); assert.match(r.stdout, /older than 36 h/);
  fs.writeFileSync(path.join(f.ops, 'backup-status.json'), JSON.stringify({ ok: false, reason: 'upload_failed', stage: 'upload', at: new Date().toISOString() }));
  r = check(); assert.equal(r.status, 1); assert.match(r.stdout, /FAILED \(upload_failed at upload/);
  fs.writeFileSync(path.join(f.ops, 'backup-status.json'), JSON.stringify({ ok: true, at: new Date().toISOString() }));
  fs.writeFileSync(path.join(f.ops, 'restore-status.json'), JSON.stringify({ ok: false, stage: 'validate', at: new Date().toISOString() }));
  r = check(); assert.equal(r.status, 1); assert.match(r.stdout, /restore rehearsal: last run FAILED/);
  rm(f.root);
});

/* ---------- the admin endpoint ---------- */
const S = await bootSocial({ tag: 'security-ops' });
test.after(() => S.stop());

test('GET /api/admin/ops: admin only; reflects the ops files; public health stays minimal', async () => {
  assert.equal((await fetch(S.base + '/api/admin/ops')).status, 401);
  assert.equal((await S.call('a', 'GET', '/api/admin/ops')).status, 403);
  assert.equal((await S.call('trainer-a', 'GET', '/api/admin/ops')).status, 403);
  fs.mkdirSync(path.join(S.dir, 'ops'), { recursive: true });
  fs.writeFileSync(path.join(S.dir, 'ops', 'backup-status.json'), JSON.stringify({ ok: true, at: new Date().toISOString(), file: 'x.enc', bytes: 9 }));
  fs.writeFileSync(path.join(S.dir, 'ops', 'deploy-marker.json'), JSON.stringify({ sha: 'dd7897a', at: new Date().toISOString() }));
  const r = await S.call('admin', 'GET', '/api/admin/ops');
  assert.equal(r.status, 200);
  assert.deepEqual([r.data.backup.state, r.data.deploy.sha, r.data.users, r.data.errors.total], ['ok', 'dd7897a', 6, 0]);
  assert.ok(r.data.uptimeSec >= 0 && Array.isArray(r.data.alerts));
  assert.deepEqual(Object.keys(await (await fetch(S.base + '/api/health')).json()).sort(), ['ok', 'users'], 'public health unchanged');
});

test('a server-side failure shows up in the ops error ring without bodies or user data', async () => {
  fs.writeFileSync(path.join(S.dir, 'state-c.json'), 'corrupt-not-json');
  const bad = await S.call('c', 'GET', '/api/data');
  assert.ok(bad.status >= 500, 'corrupt state is a 5xx: ' + bad.status);
  const r = await S.call('admin', 'GET', '/api/admin/ops');
  assert.ok(r.data.errors.total >= 1);
  const last = r.data.errors.last[0];
  assert.deepEqual(Object.keys(last).sort(), ['at', 'route', 'status']); assert.match(last.route, /^GET \/api\//);
});

/* ---------- ops-check alert hook: external, configurable, no provider or secret in the repo ---------- */
function alertFixture() {
  const f = fixture();
  fs.mkdirSync(f.ops, { recursive: true });
  const log = path.join(f.root, 'alerts.log'), pwned = path.join(f.root, 'PWNED');
  // the "provider": appends status | $1 | env message | stdin on one line
  const cmd = `printf '%s|%s|%s|%s\n' "$OPS_ALERT_STATUS" "$1" "$OPS_ALERT_MESSAGE" "$(cat)" >> '${posix(log)}'`;
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []);
  const backup = o => fs.writeFileSync(path.join(f.ops, 'backup-status.json'), JSON.stringify({ at: new Date().toISOString(), ...o }));
  const check = (extra = {}, args = ['0']) => f.run('ops-check.sh', args, { OPS_ALERT_COMMAND: cmd, ...extra });
  return { ...f, cmd, calls, backup, check, pwned };
}

test('ops-check alert hook: without OPS_ALERT_COMMAND it behaves as before (alarm exit 1, nothing else)', opts, () => {
  const f = alertFixture();
  f.backup({ ok: false, reason: 'upload_failed', stage: 'upload' });
  const r = f.run('ops-check.sh', ['0']);
  assert.equal(r.status, 1); assert.match(r.stdout, /ALARM: backup: last run FAILED/); assert.equal(r.stderr, '');
  assert.equal(fs.existsSync(path.join(f.ops, 'alert-state')), false, 'no state file when no hook is configured');
  assert.equal(f.run('ops-check.sh', ['--alert-test']).status, 2, 'testing the wiring without a command says so');
  rm(f.root);
});

test('ops-check alert hook: an alarm runs the command once with status, message in $1, env and stdin; exit stays 1; repeats are throttled', opts, () => {
  const f = alertFixture();
  f.backup({ ok: false, reason: 'upload_failed', stage: 'upload' });
  const r = f.check();
  assert.equal(r.status, 1);
  const [call, ...rest] = f.calls(); assert.equal(rest.length, 0);
  const [status, arg, env, stdin] = call.split('|');
  assert.equal(status, 'alarm'); assert.match(arg, /^ALARM: backup: last run FAILED \(upload_failed at upload/);
  assert.equal(env, arg); assert.equal(stdin, arg);
  assert.equal(f.check().status, 1); assert.equal(f.calls().length, 1, 'same alarm within the window is not re-sent');
  assert.equal(f.check({ OPS_ALERT_REPEAT_MIN: '0' }).status, 1); assert.equal(f.calls().length, 2, 'resent once the repeat window has passed');
  f.backup({ ok: false, reason: 'disk_low', stage: 'disk' });
  f.check(); assert.equal(f.calls().length, 3, 'a different alarm is sent at once');
  rm(f.root);
});

test('ops-check alert hook: one "recovered" when it clears, none when it was never in alarm', opts, () => {
  const f = alertFixture();
  f.backup({ ok: true });
  assert.equal(f.check().status, 0); assert.equal(f.calls().length, 0);
  f.backup({ ok: false, reason: 'x', stage: 'y' }); f.check();
  f.backup({ ok: true });
  assert.equal(f.check().status, 0); assert.equal(f.calls().at(-1).split('|')[0], 'recovered');
  const n = f.calls().length; f.check(); assert.equal(f.calls().length, n, 'recovery is announced once');
  rm(f.root);
});

test('ops-check alert hook: text from the status files is data, never code (no injection through the message)', opts, () => {
  const f = alertFixture();
  f.backup({ ok: false, reason: `$(touch '${posix(f.pwned)}');\`touch '${posix(f.pwned)}'\`;"x`, stage: "a'b" });
  assert.equal(f.check().status, 1);
  assert.equal(fs.existsSync(f.pwned), false, 'nothing in the message was executed');
  assert.match(f.calls()[0], /touch .*PWNED/, 'the text reached the command literally');
  rm(f.root);
});

test('ops-check alert hook: a failing alert command is reported, the exit code is still the alarm, and it is retried next run', opts, () => {
  const f = alertFixture();
  f.backup({ ok: false, reason: 'upload_failed', stage: 'upload' });
  const r = f.check({ OPS_ALERT_COMMAND: 'exit 7' });
  assert.equal(r.status, 1); assert.match(r.stderr, /alert command failed \(exit 7\)/);
  assert.equal(fs.existsSync(path.join(f.ops, 'alert-state')), false, 'a failed send is not recorded as sent');
  assert.equal(f.check().status, 1); assert.equal(f.calls().length, 1, 'the next run tries again');
  rm(f.root);
});

test('ops-check --alert-test sends one test message through the configured command and exits 0', opts, () => {
  const f = alertFixture();
  const r = f.check({}, ['--alert-test']);
  assert.equal(r.status, 0, r.stderr); assert.equal(f.calls().length, 1); assert.equal(f.calls()[0].split('|')[0], 'test');
  rm(f.root);
});
