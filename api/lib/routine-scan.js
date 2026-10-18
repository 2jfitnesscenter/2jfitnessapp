// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
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
 *
 * Reliability (lib/ai-vision.js + lib/routine-validate.js): one transcription of the whole page; a
 * deterministic check names the doubtful rows (garbled or missing name, impossible figures, one
 * name that resembles nothing in our library); only THOSE rows are read again, in one extra call.
 */
import { runScan } from './ai-vision.js';
import { sanitizeRoutine, mergeReread } from './routine-validate.js';

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

/** The second look: only the listed rows, located by position, never the whole routine again. */
function refinePrompt(doubtful) {
  const where = doubtful.map(x => `day ${x.d + 1}, exercise ${x.e + 1}`).join('; ');
  return `This image or PDF is a workout routine or training program. An earlier reading of it was unsure about a few exercise rows. Look at the page again and re-read ONLY these rows (a "day" is the position of the training day on the page, counted from 1 in the order they appear; an "exercise" is its position inside that day, counted from 1): ${where}.

Reply with EXACTLY this JSON object and nothing else — no markdown fences, no explanation:

{"rows": [{"day": <integer>, "exercise": <integer>, "name": <string|null>, "nameEn": <string|null>, "sets": <integer|null>, "reps": <integer|null>, "weight": <number|null>, "unit": "reps"|"sec"}]}

- name: the exercise name exactly as written, in its original language. null if it is not legible.
- nameEn: the SHORT canonical English gym name of that exercise (2 to 4 words, equipment then movement, e.g. "pendulum squat", "cable front raise"). null if you cannot tell.
- sets / reps / weight: the figures printed for that row, null if absent or illegible. A timed exercise is unit "sec" with the seconds in "reps".
Never guess a name or a number you cannot read. Reply with the JSON object only.`;
}

/**
 * @param {{data: string, mimeType: string}} image — base64 payload (no `data:` prefix) + its mime type.
 * @returns {Promise<{ok: true, value: object} | {ok: false, code: string, error: string}>}
 */
export async function scanRoutineDocument({ data, mimeType, uid, signal, onPhase, sync }) {
  const image = { data, mimeType };
  return runScan({ flow: 'routine_scan', kind: 'routine_scan', uid, signal, onPhase, sync }, async session => {
    const first = await session.read(PROMPT, image, v => v && typeof v === 'object' && Array.isArray(v.days));
    if (!first.ok) return first;
    const { routine, doubtful } = sanitizeRoutine(first.value);
    if (!doubtful.length) return { ok: true, value: routine };

    onPhase?.('verifying');
    const rows = doubtful.slice(0, 12);
    const second = await session.read(refinePrompt(rows), image, v => v && typeof v === 'object' && Array.isArray(v.rows));
    if (!second.ok) {
      if (second.code === 'CANCELLED') return second;
      return { ok: true, value: routine };                    // keep the first transcription: doubtful rows stay as read, the member reviews them
    }
    for (const r of second.value.rows) {
      const d = Number(r?.day) - 1, e = Number(r?.exercise) - 1;
      const item = rows.find(x => x.d === d && x.e === e);
      const original = routine.days[d]?.exercises?.[e];
      if (!item || !original) continue;
      const reread = sanitizeRoutine({ days: [{ exercises: [r] }] }).routine.days[0].exercises[0];
      if (reread) routine.days[d].exercises[e] = mergeReread(original, reread, item.reasons);
    }
    // a row that is still nameless after the second look is not an exercise
    routine.days.forEach(day => { day.exercises = day.exercises.filter(x => x.name || x.nameEn); });
    return { ok: true, value: routine };
  });
}
