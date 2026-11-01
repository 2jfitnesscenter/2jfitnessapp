// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* Reading a photo of a single gym machine/exercise into a raw name — the same Gemini-vision
 * approach as routine-scan.js and measurements-scan.js (no OCR, one vision call), just a
 * narrower shape: one exercise instead of a whole printed routine. Matching that name against
 * the real library (or offering a picker, or falling back to a new custom exercise) happens
 * client-side — see frontend/src/lib/machine-scan.js's matchScannedMachine(), which shares
 * routine-scan.js's own matchExerciseCandidates() plumbing. This file only ever returns free
 * text; nothing here writes to the exercise library or the shared machine-alias table.
 *
 * Reliability (lib/ai-vision.js): a clean, library-recognised, confident first read is accepted as
 * is. An empty, unsure or unrecognised read gets a second look, and two reads that point to
 * different library exercises get a third as tie-break; never more than three.
 */
import { runScan } from './ai-vision.js';
import { bestLibraryMatch, MATCH_OK, norm } from './exercise-name-match.js';

const PROMPT = `This image shows a piece of gym equipment, or someone set up on/using gym equipment. Identify the SINGLE exercise this equipment is for. Reply with EXACTLY this JSON object and nothing else — no markdown fences, no explanation:

{"name": <string|null>, "nameEn": <string|null>, "confidence": <"high"|"medium"|"low">}

- name: the exercise name in Spanish, the way a gym member would say it (e.g. "Prensa de piernas", "Press de banca con mancuernas", "Jalón al pecho").
- nameEn: the same exercise's SHORT, canonical English gym name — 2 to 4 words, equipment then movement (e.g. "leg press", "dumbbell bench press", "lat pulldown"). This is only used afterwards to look the exercise up in an English-named database by name, so pick ONE specific, common name for the closest standard version of this movement rather than a literal translation or a description of exactly what's shown.

- confidence: how sure you are that this is the right exercise — "low" if the equipment is partly hidden, generic or you are guessing, "medium" if two exercises are plausible, otherwise "high".

If the image does not clearly show gym equipment or a recognisable exercise, reply with {"name": null, "nameEn": null}. Reply with the JSON object only.`;

const asReading = v => {
  const name = typeof v?.name === 'string' ? v.name.trim().slice(0, 120) : '';
  const nameEn = typeof v?.nameEn === 'string' ? v.nameEn.trim().slice(0, 120) : '';
  if (!name && !nameEn) return null;
  const match = bestLibraryMatch(nameEn, name);
  return { name: name || nameEn, nameEn: nameEn || name, confidence: ['high', 'medium', 'low'].includes(v?.confidence) ? v.confidence : null, match };
};
const sure = r => r && r.match.score >= MATCH_OK && r.confidence !== 'low';
const sameExercise = (a, b) => (a.match.id && a.match.id === b.match.id) || norm(a.nameEn) === norm(b.nameEn);
const best = list => [...list].sort((a, b) => b.match.score - a.match.score)[0];
const out = r => ({ ok: true, value: { name: r.name, nameEn: r.nameEn } });

/**
 * @param {{data: string, mimeType: string}} image — base64 payload (no `data:` prefix) + its mime type.
 * @returns {Promise<{ok: true, value: {name: string, nameEn: string}} | {ok: false, code: string, error: string}>}
 */
export async function scanMachineImage({ data, mimeType, uid, signal, onPhase, sync }) {
  const image = { data, mimeType };
  return runScan({ flow: 'machine_scan', kind: 'machine_scan', uid, signal, onPhase, sync }, async session => {
    const first = await session.read(PROMPT, image);
    if (!first.ok) return first;
    const r1 = asReading(first.value);
    if (sure(r1)) return out(r1);

    onPhase?.('verifying');
    const second = await session.read(PROMPT, image);
    const r2 = second.ok ? asReading(second.value) : null;
    if (!second.ok && second.code === 'CANCELLED') return second;
    const reads = [r1, r2].filter(Boolean);
    if (!reads.length) return second.ok ? { ok: false, code: 'NOTHING_FOUND' } : second;
    if (reads.length === 2 && sameExercise(r1, r2)) return out(best(reads));
    if (reads.length === 1) return out(reads[0]);
    // one read is a recognised, confident library exercise and the other resembles nothing in it: no need for a third opinion
    if (sure(r2) && r1.match.score < MATCH_OK) return out(r2);
    if (sure(r1) && r2.match.score < MATCH_OK) return out(r1);

    // two different answers: a third read decides by agreement, otherwise the one closest to our library
    const third = await session.read(PROMPT, image);
    const r3 = third.ok ? asReading(third.value) : null;
    if (r3) {
      const partner = reads.find(r => sameExercise(r, r3));
      if (partner) return out(best([partner, r3]));
      reads.push(r3);
    }
    return out(best(reads));
  });
}
