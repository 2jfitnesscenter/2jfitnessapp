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
import * as auxAI from './aux-ai-config.js';
import { adapterFor } from '../coach/adapters/index.js';
import { extractJSON } from '../coach/validate.js';

const TIMEOUT_MS = 60000;
const GEMINI = adapterFor('gemini');

// Keys this feature knows how to place — bodyFat/muscleMass/waterPct/visceralFat/boneMass match
// lib/measurements.js's `composition` group 1:1, and the 10 seg* keys match its `segments` group
// 1:1; `weight` is the member's own body weight, not a "measurement" in that schema, but it's on
// every one of these reports and worth a free reading.
export const SCAN_KEYS = [
  'weight', 'bodyFat', 'muscleMass', 'waterPct', 'visceralFat', 'boneMass',
  'segFatArmL', 'segFatArmR', 'segFatLegL', 'segFatLegR', 'segFatTrunk',
  'segMuscleArmL', 'segMuscleArmR', 'segMuscleLegL', 'segMuscleLegR', 'segMuscleTrunk'
];

const PROMPT = `This image or PDF is a body-composition ("bioimpedance") scan report from a fitness scale, in any language. Read the values it prints and reply with EXACTLY this JSON object and nothing else — no markdown fences, no explanation:

{"weight": <number|null>, "bodyFat": <number|null>, "muscleMass": <number|null>, "waterPct": <number|null>, "visceralFat": <number|null>, "boneMass": <number|null>, "segFatArmL": <number|null>, "segFatArmR": <number|null>, "segFatLegL": <number|null>, "segFatLegR": <number|null>, "segFatTrunk": <number|null>, "segMuscleArmL": <number|null>, "segMuscleArmR": <number|null>, "segMuscleLegL": <number|null>, "segMuscleLegR": <number|null>, "segMuscleTrunk": <number|null>}

Field meanings:
- weight: total body weight in kg.
- bodyFat: body fat percentage (a 0-60 number, e.g. 16.1 for "16.1%" or "Body fat rate").
- muscleMass: total muscle mass in kg (the report's general "muscle mass"/"masa muscular" reading — NOT the separate "skeletal muscle" figure if both are printed).
- waterPct: total body water as a PERCENTAGE of body weight (0-100). If the report only prints water in kg, divide it by the weight in kg and multiply by 100 yourself.
- visceralFat: the visceral fat grade/level/index (typically a small integer like 1-30).
- boneMass: skeletal/bone mass in kg (often labeled "bone mass", "masa ósea" or "masa esquelética").
- segFatArmL/segFatArmR/segFatLegL/segFatLegR/segFatTrunk: the segmental fat analysis section
  (labeled e.g. "Segmental fat analysis" / "Análisis de obesidad segmentario" / "Fat mass control"),
  which prints one row per body part with a PERCENTAGE next to a weight in kg (e.g. "0.5kg  116.2%")
  — read that percentage, not the kg. This is a ratio against that segment's own standard range,
  not a share of the limb's own weight, so values over 100 are normal and expected.
- segMuscleArmL/segMuscleArmR/segMuscleLegL/segMuscleLegR/segMuscleTrunk: the equivalent segmental
  MUSCLE analysis section (labeled e.g. "Muscle balance" / "Equilibrio muscular" / "Segmental muscle
  analysis"), which also prints a weight in kg next to a percentage (e.g. "9.7kg  109.0%") — here
  read the KG figure, not the percentage (the opposite of the fat fields above).
- For every segmental field: L/left and R/right refer to the report's own left/right, arm covers
  the entire arm (not forearm/upper-arm separately), leg the entire leg, trunk the torso/core row.

Use null for any field you cannot find on the report. Never guess or invent a number. Reply with the JSON object only.`;

const isFiniteNum = v => typeof v === 'number' && Number.isFinite(v);

// Keeps only the known keys, coerces to finite numbers (or null), and drops anything wildly out
// of a human range — a model hallucinating "180" for visceralFat is worse than leaving it blank.
const SEG_FAT_RANGE = [0, 250];        // a ratio against the segment's own standard range, in %
const SEG_ARM_RANGE = [0.5, 15];       // segment muscle mass, in kg — see lib/measurements.js
const SEG_LEG_RANGE = [1, 25];
const SEG_TRUNK_RANGE = [5, 50];
const RANGES = {
  weight: [20, 400], bodyFat: [1, 70], muscleMass: [5, 150], waterPct: [10, 90], visceralFat: [1, 60], boneMass: [0.5, 15],
  segFatArmL: SEG_FAT_RANGE, segFatArmR: SEG_FAT_RANGE, segFatLegL: SEG_FAT_RANGE, segFatLegR: SEG_FAT_RANGE, segFatTrunk: SEG_FAT_RANGE,
  segMuscleArmL: SEG_ARM_RANGE, segMuscleArmR: SEG_ARM_RANGE, segMuscleLegL: SEG_LEG_RANGE, segMuscleLegR: SEG_LEG_RANGE, segMuscleTrunk: SEG_TRUNK_RANGE
};
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
  if (!auxAI.isEnabled() || !auxAI.isConnected()) {
    return { ok: false, error: 'la IA auxiliar no está configurada en este servidor' };
  }
  const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aux-ai-scan-'));
  const started = Date.now();
  try {
    const env = auxAI.jobEnv();
    const check = await GEMINI.check(null, env);
    if (!check.ok) {
      auxAI.logJob({ at: new Date().toISOString(), kind: 'measurements_scan', outcome: 'failed', errorClass: 'runtime', ms: Date.now() - started });
      return { ok: false, error: check.error || 'el proveedor no está disponible' };
    }
    const r = await GEMINI.invoke({ jobDir, env, model: null, timeoutMs: TIMEOUT_MS, prompt: PROMPT, image: { data, mimeType } });
    if (r.timedOut) {
      auxAI.logJob({ at: new Date().toISOString(), kind: 'measurements_scan', outcome: 'failed', errorClass: 'timeout', ms: Date.now() - started });
      return { ok: false, error: 'el proveedor no respondió a tiempo' };
    }
    if (r.code !== 0) {
      auxAI.logJob({ at: new Date().toISOString(), kind: 'measurements_scan', outcome: 'failed', errorClass: 'provider', ms: Date.now() - started });
      return { ok: false, error: (r.stderr || r.text || 'el proveedor devolvió un error').trim().slice(0, 300) };
    }
    const parsed = extractJSON(r.text);
    if (parsed.error || typeof parsed.value !== 'object' || !parsed.value) {
      auxAI.logJob({ at: new Date().toISOString(), kind: 'measurements_scan', outcome: 'failed', errorClass: 'badjson', ms: Date.now() - started });
      return { ok: false, error: 'el proveedor no devolvió el formato esperado' };
    }
    auxAI.logJob({ at: new Date().toISOString(), kind: 'measurements_scan', outcome: 'ready', ms: Date.now() - started });
    return { ok: true, values: normalize(parsed.value) };
  } finally {
    fs.rmSync(jobDir, { recursive: true, force: true });
  }
}
