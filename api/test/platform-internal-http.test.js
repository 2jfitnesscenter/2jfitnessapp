import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { parsePlatformIntegrationEnv } from '../platform-sso/index.js';

// C4: plain http to a non-loopback host (docker compose service names) only with the explicit PLATFORM_ALLOW_INTERNAL_HTTP=true.
const SECRET = crypto.randomBytes(32).toString('base64url');
const env = extra => ({ PLATFORM_API_BASE_URL: 'http://platform-api:3100', PLATFORM_API_KEY_ID: 'bunker-1', PLATFORM_API_KEY_SECRET: SECRET, ...extra });

test('http to a non-loopback host is rejected without the flag and with any value other than "true"', () => {
  for (const flag of [undefined, '', 'false', '1', 'TRUE', 'yes']) {
    const config = parsePlatformIntegrationEnv(env(flag === undefined ? {} : { PLATFORM_ALLOW_INTERNAL_HTTP: flag }));
    assert.equal(config.client, null, String(flag));
  }
});

test('http to a non-loopback host is accepted with PLATFORM_ALLOW_INTERNAL_HTTP=true (api and home urls)', () => {
  const config = parsePlatformIntegrationEnv(env({ PLATFORM_ALLOW_INTERNAL_HTTP: 'true', PLATFORM_HOME_URL: 'http://platform-home:3000/' }));
  assert.equal(config.client.baseUrl, 'http://platform-api:3100');
  assert.equal(config.homeUrl, 'http://platform-home:3000');
  assert.equal(parsePlatformIntegrationEnv(env({ PLATFORM_HOME_URL: 'http://platform-home:3000/' })).homeUrl, null);
});

test('the flag never loosens the other rules: credentials in the url, other protocols; https and loopback http are unchanged', () => {
  const flag = { PLATFORM_ALLOW_INTERNAL_HTTP: 'true' };
  assert.equal(parsePlatformIntegrationEnv(env({ ...flag, PLATFORM_API_BASE_URL: 'http://u:p@platform-api:3100' })).client, null);
  assert.equal(parsePlatformIntegrationEnv(env({ ...flag, PLATFORM_API_BASE_URL: 'ftp://platform-api' })).client, null);
  for (const extra of [{}, flag]) {
    assert.equal(parsePlatformIntegrationEnv(env({ ...extra, PLATFORM_API_BASE_URL: 'https://platform.example.com' })).client.baseUrl, 'https://platform.example.com');
    assert.equal(parsePlatformIntegrationEnv(env({ ...extra, PLATFORM_API_BASE_URL: 'http://127.0.0.1:3100' })).client.baseUrl, 'http://127.0.0.1:3100');
  }
});
