// Tests for api/lib/webhook-security.js: SSRF guard, target URL rules, signature and secret at rest.
// Pure checks only: no network, no routes. See docs/WEBHOOKS_SECURITY_REVIEW.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

// The instance secret (used by lib/crypto.js) lives in a throwaway data dir.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), '2j-webhook-'));
// The server creates ./data/secret at boot; this test seeds the same file in its own dir.
fs.writeFileSync(path.join(process.env.DATA_DIR, 'secret'), crypto.randomBytes(32).toString('hex'));
const W = await import('../lib/webhook-security.js');

test('blocks private, loopback, link-local and metadata IPv4 addresses', () => {
  const blocked = ['0.0.0.0', '10.1.2.3', '127.0.0.1', '127.255.255.254', '100.64.0.1', '169.254.169.254',
    '172.16.0.1', '172.31.255.255', '192.168.1.1', '192.0.0.8', '198.18.0.1', '224.0.0.1', '240.0.0.1', '255.255.255.255'];
  for (const ip of blocked) assert.equal(W.isBlockedAddress(ip), true, ip);
});

test('allows ordinary public IPv4 addresses', () => {
  for (const ip of ['1.1.1.1', '8.8.8.8', '172.15.0.1', '172.32.0.1', '100.63.255.255', '93.184.216.34']) {
    assert.equal(W.isBlockedAddress(ip), false, ip);
  }
});

