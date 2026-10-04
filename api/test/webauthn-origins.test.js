import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { isoCBOR, isoBase64URL } from '@simplewebauthn/server/helpers';
import { expectedOrigins, androidOrigin, ANDROID_APK_KEY_HASHES } from '../lib/webauthn-origins.js';

const WEB = 'https://app.2jfitnesscenter.com';
const RP_ID = 'app.2jfitnesscenter.com';
const DEBUG = 'DLu_bybBDIMjVCyTrrPmGUTSkkZWCvidpoU2D3qDXqw';
const RELEASE = 'Xtnl80w2A-0scA3f4Jtf5D5UvAZ0dgJ7RTpZsbqv3tE';   // the real release keystore (Sprint 3)
const OTHER = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';   // well-formed but not approved

// A real ES256 assertion signed over clientDataJSON with the given origin, verified by the real library.
const key = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = key.publicKey.export({ format: 'jwk' });
const publicKey = isoCBOR.encode(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
const credId = 'cred-test-id';
function assertion(origin, challenge = 'chal-123') {
  const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: Buffer.from(challenge).toString('base64url'), origin }));
  const authData = Buffer.concat([crypto.createHash('sha256').update(RP_ID).digest(), Buffer.from([0x05]), Buffer.from([0, 0, 0, 1])]);   // UP+UV, counter 1
  const sig = crypto.sign('sha256', Buffer.concat([authData, crypto.createHash('sha256').update(clientDataJSON).digest()]), key.privateKey);
  return {
    id: credId, rawId: credId, type: 'public-key', clientExtensionResults: {},
    response: { clientDataJSON: clientDataJSON.toString('base64url'), authenticatorData: authData.toString('base64url'), signature: sig.toString('base64url') },
  };
}
const verify = origin => verifyAuthenticationResponse({
  response: assertion(origin), expectedChallenge: Buffer.from('chal-123').toString('base64url'),
  expectedOrigin: expectedOrigins(WEB, ''), expectedRPID: RP_ID, requireUserVerification: false,
  credential: { id: credId, publicKey, counter: 0 },
});

test('the accepted list is the web origin plus exactly the approved Android release and debug hashes', () => {
  assert.deepEqual(expectedOrigins(WEB, ''), [WEB, 'android:apk-key-hash:' + RELEASE, 'android:apk-key-hash:' + DEBUG]);
  assert.deepEqual(ANDROID_APK_KEY_HASHES, [RELEASE, DEBUG]);
});

test('a valid web origin verifies', async () => { assert.equal((await verify(WEB)).verified, true); });

test('the approved Android origin verifies (rpID unchanged)', async () => { assert.equal((await verify(androidOrigin(DEBUG))).verified, true); });

test('an unapproved Android hash is rejected', async () => {
  await assert.rejects(() => verify(androidOrigin(OTHER)), /Unexpected authentication response origin/);
});

test('wildcards, other schemes and look-alike web origins are rejected', async () => {
  for (const origin of ['android:apk-key-hash:*', 'android:apk-key-hash:', 'android:apk-key-hash:' + DEBUG + 'x', 'https://evil.example', 'http://app.2jfitnesscenter.com', 'https://app.2jfitnesscenter.com.evil.example']) {
    await assert.rejects(() => verify(origin), /Unexpected authentication response origin/, origin);
  }
});

test('a release hash can be added later without removing the debug one; malformed values never become origins', () => {
  const release = 'Zm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyZm8';          // 43 base64url chars
  assert.deepEqual(expectedOrigins(WEB, release), [WEB, androidOrigin(DEBUG), androidOrigin(release)]);
  assert.deepEqual(expectedOrigins(WEB, `${release}, ${DEBUG}`), [WEB, androidOrigin(DEBUG), androidOrigin(release)]);   // de-duplicated
  assert.deepEqual(expectedOrigins(WEB, '*, short, ' + DEBUG + '=, ../x'), [WEB, androidOrigin(RELEASE), androidOrigin(DEBUG)]);
});
