import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/* The ops scripts themselves: shell syntax, the exact variable names they read, every offsite backend (local, scp, rclone) with fake transports
 * (no external traffic), and the configurable Node of the restore rehearsal. */
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const posix = p => p.split(path.sep).join('/');
const hasBash = spawnSync('bash', ['-c', 'command -v openssl tar gzip sha256sum >/dev/null']).status === 0;
const opts = { skip: hasBash ? false : 'bash/openssl not available' };
const rm = d => fs.rmSync(d, { recursive: true, force: true });
const OPS_SCRIPTS = ['backup-data.sh', 'backup-offsite.sh', 'restore-backup.sh', 'restore-rehearsal.sh', 'ops-check.sh', 'mark-deploy.sh', 'disk-check.sh'];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '2j-opsx-'));
  fs.mkdirSync(path.join(root, 'scripts')); fs.mkdirSync(path.join(root, 'data'));
  for (const f of ['backup-data.sh', 'backup-offsite.sh', 'restore-backup.sh']) fs.copyFileSync(path.join(repo, 'scripts', f), path.join(root, 'scripts', f));
  fs.writeFileSync(path.join(root, 'data', 'secret'), 's'.repeat(64));
  fs.writeFileSync(path.join(root, 'data', 'db.json'), JSON.stringify({ users: [{ id: 'u1', name: 'Ana' }], creds: [], subs: [], invites: [], recoveries: [] }));
  fs.writeFileSync(path.join(root, 'data', 'state-u1.json'), JSON.stringify({ unit: 'kg', workouts: [] }));
  const pass = path.join(root, 'pass.txt'); fs.writeFileSync(pass, 'correct horse battery staple\n', { mode: 0o600 });
  const ops = path.join(root, 'data', 'ops');
  const env = { ...process.env, BACKUP_PASSPHRASE_FILE: posix(pass), BACKUP_DIR: 'out', BACKUP_MIN_FREE_MB: '1', BACKUP_SKIP_MODE_CHECK: '1' };
  const run = (script, args = [], extra = {}) => spawnSync('bash', [posix(path.join(root, 'scripts', script)), ...args], { cwd: root, env: { ...env, ...extra }, encoding: 'utf8' });
  const status = n => JSON.parse(fs.readFileSync(path.join(ops, n), 'utf8'));
  const rehearse = (enc, args = [], extra = {}) => spawnSync('bash', [posix(path.join(repo, 'scripts', 'restore-rehearsal.sh')), ...args, posix(enc)], { cwd: root, env: { ...env, OPS_DIR: posix(ops), ...extra }, encoding: 'utf8' });
  return { root, ops, run, status, rehearse };
}

