/* HTTP surface for 2J's auxiliary-AI profile — admin config routes only (V2 has no
 * member/trainer-facing endpoint of its own; the one capability it drives,
 * exercise_import_matching, is called from ./import-exercise-match.js's own route instead).
 * Same factory shape as coach/routes.js and coach/trainer-routes.js. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as auxAI from './aux-ai-config.js';
import { adapterFor } from '../coach/adapters/index.js';

async function testRun() {
  const adapter = adapterFor('gemini');
  const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aux-ai-test-'));
  try {
    const env = auxAI.jobEnv();
    const check = await adapter.check(null, env);
    if (!check.ok) return { ok: false, error: check.error || 'el runtime del proveedor no se pudo ejecutar' };
    const r = await adapter.invoke({
      jobDir, env, model: null, timeoutMs: 30000,
      prompt: 'Reply with exactly this JSON object and nothing else: {"ok":true}'
    });
    if (r.timedOut) return { ok: false, version: check.version, error: 'el proveedor no respondió a tiempo' };
    if (r.code !== 0) return { ok: false, version: check.version, error: (r.stderr || r.text || '').trim().slice(0, 300) || 'el proveedor devolvió un error' };
    let parsed;
    try { parsed = JSON.parse(r.text); } catch { /* handled below */ }
    if (!parsed?.ok) return { ok: false, version: check.version, error: 'el proveedor respondió, pero no con el formato esperado' };
    return { ok: true, version: check.version };
  } catch {
    return { ok: false, error: 'el proveedor respondió, pero no con el formato esperado' };
  } finally {
    fs.rmSync(jobDir, { recursive: true, force: true });
  }
}

export function auxAIRoutes({ json, readBody, requireAdmin }) {
  return {
    'GET /api/admin/aux-ai': async (req, res) => {
      if (!requireAdmin(req, res)) return;
      const cfg = auxAI.load();
      json(res, 200, {
        enabled: !!cfg.enabled,
        capabilities: auxAI.CAPABILITIES,
        auth: auxAI.authStatus(),
        caps: cfg.caps,
        jobsToday: auxAI.jobsToday(),
        lastSuccess: auxAI.lastSuccess(),
        lastError: auxAI.lastError(),
        recent: (cfg.log || []).slice(-10).reverse()
      });
    },

    'POST /api/admin/aux-ai/config': async (req, res) => {
      if (!requireAdmin(req, res)) return;
      const body = await readBody(req);
      const patch = {};
      if (body.enabled !== undefined) patch.enabled = !!body.enabled;
      if (body.caps) patch.caps = { instanceDaily: Math.max(0, Math.min(2000, +body.caps.instanceDaily || 0)) };
      auxAI.save(patch);
      json(res, 200, { ok: true });
    },

    'POST /api/admin/aux-ai/auth/key': async (req, res) => {
      if (!requireAdmin(req, res)) return;
      const body = await readBody(req);
      try {
        auxAI.setApiKey(body.key);
        const test = await testRun();
        json(res, 200, { ok: true, test });
      } catch (e) { json(res, 400, { error: e.message }); }
    },

    'POST /api/admin/aux-ai/auth/disconnect': async (req, res) => {
      if (!requireAdmin(req, res)) return;
      auxAI.disconnect();
      json(res, 200, { ok: true });
    },

    'POST /api/admin/aux-ai/test': async (req, res) => {
      if (!requireAdmin(req, res)) return;
      json(res, 200, await testRun());
    }
  };
}
