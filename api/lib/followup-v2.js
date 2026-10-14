// Additive questionnaire/photo records for the existing Follow-up feature.
// Timelines and comparisons are projections of the state stores, never a second history engine.
import crypto from 'node:crypto';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const TYPES = new Set(['short_text', 'long_text', 'number', 'yes_no', 'single', 'multiple', 'scale', 'date']);
const clone = value => structuredClone(value);

const question = (id, label, type, extra = {}) => ({ id, label, type, required: false, active: true, ...extra });
export const DEFAULT_FOLLOWUP_TEMPLATES = Object.freeze([
  { id: 'basic', name: 'Básico', description: 'Objetivo y disponibilidad', version: 1, published: true, active: true, order: 0, questions: [
    question('goal', '¿Cuál es tu objetivo principal?', 'long_text', { required: true }),
    question('experience', '¿Cuánto tiempo llevas entrenando?', 'single', { options: ['Estoy empezando', 'Menos de un año', '1–3 años', 'Más de 3 años'] }),
    question('days', '¿Cuántos días puedes entrenar por semana?', 'number', { min: 1, max: 7 }),
    question('session_minutes', '¿Cuánto tiempo tienes por sesión?', 'number', { min: 10, max: 300 }),
    question('limitations', '¿Hay algo que debamos tener en cuenta para adaptar el entrenamiento?', 'long_text'),
  ] },
  { id: 'intermediate', name: 'Intermedio', description: 'Añade contexto de actividad y preferencias', version: 1, published: true, active: true, order: 1, questions: [
    question('goal', '¿Cuál es tu objetivo principal?', 'long_text', { required: true }),
    question('experience', '¿Cuánto tiempo llevas entrenando?', 'single', { options: ['Estoy empezando', 'Menos de un año', '1–3 años', 'Más de 3 años'] }),
    question('days', '¿Cuántos días puedes entrenar por semana?', 'number', { min: 1, max: 7 }),
    question('session_minutes', '¿Cuánto tiempo tienes por sesión?', 'number', { min: 10, max: 300 }),
    question('limitations', '¿Hay molestias o limitaciones que debamos considerar?', 'long_text'),
    question('other_activity', '¿Practicas otro deporte o actividad?', 'short_text'),
    question('preferences', '¿Qué tipo de entrenamiento prefieres?', 'multiple', { options: ['Fuerza', 'Cardio', 'Movilidad', 'Clases', 'Aire libre'] }),
  ] },
  { id: 'pro', name: 'Pro', description: 'Contexto ampliado para planificar', version: 1, published: true, active: true, order: 2, questions: [
    question('goal', '¿Cuál es tu objetivo principal y cómo sabrás que avanzas?', 'long_text', { required: true }),
    question('experience', '¿Cuánto tiempo llevas entrenando y qué has practicado?', 'long_text'),
    question('availability', '¿Qué días sueles tener disponibles?', 'multiple', { options: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'] }),
    question('session_minutes', '¿Cuánto tiempo tienes por sesión?', 'number', { min: 10, max: 300 }),
    question('limitations', '¿Hay molestias o limitaciones que quieras que tengamos en cuenta?', 'long_text'),
    question('other_activity', '¿Qué actividad deportiva adicional haces y con qué frecuencia?', 'long_text'),
    question('preferences', '¿Qué prefieres priorizar?', 'multiple', { options: ['Fuerza', 'Cardio', 'Movilidad', 'Rendimiento deportivo', 'Salud general'] }),
    question('notes', '¿Hay algo más que quieras comentar?', 'long_text'),
  ] },
]);

export function sanitizeQuestionnaireTemplate(input, previous = null) {
  if (!input || typeof input !== 'object') return { error: 'plantilla no válida' };
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, 80) : '';
  if (!name) return { error: 'la plantilla necesita un nombre' };
  if (!Array.isArray(input.questions) || input.questions.length > 60) return { error: 'la plantilla debe tener hasta 60 preguntas' };
  const ids = new Set();
  const questions = [];
  for (const raw of input.questions) {
    const id = typeof raw?.id === 'string' && /^[a-zA-Z0-9_-]{1,48}$/.test(raw.id) ? raw.id : '';
    const label = typeof raw?.label === 'string' ? raw.label.trim().slice(0, 240) : '';
    if (!id || ids.has(id) || !label || !TYPES.has(raw?.type)) return { error: 'pregunta no válida' };
    ids.add(id);
    const options = Array.isArray(raw.options) ? [...new Set(raw.options.filter(x => typeof x === 'string').map(x => x.trim().slice(0, 100)).filter(Boolean))].slice(0, 30) : [];
    if (['single', 'multiple'].includes(raw.type) && options.length < 2) return { error: 'las preguntas de selección necesitan al menos dos opciones' };
    const min = Number.isFinite(Number(raw.min)) ? Number(raw.min) : (raw.type === 'scale' ? 1 : undefined);
    const max = Number.isFinite(Number(raw.max)) ? Number(raw.max) : (raw.type === 'scale' ? 5 : undefined);
    if (raw.type === 'scale' && !(max > min && max - min <= 100)) return { error: 'escala no válida' };
    questions.push({ id, label, type: raw.type, required: raw.required === true, active: raw.active !== false, shareWithCoach: raw.shareWithCoach === true,
      ...(options.length ? { options } : {}), ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) });
  }
  return { value: { id: previous?.id || (typeof input.id === 'string' && /^[a-zA-Z0-9_-]{1,48}$/.test(input.id) ? input.id : crypto.randomUUID()),
    name, description: typeof input.description === 'string' ? input.description.trim().slice(0, 240) : '',
    version: (previous?.version || 0) + 1, published: input.published === true, active: input.active !== false,
    order: Number.isFinite(input.order) ? Math.max(0, Math.min(999, Math.floor(input.order))) : previous?.order || 0, questions } };
}

