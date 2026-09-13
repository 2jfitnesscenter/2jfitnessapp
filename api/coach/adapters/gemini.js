/* Google Gemini adapter.
 *
 * Unlike Claude/Codex, this isn't an agentic CLI — it's one HTTPS request to Google's
 * `generateContent` REST endpoint with the payload as plain text and the response read back as
 * plain text. There's no local tool or filesystem access for a prompt to escape into (nothing
 * runs on the model's side but text generation), so this talks to the API directly from the
 * server process rather than through the unprivileged-subprocess sandbox spawn.js gives the
 * CLI-based providers — there's no comparable local blast radius here to contain.
 *
 * Auth is a plain Google AI Studio API key (config.js's generic `apikey` auth path — Gemini
 * declares no setupToken/deviceLogin, so the existing "Use an API key" admin flow already
 * covers it with no UI changes). The free tier is exactly that: no card on file, request-per-
 * minute and per-day caps instead — see the Coach's own per-user/instance daily caps in the
 * admin panel for a second layer of that same protection.
 *
 * The key travels as the `x-goog-api-key` header, not a `?key=` query param: Google replaced
 * the old `AIzaSy...` "Standard key" format with a new `AQ....` "Auth key" format (fully
 * rejecting the legacy one from September 2026), and the new format is only accepted via the
 * header — a `?key=` request gets treated as having no credential at all, which is why the
 * failure Google returns for it reads "expected OAuth 2 access token, login cookie or other
 * valid authentication credential" rather than anything mentioning the key itself. */
const DEFAULT_MODEL = 'gemini-3.6-flash';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const SYSTEM_PROMPT = [
  'You are the 2J Fitness Center Coach.',
  'Answer only the supplied task and return exactly the requested JSON.',
  'You have no tools, filesystem access, external services, or persistent memory.'
].join(' ');

async function callGemini({ apiKey, model, prompt, image, timeoutMs }) {
  const url = `${API_BASE}/${encodeURIComponent(model)}:generateContent`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // A scan request attaches the report as a second part alongside the text prompt — Gemini
  // reads a PDF the same way it reads an image (each page becomes a frame internally), so the
  // caller never has to rasterize one first.
  const parts = [{ text: prompt }];
  if (image?.data && image?.mimeType) parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature: 0.4, responseMimeType: 'application/json' }
      })
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = body?.error?.message || `HTTP ${res.status}`;
      return { ok: false, error: msg, status: res.status };
    }
    const candidate = body?.candidates?.[0];
    const blockReason = body?.promptFeedback?.blockReason;
    if (blockReason) return { ok: false, error: `blocked by Gemini safety filters (${blockReason})` };
    if (candidate?.finishReason && !['STOP', 'MAX_TOKENS'].includes(candidate.finishReason)) {
      return { ok: false, error: `Gemini stopped early: ${candidate.finishReason}` };
    }
    const text = (candidate?.content?.parts || []).map(p => p.text || '').join('').trim();
    if (!text) return { ok: false, error: 'Gemini returned an empty response' };
    return { ok: true, text };
  } catch (e) {
    if (e.name === 'AbortError') return { ok: false, error: 'timed out', timedOut: true };
    return { ok: false, error: e.message || String(e) };
  } finally {
    clearTimeout(timer);
  }
}

export default {
  id: 'gemini',
  runtime: 'Gemini API',

  async check(cfg, env) {
    if (!env.GEMINI_API_KEY) return { ok: false, error: 'no API key connected yet' };
    // No live network call on every dashboard load — same trade-off claude.js makes: the real
    // round-trip happens in testRun(), which every "Save and test" / "Test the Coach" click runs.
    return { ok: true, version: cfg?.model || DEFAULT_MODEL };
  },

  async invoke({ prompt, image, env, model, timeoutMs }) {
    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) return { code: -1, text: '', stderr: 'no Gemini API key connected', timedOut: false, spawnError: true };
    const r = await callGemini({ apiKey, model: model || DEFAULT_MODEL, prompt, image, timeoutMs });
    if (!r.ok) {
      return { code: r.status === 401 || r.status === 403 ? 2 : 1, text: '', stderr: r.error, timedOut: !!r.timedOut, spawnError: false };
    }
    return { code: 0, text: r.text, stderr: '', timedOut: false, spawnError: false };
  }
};
