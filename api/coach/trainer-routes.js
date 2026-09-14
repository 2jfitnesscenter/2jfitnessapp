/* HTTP surface for the trainer panel's "Generate with AI" feature — admin config routes plus
 * the trainer-facing generate/status/discard routes. Same factory shape as ./routes.js. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as trainerAI from './trainer-ai.js';
import * as trainerJobs from './trainer-jobs.js';
import { adapterFor } from './adapters/index.js';

const USER_ERROR = {
  off: 'la IA del panel de entrenador no está configurada — pide al administrador que la conecte',
  busy: 'ya se está generando una rutina para este socio',
  cap: 'se ha alcanzado el límite diario de generaciones con IA',
  nostate: 'este socio nunca ha sincronizado — todavía no hay nada sobre lo que generar'
};
const HTTP_FOR = { off: 503, busy: 409, cap: 429, nostate: 400 };

async function testRun() {
  const adapter = adapterFor('claude');
  const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trainer-ai-test-'));
  const env = trainerAI.jobEnv(jobDir);
  try {
    const ids = (await import('./adapters/spawn.js')).unprivilegedIds();
    if (ids) fs.chownSync(jobDir, ids.uid, ids.gid);
    const check = await adapter.check();
    if (!check.ok) return { ok: false, error: check.error || 'el runtime del proveedor no se pudo ejecutar' };
    const r = await adapter.invoke({
      jobDir, env, model: null, timeoutMs: 90000,
      prompt: 'Reply with exactly this JSON object and nothing else: {"coach_contract":1,"ok":true}'
    });
    if (r.timedOut) return { ok: false, version: check.version, error: 'el proveedor no respondió a tiempo' };
    if (r.code !== 0) return { ok: false, version: check.version, error: (r.stderr || r.text || '').trim().slice(0, 300) || 'el proveedor devolvió un error' };
    const parsed = JSON.parse(r.text);
    if (!parsed?.ok) return { ok: false, version: check.version, error: 'el proveedor respondió, pero no con el formato esperado' };
    return { ok: true, version: check.version };
  } catch {
    return { ok: false, error: 'el proveedor respondió, pero no con el formato esperado' };
  } finally {
    fs.rmSync(jobDir, { recursive: true, force: true });
  }
}

export function trainerAIRoutes({ json, readBody, requireAdmin, requireTrainer }) {
  return {
    /* ------------------------------ admin ------------------------------ */

    'GET /api/admin/trainer-ai': async (req, res) => {
      if (!requireAdmin(req, res)) return;
      const cfg = trainerAI.load();
      json(res, 200, {
        enabled: !!cfg.enabled,
        auth: trainerAI.authStatus(),
        caps: cfg.caps,
        jobsToday: trainerAI.jobsToday(),
        lastSuccess: trainerAI.lastSuccess(),
        lastError: trainerAI.lastError(),
        recent: (cfg.log || []).slice(-10).reverse()
      });
    },

    'POST /api/admin/trainer-ai/config': async (req, res) => {
      if (!requireAdmin(req, res)) return;
      const body = await readBody(req);
      const patch = {};
      if (body.enabled !== undefined) patch.enabled = !!body.enabled;
      if (body.caps) patch.caps = { instanceDaily: Math.max(0, Math.min(500, +body.caps.instanceDaily || 0)) };
      trainerAI.save(patch);
      json(res, 200, { ok: true });
    },

    'POST /api/admin/trainer-ai/auth/setup-token': async (req, res) => {
      if (!requireAdmin(req, res)) return;
      const body = await readBody(req);
      try {
        trainerAI.setSetupToken(body.token);
        const test = await testRun();
        json(res, 200, { ok: true, test });
      } catch (e) { json(res, 400, { error: e.message }); }
    },

    'POST /api/admin/trainer-ai/auth/disconnect': async (req, res) => {
      if (!requireAdmin(req, res)) return;
      trainerAI.disconnect();
      json(res, 200, { ok: true });
    },

    'POST /api/admin/trainer-ai/test': async (req, res) => {
      if (!requireAdmin(req, res)) return;
      json(res, 200, await testRun());
    },

    /* ------------------------------ trainer ------------------------------ */

    'POST /api/trainer/ai/generate': async (req, res) => {
      const trainer = requireTrainer(req, res); if (!trainer) return;
      const body = await readBody(req);
      const memberId = String(body.memberId || '');
      if (!memberId) return json(res, 400, { error: 'falta el socio' });
      try {
        const job = trainerJobs.enqueue(trainer.id, memberId, body.brief || {});
        json(res, 202, { job });
      } catch (e) {
        if (e instanceof trainerJobs.TrainerAIError) return json(res, HTTP_FOR[e.code] || 400, { error: USER_ERROR[e.code] || e.message, code: e.code });
        throw e;
      }
    },

    'GET /api/trainer/ai/status': async (req, res) => {
      const trainer = requireTrainer(req, res); if (!trainer) return;
      const memberId = new URL(req.url, 'http://x').searchParams.get('memberId') || '';
      json(res, 200, trainerJobs.status(trainer.id, memberId));
    },

    'POST /api/trainer/ai/discard': async (req, res) => {
      const trainer = requireTrainer(req, res); if (!trainer) return;
      const body = await readBody(req);
      json(res, 200, trainerJobs.discard(trainer.id, String(body.memberId || '')));
    }
  };
}
