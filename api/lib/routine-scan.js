/* Reading a printed, handwritten or photographed workout routine into raw structured text.
 *
 * Same approach as measurements-scan.js (no OCR — a PDF or photo goes to Gemini as a vision
 * call, one call either way) but a different shape: the model has no idea which exercise-id
 * scheme this gym's app uses, so it is asked for the exercise names exactly as printed, not ids.
 * Matching those names against the real library (or creating a custom exercise for one that
 * doesn't match) happens client-side — see frontend/src/lib/routine-scan.js's
 * matchScannedRoutine(), the same job frontend/src/lib/import-csv.js's matchExercise() already
 * does for a CSV import from another app. This file only ever returns free text; nothing here
 * writes to anyone's plan.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as auxAI from './aux-ai-config.js';
import { adapterFor } from '../coach/adapters/index.js';
import { extractJSON } from '../coach/validate.js';

const TIMEOUT_MS = 60000;
const GEMINI = adapterFor('gemini');

const PROMPT = `This image or PDF is a workout routine or training program, printed, handwritten or photographed, in any language. It may cover one training day or several. Read it and reply with EXACTLY this JSON object and nothing else — no markdown fences, no explanation:

{"name": <string|null>, "days": [{"label": <string|null>, "exercises": [{"name": <string>, "nameEn": <string>, "sets": <integer|null>, "reps": <integer|null>, "weight": <number|null>, "unit": "reps"|"sec", "notes": <string|null>}]}]}

Field meanings:
- name: a title for the whole routine/program if one is written on the page (e.g. a person's name, a program name like "Push Pull Legs"), else null.
- days: one entry per training day found on the page. A single-day routine still produces one entry. Keep the days in the order they appear.
- label: the day's own heading as written — a weekday name ("Monday", "Lunes"), a day number ("Day 1", "Día 1"), a split name ("Push", "Empuje", "Piernas") — whatever is actually printed there. null if there is no heading at all.
- exercises: every exercise row for that day, in the order printed.
- name (per exercise): the exercise name exactly as written, in its original language — do not translate it, do not guess which app's exercise database it maps to.
- nameEn (per exercise): the same exercise's SHORT, canonical English gym name — 2 to 4 words, equipment then movement (e.g. "Press neutro plano" -> "neutral grip bench press", "Sentadillas péndulo" -> "pendulum squat", "Jalón 1 mano abierta" -> "single arm lat pulldown", "Elevacion frontal polea o manc" -> "cable front raise"). This is only used afterwards to look the exercise up in an English-named database by name, so pick ONE specific, common name for the closest standard version of this movement rather than a literal translation or a description of exactly what's written — drop secondary details that aren't part of the exercise's own name (bench angle, "or" alternatives, rep tempo, which specific machine brand) and expand any local abbreviation or shorthand you recognise. If the name is already a short English gym name, repeat it here unchanged.
- sets: the number of sets, if given.
- reps: the number of reps per set, if given (a range like "8-12" — use the lower number).
- weight: the working weight if a specific number is written (ignore vague words like "moderate" or a plain check-box with no number).
- unit: "reps" for a normal rep-counted exercise (put the rep count in "reps"), or "sec" for a timed exercise like a plank or a hold (convert to seconds and put that number in "reps" instead — e.g. "30s plank" -> reps:30, unit:"sec"; "1 min" -> reps:60, unit:"sec").
- notes: any short freeform note attached to that exercise (tempo, a superset marker, "to failure", etc.), else null.

Use null for anything not found or not legible (nameEn is the one exception — always fill it in, your best standard-English equivalent). Never invent a number or an exercise that is not on the page. Reply with the JSON object only.`;

/**
 * @param {{data: string, mimeType: string}} image — base64 payload (no `data:` prefix) + its mime type.
 * @returns {Promise<{ok: true, value: object} | {ok: false, error: string}>}
 */
export async function scanRoutineDocument({ data, mimeType, uid }) {
  if (!auxAI.isEnabled() || !auxAI.isConnected()) {
    return { ok: false, error: 'la IA auxiliar no está configurada en este servidor' };
  }
  if (!auxAI.reserveDaily(uid).allowed) {
    return { ok: false, code: 'DAILY_CAP', error: 'se alcanzó el límite diario de IA auxiliar' };
  }
  const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aux-ai-scan-'));
  const started = Date.now();
  try {
    const env = auxAI.jobEnv();
    const check = await GEMINI.check(null, env);
    if (!check.ok) {
      auxAI.logJob({ at: new Date().toISOString(), kind: 'routine_scan', outcome: 'failed', errorClass: 'runtime', ms: Date.now() - started });
      return { ok: false, error: check.error || 'el proveedor no está disponible' };
    }
    const r = await GEMINI.invoke({ jobDir, env, model: null, timeoutMs: TIMEOUT_MS, prompt: PROMPT, image: { data, mimeType } });
    if (r.timedOut) {
      auxAI.logJob({ at: new Date().toISOString(), kind: 'routine_scan', outcome: 'failed', errorClass: 'timeout', ms: Date.now() - started });
      return { ok: false, error: 'el proveedor no respondió a tiempo' };
    }
    if (r.code !== 0) {
      auxAI.logJob({ at: new Date().toISOString(), kind: 'routine_scan', outcome: 'failed', errorClass: 'provider', ms: Date.now() - started });
      return { ok: false, error: (r.stderr || r.text || 'el proveedor devolvió un error').trim().slice(0, 300) };
    }
    const parsed = extractJSON(r.text);
    if (parsed.error || typeof parsed.value !== 'object' || !parsed.value || !Array.isArray(parsed.value.days)) {
      auxAI.logJob({ at: new Date().toISOString(), kind: 'routine_scan', outcome: 'failed', errorClass: 'badjson', ms: Date.now() - started });
      return { ok: false, error: 'el proveedor no devolvió el formato esperado' };
    }
    auxAI.logJob({ at: new Date().toISOString(), kind: 'routine_scan', outcome: 'ready', ms: Date.now() - started });
    return { ok: true, value: parsed.value };
  } finally {
    fs.rmSync(jobDir, { recursive: true, force: true });
  }
}
