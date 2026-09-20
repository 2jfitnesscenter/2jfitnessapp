/* Reading a photo of a single gym machine/exercise into a raw name — the same Gemini-vision
 * approach as routine-scan.js and measurements-scan.js (no OCR, one vision call), just a
 * narrower shape: one exercise instead of a whole printed routine. Matching that name against
 * the real library (or offering a picker, or falling back to a new custom exercise) happens
 * client-side — see frontend/src/lib/machine-scan.js's matchScannedMachine(), which shares
 * routine-scan.js's own matchExerciseCandidates() plumbing. This file only ever returns free
 * text; nothing here writes to the exercise library or the shared machine-alias table.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as auxAI from './aux-ai-config.js';
import { adapterFor } from '../coach/adapters/index.js';
import { extractJSON } from '../coach/validate.js';

const TIMEOUT_MS = 60000;
const GEMINI = adapterFor('gemini');

const PROMPT = `This image shows a piece of gym equipment, or someone set up on/using gym equipment. Identify the SINGLE exercise this equipment is for. Reply with EXACTLY this JSON object and nothing else — no markdown fences, no explanation:

{"name": <string|null>, "nameEn": <string|null>}

- name: the exercise name in Spanish, the way a gym member would say it (e.g. "Prensa de piernas", "Press de banca con mancuernas", "Jalón al pecho").
- nameEn: the same exercise's SHORT, canonical English gym name — 2 to 4 words, equipment then movement (e.g. "leg press", "dumbbell bench press", "lat pulldown"). This is only used afterwards to look the exercise up in an English-named database by name, so pick ONE specific, common name for the closest standard version of this movement rather than a literal translation or a description of exactly what's shown.

If the image does not clearly show gym equipment or a recognisable exercise, reply with {"name": null, "nameEn": null}. Reply with the JSON object only.`;

/**
 * @param {{data: string, mimeType: string}} image — base64 payload (no `data:` prefix) + its mime type.
 * @returns {Promise<{ok: true, value: {name: string, nameEn: string}} | {ok: false, error: string}>}
 */
export async function scanMachineImage({ data, mimeType }) {
  if (!auxAI.isEnabled() || !auxAI.isConnected()) {
    return { ok: false, error: 'la IA auxiliar no está configurada en este servidor' };
  }
  const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aux-ai-scan-'));
  const started = Date.now();
  try {
    const env = auxAI.jobEnv();
    const check = await GEMINI.check(null, env);
    if (!check.ok) {
      auxAI.logJob({ at: new Date().toISOString(), kind: 'machine_scan', outcome: 'failed', errorClass: 'runtime', ms: Date.now() - started });
      return { ok: false, error: check.error || 'el proveedor no está disponible' };
    }
    const r = await GEMINI.invoke({ jobDir, env, model: null, timeoutMs: TIMEOUT_MS, prompt: PROMPT, image: { data, mimeType } });
    if (r.timedOut) {
      auxAI.logJob({ at: new Date().toISOString(), kind: 'machine_scan', outcome: 'failed', errorClass: 'timeout', ms: Date.now() - started });
      return { ok: false, error: 'el proveedor no respondió a tiempo' };
    }
    if (r.code !== 0) {
      auxAI.logJob({ at: new Date().toISOString(), kind: 'machine_scan', outcome: 'failed', errorClass: 'provider', ms: Date.now() - started });
      return { ok: false, error: (r.stderr || r.text || 'el proveedor devolvió un error').trim().slice(0, 300) };
    }
    const parsed = extractJSON(r.text);
    if (parsed.error || typeof parsed.value !== 'object' || !parsed.value) {
      auxAI.logJob({ at: new Date().toISOString(), kind: 'machine_scan', outcome: 'failed', errorClass: 'badjson', ms: Date.now() - started });
      return { ok: false, error: 'el proveedor no devolvió el formato esperado' };
    }
    if (!parsed.value.name) {
      auxAI.logJob({ at: new Date().toISOString(), kind: 'machine_scan', outcome: 'nochange', ms: Date.now() - started });
      return { ok: false, error: 'no se reconoció ninguna máquina o ejercicio en la imagen' };
    }
    auxAI.logJob({ at: new Date().toISOString(), kind: 'machine_scan', outcome: 'ready', ms: Date.now() - started });
    return { ok: true, value: { name: String(parsed.value.name), nameEn: String(parsed.value.nameEn || parsed.value.name) } };
  } finally {
    fs.rmSync(jobDir, { recursive: true, force: true });
  }
}
