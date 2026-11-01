// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* HTTP surface of the three AI scans (bioimpedance report, routine sheet, gym machine photo).
 *
 *   POST /api/scan/start    { kind, file, externalAiConsent } → 202 { id }   (the app's one-tap flow)
 *   GET  /api/scan/status?id=  → { state: running|done|failed|cancelled, phase, result? }
 *   POST /api/scan/cancel   { id }
 *   POST /api/measurements/scan | /api/routines/scan | /api/exercises/scan-machine
 *                            the original synchronous endpoints, kept for app versions that are
 *                            still installed; they answer inside nginx's 60 s with a smaller budget.
 *
 * Every entry point enforces the same things in the same order: signed-in user, the per-file
 * consent for external AI (external-ai-scan-v1) validated HERE rather than trusted from the
 * screen, a well-formed image/PDF within the size limit. The file is never written anywhere.
 */
import { hasAiScanConsent } from './scan-consent.js';
import { scanBioimpedanceImage } from './measurements-scan.js';
import { scanRoutineDocument } from './routine-scan.js';
import { scanMachineImage } from './machine-scan.js';
import { HTTP_FOR_SCAN, SCAN_ERRORS } from './ai-vision.js';
import { startScanJob, scanJobStatus, cancelScanJob, ScanJobError } from './scan-jobs.js';

const MAX_SCAN_BYTES = 8 * 1024 * 1024;

const KINDS = {
  measurements: { run: scanBioimpedanceImage, payload: r => ({ values: r.values, review: r.review || [] }) },
  routine: { run: scanRoutineDocument, payload: r => ({ routine: r.value }) },
  machine: { run: scanMachineImage, payload: r => ({ name: r.value.name, nameEn: r.value.nameEn }) }
};
const SYNC_KIND = { 'POST /api/measurements/scan': 'measurements', 'POST /api/routines/scan': 'routine', 'POST /api/exercises/scan-machine': 'machine' };

/** body → { image } | { status, error, code } — one definition of "an acceptable scan upload". */
export function parseScanUpload(body) {
  if (!hasAiScanConsent(body)) return { status: 428, error: 'acepta el aviso antes de enviar el archivo a Gemini', code: 'SCAN_CONSENT_REQUIRED' };
  const dataUrl = typeof body?.file === 'string' ? body.file : '';
  const m = dataUrl.match(/^data:([a-zA-Z0-9.+/-]+);base64,([\s\S]+)$/);
  if (!m) return { status: 400, error: 'archivo no válido' };
  const [, mimeType, b64] = m;
  if (!/^image\//.test(mimeType) && mimeType !== 'application/pdf') return { status: 400, error: 'solo se aceptan imágenes o un PDF' };
  if (Buffer.byteLength(b64, 'base64') > MAX_SCAN_BYTES) return { status: 400, error: 'el archivo es demasiado grande' };
  return { image: { data: b64, mimeType } };
}

const failure = (json, res, r) => json(res, HTTP_FOR_SCAN[r.code] || 400, { error: r.error || SCAN_ERRORS[r.code] || SCAN_ERRORS.INTERNAL, code: r.code });

export function scanRoutes({ json, readBody, readSession }) {
  const syncHandler = key => async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
    const body = await readBody(req);
    const up = parseScanUpload(body);
    if (!up.image) return json(res, up.status, { error: up.error, code: up.code });
    const kind = KINDS[SYNC_KIND[key]];
    // If the member closes the page while we wait, stop spending provider calls on their behalf.
    const ac = new AbortController();
    res.on('close', () => { if (!res.writableFinished) ac.abort(); });
    const r = await kind.run({ ...up.image, uid: user.id, signal: ac.signal, sync: true });
    if (!r.ok) return failure(json, res, r);
    json(res, 200, kind.payload(r));
  };

  return {
    'POST /api/measurements/scan': syncHandler('POST /api/measurements/scan'),
    'POST /api/routines/scan': syncHandler('POST /api/routines/scan'),
    'POST /api/exercises/scan-machine': syncHandler('POST /api/exercises/scan-machine'),

    'POST /api/scan/start': async (req, res) => {
      const user = readSession(req);
      if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
      const body = await readBody(req);
      const kind = KINDS[String(body?.kind || '')];
      if (!kind) return json(res, 400, { error: 'tipo de lectura no válido' });
      const up = parseScanUpload(body);
      if (!up.image) return json(res, up.status, { error: up.error, code: up.code });
      try {
        const job = startScanJob({ uid: user.id, kind: body.kind, image: up.image, run: (image, ctx) => kind.run({ ...image, uid: user.id, signal: ctx.signal, onPhase: ctx.onPhase }) });
        json(res, 202, { job });
      } catch (e) {
        if (e instanceof ScanJobError) return json(res, 409, { error: e.message, code: e.code });
        throw e;
      }
    },

    'GET /api/scan/status': async (req, res) => {
      const user = readSession(req);
      if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
      const st = scanJobStatus(user.id, new URL(req.url, 'http://x').searchParams.get('id') || '');
      if (!st) return json(res, 404, { error: 'esa lectura ya no existe', code: 'GONE' });
      if (st.state === 'running') return json(res, 200, { state: 'running', phase: st.phase, elapsedMs: st.elapsedMs });
      if (st.state === 'done') return json(res, 200, { state: 'done', ...KINDS[st.kind].payload(st.result) });
      json(res, 200, { state: st.state, code: st.result?.code || 'INTERNAL', error: st.result?.error || SCAN_ERRORS.INTERNAL });
    },

    'POST /api/scan/cancel': async (req, res) => {
      const user = readSession(req);
      if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
      const body = await readBody(req);
      json(res, 200, { ok: cancelScanJob(user.id, String(body?.id || '')) });
    }
  };
}