export function validateQuestionnaireAnswers(snapshot, answers) {
  if (!snapshot || !Array.isArray(snapshot.questions) || !answers || typeof answers !== 'object' || Array.isArray(answers)) return { error: 'respuestas no válidas' };
  const out = {};
  for (const q of snapshot.questions) {
    if (!q.active) continue;
    const value = answers[q.id];
    const missing = value == null || value === '' || (Array.isArray(value) && !value.length);
    if (q.required && missing) return { error: `falta responder: ${q.label}` };
    if (missing) continue;
    if (q.type === 'short_text' || q.type === 'long_text') {
      if (typeof value !== 'string' || value.length > (q.type === 'short_text' ? 240 : 2000)) return { error: `respuesta no válida: ${q.label}` };
      out[q.id] = value.trim();
    } else if (q.type === 'number' || q.type === 'scale') {
      const n = Number(value); if (!Number.isFinite(n) || (q.min != null && n < q.min) || (q.max != null && n > q.max)) return { error: `respuesta no válida: ${q.label}` };
      out[q.id] = n;
    } else if (q.type === 'yes_no') {
      if (typeof value !== 'boolean') return { error: `respuesta no válida: ${q.label}` }; out[q.id] = value;
    } else if (q.type === 'date') {
      if (typeof value !== 'string' || !ISO.test(value) || Number.isNaN(Date.parse(value + 'T00:00:00Z'))) return { error: `respuesta no válida: ${q.label}` }; out[q.id] = value;
    } else if (q.type === 'single') {
      if (typeof value !== 'string' || !q.options?.includes(value)) return { error: `respuesta no válida: ${q.label}` }; out[q.id] = value;
    } else if (q.type === 'multiple') {
      if (!Array.isArray(value) || value.length > q.options?.length || value.some(x => !q.options.includes(x))) return { error: `respuesta no válida: ${q.label}` };
      out[q.id] = [...new Set(value)];
    }
  }
  return { value: out };
}

export function makeAssignment(template, by, at = new Date().toISOString()) {
  const snapshot = { id: template.id, name: template.name, version: template.version,
    questions: template.questions.filter(q => q.active).map(q => ({ ...q })) };
  return { id: crypto.randomUUID(), templateId: template.id, templateVersion: template.version, snapshot,
    status: 'pending', assignedAt: at, assignedBy: by };
}

export function submitAssignment(records, assignmentId, answers, by, at = new Date().toISOString()) {
  const assignments = records.assignments || [];
  const assignment = assignments.find(x => x.id === assignmentId);
  if (!assignment) return { error: 'cuestionario no encontrado', status: 404 };
  if (assignment.status === 'completed' || (records.responses || []).some(x => x.assignmentId === assignmentId)) return { error: 'este cuestionario ya se ha enviado', status: 409 };
  const valid = validateQuestionnaireAnswers(assignment.snapshot, answers);
  if (valid.error) return { error: valid.error, status: 400 };
  const response = { id: crypto.randomUUID(), assignmentId, templateId: assignment.templateId,
    templateVersion: assignment.templateVersion, snapshot: clone(assignment.snapshot), answers: valid.value,
    completedAt: at, userId: by };
  return { value: { ...records, assignments: assignments.map(a => a.id === assignmentId ? { ...a, status: 'completed', completedAt: at } : a),
    responses: [...(records.responses || []), response] } };
}

const COACH_SENSITIVE = /lesi[oó]n|molestia|dolor|enfermed|medic|patolog|diagn[oó]st|historia cl[ií]nica|health|injur|pain|medical|condition|notes?|observaciones|limitaciones|nombre|\bname\b|email|correo|tel[eé]fono|phone|direcci[oó]n|address|nacimiento|birth|documento|identity/i;
const coachValue = (value, type) => {
  // Never send member-authored free text to Coach, even when a template question
  // was curated. Closed-choice values and numeric/boolean answers are bounded.
  if (type === 'long_text' || type === 'short_text' || type === 'date') return null;
  if (type === 'single' && typeof value === 'string') return value.slice(0, 80);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  if (type === 'multiple' && Array.isArray(value)) return value.filter(x => typeof x === 'string').slice(0, 5).map(x => x.slice(0, 80));
  return null;
};
/** Explicitly curated questionnaire facts only; the caller must first verify the member's existing Coach consent. */
export function coachSafeIntake(records) {
  const response = [...(records?.responses || [])].reverse().find(x => x?.snapshot?.questions && x?.answers);
  if (!response) return [];
  const allowed = [];
  for (const q of response.snapshot.questions) {
    if (!q.shareWithCoach || !q.active || COACH_SENSITIVE.test(`${q.id} ${q.label}`)) continue;
    const value = coachValue(response.answers[q.id], q.type);
    if (value == null || value === '') continue;
    allowed.push({ question: q.label.slice(0, 80), answer: value });
    if (allowed.length >= 6) break;
  }
  return allowed;
}

