import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_FOLLOWUP_TEMPLATES, sanitizeQuestionnaireTemplate, makeAssignment, submitAssignment, compareProgress, followupTimeline } from './followup-v2.js';
import { canAccessMember } from './coach-followup-routes.js';

const clone = x => structuredClone(x);
const PHOTO_ID = /^[0-9a-f-]{36}\.(jpg|png|webp)$/;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const jsonFile = (file, fallback) => { try { const value = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(value) ? value : clone(fallback); } catch { return clone(fallback); } };
function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
  fs.renameSync(temp, file);
}
function decodeImage(value) {
  if (typeof value !== 'string') return null;
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(value);
  if (!match) return null;
  const buf = Buffer.from(match[2], 'base64');
  if (!buf.length || buf.length > MAX_PHOTO_BYTES) return null;
  const jpeg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const png = buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const webp = buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
  if ((match[1] === 'jpeg' && jpeg) || (match[1] === 'png' && png) || (match[1] === 'webp' && webp)) return { buf, ext: match[1] === 'jpeg' ? 'jpg' : match[1], mime: match[1] === 'jpeg' ? 'image/jpeg' : `image/${match[1]}` };
  return null;
}
const iso = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;

export function followUpV2Routes(d) {
  const { db, json, readBody, readSession, requireAdmin, requireTrainer, isAdmin, isTrainer, saveDb, readState, dataDir, followupPhotosDir } = d;
  const templatesFile = path.join(dataDir, 'followup-templates.json');
  const templates = () => jsonFile(templatesFile, DEFAULT_FOLLOWUP_TEMPLATES);
  const writeTemplates = value => atomicJson(templatesFile, value);
  const recordsFor = user => {
    if (!user.followUpV2 || typeof user.followUpV2 !== 'object' || Array.isArray(user.followUpV2)) user.followUpV2 = {};
    for (const key of ['assignments', 'responses', 'photos']) if (!Array.isArray(user.followUpV2[key])) user.followUpV2[key] = [];
    return user.followUpV2;
  };
  try {
    fs.mkdirSync(followupPhotosDir, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') fs.chmodSync(followupPhotosDir, 0o700);
  } catch { /* Upload returns a controlled error if persistent storage is unavailable. */ }
  const memberById = id => db.users.find(u => u.id === String(id || ''));
  function staffTarget(req, res, id) {
    const staff = requireTrainer(req, res); if (!staff) return null;
    const member = memberById(id);
    if (!member || isTrainer(member) || !canAccessMember(staff, member, isAdmin)) { json(res, isAdmin(staff) && !member ? 404 : 403, { error: 'prohibido' }); return null; }
    if (member.disabled) { json(res, 409, { error: 'esta cuenta está desactivada' }); return null; }
    return { staff, member };
  }
  function selfOrStaffTarget(req, res, id) {
    const actor = readSession(req); if (!actor) { json(res, 401, { error: 'no has iniciado sesión' }); return null; }
    if (!isTrainer(actor) && !isAdmin(actor)) {
      if (actor.id !== String(id || '')) { json(res, 403, { error: 'prohibido' }); return null; }
      return { actor, member: actor, self: true };
    }
    const member = memberById(id);
    if (!member || isTrainer(member) || !canAccessMember(actor, member, isAdmin)) { json(res, isAdmin(actor) && !member ? 404 : 403, { error: 'prohibido' }); return null; }
    return { actor, member, self: false };
  }
  function publicRecordView(member, S, includeTemplates = false, existingEvents = null) {
    const records = recordsFor(member);
    const photos = records.photos.map(({ id, entryId, date, type, note, mime, createdAt, createdBy }) => ({ id, entryId, date, type, note, mime, createdAt, createdBy, url: `/api/followup/photo?id=${encodeURIComponent(id)}` }));
    const existing = includeTemplates ? (existingEvents || (typeof d.existingTimeline === 'function' ? d.existingTimeline(member, S || {}) : [])) : [];
    const timeline = followupTimeline({ S: S || {}, records, shareCheckins: S?.shareCheckins === true, existing });
    return { assignments: records.assignments, responses: records.responses, photos, timeline,
      checkinsShared: S?.shareCheckins === true,
      checkins: S?.shareCheckins === true ? (S.checkins || []).slice(-30).map(c => ({ d: c.d, energy: c.energy, sleep: c.sleep, fatigue: c.fatigue, pain: c.pain === true, zones: Array.isArray(c.zones) ? c.zones : [] })) : null,
      weight: (S?.bodyweight || []).slice(-60).map(x => ({ d: x.d, value: x.w })),
      measurements: Object.fromEntries(Object.entries(S?.measurements || {}).map(([key, values]) => [key, (values || []).slice(-60).map(x => ({ d: x.d, value: x.v }))])),
      objective: S?.coach?.profile?.goal || member.followUp?.goalPlan?.label || null,
      templates: includeTemplates ? templates().filter(t => t.published && t.active).map(({ id, name, version, description }) => ({ id, name, version, description })) : undefined };
  }
  const savePhotos = (member, body, actor) => {
    const images = Array.isArray(body.images) ? body.images : [body.image];
    if (!images.length || images.length > 4) return { error: 'una entrada admite entre 1 y 4 fotos' };
    const decoded = images.map(decodeImage);
    if (decoded.some(x => !x) || decoded.reduce((n, x) => n + x.buf.length, 0) > MAX_PHOTO_BYTES) return { error: 'fotos no válidas: usa JPEG, PNG o WebP con un máximo total de 5 MB por entrada' };
    if (body.date != null && body.date !== '' && !iso(body.date)) return { error: 'fecha de foto no válida' };
    const date = iso(body.date) ? body.date : new Date().toISOString().slice(0, 10);
    const type = ['front', 'side', 'back', 'free'].includes(body.type) ? body.type : 'free';
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 300) : '';
    const entryId = crypto.randomUUID(), createdAt = new Date().toISOString();
    const saved = decoded.map(image => ({ id: `${crypto.randomUUID()}.${image.ext}`, image }));
    try {
      fs.mkdirSync(followupPhotosDir, { recursive: true, mode: 0o700 });
      if (process.platform !== 'win32') fs.chmodSync(followupPhotosDir, 0o700);
      for (const item of saved) fs.writeFileSync(path.join(followupPhotosDir, item.id), item.image.buf, { flag: 'wx', mode: 0o600 });
    } catch {
      for (const { id } of saved) try { fs.unlinkSync(path.join(followupPhotosDir, id)); } catch {}
      return { error: 'no se pudo guardar la foto' };
    }
    const records = recordsFor(member), photos = saved.map(({ id, image }) => ({ id, entryId, date, type, ...(note ? { note } : {}), mime: image.mime, createdAt, createdBy: actor.id }));
    records.photos.push(...photos);
    try { saveDb(); } catch {
      records.photos.splice(-photos.length, photos.length);
      for (const { id } of saved) try { fs.unlinkSync(path.join(followupPhotosDir, id)); } catch {}
      return { error: 'no se pudo guardar la foto' };
    }
    return { value: { entryId, photos } };
  };

  return {
    'GET /api/admin/followup/templates': async (req, res) => {
      if (!requireAdmin(req, res)) return;
      json(res, 200, { templates: templates().sort((a, b) => a.order - b.order) });
    },
    'POST /api/admin/followup/templates/save': async (req, res) => {
      const admin = requireAdmin(req, res); if (!admin) return;
      const body = await readBody(req), list = templates();
      const old = body.template?.id ? list.find(x => x.id === body.template.id) : null;
      const clean = sanitizeQuestionnaireTemplate(body.template, old);
      if (clean.error) return json(res, 400, { error: clean.error });
      if (!old && list.some(x => x.id === clean.value.id)) return json(res, 409, { error: 'ya existe una plantilla con ese id' });
      const next = old ? list.map(x => x.id === old.id ? clean.value : x) : [...list, clean.value];
      writeTemplates(next); json(res, 200, { template: clean.value });
    },
    'POST /api/admin/followup/templates/duplicate': async (req, res) => {
      const admin = requireAdmin(req, res); if (!admin) return;
      const body = await readBody(req), list = templates(), source = list.find(x => x.id === body.id);
      if (!source) return json(res, 404, { error: 'plantilla no encontrada' });
      const copy = { ...clone(source), id: crypto.randomUUID(), name: `${source.name} (copia)`, version: 1, published: false, active: true, order: list.length };
      list.push(copy); writeTemplates(list); json(res, 200, { template: copy });
    },
    'POST /api/admin/followup/templates/publish': async (req, res) => {
      const admin = requireAdmin(req, res); if (!admin) return;
      const body = await readBody(req), list = templates(), item = list.find(x => x.id === body.id);
      if (!item) return json(res, 404, { error: 'plantilla no encontrada' });
      item.published = body.published === true; item.active = body.active !== false; writeTemplates(list); json(res, 200, { template: item });
    },
    'POST /api/admin/followup/templates/reorder': async (req, res) => {
      const admin = requireAdmin(req, res); if (!admin) return;
      const body = await readBody(req), list = templates();
      if (!Array.isArray(body.ids) || body.ids.length !== list.length || new Set(body.ids).size !== list.length || body.ids.some(id => !list.some(t => t.id === id))) return json(res, 400, { error: 'orden no válido' });
      const order = new Map(body.ids.map((id, i) => [id, i])); list.forEach(t => { t.order = order.get(t.id); }); writeTemplates(list); json(res, 200, { ok: true });
    },
    'GET /api/followup/records': async (req, res) => {
      const actor = readSession(req); if (!actor) return json(res, 401, { error: 'no has iniciado sesión' });
      if (isTrainer(actor) || isAdmin(actor)) return json(res, 403, { error: 'usa la vista de seguimiento del entrenador' });
      let S = null; try { S = readState(actor.id); } catch { return json(res, 503, { error: 'no se pudo leer el seguimiento' }); }
      json(res, 200, publicRecordView(actor, S, false));
    },
    'GET /api/trainer/followup/records': async (req, res) => {
      const id = new URL(req.url, 'http://x').searchParams.get('id');
      const a = staffTarget(req, res, id); if (!a) return;
      let S = null; try { S = readState(a.member.id); } catch { return json(res, 503, { error: 'no se pudo leer el seguimiento' }); }
      const existing = typeof d.existingTimeline === 'function' ? d.existingTimeline(a.member, S || {}) : [];
      const out = publicRecordView(a.member, S, true, existing);
      const range = new URL(req.url, 'http://x').searchParams;
      out.comparison = range.has('from') || range.has('to') ? compareProgress(S || {}, recordsFor(a.member), range.get('from'), range.get('to'), existing) : null;
      json(res, 200, out);
    },
    'POST /api/trainer/followup/questionnaire/assign': async (req, res) => {
      const body = await readBody(req), a = staffTarget(req, res, body.memberId); if (!a) return;
      const item = templates().find(x => x.id === body.templateId && x.published && x.active);
      if (!item) return json(res, 404, { error: 'plantilla publicada no encontrada' });
      if (a.member.disabled) return json(res, 409, { error: 'esta cuenta está desactivada' });
      const records = recordsFor(a.member); const assignment = makeAssignment(item, a.staff.id);
      records.assignments.push(assignment); saveDb(); json(res, 200, { assignment });
    },
    'GET /api/followup/questionnaires': async (req, res) => {
      const actor = readSession(req); if (!actor) return json(res, 401, { error: 'no has iniciado sesión' });
      if (isTrainer(actor) || isAdmin(actor)) return json(res, 403, { error: 'solo disponible para socios' });
      const records = recordsFor(actor);
      json(res, 200, { assignments: records.assignments, responses: records.responses });
    },
    'POST /api/followup/questionnaire/submit': async (req, res) => {
      const actor = readSession(req); if (!actor) return json(res, 401, { error: 'no has iniciado sesión' });
      if (isTrainer(actor) || isAdmin(actor) || actor.disabled) return json(res, 403, { error: 'solo disponible para socios activos' });
      const body = await readBody(req), records = recordsFor(actor);
      const result = submitAssignment(records, body.assignmentId, body.answers, actor.id);
      if (result.error) return json(res, result.status, { error: result.error });
      actor.followUpV2 = result.value; saveDb(); json(res, 200, { ok: true, response: result.value.responses.at(-1) });
    },
    'POST /api/followup/photo': async (req, res) => {
      const actor = readSession(req); if (!actor) return json(res, 401, { error: 'no has iniciado sesión' });
      if (isTrainer(actor) || isAdmin(actor)) return json(res, 403, { error: 'las fotos se suben desde la cuenta del socio' });
      if (actor.disabled) return json(res, 403, { error: 'cuenta desactivada' });
      const body = await readBody(req);
      const result = savePhotos(actor, body, actor);
      if (result.error) return json(res, 400, { error: result.error });
      json(res, 201, { entryId: result.value.entryId, photos: result.value.photos.map(photo => ({ ...photo, url: `/api/followup/photo?id=${encodeURIComponent(photo.id)}` })) });
    },
    'GET /api/followup/photo': async (req, res) => {
      const actor = readSession(req); if (!actor) return json(res, 401, { error: 'no has iniciado sesión' });
      const id = new URL(req.url, 'http://x').searchParams.get('id') || '';
      if (!PHOTO_ID.test(id)) return json(res, 404, { error: 'foto no encontrada' });
      const member = db.users.find(u => u.followUpV2?.photos?.some(p => p.id === id));
      if (!member) return json(res, 404, { error: 'foto no encontrada' });
      const allowed = actor.id === member.id && !isTrainer(actor) && !isAdmin(actor) || (isTrainer(actor) || isAdmin(actor)) && canAccessMember(actor, member, isAdmin);
      if (!allowed) return json(res, 404, { error: 'foto no encontrada' });
      const photo = member.followUpV2.photos.find(p => p.id === id);
      try {
        const buf = fs.readFileSync(path.join(followupPhotosDir, id));
        res.writeHead(200, { 'Content-Type': photo.mime, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Length': buf.length }); res.end(buf);
      } catch { json(res, 404, { error: 'foto no encontrada' }); }
    },
  };
}
