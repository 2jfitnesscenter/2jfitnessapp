import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootSocial } from './social-http.mjs';

test('isolated Social API servers receive distinct OS-assigned ephemeral ports when started concurrently', async () => {
  const servers = await Promise.all([
    bootSocial({ tag: 'social-port-a' }),
    bootSocial({ tag: 'social-port-b' }),
    bootSocial({ tag: 'social-port-c' }),
  ]);
  try {
    const ports = servers.map(server => Number(new URL(server.base).port));
    assert.equal(new Set(ports).size, servers.length);
    for (const server of servers) {
      const response = await fetch(`${server.base}/api/health`);
      assert.equal(response.status, 200);
    }
  } finally {
    for (const server of servers) server.stop();
  }
});