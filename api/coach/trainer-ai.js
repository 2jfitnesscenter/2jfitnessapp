/* Credential/config store for the trainer panel's "Generate with AI" feature.
 *
 * Deliberately separate from ./config.js (the member-facing Coach): Juanjo wants the two AIs
 * independent, so an instance can run its member Coach on whatever provider it likes — or have
 * it switched off entirely — while trainers still get routines drafted by Claude specifically.
 * Own file on disk, own encryption namespace (still derived from the same ./data/secret via
 * lib/crypto.js's per-feature HKDF info string, so a leaked blob from one feature isn't
 * decryptable with the other's key), own credential. Always Claude — there is no provider
 * picker here, so this module is a small fraction of config.js's size.
 */
import fs from 'node:fs';
import path from 'node:path';
import { encrypt as encryptWith, decrypt as decryptWith, resetKeyCache } from '../lib/crypto.js';

const DATA = process.env.DATA_DIR || '/data';
const FILE = path.join(DATA, 'trainer-ai.json');
const CRYPTO_INFO = 'opengym-trainer-ai-v1';

const DEFAULTS = {
  enabled: false,
  auth: null,                          // { type:'cli-token', connectedAt, data:<encrypted> }
  caps: { instanceDaily: 30 },         // 0 = unlimited
  log: []
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
  return !!(cfg.auth?.type === 'cli-token' && decrypt(cfg.auth.data));
}
export function publicConfig() {
  return isEnabled() && isConnected() ? { enabled: true } : null;
}

export function setSetupToken(rawToken) {
  const token = String(rawToken || '').trim();
  if (!token) throw new Error('pega el token que imprime "claude setup-token"');
  save({ auth: { type: 'cli-token', connectedAt: new Date().toISOString(), data: encrypt({ token }) } });
}
export function disconnect() { save({ auth: null }); }
export function authStatus() {
  const cfg = load();
  if (!cfg.auth) return { state: 'disconnected' };
  const auth = decrypt(cfg.auth.data);
  if (!auth) return { state: 'unreadable' };
  return { state: 'connected', connectedAt: cfg.auth.connectedAt };
}

/** Same shape as config.js's jobEnv, but always the Claude Agent SDK credential. */
export function jobEnv(jobDir) {
  const cfg = load();
  const env = {
    PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    HOME: jobDir, TMPDIR: jobDir,
    CLAUDE_CONFIG_DIR: jobDir,
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1'
  };
  const auth = cfg.auth ? decrypt(cfg.auth.data) : null;
  if (auth?.token) env.CLAUDE_CODE_OAUTH_TOKEN = auth.token;
  return env;
}

/* ---------- instance-level job log (counts and outcomes only, same privacy rule as config.js) ---------- */
export function logJob(entry) {
  const cfg = load();
  const log = [...(cfg.log || []), entry].slice(-LOG_MAX);
  save({ log });
}
const todayISO = () => new Date().toISOString().slice(0, 10);
export function jobsToday() { return (load().log || []).filter(e => (e.at || '').slice(0, 10) === todayISO()).length; }
export const lastError = () => [...(load().log || [])].reverse().find(e => e.outcome === 'failed') || null;
export const lastSuccess = () => [...(load().log || [])].reverse().find(e => e.outcome === 'ready') || null;
