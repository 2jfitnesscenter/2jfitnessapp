/* Gemini's ONE job in the CSV importer: given an external exercise name (from Hevy/Gravl/
 * whatever) and a short list of real 2J library candidates already narrowed down client-side
 * (see frontend/src/lib/import-match.js's own local candidate generation), say which candidate
 * — if any — is the same exercise. Nothing else. It never sees a workout, a date, a weight, a
 * rep count, an RPE, or who is importing — see buildPayload() below for the literal fields sent.
 *
 * Gated on the auxiliary-AI profile (aux-ai-config.js), NOT the member-facing Coach's own
 * provider choice — unlike the three existing scanners (machine-scan/measurements-scan/
 * routine-scan), which still piggyback on cfgStore.provider === 'gemini' from before this
 * profile existed. Deliberately not migrating those three here (out of V2's actual scope,
 * see the session's own final report) — only this new capability uses the new store.
 *
 * One call per import (batched across every unresolved name), not one per exercise — see
 * buildPayload()'s array shape. Every item in the response is validated independently and
 * fully locally before anything from it is trusted: a bad batch never taints a good item in it,
 * and nothing here is ever treated as authoritative without that check passing.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as auxAI from './aux-ai-config.js';
import { adapterFor } from '../coach/adapters/index.js';
import { extractJSON } from '../coach/validate.js';

const TIMEOUT_MS = 45000;
const MAX_ITEMS = 60;          // one import's worth of distinct unresolved names, generously capped
const MAX_CANDIDATES = 8;      // per item — the client already narrows to "close enough to matter"

const STATUSES = ['MATCH', 'AMBIGUOUS', 'NO_MATCH'];

const PROMPT_HEADER = `You resolve exercise names from a fitness app export to the closest entry in 2J Fitness Center's own exercise library, or say there isn't one. You do NOT invent exercises, translate freely, guess biomechanics, or pick a "close enough" candidate when you are not confident — a wrong match silently mislabels someone's training history, which is worse than leaving it unresolved.

For each item in "items", choose from ONLY that item's own "candidates" list (never a candidate from a different item, never an id you don't see listed) — or decide none of them are the same exercise.

Reply with EXACTLY this JSON object and nothing else — no markdown fences, no explanation outside the JSON:

{"results": [
  {"externalName": <string, copied exactly from the item>, "status": "MATCH"|"AMBIGUOUS"|"NO_MATCH", "exerciseId": <string|null>, "confidence": <number 0-1>, "reason": <short string, at most 100 characters>}
]}

Rules:
- "results" must have exactly one entry per item in "items", in the same order, with "externalName" copied verbatim.
- status "MATCH": exactly one candidate is clearly the same exercise (equipment and movement both match, allowing for translation/naming style). exerciseId is that candidate's id.
- status "AMBIGUOUS": two or more candidates could plausibly be it and you cannot tell which. exerciseId is null.
- status "NO_MATCH": no candidate is genuinely the same exercise (or the candidates list is empty). exerciseId is null.
- exerciseId, when not null, MUST be exactly one of that item's own candidate ids — never invented, never from another item.
- confidence reflects your real certainty (0 = no idea, 1 = certain) — do not default it to a high number.
- reason is a brief factual note (e.g. "same equipment and movement, translated name"), never a guess presented as fact.

items:
`;

function buildPayload(items) {
  // Only what the exercise-matching task actually needs — see this file's own header comment
  // for the explicit list of what must never appear here (uid, name, email, dates, weights,
  // reps, RPE, workout/session data, notes). `equipment`/`muscle` ride along only when the CSV
  // itself supplied them — nothing here is invented to make the payload look richer.
  return items.slice(0, MAX_ITEMS).map(it => ({
    name: String(it.name || '').slice(0, 120),
    source: it.source ? String(it.source).slice(0, 40) : undefined,
    equipment: it.equipment ? String(it.equipment).slice(0, 40) : undefined,
    muscle: it.muscle ? String(it.muscle).slice(0, 40) : undefined,
    candidates: (it.candidates || []).slice(0, MAX_CANDIDATES).map(c => ({
      id: String(c.id), name: String(c.name || '').slice(0, 120),
      equipment: c.equipment ? String(c.equipment).slice(0, 40) : undefined,
      muscles: Array.isArray(c.muscles) ? c.muscles.slice(0, 6).map(String) : undefined,
    })),
  }));
}

/** Structural + safety validation of one result against its own item — never trusts the model
 *  past this point. A result that fails any of these checks is downgraded to a safe NO_MATCH
 *  rather than dropped, so the caller still gets exactly one outcome per item to review. */
