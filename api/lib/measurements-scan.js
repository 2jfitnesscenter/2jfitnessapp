// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* Reading a bioimpedance report (photo or PDF) into structured measurement values.
 *
 * There is no OCR here on purpose — a first attempt at a deterministic text-layer parser (for
 * PDFs specifically) turned out to be a dead end: an export from a real scale app is typically
 * one big rasterized screenshot wrapped in a PDF page, not real text, so `pdf-parse` came back
 * empty. Gemini reads a PDF the same way it reads a photo (each page becomes a frame internally,
 * see adapters/gemini.js's `inlineData` part), so one vision call covers both input kinds — this
 * only has to own the prompt and the response shape, not two different extraction strategies.
 */

import { runScan } from './ai-vision.js';
import { SCAN_KEYS, normalizeReading, assessReading, mergeReadings } from './measurements-consensus.js';

export { SCAN_KEYS };

const PROMPT = `This image or PDF is a body-composition ("bioimpedance") scan report from a fitness scale, in any language. Read the values it prints and reply with EXACTLY this JSON object and nothing else — no markdown fences, no explanation:

{"weight": <number|null>, "bodyFat": <number|null>, "muscleMass": <number|null>, "waterPct": <number|null>, "visceralFat": <number|null>, "boneMass": <number|null>, "segFatArmL": <number|null>, "segFatArmR": <number|null>, "segFatLegL": <number|null>, "segFatLegR": <number|null>, "segFatTrunk": <number|null>, "segMuscleArmL": <number|null>, "segMuscleArmR": <number|null>, "segMuscleLegL": <number|null>, "segMuscleLegR": <number|null>, "segMuscleTrunk": <number|null>, "confidence": <"high"|"medium"|"low">}

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

- confidence: how clearly you could read the printed numbers — "low" if the photo is blurry, cropped, has glare or hides part of the report, "medium" if some digits are uncertain, otherwise "high".

Use null for any field you cannot find on the report. Never guess or invent a number. Reply with the JSON object only.`;

/**
 * One user action, as many internal reads as the photo needs and no more:
 *   read 1 clean (in range, core fields present, the physical cross-checks hold, the model is
 *   sure)                                  → accept it, STOP;
 *   anything doubtful                       → read 2, merge per field;
 *   the two reads still disagree somewhere  → read 3, per-field majority;
 *   no majority for a field                 → that field is null and named in `review`.
 * If the extra reads cannot be had (provider down for good), read 1 is returned with every field
 * that took part in a failed physical check blanked — never a guess.
 *
 * @param {{data: string, mimeType: string}} image — base64 payload (no `data:` prefix) + its mime type.
 * @returns {Promise<{ok: true, values: object, review: string[]} | {ok: false, code: string, error: string}>}
 */
export async function scanBioimpedanceImage({ data, mimeType, uid, signal, onPhase, sync }) {
  const image = { data, mimeType };
  return runScan({ flow: 'measurement_scan', kind: 'measurements_scan', uid, signal, onPhase, sync }, async session => {
    const first = await session.read(PROMPT, image);
    if (!first.ok) return first;
    const r1 = normalizeReading(first.value);
    const a1 = assessReading(r1);
    if (!a1.suspicious) return { ok: true, values: r1.values, review: [] };

    onPhase?.('verifying');
    const reads = [r1.values];
    const second = await session.read(PROMPT, image);
    if (!second.ok) {
      if (second.code === 'CANCELLED') return second;
      // The provider will not give a second opinion: keep only what nothing contradicts.
      const values = { ...r1.values };
      const doubtful = new Set(a1.failedKeys);
      if (r1.confidence === 'low') for (const k of Object.keys(values)) doubtful.add(k);
      for (const k of doubtful) if (values[k] != null) values[k] = null;
      const kept = Object.values(values).some(v => v != null);
      return kept ? { ok: true, values, review: [...doubtful].filter(k => r1.values[k] != null) } : second;
    }
    reads.push(normalizeReading(second.value).values);
    let merged = mergeReadings(reads);
    if (merged.conflicts.length) {
      const third = await session.read(PROMPT, image);
      if (third.ok) { reads.push(normalizeReading(third.value).values); merged = mergeReadings(reads); }
    }
    const values = merged.values;
    const kept = Object.values(values).some(v => v != null);
    if (!kept) return { ok: false, code: 'UNREADABLE' };
    return { ok: true, values, review: merged.review };
  }).then(r => r.ok ? { ok: true, values: r.values, review: r.review || [] } : r);
}
