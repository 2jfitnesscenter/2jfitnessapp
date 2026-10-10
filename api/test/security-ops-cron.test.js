import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/* ops-check.sh must work on a host with Docker and NO Node (it is pure shell), read data/ops in any mode, and behave the same from cron's bare
 * environment; install-ops-cron.sh keeps the cron block + logrotate installed idempotently. Nothing here touches a real crontab or /etc. */
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const posix = p => p.split(path.sep).join('/');
const hasBash = spawnSync('bash', ['-c', 'command -v sed awk df date cksum grep >/dev/null']).status === 0;
const opts = { skip: hasBash ? false : 'bash/coreutils not available' };
const rm = d => fs.rmSync(d, { recursive: true, force: true });
const iso = ageMs => new Date(Date.now() - ageMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
const H = 3600000, D = 86400000;

// a throw-away "/opt/2jfitness": scripts/ + data/ops (mode 700, files 600, like root's), run exactly as cron would: bare environment, any cwd
function server() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '2j-cron-'));
  fs.mkdirSync(path.join(root, 'scripts')); const ops = path.join(root, 'data', 'ops'); fs.mkdirSync(ops, { recursive: true, mode: 0o700 });
  for (const f of ['ops-check.sh', 'install-ops-cron.sh']) fs.copyFileSync(path.join(repo, 'scripts', f), path.join(root, 'scripts', f));
  const put = (name, obj) => fs.writeFileSync(path.join(ops, name), typeof obj === 'string' ? obj : JSON.stringify(obj), { mode: 0o600 });
  const nodeCalls = path.join(root, 'node-was-called');
  // "no Node on the host": a `node` that records the call and fails, found before anything else
  const noNode = { 'BASH_FUNC_node%%': `() { echo called >> '${posix(nodeCalls)}'; return 127; }` };
  const check = (args = [], env = {}) => spawnSync('bash', ['-c', `cd / && env -i PATH=/usr/bin:/bin HOME=/nonexistent ${Object.entries({ ...noNode, ...env }).map(([k, v]) => `'${k}=${v}'`).join(' ')} bash '${posix(path.join(root, 'scripts/ops-check.sh'))}' ${args.join(' ')}`], { encoding: 'utf8' });
  return { root, ops, put, check, nodeCalled: () => fs.existsSync(nodeCalls) };
}
const okBackup = (ageMs = 5 * H) => ({ at: iso(ageMs), ok: true, file: 'a.enc', secretInArchive: 'yes' });
const okRestore = (ageMs = 3 * D) => ({ at: iso(ageMs), ok: true, users: 28, states: 28 });

test('ops-check: on a host without node, healthy status files = exit 0, "ops-check: ok", node never called', opts, () => {
  const s = server(); s.put('backup-status.json', okBackup()); s.put('restore-status.json', okRestore());
  const r = s.check(['0']);
  assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /ops-check: ok/); assert.ok(!/ALARM|note:/.test(r.stdout));
  assert.equal(s.nodeCalled(), false, 'no dependency on a node binary');
  rm(s.root);
});

test('ops-check: reads the files exactly as the backup / rehearsal scripts write them (real-looking JSON with extra fields)', opts, () => {
  const s = server();
  s.put('backup-status.json', `{"at":"${iso(2 * H)}","ok":true,"seconds":41,"file":"2jfitness-2026-10-10_031702.tar.gz.enc","bytes":"1234567","sha256":"${'a'.repeat(64)}","remote":"rclone","secretInArchive":"yes","remoteKeep":"30"}\n`);
  s.put('restore-status.json', `{"at":"${iso(1 * D)}","ok":true,"seconds":9,"file":"x.enc","users":28,"states":28,"boot":false,"verifySeconds":3,"restoreSeconds":2,"validateSeconds":1}\n`);
  const r = s.check(['0']); assert.equal(r.status, 0, r.stdout); assert.match(r.stdout, /ops-check: ok/);
  rm(s.root);
});

