import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFingerprint, applyTo } from '../../scripts/android-release-hashes.mjs';
import { expectedOrigins } from '../lib/webauthn-origins.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEBUG = '0C:BB:BF:6F:26:C1:0C:83:23:54:2C:93:AE:B3:E6:19:44:D2:92:46:56:0A:F8:9D:A6:85:36:0F:7A:83:5E:AC';
const RELEASE = 'A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90:A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90';

test('fingerprint → base64url hash matches the hash already trusted for the debug key', () => {
  assert.equal(parseFingerprint(DEBUG).hash, 'DLu_bybBDIMjVCyTrrPmGUTSkkZWCvidpoU2D3qDXqw');
  assert.equal(parseFingerprint('sha256: ' + DEBUG.toLowerCase()).colon, DEBUG);
  assert.throws(() => parseFingerprint('0C:BB'), /SHA-256/);
  assert.throws(() => parseFingerprint('*'), /SHA-256/);
});

test('--apply adds the release fingerprint and origin once, keeps the debug ones, and the server then accepts exactly them', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), '2j-assetlinks-'));
  fs.mkdirSync(path.join(tmp, 'frontend/public/.well-known'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'api/lib'), { recursive: true });
  fs.copyFileSync(path.join(root, 'frontend/public/.well-known/assetlinks.json'), path.join(tmp, 'frontend/public/.well-known/assetlinks.json'));
  fs.copyFileSync(path.join(root, 'api/lib/webauthn-origins.js'), path.join(tmp, 'api/lib/webauthn-origins.js'));
  const fp = parseFingerprint(RELEASE);
  assert.equal(applyTo(tmp, fp), true);
  assert.equal(applyTo(tmp, fp), false, 'idempotent');
  const links = JSON.parse(fs.readFileSync(path.join(tmp, 'frontend/public/.well-known/assetlinks.json'), 'utf8'));
  assert.deepEqual(links[0].target.sha256_cert_fingerprints, [DEBUG, RELEASE]);
  assert.match(fs.readFileSync(path.join(tmp, 'api/lib/webauthn-origins.js'), 'utf8'), new RegExp(fp.hash));
  const origins = expectedOrigins('https://app.2jfitnesscenter.com', fp.hash);
  assert.ok(origins.includes('android:apk-key-hash:' + fp.hash));
  assert.ok(!origins.some(o => o.includes('*')));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('Android project: release signing is external, nothing secret is committed, app data is not auto-backed up', () => {
  const gradle = fs.readFileSync(path.join(root, 'frontend/android/app/build.gradle'), 'utf8');
  assert.match(gradle, /keystore\.properties/);
  assert.match(gradle, /2J_KEYSTORE_PASSWORD/);
  assert.doesNotMatch(gradle, /^\s*(storePassword|keyPassword)\s+['"][^'"]+['"]/m, 'no literal password');
  const manifest = fs.readFileSync(path.join(root, 'frontend/android/app/src/main/AndroidManifest.xml'), 'utf8');
  assert.match(manifest, /android:allowBackup="false"/);
  assert.doesNotMatch(manifest, /usesCleartextTraffic="true"/);
  const ignore = fs.readFileSync(path.join(root, 'frontend/android/.gitignore'), 'utf8');
  for (const p of ['keystore.properties', '*.jks', '*.keystore']) assert.ok(ignore.includes(p), p);
  const tracked = fs.readdirSync(path.join(root, 'frontend/android/app')).filter(f => /\.(jks|keystore)$/.test(f));
  assert.deepEqual(tracked, []);
});
