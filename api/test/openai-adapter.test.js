import test from 'node:test';
import assert from 'node:assert/strict';
import openai from '../coach/adapters/openai.js';

/* V3 — direct OpenAI REST adapter, never the Codex CLI. Same fetch-mocking pattern as
 * test/whoop-client.test.js: swap globalThis.fetch for the duration of one test, restore it
 * after. No network call ever actually leaves the process. */
function withFetch(handler, run) {
  const real = globalThis.fetch;
  globalThis.fetch = handler;
  return run().finally(() => { globalThis.fetch = real; });
}

test('check() reports unconfigured when no API key is in the job env', async () => {
  const r = await openai.check({}, {});
  assert.equal(r.ok, false);
});

test('check() reports ok without making a network call — the real round-trip happens on invoke', async () => {
  await withFetch(async () => { throw new Error('must not be called by check()'); }, async () => {
    const r = await openai.check({ model: 'gpt-5.1' }, { OPENAI_API_KEY: 'sk-test' });
    assert.equal(r.ok, true);
    assert.equal(r.version, 'gpt-5.1');
  });
});

test('invoke() refuses cleanly with no API key, never reaching fetch', async () => {
  await withFetch(async () => { throw new Error('must not be called'); }, async () => {
    const r = await openai.invoke({ prompt: 'x', env: {}, timeoutMs: 5000 });
    assert.equal(r.spawnError, true);
    assert.match(r.stderr, /API key/);
  });
});

test('invoke() returns the model text on a clean 200 response', async () => {
  await withFetch(async (url, opts) => {
    assert.equal(url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(opts.headers.authorization, 'Bearer sk-test');
    const body = JSON.parse(opts.body);
    assert.equal(body.model, 'gpt-5.1');
    assert.equal(body.messages[1].content, 'do the thing');
    return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: '{"coach_contract":1}' } }] }) };
  }, async () => {
    const r = await openai.invoke({ prompt: 'do the thing', env: { OPENAI_API_KEY: 'sk-test' }, model: 'gpt-5.1', timeoutMs: 5000 });
    assert.equal(r.code, 0);
    assert.equal(r.text, '{"coach_contract":1}');
  });
});

test('invoke() maps a 401 to code 2 (auth) — jobs.js classifies auth failures by this stderr text', async () => {
  await withFetch(async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'Incorrect API key provided' } }) }),
    async () => {
      const r = await openai.invoke({ prompt: 'x', env: { OPENAI_API_KEY: 'sk-bad' }, timeoutMs: 5000 });
      assert.equal(r.code, 2);
      assert.match(r.stderr, /API key/);
    });
});

test('invoke() surfaces a non-auth provider error as code 1, not 2', async () => {
  await withFetch(async () => ({ ok: false, status: 500, json: async () => ({ error: { message: 'internal server error' } }) }),
    async () => {
      const r = await openai.invoke({ prompt: 'x', env: { OPENAI_API_KEY: 'sk-test' }, timeoutMs: 5000 });
      assert.equal(r.code, 1);
    });
});

test('invoke() treats an empty response as a failure rather than an empty success', async () => {
  await withFetch(async () => ({ ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: '' } }] }) }),
    async () => {
      const r = await openai.invoke({ prompt: 'x', env: { OPENAI_API_KEY: 'sk-test' }, timeoutMs: 5000 });
      assert.equal(r.code, 1);
      assert.match(r.stderr, /empty/);
    });
});

test('invoke() reports a timeout distinctly from a provider error', async () => {
  await withFetch(async (url, opts) => new Promise((_, reject) => {
    opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  }), async () => {
    const r = await openai.invoke({ prompt: 'x', env: { OPENAI_API_KEY: 'sk-test' }, timeoutMs: 30 });
    assert.equal(r.timedOut, true);
  });
});

test('the id/runtime identify this as a plain REST adapter, never the Codex CLI', () => {
  assert.equal(openai.id, 'openai');
  assert.equal(openai.runtime, 'OpenAI API');
  assert.equal(Object.hasOwn(openai, 'cli'), false);
});