/** Existing Coach consent is required before any curated questionnaire answers are considered. */
export function consentedCoachIntake(state, records) {
  return state?.coach?.consent?.agreedAt && state.coach.consent.version === 1 ? coachSafeIntake(records) : [];
}

const validDate = x => typeof x === 'string' && ISO.test(x) && !Number.isNaN(Date.parse(x + 'T00:00:00Z')) && new Date(x + 'T00:00:00Z').toISOString().slice(0, 10) === x;
export function compareProgress(S, records, from, to, goalHistory = []) {
  if (!validDate(from) || !validDate(to) || from >= to) return { error: 'elige dos fechas válidas y distintas' };
  const at = list => {
    let best = null;
    for (const x of Array.isArray(list) ? list : []) if (validDate(x?.d) && x.d <= to && (!best || x.d > best.d)) best = x;
    return best;
  };
  const keys = new Set(Object.keys(S?.measurements || {}));
  const measurements = {};
  for (const key of keys) {
    const a = at((S.measurements[key] || []).filter(x => x.d <= from));
    const b = at(S.measurements[key]);
    if (a || b) measurements[key] = { from: a ? { date: a.d, value: a.v } : null, to: b ? { date: b.d, value: b.v } : null,
      delta: a && b && Number.isFinite(a.v) && Number.isFinite(b.v) ? Math.round((b.v - a.v) * 10) / 10 : null };
  }
  const weightA = at((S?.bodyweight || []).filter(x => x.d <= from));
  const weightB = at(S?.bodyweight);
  const goalChanges = (Array.isArray(goalHistory) ? goalHistory : []).filter(x => x?.kind === 'goal_changed' && x.goal && validDate(x.d)).sort((a, b) => a.d.localeCompare(b.d));
  const goalAt = date => {
    const prior = goalChanges.filter(x => x.d <= date).at(-1);
    if (prior) return prior.goal.after;
    return goalChanges.find(x => x.d > date)?.goal.before || null;
  };
  const goalFrom = goalAt(from), goalTo = goalAt(to);
  const responses = (records?.responses || []).filter(x => x.completedAt?.slice(0, 10) <= to);
  const photos = (records?.photos || []).filter(x => x.date >= from && x.date <= to).map(({ id, entryId, date, type, note, mime, createdAt }) => ({ id, entryId, date, type, note, mime, createdAt }));
  return { value: { from, to, weight: { from: weightA ? { date: weightA.d, value: weightA.w } : null,
    to: weightB && weightB.d <= to ? { date: weightB.d, value: weightB.w } : null,
    delta: weightA && weightB && weightB.d <= to ? Math.round((weightB.w - weightA.w) * 10) / 10 : null },
    measurements, goal: { from: goalFrom, to: goalTo, changed: JSON.stringify(goalFrom) !== JSON.stringify(goalTo) }, photos,
    questionnaireResponses: responses.map(r => ({ date: r.completedAt.slice(0, 10), template: r.snapshot.name, version: r.templateVersion })) } };
}

export function followupTimeline({ S = {}, records = {}, shareCheckins = false, existing = [] }) {
  const out = existing.map(x => ({ ...x, d: typeof x.d === 'string' ? x.d.slice(0, 10) : x.d }));
  for (const response of records.responses || []) out.push({ d: response.completedAt?.slice(0, 10), kind: 'questionnaire_completed', ref: { id: response.id, name: response.snapshot?.name, version: response.templateVersion } });
  const photoEntries = new Map();
  for (const photo of records.photos || []) {
    const id = photo.entryId || photo.id;
    if (!photoEntries.has(id)) photoEntries.set(id, { d: photo.date, kind: 'progress_photo', ref: { id, type: photo.type, count: 0 } });
    photoEntries.get(id).ref.count++;
  }
  out.push(...photoEntries.values());
  for (const [key, list] of Object.entries(S.measurements || {})) for (const m of list || []) out.push({ d: m.d, kind: 'measurement', ref: { key } });
  for (const w of S.bodyweight || []) out.push({ d: w.d, kind: 'weight_measurement' });
  if (shareCheckins) for (const c of S.checkins || []) out.push({ d: c.d, kind: 'checkin' });
  return out.filter(x => validDate(x.d)).sort((a, b) => (b.at || b.d).localeCompare(a.at || a.d)).slice(0, 80);
}