test('blocks loopback, unique-local, link-local, multicast and metadata IPv6 addresses', () => {
  const blocked = ['::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'febf::1', 'ff02::1', 'fd00:ec2::254', '2001:db8::1', '2001::1'];
  for (const ip of blocked) assert.equal(W.isBlockedAddress(ip), true, ip);
});

test('judges IPv4-mapped, NAT64 and 6to4 IPv6 by the IPv4 address they carry', () => {
  assert.equal(W.isBlockedAddress('::ffff:127.0.0.1'), true);
  assert.equal(W.isBlockedAddress('::ffff:7f00:1'), true);
  assert.equal(W.isBlockedAddress('::ffff:10.0.0.5'), true);
  assert.equal(W.isBlockedAddress('::ffff:169.254.169.254'), true);
  assert.equal(W.isBlockedAddress('64:ff9b::a9fe:a9fe'), true);   // NAT64 of 169.254.169.254
  assert.equal(W.isBlockedAddress('2002:7f00:0001::1'), true);   // 6to4 of 127.0.0.1
  assert.equal(W.isBlockedAddress('::ffff:8.8.8.8'), false);
  assert.equal(W.isBlockedAddress('2606:4700:4700::1111'), false);
});

test('unknown or malformed addresses count as blocked', () => {
  for (const ip of ['', 'not-an-ip', '999.1.1.1', undefined, null, 'fe80::1::2']) assert.equal(W.isBlockedAddress(ip), true, String(ip));
});

test('target URL: only https on the standard port, without credentials or local names', () => {
  assert.equal(W.validateWebhookUrl('https://hooks.example.com/in/abc').ok, true);
  assert.equal(W.validateWebhookUrl('https://hooks.example.com:443/x').ok, true);
  assert.equal(W.validateWebhookUrl('http://hooks.example.com/x').code, 'WEBHOOK_URL_NOT_HTTPS');
  assert.equal(W.validateWebhookUrl('ftp://hooks.example.com/x').code, 'WEBHOOK_URL_NOT_HTTPS');
  assert.equal(W.validateWebhookUrl('https://user:pw@hooks.example.com/x').code, 'WEBHOOK_URL_CREDENTIALS');
  assert.equal(W.validateWebhookUrl('https://hooks.example.com:8443/x').code, 'WEBHOOK_URL_PORT');
  assert.equal(W.validateWebhookUrl('https://localhost/x').code, 'WEBHOOK_URL_HOST');
  assert.equal(W.validateWebhookUrl('https://nas.local/x').code, 'WEBHOOK_URL_HOST');
  assert.equal(W.validateWebhookUrl('https://api.internal/x').code, 'WEBHOOK_URL_HOST');
  assert.equal(W.validateWebhookUrl('not a url').code, 'WEBHOOK_URL_INVALID');
});

test('target URL: private IP literals are refused, including obfuscated forms the URL parser normalises', () => {
  assert.equal(W.validateWebhookUrl('https://127.0.0.1/x').code, 'WEBHOOK_TARGET_PRIVATE');
  assert.equal(W.validateWebhookUrl('https://169.254.169.254/latest/meta-data').code, 'WEBHOOK_TARGET_PRIVATE');
  assert.equal(W.validateWebhookUrl('https://[::1]/x').code, 'WEBHOOK_TARGET_PRIVATE');
  assert.equal(W.validateWebhookUrl('https://0x7f.1/x').code, 'WEBHOOK_TARGET_PRIVATE');
  assert.equal(W.validateWebhookUrl('https://2130706433/x').code, 'WEBHOOK_TARGET_PRIVATE');
});

test('DNS: refuses the target when any resolved address is private (rebinding and mixed answers)', async () => {
  const onlyPublic = async () => [{ address: '93.184.216.34', family: 4 }];
  assert.deepEqual(await W.resolvePublicAddresses('hooks.example.com', onlyPublic), ['93.184.216.34']);

  const mixed = async () => [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.7', family: 4 }];
  await assert.rejects(W.resolvePublicAddresses('hooks.example.com', mixed), { code: 'WEBHOOK_TARGET_PRIVATE' });

  const metadata = async () => [{ address: '169.254.169.254', family: 4 }];
  await assert.rejects(W.resolvePublicAddresses('hooks.example.com', metadata), { code: 'WEBHOOK_TARGET_PRIVATE' });

  const empty = async () => [];
  await assert.rejects(W.resolvePublicAddresses('hooks.example.com', empty), { code: 'WEBHOOK_DNS_EMPTY' });

  await assert.rejects(W.resolvePublicAddresses('127.0.0.1'), { code: 'WEBHOOK_TARGET_PRIVATE' });
});

test('signature: a valid header verifies and matches the documented format', () => {
  const secret = W.generateWebhookSecret();
  const body = '{"event":"workout.finished","eventId":"e1"}';
  const header = W.signWebhook({ secret, body, timestamp: 1_700_000_000 });
  assert.match(header, /^t=1700000000,v1=[0-9a-f]{64}$/);
  assert.deepEqual(W.verifyWebhookSignature({ secret, header, body, now: 1_700_000_100 }), { ok: true });
});

test('signature: a changed body, a wrong secret or a stale timestamp is rejected', () => {
  const secret = W.generateWebhookSecret();
  const body = '{"event":"workout.finished"}';
  const header = W.signWebhook({ secret, body, timestamp: 1_700_000_000 });
  assert.equal(W.verifyWebhookSignature({ secret, header, body: body + ' ', now: 1_700_000_000 }).reason, 'mismatch');
  assert.equal(W.verifyWebhookSignature({ secret: W.generateWebhookSecret(), header, body, now: 1_700_000_000 }).reason, 'mismatch');
  assert.equal(W.verifyWebhookSignature({ secret, header, body, now: 1_700_000_000 + 301 }).reason, 'stale');
  assert.equal(W.verifyWebhookSignature({ secret, header, body, now: 1_700_000_000 - 301 }).reason, 'stale');
});

test('signature: a replayed request outside the window is rejected, malformed headers too', () => {
  const secret = W.generateWebhookSecret();
  const body = '{}';
  const header = W.signWebhook({ secret, body, timestamp: 1_700_000_000 });
  // The same captured request, replayed an hour later.
  assert.equal(W.verifyWebhookSignature({ secret, header, body, now: 1_700_003_600 }).ok, false);
  assert.equal(W.verifyWebhookSignature({ secret, header: 'v1=abc', body, now: 1_700_000_000 }).reason, 'malformed');
  assert.equal(W.verifyWebhookSignature({ secret, header: undefined, body, now: 1_700_000_000 }).reason, 'malformed');
});

test('secret: generated with a prefix and enough entropy, never equal across calls', () => {
  const a = W.generateWebhookSecret(), b = W.generateWebhookSecret();
  assert.match(a, /^whsec_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, b);
});

test('secret at rest: stored encrypted, decrypts back, and the plain value is not in the blob', () => {
  const secret = W.generateWebhookSecret();
  const blob = W.encryptWebhookSecret(secret);
  assert.equal(typeof blob, 'string');
  assert.ok(!blob.includes(secret));
  assert.ok(!blob.includes(secret.slice(6)));
  assert.equal(W.decryptWebhookSecret(blob), secret);
  assert.equal(W.decryptWebhookSecret('AAAA'), null);
  assert.equal(W.decryptWebhookSecret(undefined), null);
});
