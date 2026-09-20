/* OpenAI adapter — direct REST, never the Codex CLI.
 *
 * V3: this replaces the earlier idea of running the member-facing Coach through the OpenAI
 * Codex CLI (which needs a writable HOME/PATH the container's unprivileged Coach user doesn't
 * have — the "Permission denied (os error 13)" this adapter exists to avoid). There is no
 * subprocess, no device-code flow, no app-server, and no container permission change: like
 * gemini.js, this is one HTTPS request to OpenAI's Chat Completions endpoint with the prompt as
 * plain text and the answer read back as plain text — nothing runs on OpenAI's side but text
 * generation, so this talks to the API directly from the server process rather than through the
 * unprivileged-subprocess sandbox spawn.js gives the CLI-based providers.
 *
 * Auth is a plain OpenAI API key (config.js's generic `apikey` auth path — like Gemini, this
 * provider declares no setupToken/deviceLogin, so the existing "Use an API key" admin flow
 * already covers it with zero UI changes). The key travels as a Bearer token, OpenAI's normal
 * convention. */
const DEFAULT_MODEL = 'gpt-5.1';
const API_URL = 'https://api.openai.com/v1/chat/completions';
const SYSTEM_PROMPT = [
  'You are the 2J Fitness Center Coach.',
  'Answer only the supplied task and return exactly the requested JSON.',
  'You have no tools, filesystem access, external services, or persistent memory.'
].join(' ');

async function callOpenAI({ apiKey, model, prompt, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: prompt }],
        temperature: 0.4,
        response_format: { type: 'json_object' }
      })
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = body?.error?.message || `HTTP ${res.status}`;
      return { ok: false, error: msg, status: res.status };
    }
    const choice = body?.choices?.[0];
    const finish = choice?.finish_reason;
    if (finish && !['stop', 'length'].includes(finish)) {
      return { ok: false, error: `OpenAI stopped early: ${finish}` };
    }
    const text = (choice?.message?.content || '').trim();
    if (!text) return { ok: false, error: 'OpenAI returned an empty response' };
    return { ok: true, text };
  } catch (e) {
    if (e.name === 'AbortError') return { ok: false, error: 'timed out', timedOut: true };
    return { ok: false, error: e.message || String(e) };
  } finally {
    clearTimeout(timer);
  }
}

export default {
  id: 'openai',
  runtime: 'OpenAI API',

  async check(cfg, env) {
    if (!env.OPENAI_API_KEY) return { ok: false, error: 'no API key connected yet' };
    // Same trade-off gemini.js makes: no live network call on every dashboard load — the real
    // round-trip happens in testRun(), which every "Save and test" / "Test the Coach" click runs.
    return { ok: true, version: cfg?.model || DEFAULT_MODEL };
  },

  async invoke({ prompt, env, model, timeoutMs }) {
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) return { code: -1, text: '', stderr: 'no OpenAI API key connected', timedOut: false, spawnError: true };
    const r = await callOpenAI({ apiKey, model: model || DEFAULT_MODEL, prompt, timeoutMs });
    if (!r.ok) {
      return { code: r.status === 401 || r.status === 403 ? 2 : 1, text: '', stderr: r.error, timedOut: !!r.timedOut, spawnError: false };
    }
    return { code: 0, text: r.text, stderr: '', timedOut: false, spawnError: false };
  }
};
