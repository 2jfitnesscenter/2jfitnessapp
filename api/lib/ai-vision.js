// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* The shared engine behind the three vision scans (measurements, routine, machine). A scan
 * module only owns its prompt and what "a trustworthy answer" means; everything about talking
 * to the provider lives here, once:
 *
 *   runScan(opts, work)   checks the auxiliary-AI profile and the daily cap, opens a budget and a
 *                         metrics tracker, runs `work(session)`, then turns whatever happened into
 *                         ONE clean result — never the provider's own words.
 *   session.read(...)     one vision read: retry + backoff + jitter + optional model fallback
 *                         (ai-run.js), JSON parsing, a re-ask when the answer is not JSON.
 *
 * The photo lives only in the memory of the running request; nothing is written to disk and the
 * logs carry counts and error classes, never the image, the prompt or what the model answered.
 */
import * as auxAI from './aux-ai-config.js';
import * as metrics from './ai-metrics.js';
import { adapterFor } from '../coach/adapters/index.js';
import { extractJSON } from '../coach/validate.js';
import { invokeWithRetry, makeBudget, budgetCancelled, budgetExhausted, aiLog, POLICIES } from '../coach/ai-run.js';

const GEMINI = adapterFor('gemini');
const MAX_BAD_JSON_REASKS = 2;

/** What a person sees. Deliberately says nothing about 503s, quotas or providers. */
export const SCAN_ERRORS = {
  NOT_CONFIGURED: 'la IA auxiliar no está configurada en este servidor',
  DAILY_CAP: 'se alcanzó el límite diario de IA auxiliar',
  AI_BUSY: 'La lectura automática está tardando más de lo normal. Inténtalo de nuevo en unos minutos.',
  AI_UNAVAILABLE: 'La lectura automática no está disponible ahora mismo. Avisa al gimnasio si el problema continúa.',
  UNREADABLE: 'No hemos podido leer bien el archivo. Prueba con una foto más nítida y completa.',
  NOTHING_FOUND: 'no se reconoció ninguna máquina o ejercicio en la imagen',
  CANCELLED: 'lectura cancelada',
  INTERNAL: 'No hemos podido completar la lectura. Inténtalo de nuevo.'
};
const LOG_CLASS = { AI_BUSY: 'provider', AI_UNAVAILABLE: 'runtime', UNREADABLE: 'badjson', NOT_CONFIGURED: 'runtime', INTERNAL: 'internal', CANCELLED: 'cancelled' };

/** failure (ai-run.classify + flags) → one of our codes. */
export function codeForFailure(f) {
  if (!f) return 'AI_BUSY';
  if (f.cancelled) return 'CANCELLED';
  if (f.transient || f.budget) return 'AI_BUSY';
  if (f.errorClass === 'auth' || f.errorClass === 'missing' || f.status === 404) return 'AI_UNAVAILABLE';
  return 'UNREADABLE';       // the provider refused this very input (e.g. a corrupt image): another call won't help
}

function fallbacksFromConfig() {
  const cfg = auxAI.load();
  const fb = typeof cfg.fallbackModel === 'string' && cfg.fallbackModel && cfg.fallbackModel !== cfg.model ? cfg.fallbackModel : null;
  return fb ? [{ id: 'gemini:' + fb, args: { model: fb } }] : [];
}

/**
 * @param opts { flow, kind, uid, signal?, onPhase?, sync? }  flow = metrics name, kind = aux log kind.
 * @param work async (session) => ({ ok: true, ...result } | { ok: false, code })
 * @returns { ok: true, ...result } | { ok: false, code, error }
 */
export async function runScan({ flow, kind, uid, signal = null, onPhase = null, sync = false }, work) {
  if (!auxAI.isEnabled() || !auxAI.isConnected()) return { ok: false, code: 'NOT_CONFIGURED', error: SCAN_ERRORS.NOT_CONFIGURED };
  if (!auxAI.reserveDaily(uid).allowed) return { ok: false, code: 'DAILY_CAP', error: SCAN_ERRORS.DAILY_CAP };

  const policy = sync ? POLICIES.scan_sync : POLICIES.scan;
  const budget = makeBudget(policy, signal);
  const track = metrics.begin(flow);
  const started = Date.now();
  const env = auxAI.jobEnv();
  const model = auxAI.load().model || null;
  const fallbacks = fallbacksFromConfig();
  let reads = 0, lastCode = null;

  const session = {
    track, budget,
    /** How many whole-photo reads this request has spent so far. */
    get reads() { return reads; },
    /**
     * One read of the photo. `accept(value)` says whether the parsed JSON has the right shape.
     * @returns { ok: true, value } | { ok: false, code }
     */
    async read(prompt, image, accept = v => v && typeof v === 'object' && !Array.isArray(v)) {
      for (let ask = 0; ask <= MAX_BAD_JSON_REASKS; ask++) {
        if (budgetCancelled(budget)) return { ok: false, code: 'CANCELLED' };
        if (budgetExhausted(budget)) return { ok: false, code: lastCode || 'AI_BUSY' };
        reads++;
        if (reads > 1) track.extraRead(reads);
        const r = await invokeWithRetry(GEMINI, { env, model, timeoutMs: policy.callTimeoutMs, prompt, image },
          { flow, provider: 'gemini', budget, track, onPhase, fallbacks }, policy);
        if (r.failure) { lastCode = codeForFailure(r.failure); return { ok: false, code: lastCode }; }
        const parsed = extractJSON(r.text);
        if (!parsed.error && accept(parsed.value)) return { ok: true, value: parsed.value };
        track.badJson();
        aiLog('AI_PARSE_ERROR', { flow, chars: String(r.text || '').length, ask });
        onPhase?.('retrying');
        lastCode = 'UNREADABLE';
      }
      return { ok: false, code: 'UNREADABLE' };
    }
  };

  let out;
  try { out = await work(session); }
  catch (e) { aiLog('AI_INTERNAL', { flow, error: String(e?.message || e).slice(0, 60) }); out = { ok: false, code: 'INTERNAL' }; }

  const ms = Date.now() - started;
  if (!out?.ok) {
    const code = out?.code || 'INTERNAL';
    // A failed scan must not cost the member one of their daily scans.
    try { auxAI.refundDaily(uid); } catch { /* the cap only drifts by one */ }
    track.finish(false);
    auxAI.logJob({ at: new Date().toISOString(), kind, outcome: code === 'NOTHING_FOUND' ? 'nochange' : 'failed', errorClass: LOG_CLASS[code] || 'provider', calls: budget.calls, ms });
    return { ok: false, code, error: SCAN_ERRORS[code] || SCAN_ERRORS.INTERNAL };
  }
  track.finish(true);
  auxAI.logJob({ at: new Date().toISOString(), kind, outcome: 'ready', calls: budget.calls, ms });
  return out;
}

/** HTTP status for a scan failure code. */
export const HTTP_FOR_SCAN = { DAILY_CAP: 429, AI_BUSY: 503, AI_UNAVAILABLE: 503, NOT_CONFIGURED: 400, UNREADABLE: 422, NOTHING_FOUND: 400, CANCELLED: 499, INTERNAL: 500 };
