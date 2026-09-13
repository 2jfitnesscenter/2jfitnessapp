/* Reading a bioimpedance report (photo or PDF) into structured measurement values.
 *
 * There is no OCR here on purpose — a first attempt at a deterministic text-layer parser (for
 * PDFs specifically) turned out to be a dead end: an export from a real scale app is typically
 * one big rasterized screenshot wrapped in a PDF page, not real text, so `pdf-parse` came back
 * empty. Gemini reads a PDF the same way it reads a photo (each page becomes a frame internally,
 * see adapters/gemini.js's `inlineData` part), so one vision call covers both input kinds — this
 * only has to own the prompt and the response shape, not two different extraction strategies.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as cfgStore from '../coach/config.js';
import { adapterFor } from '../coach/adapters/index.js';
import { extractJSON } from '../coach/validate.js';

const TIMEOUT_MS = 60000;

// Keys this feature knows how to place — bodyFat/muscleMass/waterPct/visceralFat/boneMass match
// lib/measurements.js's `composition` group 1:1; `weight` is the member's own body weight, not a
// "measurement" in that schema, but it's on every one of these reports and worth a free reading.
export const SCAN_KEYS = ['weight', 'bodyFat', 'muscleMass', 'waterPct', 'visceralFat', 'boneMass'];

const PROMPT = `This image or PDF is a body-composition ("bioimpedance") scan report from a fitness scale, in any language. Read the values it prints and reply with EXACTLY this JSON object and nothing else — no markdown fences, no explanation:

{"weight": <number|null>, "bodyFat": <number|null>, "muscleMass": <number|null>, "waterPct": <number|null>, "visceralFat": <number|null>, "boneMass": <number|null>}

Field meanings:
- weight: total body weight in kg.
- bodyFat: body fat percentage (a 0-60 number, e.g. 16.1 for "16.1%" or "Body fat rate").
- muscleMass: total muscle mass in kg (the report's general "muscle mass"/"masa muscular" reading — NOT the separate "skeletal muscle" figure if both are printed).
- waterPct: total body water as a PERCENTAGE of body weight (0-100). If the report only prints water in kg, divide it by the weight in kg and multiply by 100 yourself.
- visceralFat: the visceral fat grade/level/index (typically a small integer like 1-30).
- boneMass: skeletal/bone mass in kg (often labeled "bone mass", "masa ósea" or "masa esquelética").

Use null for any field you cannot find on the report. Never guess or invent a number. Reply with the JSON object only.`;

const isFiniteNum = v => typeof v === 'number' && Number.isFinite(v);

// Keeps only the known keys, coerces to finite numbers (or null), and drops anything wildly out
// of a human range — a model hallucinating "180" for visceralFat is worse than leaving it blank.
const RANGES = { weight: [20, 400], bodyFat: [1, 70], muscleMass: [5, 150], waterPct: [10, 90], visceralFat: [1, 60], boneMass: [0.5, 15] };
function normalize(raw) {
  const values = {};
  for (const key of SCAN_KEYS) {
    const v = raw?.[key];
    const num = typeof v === 'string' ? Number(v) : v;
    if (!isFiniteNum(num)) { values[key] = null; continue; }
    const [lo, hi] = RANGES[key];
    values[key] = num >= lo && num <= hi ? Math.round(num * 10) / 10 : null;
  }
  return values;
}

/**
 * @param {{data: string, mimeType: string}} image — base64 payload (no `data:` prefix) + its mime type.
 * @returns {Promise<{ok: true, values: object} | {ok: false, error: string}>}
 */
export async function scanBioimpedanceImage({ data, mimeType }) {
  if (!cfgStore.isEnabled() || !cfgStore.isConnected()) {
    return { ok: false, error: 'el Coach de IA no está configurado en este servidor' };
  }
  const cfg = cfgStore.load();
  if (cfg.provider !== 'gemini') {
    return { ok: false, error: 'el escaneo de informes solo funciona con Gemini como proveedor del Coach por ahora' };
  }
  const adapter = adapterFor(cfg.provider);
  const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-scan-'));
  try {
    const env = cfgStore.jobEnv(jobDir);
    const check = await adapter.check(cfg, env);
    if (!check.ok) return { ok: false, error: check.error || 'el proveedor no está disponible' };
    const r = await adapter.invoke({ cfg, jobDir, env, model: cfg.model || null, timeoutMs: TIMEOUT_MS, prompt: PROMPT, image: { data, mimeType } });
    if (r.timedOut) return { ok: false, error: 'el proveedor no respondió a tiempo' };
    if (r.code !== 0) return { ok: false, error: (r.stderr || r.text || 'el proveedor devolvió un error').trim().slice(0, 300) };
    const parsed = extractJSON(r.text);
    if (parsed.error || typeof parsed.value !== 'object' || !parsed.value) {
      return { ok: false, error: 'el proveedor no devolvió el formato esperado' };
    }
    return { ok: true, values: normalize(parsed.value) };
  } finally {
    fs.rmSync(jobDir, { recursive: true, force: true });
  }
}