test('ops-check: backup never ran, stale (> 36 h) and failed are alarms; a fresh one just under 36 h is fine', opts, () => {
  const s = server(); s.put('restore-status.json', okRestore());
  let r = s.check(['0']); assert.equal(r.status, 1); assert.match(r.stdout, /ALARM: backup: never ran/);
  s.put('backup-status.json', okBackup(40 * H)); r = s.check(['0']); assert.equal(r.status, 1); assert.match(r.stdout, /ALARM: backup: last success is older than 36 h/);
  s.put('backup-status.json', okBackup(35 * H)); r = s.check(['0']); assert.equal(r.status, 0, r.stdout);
  s.put('backup-status.json', { at: iso(1 * H), ok: false, reason: 'upload_failed', stage: 'upload', exit: '1' });
  r = s.check(['0']); assert.equal(r.status, 1); assert.match(r.stdout, /ALARM: backup: last run FAILED \(upload_failed at upload,/);
  s.put('backup-status.json', 'not json at all'); r = s.check(['0']); assert.equal(r.status, 1, 'garbage is never read as a healthy backup');
  assert.equal(s.nodeCalled(), false);
  rm(s.root);
});

test('ops-check: a failed restore rehearsal is an alarm; "due" (> 100 days) and "never done" are only notes', opts, () => {
  const s = server(); s.put('backup-status.json', okBackup());
  let r = s.check(['0']); assert.equal(r.status, 0, r.stdout); assert.match(r.stdout, /note: restore rehearsal: never done/); assert.ok(!/ALARM/.test(r.stdout));
  s.put('restore-status.json', okRestore(101 * D)); r = s.check(['0']); assert.equal(r.status, 0, r.stdout); assert.match(r.stdout, /note: restore rehearsal: due \(/); assert.ok(!/ALARM/.test(r.stdout));
  s.put('restore-status.json', okRestore(99 * D)); r = s.check(['0']); assert.equal(r.status, 0); assert.ok(!/note:/.test(r.stdout));
  s.put('restore-status.json', { at: iso(1 * H), ok: false, stage: 'validate', exit: '8' });
  r = s.check(['0']); assert.equal(r.status, 1); assert.match(r.stdout, /ALARM: restore rehearsal: last run FAILED \(validate,/);
  rm(s.root);
});

test('ops-check: low disk is an alarm (threshold argument), and data/ops mode 700 / files 600 is read fine by its owner', opts, () => {
  const s = server(); s.put('backup-status.json', okBackup()); s.put('restore-status.json', okRestore());
  const r = s.check(['101']); assert.equal(r.status, 1); assert.match(r.stdout, /ALARM: disk: \d+% free/);
  if (process.platform !== 'win32') { const mode = fs.statSync(s.ops).mode & 0o777; assert.equal(mode, 0o700); }
  assert.equal(s.check(['0']).status, 0);
  rm(s.root);
});

test('ops-check: a status file its user cannot read is reported as such, not as "never ran"', opts, t => {
  const s = server(); s.put('backup-status.json', okBackup());
  fs.chmodSync(path.join(s.ops, 'backup-status.json'), 0o000);
  let readable = true; try { fs.readFileSync(path.join(s.ops, 'backup-status.json')); } catch { readable = false; }
  const r = s.check(['0']);
  if (readable) {        // root, or a platform that does not enforce modes (Windows): the file is simply read, and it is healthy — never "never ran"
    assert.equal(r.status, 0, r.stdout); assert.ok(!/never ran|not readable/.test(r.stdout));
  } else {
    assert.equal(r.status, 1); assert.match(r.stdout, /not readable by this user/); assert.ok(!/never ran/.test(r.stdout));
  }
  fs.chmodSync(path.join(s.ops, 'backup-status.json'), 0o600); rm(s.root);
});

test('ops-check alert hook: works from cron\'s bare environment; --alert-test without a provider says so (exit 2), with one it sends', opts, () => {
  const s = server(); const log = path.join(s.root, 'alerts.log');
  const hook = path.join(s.root, 'hook.sh');
  fs.writeFileSync(hook, `printf '%s|%s\\n' "$OPS_ALERT_STATUS" "$1" >> '${posix(log)}'\n`);
  const cmd = `bash ${posix(hook)} "$1"`;                 // the message is $1 of the command, as documented
  assert.equal(s.check(['0']).status, 1, 'no data: alarm, no provider needed');
  const none = s.check(['--alert-test']); assert.equal(none.status, 2); assert.match(none.stderr, /OPS_ALERT_COMMAND is not set/);
  const sent = s.check(['--alert-test'], { OPS_ALERT_COMMAND: cmd }); assert.equal(sent.status, 0, sent.stderr); assert.match(sent.stdout, /test alert sent/);
  assert.match(fs.readFileSync(log, 'utf8'), /^test\|This is a test/m);
  const broken = s.check(['--alert-test'], { OPS_ALERT_COMMAND: 'exit 7' }); assert.equal(broken.status, 1); assert.match(broken.stderr, /test alert FAILED/); assert.ok(!/test alert sent/.test(broken.stdout), 'a failing provider is never reported as sent');
  const alarm = s.check(['0'], { OPS_ALERT_COMMAND: cmd }); assert.equal(alarm.status, 1);
  assert.match(fs.readFileSync(log, 'utf8'), /^alarm\|ALARM: backup: never ran/m);
  rm(s.root);
});

/* ---------- install-ops-cron.sh ---------- */
function cronHost() {
  const s = server();
  const etc = path.join(s.root, 'etc'); fs.mkdirSync(etc);
  fs.writeFileSync(path.join(etc, '2j-ops.env'), 'BACKUP_PASSPHRASE_FILE=/root/.2j-backup-pass\nBACKUP_REMOTE=rclone:2jbackup:2j-fitness-backups\nBACKUP_DIR=/var/backups/2j\n', { mode: 0o600 });
  const store = path.join(s.root, 'crontab.txt');
  const fake = path.join(s.root, 'fake-crontab.sh');
  fs.writeFileSync(fake, `#!/bin/bash\nS='${posix(store)}'\nif [ "$1" = "-l" ]; then [ -f "$S" ] && cat "$S" || { echo "no crontab for root" >&2; exit 1; }; else cat > "$S"; fi\n`, { mode: 0o755 });
  const install = (args = [], env = {}) => spawnSync('bash', [posix(path.join(s.root, 'scripts/install-ops-cron.sh')), ...args], { encoding: 'utf8', env: { ...process.env, OPS_ETC_DIR: posix(etc), OPS_CRONTAB_CMD: posix(fake), OPS_APP_DIR: '/opt/2jfitness', ...env } });
  return { ...s, etc, store, install, tab: () => (fs.existsSync(store) ? fs.readFileSync(store, 'utf8') : ''), lr: () => fs.readFileSync(path.join(etc, 'logrotate.d/2j-ops'), 'utf8') };
}

test('install-ops-cron: installs one managed block (backup 03:17, ops-check every 30 min) and the logrotate config; no secrets', opts, () => {
  const h = cronHost();
  const r = h.install(); assert.equal(r.status, 0, r.stderr + r.stdout); assert.match(r.stdout, /crontab updated, logrotate updated/);
  const tab = h.tab();
  assert.equal(tab.match(/^17 3 \* \* \* cd \/opt\/2jfitness && set -a && \. [^ ]+2j-ops\.env && set \+a && scripts\/backup-offsite\.sh >> \/var\/log\/2j-backup\.log 2>&1$/gm).length, 1);
  assert.equal(tab.match(/^\*\/30 \* \* \* \* cd \/opt\/2jfitness && .*scripts\/ops-check\.sh >> \/var\/log\/2j-ops-check\.log 2>&1$/gm).length, 1);
  assert.ok(tab.includes('# BEGIN 2j-ops') && tab.includes('# END 2j-ops') && tab.includes('SHELL=/bin/bash'));
  for (const secret of ['rclone:2jbackup', 'passphrase', '2j-backup-pass', 'WEBHOOK']) assert.equal(tab.toLowerCase().includes(secret.toLowerCase()), false, 'nothing from the env file in the crontab: ' + secret);
  const lr = h.lr();
  for (const line of ['/var/log/2j-*.log {', '  su root root', '  weekly', '  rotate 8', '  compress', '  missingok', '  notifempty', '}']) assert.ok(lr.split('\n').includes(line), 'logrotate has: ' + line);
  rm(h.root);
});

test('install-ops-cron: idempotent, and it replaces the hand-made lines without touching anything else', opts, () => {
  const h = cronHost();
  fs.writeFileSync(h.store, [
    'SHELL=/bin/bash', '0 4 * * * /usr/bin/something-else --keep',
    '17 3 * * * cd /opt/2jfitness && set -a && . /etc/2j-ops.env && set +a && scripts/backup-offsite.sh >> /var/log/2j-backup.log 2>&1',
    '*/30 * * * * cd /opt/2jfitness && set -a && . /etc/2j-ops.env && set +a && scripts/ops-check.sh >> /var/log/2j-ops-check.log 2>&1', ''].join('\n'));
  assert.equal(h.install().status, 0);
  const first = h.tab();
  assert.equal((first.match(/scripts\/backup-offsite\.sh/g) || []).length, 1, 'nothing runs twice'); assert.equal((first.match(/scripts\/ops-check\.sh/g) || []).length, 1);
  assert.ok(first.includes('0 4 * * * /usr/bin/something-else --keep'), 'unrelated jobs untouched');
  const again = h.install(); assert.equal(again.status, 0); assert.match(again.stdout, /crontab unchanged, logrotate unchanged/);
  assert.equal(h.tab(), first, 'a second run changes nothing');
  assert.equal((h.tab().match(/# BEGIN 2j-ops/g) || []).length, 1);
  rm(h.root);
});

test('install-ops-cron: refuses without /etc/2j-ops.env or without its two required settings, and without root; --print changes nothing', opts, () => {
  const h = cronHost();
  fs.writeFileSync(path.join(h.etc, '2j-ops.env'), 'BACKUP_DIR=/var/backups/2j\n');
  const incomplete = h.install(); assert.equal(incomplete.status, 3); assert.match(incomplete.stderr, /does not define BACKUP_PASSPHRASE_FILE/);
  fs.rmSync(path.join(h.etc, '2j-ops.env'));
  const missing = h.install(); assert.equal(missing.status, 3); assert.match(missing.stderr, /2j-ops\.env is missing/);
  assert.equal(h.tab(), '', 'nothing installed on failure');
  const print = h.install(['--print']); assert.equal(print.status, 0); assert.match(print.stdout, /BEGIN 2j-ops/); assert.equal(h.tab(), '');
  if (spawnSync('bash', ['-c', 'id -u'], { encoding: 'utf8' }).stdout.trim() !== '0') {
    const noRoot = spawnSync('bash', [posix(path.join(h.root, 'scripts/install-ops-cron.sh'))], { encoding: 'utf8', env: { ...process.env, OPS_ETC_DIR: '', OPS_CRONTAB_CMD: 'false' } });
    assert.equal(noRoot.status, 2); assert.match(noRoot.stderr, /run as root/);
  }
  rm(h.root);
});

test('both ops scripts pass a shell syntax check', opts, () => {
  for (const s of ['ops-check.sh', 'install-ops-cron.sh']) assert.equal(spawnSync('bash', ['-n', posix(path.join(repo, 'scripts', s))]).status, 0, s);
});

/* ---------- ops-alert.sh: the reference alert command (webhook / mail from /etc/2j-alert.conf, owner-provided) ---------- */
test('ops-alert.sh: always logs; sends to the webhook and mail the owner configured; a failed delivery exits 1; nothing configured exits 0', opts, () => {
  const s = server(); const calls = path.join(s.root, 'calls.log'); const log = path.join(s.root, 'alerts.log');
  fs.copyFileSync(path.join(repo, 'scripts/ops-alert.sh'), path.join(s.root, 'scripts/ops-alert.sh'));
  const conf = path.join(s.root, '2j-alert.conf'); fs.writeFileSync(conf, 'ALERT_WEBHOOK_URL=https://hooks.example.invalid/x\nALERT_MAIL_TO=owner@example.invalid\n', { mode: 0o600 });
  const shim = (name, rc = 0) => ({ [`BASH_FUNC_${name}%%`]: `() { echo "${name} $*" >> ${posix(calls)}; return ${rc}; }` });
  const run = (extra = {}, msg = 'ALARM: backup: never ran') => spawnSync('bash', [posix(path.join(s.root, 'scripts/ops-alert.sh')), msg], { encoding: 'utf8', env: { ...process.env, OPS_ALERT_CONF: posix(conf), OPS_ALERT_LOG: posix(log), OPS_ALERT_STATUS: 'alarm', OPS_ALERT_SUBJECT: '2J ops ALARM', ...shim('curl'), ...shim('mail'), ...extra } });
  const ok = run(); assert.equal(ok.status, 0, ok.stderr);
  const c = fs.readFileSync(calls, 'utf8');
  assert.match(c, /curl .*status=alarm .*message=ALARM: backup: never ran .*https:\/\/hooks\.example\.invalid\/x/); assert.match(c, /mail -s 2J ops ALARM owner@example\.invalid/);
  assert.match(fs.readFileSync(log, 'utf8'), /\[alarm\] 2J ops ALARM: ALARM: backup: never ran/);
  assert.equal(run(shim('curl', 22)).status, 1, 'a failed webhook is reported so ops-check retries');
  fs.writeFileSync(conf, ''); fs.rmSync(calls);
  assert.equal(run().status, 0); assert.equal(fs.existsSync(calls), false, 'nothing configured: only the local log');
  rm(s.root);
});

test('ops-check: with /etc/2j-alert.conf present and no OPS_ALERT_COMMAND it uses the shipped reference command; without it, --alert-test says so', opts, () => {
  const s = server(); const calls = path.join(s.root, 'calls.log');
  fs.copyFileSync(path.join(repo, 'scripts/ops-alert.sh'), path.join(s.root, 'scripts/ops-alert.sh'));
  const conf = path.join(s.root, '2j-alert.conf'); fs.writeFileSync(conf, 'ALERT_WEBHOOK_URL=https://hooks.example.invalid/y\n', { mode: 0o600 });
  const env = { OPS_ALERT_CONF: posix(conf), OPS_ALERT_LOG: posix(path.join(s.root, 'a.log')), 'BASH_FUNC_curl%%': `() { echo "curl $*" >> ${posix(calls)}; return 0; }` };
  const sent = s.check(['--alert-test'], env); assert.equal(sent.status, 0, sent.stderr); assert.match(sent.stdout, /test alert sent/);
  assert.match(fs.readFileSync(calls, 'utf8'), /message=This is a test of the 2J ops alert command\. .*https:\/\/hooks\.example\.invalid\/y/);
  const none = s.check(['--alert-test'], { OPS_ALERT_CONF: posix(path.join(s.root, 'does-not-exist.conf')) }); assert.equal(none.status, 2);
  rm(s.root);
});