function sanitizeResult(item, raw) {
  const fallback = { externalName: item.name, status: 'NO_MATCH', exerciseId: null, confidence: 0, reason: '' };
  if (!raw || typeof raw !== 'object') return fallback;
  const status = STATUSES.includes(raw.status) ? raw.status : null;
  if (!status) return fallback;
  const confidence = typeof raw.confidence === 'number' && Number.isFinite(raw.confidence)
    ? Math.max(0, Math.min(1, raw.confidence)) : 0;
  const reason = typeof raw.reason === 'string' ? raw.reason.slice(0, 100) : '';
  if (status !== 'MATCH') return { externalName: item.name, status, exerciseId: null, confidence, reason };
  const candidateIds = new Set((item.candidates || []).map(c => c.id));
  const exerciseId = typeof raw.exerciseId === 'string' ? raw.exerciseId : null;
  // The one rule this whole file exists to enforce: an invented or out-of-scope id is rejected,
  // never taken on faith (spec: "Si Gemini devuelve exerciseId = algo inventado → rechazar").
  if (!exerciseId || !candidateIds.has(exerciseId)) return fallback;
  return { externalName: item.name, status: 'MATCH', exerciseId, confidence, reason };
}

/**
 * @param {Array<{name:string, source?:string, equipment?:string, muscle?:string, candidates:Array<{id:string,name:string,equipment?:string,muscles?:string[]}>}>} items
 * @returns {Promise<{ok:true, results:Array} | {ok:false, error:string}>}
 */
export async function matchImportExercises(items) {
  if (!Array.isArray(items) || !items.length) return { ok: true, results: [] };
  if (!auxAI.isEnabled() || !auxAI.isConnected()) {
    return { ok: false, error: 'la IA auxiliar no está configurada en este servidor' };
  }
  const payload = buildPayload(items);
  const adapter = adapterFor('gemini');
  const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aux-ai-match-'));
  const started = Date.now();
  try {
    const env = auxAI.jobEnv();
    const check = await adapter.check(null, env);
    if (!check.ok) {
      auxAI.logJob({ at: new Date().toISOString(), kind: 'exercise_import_matching', outcome: 'failed', errorClass: 'runtime', ms: Date.now() - started });
      return { ok: false, error: check.error || 'el proveedor no está disponible' };
    }
    const prompt = PROMPT_HEADER + JSON.stringify(payload);
    const r = await adapter.invoke({ jobDir, env, model: null, timeoutMs: TIMEOUT_MS, prompt });
    if (r.timedOut) {
      auxAI.logJob({ at: new Date().toISOString(), kind: 'exercise_import_matching', outcome: 'failed', errorClass: 'timeout', ms: Date.now() - started });
      return { ok: false, error: 'el proveedor no respondió a tiempo' };
    }
    if (r.code !== 0) {
      auxAI.logJob({ at: new Date().toISOString(), kind: 'exercise_import_matching', outcome: 'failed', errorClass: 'provider', ms: Date.now() - started });
      return { ok: false, error: (r.stderr || r.text || 'el proveedor devolvió un error').trim().slice(0, 300) };
    }
    const parsed = extractJSON(r.text);
    if (parsed.error || typeof parsed.value !== 'object' || !Array.isArray(parsed.value?.results)) {
      auxAI.logJob({ at: new Date().toISOString(), kind: 'exercise_import_matching', outcome: 'failed', errorClass: 'badjson', ms: Date.now() - started });
      return { ok: false, error: 'el proveedor no devolvió el formato esperado' };
    }
    // Match results back to items by externalName (never by array position alone — a model
    // that drops or reorders one entry must not silently misalign the rest).
    const byName = new Map(parsed.value.results.map(r => [String(r?.externalName || ''), r]));
    const results = payload.map(item => sanitizeResult(item, byName.get(item.name)));
    auxAI.logJob({ at: new Date().toISOString(), kind: 'exercise_import_matching', outcome: 'ready', ms: Date.now() - started, detail: `${results.length} items` });
    return { ok: true, results };
  } catch (e) {
    auxAI.logJob({ at: new Date().toISOString(), kind: 'exercise_import_matching', outcome: 'failed', errorClass: 'exception', ms: Date.now() - started });
    return { ok: false, error: e.message || 'error inesperado' };
  } finally {
    fs.rmSync(jobDir, { recursive: true, force: true });
  }
}
