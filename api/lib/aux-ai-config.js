/* Credential/config store for 2J's "auxiliary AI" — a THIRD, independent AI profile, separate
 * from both the member-facing Coach (./coach/config.js) and the trainer panel's "Generate with
 * AI" (./coach/trainer-ai.js). Same isolation reasoning as trainer-ai.js: own file on disk, own
 * encryption namespace (still derived from the same ./data/secret via lib/crypto.js's
 * per-feature HKDF info string, so a leaked blob from one feature is never decryptable with
 * another's key), own credential, own usage log. Nothing here ever shares state with the other
 * two — no conversation, no prompt, no job history crosses between them.
 *
 * Always Google Gemini (an API key, the same generic "apikey" auth shape config.js's Coach
 * already supports for that provider) — there is no provider picker here, mirroring why
 * trainer-ai.js has none for Claude. `capabilities` is a declared, closed list of what this
 * profile is allowed to be asked to do. It started with one (exercise_import_matching) and now
 * also covers the three vision scanners that used to piggyback on the member-facing Coach's own
 * provider choice (api/lib/machine-scan.js, measurements-scan.js, routine-scan.js) — all four
 * are genuinely auxiliary, internal, one-shot Gemini calls with no conversation and no relation
 * to coaching a member or drafting a routine, so they belong here rather than on user_trainer or
 * staff_trainer. Each capability keeps its own prompt/schema/validation in its own file; only
 * the credential, the adapter and the instance-level job log are shared. Adding a task later
 * means adding to this list and its own caller — never widening what an existing call can do.
 */
import fs from 'node:fs';
import path from 'node:path';
import { encrypt as encryptWith, decrypt as decryptWith, resetKeyCache } from './crypto.js';

const DATA = process.env.DATA_DIR || '/data';
const FILE = path.join(DATA, 'aux-ai.json');
const CRYPTO_INFO = 'opengym-aux-ai-v1';

export const CAPABILITIES = ['exercise_import_matching', 'machine_scan', 'measurements_scan', 'routine_scan'];

const DEFAULTS = {
  enabled: false,
  auth: null,                          // { type:'apikey', connectedAt, data:<encrypted {token}> }
  caps: { instanceDaily: 200 },        // 0 = unlimited — a batch call per import, not per exercise
  log: [],
  usage: null,
};
const LOG_MAX = 100;

export const encrypt = obj => encryptWith(obj, CRYPTO_INFO);
export const decrypt = blob => decryptWith(blob, CRYPTO_INFO);

let cache = null;
function atomicWrite(file, content, mode) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, content, mode ? { mode } : undefined);
  fs.renameSync(tmp, file);
}
export function load() {
  if (cache) return cache;
  let stored = {};
  try { stored = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { /* absent = feature off */ }
  cache = { ...DEFAULTS, ...stored, caps: { ...DEFAULTS.caps, ...(stored.caps || {}) } };
  return cache;
}
export function save(patch) {
  const next = { ...load(), ...patch };
  cache = next;
  atomicWrite(FILE, JSON.stringify(next, null, 2), 0o600);
  return next;
}
export function reset() { cache = null; resetKeyCache(); }

export function isEnabled() { return !!load().enabled; }
export function isConnected() {
  const cfg = load();
  if (!cfg.enabled) return false;
  return !!(cfg.auth?.type === 'apikey' && decrypt(cfg.auth.data));
}
/** What /api/config could tell every client — kept unused by V2 (the import-match endpoint
 *  already answers "not configured" gracefully per call), but present for parity with the
 *  other two profiles' own publicConfig() shape, and for a future caller that does want it. */
export function publicConfig() {
  return isEnabled() && isConnected() ? { enabled: true, capabilities: CAPABILITIES } : null;
}

export function setApiKey(rawKey) {
  const key = String(rawKey || '').trim();
  if (!key) throw new Error('pega una API key de Gemini');
  save({ auth: { type: 'apikey', connectedAt: new Date().toISOString(), data: encrypt({ token: key }) } });
}
export function disconnect() { save({ auth: null }); }
export function authStatus() {
  const cfg = load();
  if (!cfg.auth) return { state: 'disconnected' };
  const auth = decrypt(cfg.auth.data);
  if (!auth) return { state: 'unreadable' };
  return { state: 'connected', connectedAt: cfg.auth.connectedAt };
}

/** Same shape as the other two profiles' jobEnv — built from nothing, not filtered from
 *  process.env, so a call here never inherits RP_ID/ADMIN_UIDS/VAPID material etc. */
export function jobEnv() {
  const cfg = load();
  const env = {};
  const auth = cfg.auth ? decrypt(cfg.auth.data) : null;
  if (auth?.token) env.GEMINI_API_KEY = auth.token;
  return env;
}

/* ---------- instance-level job log (counts and outcomes only, never contents) ---------- */
export function logJob(entry) {
  const cfg = load();
  const log = [...(cfg.log || []), entry].slice(-LOG_MAX);
  save({ log });
}
const todayISO = () => new Date().toISOString().slice(0, 10);
export function jobsToday() {
  const cfg = load();
  return cfg.usage?.date === todayISO() ? Number(cfg.usage.total) || 0 : 0;
}
export function reserveDaily(uid = 'unknown') {
  const cfg = load();
  const date = todayISO();
  const usage = cfg.usage?.date === date
    ? { date, total: Number(cfg.usage.total) || 0, byUser: { ...(cfg.usage.byUser || {}) } }
    : { date, total: 0, byUser: {} };
  const limit = Number(cfg.caps?.instanceDaily) || 0;
  if (limit > 0 && usage.total >= limit) return { allowed: false, used: usage.total, limit };
  usage.total++;
  const key = String(uid || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || 'unknown';
  usage.byUser[key] = (Number(usage.byUser[key]) || 0) + 1;
  save({ usage });
  return { allowed: true, used: usage.total, limit };
}
export const lastError = () => [...(load().log || [])].reverse().find(e => e.outcome === 'failed') || null;
export const lastSuccess = () => [...(load().log || [])].reverse().find(e => e.outcome === 'ready') || null;