test('every ops script passes a shell syntax check', opts, () => {
  for (const s of OPS_SCRIPTS) {
    const r = spawnSync('bash', ['-n', posix(path.join(repo, 'scripts', s))], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${s}: ${r.stderr}`);
  }
});

test('the scripts only use the documented variable names (BACKUPPASSPHRASE_FILE or BACKUP_REMOT would fail here)', () => {
  const known = new Set(['BACKUP_PASSPHRASE_FILE', 'BACKUP_REMOTE', 'BACKUP_REMOTE_KEEP', 'BACKUP_DIR', 'BACKUP_KEEP_DAYS', 'BACKUP_MIN_FREE_MB', 'BACKUP_SKIP_MODE_CHECK']);
  for (const s of OPS_SCRIPTS) {
    const src = fs.readFileSync(path.join(repo, 'scripts', s), 'utf8');
    for (const name of new Set(src.match(/\bBACKUP[A-Z_]*\b/g) || [])) assert.ok(known.has(name), `${s} uses an undocumented variable: ${name}`);
  }
  const offsite = fs.readFileSync(path.join(repo, 'scripts/backup-offsite.sh'), 'utf8');
  for (const must of ['BACKUP_PASSPHRASE_FILE', 'BACKUP_REMOTE', 'BACKUP_REMOTE_KEEP', 'BACKUP_DIR', 'BACKUP_KEEP_DAYS', 'BACKUP_MIN_FREE_MB']) assert.ok(offsite.includes(must), `backup-offsite.sh no longer mentions ${must}`);
  assert.ok(!/\$\([A-Z_]+ *[-+*]/.test(offsite), 'arithmetic must be $((…)), never $(NAME + 1)');
  assert.equal(offsite.split('tail -n +$((REMOTE_KEEP + 1))').length - 1, 3, 'all three retention branches use a valid arithmetic expansion');
});

test('a mistyped variable name is reported as missing configuration (what the typos would have done)', opts, () => {
  const f = fixture();
  const noPass = f.run('backup-offsite.sh', [], { BACKUP_PASSPHRASE_FILE: undefined, BACKUPPASSPHRASE_FILE: 'x', BACKUP_REMOTE: '/tmp/x' });
  assert.equal(noPass.status, 2); assert.match(noPass.stderr, /BACKUP_PASSPHRASE_FILE is not set/);
  const noRemote = f.run('backup-offsite.sh', [], { BACKUP_REMOT: '/tmp/x' });
  assert.equal(noRemote.status, 2); assert.match(noRemote.stderr, /BACKUP_REMOTE is not set/);
  rm(f.root);
});

// Fake transports: bash functions exported through the environment are found before any real scp / ssh / rclone and keep everything in a temp dir.
function transports(f) {
  const dir = path.join(f.root, 'fake'); fs.mkdirSync(dir, { recursive: true });
  const w = (n, body) => fs.writeFileSync(path.join(dir, n), body, { mode: 0o755 });
  w('scp.sh', [
    '#!/bin/bash',
    'args=(); while [ $# -gt 0 ]; do case "$1" in -q) ;; -o) shift ;; *) args+=("$1") ;; esac; shift; done',
    'dest="${args[-1]}"; unset "args[-1]"; target="$FAKE_ROOT${dest#*:}"; mkdir -p "$target"',
    'for a in "${args[@]}"; do cp "$a" "$target/"; done',
    'if [ -n "${FAKE_CORRUPT:-}" ]; then for x in "$target"/*.enc; do printf X >> "$x"; done; fi',
    'exit 0', ''].join('\n'));
  w('ssh.sh', [
    '#!/bin/bash',
    'while [ "$1" = "-o" ]; do shift 2; done',
    'shift; cmd="$(printf "%s" "$1" | sed "s#cd \'/#cd \'$FAKE_ROOT/#")"; exec bash -c "$cmd"', ''].join('\n'));
  w('rclone.sh', [
    '#!/bin/bash',
    'map() { echo "$FAKE_ROOT/rclone/${1#*:}"; }',
    'cmd="$1"; shift',
    'case "$cmd" in',
    '  copyto) mkdir -p "$(dirname "$(map "$2")")"; cp "$1" "$(map "$2")"',
    '          if [ -n "${FAKE_CORRUPT:-}" ]; then case "$2" in *.enc) printf X >> "$(map "$2")" ;; esac; fi ;;',
    '  check)  a="$1"; b="$2"; name=""; while [ $# -gt 0 ]; do [ "$1" = "--include" ] && name="$2"; shift; done',
    '          cmp -s "$a/$name" "$(map "$b")/$name" ;;',
    '  lsf)    ls -1 "$(map "$1")" 2>/dev/null | grep -E "^2jfitness-.*[.]tar[.]gz[.]enc$" || true ;;',
    '  deletefile) rm -f "$(map "$1")" ;;',
    '  *) echo "fake rclone: unsupported $cmd" >&2; exit 64 ;;',
    'esac', ''].join('\n'));
  const fn = n => `() { bash '${posix(path.join(dir, n + '.sh'))}' "$@"; }`;
  return { FAKE_ROOT: posix(path.join(f.root, 'fakeremote')), 'BASH_FUNC_scp%%': fn('scp'), 'BASH_FUNC_ssh%%': fn('ssh'), 'BASH_FUNC_rclone%%': fn('rclone') };
}

const BACKENDS = {
  local: { remote: f => posix(path.join(f.root, 'remote')), dir: f => path.join(f.root, 'remote'), label: 'remote' },
  scp: { remote: () => 'fakehost:/srv/bk', dir: f => path.join(f.root, 'fakeremote/srv/bk'), label: 'fakehost' },
  rclone: { remote: () => 'rclone:fake:bucket', dir: f => path.join(f.root, 'fakeremote/rclone/bucket'), label: 'rclone' },
};
const seedOld = dir => {
  fs.mkdirSync(dir, { recursive: true });
  [1, 2, 3].forEach(i => {
    const n = path.join(dir, `2jfitness-2020-01-0${i}_000000.tar.gz.enc`);
    fs.writeFileSync(n, 'old' + i); fs.writeFileSync(n + '.sha256', 'x');
    const t = new Date(Date.UTC(2020, 0, i)); fs.utimesSync(n, t, t);
  });
};

for (const [kind, b] of Object.entries(BACKENDS)) {
  test(`offsite backend "${kind}": uploads, verifies at the destination, keeps only the newest N, status ok`, opts, () => {
    const f = fixture(); const t = transports(f);
    seedOld(b.dir(f));
    const r = f.run('backup-offsite.sh', [], { ...t, BACKUP_REMOTE: b.remote(f), BACKUP_REMOTE_KEEP: '2' });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const s = f.status('backup-status.json');
    assert.equal(s.ok, true); if (kind !== 'local') assert.equal(s.remote, b.label);
    const enc = fs.readdirSync(b.dir(f)).filter(x => x.endsWith('.tar.gz.enc'));
    assert.equal(enc.length, 2, enc.join(','));
    assert.ok(enc.includes('2jfitness-2020-01-03_000000.tar.gz.enc') && !enc.includes('2jfitness-2020-01-01_000000.tar.gz.enc'));
    const fresh = enc.find(x => !x.startsWith('2jfitness-2020'));
    assert.ok(fs.existsSync(path.join(b.dir(f), fresh + '.sha256')), 'the checksum travelled with it');
    assert.equal(fs.readFileSync(path.join(b.dir(f), fresh)).subarray(0, 8).toString(), 'Salted__', 'only ciphertext at the destination');
    rm(f.root);
  });
}

for (const kind of ['scp', 'rclone']) {
  test(`offsite backend "${kind}": a copy that arrives damaged is an integrity failure`, opts, () => {
    const f = fixture(); const t = transports(f);
    const r = f.run('backup-offsite.sh', [], { ...t, BACKUP_REMOTE: BACKENDS[kind].remote(f), FAKE_CORRUPT: '1' });
    assert.notEqual(r.status, 0, r.stdout);
    const s = f.status('backup-status.json');
    assert.deepEqual([s.ok, s.reason], [false, 'remote_integrity_failed']);
    rm(f.root);
  });
}

test('offsite: rclone selected but not installed is a configuration error, not a crash mid-run', opts, () => {
  const f = fixture();
  const r = f.run('backup-offsite.sh', [], { BACKUP_REMOTE: 'rclone:fake:bucket', 'BASH_FUNC_command%%': '() { if [ "$1" = -v ] && [ "$2" = rclone ]; then return 1; fi; builtin command "$@"; }' });
  assert.equal(r.status, 2); assert.match(r.stderr, /rclone is not installed/);
  assert.equal(f.status('backup-status.json').reason, 'rclone_missing');
  rm(f.root);
});

/* ---------- restore rehearsal: configurable Node (a host without node borrows one from a throw-away container) ---------- */
function nodeShim(f) {
  const log = path.join(f.root, 'node-calls.log'), shim = path.join(f.root, 'node-shim.sh');
  fs.writeFileSync(shim, `#!/bin/bash\n[ "$1" = "--via-container" ] && shift\necho "$@" >> '${posix(log)}'\nexec node "$@"\n`, { mode: 0o755 });
  return { shim: posix(shim), calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '') };
}
const backupTo = f => {
  const remote = posix(path.join(f.root, 'remote'));
  assert.equal(f.run('backup-offsite.sh', [], { BACKUP_REMOTE: remote }).status, 0);
  return path.join(f.root, 'remote', fs.readdirSync(path.join(f.root, 'remote')).find(x => x.endsWith('.tar.gz.enc')));
};

test('rehearsal: NODE_COMMAND (several words) validates the throw-away copy only; the default stays "node"', opts, () => {
  const f = fixture(); const n = nodeShim(f); const enc = backupTo(f);
  const r = f.rehearse(enc, [], { NODE_COMMAND: `${n.shim} --via-container` });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(n.calls(), /validate-restore\.mjs .*2j-rehearsal\.[A-Za-z0-9]+\/data/, 'the configured Node validated the throw-away copy');
  assert.ok(!n.calls().includes(posix(path.join(f.root, 'data'))), 'never the live data directory');
  assert.equal(f.status('restore-status.json').ok, true);
  const plain = f.rehearse(enc);
  assert.equal(plain.status, 0, 'without NODE_COMMAND it still uses the node on PATH: ' + plain.stderr + plain.stdout);
  rm(f.root);
});

test('rehearsal: a Node that does not exist is a clear configuration error before anything is restored', opts, () => {
  const f = fixture(); const enc = backupTo(f);
  const r = f.rehearse(enc, [], { NODE_COMMAND: 'no-such-node-binary --flag' });
  assert.equal(r.status, 2); assert.match(r.stderr, /Node not found: no-such-node-binary/);
  const s = f.status('restore-status.json'); assert.deepEqual([s.ok, s.stage], [false, 'config']);
  rm(f.root);
});

/* ---------- restore-backup.sh --verify-only on a REAL-SIZE archive (pipefail + `grep -q` used to hit SIGPIPE: exit 6 on a good backup) ---------- */
function bigBackup(f) {
  // thousands of long names: the `tar -t` listing is far larger than a pipe buffer, so a reader that stops early breaks the writer
  const blob = path.join(f.root, 'data', 'uploads'); fs.mkdirSync(blob);
  for (let i = 0; i < 3000; i++) fs.writeFileSync(path.join(blob, `member-photo-${String(i).padStart(5, '0')}-${'x'.repeat(90)}.jpg`), 'img');
  return backupTo(f);
}

test('restore-backup --verify-only accepts a large valid backup (pipefail on) and never lists as "no data/"', opts, () => {
  const f = fixture(); const enc = bigBackup(f);
  for (let i = 0; i < 3; i++) {
    const r = f.run('restore-backup.sh', ['--verify-only', posix(enc)]);
    assert.equal(r.status, 0, `run ${i}: ${r.stderr}`);
    assert.match(r.stdout, /valid 2J data archive/);
  }
  const dest = path.join(f.root, 'restored'); const r = f.run('restore-backup.sh', [posix(enc), posix(dest)]);
  assert.equal(r.status, 0, r.stderr); assert.equal(fs.readdirSync(path.join(dest, 'data', 'uploads')).length, 3000);
  rm(f.root);
});

test('restore-backup --verify-only: an archive without data/ is exit 6, a wrong passphrase 5, damage 4 (checksum) or 5 (no checksum)', opts, () => {
  const f = fixture(); const enc = bigBackup(f);
  const other = path.join(f.root, 'other.txt'); fs.writeFileSync(other, 'nope\n');
  assert.equal(f.run('restore-backup.sh', ['--verify-only', posix(enc)], { BACKUP_PASSPHRASE_FILE: posix(other) }).status, 5);
  // a valid, encrypted tarball that simply has no data/ directory (same format as backup-offsite.sh produces)
  const stray = path.join(f.root, 'stray'); fs.mkdirSync(path.join(stray, 'notes'), { recursive: true }); fs.writeFileSync(path.join(stray, 'notes', 'a.txt'), 'a');
  const bad = path.join(f.root, 'remote', '2jfitness-nodata.tar.gz.enc');
  const mk = spawnSync('bash', ['-c', `tar czf - -C '${posix(stray)}' notes | openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -out '${posix(bad)}' -pass file:'${posix(path.join(f.root, 'pass.txt'))}'`], { encoding: 'utf8' });
  assert.equal(mk.status, 0, mk.stderr);
  const r6 = f.run('restore-backup.sh', ['--verify-only', posix(bad)]); assert.equal(r6.status, 6); assert.match(r6.stderr, /no data\//);
  const bytes = fs.readFileSync(enc); bytes[bytes.length - 9] ^= 0xff; fs.writeFileSync(enc, bytes);
  assert.equal(f.run('restore-backup.sh', ['--verify-only', posix(enc)]).status, 4, 'checksum sidecar catches it');
  fs.rmSync(enc + '.sha256');
  assert.equal(f.run('restore-backup.sh', ['--verify-only', posix(enc)]).status, 5, 'without a sidecar the decrypt/gzip check catches it');
  rm(f.root);
});
